import { readRecords } from "../../../file/runRecord.ts";
import { readStateFile } from "../../../file/stateFile.ts";
import { deriveRunStats } from "../../../utils/deriveRunStats.ts";
import { init, restore } from "../global/actions.ts";
import type { AgentMiddleware } from "./types.ts";

/**
 * 最初の処理。`init` action を捕まえてファイルを読み、状態を復元する。
 * 読み取りも action で表すので、**読み取り専用のコマンド（route / label / explain）は
 * 何も書かない**（書き込み系の middleware は状態を変える action にだけ反応する）。
 *
 * 段取り 2 では、ここが `events/*.json` を名前順に読んで**1 件ずつ再生する**形になる。
 * いまはファイル形式を変えないため、`state.json` と `runs/*.json` から組み立てた
 * `RESTORE` を 1 回 dispatch する（`RESTORE` はそこで消える）。
 */
export const hydrate: AgentMiddleware = () => (store) => (next) => (action) => {
  if (!init.match(action as never)) return next(action);

  const { dir } = store.getState().info;
  const file = readStateFile(dir);
  const records = readRecords(dir);
  const stats = deriveRunStats(records);
  // 戻り先は「直前に走ったエージェントのフェーズ」。段取り 2 では畳み込みから直接出る
  const last = records.reduce<(typeof records)[number] | undefined>(
    (latest, r) => (!latest || r.started_at > latest.started_at ? r : latest),
    undefined,
  );

  store.dispatch(
    restore({
      info: {
        issue: file.meta.issue,
        branch: file.meta.branch,
        pipeline_version: file.meta.pipeline_version,
      },
      app: {
        // スナップショットの phase が blocked なら、実行位置は直前に走ったレコードが持つ。
        // **`phase` は blocked にならない**（止まっているかは `failure_reason` から導出する）
        phase: file.phase === "blocked" ? (last?.phase ?? "blocked") : file.phase,
        failure_reason: file.phase === "blocked" ? file.blocked_reason : null,
        total_steps: stats.total_steps,
        // 往復は**判定が付いた実行**で数える（reducer が判定の action で +1 するのと同じ規則）。
        // 失敗して verdict が無い実行は往復に数えない
        plan_review_rounds: records.filter((r) => r.agent === "plan-reviewer" && r.verdict).length,
        dev_review_rounds: records.filter((r) => r.agent === "dev-reviewer" && r.verdict).length,
        in_flight_agent: stats.in_flight?.agent ?? null,
        in_flight_run_id: stats.in_flight?.run_id ?? null,
      },
    }),
  );
  return undefined; // init は reducer に渡さない
};

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { approve } from "./commands/approve.ts";
import { type FinishResult, finish, type Outcome } from "./commands/finish.ts";
import { requestChanges } from "./commands/request-changes.ts";
import { applyStateFile, checkPipelineVersion, parseStateFile } from "./state-file.ts";
import { type RouteResult, reviewKindFor, route } from "./transitions.ts";
import type { AgentName, Phase } from "./types.ts";
import type { Config } from "./utils/load-config.ts";
import { nextReviewNumber } from "./utils/next-review-number.ts";
import { parseRecord, type RunRecord } from "./utils/parse-record.ts";
import { readRunDir } from "./utils/read-run-dir.ts";
import { renderReview } from "./utils/render-review.ts";
import { stringifyYaml } from "./utils/stringify-yaml.ts";

export type { FinishResult, Outcome } from "./commands/finish.ts";
export type { RouteResult } from "./transitions.ts";
export type { Config } from "./utils/load-config.ts";
export { loadConfig } from "./utils/load-config.ts";

interface Base {
  /** agent-work/issue-<n>/ */
  dir: string;
  config: Config;
  now?: Date;
}

const load = (dir: string) => {
  const { stateText, records } = readRunDir(dir);
  return { file: parseStateFile(stateText), records: records.map((r) => parseRecord(r.text)) };
};

const recordName = (r: { agent: string; run_id: string; attempt: number }) =>
  `${r.agent}-${r.run_id}-${r.attempt}.yml`;

const writeState = (
  dir: string,
  file: ReturnType<typeof parseStateFile>,
  patch: { phase: Phase; blocked_reason: string | null },
  now: Date,
) => writeFileSync(join(dir, "state.yml"), applyStateFile(file.doc, { ...patch, now }));

/**
 * エージェント実行の開始を記録する（dispatch.yml の state-start ステップ）。
 * このコミットは HEAD に [skip ci] を付けて push する。連鎖させないため（A-36）。
 */
export function startRun(
  input: Base & { agent: AgentName; run_id: string; attempt: number; model: string },
): { record_path: string } {
  const { dir, agent, run_id, attempt, model, now = new Date() } = input;
  const { file } = load(dir);
  const record: RunRecord = {
    agent,
    phase: file.phase,
    run_id,
    attempt,
    started_at: now.toISOString(),
    finished_at: null,
    result: null,
    verdict: null,
    model,
    session_id: null,
  };
  const path = join(dir, "runs", recordName({ agent, run_id, attempt }));
  mkdirSync(join(dir, "runs"), { recursive: true });
  writeFileSync(path, stringifyYaml(record));
  return { record_path: path };
}

/**
 * 次に何をするかを決める（dispatch.yml の route ジョブ）。
 * 版の整合性は遷移の規則ではないため、遷移判断の前にここで見る。
 */
export function routeRun(input: Base): RouteResult {
  const { file, records } = load(input.dir);
  const mismatch = checkPipelineVersion(file.meta, input.config);
  if (mismatch) {
    return {
      action: "block",
      reason: mismatch,
      phase: file.phase,
      total_steps: records.length,
      rounds: { plan_review: 0, dev_review: 0 },
    };
  }
  return route({ phase: file.phase, records, config: input.config });
}

/**
 * エージェント実行の結末を書き、次の phase を決めて state.yml を更新する
 * （dispatch.yml の finalize ステップ）。
 * レコードの更新を先に行うのは、ラウンド上限が今回の実行を含めて数えるため。
 */
export function finishRun(
  input: Base & { record_path: string; outcome: Outcome; session_id?: string | null },
): FinishResult {
  const { dir, record_path, outcome, config, session_id = null, now = new Date() } = input;
  const before = load(dir);

  const current = before.records.find((r) => record_path.endsWith(recordName(r)));
  if (!current) throw new Error(`実行レコードが見つかりません: ${record_path}`);
  const updated: RunRecord = {
    ...current,
    finished_at: now.toISOString(),
    result: outcome.result,
    verdict: outcome.verdict ?? null,
    session_id: session_id ?? current.session_id ?? null,
  };
  writeFileSync(
    record_path,
    stringifyYaml({ ...updated, api_error_status: outcome.api_error_status ?? null }),
  );

  const records = before.records.map((r) => (r === current ? updated : r));
  const result = finish({ phase: before.file.phase, records, config, outcome });
  writeState(dir, before.file, result, now);
  return result;
}

/** 人間の /approve による遷移（approve.yml） */
export function approveRun(
  input: Base & { association: string },
): { ok: true; phase: Phase } | { ok: false; reason: string } {
  const { dir, association, config, now = new Date() } = input;
  const { file } = load(dir);
  const decision = approve({ phase: file.phase, association, config });
  if (!decision.ok) return decision;
  writeState(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return decision;
}

/**
 * 人間の /request-changes による差し戻し（approve.yml）。
 * コメント本文を人間のレビューとして reviews/ に残すため、planner が次回それを読める。
 * ここを通らずに phase を手で戻すと、planner は何を直すべきか分からないまま再走する。
 */
export function requestChangesRun(
  input: Base & { association: string; body: string },
): { ok: true; phase: Phase; review_path: string } | { ok: false; reason: string } {
  const { dir, association, body, config, now = new Date() } = input;
  const { file } = load(dir);
  const decision = requestChanges({ phase: file.phase, association, config });
  if (!decision.ok) return decision;

  // レビュー種別は遷移表が持つ（awaiting_human なら計画、done なら差分）
  const kind = reviewKindFor(file.phase, config) ?? "plan";
  const round = nextReviewNumber(dir, kind);
  const review_path = join(dir, "reviews", `${kind}-${String(round).padStart(2, "0")}.md`);
  mkdirSync(join(dir, "reviews"), { recursive: true });
  writeFileSync(
    review_path,
    renderReview({ verdict: "request_changes", round, reviewer: `human:${association}`, body }),
  );
  writeState(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return { ...decision, review_path };
}

/**
 * phase を blocked にする（route が block を返したとき、stale 検知、上限超過）。
 * このコミットも HEAD に [skip ci] を付けて push する。連鎖させないため。
 */
export function blockRun(input: Base & { reason: string }): FinishResult {
  const { dir, reason, now = new Date() } = input;
  const { file } = load(dir);
  const result: FinishResult = {
    phase: "blocked",
    blocked_reason: reason,
    continue_chain: false,
    reason,
  };
  writeState(dir, file, result, now);
  return result;
}

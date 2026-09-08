import { readFileSync } from "node:fs";
import { writeStateFile } from "../file/stateFile.ts";
import type { Settings } from "../settings.ts";
import type { AgentName } from "../types.ts";
import { formatTimestamp } from "../utils/timestamp.ts";
import { composeRun } from "./effects/compose.ts";
import { explainRun } from "./effects/explain.ts";
import { type ValidationReport, validateRun } from "./effects/validate.ts";
import { mapValidationToAction } from "./mapValidationToAction.ts";
import { agentStarted, humanApproval, humanRequestChanges, retry } from "./store/app/actions.ts";
import { agentFor } from "./store/app/reducer.ts";
import { createStore } from "./store/createStore.ts";
import { bootstrap } from "./store/global/actions.ts";
import {
  selectContinueChain,
  selectInFlightAgent,
  selectLabel,
  selectNextAction,
  selectSnapshot,
  selectStatus,
} from "./store/global/selectors.ts";

/**
 * CLI の語彙を store 操作に写す層。**判断は 1 つも持たない。**
 * 中身は `runCommand` のコマンド名ごとの分岐だけ。移行前は 9 ファイルに分かれていたが、
 * 「action を作って dispatch する」だけになったので分ける意味が無くなった。
 */

/**
 * CLI の引数の定義。**`cli.ts` の `parseArgs` にそのまま渡し、`Args` の型もここから導く**
 * （一覧を 2 箇所に書くと、フラグを足すときに片方だけ直る）。
 */
export const CLI_OPTIONS = {
  dir: { type: "string" },
  issue: { type: "string" },
  branch: { type: "string" },
  agent: { type: "string" },
  "run-id": { type: "string" },
  attempt: { type: "string", default: "1" },
  model: { type: "string" },
  "session-id": { type: "string" },
  association: { type: "string" },
  "agent-failed": { type: "boolean", default: false },
  "execution-file": { type: "string" },
  "changed-files": { type: "string" },
  body: { type: "string" },
  repo: { type: "string" },
  central: { type: "string" },
  out: { type: "string" },
} as const;

/** ワークフローから渡る引数（`parseArgs` の出力と同じ形） */
export type Args = {
  // CLI_OPTIONS は as const なので readonly を外す（parseArgs の出力は書き換えてよい袋）
  -readonly [K in keyof typeof CLI_OPTIONS]?: (typeof CLI_OPTIONS)[K]["type"] extends "boolean"
    ? boolean
    : string;
};

/** 必須の引数が無いときに投げる。CLI が使い方を出して exit 2 にする */
export class MissingArg extends Error {
  constructor(readonly arg: string) {
    super(`--${arg} が必要です`);
  }
}

const need = <T>(v: T | undefined, name: string): T => {
  if (v === undefined || v === "") throw new MissingArg(name);
  return v;
};

/** ガードが弾いたとき、dispatch はこの形を返す（middleware が戻り値を差し替える） */
const isRejection = (r: unknown): r is { ok: false; reason: string } =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

/**
 * コマンドを 1 つ実行する。**1 起動で dispatch する action は 1 つだけ**。
 * 知らないコマンドなら undefined を返す（CLI が使い方を出す）。
 *
 * 上から「プロンプトの組み立て」「読むだけの 3 つ」「スナップショットを書き直す 1 つ」
 * 「状態を変える 6 つ」の順。語彙を足すときに書くのは分岐 1 つ。
 */
export function runCommand(
  command: string,
  args: Args,
  settings: Settings,
  configError: string | null = null,
): unknown {
  const dir = need(args.dir, "dir");
  // action に載る「いつ」。1 起動で dispatch する action は 1 つなので 1 回作れば足りる
  const now = formatTimestamp(new Date());
  const { store, outputs, state } = createStore({
    dir,
    settings,
    run_id: args["run-id"] ?? null,
    attempt: Number(args.attempt ?? 1),
  });

  // エージェントに渡すプロンプトを組み立てる。**組み立てる相手も引数で受け取らない**
  // — `start` が記録した in_flight から取る（agent という値の入口は start だけ）
  if (command === "compose") {
    const agent = selectInFlightAgent(state());
    if (!agent) throw new Error("実行が記録されていません（start が無い）");
    return composeRun({
      dir,
      settings,
      agent,
      repo: args.repo ?? ".",
      central: need(args.central, "central"),
      out: need(args.out, "out"),
      // 決定記録の名前の prefix になる（契約 §5）
      run_id: need(args["run-id"], "run-id"),
      attempt: Number(args.attempt ?? 1),
    });
  }

  // 読むだけの 3 つ。selector を読み、何も書かない
  if (command === "route") return selectNextAction(state(), settings, configError);
  if (command === "label") return selectLabel(state(), settings);
  if (command === "explain") return explainRun(state(), dir, settings, configError);

  // 状態を変えずにスナップショットを書き直す。**`blocked` は action ではなく導出される状態**
  // なので、止まったことを記録するには「いまの状態を書き出す」だけでよい（K-26）
  if (command === "snapshot") {
    const snapshot = selectSnapshot(state(), settings, configError);
    writeStateFile(dir, snapshot, new Date());
    const root = state();
    return { ...selectStatus(root, settings), continue_chain: selectContinueChain(root, settings) };
  }

  // run の最初のイベント。識別子（issue / ブランチ / 版）をここで確定する
  if (command === "bootstrap") {
    const issue = need(args.issue, "issue");
    const action = bootstrap({
      timestamp: now,
      by: "harness",
      issue: Number(issue),
      branch: need(args.branch, "branch"),
      pipeline_version: settings.pipeline_version,
    });
    store.dispatch(action);
    const root = state();
    return { ...selectStatus(root, settings), continue_chain: selectContinueChain(root, settings) };
  }

  if (command === "start") {
    const action = agentStarted({
      timestamp: now,
      by: "harness",
      run_id: need(args["run-id"], "run-id"),
      attempt: Number(args.attempt ?? 1),
      agent: need(args.agent, "agent") as AgentName,
      model: args.model ?? settings.models.default,
    });
    store.dispatch(action);
    return { event_path: outputs.event_path };
  }

  /**
   * エージェント 1 回の実行の結末。**成果物を契約に照らすのもここ**で、
   * どのフェーズが走っていたかで action が決まる（フェーズごとに別の action / K-26）。
   *
   * 検査は必ず `try` の中で行う。契約チェッカが落ちても state は書いて `blocked` にする
   * （例外を投げると状態が git に載らず run が無音で止まる / 設計書 §7）。
   */
  if (command === "finish") {
    const agent = selectInFlightAgent(state());
    let report: ValidationReport = {
      result: "invalid",
      detail: "実行が記録されていない（start が無い）",
    };
    if (agent) {
      try {
        // 1 行 1 ファイルのリスト（ワークフローが git status から作る）
        const listPath = args["changed-files"];
        let changed: string[] = [];
        if (listPath) changed = readFileSync(listPath, "utf8").split("\n").filter(Boolean);
        report = validateRun({
          dir,
          settings,
          agent,
          agent_failed: args["agent-failed"] ?? false,
          execution_file: args["execution-file"] ?? null,
          changed_files: changed,
        });
      } catch (error) {
        report = { result: "invalid", detail: `validate_crashed: ${String(error)}` };
      }
    }
    const action = mapValidationToAction(report, state().app.phase, {
      timestamp: now,
      by: "harness",
      run_id: need(args["run-id"], "run-id"),
      attempt: Number(args.attempt ?? 1),
      session_id: args["session-id"] ?? null,
    });
    store.dispatch(action);
    const root = state();
    return {
      ...selectStatus(root, settings),
      continue_chain: selectContinueChain(root, settings),
      result: report.result,
      detail: report.detail ?? null,
      // 規模超過は止めずに PR へ警告を出すための出力（K-21）
      oversize: report.oversize ?? false,
    };
  }

  // 人間起点の 3 つはガードが弾くことがある（`middlewares/guard.ts` の GUARDS）。
  // 弾かれた dispatch は理由を返すので、そのまま出力にして PR に貼る
  if (command === "approve") {
    const association = need(args.association, "association");
    const action = humanApproval({ timestamp: now, by: `human:${association}` });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    const { phase } = selectStatus(state(), settings);
    return { ok: true, phase };
  }

  if (command === "request-changes") {
    const association = need(args.association, "association");
    const action = humanRequestChanges({
      timestamp: now,
      by: `human:${association}`,
      body: need(args.body, "body"),
    });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    const { phase } = selectStatus(state(), settings);
    return { ok: true, phase, review_path: outputs.review_path };
  }

  if (command === "retry") {
    const association = need(args.association, "association");
    const action = retry({ timestamp: now, by: `human:${association}` });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    const { phase } = selectStatus(state(), settings);
    return { ok: true, phase, agent: agentFor(phase) };
  }

  return undefined;
}

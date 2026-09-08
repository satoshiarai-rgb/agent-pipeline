import { readFileSync } from "node:fs";
import { composeRun } from "../commands/compose.ts";
import { explainRun } from "../commands/explain.ts";
import { validateRun } from "../commands/validate.ts";
import type { Config } from "../defaults.ts";
import { writeStateFile } from "../file/stateFile.ts";
import type { AgentName, RunResult, Verdict } from "../types.ts";
import { mapValidationToAction, type ValidationReport } from "./mapValidationToAction.ts";
import { agentStarted, humanApproval, humanRequestChanges, retry } from "./store/app/actions.ts";
import { agentFor } from "./store/app/reducer.ts";
import type { RootState } from "./store/createStore.ts";
import { createStore } from "./store/createStore.ts";
import { bootstrap } from "./store/global/actions.ts";
import {
  selectContinueChain,
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
  result: { type: "string" },
  verdict: { type: "string" },
  "api-error-status": { type: "string" },
  detail: { type: "string" },
  "acceptance-passed": { type: "boolean", default: false },
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
  [K in keyof typeof CLI_OPTIONS]?: (typeof CLI_OPTIONS)[K]["type"] extends "boolean"
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

/** ISO 基本形式。イベントのファイル名の先頭になる（段取り 2 で使う） */
const timestamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const runOf = (a: Args) => ({
  run_id: need(a["run-id"], "run-id"),
  attempt: Number(a.attempt ?? 1),
});
const harness = () => ({ timestamp: timestamp(), by: "harness" });
const human = (a: Args) => ({
  timestamp: timestamp(),
  by: `human:${need(a.association, "association")}`,
});

const reportOf = (a: Args): ValidationReport => ({
  result: need(a.result, "result") as RunResult,
  verdict: (a.verdict as Verdict | undefined) ?? null,
  acceptance_passed: a["acceptance-passed"] ?? false,
  api_error_status: a["api-error-status"] ? Number(a["api-error-status"]) : null,
  detail: a.detail,
});

/** 遷移の結果を返すコマンドの出力（ワークフローが読む形） */
const transitionOutput = (root: RootState, config: Config) => ({
  ...selectStatus(root, config),
  continue_chain: selectContinueChain(root, config),
});

/** ガードが弾いたとき、dispatch はこの形を返す（middleware が戻り値を差し替える） */
export const isRejection = (r: unknown): r is { ok: false; reason: string } =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

/**
 * コマンドを 1 つ実行する。**1 起動で dispatch する action は 1 つだけ**。
 * 知らないコマンドなら undefined を返す（CLI が使い方を出す）。
 *
 * 上から「store を使わない 2 つ」「読むだけの 3 つ」「スナップショットを書き直す 1 つ」
 * 「状態を変える 6 つ」の順。語彙を足すときに書くのは分岐 1 つ。
 */
export function runCommand(
  command: string,
  args: Args,
  config: Config,
  configError: string | null = null,
): unknown {
  // store を使わない 2 つ。成果物と契約だけを見る
  if (command === "validate")
    return validateRun({
      dir: need(args.dir, "dir"),
      config,
      agent: need(args.agent, "agent") as AgentName,
      agent_failed: args["agent-failed"] ?? false,
      execution_file: args["execution-file"] ?? null,
      // 1 行 1 ファイルのリスト（ワークフローが git status から作る）
      changed_files: args["changed-files"]
        ? readFileSync(args["changed-files"], "utf8").split("\n").filter(Boolean)
        : [],
    });

  if (command === "compose")
    return composeRun({
      dir: need(args.dir, "dir"),
      config,
      agent: need(args.agent, "agent") as AgentName,
      repo: args.repo ?? ".",
      central: need(args.central, "central"),
      out: need(args.out, "out"),
      // 決定記録の名前の prefix になる（契約 §5）
      run_id: need(args["run-id"], "run-id"),
      attempt: Number(args.attempt ?? 1),
    });

  const dir = need(args.dir, "dir");
  const { store, outputs, state } = createStore({
    dir,
    config,
    run_id: args["run-id"] ?? null,
    attempt: Number(args.attempt ?? 1),
  });

  // 読むだけの 3 つ。selector を読み、何も書かない
  if (command === "route") return selectNextAction(state(), config, configError);
  if (command === "label") return selectLabel(state(), config);
  if (command === "explain") return explainRun(state(), dir, config, configError);

  // 状態を変えずにスナップショットを書き直す。**`blocked` は action ではなく導出される状態**
  // なので、止まったことを記録するには「いまの状態を書き出す」だけでよい（K-26）
  if (command === "snapshot") {
    writeStateFile(dir, selectSnapshot(state(), config, configError), new Date());
    return transitionOutput(state(), config);
  }

  // run の最初のイベント。識別子（issue / ブランチ / 版）をここで確定する
  if (command === "bootstrap") {
    const action = bootstrap({
      ...harness(),
      issue: Number(need(args.issue, "issue")),
      branch: need(args.branch, "branch"),
      pipeline_version: config.pipeline_version,
    });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    return transitionOutput(state(), config);
  }

  if (command === "start") {
    const action = agentStarted({
      ...harness(),
      ...runOf(args),
      agent: need(args.agent, "agent") as AgentName,
      model: args.model ?? config.models.default,
    });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    return { event_path: outputs.event_path };
  }

  // どのフェーズが走っていたかで action が決まる（フェーズごとに別の action / K-26）
  if (command === "finish") {
    const action = mapValidationToAction(reportOf(args), state().app.phase, {
      ...harness(),
      ...runOf(args),
      session_id: args["session-id"] ?? null,
    });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    return transitionOutput(state(), config);
  }

  if (command === "approve") {
    const action = humanApproval(human(args));
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    return { ok: true, phase: selectStatus(state(), config).phase };
  }

  if (command === "request-changes") {
    const action = humanRequestChanges({ ...human(args), body: need(args.body, "body") });
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    return { ok: true, phase: state().app.phase, review_path: outputs.review_path };
  }

  if (command === "retry") {
    const action = retry(human(args));
    const result = store.dispatch(action);
    if (isRejection(result)) return result;
    const { phase } = selectStatus(state(), config);
    return { ok: true, phase, agent: agentFor(phase) };
  }

  return undefined;
}

import { readFileSync } from "node:fs";
import { composeRun } from "../commands/compose.ts";
import { explainRun } from "../commands/explain.ts";
import { validateRun } from "../commands/validate.ts";
import type { Config } from "../defaults.ts";
import { writeStateFile } from "../file/state-file.ts";
import type { AgentName, RunResult, Verdict } from "../types.ts";
import { fromOutcome, type Outcome, RunFailed } from "./from-outcome.ts";
import {
  agentFailed,
  agentStarted,
  humanApproval,
  humanRequestChanges,
  retry,
} from "./store/app/actions.ts";
import { agentFor } from "./store/app/reducer.ts";
import type { RootState } from "./store/createStore.ts";
import { createStore } from "./store/createStore.ts";
import type { PipelineAction } from "./store/global/actions.ts";
import {
  selectContinueChain,
  selectLabel,
  selectNextAction,
  selectSnapshot,
  selectStatus,
} from "./store/global/selectors.ts";

/**
 * CLI の語彙 → store 操作の対応表。**判断は 1 つも持たない。**
 *
 *   action + output  状態を変える 6 つ（action を作って dispatch し、出力を射影する）
 *   read             読むだけの 3 つ（selector を読む。何も書かない）
 *   plain            store を使わない 2 つ（成果物と契約だけを見る）
 *
 * action を 1 つ足すときに触るのはこの表の 1 行。移行前は 9 ファイルに分かれていたが、
 * 中身が「action を作って dispatch する」だけになったので分ける意味が無くなった。
 */

/**
 * CLI の引数の定義。**`cli.ts` の `parseArgs` にそのまま渡し、`Args` の型もここから導く**
 * （一覧を 2 箇所に書くと、フラグを足すときに片方だけ直る）。
 */
export const CLI_OPTIONS = {
  dir: { type: "string" },
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

const outcomeOf = (a: Args): Outcome => ({
  result: need(a.result, "result") as RunResult,
  verdict: (a.verdict as Verdict | undefined) ?? null,
  acceptance_passed: a["acceptance-passed"] ?? false,
  api_error_status: a["api-error-status"] ? Number(a["api-error-status"]) : null,
  detail: a.detail,
});

/** 遷移の結果を返すコマンドの出力（ワークフローが読む形） */
const transitionOutput = (root: RootState, _outputs: unknown, config: Config) => ({
  ...selectStatus(root, config),
  continue_chain: selectContinueChain(root, config),
});

interface Command {
  /** dispatch する action。`root` はいまの状態（走っていたフェーズを見るために渡す） */
  action?: (a: Args, config: Config, root: RootState) => PipelineAction;
  output?: (root: RootState, outputs: Record<string, unknown>, config: Config) => unknown;
  read?: (root: RootState, a: Args, config: Config, configError: string | null) => unknown;
  /** action を使わずにファイルを書き直すもの（スナップショットの再生成） */
  write?: (root: RootState, config: Config, configError: string | null) => unknown;
  plain?: (a: Args, config: Config) => unknown;
}

export const COMMANDS: Record<string, Command> = {
  start: {
    action: (a, config) =>
      agentStarted({
        ...harness(),
        ...runOf(a),
        agent: need(a.agent, "agent") as AgentName,
        model: a.model ?? config.models.default,
      }),
    output: (_root, outputs) => ({ record_path: outputs.record_path }),
  },
  finish: {
    /**
     * どのフェーズが走っていたかで action が決まる（フェーズごとに別の action / K-26）。
     * **止まる結果は `RunFailed` で飛んでくるので、ここで受けて記録する action に変える。**
     * 投げたまま抜けると `state.json` が書かれず、run が無音で止まる（設計書 §7.1）。
     */
    action: (a, _config, root) => {
      const context = { ...harness(), ...runOf(a), session_id: a["session-id"] ?? null };
      try {
        return fromOutcome(outcomeOf(a), context, root.app.phase);
      } catch (failure) {
        if (!(failure instanceof RunFailed)) throw failure;
        return agentFailed({
          ...context,
          reason: failure.reason,
          api_error_status: failure.api_error_status,
        });
      }
    },
    output: transitionOutput,
  },
  approve: {
    action: (a) => humanApproval(human(a)),
    output: (root, _outputs, config) => ({ ok: true, phase: selectStatus(root, config).phase }),
  },
  "request-changes": {
    action: (a) => humanRequestChanges({ ...human(a), body: need(a.body, "body") }),
    output: (root, outputs) => ({
      ok: true,
      phase: root.app.phase,
      review_path: outputs.review_path,
    }),
  },
  retry: {
    action: (a) => retry(human(a)),
    output: (root, _outputs, config) => {
      const { phase } = selectStatus(root, config);
      return { ok: true, phase, agent: agentFor(phase) };
    },
  },
  /**
   * 状態を変えずにスナップショットを書き直す。**`blocked` は action ではなく導出される状態**
   * なので、止まったことを記録するには「いまの状態を書き出す」だけでよい（K-26）。
   */
  snapshot: {
    write: (root, config, configError) => {
      writeStateFile(root.info.dir, selectSnapshot(root, config, configError), new Date());
      return transitionOutput(root, null, config);
    },
  },
  route: { read: (root, _a, config, configError) => selectNextAction(root, config, configError) },
  label: { read: (root, _a, config) => selectLabel(root, config) },
  explain: {
    read: (root, a, config, configError) =>
      explainRun(root, need(a.dir, "dir"), config, configError),
  },
  validate: {
    plain: (a, config) =>
      validateRun({
        dir: need(a.dir, "dir"),
        config,
        agent: need(a.agent, "agent") as AgentName,
        agent_failed: a["agent-failed"] ?? false,
        execution_file: a["execution-file"] ?? null,
        // 1 行 1 ファイルのリスト（ワークフローが git status から作る）
        changed_files: a["changed-files"]
          ? readFileSync(a["changed-files"], "utf8").split("\n").filter(Boolean)
          : [],
      }),
  },
  compose: {
    plain: (a, config) =>
      composeRun({
        dir: need(a.dir, "dir"),
        config,
        agent: need(a.agent, "agent") as AgentName,
        repo: a.repo ?? ".",
        central: need(a.central, "central"),
        out: need(a.out, "out"),
        // 決定記録の名前の prefix になる（契約 §5）
        run_id: need(a["run-id"], "run-id"),
        attempt: Number(a.attempt ?? 1),
      }),
  },
};

/** ガードが弾いたとき、dispatch はこの形を返す（middleware が戻り値を差し替える） */
export const isRejection = (r: unknown): r is { ok: false; reason: string } =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

/**
 * コマンドを 1 つ実行する。**1 起動で dispatch する action は 1 つだけ**。
 * 知らないコマンドなら undefined を返す（CLI が使い方を出す）。
 */
export function runCommand(
  command: string,
  args: Args,
  config: Config,
  configError: string | null = null,
): unknown {
  const cmd = COMMANDS[command];
  if (!cmd) return undefined;
  if (cmd.plain) return cmd.plain(args, config);

  const dir = need(args.dir, "dir");
  const { store, outputs, state } = createStore({
    dir,
    config,
    run_id: args["run-id"] ?? null,
    attempt: Number(args.attempt ?? 1),
  });
  if (cmd.read) return cmd.read(state(), args, config, configError);
  if (cmd.write) return cmd.write(state(), config, configError);

  const result = store.dispatch(
    (cmd.action as NonNullable<Command["action"]>)(args, config, state()),
  );
  if (isRejection(result)) return result;
  return cmd.output?.(state(), outputs, config);
}

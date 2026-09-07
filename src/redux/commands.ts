import { readFileSync } from "node:fs";
import { composeRun } from "../commands/compose.ts";
import { explainRun } from "../commands/explain.ts";
import { validateRun } from "../commands/validate.ts";
import type { Config } from "../defaults.ts";
import { writeStateFile } from "../file/state-file.ts";
import type { AgentName, RunResult, Verdict } from "../types.ts";
import { fromOutcome, type Outcome } from "./from-outcome.ts";
import { agentStarted, humanApproval, humanRequestChanges, retry } from "./store/app/actions.ts";
import { agentFor } from "./store/app/reducer.ts";
import type { RootState } from "./store/createStore.ts";
import { createStore } from "./store/createStore.ts";
import type { PipelineAction } from "./store/global/actions.ts";
import {
  selectBlocked,
  selectContinueChain,
  selectLabel,
  selectNextAction,
  selectPhase,
  selectSnapshot,
} from "./store/selectors.ts";

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

/** ワークフローから渡る引数（parseArgs の出力と同じ形） */
export interface Args {
  dir?: string;
  agent?: string;
  "run-id"?: string;
  attempt?: string;
  model?: string;
  result?: string;
  verdict?: string;
  "api-error-status"?: string;
  detail?: string;
  oversize?: boolean;
  "acceptance-passed"?: boolean;
  "session-id"?: string;
  association?: string;
  "agent-failed"?: boolean;
  "execution-file"?: string;
  "changed-files"?: string;
  body?: string;
  repo?: string;
  central?: string;
  out?: string;
}

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
  oversize: a.oversize ?? false,
  acceptance_passed: a["acceptance-passed"] ?? false,
  api_error_status: a["api-error-status"] ? Number(a["api-error-status"]) : null,
  detail: a.detail,
});

/** 遷移の結果を返すコマンドの出力（ワークフローが読む形） */
const transitionOutput = (root: RootState, _outputs: unknown, config: Config) => ({
  phase: selectPhase(root, config),
  blocked_reason: selectBlocked(root, config).reason,
  continue_chain: selectContinueChain(root, config),
  reason: root.app.last_reason ?? "",
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
    // どのフェーズが走っていたかで action が決まる（フェーズごとに別の action / K-26）
    action: (a, _config, root) =>
      fromOutcome(
        outcomeOf(a),
        { ...harness(), ...runOf(a), session_id: a["session-id"] ?? null },
        root.app.phase,
      ),
    output: transitionOutput,
  },
  approve: {
    action: (a) => humanApproval(human(a)),
    output: (root, _outputs, config) => ({ ok: true, phase: selectPhase(root, config) }),
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
    output: (root, _outputs, config) => ({
      ok: true,
      phase: selectPhase(root, config),
      agent: agentFor(selectPhase(root, config)),
    }),
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

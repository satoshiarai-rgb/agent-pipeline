import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../defaults.ts";
import { defaults } from "../defaults.ts";
import { readStateFile } from "../file/state-file.ts";
import type { Args } from "../redux/commands.ts";
import { runCommand } from "../redux/commands.ts";
import type { Outcome } from "../redux/from-outcome.ts";
import type { NextAction } from "../redux/store/global/selectors.ts";
import type { AgentName, Phase } from "../types.ts";

const dirs: string[] = [];

/** templates/state.json を元に一時的な run ディレクトリを作る */
export function makeRun(phase: Phase | string = "planning"): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-run-"));
  dirs.push(dir);
  const template = JSON.parse(
    readFileSync(join(import.meta.dir, "../../templates/state.json"), "utf8"),
  );
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({ ...template, issue: 123, branch: "claude/issue-123", phase }, null, 2),
  );
  return dir;
}

/**
 * スナップショットに「止まった」を書き込む。**`blocked` は action ではなく導出される状態**
 * なので、任意の理由で止まった run を作るにはスナップショット側に書くのが素直
 * （`hydrate` が `blocked_reason` を `failure_reason` に写す / K-26）。
 */
export function markBlocked(dir: string, reason: string): string {
  const path = join(dir, "state.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(
    path,
    JSON.stringify({ ...state, phase: "blocked", blocked_reason: reason }, null, 2),
  );
  return dir;
}

/** 止まった run を 1 つ作る */
export const makeBlocked = (reason: string, phase: Phase | string = "planning"): string =>
  markBlocked(makeRun(phase), reason);

/** 作った run ディレクトリを片付ける（afterEach から呼ぶ） */
export function cleanupRuns(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** スナップショット（`state.json`）を読む。状態の正はイベント側にある */
export const phaseOf = (dir: string) => readStateFile(dir);

/**
 * **CLI と同じ経路でコマンドを 1 つ走らせる**（`redux/commands.ts` の対応表を通す）。
 * 1 起動 = 1 store = 1 action なので、本番と同じく毎回ファイルから状態を組み立て直す。
 */
export const cli = (command: string, args: Args, config: Config = defaults): unknown =>
  runCommand(command, args, config);

interface Transitioned {
  phase: Phase;
  blocked_reason: string | null;
  continue_chain: boolean;
}
type Human = { ok: true; phase: Phase; review_path?: string } | { ok: false; reason: string };

let seq = 0;

/** 実行の開始だけを記録する */
export const start = (dir: string, agent: AgentName, run_id: string, config = defaults) =>
  cli("start", { dir, agent, "run-id": run_id, attempt: "1", model: "claude-opus-5" }, config) as {
    record_path: string;
  };

/**
 * エージェント 1 回の実行（開始 → 結末）。**本番と同じく別々の起動で走らせる**。
 * 遷移の検証はすべてこの単位で書く。
 */
export function runOnce(
  dir: string,
  agent: AgentName,
  outcome: Outcome,
  config = defaults,
): Transitioned {
  const run_id = String(++seq);
  start(dir, agent, run_id, config);
  return cli(
    "finish",
    {
      dir,
      "run-id": run_id,
      attempt: "1",
      result: outcome.result,
      verdict: outcome.verdict ?? undefined,
      detail: outcome.detail,
      "api-error-status":
        outcome.api_error_status === null || outcome.api_error_status === undefined
          ? undefined
          : String(outcome.api_error_status),
      "acceptance-passed": outcome.acceptance_passed ?? false,
      "session-id": `sess-${run_id}`,
    },
    config,
  ) as Transitioned;
}

export const approve = (dir: string, association = "OWNER", config = defaults) =>
  cli("approve", { dir, association }, config) as Human;

export const requestChanges = (dir: string, association: string, body: string, config = defaults) =>
  cli("request-changes", { dir, association, body }, config) as Human;

export const retry = (dir: string, association = "OWNER", config = defaults) =>
  cli("retry", { dir, association }, config) as Human & { agent?: AgentName | null };

/**
 * スナップショットを書き直す。**`blocked` は action ではなく導出される状態**なので、
 * 止まったことを記録するコマンドはこれだけ（K-26）
 */
export const snapshot = (dir: string, config = defaults) =>
  cli("snapshot", { dir }, config) as Transitioned;

export const route = (dir: string, config = defaults) =>
  cli("route", { dir }, config) as NextAction;

export const label = (dir: string, config = defaults) =>
  cli("label", { dir }, config) as {
    label: string;
    issue: number;
    phase: Phase;
    prefix: string;
    trigger: string;
  };

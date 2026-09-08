import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../defaults.ts";
import { defaults } from "../defaults.ts";
import { appendEvent } from "../file/eventLog.ts";
import { readStateFile } from "../file/stateFile.ts";
import type { Args } from "../redux/commands.ts";
import { runCommand } from "../redux/commands.ts";
import type { ValidationReport } from "../redux/mapValidationToAction.ts";
import { agentFailed } from "../redux/store/app/actions.ts";
import type { NextAction } from "../redux/store/global/selectors.ts";
import type { AgentName, Phase } from "../types.ts";

const dirs: string[] = [];
let seq = 0;
const nextRun = () => String(++seq);

/**
 * **CLI と同じ経路でコマンドを 1 つ走らせる**（`redux/commands.ts` の対応表を通す）。
 * 1 起動 = 1 store = 1 action なので、本番と同じく毎回イベントログを畳み直す。
 */
export const cli = (command: string, args: Args, config: Config = defaults): unknown =>
  runCommand(command, args, config);

interface Transitioned {
  phase: Phase;
  blocked_reason: string | null;
  continue_chain: boolean;
}
type Human = { ok: true; phase: Phase; review_path?: string } | { ok: false; reason: string };

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
  report: ValidationReport,
  config = defaults,
): Transitioned {
  const run_id = nextRun();
  start(dir, agent, run_id, config);
  return cli(
    "finish",
    {
      dir,
      "run-id": run_id,
      attempt: "1",
      result: report.result,
      verdict: report.verdict ?? undefined,
      detail: report.detail,
      "api-error-status":
        report.api_error_status === null || report.api_error_status === undefined
          ? undefined
          : String(report.api_error_status),
      "acceptance-passed": report.acceptance_passed ?? false,
      "session-id": `sess-${run_id}`,
    },
    config,
  ) as Transitioned;
}

export const approve = (dir: string, association = "OWNER", config = defaults) =>
  cli("approve", { dir, association, "run-id": nextRun() }, config) as Human;

export const requestChanges = (dir: string, association: string, body: string, config = defaults) =>
  cli("request-changes", { dir, association, body, "run-id": nextRun() }, config) as Human;

export const retry = (dir: string, association = "OWNER", config = defaults) =>
  cli("retry", { dir, association, "run-id": nextRun() }, config) as Human & {
    agent?: AgentName | null;
  };

/**
 * 目的のフェーズまで**幸せな道を再生して** run を作る。
 * 状態の正はイベントログなので、テストの下ごしらえも本番と同じイベントで行う
 * （`state.json` を書いて phase を捏造することはできない / K-26）。
 */
const ENTER: [Phase, (dir: string) => void][] = [
  ["planning", () => {}], // bootstrap が入れてくれる
  ["plan_review", (dir) => runOnce(dir, "planner", { result: "ok" })],
  ["awaiting_human", (dir) => runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" })],
  ["developing", (dir) => approve(dir)],
  ["dev_review", (dir) => runOnce(dir, "developer", { result: "ok" })],
  ["completing", (dir) => runOnce(dir, "dev-reviewer", { result: "ok", verdict: "approve" })],
  ["done", (dir) => runOnce(dir, "completion", { result: "ok", acceptance_passed: true })],
];

export function makeRun(target: Phase | string = "planning"): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-run-"));
  dirs.push(dir);
  cli("bootstrap", {
    dir,
    issue: "123",
    branch: "claude/issue-123",
    "run-id": nextRun(),
  });
  for (const [phase, enter] of ENTER) {
    enter(dir); // その phase に入るための手順
    if (phase === target) return dir;
  }
  return dir;
}

/**
 * 止まった run を作る。理由は `agentFailed` のイベントとして書く
 * （`blocked` は action ではなく、そのイベントから導出される状態 / K-26）。
 */
export function makeBlocked(reason: string, phase: Phase | string = "planning"): string {
  const dir = makeRun(phase);
  return markBlocked(dir, reason);
}

/** すでにある run に「止まった」イベントを 1 件足す */
export function markBlocked(dir: string, reason: string): string {
  const run_id = nextRun();
  appendEvent(
    dir,
    agentFailed({
      timestamp: `20260908T0000${String(seq).padStart(2, "0")}Z`,
      by: "harness",
      run_id,
      attempt: 1,
      reason,
    }),
    { run_id, attempt: 1 },
  );
  return dir;
}

/** 作った run ディレクトリを片付ける（afterEach から呼ぶ） */
export function cleanupRuns(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** スナップショット（`state.json`）を読む。状態の正はイベント側にある */
export const phaseOf = (dir: string) => readStateFile(dir);

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

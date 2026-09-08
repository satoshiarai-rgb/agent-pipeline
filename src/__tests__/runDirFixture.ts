import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Criterion } from "../file/acceptanceFile.ts";
import { appendEvent } from "../file/eventLog.ts";
import { nextReviewNumber, reviewPath, saveReview } from "../file/reviewFile.ts";
import { readStateFile } from "../file/stateFile.ts";
import type { PipelineSettings } from "../pipelineSettings.ts";
import { defaultSettings } from "../pipelineSettings.ts";
import type { ValidationReport } from "../redux/effects/validate.ts";
import type { Args } from "../redux/runCommand.ts";
import { runCommand } from "../redux/runCommand.ts";
import { agentFailed, agentStarted } from "../redux/store/app/actions.ts";
import type { NextAction } from "../redux/store/global/selectors.ts";
import type { AgentName, Phase } from "../types.ts";
import { stringifyJson } from "../utils/stringifyJson.ts";

const dirs: string[] = [];
let seq = 0;
const nextRun = () => String(++seq);

/**
 * **CLI と同じ経路でコマンドを 1 つ走らせる**（`redux/runCommand.ts` の分岐を通す）。
 * 1 起動 = 1 store = 1 action なので、本番と同じく毎回イベントログを畳み直す。
 */
export const cli = (
  command: string,
  args: Args,
  settings: PipelineSettings = defaultSettings,
): unknown => runCommand(command, args, settings);

interface Transitioned {
  phase: Phase;
  blocked_reason: string | null;
  continue_chain: boolean;
}
type Human = { ok: true; phase: Phase; review_path?: string } | { ok: false; reason: string };

/** 実行の開始だけを記録する */
export const start = (dir: string, agent: AgentName, run_id: string, settings = defaultSettings) =>
  cli(
    "start",
    { dir, agent, "run-id": run_id, attempt: "1", model: "claude-opus-5" },
    settings,
  ) as {
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
  settings = defaultSettings,
): Transitioned {
  const run_id = nextRun();
  start(dir, agent, run_id, settings);

  const args: Args = { dir, "run-id": run_id, attempt: "1", "session-id": `sess-${run_id}` };
  if (report.result === "agent_failed") args["agent-failed"] = true;
  if (report.result === "api_error") {
    args["execution-file"] = writeExecutionLog(dir, report.api_error_status ?? 500);
  }
  if (report.result === "ok") {
    ARTIFACTS[agent](dir, report);
    args["changed-files"] = writeChangedList(dir);
  }
  // result: "invalid" は成果物を書かない（契約の最初の check が落ちる）
  return cli("finish", args, settings) as Transitioned;
}

// ------------------------------------------------- 成果物を作る（契約 §4 の裏返し）
//
// finish が自分で `validate` するので、**テストも本番と同じく「成果物を置いてから
// finish を呼ぶ」**。契約の詳細に依存するテストコードはここだけに閉じる。
// 契約に関係ないファイル（差分の一覧・実行ログ）は `.test/` に置く
// （run ディレクトリ直下に置くと成果物の検査から見えてしまう）。

const sideFile = (dir: string, name: string, body: string): string => {
  const path = join(dir, ".test", name);
  mkdirSync(join(dir, ".test"), { recursive: true });
  writeFileSync(path, body);
  return path;
};

/** developer の差分。1 行 1 ファイル（本番はワークフローが git status から作る） */
const writeChangedList = (dir: string): string =>
  sideFile(dir, `changed-${seq}.txt`, "src/index.ts\n");

/** base-action の実行ログ。API エラーの分類に使う（A-31） */
const writeExecutionLog = (dir: string, status: number): string =>
  sideFile(
    dir,
    `execution-${seq}.json`,
    stringifyJson([{ type: "result", subtype: "error", is_error: true, api_error_status: status }]),
  );

const writeAcceptance = (dir: string, passed: boolean): void => {
  const criterion: Criterion = {
    id: "AC-1",
    description: "bun test が通る",
    verification: "automated",
    command: "bun test",
    status: "pending",
    evidence: null,
  };
  if (passed) {
    criterion.status = "passed";
    criterion.evidence = "bun test: 全件 pass";
  }
  writeFileSync(join(dir, "acceptance.json"), stringifyJson({ criteria: [criterion] }));
};

/** verdict が無い report は「frontmatter を書き忘れたレビュー」を置く（本番と同じ形で弾かれる） */
const writeReview = (dir: string, kind: "plan" | "dev", report: ValidationReport): void => {
  if (report.verdict) {
    saveReview({ dir, kind, verdict: report.verdict, reviewer: `${kind}-reviewer`, body: "所見" });
    return;
  }
  mkdirSync(join(dir, "reviews"), { recursive: true });
  const round = nextReviewNumber(dir, kind);
  writeFileSync(reviewPath(dir, kind, round), "---\nround: 1\n---\n\nverdict を書き忘れた\n");
};

const ARTIFACTS: Record<AgentName, (dir: string, report: ValidationReport) => void> = {
  planner: (dir, report) => {
    let scale = "上限内（3 ファイル）";
    if (report.oversize) scale = "上限超過（12 ファイル）";
    writeFileSync(join(dir, "plan.md"), `# 計画\n\n## 規模判定\n\n${scale}\n`);
    writeAcceptance(dir, false);
  },
  "plan-reviewer": (dir, report) => writeReview(dir, "plan", report),
  developer: (dir) => writeAcceptance(dir, true),
  "dev-reviewer": (dir, report) => writeReview(dir, "dev", report),
  completion: (dir, report) => {
    writeFileSync(join(dir, "completion.md"), "# 完了報告\n\n実装した。\n");
    writeAcceptance(dir, report.acceptance_passed ?? false);
  },
};

export const approve = (dir: string, association = "OWNER", settings = defaultSettings) =>
  cli("approve", { dir, association, "run-id": nextRun() }, settings) as Human;

export const requestChanges = (
  dir: string,
  association: string,
  body: string,
  settings = defaultSettings,
) => cli("request-changes", { dir, association, body, "run-id": nextRun() }, settings) as Human;

export const retry = (dir: string, association = "OWNER", settings = defaultSettings) =>
  cli("retry", { dir, association, "run-id": nextRun() }, settings) as Human & {
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

/**
 * **死んだ実行**（開始イベントだけが残った状態）を作る。job のタイムアウトや
 * キャンセルで run が落ちた形で、`timestamp` の古さが stale の判定を決める。
 */
export function makeInFlight(dir: string, agent: AgentName, timestamp: string): string {
  const run_id = nextRun();
  appendEvent(
    dir,
    agentStarted({ timestamp, by: "harness", run_id, attempt: 1, agent, model: "claude-opus-5" }),
    { run_id, attempt: 1 },
  );
  return dir;
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
export const snapshot = (dir: string, settings = defaultSettings) =>
  cli("snapshot", { dir }, settings) as Transitioned;

export const route = (dir: string, settings = defaultSettings) =>
  cli("route", { dir }, settings) as NextAction;

export const label = (dir: string, settings = defaultSettings) =>
  cli("label", { dir }, settings) as {
    label: string;
    issue: number;
    phase: Phase;
    prefix: string;
    trigger: string;
  };

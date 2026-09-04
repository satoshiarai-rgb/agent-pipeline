import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Outcome } from "../commands/finish.ts";
import { finishRun } from "../commands/finish.ts";
import { startRun } from "../commands/start.ts";
import { defaults } from "../defaults.ts";
import { readStateFile } from "../file/state-file.ts";
import type { AgentName } from "../types.ts";

const dirs: string[] = [];

/** templates/state.json を元に一時的な run ディレクトリを作る */
export function makeRun(phase = "planning"): string {
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

/** 作った run ディレクトリを片付ける（afterEach から呼ぶ） */
export function cleanupRuns(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const phaseOf = (dir: string) => readStateFile(dir);

let seq = 0;

/**
 * エージェント 1 回の実行（開始の記録 → 結末の書き込み）をまとめて行う。
 * 遷移の検証はすべてこの単位で書く（純粋関数を公開せずに全経路を通せる）。
 */
export function runOnce(
  dir: string,
  agent: AgentName,
  outcome: Outcome,
  config = defaults,
): ReturnType<typeof finishRun> {
  const run_id = String(++seq);
  const { record_path } = startRun({
    dir,
    config,
    agent,
    run_id,
    attempt: 1,
    model: "claude-opus-5",
  });
  return finishRun({ dir, config, record_path, outcome, session_id: `sess-${run_id}` });
}

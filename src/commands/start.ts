import { openRecord, saveRecord } from "../file/run-record.ts";
import { readStateFile } from "../file/state-file.ts";
import type { AgentName } from "../types.ts";
import type { CommandInput } from "./input.ts";

/**
 * エージェント実行の開始を記録する（dispatch.yml の state-start ステップ）。
 * このコミットは HEAD に [skip ci] を付けて push する。連鎖させないため（A-36）。
 */
export function startRun(
  input: CommandInput & { agent: AgentName; run_id: string; attempt: number; model: string },
): { record_path: string } {
  const { dir, agent, run_id, attempt, model, now = new Date() } = input;
  const file = readStateFile(dir);
  const record = openRecord({
    agent,
    phase: file.phase,
    run_id,
    attempt,
    model,
    started_at: now.toISOString(),
  });
  return { record_path: saveRecord(dir, record) };
}

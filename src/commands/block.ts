import { readStateFile, writeStateFile } from "../file/state-file.ts";
import type { FinishResult } from "./finish.ts";
import type { CommandInput } from "./input.ts";

/**
 * phase を blocked にする（route が block を返したとき、stale 検知、上限超過）。
 * このコミットも HEAD に [skip ci] を付けて push する。連鎖させないため。
 */
export function blockRun(input: CommandInput & { reason: string }): FinishResult {
  const { dir, reason, now = new Date() } = input;
  const file = readStateFile(dir);
  const result: FinishResult = {
    phase: "blocked",
    blocked_reason: reason,
    continue_chain: false,
    reason,
  };
  writeStateFile(dir, file, result, now);
  return result;
}

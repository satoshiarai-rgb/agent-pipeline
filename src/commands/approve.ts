import type { Config } from "../defaults.ts";
import { readStateFile, writeStateFile } from "../file/state-file.ts";
import type { Phase } from "../types.ts";
import { type HumanDecision, humanTransition } from "./human-transition.ts";
import type { CommandInput } from "./input.ts";

/** 人間の /approve コメントによる遷移（awaiting_human → developing） */
function approve(input: { phase: Phase; association: string; config: Config }): HumanDecision {
  return humanTransition({ ...input, event: "approval" });
}

/** 人間の /approve による遷移（approve.yml） */
export function approveRun(
  input: CommandInput & { association: string },
): { ok: true; phase: Phase } | { ok: false; reason: string } {
  const { dir, association, config, now = new Date() } = input;
  const file = readStateFile(dir);
  const decision = approve({ phase: file.phase, association, config });
  if (!decision.ok) return decision;
  writeStateFile(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return decision;
}

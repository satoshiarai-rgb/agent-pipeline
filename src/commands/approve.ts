import type { Config, Phase } from "../types.ts";
import { humanTransition, type HumanDecision } from "./human-transition.ts";

/** 人間の /approve コメントによる遷移（awaiting_human → developing） */
export function approve(input: {
  phase: Phase;
  association: string;
  config: Config;
}): HumanDecision {
  return humanTransition({ ...input, event: "approval" });
}

import type { Phase } from "../types.ts";
import type { Config } from "../utils/load-config.ts";
import { type HumanDecision, humanTransition } from "./human-transition.ts";

/** 人間の /approve コメントによる遷移（awaiting_human → developing） */
export function approve(input: {
  phase: Phase;
  association: string;
  config: Config;
}): HumanDecision {
  return humanTransition({ ...input, event: "approval" });
}

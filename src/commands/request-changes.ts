import type { Phase } from "../types.ts";
import type { Config } from "../utils/load-config.ts";
import { type HumanDecision, humanTransition } from "./human-transition.ts";

/**
 * 人間の /request-changes コメントによる差し戻し（awaiting_human → planning）。
 * コメント本文はレビューファイルとして残し、planner が次回それを読む（設計書 §3.2）。
 * 差し戻し自体はレコードを作らないため total_steps は増えないが、
 * 戻った先のエージェント実行は通常どおり数える。
 */
export function requestChanges(input: {
  phase: Phase;
  association: string;
  config: Config;
}): HumanDecision {
  return humanTransition({ ...input, event: "request_changes" });
}

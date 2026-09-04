import type { Config } from "../defaults.ts";
import { saveReview } from "../file/review-file.ts";
import { readStateFile, writeStateFile } from "../file/state-file.ts";
import { reviewKindFor } from "../transitions.ts";
import type { Phase } from "../types.ts";
import { type HumanDecision, humanTransition } from "./human-transition.ts";
import type { CommandInput } from "./input.ts";

/**
 * 人間の /request-changes コメントによる差し戻し（awaiting_human → planning）。
 * コメント本文はレビューファイルとして残し、planner が次回それを読む（設計書 §3.2）。
 * 差し戻し自体はレコードを作らないため total_steps は増えないが、
 * 戻った先のエージェント実行は通常どおり数える。
 */
function requestChanges(input: {
  phase: Phase;
  association: string;
  config: Config;
}): HumanDecision {
  return humanTransition({ ...input, event: "request_changes" });
}

/**
 * 人間の /request-changes による差し戻し（approve.yml）。
 * コメント本文を人間のレビューとして reviews/ に残すため、planner が次回それを読める。
 * ここを通らずに phase を手で戻すと、planner は何を直すべきか分からないまま再走する。
 */
export function requestChangesRun(
  input: CommandInput & { association: string; body: string },
): { ok: true; phase: Phase; review_path: string } | { ok: false; reason: string } {
  const { dir, association, body, config, now = new Date() } = input;
  const file = readStateFile(dir);
  const decision = requestChanges({ phase: file.phase, association, config });
  if (!decision.ok) return decision;

  // レビュー種別は遷移表が持つ（awaiting_human なら計画）
  const kind = reviewKindFor(file.phase, config) ?? "plan";
  const review_path = saveReview({
    dir,
    kind,
    verdict: "request_changes",
    reviewer: `human:${association}`,
    body,
  });
  writeStateFile(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return { ...decision, review_path };
}

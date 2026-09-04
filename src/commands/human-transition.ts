import type { Config } from "../defaults.ts";
import { nextPhase } from "../transitions.ts";
import type { Phase } from "../types.ts";

export type HumanDecision = { ok: true; phase: Phase } | { ok: false; reason: string };

/**
 * 人間のコメントによる遷移の共通処理。
 * 遷移先は遷移表が持ち、認可はここで見る（入口でのみ認可する / 設計書 §7.3）。
 */
export function humanTransition(input: {
  phase: Phase;
  /** コメント投稿者の author_association */
  association: string;
  config: Config;
  event: "approval" | "request_changes";
}): HumanDecision {
  const { phase, association, config, event } = input;
  if (!config.approvers.includes(association)) {
    return { ok: false, reason: `not_authorized: ${association}` };
  }
  const next = nextPhase(phase, event, config);
  // 対象外のフェーズでのコメントは何もしない（取り違えを黙って進めない）
  if (!next) return { ok: false, reason: `not_awaiting_approval: phase=${phase}` };
  return { ok: true, phase: next };
}

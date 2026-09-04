import { isTerminal, nextPhase, roundKeyFor } from "../state.ts";
import type { Config, FinishResult, Outcome, Phase, RunRecord } from "../types.ts";
import { deriveRunStats } from "../utils/derive-run-stats.ts";

/**
 * エージェント実行が終わったあとの phase を決める。
 * 実行結果を遷移イベントに落とし、ラウンド上限を見て、遷移表を引く。
 * records には「今回の実行のレコード（finished_at 済み）」を含めて渡す。
 */
export function finish(input: {
  phase: Phase;
  records: RunRecord[];
  config: Config;
  outcome: Outcome;
}): FinishResult {
  const { phase, records, config, outcome } = input;

  const blocked = (reason: string): FinishResult => ({
    phase: "blocked",
    blocked_reason: reason,
    continue_chain: false,
    reason,
  });
  const advance = (event: Parameters<typeof nextPhase>[1], reason: string): FinishResult => {
    const next = nextPhase(phase, event, config);
    // 遷移表に行き先が無いのは設定の壊れ。静かに undefined を書かず blocked にする
    if (!next) return blocked(`transition_incomplete: ${phase} (${event})`);
    return { phase: next, blocked_reason: null, continue_chain: !isTerminal(next), reason };
  };

  // 1. 実行そのものの失敗（API エラーは設定ミスと区別できるようステータスを残す / A-31）
  if (outcome.result === "api_error") {
    return blocked(`api_error:${outcome.api_error_status ?? "unknown"}`);
  }
  if (outcome.result !== "ok") {
    return blocked(outcome.result === "invalid" ? "invalid_artifacts" : outcome.result);
  }
  if (outcome.oversize) return blocked("oversize: issue の分割が必要");

  // 2. レビューのフェーズ: verdict を遷移イベントに落とし、差し戻しはラウンド上限を見る
  const roundKey = roundKeyFor(phase, config);
  if (roundKey) {
    if (outcome.verdict === "approve") return advance("approve", "approve");
    if (outcome.verdict === "request_changes") {
      const used = deriveRunStats(records).rounds[roundKey];
      const limit =
        roundKey === "plan_review"
          ? config.limits.plan_review_rounds
          : config.limits.dev_review_rounds;
      if (used >= limit) return blocked(`${roundKey}_rounds_exceeded: ${used}/${limit}`);
      return advance("request_changes", `request_changes (${used}/${limit})`);
    }
    return blocked("missing_verdict");
  }

  // 3. completing: acceptance.yml が全 passed かで分岐
  if (nextPhase(phase, "pass", config)) {
    return outcome.acceptance_passed
      ? advance("pass", "acceptance_passed")
      : blocked("acceptance_not_passed");
  }

  // 4. それ以外は成功でそのまま進む
  return advance("ok", "ok");
}

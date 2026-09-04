import type { Config } from "../defaults.ts";
import type { RunRecord } from "../run-record.ts";
import { isTerminal, nextPhase, roundKeyFor } from "../transitions.ts";
import type { Phase, RunResult, Verdict } from "../types.ts";
import { deriveRunStats } from "../utils/derive-run-stats.ts";

/**
 * エージェント実行 1 回の結果。commands/validate（未実装）と base-action の
 * execution_file から組み立て、finish に渡す。
 */
export interface Outcome {
  result: RunResult;
  verdict?: Verdict | null;
  /** planner の規模判定が上限超過 */
  oversize?: boolean;
  /** completing で acceptance.json が全 passed だったか */
  acceptance_passed?: boolean;
  /** A-31: 設定ミスとエージェントの失敗を区別するために残す */
  api_error_status?: number | null;
}

export interface FinishResult {
  phase: Phase;
  blocked_reason: string | null;
  /**
   * false なら finalize は HEAD コミットに [skip ci] を付けて連鎖を止める
   * （[skip ci] の判定は push の HEAD コミットに対して行われる。V-5 実測 / A-36）
   */
  continue_chain: boolean;
  reason: string;
}

/** 停止する。blocked は終端なので連鎖させない */
function blocked(reason: string): FinishResult {
  return { phase: "blocked", blocked_reason: reason, continue_chain: false, reason };
}

/** 遷移表を引いて次の phase へ進む。行き先が無いのは設定の壊れなので blocked にする */
function advance(
  phase: Phase,
  event: Parameters<typeof nextPhase>[1],
  config: Config,
  reason: string,
): FinishResult {
  const next = nextPhase(phase, event, config);
  if (!next) return blocked(`transition_incomplete: ${phase} (${event})`);
  return { phase: next, blocked_reason: null, continue_chain: !isTerminal(next), reason };
}

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

  // 1. 実行そのものの失敗（API エラーは設定ミスと区別できるようステータスを残す / A-31）
  if (outcome.result === "api_error") {
    return blocked(`api_error:${outcome.api_error_status ?? "unknown"}`);
  }
  if (outcome.result === "invalid") return blocked("invalid_artifacts");
  if (outcome.result === "agent_failed") return blocked("agent_failed");
  if (outcome.oversize) return blocked("oversize: issue の分割が必要");

  // 2. レビューのフェーズ: verdict を遷移イベントに落とし、差し戻しはラウンド上限を見る
  const roundKey = roundKeyFor(phase, config);
  if (roundKey) {
    if (outcome.verdict === "approve") return advance(phase, "approve", config, "approve");
    if (outcome.verdict !== "request_changes") return blocked("missing_verdict");

    const used = deriveRunStats(records).rounds[roundKey];
    const limit = config.limits[`${roundKey}_rounds`];
    if (used >= limit) return blocked(`${roundKey}_rounds_exceeded: ${used}/${limit}`);
    return advance(phase, "request_changes", config, `request_changes (${used}/${limit})`);
  }

  // 3. completing: acceptance.json が全 passed かで分岐
  const canPass = nextPhase(phase, "pass", config) !== null;
  if (canPass && !outcome.acceptance_passed) return blocked("acceptance_not_passed");
  if (canPass) return advance(phase, "pass", config, "acceptance_passed");

  // 4. それ以外は成功でそのまま進む
  return advance(phase, "ok", config, "ok");
}

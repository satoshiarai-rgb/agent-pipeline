import type { Phase, RunResult } from "../types.ts";
import type { Action } from "../utils/typescript-fsa.ts";
import {
  type AppPayload,
  agentFailed,
  completed,
  devReviewed,
  implemented,
  planned,
  planReviewed,
} from "./store/app/actions.ts";
import { transitionIncomplete } from "./store/app/reducer.ts";

/**
 * エージェント実行 1 回の結果（`validate` の出力）を action に写す。
 * store の外（成果物の検証）と store の境界にあたる。
 *
 * **どのフェーズが走っていたかで action が決まる**（エージェントの終了は
 * フェーズごとに別の action / K-26）。フェーズは状態が持っているので、
 * 呼び出し側（`redux/commands.ts`）が渡す。
 */
export interface Outcome {
  result: RunResult;
  verdict?: Verdict | null;
  /** planner の規模判定が上限超過。止めずに PR へ警告を出すために使う（K-21） */
  oversize?: boolean;
  /** completing で acceptance.json が全 passed だったか */
  acceptance_passed?: boolean;
  /** A-31: 設定ミスとエージェントの失敗を区別するために残す */
  api_error_status?: number | null;
  /** invalid のとき、何が契約を満たしていないか（人間が原因を追えるように） */
  detail?: string;
}

import type { Verdict } from "../types.ts";

/** action に必ず載る「いつ・誰が」と、どの実行か */
interface Context {
  timestamp: string;
  by: string;
  run_id: string;
  attempt: number;
  session_id?: string | null;
}

/**
 * 失敗の理由の文字列。**移行前の `blocked_reason` と 1 文字も違わない**
 * （`explain` の案内・`docs/troubleshooting.md` の表・プロンプトが依存している）。
 */
const FAILURE_REASON: Record<RunResult, (outcome: Outcome) => string> = {
  api_error: (outcome) => `api_error:${outcome.api_error_status ?? "unknown"}`,
  invalid: (outcome) => {
    if (outcome.detail) return `invalid_artifacts: ${outcome.detail}`;
    return "invalid_artifacts";
  },
  agent_failed: () => "agent_failed",
  ok: () => "agent_failed",
};

/** フェーズごとの「成功したときの action」 */
const SUCCESS: Partial<Record<Phase, (outcome: Outcome, context: Context) => Action<AppPayload>>> =
  {
    planning: (_outcome, context) => planned(context),
    developing: (_outcome, context) => implemented(context),
    completing: (outcome, context) =>
      completed({ ...context, acceptance_passed: outcome.acceptance_passed ?? false }),
    plan_review: (outcome, context) =>
      planReviewed({ ...context, verdict: outcome.verdict as Verdict }),
    dev_review: (outcome, context) =>
      devReviewed({ ...context, verdict: outcome.verdict as Verdict }),
  };

/** レビューのフェーズは verdict が無いと遷移を決められない（frontmatter の欠落） */
const NEEDS_VERDICT: Partial<Record<Phase, true>> = { plan_review: true, dev_review: true };

export function fromOutcome(outcome: Outcome, context: Context, phase: Phase): Action<AppPayload> {
  if (outcome.result !== "ok") {
    return agentFailed({
      ...context,
      reason: FAILURE_REASON[outcome.result](outcome),
      api_error_status: outcome.api_error_status ?? null,
    });
  }
  if (NEEDS_VERDICT[phase] && !outcome.verdict) {
    return agentFailed({ ...context, reason: "missing_verdict" });
  }
  const success = SUCCESS[phase];
  if (!success) {
    return agentFailed({ ...context, reason: transitionIncomplete(phase, "ok") });
  }
  return success(outcome, context);
}

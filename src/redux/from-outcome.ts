import type { Phase, RunResult, Verdict } from "../types.ts";
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
  /**
   * planner の規模判定が上限超過。**`validate` の出力としてワークフローが読み**、
   * PR に警告コメントを出す（K-21）。状態は変えないので store には渡らない
   */
  oversize?: boolean;
  /** completing で acceptance.json が全 passed だったか */
  acceptance_passed?: boolean;
  /** A-31: 設定ミスとエージェントの失敗を区別するために残す */
  api_error_status?: number | null;
  /** invalid のとき、何が契約を満たしていないか（人間が原因を追えるように） */
  detail?: string;
}

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
const FAILURE_REASON: Record<Exclude<RunResult, "ok">, (outcome: Outcome) => string> = {
  api_error: (outcome) => `api_error:${outcome.api_error_status ?? "unknown"}`,
  invalid: (outcome) => {
    if (outcome.detail) return `invalid_artifacts: ${outcome.detail}`;
    return "invalid_artifacts";
  },
  agent_failed: () => "agent_failed",
};

export function fromOutcome(outcome: Outcome, context: Context, phase: Phase): Action<AppPayload> {
  if (outcome.result !== "ok") {
    return agentFailed({
      ...context,
      reason: FAILURE_REASON[outcome.result](outcome),
      api_error_status: outcome.api_error_status ?? null,
    });
  }

  switch (phase) {
    case "planning":
      return planned(context);
    case "developing":
      return implemented(context);
    case "completing":
      return completed({ ...context, acceptance_passed: outcome.acceptance_passed ?? false });
    // レビューのフェーズは verdict が無いと遷移を決められない（frontmatter の欠落）
    case "plan_review":
      if (!outcome.verdict) return agentFailed({ ...context, reason: "missing_verdict" });
      return planReviewed({ ...context, verdict: outcome.verdict });
    case "dev_review":
      if (!outcome.verdict) return agentFailed({ ...context, reason: "missing_verdict" });
      return devReviewed({ ...context, verdict: outcome.verdict });
    // エージェントが走らないフェーズでの成功報告（ハーネスかワークフローの壊れ）
    default:
      return agentFailed({ ...context, reason: `transition_incomplete: ${phase} (ok)` });
  }
}

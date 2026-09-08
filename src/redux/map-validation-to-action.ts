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
 * `validate` が出す「1 回の実行の検証結果」。成果物（`plan.md` / `acceptance.json` /
 * `reviews/*.md` / 実行ログ / 差分）を契約（`work/agent-contract.md` §4）に照らした結果で、
 * ワークフローが CLI の引数として `finish` に渡す。
 */
export interface ValidationReport {
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
const FAILURE_REASON: Record<Exclude<RunResult, "ok">, (report: ValidationReport) => string> = {
  api_error: (report) => `api_error:${report.api_error_status ?? "unknown"}`,
  invalid: (report) => {
    if (report.detail) return `invalid_artifacts: ${report.detail}`;
    return "invalid_artifacts";
  },
  agent_failed: () => "agent_failed",
};

/**
 * 検証結果を action に写す。**決めるのに使うのは検証結果と、そのとき走っていた phase**
 * の 2 つ。成功はフェーズごとに別の action になり（K-26）、失敗は phase を問わず
 * `agentFailed` になる。phase は状態が持っているので呼び出し側（`redux/commands.ts`）が渡す。
 */
export function mapValidationToAction(
  report: ValidationReport,
  phase: Phase,
  context: Context,
): Action<AppPayload> {
  if (report.result !== "ok") {
    return agentFailed({
      ...context,
      reason: FAILURE_REASON[report.result](report),
      api_error_status: report.api_error_status ?? null,
    });
  }

  switch (phase) {
    case "planning":
      return planned(context);
    case "developing":
      return implemented(context);
    case "completing":
      return completed({ ...context, acceptance_passed: report.acceptance_passed ?? false });
    // レビューのフェーズは verdict が無いと遷移を決められない（frontmatter の欠落）
    case "plan_review":
      if (!report.verdict) return agentFailed({ ...context, reason: "missing_verdict" });
      return planReviewed({ ...context, verdict: report.verdict });
    case "dev_review":
      if (!report.verdict) return agentFailed({ ...context, reason: "missing_verdict" });
      return devReviewed({ ...context, verdict: report.verdict });
    // エージェントが走らないフェーズでの成功報告（ハーネスかワークフローの壊れ）
    default:
      return agentFailed({ ...context, reason: `transition_incomplete: ${phase} (ok)` });
  }
}

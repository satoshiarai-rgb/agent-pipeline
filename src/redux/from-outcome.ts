import type { RunResult, Verdict } from "../types.ts";
import type { Action } from "../utils/typescript-fsa.ts";
import { type AppPayload, agentFailed, agentOk, review } from "./store/app/actions.ts";

/**
 * エージェント実行 1 回の結果（`validate` の出力）を action に写す。
 * store の外（成果物の検証）と store の境界にあたる。
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

/** action に必ず載る「いつ・誰が」と、どの実行か */
interface Context {
  timestamp: string;
  by: string;
  run_id: string;
  attempt: number;
  session_id?: string | null;
}

/**
 * `result` ごとの写像表。**失敗の理由の文字列は移行前の `blocked_reason` と 1 文字も違わない**
 * （`explain` の案内・`docs/troubleshooting.md` の表・プロンプトがこの文字列に依存する）。
 *
 * `ok` のときにレビューか否かを決めるのは `verdict` の有無だけで、
 * 「そのフェーズがレビューか」は状態が知っている（`app/reducer.ts` のルール表）。
 * verdict の無いレビューフェーズが `missing_verdict` になるのはそちらの責務。
 */
const FROM_RESULT: Record<RunResult, (o: Outcome, c: Context) => Action<AppPayload>> = {
  api_error: (o, c) =>
    agentFailed({
      ...c,
      reason: `api_error:${o.api_error_status ?? "unknown"}`,
      api_error_status: o.api_error_status ?? null,
    }),
  invalid: (o, c) =>
    agentFailed({
      ...c,
      reason: o.detail ? `invalid_artifacts: ${o.detail}` : "invalid_artifacts",
    }),
  agent_failed: (_o, c) => agentFailed({ ...c, reason: "agent_failed" }),
  ok: (o, c) =>
    o.verdict
      ? review({ ...c, verdict: o.verdict })
      : agentOk({ ...c, acceptance_passed: o.acceptance_passed ?? false }),
};

export const fromOutcome = (o: Outcome, c: Context): Action<AppPayload> =>
  FROM_RESULT[o.result](o, c);

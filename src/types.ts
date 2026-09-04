/** run の状態。ラベルの射影で列挙するため実行時の配列も持つ */
export const PHASES = [
  "bootstrap",
  "planning",
  "plan_review",
  "awaiting_human",
  "developing",
  "dev_review",
  "completing",
  "done",
  "blocked",
] as const;

export type Phase = (typeof PHASES)[number];

export type AgentName = "planner" | "plan-reviewer" | "developer" | "dev-reviewer" | "completion";

export type Verdict = "approve" | "request_changes";
export type RoundKey = "plan_review" | "dev_review";
export type RunResult = "ok" | "invalid" | "agent_failed" | "api_error";

export type Phase =
  | "bootstrap"
  | "planning"
  | "plan_review"
  | "awaiting_human"
  | "developing"
  | "dev_review"
  | "completing"
  | "done"
  | "blocked";

export type AgentName = "planner" | "plan-reviewer" | "developer" | "dev-reviewer" | "completion";

export type Verdict = "approve" | "request_changes";
export type RoundKey = "plan_review" | "dev_review";
export type RunResult = "ok" | "invalid" | "agent_failed" | "api_error";

export type Phase =
  | "bootstrap" | "planning" | "plan_review" | "awaiting_human"
  | "developing" | "dev_review" | "completing" | "done" | "blocked";

export type AgentName =
  | "planner" | "plan-reviewer" | "developer" | "dev-reviewer" | "completion";

export type Verdict = "approve" | "request_changes";
export type RoundKey = "plan_review" | "dev_review";
export type RunResult = "ok" | "invalid" | "agent_failed" | "api_error";

/** runs/<agent>-<run_id>-<attempt>.yml。1 実行 1 ファイルの追記専用（A-33） */
export interface RunRecord {
  agent: AgentName;
  phase: Phase;
  run_id: string;
  attempt: number;
  started_at: string;
  /** null なら実行中。stale 検知の対象（A-14） */
  finished_at: string | null;
  result: RunResult | null;
  verdict: Verdict | null;
  model?: string | null;
  session_id?: string | null;
}

/** エージェント実行 1 回の結果。validate-artifacts と execution_file から組み立てる */
export interface Outcome {
  result: RunResult;
  verdict?: Verdict | null;
  /** planner の規模判定が上限超過 */
  oversize?: boolean;
  /** completing で acceptance.yml が全 passed だったか */
  acceptance_passed?: boolean;
  /** A-31: 設定ミスとエージェントの失敗を区別するために残す */
  api_error_status?: number | null;
}

export interface Config {
  pipeline_version: number;
  models: { default: string; reviewer: string | null };
  limits: Record<"plan_review_rounds" | "dev_review_rounds" | "total_steps" | "max_files_per_pr", number>;
  tool_profiles: Record<string, string>;
  agents: Record<AgentName, { max_turns: number; timeout_minutes: number; tools: string }>;
  approvers: string[];
  labels: { prefix: string };
  transitions: Partial<Record<Phase, {
    /** 無ければエージェントを起動しない（人間が起こす遷移） */
    agent?: AgentName;
    round_key?: RoundKey;
    on_ok?: Phase;
    on_approve?: Phase;
    on_request_changes?: Phase;
    on_pass?: Phase;
    on_fail?: Phase;
    /** 人間の承認で進む先 */
    on_approval?: Phase;
    /** 人間の差し戻しをどちらのレビューとして残すか */
    review_kind?: "plan" | "dev";
  }>>;
}

export interface RouteResult {
  /** run=実行する / none=何もしない / block=phase を blocked に書く必要がある */
  action: "run" | "none" | "block";
  reason: string;
  phase: Phase;
  total_steps: number;
  rounds: Record<RoundKey, number>;
  /** action=run のときだけ */
  run?: { agent: AgentName; model: string; max_turns: number; timeout_minutes: number; tools: string };
}

export interface FinishResult {
  phase: Phase;
  blocked_reason: string | null;
  /** false なら finalize は HEAD コミットに [skip ci] を付けて連鎖を止める（V-5 実測 / A-36） */
  continue_chain: boolean;
  reason: string;
}

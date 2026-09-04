import type { AgentName, Phase, RoundKey } from "../types.ts";
import { parseYaml } from "./parse-yaml.ts";

/** 遷移表の 1 エントリ。エージェントが起こす辺と人間が起こす辺の両方を持つ */
export interface TransitionEntry {
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
}

/** defaults.yml の内容。配布先の config.yml とのマージは Step B-5 で足す（A-19） */
export interface Config {
  pipeline_version: number;
  models: { default: string; reviewer: string | null };
  limits: Record<"plan_review_rounds" | "dev_review_rounds" | "total_steps", number>;
  tool_profiles: Record<string, string>;
  agents: Record<AgentName, { max_turns: number; timeout_minutes: number; tools: string }>;
  approvers: string[];
  transitions: Partial<Record<Phase, TransitionEntry>>;
}

export function loadConfig(text: string): Config {
  return parseYaml<Config>(text);
}

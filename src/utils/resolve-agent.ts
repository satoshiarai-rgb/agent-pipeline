import type { AgentName, Config } from "../types.ts";

/**
 * エージェントの実行パラメータを解決する。
 * ここには 2 つの方針が入っている:
 *   - tools はプロファイル名を実体に展開する（2 プロファイルに寄せた理由は A-30）
 *   - レビュアーのモデルは models.reviewer が null なら default に落とす（設計書 §3.3）
 */
export function resolveAgent(config: Config, agent: AgentName) {
  const a = config.agents[agent];
  if (!a) throw new Error(`defaults.yml に agents.${agent} がありません`);
  const tools = config.tool_profiles[a.tools];
  if (!tools) throw new Error(`tool_profiles に ${a.tools} がありません`);
  const isReviewer = agent === "plan-reviewer" || agent === "dev-reviewer";
  return {
    agent,
    model: (isReviewer ? config.models.reviewer : null) ?? config.models.default,
    max_turns: a.max_turns,
    timeout_minutes: a.timeout_minutes,
    tools,
  };
}

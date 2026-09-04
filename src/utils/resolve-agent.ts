import type { Config } from "../defaults.ts";
import type { AgentName } from "../types.ts";

/**
 * エージェントの実行パラメータを解決する。
 * ここには 3 つの方針が入っている:
 *   - tools はプロファイル名を実体に展開する（2 プロファイルに寄せた理由は A-30）
 *   - レビュアーのモデルは models.reviewer が null なら default に落とす（設計書 §3.3）
 *   - Claude Code に渡すフラグはここで組み立てる（上限とツールはハーネスの責務 / 契約 §5）
 */
export function resolveAgent(config: Config, agent: AgentName) {
  const a = config.agents[agent];
  if (!a) throw new Error(`既定値に agents.${agent} がありません`);
  const tools = config.tool_profiles[a.tools];
  if (!tools) throw new Error(`tool_profiles に ${a.tools} がありません`);
  const isReviewer = agent === "plan-reviewer" || agent === "dev-reviewer";
  const model = (isReviewer ? config.models.reviewer : null) ?? config.models.default;
  return {
    agent,
    model,
    max_turns: a.max_turns,
    timeout_minutes: a.timeout_minutes,
    tools,
    claude_args: claudeArgs({ model, max_turns: a.max_turns, tools }),
  };
}

/**
 * `claude_args` に渡すフラグ列。
 *
 * `--tools` が許可リストで、非対話実行では列挙されていないツールは拒否される（A-24）。
 * その上で、Bash を持たないプロファイルには `--disallowed-tools Bash` を重ねる
 * — 付与漏れではなく明示的な拒否にしておくため（planner と plan-reviewer は
 * 唯一の非信頼入力である issue 本文を読むので、ここは二重に塞ぐ / 契約 §5）。
 */
function claudeArgs(a: { model: string; max_turns: number; tools: string }): string {
  const denied = a.tools.split(",").includes("Bash") ? [] : ["Bash"];
  return [
    `--model ${a.model}`,
    `--max-turns ${a.max_turns}`,
    `--tools ${a.tools}`,
    ...denied.map((d) => `--disallowed-tools ${d}`),
  ].join(" ");
}

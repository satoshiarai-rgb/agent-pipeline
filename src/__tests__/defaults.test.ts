import { describe, expect, test } from "bun:test";
import { defaults } from "../defaults.ts";

describe("defaults", () => {
  test("確定した判断が値として入っている", () => {
    expect(defaults.pipeline_version).toBe(1);
    expect(defaults.models.default).toBe("claude-opus-5"); // K-3
    expect(defaults.models.reviewer).toBeNull();
    expect(defaults.limits.plan_review_rounds).toBe(3);
    expect(defaults.limits.dev_review_rounds).toBe(3);
    expect(defaults.limits.total_steps).toBe(16);
    expect(defaults.approvers).toEqual(["OWNER", "COLLABORATOR"]); // K-1
  });

  test("total_steps はラウンド上限から到達しうる最悪より大きい", () => {
    // 先に総数で止まると「どのレビューが収束しなかったか」が残らない。
    // 最悪 = (planner + plan-reviewer) * plan_review_rounds
    //      + (developer + dev-reviewer) * dev_review_rounds + completion 1 回
    const { plan_review_rounds, dev_review_rounds, total_steps } = defaults.limits;
    const worst = 2 * plan_review_rounds + 2 * dev_review_rounds + 1;
    expect(total_steps).toBeGreaterThan(worst);
  });

  test("ツールプロファイルは 2 本だけ（A-30）", () => {
    expect(Object.keys(defaults.tool_profiles)).toEqual(["readonly", "exec"]);
    expect(defaults.tool_profiles.readonly).not.toContain("Bash");
    expect(defaults.tool_profiles.exec).toContain("Bash");
  });

  test("エージェント 5 種すべてに上限とツールがある", () => {
    for (const [name, a] of Object.entries(defaults.agents)) {
      expect(a.max_turns, name).toBeGreaterThan(0);
      expect(a.timeout_minutes, name).toBeGreaterThan(0);
      expect(Object.keys(defaults.tool_profiles), name).toContain(a.tools);
    }
  });

  test("遷移表に done の辺は無い（K-10: done は終端）", () => {
    expect(Object.keys(defaults.transitions).sort()).toEqual([
      "awaiting_human",
      "completing",
      "dev_review",
      "developing",
      "plan_review",
      "planning",
    ]);
    expect(defaults.transitions.done).toBeUndefined();
  });

  test("人間が起こす辺にはエージェントが無い", () => {
    expect(defaults.transitions.awaiting_human?.agent).toBeUndefined();
    expect(defaults.transitions.awaiting_human?.on_approval).toBe("developing");
    expect(defaults.transitions.awaiting_human?.review_kind).toBe("plan");
  });
});

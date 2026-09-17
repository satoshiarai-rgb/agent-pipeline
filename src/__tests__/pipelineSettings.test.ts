import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../pipelineSettings.ts";

describe("defaultSettings", () => {
  test("確定した判断が値として入っている", () => {
    expect(defaultSettings.pipeline_version).toBe(3);
    expect(defaultSettings.models.default).toBe("claude-opus-5"); // K-3
    expect(defaultSettings.models.reviewer).toBeNull();
    expect(defaultSettings.limits.plan_review_rounds).toBe(5);
    expect(defaultSettings.limits.dev_review_rounds).toBe(5);
    expect(defaultSettings.limits.total_steps).toBe(24);
    expect(defaultSettings.approvers).toEqual(["OWNER", "COLLABORATOR"]); // K-1
  });

  test("total_steps はラウンド上限から到達しうる最悪より大きい", () => {
    // 先に総数で止まると「どのレビューが収束しなかったか」が残らない。
    // 最悪 = (planner + plan-reviewer) * plan_review_rounds
    //      + (developer + dev-reviewer) * dev_review_rounds + completion 1 回
    const { plan_review_rounds, dev_review_rounds, total_steps } = defaultSettings.limits;
    const worst = 2 * plan_review_rounds + 2 * dev_review_rounds + 1;
    expect(total_steps).toBeGreaterThan(worst);
  });

  // 4 本だけ（A-30 の趣旨は「エージェントごとに集合を変えない」こと）。
  // Task を持つのは自分の中でチームを回す 2 つ（planner の grilling とレビューチーム、
  // developer のレビューチーム / A-58）。exec と build の違いは Task の有無だけ
  test("ツールプロファイルは 4 本。書き込みと実行の境界を保つ", () => {
    expect(Object.keys(defaultSettings.tool_profiles)).toEqual([
      "readonly",
      "plan",
      "exec",
      "build",
    ]);
    expect(defaultSettings.tool_profiles.readonly).not.toContain("Bash");
    expect(defaultSettings.tool_profiles.plan).not.toContain("Bash");
    expect(defaultSettings.tool_profiles.plan).toContain("Task");
    expect(defaultSettings.tool_profiles.exec).toContain("Bash");
    expect(defaultSettings.tool_profiles.exec).not.toContain("Task");
    expect(defaultSettings.tool_profiles.build).toContain("Task");
    // Task を持つのは planner と developer だけ（レビュアーに使わない道具を見せない）
    const withTask = Object.entries(defaultSettings.agents)
      .filter(([, a]) => defaultSettings.tool_profiles[a.tools]?.includes("Task"))
      .map(([name]) => name);
    expect(withTask).toEqual(["planner", "developer"]);
  });

  test("エージェント 5 種すべてに上限とツールがある", () => {
    for (const [name, a] of Object.entries(defaultSettings.agents)) {
      expect(a.max_turns, name).toBeGreaterThan(0);
      expect(a.timeout_minutes, name).toBeGreaterThan(0);
      expect(Object.keys(defaultSettings.tool_profiles), name).toContain(a.tools);
    }
  });
});

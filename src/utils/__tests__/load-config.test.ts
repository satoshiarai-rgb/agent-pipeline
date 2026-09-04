import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";

describe("loadConfig", () => {
  test("defaults.yml を読める", () => {
    const c = config();
    expect(c.pipeline_version).toBe(1);
    expect(c.models.default).toBe("claude-opus-5");
    expect(c.models.reviewer).toBeNull();
    expect(c.limits.total_steps).toBe(12);
    expect(c.approvers).toEqual(["OWNER", "COLLABORATOR"]);
  });

  test("遷移表と 2 つのツールプロファイルを持っている", () => {
    const c = config();
    expect(Object.keys(c.transitions).sort()).toEqual([
      "awaiting_human",
      "completing",
      "dev_review",
      "developing",
      "plan_review",
      "planning",
    ]);
    expect(Object.keys(c.tool_profiles)).toEqual(["readonly", "exec"]);
  });
});

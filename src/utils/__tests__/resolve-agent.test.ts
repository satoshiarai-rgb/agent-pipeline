import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { resolveAgent } from "../resolve-agent.ts";

describe("resolveAgent", () => {
  const c = config();

  test("tool_profiles を実体に展開する", () => {
    expect(resolveAgent(c, "planner").tools).toBe("Read,Glob,Grep,Write");
    expect(resolveAgent(c, "developer").tools).toBe("Read,Glob,Grep,Write,Edit,Bash");
  });

  test("reviewer が null なら default モデルを使う", () => {
    expect(resolveAgent(c, "plan-reviewer").model).toBe("claude-opus-5");
  });

  test("reviewer を指定すればレビュアーだけモデルが変わる", () => {
    const r = config().models;
    const c2 = { ...c, models: { ...r, reviewer: "claude-sonnet-5" } };
    expect(resolveAgent(c2, "plan-reviewer").model).toBe("claude-sonnet-5");
    expect(resolveAgent(c2, "developer").model).toBe("claude-opus-5");
  });

  test("defaults.yml は 5 エージェントと上限を定義している", () => {
    for (const n of [
      "planner",
      "plan-reviewer",
      "developer",
      "dev-reviewer",
      "completion",
    ] as const) {
      expect(() => resolveAgent(c, n)).not.toThrow();
    }
    expect(c.limits.total_steps).toBe(12);
    expect(resolveAgent(c, "developer").max_turns).toBe(40);
  });
});

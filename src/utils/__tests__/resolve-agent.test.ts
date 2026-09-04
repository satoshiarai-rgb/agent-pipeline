import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { resolveAgent } from "../resolve-agent.ts";

const AGENTS = ["planner", "plan-reviewer", "developer", "dev-reviewer", "completion"] as const;

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

  test("job のタイムアウトはエージェントの上限 + 10 分（式で加算できないため）", () => {
    // GitHub の式には算術演算子が無いので、ワークフロー側では計算しない
    expect(resolveAgent(c, "developer").job_timeout_minutes).toBe(55);
    expect(resolveAgent(c, "plan-reviewer").job_timeout_minutes).toBe(25);
  });

  test("claude_args は上限とツールをフラグ列にする", () => {
    // --tools（使える状態にする）と --allowed-tools（確認を求めない）は別の指定で、
    // 後者が無いと非対話実行では書き込みが拒否される（実機で確認 / A-24）
    expect(resolveAgent(c, "developer").claude_args).toBe(
      "--model claude-opus-5 --max-turns 40" +
        " --tools Read,Glob,Grep,Write,Edit,Bash" +
        " --allowed-tools Read,Glob,Grep,Write,Edit,Bash",
    );
  });

  test("使えるツールと確認を免除するツールは同じ集合", () => {
    for (const n of AGENTS) {
      const { claude_args, tools } = resolveAgent(c, n);
      expect(claude_args, n).toContain(`--tools ${tools}`);
      expect(claude_args, n).toContain(`--allowed-tools ${tools}`);
    }
  });

  test("Bash を持たないプロファイルには --disallowed-tools を重ねる（A-24）", () => {
    // 付与リストから漏らすのではなく明示的に拒否する。issue 本文を読む 2 つだけが対象
    for (const n of ["planner", "plan-reviewer"] as const) {
      expect(resolveAgent(c, n).claude_args).toContain("--disallowed-tools Bash");
    }
    for (const n of ["developer", "dev-reviewer", "completion"] as const) {
      expect(resolveAgent(c, n).claude_args).not.toContain("--disallowed-tools");
    }
  });

  test("defaults は 5 エージェントと上限を定義している", () => {
    for (const n of [
      "planner",
      "plan-reviewer",
      "developer",
      "dev-reviewer",
      "completion",
    ] as const) {
      expect(() => resolveAgent(c, n)).not.toThrow();
    }
    expect(c.limits.total_steps).toBe(24);
    expect(resolveAgent(c, "developer").max_turns).toBe(40);
  });
});

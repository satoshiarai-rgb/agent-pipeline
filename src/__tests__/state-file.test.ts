import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyStateFile, checkPipelineVersion, parseStateFile } from "../state-file.ts";
import { config } from "./helpers.ts";

const stateYaml = `# この run の状態。復旧するときは phase を書き換えて push する
pipeline_version: 1
issue: 123
branch: claude/issue-123

# bootstrap | planning | plan_review | awaiting_human | developing
# | dev_review | completing | done | blocked
phase: planning
blocked_reason: null
`;

describe("parseStateFile", () => {
  test("識別子と phase を分けて返す", () => {
    const f = parseStateFile(stateYaml);
    expect(f.phase).toBe("planning");
    expect(f.blocked_reason).toBeNull();
    expect(f.meta).toEqual({
      pipeline_version: 1,
      issue: 123,
      branch: "claude/issue-123",
      updated_at: null,
    });
  });

  test("issue か phase が無ければエラー", () => {
    expect(() => parseStateFile("issue: 1\n")).toThrow(/issue か phase/);
    expect(() => parseStateFile("phase: planning\n")).toThrow(/issue か phase/);
  });
});

describe("applyStateFile", () => {
  test("phase を書き換えてもコメントとキー順が保持される（人間が編集するファイル）", () => {
    const out = applyStateFile(parseStateFile(stateYaml).doc, {
      phase: "plan_review",
      blocked_reason: null,
      now: new Date("2026-09-04T10:22:00Z"),
    });
    expect(out).toContain("# この run の状態");
    expect(out).toContain("# bootstrap | planning");
    expect(out).toContain("phase: plan_review");
    expect(out).toContain("updated_at: 2026-09-04T10:22:00Z");
    expect(out.indexOf("issue:")).toBeLessThan(out.indexOf("phase:"));
  });

  test("blocked_reason を書ける", () => {
    const out = applyStateFile(parseStateFile(stateYaml).doc, {
      phase: "blocked",
      blocked_reason: "total_steps_exceeded: 12/12",
      now: new Date(),
    });
    expect(out).toContain('blocked_reason: "total_steps_exceeded: 12/12"');
  });
});

describe("checkPipelineVersion", () => {
  test("一致すれば null", () => {
    expect(checkPipelineVersion(parseStateFile(stateYaml).meta, config())).toBeNull();
  });

  test("不一致なら理由を返す（中央の破壊的変更から進行中の run を守る）", () => {
    const meta = { ...parseStateFile(stateYaml).meta, pipeline_version: 2 };
    expect(checkPipelineVersion(meta, config())).toContain(
      "pipeline_version_mismatch: run=2 harness=1",
    );
  });
});

describe("templates/state.yml（bootstrap が使う雛形）", () => {
  const text = readFileSync(join(import.meta.dir, "../../templates/state.yml"), "utf8");
  const file = parseStateFile(text);

  test("雛形は planning から始まる", () => {
    expect(file.phase).toBe("planning");
    expect(file.blocked_reason).toBeNull();
  });

  test("雛形の pipeline_version はハーネスと一致する", () => {
    expect(checkPipelineVersion(file.meta, config())).toBeNull();
  });

  test("導出する値は保存されていない（A-33 / A-16）", () => {
    for (const key of ["total_steps:", "rounds:", "pr:", "last_run:"]) {
      expect(text).not.toContain(`\n${key}`);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPipelineVersion, parseStateFile, renderStateFile } from "../state-file.ts";
import { config } from "./helpers.ts";

const stateJson = JSON.stringify(
  {
    pipeline_version: 1,
    issue: 123,
    branch: "claude/issue-123",
    phase: "planning",
    blocked_reason: null,
    updated_at: null,
  },
  null,
  2,
);

describe("parseStateFile", () => {
  test("識別子と phase を分けて返す", () => {
    const f = parseStateFile(stateJson);
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
    expect(() => parseStateFile('{"issue": 1}')).toThrow(/issue か phase/);
    expect(() => parseStateFile('{"phase": "planning"}')).toThrow(/issue か phase/);
  });

  test("壊れた JSON はファイル名を添えて失敗する", () => {
    expect(() => parseStateFile("{ phase: planning }")).toThrow(/state\.json の解析に失敗/);
  });
});

describe("renderStateFile", () => {
  test("phase と updated_at を書き換え、キー順は固定する", () => {
    const out = renderStateFile(parseStateFile(stateJson), {
      phase: "plan_review",
      blocked_reason: null,
      now: new Date("2026-09-04T10:22:00Z"),
    });
    expect(JSON.parse(out)).toEqual({
      pipeline_version: 1,
      issue: 123,
      branch: "claude/issue-123",
      phase: "plan_review",
      blocked_reason: null,
      updated_at: "2026-09-04T10:22:00Z",
    });
    // 差分を安定させるためキー順を固定している
    expect(Object.keys(JSON.parse(out))).toEqual([
      "pipeline_version",
      "issue",
      "branch",
      "phase",
      "blocked_reason",
      "updated_at",
    ]);
    expect(out.endsWith("\n")).toBe(true);
  });

  test("blocked_reason を書ける", () => {
    const out = renderStateFile(parseStateFile(stateJson), {
      phase: "blocked",
      blocked_reason: "total_steps_exceeded: 12/12",
      now: new Date(),
    });
    expect(JSON.parse(out).blocked_reason).toBe("total_steps_exceeded: 12/12");
  });
});

describe("checkPipelineVersion", () => {
  test("一致すれば null", () => {
    expect(checkPipelineVersion(parseStateFile(stateJson).meta, config())).toBeNull();
  });

  test("不一致なら理由を返す（中央の破壊的変更から進行中の run を守る）", () => {
    const meta = { ...parseStateFile(stateJson).meta, pipeline_version: 2 };
    expect(checkPipelineVersion(meta, config())).toContain(
      "pipeline_version_mismatch: run=2 harness=1",
    );
  });
});

describe("templates/state.json（bootstrap が使う雛形）", () => {
  const text = readFileSync(join(import.meta.dir, "../../templates/state.json"), "utf8");
  const file = parseStateFile(text);

  test("雛形は planning から始まる", () => {
    expect(file.phase).toBe("planning");
    expect(file.blocked_reason).toBeNull();
  });

  test("雛形の pipeline_version はハーネスと一致する", () => {
    expect(checkPipelineVersion(file.meta, config())).toBeNull();
  });

  test("導出する値は保存されていない（A-33 / A-16）", () => {
    const keys = Object.keys(JSON.parse(text));
    for (const key of ["total_steps", "rounds", "pr", "last_run"]) {
      expect(keys).not.toContain(key);
    }
  });
});

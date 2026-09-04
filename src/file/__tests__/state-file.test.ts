import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import {
  checkPipelineVersion,
  readStateFile,
  stateFilePath,
  writeStateFile,
} from "../state-file.ts";

afterEach(cleanupRuns);

describe("readStateFile", () => {
  test("識別子と phase を分けて返す", () => {
    const f = readStateFile(makeRun());
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
    const dir = makeRun();
    writeFileSync(stateFilePath(dir), '{"issue": 1}');
    expect(() => readStateFile(dir)).toThrow(/issue か phase/);
    writeFileSync(stateFilePath(dir), '{"phase": "planning"}');
    expect(() => readStateFile(dir)).toThrow(/issue か phase/);
  });

  test("壊れた JSON はファイル名を添えて失敗する", () => {
    const dir = makeRun();
    writeFileSync(stateFilePath(dir), "{ phase: planning }");
    expect(() => readStateFile(dir)).toThrow(/state\.json の解析に失敗/);
  });
});

describe("writeStateFile", () => {
  test("phase と updated_at を書き換え、識別子とキー順は保つ", () => {
    const dir = makeRun();
    writeStateFile(
      dir,
      readStateFile(dir),
      { phase: "plan_review", blocked_reason: null },
      new Date("2026-09-04T10:22:00Z"),
    );
    const written = JSON.parse(readFileSync(stateFilePath(dir), "utf8"));
    expect(written).toEqual({
      pipeline_version: 1,
      issue: 123,
      branch: "claude/issue-123",
      phase: "plan_review",
      blocked_reason: null,
      updated_at: "2026-09-04T10:22:00Z",
    });
    // 差分を安定させるためキー順を固定している
    expect(Object.keys(written)).toEqual([
      "pipeline_version",
      "issue",
      "branch",
      "phase",
      "blocked_reason",
      "updated_at",
    ]);
  });

  test("blocked_reason を書ける", () => {
    const dir = makeRun();
    writeStateFile(
      dir,
      readStateFile(dir),
      { phase: "blocked", blocked_reason: "total_steps_exceeded: 12/12" },
      new Date(),
    );
    expect(readStateFile(dir).blocked_reason).toBe("total_steps_exceeded: 12/12");
  });

  test("末尾に改行を付ける", () => {
    const dir = makeRun();
    writeStateFile(dir, readStateFile(dir), { phase: "done", blocked_reason: null }, new Date());
    expect(readFileSync(stateFilePath(dir), "utf8").endsWith("}\n")).toBe(true);
  });
});

describe("checkPipelineVersion", () => {
  test("一致すれば null", () => {
    expect(checkPipelineVersion(readStateFile(makeRun()).meta, config())).toBeNull();
  });

  test("不一致なら理由を返す（中央の破壊的変更から進行中の run を守る）", () => {
    const meta = { ...readStateFile(makeRun()).meta, pipeline_version: 2 };
    expect(checkPipelineVersion(meta, config())).toContain(
      "pipeline_version_mismatch: run=2 harness=1",
    );
  });
});

describe("templates/state.json（bootstrap が使う雛形）", () => {
  const text = readFileSync(join(import.meta.dir, "../../../templates/state.json"), "utf8");

  test("雛形は planning から始まり、導出する値を持たない（A-33 / A-16）", () => {
    const keys = Object.keys(JSON.parse(text));
    expect(JSON.parse(text).phase).toBe("planning");
    for (const key of ["total_steps", "rounds", "pr", "last_run"]) {
      expect(keys).not.toContain(key);
    }
  });

  test("雛形の pipeline_version はハーネスと一致する", () => {
    const dir = makeRun();
    writeFileSync(stateFilePath(dir), text.replace('"issue": 0', '"issue": 1'));
    expect(checkPipelineVersion(readStateFile(dir).meta, config())).toBeNull();
  });
});

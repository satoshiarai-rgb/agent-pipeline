import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord } from "../parse-record.ts";

const yaml = `agent: planner
phase: planning
run_id: "33858903691"
attempt: 1
started_at: 2026-09-04T10:00:00Z
finished_at: 2026-09-04T10:09:00Z
result: ok
verdict: null
`;

describe("parseRecord", () => {
  test("実行レコードを読める", () => {
    const r = parseRecord(yaml);
    expect(r.agent).toBe("planner");
    expect(r.run_id).toBe("33858903691");
    expect(r.result).toBe("ok");
  });

  test("finished_at が無ければ null（実行中として扱えるように）", () => {
    const r = parseRecord('agent: developer\nrun_id: "1"\nstarted_at: x\n');
    expect(r.finished_at).toBeNull();
  });

  test("agent か run_id が無ければエラー", () => {
    expect(() => parseRecord("phase: planning\n")).toThrow(/agent か run_id/);
    expect(() => parseRecord("agent: planner\n")).toThrow(/agent か run_id/);
  });
});

describe("templates/run-record.yml（雛形）", () => {
  test("実行中の状態から始まるレコードとして読める", () => {
    const r = parseRecord(
      readFileSync(join(import.meta.dir, "../../../templates/run-record.yml"), "utf8"),
    );
    expect(r.agent).toBe("planner");
    expect(r.finished_at).toBeNull();
    expect(r.result).toBeNull();
  });
});

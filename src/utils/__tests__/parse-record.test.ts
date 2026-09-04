import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord } from "../parse-record.ts";

const record = JSON.stringify(
  {
    agent: "planner",
    phase: "planning",
    run_id: "33858903691",
    attempt: 1,
    started_at: "2026-09-04T10:00:00Z",
    finished_at: "2026-09-04T10:09:00Z",
    result: "ok",
    verdict: null,
  },
  null,
  2,
);

describe("parseRecord", () => {
  test("実行レコードを読める", () => {
    const r = parseRecord(record);
    expect(r.agent).toBe("planner");
    expect(r.run_id).toBe("33858903691");
    expect(r.result).toBe("ok");
  });

  test("finished_at が無ければ null（実行中として扱えるように）", () => {
    const r = parseRecord('{"agent": "developer", "run_id": "1", "started_at": "x"}');
    expect(r.finished_at).toBeNull();
  });

  test("agent か run_id が無ければエラー", () => {
    expect(() => parseRecord('{"phase": "planning"}')).toThrow(/agent か run_id/);
    expect(() => parseRecord('{"agent": "planner"}')).toThrow(/agent か run_id/);
  });

  test("壊れた JSON は理由を添えて失敗する", () => {
    expect(() => parseRecord("{ agent: planner }")).toThrow(/実行レコード の解析に失敗/);
  });
});

describe("templates/run-record.json（雛形）", () => {
  test("実行中の状態から始まるレコードとして読める", () => {
    const r = parseRecord(
      readFileSync(join(import.meta.dir, "../../../templates/run-record.json"), "utf8"),
    );
    expect(r.agent).toBe("planner");
    expect(r.finished_at).toBeNull();
    expect(r.result).toBeNull();
  });
});

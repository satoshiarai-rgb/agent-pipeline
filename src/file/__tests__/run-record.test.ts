import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import {
  closeRecord,
  openRecord,
  readRecords,
  recordFileName,
  recordPath,
  saveRecord,
} from "../run-record.ts";

afterEach(cleanupRuns);

const opened = (agent: Parameters<typeof openRecord>[0]["agent"] = "planner") =>
  openRecord({
    agent,
    phase: "planning",
    run_id: "42",
    attempt: 1,
    model: "claude-opus-5",
    started_at: "2026-09-04T10:00:00Z",
  });

describe("openRecord", () => {
  test("結末に関わるフィールドは未定で始まる（実行中を表す）", () => {
    const r = opened();
    expect(r.finished_at).toBeNull();
    expect(r.result).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.api_error_status).toBeNull();
    expect(r.session_id).toBeNull();
  });

  test("指定した値はそのまま入る", () => {
    expect(opened().agent).toBe("planner");
    expect(opened().run_id).toBe("42");
    expect(opened().model).toBe("claude-opus-5");
  });
});

describe("closeRecord", () => {
  test("結末を書き込み、開始時の値は保つ", () => {
    const closed = closeRecord(opened("plan-reviewer"), {
      finished_at: "2026-09-04T10:05:00Z",
      result: "ok",
      verdict: "approve",
      session_id: "sess-1",
    });
    expect(closed.finished_at).toBe("2026-09-04T10:05:00Z");
    expect(closed.result).toBe("ok");
    expect(closed.verdict).toBe("approve");
    expect(closed.session_id).toBe("sess-1");
    expect(closed.started_at).toBe("2026-09-04T10:00:00Z");
    expect(closed.agent).toBe("plan-reviewer");
  });

  test("省略したフィールドは null になる（verdict はレビュアー以外では付かない）", () => {
    const closed = closeRecord(opened(), { finished_at: "x", result: "ok" });
    expect(closed.verdict).toBeNull();
    expect(closed.api_error_status).toBeNull();
  });

  test("session_id の指定が無ければ元の値を残す", () => {
    const withSession = closeRecord(opened(), {
      finished_at: "x",
      result: "ok",
      session_id: "sess-9",
    });
    expect(closeRecord(withSession, { finished_at: "y", result: "ok" }).session_id).toBe("sess-9");
  });

  test("api_error_status を残せる（設定ミスとの区別に使う / A-31）", () => {
    const closed = closeRecord(opened(), {
      finished_at: "x",
      result: "api_error",
      api_error_status: 429,
    });
    expect(closed.result).toBe("api_error");
    expect(closed.api_error_status).toBe(429);
  });
});

describe("recordFileName / recordPath", () => {
  test("エージェント・ラン ID・試行回数で決まる（並行実行でも衝突しない）", () => {
    const r = { agent: "planner", run_id: "42", attempt: 2 };
    expect(recordFileName(r)).toBe("planner-42-2.json");
    expect(recordPath("/run", r)).toBe("/run/runs/planner-42-2.json");
  });
});

describe("saveRecord / readRecords", () => {
  test("書いて読み直しても同じ値になる", () => {
    const dir = makeRun();
    const record = opened();
    const path = saveRecord(dir, record);
    expect(path).toBe(recordPath(dir, record));
    expect(readRecords(dir)).toEqual([record]);
  });

  test("runs/ が無ければ空", () => {
    expect(readRecords(makeRun())).toEqual([]);
  });

  test("名前順に読み、.json 以外は無視する", () => {
    const dir = makeRun();
    saveRecord(dir, closeRecord(opened("developer"), { finished_at: "x", result: "ok" }));
    saveRecord(dir, opened("dev-reviewer"));
    writeFileSync(join(dir, "runs", "notes.md"), "無視される");
    expect(readRecords(dir).map((r) => r.agent)).toEqual(["dev-reviewer", "developer"]);
  });

  test("キー順を固定して書く（差分を安定させる）", () => {
    const dir = makeRun();
    const path = saveRecord(dir, opened());
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")))).toEqual([
      "agent",
      "phase",
      "run_id",
      "attempt",
      "started_at",
      "finished_at",
      "result",
      "verdict",
      "api_error_status",
      "model",
      "session_id",
    ]);
  });

  test("宣言外のフィールドは落ちる（未知の値が書き戻され続けない）", () => {
    const dir = makeRun();
    const path = saveRecord(dir, opened());
    const withExtra = {
      ...JSON.parse(readFileSync(path, "utf8")),
      謎のフィールド: "残ってはいけない",
    };
    writeFileSync(path, JSON.stringify(withExtra, null, 2));
    saveRecord(dir, readRecords(dir)[0] as Parameters<typeof saveRecord>[1]);
    expect(readFileSync(path, "utf8")).not.toContain("謎のフィールド");
  });

  test("agent か run_id が無ければ読み込みで失敗する", () => {
    const dir = makeRun();
    saveRecord(dir, opened());
    writeFileSync(recordPath(dir, opened()), '{"phase": "planning"}');
    expect(() => readRecords(dir)).toThrow(/agent か run_id/);
  });

  test("壊れた JSON は理由を添えて失敗する", () => {
    const dir = makeRun();
    saveRecord(dir, opened());
    writeFileSync(recordPath(dir, opened()), "{ agent: planner }");
    expect(() => readRecords(dir)).toThrow(/実行レコード の解析に失敗/);
  });
});

describe("templates/run-record.json（雛形）", () => {
  test("実行中の状態から始まるレコードとして読める", () => {
    const dir = makeRun();
    saveRecord(dir, opened()); // runs/ を作る
    const template = readFileSync(
      join(import.meta.dir, "../../../templates/run-record.json"),
      "utf8",
    );
    writeFileSync(
      recordPath(dir, { agent: "planner", run_id: "33858903691", attempt: 1 }),
      template,
    );
    const [r] = readRecords(dir);
    expect(r?.agent).toBe("planner");
    expect(r?.finished_at).toBeNull();
    expect(r?.result).toBeNull();
  });
});

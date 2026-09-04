import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApiErrorStatus, readResultEvent } from "../execution-log.ts";

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const write = (events: unknown) => {
  dir = mkdtempSync(join(tmpdir(), "exec-log-"));
  const path = join(dir, "log.json");
  writeFileSync(path, JSON.stringify(events));
  return path;
};

describe("readResultEvent", () => {
  test("最後の result イベントを返す", () => {
    const path = write([
      { type: "system", subtype: "init" },
      { type: "result", terminal_reason: "completed", session_id: "a" },
      { type: "result", terminal_reason: "api_error", session_id: "b" },
    ]);
    expect(readResultEvent(path)?.session_id).toBe("b");
  });

  test("result が無ければ null", () => {
    expect(readResultEvent(write([{ type: "assistant" }]))).toBeNull();
  });

  test("ファイルが無ければ null", () => {
    expect(readResultEvent("/存在しない/log.json")).toBeNull();
  });

  test("壊れた JSON はファイル名を添えて失敗する", () => {
    dir = mkdtempSync(join(tmpdir(), "exec-log-"));
    const path = join(dir, "log.json");
    writeFileSync(path, "{ type: result }");
    expect(() => readResultEvent(path)).toThrow(/execution_file の解析に失敗/);
  });
});

describe("readApiErrorStatus", () => {
  test("terminal_reason が api_error ならステータスを返す（A-31）", () => {
    const path = write([{ type: "result", terminal_reason: "api_error", api_error_status: 429 }]);
    expect(readApiErrorStatus(path)).toBe(429);
  });

  test("ステータスが無ければ 0（API エラーだが番号不明）", () => {
    expect(readApiErrorStatus(write([{ type: "result", terminal_reason: "api_error" }]))).toBe(0);
  });

  test("api_error_status だけがあっても API エラーとみなす", () => {
    expect(readApiErrorStatus(write([{ type: "result", api_error_status: 404 }]))).toBe(404);
  });

  test("正常終了なら null", () => {
    expect(
      readApiErrorStatus(write([{ type: "result", terminal_reason: "completed" }])),
    ).toBeNull();
  });

  test("パスが未指定なら null（実行ログを渡さない場合）", () => {
    expect(readApiErrorStatus(null)).toBeNull();
    expect(readApiErrorStatus(undefined)).toBeNull();
  });
});

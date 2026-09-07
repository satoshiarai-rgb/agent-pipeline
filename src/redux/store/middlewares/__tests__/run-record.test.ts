import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../../../__tests__/helpers.ts";
import {
  cleanupRuns,
  makeRun,
  route,
  runOnce,
  start,
} from "../../../../__tests__/run-dir-fixture.ts";
import { type RunRecord, readRecords } from "../../../../file/run-record.ts";

const c = config();
afterEach(cleanupRuns);

/**
 * `runs/<agent>-<run_id>-<attempt>.json` を書く middleware（段取り 2 で消える）。
 * 実行の開始と結末が、いままでと同じ形でファイルに残ることを確かめる。
 */
describe("run-record middleware", () => {
  test("開始のレコードを作り、その間 route は起動しない", () => {
    const dir = makeRun();
    const { record_path } = start(dir, "planner", "100", c);
    expect(record_path).toContain("runs/planner-100-1.json");

    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.finished_at).toBeNull();
    expect(rec.phase).toBe("planning");

    const r = route(dir, c);
    expect(r.action).toBe("none");
    expect(r.reason).toContain("run_in_progress");
  });

  test("結末でレコードを閉じる（result / verdict / session_id を書く）", () => {
    const dir = makeRun("plan_review");
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" }, c);
    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.finished_at).not.toBeNull();
    expect(rec.result).toBe("ok");
    expect(rec.verdict).toBe("approve");
    expect(rec.session_id).toBe(`sess-${rec.run_id}`);
  });

  test("API エラーはステータスを残す（設定ミスと実行の失敗を区別する / A-31）", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "api_error", api_error_status: 429 }, c);
    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.result).toBe("api_error");
    expect(rec.api_error_status).toBe(429);
  });
});

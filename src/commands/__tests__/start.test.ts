import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import { type RunRecord, readRecords } from "../../file/run-record.ts";
import { routeRun } from "../route.ts";
import { startRun } from "../start.ts";

const c = config();
afterEach(cleanupRuns);

describe("startRun", () => {
  test("実行中のレコードを作り、その間 route は起動しない", () => {
    const dir = makeRun();
    const { record_path } = startRun({
      dir,
      config: c,
      agent: "planner",
      run_id: "100",
      attempt: 1,
      model: "claude-opus-5",
    });
    expect(record_path).toContain("runs/planner-100-1.json");

    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.finished_at).toBeNull();
    expect(rec.phase).toBe("planning");

    const r = routeRun({ dir, config: c });
    expect(r.action).toBe("none");
    expect(r.reason).toContain("run_in_progress");
  });
});

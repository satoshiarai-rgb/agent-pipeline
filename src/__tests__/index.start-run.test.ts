import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { routeRun, startRun } from "../index.ts";
import { parseRecord } from "../utils/parse-record.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun } from "./run-dir-fixture.ts";

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

    const rec = parseRecord(readFileSync(record_path, "utf8"));
    expect(rec.finished_at).toBeNull();
    expect(rec.phase).toBe("planning");

    const r = routeRun({ dir, config: c });
    expect(r.action).toBe("none");
    expect(r.reason).toContain("run_in_progress");
  });
});

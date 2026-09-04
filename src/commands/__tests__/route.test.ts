import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import { routeRun } from "../route.ts";

const c = config();
afterEach(cleanupRuns);

describe("routeRun", () => {
  test("planning では planner を起動する", () => {
    const r = routeRun({ dir: makeRun(), config: c });
    expect(r.action).toBe("run");
    expect(r.run?.agent).toBe("planner");
  });

  test("pipeline_version が合わなければ block", () => {
    const dir = makeRun();
    const p = join(dir, "state.json");
    const state = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify({ ...state, pipeline_version: 2 }, null, 2));
    const r = routeRun({ dir, config: c });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("pipeline_version_mismatch");
  });
});

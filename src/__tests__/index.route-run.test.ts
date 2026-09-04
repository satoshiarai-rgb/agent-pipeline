import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { routeRun } from "../index.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun } from "./run-dir-fixture.ts";

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
    const p = join(dir, "state.yml");
    writeFileSync(p, readFileSync(p, "utf8").replace("pipeline_version: 1", "pipeline_version: 2"));
    const r = routeRun({ dir, config: c });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("pipeline_version_mismatch");
  });
});

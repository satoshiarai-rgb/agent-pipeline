import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { blockRun } from "../index.ts";
import { parseRecord } from "../utils/parse-record.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "./run-dir-fixture.ts";

const c = config();
afterEach(cleanupRuns);

describe("blockRun", () => {
  test("blockRun は理由を残して blocked にする", () => {
    const dir = makeRun("developing");
    blockRun({ dir, config: c, reason: "stale: started_at から 60 分経過" });
    const s = phaseOf(dir);
    expect(s.phase).toBe("blocked");
    expect(s.blocked_reason).toContain("stale");
  });
});

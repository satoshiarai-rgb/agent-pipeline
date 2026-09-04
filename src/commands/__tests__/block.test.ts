import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "../../__tests__/run-dir-fixture.ts";
import { blockRun } from "../block.ts";

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

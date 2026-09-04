import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { approveRun, blockRun } from "../index.ts";
import { parseRecord } from "../utils/parse-record.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "./run-dir-fixture.ts";

const c = config();
afterEach(cleanupRuns);

describe("approveRun", () => {
  test("awaiting_human 以外では state.yml を書き換えない", () => {
    const dir = makeRun("planning");
    const r = approveRun({ dir, config: c, association: "OWNER" });
    expect(r.ok).toBe(false);
    expect(phaseOf(dir).phase).toBe("planning");
  });

  test("認可されない association では書き換えない", () => {
    const dir = makeRun("awaiting_human");
    expect(approveRun({ dir, config: c, association: "NONE" }).ok).toBe(false);
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });
});

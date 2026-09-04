import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requestChangesRun } from "../index.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "./run-dir-fixture.ts";

const c = config();
afterEach(cleanupRuns);

describe("requestChangesRun", () => {
  test("awaiting_human では計画のレビューとして残す", () => {
    const dir = makeRun("awaiting_human");
    const r = requestChangesRun({ dir, config: c, association: "OWNER", body: "期限を明記して" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.phase).toBe("planning");
    expect(r.review_path).toContain("reviews/plan-01.md");
    const review = readFileSync(r.review_path, "utf8");
    expect(review).toContain("verdict: request_changes");
    expect(review).toContain("reviewer: human:OWNER");
    expect(phaseOf(dir).phase).toBe("planning");
  });

  test("レビュー番号は既存ファイルの次を取る", () => {
    const dir = makeRun("awaiting_human");
    requestChangesRun({ dir, config: c, association: "OWNER", body: "1 回目" });
    writeFileSync(
      join(dir, "state.yml"),
      readFileSync(join(dir, "state.yml"), "utf8").replace(
        "phase: planning",
        "phase: awaiting_human",
      ),
    );
    const r = requestChangesRun({ dir, config: c, association: "OWNER", body: "2 回目" });
    expect(r.ok && r.review_path).toContain("reviews/plan-02.md");
  });

  test("認可されない association では何も書かない", () => {
    const dir = makeRun("awaiting_human");
    expect(requestChangesRun({ dir, config: c, association: "NONE", body: "x" }).ok).toBe(false);
    expect(existsSync(join(dir, "reviews"))).toBe(false);
  });
});

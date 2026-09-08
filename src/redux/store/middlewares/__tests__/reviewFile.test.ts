import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, requestChanges } from "../../../../__tests__/runDirFixture.ts";

const c = config();
afterEach(cleanupRuns);

/**
 * 人間の差し戻し本文を `reviews/<kind>-NN.md` に残す middleware。
 * ここを通らずに phase を戻すと、planner は何を直すべきか分からないまま再走する。
 */
describe("review-file middleware", () => {
  test("コメント本文を人間のレビューとして残す", () => {
    const dir = makeRun("awaiting_human");
    const r = requestChanges(dir, "OWNER", "期限を明記して", c);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.review_path) throw new Error("review_path が返っていない");
    expect(r.review_path).toContain("reviews/plan-01.md");

    const review = readFileSync(r.review_path, "utf8");
    expect(review).toContain("verdict: request_changes");
    expect(review).toContain("reviewer: human:OWNER");
    expect(review).toContain("期限を明記して");
  });

  test("レビュー番号は既存ファイルの次を取る", () => {
    const dir = makeRun("awaiting_human");
    requestChanges(dir, "OWNER", "1 回目", c);
    // 差し戻しで planning に落ちた phase を、2 回目のために戻す
    const sp = join(dir, "state.json");
    writeFileSync(
      sp,
      JSON.stringify({ ...JSON.parse(readFileSync(sp, "utf8")), phase: "awaiting_human" }, null, 2),
    );
    const r = requestChanges(dir, "OWNER", "2 回目", c);
    expect(r.ok && r.review_path).toContain("reviews/plan-02.md");
  });
});

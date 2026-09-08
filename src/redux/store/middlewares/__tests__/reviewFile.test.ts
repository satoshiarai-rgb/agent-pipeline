import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { config } from "../../../../__tests__/helpers.ts";
import {
  cleanupRuns,
  makeRun,
  requestChanges,
  runOnce,
} from "../../../../__tests__/runDirFixture.ts";

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
    // plan-01.md は plan-reviewer の成果物。人間の差し戻しはその次の番号になる
    expect(r.review_path).toContain("reviews/plan-02.md");

    const review = readFileSync(r.review_path, "utf8");
    expect(review).toContain("verdict: request_changes");
    expect(review).toContain("reviewer: human:OWNER");
    expect(review).toContain("期限を明記して");
  });

  test("レビュー番号は既存ファイルの次を取る", () => {
    const dir = makeRun("awaiting_human");
    requestChanges(dir, "OWNER", "1 回目", c);
    // 差し戻すと planning に戻るので、もう一巡して承認待ちに戻す
    runOnce(dir, "planner", { result: "ok" }, c);
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" }, c);

    const r = requestChanges(dir, "OWNER", "2 回目", c);
    // plan-01/03 が plan-reviewer、plan-02 が 1 回目の差し戻し
    expect(r.ok && r.review_path).toContain("reviews/plan-04.md");
  });
});

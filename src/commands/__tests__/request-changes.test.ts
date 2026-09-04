import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "../../__tests__/run-dir-fixture.ts";
import { requestChangesRun } from "../request-changes.ts";
import { routeRun } from "../route.ts";

const c = config();
afterEach(cleanupRuns);

describe("requestChangesRun", () => {
  test("コメント本文を人間のレビューとして残し、planning に戻す", () => {
    const dir = makeRun("awaiting_human");
    const r = requestChangesRun({ dir, config: c, association: "OWNER", body: "期限を明記して" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.phase).toBe("planning");
    expect(r.review_path).toContain("reviews/plan-01.md");

    const review = readFileSync(r.review_path, "utf8");
    expect(review).toContain("verdict: request_changes");
    expect(review).toContain("reviewer: human:OWNER");
    expect(review).toContain("期限を明記して");
    expect(phaseOf(dir).phase).toBe("planning");
  });

  test("戻った先では planner が再走する", () => {
    const dir = makeRun("awaiting_human");
    requestChangesRun({ dir, config: c, association: "OWNER", body: "やり直し" });
    expect(routeRun({ dir, config: c }).run?.agent).toBe("planner");
  });

  test("レビュー番号は既存ファイルの次を取る", () => {
    const dir = makeRun("awaiting_human");
    requestChangesRun({ dir, config: c, association: "OWNER", body: "1 回目" });
    // 差し戻しで planning に落ちた phase を、2 回目のために戻す
    const sp = join(dir, "state.json");
    writeFileSync(
      sp,
      JSON.stringify({ ...JSON.parse(readFileSync(sp, "utf8")), phase: "awaiting_human" }, null, 2),
    );
    const r = requestChangesRun({ dir, config: c, association: "OWNER", body: "2 回目" });
    expect(r.ok && r.review_path).toContain("reviews/plan-02.md");
  });

  test("認可されない association では何も書かない", () => {
    const dir = makeRun("awaiting_human");
    expect(requestChangesRun({ dir, config: c, association: "NONE", body: "x" }).ok).toBe(false);
    expect(existsSync(join(dir, "reviews"))).toBe(false);
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });

  test("done は終端なので差し戻せない（K-10: 作り直しは新しい issue で）", () => {
    const dir = makeRun("done");
    const r = requestChangesRun({ dir, config: c, association: "OWNER", body: "直して" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("not_awaiting_approval: phase=done");
    expect(existsSync(join(dir, "reviews"))).toBe(false);
  });
});

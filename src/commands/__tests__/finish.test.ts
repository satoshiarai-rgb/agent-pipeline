import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, phaseOf, runOnce } from "../../__tests__/run-dir-fixture.ts";
import { type RunRecord, readRecords } from "../../file/run-record.ts";
import { approveRun } from "../approve.ts";
import { routeRun } from "../route.ts";

const c = config();
afterEach(cleanupRuns);

describe("finishRun: レコードの更新", () => {
  test("レコードを閉じて state.json の phase を進める", () => {
    const dir = makeRun();
    const f = runOnce(dir, "planner", { result: "ok" });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);

    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.finished_at).not.toBeNull();
    expect(rec.result).toBe("ok");
    expect(rec.session_id).toBe("sess-1");

    // 識別子は書き換えずに保つ
    expect(phaseOf(dir).meta.issue).toBe(123);
    expect(phaseOf(dir).meta.branch).toBe("claude/issue-123");
  });
});

describe("finishRun: 遷移", () => {
  test("planner が成功すれば plan_review へ", () => {
    expect(runOnce(makeRun(), "planner", { result: "ok" }).phase).toBe("plan_review");
  });

  test("approve で awaiting_human へ（連鎖は続くが dispatch が止める）", () => {
    const dir = makeRun("plan_review");
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    expect(f.phase).toBe("awaiting_human");
    expect(f.continue_chain).toBe(true);
    expect(routeRun({ dir, config: c }).action).toBe("none");
  });

  test("request_changes 1 回目は planning に戻る", () => {
    const dir = makeRun("plan_review");
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
    expect(f.phase).toBe("planning");
    expect(f.reason).toContain("1/2");
  });

  test("ラウンド上限は今回の実行を含めて数える（2 回目の差し戻しで blocked）", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" });
    expect(runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" }).phase).toBe(
      "planning",
    );
    runOnce(dir, "planner", { result: "ok" });
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain("plan_review_rounds_exceeded: 2/2");
    expect(f.continue_chain).toBe(false);
    expect(phaseOf(dir).blocked_reason).toContain("plan_review_rounds_exceeded");
  });

  test("dev_review も同じ規則で動く", () => {
    expect(
      runOnce(makeRun("dev_review"), "dev-reviewer", { result: "ok", verdict: "approve" }).phase,
    ).toBe("completing");
    expect(
      runOnce(makeRun("dev_review"), "dev-reviewer", { result: "ok", verdict: "request_changes" })
        .phase,
    ).toBe("developing");
  });

  test("verdict が無ければ blocked（frontmatter 欠落）", () => {
    const f = runOnce(makeRun("plan_review"), "plan-reviewer", { result: "ok" });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toBe("missing_verdict");
  });

  test("completing は acceptance 全 passed で done、そうでなければ blocked", () => {
    const done = runOnce(makeRun("completing"), "completion", {
      result: "ok",
      acceptance_passed: true,
    });
    expect(done.phase).toBe("done");
    expect(done.continue_chain).toBe(false); // 終端なので [skip ci] を付ける

    const ng = runOnce(makeRun("completing"), "completion", {
      result: "ok",
      acceptance_passed: false,
    });
    expect(ng.phase).toBe("blocked");
    expect(ng.blocked_reason).toBe("acceptance_not_passed");
  });
});

describe("finishRun: 停止条件", () => {
  test("API エラーはステータス付きで blocked にする（設定ミスと区別できるように）", () => {
    const f = runOnce(makeRun(), "planner", { result: "api_error", api_error_status: 429 });
    expect(f.blocked_reason).toBe("api_error:429");
    expect(f.continue_chain).toBe(false);
  });

  test("実行失敗・成果物の検証失敗・規模超過はいずれも blocked", () => {
    const cases: Array<[Parameters<typeof runOnce>[2], string]> = [
      [{ result: "agent_failed" }, "agent_failed"],
      [{ result: "invalid" }, "invalid_artifacts"],
      [{ result: "ok", oversize: true }, "oversize: issue の分割が必要"],
    ];
    for (const [outcome, reason] of cases) {
      const f = runOnce(makeRun(), "planner", outcome);
      expect(f.phase).toBe("blocked");
      expect(f.blocked_reason).toBe(reason);
      expect(f.continue_chain).toBe(false);
    }
  });

  test("遷移表に行き先が無ければ blocked にする（設定の壊れを静かに通さない）", () => {
    const broken = config();
    broken.transitions.plan_review = { agent: "plan-reviewer", round_key: "plan_review" };
    const f = runOnce(
      makeRun("plan_review"),
      "plan-reviewer",
      { result: "ok", verdict: "approve" },
      broken,
    );
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain("transition_incomplete");
  });
});

describe("finishRun: 正常系の一巡", () => {
  test("承認を挟んで done まで到達し、total_steps に収まる", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" });
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    expect(phaseOf(dir).phase).toBe("awaiting_human");

    expect(approveRun({ dir, config: c, association: "OWNER" })).toEqual({
      ok: true,
      phase: "developing",
    });
    runOnce(dir, "developer", { result: "ok" });
    runOnce(dir, "dev-reviewer", { result: "ok", verdict: "approve" });
    const last = runOnce(dir, "completion", { result: "ok", acceptance_passed: true });

    expect(last.phase).toBe("done");
    expect(last.continue_chain).toBe(false);
    const r = routeRun({ dir, config: c });
    expect(r.total_steps).toBe(5);
    expect(r.total_steps).toBeLessThanOrEqual(c.limits.total_steps);
  });
});

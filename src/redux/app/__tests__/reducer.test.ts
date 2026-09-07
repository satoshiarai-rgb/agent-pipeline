import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../../__tests__/helpers.ts";
import {
  approve,
  block,
  cleanupRuns,
  makeRun,
  phaseOf,
  requestChanges,
  route,
  runOnce,
} from "../../../__tests__/run-dir-fixture.ts";
import { type RunRecord, readRecords } from "../../../file/run-record.ts";
import { isIdle, nextPhase, reviewKindFor, roundKeyFor } from "../reducer.ts";

const c = config();
afterEach(cleanupRuns);

describe("reducer: 実行の記録の更新", () => {
  test("レコードを閉じて state.json の phase を進める", () => {
    const dir = makeRun();
    const f = runOnce(dir, "planner", { result: "ok" });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);

    const rec = readRecords(dir)[0] as RunRecord;
    expect(rec.finished_at).not.toBeNull();
    expect(rec.result).toBe("ok");
    // 実行番号はテスト全体で共有のカウンタから採るので、レコードの run_id と突き合わせる
    expect(rec.session_id).toBe(`sess-${rec.run_id}`);

    // 識別子は書き換えずに保つ
    expect(phaseOf(dir).meta.issue).toBe(123);
    expect(phaseOf(dir).meta.branch).toBe("claude/issue-123");
  });
});

describe("reducer: 遷移", () => {
  test("planner が成功すれば plan_review へ", () => {
    expect(runOnce(makeRun(), "planner", { result: "ok" }).phase).toBe("plan_review");
  });

  test("approve で awaiting_human へ（人間待ちなので連鎖させない）", () => {
    const dir = makeRun("plan_review");
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    expect(f.phase).toBe("awaiting_human");
    // [skip ci] で run を起こさない。起きたとしても route が止める（二重の停止）
    expect(f.continue_chain).toBe(false);
    expect(route(dir, c).action).toBe("none");
  });

  test("request_changes 1 回目は planning に戻る", () => {
    const dir = makeRun("plan_review");
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
    expect(f.phase).toBe("planning");
    expect(f.reason).toContain(`1/${c.limits.plan_review_rounds}`);
  });

  test("ラウンド上限は今回の実行を含めて数え、上限回目の差し戻しで blocked", () => {
    const limit = c.limits.plan_review_rounds;
    const dir = makeRun();
    // 上限の 1 つ前までは planning に戻り続ける
    for (let round = 1; round < limit; round++) {
      runOnce(dir, "planner", { result: "ok" });
      const back = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
      expect(back.phase, `round ${round}`).toBe("planning");
    }
    runOnce(dir, "planner", { result: "ok" });
    const f = runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain(`plan_review_rounds_exceeded: ${limit}/${limit}`);
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

describe("reducer: 停止条件", () => {
  test("規模超過は止めない（PR に警告を出して進める / K-21）", () => {
    // 上限は目安であって停止条件ではない。分割するかは人間が PR を見て決める
    const f = runOnce(makeRun(), "planner", { result: "ok", oversize: true });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);
  });

  test("API エラーはステータス付きで blocked にする（設定ミスと区別できるように）", () => {
    const f = runOnce(makeRun(), "planner", { result: "api_error", api_error_status: 429 });
    expect(f.blocked_reason).toBe("api_error:429");
    expect(f.continue_chain).toBe(false);
  });

  test("実行失敗と成果物の検証失敗は blocked", () => {
    const cases: Array<[Parameters<typeof runOnce>[2], string]> = [
      [{ result: "agent_failed" }, "agent_failed"],
      [{ result: "invalid" }, "invalid_artifacts"],
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

describe("reducer: 正常系の一巡", () => {
  test("承認を挟んで done まで到達し、total_steps に収まる", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" });
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    expect(phaseOf(dir).phase).toBe("awaiting_human");

    expect(approve(dir, "OWNER", c)).toEqual({
      ok: true,
      phase: "developing",
    });
    runOnce(dir, "developer", { result: "ok" });
    runOnce(dir, "dev-reviewer", { result: "ok", verdict: "approve" });
    const last = runOnce(dir, "completion", { result: "ok", acceptance_passed: true });

    expect(last.phase).toBe("done");
    expect(last.continue_chain).toBe(false);
    const r = route(dir, c);
    expect(r.total_steps).toBe(5);
    expect(r.total_steps).toBeLessThanOrEqual(c.limits.total_steps);
  });
});

describe("block action", () => {
  test("blockRun は理由を残して blocked にする", () => {
    const dir = makeRun("developing");
    block(dir, "stale: started_at から 60 分経過", c);
    const s = phaseOf(dir);
    expect(s.phase).toBe("blocked");
    expect(s.blocked_reason).toContain("stale");
  });
});

describe("reducer: 人間の action による遷移", () => {
  test("awaiting_human で承認すると developing へ進み、developer が起動する", () => {
    const dir = makeRun("awaiting_human");
    expect(route(dir, c).action).toBe("none");
    expect(approve(dir, "COLLABORATOR", c)).toEqual({ ok: true, phase: "developing" });
    expect(phaseOf(dir).phase).toBe("developing");
    expect(route(dir, c).run?.agent).toBe("developer");
  });

  test("差し戻すと planning に戻り、planner が再走する", () => {
    const dir = makeRun("awaiting_human");
    const r = requestChanges(dir, "OWNER", "期限を明記して", c);
    expect(r.ok && r.phase).toBe("planning");
    expect(phaseOf(dir).phase).toBe("planning");
    expect(route(dir, c).run?.agent).toBe("planner");
  });

  test("人間の差し戻しは total_steps を増やさない（A-41）", () => {
    const dir = makeRun("awaiting_human");
    requestChanges(dir, "OWNER", "やり直し", c);
    expect(route(dir, c).total_steps).toBe(0);
  });
});

describe("nextPhase", () => {
  test("成功で次に進む", () => {
    expect(nextPhase("planning", "ok", c)).toBe("plan_review");
    expect(nextPhase("developing", "ok", c)).toBe("dev_review");
  });

  test("レビューの verdict で分岐する", () => {
    expect(nextPhase("plan_review", "approve", c)).toBe("awaiting_human");
    expect(nextPhase("plan_review", "request_changes", c)).toBe("planning");
    expect(nextPhase("dev_review", "approve", c)).toBe("completing");
    expect(nextPhase("dev_review", "request_changes", c)).toBe("developing");
  });

  test("completing は pass / fail", () => {
    expect(nextPhase("completing", "pass", c)).toBe("done");
    expect(nextPhase("completing", "fail", c)).toBe("blocked");
  });

  test("定義されていない組み合わせは null", () => {
    expect(nextPhase("planning", "approve", c)).toBeNull();
    expect(nextPhase("plan_review", "ok", c)).toBeNull();
    expect(nextPhase("awaiting_human", "ok", c)).toBeNull();
  });
});

describe("遷移表の引き方（roundKeyFor / reviewKindFor / isIdle）", () => {
  test("ラウンドを数えるのはレビューのフェーズだけ", () => {
    expect(roundKeyFor("plan_review", c)).toBe("plan_review");
    expect(roundKeyFor("dev_review", c)).toBe("dev_review");
    expect(roundKeyFor("planning", c)).toBeNull();
  });

  test("人間の差し戻しをどのレビューとして残すか", () => {
    expect(reviewKindFor("awaiting_human", c)).toBe("plan");
    expect(reviewKindFor("planning", c)).toBeNull();
  });

  test("エージェントを起動しないフェーズ（continue_chain の判定に使う）", () => {
    expect(isIdle("done")).toBe(true);
    expect(isIdle("blocked")).toBe(true);
    // 人間のコメント待ち。push で起動しても route が none を返すだけなので連鎖させない
    expect(isIdle("awaiting_human")).toBe(true);
    expect(isIdle("bootstrap")).toBe(true);
    expect(isIdle("planning")).toBe(false);
  });
});

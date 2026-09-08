import { afterEach, describe, expect, test } from "bun:test";
import { settings } from "../../../../__tests__/helpers.ts";
import {
  approve,
  cleanupRuns,
  makeRun,
  phaseOf,
  requestChanges,
  retry,
  route,
  runOnce,
} from "../../../../__tests__/runDirFixture.ts";
import { readEvents } from "../../../../file/eventLog.ts";
import { agentFor, isIdle } from "../reducer.ts";

const c = settings();
afterEach(cleanupRuns);

describe("reducer: イベントログと state.json", () => {
  test("実行の開始と終了がイベントに残り、スナップショットの phase が進む", () => {
    const dir = makeRun();
    const f = runOnce(dir, "planner", { result: "ok" });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);

    // ログは起きた順（bootstrap → 開始 → 計画ができた）
    expect(readEvents(dir).map((event) => event.type)).toEqual([
      "agent-pipeline/BOOTSTRAP",
      "agent-pipeline/app/AGENT_STARTED",
      "agent-pipeline/app/PLANNED",
    ]);

    // スナップショットは畳み込みの射影。識別子は bootstrap イベントから来る
    expect(phaseOf(dir).phase).toBe("plan_review");
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
    expect(route(dir, c).rounds.plan_review).toBe(1);
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
    // 契約の検査が先に弾く。reducer 側の missing_verdict は二重の網
    // （mapValidationToAction.test.ts で直接見る）
    expect(f.blocked_reason).toContain("frontmatter に verdict が無い");
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
      // detail は validate が成果物を見て付ける（planner なら plan.md が無い）
      [{ result: "invalid" }, "invalid_artifacts: plan.md が無いか空"],
    ];
    for (const [outcome, reason] of cases) {
      const f = runOnce(makeRun(), "planner", outcome);
      expect(f.phase).toBe("blocked");
      expect(f.blocked_reason).toBe(reason);
      expect(f.continue_chain).toBe(false);
    }
  });

  test("エージェントが走らないフェーズでの成功報告は blocked にする（黙って通さない）", () => {
    // awaiting_human は人間を待つフェーズで、エージェントの終了に対応する action が無い
    const f = runOnce(makeRun("awaiting_human"), "planner", { result: "ok" }, c);
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toBe("transition_incomplete: awaiting_human (ok)");
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

describe("blocked は導出される状態（K-26）", () => {
  test("実行が失敗すれば止まる。phase は失敗で潰されない", () => {
    const dir = makeRun("developing");
    const f = runOnce(dir, "developer", { result: "agent_failed" }, c);
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toBe("agent_failed");
    expect(f.continue_chain).toBe(false);
    // スナップショットは導出した phase と理由を出す
    expect(phaseOf(dir).phase).toBe("blocked");
    expect(phaseOf(dir).blocked_reason).toBe("agent_failed");
    // 記録済みの停止なので route は何もしない（書き直す必要がない）
    expect(route(dir, c).action).toBe("none");
  });

  test("実行回数の総数が上限に達すると止まる（イベントは記録しない）", () => {
    const dir = makeRun();
    const limit = c.limits.total_steps;
    for (let i = 0; i < limit; i += 2) {
      runOnce(dir, "planner", { result: "ok" }, c);
      runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" }, c);
    }
    const r = route(dir, c);
    expect(r.action).toBe("block");
    expect(r.reason).toMatch(/_exceeded/);
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

  test("人間の差し戻しは total_steps を増やさない（A-41 がカウント表に出ている）", () => {
    const dir = makeRun("awaiting_human");
    const before = route(dir, c).total_steps;
    requestChanges(dir, "OWNER", "やり直し", c);
    expect(route(dir, c).total_steps).toBe(before);
  });

  test("retry は停止の理由を消して同じフェーズをやり直す（RETRY_TO / K-27）", () => {
    const dir = makeRun("developing");
    runOnce(dir, "developer", { result: "agent_failed" }, c);
    expect(retry(dir, "OWNER", c)).toEqual({
      ok: true,
      phase: "developing",
      agent: "developer",
    });
    expect(phaseOf(dir)).toMatchObject({ phase: "developing", blocked_reason: null });
  });
});

describe("フェーズの性質（agentFor / isIdle）", () => {
  test("エージェントは 5 つのフェーズに割り当たり、人間が起こす遷移には割り当たらない", () => {
    expect(agentFor("planning")).toBe("planner");
    expect(agentFor("plan_review")).toBe("plan-reviewer");
    expect(agentFor("developing")).toBe("developer");
    expect(agentFor("dev_review")).toBe("dev-reviewer");
    expect(agentFor("completing")).toBe("completion");
    expect(agentFor("awaiting_human")).toBeNull();
    expect(agentFor("done")).toBeNull();
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

describe("遷移は reducer の中に書いてある（dispatch で確かめる / K-26）", () => {
  test("done は終端なので、そこから動く action は無い（K-10）", () => {
    const dir = makeRun("done");
    expect(approve(dir, "OWNER", c).ok).toBe(false);
    expect(requestChanges(dir, "OWNER", "直して", c).ok).toBe(false);
    expect(phaseOf(dir).phase).toBe("done");
  });

  test("レビューのフェーズで verdict が無ければ blocked（frontmatter の欠落）", () => {
    const f = runOnce(makeRun("plan_review"), "plan-reviewer", { result: "ok" }, c);
    expect(f.blocked_reason).toContain("frontmatter に verdict が無い");
  });
});

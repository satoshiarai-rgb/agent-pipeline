import { describe, expect, test } from "bun:test";
import { finish } from "../finish.ts";
import type { Phase, RunRecord } from "../../types.ts";
import { config, rec, review } from "../../__tests__/helpers.ts";

describe("finish", () => {
  const c = config();

  test("planner が成功すれば plan_review へ", () => {
    const f = finish({
      phase: "planning",
      records: [rec("planner")],
      config: c,
      outcome: { result: "ok" },
    });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);
  });

  test("approve で awaiting_human へ（連鎖は続くが dispatch が止める）", () => {
    const f = finish({
      phase: "plan_review",
      records: [rec("planner"), review("plan-reviewer", "approve")],
      config: c,
      outcome: { result: "ok", verdict: "approve" },
    });
    expect(f.phase).toBe("awaiting_human");
    expect(f.continue_chain).toBe(true);
  });

  test("request_changes 1 回目は planning に戻る", () => {
    const f = finish({
      phase: "plan_review",
      records: [rec("planner"), review("plan-reviewer", "request_changes")],
      config: c,
      outcome: { result: "ok", verdict: "request_changes" },
    });
    expect(f.phase).toBe("planning");
    expect(f.reason).toContain("1/2");
  });

  test("request_changes がラウンド上限に達したら blocked", () => {
    const records = [
      rec("planner"),
      review("plan-reviewer", "request_changes"),
      rec("planner"),
      review("plan-reviewer", "request_changes"),
    ];
    const f = finish({
      phase: "plan_review",
      records,
      config: c,
      outcome: { result: "ok", verdict: "request_changes" },
    });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain("plan_review_rounds_exceeded: 2/2");
    expect(f.continue_chain).toBe(false);
  });

  test("dev_review も同じ規則で動く", () => {
    const ok = finish({
      phase: "dev_review",
      records: [review("dev-reviewer", "approve")],
      config: c,
      outcome: { result: "ok", verdict: "approve" },
    });
    expect(ok.phase).toBe("completing");

    const back = finish({
      phase: "dev_review",
      records: [review("dev-reviewer", "request_changes")],
      config: c,
      outcome: { result: "ok", verdict: "request_changes" },
    });
    expect(back.phase).toBe("developing");
  });

  test("verdict が無ければ blocked（frontmatter 欠落）", () => {
    const f = finish({
      phase: "plan_review",
      records: [review("plan-reviewer", "approve")],
      config: c,
      outcome: { result: "ok" },
    });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toBe("missing_verdict");
  });

  test("completing は acceptance 全 passed で done、そうでなければ blocked", () => {
    const done = finish({
      phase: "completing",
      records: [rec("completion")],
      config: c,
      outcome: { result: "ok", acceptance_passed: true },
    });
    expect(done.phase).toBe("done");
    expect(done.continue_chain).toBe(false); // 終端なので [skip ci] を付ける

    const ng = finish({
      phase: "completing",
      records: [rec("completion")],
      config: c,
      outcome: { result: "ok", acceptance_passed: false },
    });
    expect(ng.phase).toBe("blocked");
    expect(ng.blocked_reason).toBe("acceptance_not_passed");
  });

  test("API エラーはステータス付きで blocked にする（設定ミスと区別できるように）", () => {
    const f = finish({
      phase: "planning",
      records: [rec("planner", { result: "api_error" })],
      config: c,
      outcome: { result: "api_error", api_error_status: 404 },
    });
    expect(f.blocked_reason).toBe("api_error:404");
  });

  test("実行失敗・成果物の検証失敗・規模超過はいずれも blocked", () => {
    const cases: Array<[Parameters<typeof finish>[0]["outcome"], string]> = [
      [{ result: "agent_failed" }, "agent_failed"],
      [{ result: "invalid" }, "invalid_artifacts"],
      [{ result: "ok", oversize: true }, "oversize: issue の分割が必要"],
    ];
    for (const [outcome, reason] of cases) {
      const f = finish({ phase: "planning", records: [rec("planner")], config: c, outcome });
      expect(f.phase).toBe("blocked");
      expect(f.blocked_reason).toBe(reason);
      expect(f.continue_chain).toBe(false);
    }
  });

  test("遷移表に行き先が無ければ blocked にする（設定の壊れを静かに通さない）", () => {
    const broken = config();
    broken.transitions.plan_review = { agent: "plan-reviewer", round_key: "plan_review" };
    const f = finish({
      phase: "plan_review",
      records: [review("plan-reviewer", "approve")],
      config: broken,
      outcome: { result: "ok", verdict: "approve" },
    });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain("transition_incomplete");
  });

  test("正常系は 6 手で done に到達する（total_steps 12 に収まる）", () => {
    // planner → plan-reviewer(approve) → 人間承認 → developer → dev-reviewer(approve) → completion
    let phase: Phase = "planning";
    const records: RunRecord[] = [];
    const step = (outcome: Parameters<typeof finish>[0]["outcome"], agent: Parameters<typeof rec>[0]) => {
      records.push(rec(agent));
      const f = finish({ phase, records, config: c, outcome });
      phase = f.phase;
      return f;
    };
    expect(step({ result: "ok" }, "planner").phase).toBe("plan_review");
    expect(step({ result: "ok", verdict: "approve" }, "plan-reviewer").phase).toBe("awaiting_human");
    phase = "developing"; // /approve による人間の遷移
    expect(step({ result: "ok" }, "developer").phase).toBe("dev_review");
    expect(step({ result: "ok", verdict: "approve" }, "dev-reviewer").phase).toBe("completing");
    const last = step({ result: "ok", acceptance_passed: true }, "completion");
    expect(last.phase).toBe("done");
    expect(records.length).toBeLessThanOrEqual(c.limits.total_steps);
  });
});

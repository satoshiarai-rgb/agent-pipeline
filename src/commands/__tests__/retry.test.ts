import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, phaseOf, runOnce } from "../../__tests__/run-dir-fixture.ts";
import { approveRun } from "../approve.ts";
import { blockRun } from "../block.ts";
import { retryRun } from "../retry.ts";
import { startRun } from "../start.ts";

const c = config();
afterEach(cleanupRuns);

const retry = (dir: string, association = "OWNER") => retryRun({ dir, config: c, association });

describe("retry: 戻る先は履歴が決める（K-23）", () => {
  test("completing で止まったら completing に戻る（実機で手で直した操作）", () => {
    // acceptance が全 passed でないと completing は blocked になる。
    // 人間が条件を満たしてから、同じフェーズをやり直す
    const dir = makeRun("completing");
    runOnce(dir, "completion", { result: "ok", acceptance_passed: false });
    expect(phaseOf(dir).phase).toBe("blocked");

    const r = retry(dir);
    expect(r).toEqual({ ok: true, phase: "completing", agent: "completion" });
    expect(phaseOf(dir)).toMatchObject({ phase: "completing", blocked_reason: null });
  });

  test("成果物が契約を満たさず止まったフェーズに戻る", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "invalid", detail: "plan.md が無いか空" });
    expect(retry(dir)).toEqual({ ok: true, phase: "planning", agent: "planner" });
  });

  test("複数のレコードがあれば時刻が最も新しいものを見る（ファイル名順ではない）", () => {
    // ファイル名順だと developer < plan-reviewer < planner で、実行順と一致しない
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" });
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    approveRun({ dir, config: c, association: "OWNER" });
    runOnce(dir, "developer", { result: "agent_failed" });

    expect(retry(dir)).toMatchObject({ phase: "developing", agent: "developer" });
  });
});

describe("retry: エージェントが走るフェーズはすべて戻せる", () => {
  // レコードは startRun が作るので、人間を待つフェーズ（awaiting_human / bootstrap / done）の
  // レコードは存在しない。つまり retry の戻り先は構造的にエージェントのフェーズだけになる
  const phases = [
    ["planning", "planner"],
    ["plan_review", "plan-reviewer"],
    ["developing", "developer"],
    ["dev_review", "dev-reviewer"],
    ["completing", "completion"],
  ] as const;

  for (const [phase, agent] of phases) {
    test(`${phase} で止まったら ${phase} に戻る`, () => {
      const dir = makeRun(phase);
      runOnce(dir, agent, { result: "agent_failed" });
      expect(phaseOf(dir).phase).toBe("blocked");
      expect(retry(dir)).toEqual({ ok: true, phase, agent });
    });
  }
});

describe("retry: 受け付けないもの", () => {
  test("blocked 以外では何もしない（取り違えを黙って進めない）", () => {
    const dir = makeRun("awaiting_human");
    expect(retry(dir)).toEqual({ ok: false, reason: "not_blocked: phase=awaiting_human" });
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });

  test("上限で止まったものは断る（やり直しても同じ理由で止まる）", () => {
    const dir = makeRun();
    const limit = c.limits.plan_review_rounds;
    for (let i = 0; i < limit; i++) {
      runOnce(dir, "planner", { result: "ok" });
      runOnce(dir, "plan-reviewer", { result: "ok", verdict: "request_changes" });
    }
    expect(phaseOf(dir).blocked_reason).toContain("_exceeded");

    const r = retry(dir);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("limit_reached");
    expect(phaseOf(dir).phase).toBe("blocked");
  });

  test("実行の記録が無ければ戻る先が決まらない", () => {
    const dir = makeRun("blocked");
    const r = retry(dir);
    expect(r.ok === false && r.reason).toContain("no_records");
  });

  test("直前のレコードが閉じていなければ断る（戻しても route が動かさない）", () => {
    const dir = makeRun("developing");
    // start だけして finish していない状態（job タイムアウトや stale の途中）
    startRun({ dir, config: c, agent: "developer", run_id: "1", attempt: 1, model: "m" });
    blockRun({ dir, config: c, reason: "stale" });

    const r = retry(dir);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("run_in_progress");
    expect(phaseOf(dir).phase).toBe("blocked");
  });

  test("approvers 以外は認可されない（入口でのみ見る / 設計書 §7.3）", () => {
    const dir = makeRun("completing");
    runOnce(dir, "completion", { result: "ok", acceptance_passed: false });
    expect(retry(dir, "NONE")).toEqual({ ok: false, reason: "not_authorized: NONE" });
    expect(phaseOf(dir).phase).toBe("blocked");
  });
});

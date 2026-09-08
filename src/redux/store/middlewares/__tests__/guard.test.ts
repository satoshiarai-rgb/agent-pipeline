import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../../../__tests__/helpers.ts";
import {
  approve,
  cleanupRuns,
  makeBlocked,
  makeInFlight,
  makeRun,
  phaseOf,
  requestChanges,
  retry as retryCmd,
  route,
  runOnce,
  start,
} from "../../../../__tests__/runDirFixture.ts";

const c = config();
afterEach(cleanupRuns);

const retry = (dir: string, association = "OWNER") => retryCmd(dir, association, c);

describe("retry: 戻る先（K-23 → K-27 で表に移る）", () => {
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
    approve(dir, "OWNER", c);
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

  test("実行中に止まったものは断る（戻しても route が動かさない）", () => {
    // start だけして finish していない状態で、中央の版が上がって止まった場合
    const dir = makeRun("developing");
    start(dir, "developer", "999", c);
    const newer = { ...c, pipeline_version: c.pipeline_version + 1 };

    const r = retryCmd(dir, "OWNER", newer);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("run_in_progress: developer run=999");
  });

  test("approvers 以外は認可されない（入口でのみ見る / 設計書 §7.3）", () => {
    const dir = makeRun("completing");
    runOnce(dir, "completion", { result: "ok", acceptance_passed: false });
    expect(retry(dir, "NONE")).toEqual({ ok: false, reason: "not_authorized: NONE" });
    expect(phaseOf(dir).phase).toBe("blocked");
  });
});

describe("人間の action の認可（入口でのみ見る / 設計書 §7.3）", () => {
  test("approvers に無い association は拒否し、状態を書き換えない", () => {
    const dir = makeRun("awaiting_human");
    expect(approve(dir, "NONE", c)).toEqual({ ok: false, reason: "not_authorized: NONE" });
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });

  test("認可を先に見る（対象外のフェーズでも認可エラーを返す）", () => {
    expect(approve(makeRun("planning"), "NONE", c)).toEqual({
      ok: false,
      reason: "not_authorized: NONE",
    });
  });

  test("awaiting_human 以外での /agent approve は何もしない", () => {
    for (const phase of ["planning", "dev_review", "done"] as const) {
      const dir = makeRun(phase);
      const r = approve(dir, "OWNER", c);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toContain("not_awaiting_approval");
      expect(phaseOf(dir).phase).toBe(phase);
    }
    // 止まっている run でも同じ（承認は計画の承認待ちだけ）
    const blocked = makeBlocked("agent_failed", "dev_review");
    expect(approve(blocked, "OWNER", c).ok).toBe(false);
  });

  test("done は終端なので差し戻せない（K-10: 作り直しは新しい issue で）", () => {
    const dir = makeRun("done");
    const before = readdirSync(join(dir, "reviews")).length;
    const r = requestChanges(dir, "OWNER", "直して", c);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("not_awaiting_approval: phase=done");
    // 弾かれた差し戻しはレビューを 1 件も足さない（reviews/ 自体はレビュアーの成果物で在る）
    expect(readdirSync(join(dir, "reviews")).length).toBe(before);
  });

  test("認可されない差し戻しは何も書かない", () => {
    const dir = makeRun("awaiting_human");
    const before = readdirSync(join(dir, "reviews")).length;
    expect(requestChanges(dir, "NONE", "x", c).ok).toBe(false);
    expect(readdirSync(join(dir, "reviews")).length).toBe(before);
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });
});

/**
 * job のタイムアウトやキャンセルで死んだ実行（開始イベントだけが残った状態）。
 * `route` は「実行中」と見て何もしないので、**復旧手段は `/agent retry` だけ**（I-8）。
 */
describe("死んだ実行からの復旧（stale / I-8）", () => {
  test("走っている最中は戻せない（まだ止まっていない）", () => {
    const dir = makeRun("developing");
    start(dir, "developer", "999", c);
    // 先に見るのは「止まっているか」。走っている実行はまだ死んでいないので弾かれる
    const rejected = retry(dir);
    expect(rejected.ok === false && rejected.reason).toBe("not_blocked: phase=developing");
  });

  test("ジョブの上限を過ぎた実行は戻せる。実行中の記録は落ちる", () => {
    const dir = makeRun("developing");
    makeInFlight(dir, "developer", "20260101T000000Z");
    const r = retry(dir);
    expect(r.ok).toBe(true);
    expect(r.ok && r.agent).toBe("developer");
    // route が次を出せる状態に戻っている（実行中のままだと何もしない）
    expect(route(dir, c)).toMatchObject({ action: "run", run: { agent: "developer" } });
  });
});

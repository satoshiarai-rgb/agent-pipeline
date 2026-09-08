import { afterEach, describe, expect, test } from "bun:test";
import { config, rootOf } from "../../../../__tests__/helpers.ts";
import { cleanupRuns, label, makeRun, route } from "../../../../__tests__/runDirFixture.ts";
import { PHASES } from "../../../../types.ts";
import {
  labelFor,
  selectContinueChain,
  selectLabel,
  selectNextAction,
  selectSnapshot,
} from "../selectors.ts";

const c = config();
afterEach(cleanupRuns);

const next = (app: Parameters<typeof rootOf>[0], configError: string | null = null) =>
  selectNextAction(rootOf(app), c, configError);

describe("selectNextAction: 何を起動するか", () => {
  test("各フェーズが正しいエージェントに割り当たる", () => {
    const pairs = [
      ["planning", "planner"],
      ["plan_review", "plan-reviewer"],
      ["developing", "developer"],
      ["dev_review", "dev-reviewer"],
      ["completing", "completion"],
    ] as const;
    for (const [phase, agent] of pairs) {
      const r = next({ phase });
      expect(r.action, phase).toBe("run");
      expect(r.run?.agent).toBe(agent);
    }
  });

  test("planner の実行パラメータを解決する", () => {
    const r = next({ phase: "planning" });
    expect(r.run?.tools).toBe("Read,Glob,Grep,Write");
    expect(r.run?.max_turns).toBe(c.agents.planner.max_turns);
  });

  test("awaiting_human / done / blocked / bootstrap では何もしない", () => {
    for (const phase of ["awaiting_human", "done", "blocked", "bootstrap"] as const) {
      const r = next({ phase });
      expect(r.action).toBe("none");
      expect(r.reason).toBe(`phase_${phase}`);
    }
  });

  test("実行中のエージェントがあれば二重起動しない", () => {
    const r = next({ phase: "developing", in_flight_agent: "developer", in_flight_run_id: "9" });
    expect(r.action).toBe("none");
    expect(r.reason).toContain("run_in_progress: developer run=9");
  });

  test("total_steps 上限で block を返す", () => {
    const limit = c.limits.total_steps;
    const r = next({ phase: "planning", total_steps: limit });
    expect(r.action).toBe("block");
    expect(r.reason).toContain(`total_steps_exceeded: ${limit}/${limit}`);
  });

  test("導出値（total_steps と rounds）を返す", () => {
    const r = next({ phase: "plan_review", total_steps: 3, plan_review_rounds: 1 });
    expect(r.total_steps).toBe(3);
    expect(r.rounds.plan_review).toBe(1);
    expect(r.rounds.dev_review).toBe(0);
  });

  test("遷移表にエージェントが無いフェーズは block（表は中央のコードが持つ / K-26）", () => {
    // awaiting_human は人間が起こす遷移だけを持つので、エージェントは割り当たらない。
    // ただし isIdle なので none が先に返る — 起動しないことが保証されていればよい
    expect(next({ phase: "awaiting_human" }).action).toBe("none");
  });

  test("config.json が受け付けられなければ block（例外にしない / A-19）", () => {
    // ここで投げると状態が git に載らないまま job が落ち、run が無音で止まる
    const r = next({ phase: "planning" }, "limits.plan_rounds: 既定にないキー");
    expect(r.action).toBe("block");
    expect(r.reason).toContain("config_invalid");
    expect(r.reason).toContain("limits.plan_rounds");
  });

  test("pipeline_version が合わなければ block", () => {
    const r = selectNextAction(rootOf({ phase: "planning" }, { pipeline_version: 1 }), c);
    expect(r.action).toBe("block");
    expect(r.reason).toContain("pipeline_version_mismatch: run=1 harness=2");
  });
});

describe("selectNextAction: ファイルから読んだ状態でも同じ", () => {
  test("planning では planner を起動する", () => {
    const r = route(makeRun(), c);
    expect(r.action).toBe("run");
    expect(r.run?.agent).toBe("planner");
  });

  test("bootstrap イベントの版とハーネスの版が違えば止まる", () => {
    const dir = makeRun();
    const newer = { ...c, pipeline_version: c.pipeline_version + 1 };
    expect(route(dir, newer).action).toBe("block");
    expect(route(dir, newer).reason).toContain("pipeline_version_mismatch: run=2 harness=3");
  });
});

describe("selectLabel / labelFor", () => {
  test("アンダースコアをハイフンにして prefix を付ける", () => {
    expect(labelFor("plan_review", "agent:")).toBe("agent:plan-review");
    expect(labelFor("awaiting_human", "agent:")).toBe("agent:awaiting-human");
    expect(labelFor("done", "agent:")).toBe("agent:done");
  });

  test("prefix は設定から取る", () => {
    expect(labelFor("planning", "bot/")).toBe("bot/planning");
  });

  test("すべての phase がラベルに射影できる", () => {
    for (const phase of PHASES) {
      expect(labelFor(phase, "agent:")).toMatch(/^agent:[a-z-]+$/);
    }
  });

  test("いま付いているべきラベルと issue 番号を返す", () => {
    expect(selectLabel(rootOf({ phase: "dev_review" }), c)).toEqual({
      label: "agent:dev-review",
      issue: 123,
      phase: "dev_review",
      prefix: "agent:",
      trigger: "agent:go",
    });
  });

  test("ファイルから読んだ状態でも同じ", () => {
    expect(label(makeRun("completing"), c).label).toBe("agent:completing");
  });
});

describe("selectContinueChain / selectSnapshot", () => {
  test("エージェントを起動しないフェーズでは連鎖を止める", () => {
    for (const phase of ["awaiting_human", "done", "blocked", "bootstrap"] as const) {
      expect(selectContinueChain(rootOf({ phase }), c), phase).toBe(false);
    }
    expect(selectContinueChain(rootOf({ phase: "planning" }), c)).toBe(true);
    // 失敗していれば導出された phase が blocked なので連鎖しない
    expect(
      selectContinueChain(rootOf({ phase: "planning", failure_reason: "agent_failed" }), c),
    ).toBe(false);
  });

  test("スナップショットは識別子と phase だけを持つ（導出値は出さない）", () => {
    const s = selectSnapshot(rootOf({ phase: "developing", failure_reason: "agent_failed" }), c);
    expect(s).toEqual({
      pipeline_version: 2,
      issue: 123,
      branch: "claude/issue-123",
      phase: "blocked",
      blocked_reason: "agent_failed",
    });
  });
});

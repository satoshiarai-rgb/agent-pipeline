import { describe, expect, test } from "bun:test";
import { route } from "../state.ts";
import { config, rec, review } from "./helpers.ts";

describe("route", () => {
  const c = config();

  test("planning なら planner を実行する", () => {
    const r = route({ phase: "planning", records: [], config: c });
    expect(r.action).toBe("run");
    expect(r.run?.agent).toBe("planner");
    expect(r.run?.tools).toBe("Read,Glob,Grep,Write");
    expect(r.run?.max_turns).toBe(25);
  });

  test("各フェーズが正しいエージェントに割り当たる", () => {
    const pairs = [
      ["plan_review", "plan-reviewer"],
      ["developing", "developer"],
      ["dev_review", "dev-reviewer"],
      ["completing", "completion"],
    ] as const;
    for (const [phase, agent] of pairs) {
      const r = route({ phase, records: [], config: c });
      expect(r.action).toBe("run");
      expect(r.run?.agent).toBe(agent);
    }
  });

  test("awaiting_human / done / blocked / bootstrap では何もしない", () => {
    for (const phase of ["awaiting_human", "done", "blocked", "bootstrap"] as const) {
      const r = route({ phase, records: [], config: c });
      expect(r.action).toBe("none");
      expect(r.reason).toBe(`phase_${phase}`);
    }
  });

  test("未完了のレコードがあれば二重起動しない", () => {
    const r = route({
      phase: "developing",
      records: [rec("developer", { finished_at: null })],
      config: c,
    });
    expect(r.action).toBe("none");
    expect(r.reason).toContain("run_in_progress");
  });

  test("total_steps 上限で block を返す", () => {
    const records = Array.from({ length: 12 }, () => rec("planner"));
    const r = route({ phase: "planning", records, config: c });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("total_steps_exceeded: 12/12");
  });

  test("導出値（total_steps と rounds）を返す", () => {
    const records = [rec("planner"), review("plan-reviewer", "request_changes"), rec("planner")];
    const r = route({ phase: "plan_review", records, config: c });
    expect(r.total_steps).toBe(3);
    expect(r.rounds.plan_review).toBe(1);
    expect(r.rounds.dev_review).toBe(0);
  });
});

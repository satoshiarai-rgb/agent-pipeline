import { describe, expect, test } from "bun:test";
import { deriveRunStats } from "../derive-run-stats.ts";
import { rec, review } from "../../__tests__/helpers.ts";

describe("deriveRunStats", () => {
  test("total_steps は全レコード数", () => {
    expect(deriveRunStats([]).total_steps).toBe(0);
    expect(deriveRunStats([rec("planner"), rec("developer")]).total_steps).toBe(2);
  });

  test("rounds は該当レビュアーのレコード数", () => {
    const s = deriveRunStats([
      rec("planner"),
      review("plan-reviewer", "request_changes"),
      rec("planner"),
      review("plan-reviewer", "approve"),
      review("dev-reviewer", "approve"),
    ]);
    expect(s.rounds.plan_review).toBe(2);
    expect(s.rounds.dev_review).toBe(1);
  });

  test("失敗した実行も 1 ラウンドとして数える", () => {
    const s = deriveRunStats([review("plan-reviewer", "approve"), rec("plan-reviewer", { result: "invalid" })]);
    expect(s.rounds.plan_review).toBe(2);
  });

  test("finished_at が null のレコードを実行中として返す", () => {
    expect(deriveRunStats([rec("planner")]).in_flight).toBeNull();
    const s = deriveRunStats([rec("planner"), rec("developer", { finished_at: null })]);
    expect(s.in_flight?.agent).toBe("developer");
  });
});

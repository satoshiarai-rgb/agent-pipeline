import { describe, expect, test } from "bun:test";
import { rec } from "../../__tests__/helpers.ts";
import { deriveRunStats } from "../derive-run-stats.ts";

describe("deriveRunStats", () => {
  test("total_steps は全レコード数", () => {
    expect(deriveRunStats([]).total_steps).toBe(0);
    expect(deriveRunStats([rec("planner"), rec("developer")]).total_steps).toBe(2);
  });

  test("finished_at が null のレコードを実行中として返す", () => {
    expect(deriveRunStats([rec("planner")]).in_flight).toBeNull();
    const s = deriveRunStats([rec("planner"), rec("developer", { finished_at: null })]);
    expect(s.in_flight?.agent).toBe("developer");
  });
});

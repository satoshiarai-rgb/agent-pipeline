import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, runOnce } from "../../__tests__/run-dir-fixture.ts";
import { PHASES } from "../../types.ts";
import { allLabels, labelFor, labelRun } from "../label.ts";

const c = config();
afterEach(cleanupRuns);

describe("labelFor", () => {
  test("アンダースコアをハイフンにして prefix を付ける", () => {
    expect(labelFor("plan_review", "agent:")).toBe("agent:plan-review");
    expect(labelFor("awaiting_human", "agent:")).toBe("agent:awaiting-human");
    expect(labelFor("done", "agent:")).toBe("agent:done");
  });

  test("prefix は設定から取る", () => {
    expect(labelFor("planning", "bot/")).toBe("bot/planning");
  });

  test("全フェーズがラベルに射影できる（GitHub のラベル名として妥当）", () => {
    for (const phase of PHASES) {
      const label = labelFor(phase, "agent:");
      expect(label, phase).toMatch(/^agent:[a-z-]+$/);
    }
  });
});

describe("allLabels", () => {
  test("全フェーズ分と起動用ラベルを含む", () => {
    const labels = allLabels("agent:", "agent:go");
    expect(labels).toContain("agent:planning");
    expect(labels).toContain("agent:blocked");
    expect(labels).toContain("agent:go");
    expect(labels).toHaveLength(PHASES.length + 1);
  });
});

describe("labelRun", () => {
  test("いまの phase に対応するラベルと issue 番号を返す", () => {
    const dir = makeRun();
    expect(labelRun({ dir, config: c })).toEqual({
      label: "agent:planning",
      issue: 123,
      phase: "planning",
      prefix: "agent:",
      trigger: "agent:go",
    });
  });

  test("遷移するとラベルも追随する", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" });
    expect(labelRun({ dir, config: c }).label).toBe("agent:plan-review");
    runOnce(dir, "plan-reviewer", { result: "ok", verdict: "approve" });
    expect(labelRun({ dir, config: c }).label).toBe("agent:awaiting-human");
  });

  test("blocked も射影される（人間への通知に使う）", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "api_error", api_error_status: 429 });
    expect(labelRun({ dir, config: c }).label).toBe("agent:blocked");
  });
});

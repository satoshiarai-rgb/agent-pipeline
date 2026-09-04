import { describe, expect, test } from "bun:test";
import { agentFor, isIdle, isTerminal, nextPhase, roundKeyFor } from "../transitions.ts";
import { config } from "./helpers.ts";

const c = config();

describe("agentFor", () => {
  test("フェーズごとのエージェント", () => {
    expect(agentFor("planning", c)).toBe("planner");
    expect(agentFor("plan_review", c)).toBe("plan-reviewer");
    expect(agentFor("developing", c)).toBe("developer");
    expect(agentFor("dev_review", c)).toBe("dev-reviewer");
    expect(agentFor("completing", c)).toBe("completion");
  });

  test("遷移表に無いフェーズは null", () => {
    expect(agentFor("awaiting_human", c)).toBeNull();
    expect(agentFor("done", c)).toBeNull();
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

describe("roundKeyFor / isIdle / isTerminal", () => {
  test("ラウンドを数えるのはレビューのフェーズだけ", () => {
    expect(roundKeyFor("plan_review", c)).toBe("plan_review");
    expect(roundKeyFor("dev_review", c)).toBe("dev_review");
    expect(roundKeyFor("planning", c)).toBeNull();
  });

  test("待機フェーズと終端フェーズ", () => {
    expect(
      ["bootstrap", "awaiting_human", "done", "blocked"].every((p) => isIdle(p as never)),
    ).toBe(true);
    expect(isIdle("planning")).toBe(false);
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("blocked")).toBe(true);
    expect(isTerminal("awaiting_human")).toBe(false);
  });
});

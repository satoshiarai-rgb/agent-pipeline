import { describe, expect, test } from "bun:test";
import { isTerminal, nextPhase, reviewKindFor, roundKeyFor } from "../transitions.ts";
import { config } from "./helpers.ts";

const c = config();

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

describe("roundKeyFor / reviewKindFor / isTerminal", () => {
  test("ラウンドを数えるのはレビューのフェーズだけ", () => {
    expect(roundKeyFor("plan_review", c)).toBe("plan_review");
    expect(roundKeyFor("dev_review", c)).toBe("dev_review");
    expect(roundKeyFor("planning", c)).toBeNull();
  });

  test("人間の差し戻しをどのレビューとして残すか", () => {
    expect(reviewKindFor("awaiting_human", c)).toBe("plan");
    expect(reviewKindFor("planning", c)).toBeNull();
  });

  test("終端フェーズ（continue_chain の判定に使う）", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("blocked")).toBe(true);
    expect(isTerminal("awaiting_human")).toBe(false);
    expect(isTerminal("planning")).toBe(false);
  });
});

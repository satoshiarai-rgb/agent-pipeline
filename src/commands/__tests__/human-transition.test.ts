import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { humanTransition } from "../human-transition.ts";

const c = config();

describe("humanTransition", () => {
  test("認可と遷移表の両方を満たせば進む", () => {
    expect(
      humanTransition({
        phase: "awaiting_human",
        association: "OWNER",
        config: c,
        event: "approval",
      }),
    ).toEqual({
      ok: true,
      phase: "developing",
    });
  });

  test("認可を先に見る（対象外のフェーズでも認可エラーを返す）", () => {
    const r = humanTransition({
      phase: "planning",
      association: "NONE",
      config: c,
      event: "approval",
    });
    expect(r).toEqual({ ok: false, reason: "not_authorized: NONE" });
  });

  test("遷移表に辺が無ければ何もしない", () => {
    const r = humanTransition({
      phase: "done",
      association: "OWNER",
      config: c,
      event: "approval",
    });
    expect(r).toEqual({ ok: false, reason: "not_awaiting_approval: phase=done" });
  });
});

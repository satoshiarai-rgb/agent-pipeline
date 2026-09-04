import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { route } from "../../transitions.ts";
import { approve } from "../approve.ts";
import { requestChanges } from "../request-changes.ts";

const c = config();

describe("requestChanges", () => {
  test("awaiting_human なら planning に戻る", () => {
    expect(requestChanges({ phase: "awaiting_human", association: "OWNER", config: c })).toEqual({
      ok: true,
      phase: "planning",
    });
  });

  test("approvers に無い association は拒否する", () => {
    expect(requestChanges({ phase: "awaiting_human", association: "NONE", config: c }).ok).toBe(
      false,
    );
  });

  test("awaiting_human 以外では何もしない", () => {
    expect(requestChanges({ phase: "planning", association: "OWNER", config: c }).ok).toBe(false);
  });
});

describe("done は終端", () => {
  test("done では /approve も /request-changes も何も起こさない", () => {
    expect(approve({ phase: "done", association: "OWNER", config: c }).ok).toBe(false);
    expect(requestChanges({ phase: "done", association: "OWNER", config: c }).ok).toBe(false);
  });

  test("done では dispatch も何も起動しない", () => {
    expect(route({ phase: "done", records: [], config: c }).action).toBe("none");
  });
});

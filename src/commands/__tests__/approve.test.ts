import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { route } from "../../transitions.ts";
import { approve } from "../approve.ts";

const c = config();

describe("approve", () => {
  test("awaiting_human なら developing へ進む", () => {
    expect(approve({ phase: "awaiting_human", association: "OWNER", config: c })).toEqual({
      ok: true,
      phase: "developing",
    });
  });

  test("approvers に無い association は拒否する", () => {
    const r = approve({ phase: "awaiting_human", association: "NONE", config: c });
    expect(r).toEqual({ ok: false, reason: "not_authorized: NONE" });
  });

  test("awaiting_human 以外での /approve は何もしない", () => {
    for (const phase of ["planning", "dev_review", "done", "blocked"] as const) {
      const r = approve({ phase, association: "OWNER", config: c });
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toContain("not_awaiting_approval");
    }
  });

  test("承認前の awaiting_human では dispatch は何も起動しない", () => {
    expect(route({ phase: "awaiting_human", records: [], config: c }).action).toBe("none");
  });

  test("承認後の developing では developer が起動する", () => {
    const a = approve({ phase: "awaiting_human", association: "COLLABORATOR", config: c });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(route({ phase: a.phase, records: [], config: c }).run?.agent).toBe("developer");
  });
});

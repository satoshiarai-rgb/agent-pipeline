import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "../../__tests__/run-dir-fixture.ts";
import { approveRun } from "../approve.ts";
import { routeRun } from "../route.ts";

const c = config();
afterEach(cleanupRuns);

describe("approveRun", () => {
  test("awaiting_human なら developing へ進む", () => {
    const dir = makeRun("awaiting_human");
    expect(approveRun({ dir, config: c, association: "OWNER" })).toEqual({
      ok: true,
      phase: "developing",
    });
    expect(phaseOf(dir).phase).toBe("developing");
  });

  test("承認前は dispatch が何も起動せず、承認後は developer が起動する", () => {
    const dir = makeRun("awaiting_human");
    expect(routeRun({ dir, config: c }).action).toBe("none");
    approveRun({ dir, config: c, association: "COLLABORATOR" });
    expect(routeRun({ dir, config: c }).run?.agent).toBe("developer");
  });

  test("approvers に無い association は拒否し、state.json を書き換えない", () => {
    const dir = makeRun("awaiting_human");
    expect(approveRun({ dir, config: c, association: "NONE" })).toEqual({
      ok: false,
      reason: "not_authorized: NONE",
    });
    expect(phaseOf(dir).phase).toBe("awaiting_human");
  });

  test("awaiting_human 以外での /approve は何もしない", () => {
    for (const phase of ["planning", "dev_review", "done", "blocked"] as const) {
      const dir = makeRun(phase);
      const r = approveRun({ dir, config: c, association: "OWNER" });
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toContain("not_awaiting_approval");
      expect(phaseOf(dir).phase).toBe(phase);
    }
  });
});

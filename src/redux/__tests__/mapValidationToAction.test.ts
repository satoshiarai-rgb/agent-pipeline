import { describe, expect, test } from "bun:test";
import { mapValidationToAction } from "../mapValidationToAction.ts";

const context = { timestamp: "20260908T000000Z", by: "harness", run_id: "1", attempt: 1 };

/**
 * 検証結果 → action の写像。**成功はフェーズごとに別の action**（K-26）。
 * `finish` が契約の検査も行うようになったので、ここは検査を通った報告を受ける立場。
 * `missing_verdict` は validate が先に弾く二重の網で、CLI からは到達しない。
 */
describe("mapValidationToAction", () => {
  test("成功はフェーズごとの action になる", () => {
    const ok = { result: "ok" } as const;
    expect(mapValidationToAction(ok, "planning", context).type).toContain("PLANNED");
    expect(mapValidationToAction(ok, "developing", context).type).toContain("IMPLEMENTED");
    expect(
      mapValidationToAction({ ...ok, verdict: "approve" }, "dev_review", context).type,
    ).toContain("DEV_REVIEWED");
  });

  test("レビューのフェーズで verdict が無ければ失敗として写す（二重の網）", () => {
    const action = mapValidationToAction({ result: "ok" }, "plan_review", context);
    expect(action.error).toBe(true);
    expect(action.payload).toMatchObject({ reason: "missing_verdict" });
  });

  test("エージェントが走らないフェーズでの成功報告は失敗として写す", () => {
    const action = mapValidationToAction({ result: "ok" }, "awaiting_human", context);
    expect(action.payload).toMatchObject({ reason: "transition_incomplete: awaiting_human (ok)" });
  });

  test("失敗はフェーズを問わず agentFailed。理由は移行前の文字列のまま", () => {
    const reasons = [
      [{ result: "agent_failed" } as const, "agent_failed"],
      [{ result: "api_error", api_error_status: 429 } as const, "api_error:429"],
      [
        { result: "invalid", detail: "plan.md が無いか空" } as const,
        "invalid_artifacts: plan.md が無いか空",
      ],
    ] as const;
    for (const [report, reason] of reasons) {
      expect(mapValidationToAction(report, "planning", context).payload).toMatchObject({ reason });
    }
  });
});

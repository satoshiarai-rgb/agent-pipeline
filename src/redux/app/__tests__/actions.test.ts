import { describe, expect, test } from "bun:test";
import { APP_ACTIONS, agentFailed, agentStarted, block, isFailure, review } from "../actions.ts";

/**
 * action は FSA（Flux Standard Action）。**最上位のキーは type / payload / error / meta だけ**で、
 * この形のままイベントログのファイルに書かれる（K-26）。
 */
describe("FSA の形", () => {
  const origin = { at: "20260907T054512Z", by: "harness" };
  const run = { run_id: "1", attempt: 1 };

  test("type は ducks の名前空間付き（agent-pipeline/app/<TYPE>）", () => {
    expect(agentStarted.type).toBe("agent-pipeline/app/AGENT_STARTED");
    expect(review.type).toBe("agent-pipeline/app/REVIEW");
    for (const creator of APP_ACTIONS) {
      expect(creator.type).toMatch(/^agent-pipeline\/app\/[A-Z_]+$/);
    }
  });

  test("最上位に余分なキーを持たない", () => {
    const a = review({ ...origin, ...run, verdict: "approve" });
    expect(Object.keys(a).sort()).toEqual(["payload", "type"]);
    expect(a.payload.verdict).toBe("approve");
  });

  test("失敗を表す action は error: true を立て、reason を payload に持つ", () => {
    const a = agentFailed({ ...origin, ...run, reason: "agent_failed" });
    expect(Object.keys(a).sort()).toEqual(["error", "payload", "type"]);
    expect(a.error).toBe(true);
    expect(isFailure(a)).toBe(true);
    expect(isFailure(block({ ...origin, reason: "stale" }))).toBe(true);
    expect(isFailure(review({ ...origin, ...run, verdict: "approve" }))).toBe(false);
  });

  test("いつ・誰が を payload に持つ（人間の介入も同じ形で記録できる）", () => {
    const a = agentStarted({ ...origin, ...run, agent: "planner", model: "claude-opus-5" });
    expect(a.payload.at).toBe("20260907T054512Z");
    expect(a.payload.by).toBe("harness");
  });

  test("match で payload の型が絞れる（type 文字列の比較を書かない）", () => {
    const a = review({ ...origin, ...run, verdict: "request_changes" });
    expect(review.match(a)).toBe(true);
    expect(agentStarted.match(a)).toBe(false);
  });
});

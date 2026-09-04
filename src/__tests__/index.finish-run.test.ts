import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approveRun, finishRun, routeRun, startRun } from "../index.ts";
import { parseRecord } from "../utils/parse-record.ts";
import { config } from "./helpers.ts";
import { cleanupRuns, makeRun, phaseOf } from "./run-dir-fixture.ts";

const c = config();
afterEach(cleanupRuns);

describe("finishRun", () => {
  const step = (
    dir: string,
    agent: Parameters<typeof startRun>[0]["agent"],
    run_id: string,
    outcome: Parameters<typeof finishRun>[0]["outcome"],
  ) => {
    const { record_path } = startRun({
      dir,
      config: c,
      agent,
      run_id,
      attempt: 1,
      model: "claude-opus-5",
    });
    return finishRun({ dir, config: c, record_path, outcome, session_id: `sess-${run_id}` });
  };

  test("レコードを閉じて state.yml の phase を進める", () => {
    const dir = makeRun();
    const f = step(dir, "planner", "100", { result: "ok" });
    expect(f.phase).toBe("plan_review");
    expect(f.continue_chain).toBe(true);

    const rec = parseRecord(readFileSync(join(dir, "runs/planner-100-1.yml"), "utf8"));
    expect(rec.finished_at).not.toBeNull();
    expect(rec.result).toBe("ok");
    expect(rec.session_id).toBe("sess-100");

    expect(phaseOf(dir).phase).toBe("plan_review");
    // 人間が読むためのコメントが残っている
    expect(readFileSync(join(dir, "state.yml"), "utf8")).toContain("# 復旧のしかた");
  });

  test("ラウンド上限は今回の実行を含めて数える（2 回目の差し戻しで blocked）", () => {
    const dir = makeRun();
    step(dir, "planner", "100", { result: "ok" });
    expect(
      step(dir, "plan-reviewer", "101", { result: "ok", verdict: "request_changes" }).phase,
    ).toBe("planning");
    step(dir, "planner", "102", { result: "ok" });
    const f = step(dir, "plan-reviewer", "103", { result: "ok", verdict: "request_changes" });
    expect(f.phase).toBe("blocked");
    expect(f.blocked_reason).toContain("plan_review_rounds_exceeded: 2/2");
    expect(phaseOf(dir).blocked_reason).toContain("plan_review_rounds_exceeded");
  });

  test("API エラーはステータス付きで blocked にする", () => {
    const dir = makeRun();
    const f = step(dir, "planner", "100", { result: "api_error", api_error_status: 429 });
    expect(f.blocked_reason).toBe("api_error:429");
    expect(f.continue_chain).toBe(false);
  });

  test("正常系を一巡させる（承認を挟んで done まで）", () => {
    const dir = makeRun();
    step(dir, "planner", "1", { result: "ok" });
    step(dir, "plan-reviewer", "2", { result: "ok", verdict: "approve" });
    expect(phaseOf(dir).phase).toBe("awaiting_human");
    expect(routeRun({ dir, config: c }).action).toBe("none");

    expect(approveRun({ dir, config: c, association: "OWNER" })).toEqual({
      ok: true,
      phase: "developing",
    });
    step(dir, "developer", "3", { result: "ok" });
    step(dir, "dev-reviewer", "4", { result: "ok", verdict: "approve" });
    const last = step(dir, "completion", "5", { result: "ok", acceptance_passed: true });

    expect(last.phase).toBe("done");
    expect(last.continue_chain).toBe(false); // 終端なので [skip ci] を付ける
    expect(routeRun({ dir, config: c }).total_steps).toBe(5);
  });
});

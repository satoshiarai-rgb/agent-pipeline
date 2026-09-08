import { afterEach, describe, expect, test } from "bun:test";
import { cleanupRuns, cli, makeRun, start } from "../../__tests__/runDirFixture.ts";

afterEach(cleanupRuns);

interface Finished {
  phase: string;
  blocked_reason: string | null;
  result: string;
  detail: string | null;
}

const finish = (dir: string, run_id: string, args: Record<string, string> = {}) =>
  cli("finish", { dir, "run-id": run_id, attempt: "1", ...args }) as Finished;

/**
 * `finish` は成果物の検査（契約 §4）も自分で行う。**検査する相手は引数ではなく
 * `start` が記録した in_flight** で、検査が落ちても state は書いて `blocked` にする。
 */
describe("finish（検査する相手は store が知っている）", () => {
  test("start が記録したエージェントの契約で検査する", () => {
    const dir = makeRun();
    start(dir, "planner", "1000");
    // 成果物を何も置いていないので planner の契約（plan.md）を満たさない
    const finished = finish(dir, "1000");
    expect(finished.phase).toBe("blocked");
    expect(finished.blocked_reason).toBe("invalid_artifacts: plan.md が無いか空");
  });

  test("start が無ければ検査対象が決まらない", () => {
    const dir = makeRun();
    const finished = finish(dir, "1001");
    expect(finished.result).toBe("invalid");
    expect(finished.blocked_reason).toBe(
      "invalid_artifacts: 実行が記録されていない（start が無い）",
    );
  });

  test("契約チェッカが落ちても state は書く（run を無音で止めない）", () => {
    const dir = makeRun();
    start(dir, "planner", "1002");
    // 差分の一覧が読めない（ワークフローが渡したパスが無い）→ 検査が例外を投げる
    const finished = finish(dir, "1002", { "changed-files": "/nonexistent/changed.txt" });
    expect(finished.phase).toBe("blocked");
    expect(finished.blocked_reason).toContain("validate_crashed");
  });
});

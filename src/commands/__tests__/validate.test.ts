import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../__tests__/helpers.ts";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import { validateRun } from "../validate.ts";

const c = config();
afterEach(cleanupRuns);

const write = (dir: string, rel: string, text: string) => {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
};

const acceptance = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    criteria: [
      {
        id: "AC-1",
        description: "ダミー",
        verification: "manual",
        status: "pending",
        evidence: null,
        ...over,
      },
    ],
  });

const plan = "# 計画\n\n## 規模判定\n\n- 変更ファイル数見込み: 2\n- 上限（10）以内: yes\n";

describe("実行そのものの失敗", () => {
  test("step が失敗していれば agent_failed", () => {
    const r = validateRun({ dir: makeRun(), config: c, agent: "planner", agent_failed: true });
    expect(r.result).toBe("agent_failed");
  });

  test("実行ログに api_error があればステータス付きで返す（成果物より先に見る / A-31）", () => {
    const dir = makeRun();
    const log = write(
      dir,
      "log.json",
      JSON.stringify([{ type: "result", terminal_reason: "api_error", api_error_status: 429 }]),
    );
    const r = validateRun({
      dir,
      config: c,
      agent: "planner",
      agent_failed: true,
      execution_file: log,
    });
    expect(r).toEqual({ result: "api_error", api_error_status: 429 });
  });

  test("正常終了した実行ログでは api_error にしない", () => {
    const dir = makeRun();
    write(dir, "plan.md", plan);
    write(dir, "acceptance.json", acceptance());
    const log = write(
      dir,
      "log.json",
      JSON.stringify([{ type: "result", terminal_reason: "completed" }]),
    );
    expect(validateRun({ dir, config: c, agent: "planner", execution_file: log }).result).toBe(
      "ok",
    );
  });
});

describe("planner", () => {
  test("plan.md と acceptance.json が揃えば ok", () => {
    const dir = makeRun();
    write(dir, "plan.md", plan);
    write(dir, "acceptance.json", acceptance());
    expect(validateRun({ dir, config: c, agent: "planner" })).toEqual({ result: "ok" });
  });

  test("plan.md が無い / 空なら invalid", () => {
    const dir = makeRun();
    write(dir, "acceptance.json", acceptance());
    expect(validateRun({ dir, config: c, agent: "planner" }).detail).toContain("plan.md");
    write(dir, "plan.md", "   \n");
    expect(validateRun({ dir, config: c, agent: "planner" }).detail).toContain("plan.md");
  });

  test("規模判定の節が無ければ invalid（契約 §4）", () => {
    const dir = makeRun();
    write(dir, "plan.md", "# 計画\n\n中身だけ書いた\n");
    write(dir, "acceptance.json", acceptance());
    expect(validateRun({ dir, config: c, agent: "planner" }).detail).toContain("規模判定");
  });

  test("規模超過なら oversize（実装に進まず issue の分割を促す）", () => {
    const dir = makeRun();
    write(
      dir,
      "plan.md",
      "# 計画\n\n## 規模判定\n\n- 上限（10）以内: no（上限超過）\n\n分割案: …\n",
    );
    write(dir, "acceptance.json", acceptance());
    expect(validateRun({ dir, config: c, agent: "planner" })).toEqual({
      result: "ok",
      oversize: true,
    });
  });

  test("acceptance.json が無ければ invalid", () => {
    const dir = makeRun();
    write(dir, "plan.md", plan);
    expect(validateRun({ dir, config: c, agent: "planner" }).detail).toContain("acceptance.json");
  });
});

describe("acceptance.json のスキーマ（契約 §4）", () => {
  const check = (over: Record<string, unknown>) => {
    const dir = makeRun();
    write(dir, "plan.md", plan);
    write(dir, "acceptance.json", acceptance(over));
    return validateRun({ dir, config: c, agent: "planner" }).detail ?? "";
  };

  test("automated なら command が必要", () => {
    expect(check({ verification: "automated" })).toContain("command");
  });

  test("passed にするなら evidence が必要", () => {
    expect(check({ status: "passed" })).toContain("evidence");
  });

  test("status の値を検査する", () => {
    expect(check({ status: "unknown" })).toContain("status");
  });

  test("id と description が必要", () => {
    expect(check({ id: "" })).toContain("id");
    expect(check({ description: "" })).toContain("description");
  });

  test("壊れた JSON はその旨を返す", () => {
    const dir = makeRun();
    write(dir, "plan.md", plan);
    write(dir, "acceptance.json", "{ criteria: [] }");
    expect(validateRun({ dir, config: c, agent: "planner" }).detail).toContain("解析に失敗");
  });
});

describe("レビュアー", () => {
  const review = (verdict: string) =>
    `---\nverdict: ${verdict}\nround: 1\nreviewer: x\n---\n\n本文\n`;

  test("frontmatter の verdict を返す", () => {
    const dir = makeRun();
    write(dir, "reviews/plan-01.md", review("approve"));
    expect(validateRun({ dir, config: c, agent: "plan-reviewer" })).toEqual({
      result: "ok",
      verdict: "approve",
    });
  });

  test("直近のレビューを見る（差し戻し 2 回目）", () => {
    const dir = makeRun();
    write(dir, "reviews/plan-01.md", review("request_changes"));
    write(dir, "reviews/plan-02.md", review("approve"));
    expect(validateRun({ dir, config: c, agent: "plan-reviewer" }).verdict).toBe("approve");
  });

  test("dev-reviewer は dev-NN.md を見る", () => {
    const dir = makeRun();
    write(dir, "reviews/plan-01.md", review("approve"));
    write(dir, "reviews/dev-01.md", review("request_changes"));
    expect(validateRun({ dir, config: c, agent: "dev-reviewer" }).verdict).toBe("request_changes");
  });

  test("レビューが無ければ invalid", () => {
    expect(validateRun({ dir: makeRun(), config: c, agent: "plan-reviewer" }).detail).toContain(
      "reviews/plan-NN.md",
    );
  });

  test("verdict が無い / 不正なら invalid", () => {
    const dir = makeRun();
    write(dir, "reviews/plan-01.md", "本文だけ書いた\n");
    expect(validateRun({ dir, config: c, agent: "plan-reviewer" }).detail).toContain("verdict");
    write(dir, "reviews/plan-01.md", review("lgtm"));
    expect(validateRun({ dir, config: c, agent: "plan-reviewer" }).detail).toContain("verdict");
  });
});

describe("developer", () => {
  const setup = () => {
    const dir = makeRun();
    write(dir, "acceptance.json", acceptance({ status: "passed", evidence: "テストが通った" }));
    return dir;
  };

  test("差分があれば ok", () => {
    expect(
      validateRun({
        dir: setup(),
        config: c,
        agent: "developer",
        changed_files: ["src/auth.ts", "src/__tests__/auth.test.ts"],
      }),
    ).toEqual({ result: "ok" });
  });

  test("差分が無ければ invalid", () => {
    expect(
      validateRun({ dir: setup(), config: c, agent: "developer", changed_files: [] }).detail,
    ).toContain("差分");
  });

  test(".github/workflows を触っていれば invalid（K-4）", () => {
    const r = validateRun({
      dir: setup(),
      config: c,
      agent: "developer",
      changed_files: ["src/auth.ts", ".github/workflows/ci.yml"],
    });
    expect(r.detail).toContain(".github/workflows");
  });

  test("passed にした項目に evidence が無ければ invalid", () => {
    const dir = makeRun();
    write(dir, "acceptance.json", acceptance({ status: "passed" }));
    expect(
      validateRun({ dir, config: c, agent: "developer", changed_files: ["src/a.ts"] }).detail,
    ).toContain("evidence");
  });
});

describe("completion", () => {
  test("全 passed なら acceptance_passed: true", () => {
    const dir = makeRun();
    write(dir, "completion.md", "# 完了報告\n");
    write(dir, "acceptance.json", acceptance({ status: "passed", evidence: "確認した" }));
    expect(validateRun({ dir, config: c, agent: "completion" })).toEqual({
      result: "ok",
      acceptance_passed: true,
    });
  });

  test("pending が残っていれば acceptance_passed: false", () => {
    const dir = makeRun();
    write(dir, "completion.md", "# 完了報告\n");
    write(dir, "acceptance.json", acceptance());
    expect(validateRun({ dir, config: c, agent: "completion" }).acceptance_passed).toBe(false);
  });

  test("completion.md が無ければ invalid", () => {
    const dir = makeRun();
    write(dir, "acceptance.json", acceptance({ status: "passed", evidence: "x" }));
    expect(validateRun({ dir, config: c, agent: "completion" }).detail).toContain("completion.md");
  });
});

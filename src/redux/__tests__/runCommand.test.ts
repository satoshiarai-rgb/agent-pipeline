import { describe, expect, test } from "bun:test";
import { cli, makeRun, start } from "../../__tests__/runDirFixture.ts";

interface Validated {
  result: string;
  detail?: string;
}

describe("validate（検査する相手は store が知っている）", () => {
  test("start が記録したエージェントの契約で検査する。--agent は見ない", () => {
    const dir = makeRun();
    start(dir, "planner", "1000");
    // 成果物が何も無いので planner の契約（plan.md）を満たさない。
    // 別のエージェントを --agent で渡しても、検査は in_flight の planner のまま
    const validated = cli("validate", { dir, agent: "completion" }) as Validated;
    expect(validated.result).toBe("invalid");
    expect(validated.detail).toContain("plan.md");
  });

  test("start が無ければ検査対象が決まらない", () => {
    const validated = cli("validate", { dir: makeRun() }) as Validated;
    expect(validated).toEqual({
      result: "invalid",
      detail: "実行が記録されていない（start が無い）",
    });
  });
});

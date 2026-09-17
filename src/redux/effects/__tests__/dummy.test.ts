import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { journalProblems, routeJournal } from "../../../file/journal.ts";
import { defaultSettings } from "../../../pipelineSettings.ts";
import type { AgentName } from "../../../types.ts";
import { readScenario, type Scenario, writeDummyArtifacts } from "../dummy.ts";
import { validateRun } from "../validate.ts";

/**
 * お試し実行（dry run）のダミー。**本番と同じ `validate` に掛けて確かめる** —
 * ここが通らないと dry run が `blocked` で止まる（I-9d）。
 */
describe("dry run のダミーエージェント", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const makeRun = (scenario?: Scenario) => {
    const repo = mkdtempSync(join(tmpdir(), "dummy-"));
    dirs.push(repo);
    const dir = join(repo, "agent-work/issue-1");
    mkdirSync(dir, { recursive: true });
    if (scenario) Bun.write(join(dir, "scenario"), `${scenario}\n`);
    return { repo, dir };
  };

  /** 1 フェーズ分を書く */
  const run = (r: { repo: string; dir: string }, agent: AgentName, scenario: Scenario = "happy") =>
    writeDummyArtifacts(agent, { dir: r.dir, scenario, run_id: "1", attempt: 1, repo: r.repo });

  /** 直近のレビューの verdict。ハーネスが読むのも frontmatter のこの 1 行だけ */
  function verdictOf(dir: string, kind: "plan" | "dev"): string {
    const reviews = join(dir, "reviews");
    if (!existsSync(reviews)) return "";
    const last = readdirSync(reviews)
      .filter((n) => n.startsWith(`${kind}-`))
      .sort()
      .at(-1);
    if (!last) return "";
    return /^verdict: (\S+)$/m.exec(readFileSync(join(reviews, last), "utf8"))?.[1] ?? "";
  }

  test("全フェーズが成果物を書く", () => {
    const r = makeRun();
    for (const agent of [
      "planner",
      "plan-reviewer",
      "developer",
      "dev-reviewer",
      "completion",
    ] as const) {
      expect(run(r, agent).length, agent).toBeGreaterThan(0);
    }
    expect(readdirSync(r.dir).sort()).toEqual([
      "acceptance.json",
      "completion.md",
      "journal",
      "plan.md",
      "reviews",
    ]);
    expect(readdirSync(join(r.dir, "reviews")).sort()).toEqual(["dev-01.md", "plan-01.md"]);
  });

  /**
   * 置き場の振り分け（`routeJournal`）は `finish` の一部なので、ダミーが判断の記録を
   * 書かないとドライランで一度も通らない。**`easy` と `hard` を 1 件ずつ**書く
   */
  test("planner は判断の記録を easy と hard で 1 件ずつ書く（振り分けをドライランでも通す）", () => {
    const r = makeRun();
    run(r, "planner");

    expect(readdirSync(join(r.dir, "journal")).sort()).toEqual([
      "1-1-dummy-easy.md",
      "1-1-dummy-hard.md",
    ]);
    expect(journalProblems(r.dir)).toEqual([]);
    expect(routeJournal(r.dir).map((p) => p.replace(`${r.dir}/`, ""))).toEqual([
      "decision-records/1-1-dummy-hard.md",
    ]);
    expect(readdirSync(join(r.dir, "journal"))).toEqual(["1-1-dummy-easy.md"]);
  });

  test("acceptance.json は妥当な JSON で、developing で passed になる", () => {
    const r = makeRun();
    run(r, "planner");
    const path = join(r.dir, "acceptance.json");
    expect(JSON.parse(readFileSync(path, "utf8")).criteria[0].status).toBe("pending");
    run(r, "developer");
    const after = JSON.parse(readFileSync(path, "utf8")).criteria[0];
    expect(after.status).toBe("passed");
    expect(after.evidence).toBe("ダミー実行");
  });

  test("レビュアーのフェーズだけレビューファイルを書く", () => {
    const r = makeRun();
    run(r, "planner");
    expect(verdictOf(r.dir, "plan")).toBe("");
    run(r, "plan-reviewer");
    expect(verdictOf(r.dir, "plan")).toBe("approve");
    run(r, "developer");
    expect(verdictOf(r.dir, "dev")).toBe("");
    run(r, "dev-reviewer");
    expect(verdictOf(r.dir, "dev")).toBe("approve");
  });

  test("scenario=plan-changes は 1 回目だけ差し戻す", () => {
    const r = makeRun();
    run(r, "plan-reviewer", "plan-changes");
    expect(verdictOf(r.dir, "plan")).toBe("request_changes");
    run(r, "plan-reviewer", "plan-changes");
    expect(verdictOf(r.dir, "plan")).toBe("approve");
    expect(readdirSync(join(r.dir, "reviews")).sort()).toEqual(["plan-01.md", "plan-02.md"]);
  });

  test("scenario=plan-loop は常に差し戻す（ラウンド上限で blocked になる）", () => {
    const r = makeRun();
    run(r, "plan-reviewer", "plan-loop");
    run(r, "plan-reviewer", "plan-loop");
    expect(verdictOf(r.dir, "plan")).toBe("request_changes");
  });

  test("scenario ファイルが無ければ happy として扱う", () => {
    const r = makeRun();
    expect(readScenario(r.dir)).toBe("happy");
  });

  test("ダミーの成果物が契約を満たす（dry run でも validate を通る / I-9d）", () => {
    const r = makeRun();
    const v = (agent: AgentName, changed: string[] = []) =>
      validateRun({ dir: r.dir, settings: defaultSettings, agent, changed_files: changed });

    run(r, "planner");
    expect(v("planner")).toEqual({ result: "ok" });

    run(r, "plan-reviewer");
    expect(v("plan-reviewer")).toEqual({ result: "ok", verdict: "approve" });

    run(r, "developer");
    expect(v("developer", ["dummy-src/change-1.txt"])).toEqual({ result: "ok" });
    // 差分の一覧が空なら developer は invalid（実装していないのと同じ）
    expect(v("developer").result).toBe("invalid");

    run(r, "dev-reviewer");
    expect(v("dev-reviewer")).toEqual({ result: "ok", verdict: "approve" });

    run(r, "completion");
    expect(v("completion")).toEqual({ result: "ok", acceptance_passed: true });
  });

  test("レビューの frontmatter に verdict が入る（ハーネスが読む唯一の値）", () => {
    const r = makeRun();
    run(r, "plan-reviewer");
    const md = readFileSync(join(r.dir, "reviews/plan-01.md"), "utf8");
    expect(md.startsWith("---\nverdict: approve\n")).toBe(true);
    expect(md).toContain("reviewer: plan-reviewer");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { settings } from "../../../__tests__/helpers.ts";
import {
  cleanupRuns,
  cli,
  makeBlocked,
  makeRun,
  runOnce,
} from "../../../__tests__/runDirFixture.ts";

const c = settings();
afterEach(cleanupRuns);

/** CLI と同じ経路で読む（store がスナップショットから状態を組み立てる） */
const explain = (dir: string) =>
  cli("explain", { dir }, c) as { markdown: string; reason: string } | null;

/** 理由を直接与えて案内だけを見る */
const blocked = (reason: string) => makeBlocked(reason);

const acceptance = (dir: string, criteria: unknown[]) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "acceptance.json"), JSON.stringify({ criteria }));
};

describe("人間に手番が回ったときだけ案内を返す", () => {
  test("エージェントが走っている途中は null（コメントしない）", () => {
    expect(explain(makeRun("planning"))).toBeNull();
    expect(explain(makeRun("dev_review"))).toBeNull();
  });

  test("理由をそのまま載せる（人間が追えるように）", () => {
    const r = explain(blocked("agent_failed"));
    expect(r?.reason).toBe("agent_failed");
    expect(r?.markdown).toContain("blocked_reason: agent_failed");
  });
});

describe("理由ごとの案内（上から順に最初に一致したもの）", () => {
  test("acceptance_not_passed: 未達の項目を表にして手順を出す", () => {
    const dir = blocked("acceptance_not_passed");
    acceptance(dir, [
      { id: "AC-1", description: "テストが通る", verification: "automated", status: "passed" },
      {
        id: "AC-2",
        description: "設置して 1 セッション動かす",
        verification: "manual",
        status: "failed",
        evidence: "代替検証は済み",
      },
    ]);

    const md = explain(dir)?.markdown ?? "";
    // 未達の項目だけを載せる
    expect(md).toContain("`AC-2`");
    expect(md).toContain("設置して 1 セッション動かす");
    expect(md).toContain("代替検証は済み");
    expect(md).not.toContain("`AC-1`");
    // manual の手順と、evidence が必須であること
    expect(md).toContain("manual");
    expect(md).toContain("evidence");
    expect(md).toContain("/agent retry");
    // 実装を直す必要があるときは retry では戻れないことを書く
    expect(md).toContain("developing");
  });

  test("acceptance.json が無くても落ちない", () => {
    expect(explain(blocked("acceptance_not_passed"))?.markdown).toContain("/agent retry");
  });

  test("上限で止まったものは retry を案内しない（やり直しても止まる）", () => {
    const md = explain(blocked("plan_review_rounds_exceeded: 5/5"))?.markdown ?? "";
    expect(md).toContain("受け付けません");
    expect(md).toContain("issue を分けて立て直す");
    expect(md).not.toContain("`/agent retry` とコメントする");
  });

  test("config_invalid は直す場所（.agent/config.json）と規則を案内する", () => {
    const md =
      explain(blocked("config_invalid: .agent/config.json: limits.plan_rounds: 既定にないキーです"))
        ?.markdown ?? "";
    expect(md).toContain(".agent/config.json");
    expect(md).toContain("null");
    expect(md).toContain("/agent retry");
  });

  test("版の不一致は「揃えれば解ける」と案内する（導出される停止 / K-26）", () => {
    const md = explain(blocked("pipeline_version_mismatch: run=1 harness=2"))?.markdown ?? "";
    expect(md).toContain("pipeline_version");
    expect(md).toContain("続きから動きます");
    expect(md).not.toContain("state.json");
  });

  test("invalid_artifacts / missing_verdict / api_error はそれぞれの案内になる", () => {
    expect(explain(blocked("invalid_artifacts: plan.md が無いか空"))?.markdown).toContain("契約");
    expect(explain(blocked("missing_verdict"))?.markdown).toContain("verdict");
    expect(explain(blocked("api_error:429"))?.markdown).toContain("使用量");
  });

  test("知らない理由でも一般的な手順を返す", () => {
    const md = explain(blocked("なにか未知の理由"))?.markdown ?? "";
    expect(md).toContain("止まりました");
    expect(md).toContain("/agent retry");
  });
});

describe("実際の停止と繋がっている", () => {
  test("completing の全 passed でない停止で、案内が出る", () => {
    const dir = makeRun("completing");
    acceptance(dir, [
      { id: "AC-1", description: "手で確かめる", verification: "manual", status: "pending" },
    ]);
    runOnce(dir, "completion", { result: "ok", acceptance_passed: false });

    const md = explain(dir)?.markdown ?? "";
    expect(md).toContain("acceptance_not_passed");
    expect(md).toContain("`AC-1`");
  });
});

/**
 * 人間の手番は blocked のほかに 2 つある。**その時点で読む価値のある成果物**を
 * リンクにして添える（無いものは落ちる）。
 */
describe("承認待ちと完了の案内（成果物へのリンク）", () => {
  const explainAt = (dir: string, slug: string | null = "owner/repo") =>
    cli("explain", { dir, "repo-slug": slug ?? undefined }, c) as {
      markdown: string;
      reason: string;
    } | null;

  test("awaiting_human: 計画・受け入れ条件・レビューを並べ、使えるコマンドを出す", () => {
    const guide = explainAt(makeRun("awaiting_human"));
    expect(guide?.reason).toBe("awaiting_human");
    expect(guide?.markdown).toContain("計画ができました");
    expect(guide?.markdown).toContain("/agent approve");
    expect(guide?.markdown).toContain("/agent request-changes");
    // plan-reviewer が書いたレビューと planner の成果物がリンクになる
    expect(guide?.markdown).toContain("plan.md");
    expect(guide?.markdown).toContain("acceptance.json");
    expect(guide?.markdown).toContain("reviews/plan-01.md");
  });

  test("done: 完了報告と判断の記録を並べ、差し戻しが無いことを書く", () => {
    const guide = explainAt(makeRun("done"));
    expect(guide?.reason).toBe("done");
    expect(guide?.markdown).toContain("実装が終わりました");
    expect(guide?.markdown).toContain("completion.md");
    expect(guide?.markdown).toContain("reviews/dev-01.md");
    expect(guide?.markdown).toContain("通常の PR レビュー");
  });

  test("リンクはブランチを指す。repo-slug が無いか絶対パスならパスだけ出す", () => {
    const dir = makeRun("awaiting_human");
    // 表示名は run ディレクトリからの相対パス
    expect(explainAt(dir)?.markdown).toContain("- `plan.md`");
    expect(explainAt(dir, null)?.markdown).not.toContain("https://github.com");
    // ワークフローが渡すのはリポジトリ相対の dir（agent-work/issue-<n>）。その形なら URL になる
    const cwd = process.cwd();
    try {
      process.chdir(dirname(dir));
      const guide = explainAt(basename(dir));
      expect(guide?.markdown).toContain(
        `https://github.com/owner/repo/blob/claude/issue-123/${basename(dir)}/plan.md`,
      );
    } finally {
      process.chdir(cwd);
    }
  });
});

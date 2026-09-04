import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parse } from "yaml";

/**
 * ワークフローの run: ブロックと、action の実体（scripts/run-cli.sh）を検査する。
 * .github/ 配下に置くと bun test の既定スキャン（ドットで始まるディレクトリを飛ばす）に
 * 乗らないため、ここに置いている。
 * GitHub に push してからでないと分からない失敗を、ローカルで捕まえるのが目的。
 * 実際に踏んだ失敗:
 *   - heredoc の終端子のインデント（YAML のブロックスカラーと二重の制約）
 *   - `ls 存在しない | wc -l` が pipefail で失敗し set -e がステップを殺す
 */
const ROOT = join(import.meta.dir, "../..");
const CENTRAL = join(ROOT, ".github/workflows");
const VERIFY = join(ROOT, "work/verify");

interface Step {
  id?: string;
  name?: string;
  run?: string;
}
interface Job {
  steps?: Step[];
}
interface Doc {
  name?: string;
  jobs?: Record<string, Job>;
}
interface Workflow {
  name: string;
  path: string;
  doc: Doc;
}

/** 中央の reusable workflow と、配布先に置く検証用ラッパーを集める */
function workflows(): Workflow[] {
  const files = [
    ...readdirSync(CENTRAL)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => join(CENTRAL, f)),
    ...readdirSync(VERIFY, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(join(VERIFY, d.name))
          .filter((f) => f.endsWith(".yml"))
          .map((f) => join(VERIFY, d.name, f)),
      ),
  ];
  return files.map((path) => ({
    name: basename(path),
    path,
    doc: parse(readFileSync(path, "utf8")) as Doc,
  }));
}

const all = workflows();

/** run: ブロックを (ワークフロー名, ステップ名, スクリプト) の組で列挙する */
function runBlocks(): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const wf of all) {
    for (const [job, cfg] of Object.entries(wf.doc.jobs ?? {})) {
      for (const [i, step] of (cfg.steps ?? []).entries()) {
        if (step.run) out.push([wf.name, `${job}#${step.id ?? step.name ?? i}`, step.run]);
      }
    }
  }
  return out;
}

describe("ワークフローの YAML", () => {
  test("すべてパースでき、name と on を持つ", () => {
    expect(all.length).toBeGreaterThan(3);
    for (const wf of all) {
      const doc = wf.doc as unknown as Record<string, unknown>;
      expect(doc.name, wf.name).toBeString();
      // YAML は on: を真偽値 true としてパースする
      expect(doc.on ?? doc[true as unknown as string], wf.name).toBeDefined();
    }
  });

  test("ファイル名と name: が一致している（コピーの事故を防ぐ）", () => {
    for (const wf of all.filter((w) => w.name.startsWith("check-"))) {
      expect(wf.doc.name, wf.name).toBe(wf.name.replace(/\.yml$/, ""));
    }
  });

  test("中央 action の参照はすべて同じ ref を使う（A-11 の版ずれ防止）", () => {
    const refs = new Set<string>();
    for (const wf of all) {
      for (const m of readFileSync(wf.path, "utf8").matchAll(
        /satoshiarai-rgb\/agent-pipeline\S*@(\S+)/g,
      )) {
        refs.add(m[1] as string);
      }
    }
    expect([...refs]).toEqual(["main"]);
  });
});

describe("run: ブロックのシェル構文", () => {
  const blocks = runBlocks();

  test("ブロックが 10 個以上ある（列挙が壊れていない）", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  for (const [wf, step, script] of blocks) {
    test(`${wf} ${step}`, () => {
      const f = join(mkdtempSync(join(tmpdir(), "wf-")), "s.sh");
      writeFileSync(f, script);
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      expect(r.stderr, `${wf} ${step}`).toBe("");
      expect(r.status).toBe(0);
    });
  }
});

describe("dry run のダミーエージェント（実際に走らせる）", () => {
  const dispatch = all.find((w) => w.path === join(CENTRAL, "dispatch.yml"));
  const script = dispatch?.doc.jobs?.run?.steps?.find((s) => s.id === "agent")?.run;
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** 1 フェーズ分を実行し、GITHUB_OUTPUT の verdict を返す */
  function runPhase(dir: string, phase: string, agent: string): { verdict: string; ok: boolean } {
    const out = join(dir, "out.txt");
    const f = join(dir, "agent.sh");
    writeFileSync(f, script as string);
    const r = spawnSync("bash", [f], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        D: "agent-work/issue-1",
        PHASE: phase,
        AGENT: agent,
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        GITHUB_RUN_ID: "1",
      },
    });
    const verdict =
      readFileSync(out, "utf8")
        .split("\n")
        .filter((l) => l.startsWith("verdict="))
        .pop()
        ?.slice("verdict=".length) ?? "";
    return { verdict, ok: r.status === 0 };
  }

  const makeRun = (scenario?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "wf-run-"));
    dirs.push(dir);
    const D = join(dir, "agent-work/issue-1");
    spawnSync("mkdir", ["-p", D]);
    if (scenario) writeFileSync(join(D, "scenario"), `${scenario}\n`);
    writeFileSync(join(dir, "out.txt"), "");
    return dir;
  };

  test("ステップが取り出せている", () => {
    expect(script).toBeString();
    expect(script).toContain("write_acceptance");
  });

  test("reviews/ が無い状態から全フェーズが成功する（pipefail で死なない）", () => {
    const dir = makeRun("happy");
    const phases: [string, string][] = [
      ["planning", "planner"],
      ["plan_review", "plan-reviewer"],
      ["developing", "developer"],
      ["dev_review", "dev-reviewer"],
      ["completing", "completion"],
    ];
    for (const [phase, agent] of phases) {
      expect(runPhase(dir, phase, agent).ok, phase).toBe(true);
    }
    const D = join(dir, "agent-work/issue-1");
    expect(readdirSync(D).sort()).toEqual([
      "acceptance.json",
      "completion.md",
      "plan.md",
      "reviews",
      "scenario",
    ]);
    expect(readdirSync(join(D, "reviews")).sort()).toEqual(["dev-01.md", "plan-01.md"]);
  });

  test("acceptance.json は妥当な JSON で、developing で passed になる", () => {
    const dir = makeRun("happy");
    runPhase(dir, "planning", "planner");
    const path = join(dir, "agent-work/issue-1/acceptance.json");
    expect(JSON.parse(readFileSync(path, "utf8")).criteria[0].status).toBe("pending");
    runPhase(dir, "developing", "developer");
    const after = JSON.parse(readFileSync(path, "utf8")).criteria[0];
    expect(after.status).toBe("passed");
    expect(after.evidence).toBe("ダミー実行");
  });

  test("レビュアーのフェーズだけ verdict を出す", () => {
    const dir = makeRun("happy");
    expect(runPhase(dir, "planning", "planner").verdict).toBe("");
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("approve");
    expect(runPhase(dir, "developing", "developer").verdict).toBe("");
    expect(runPhase(dir, "dev_review", "dev-reviewer").verdict).toBe("approve");
  });

  test("scenario=plan-changes は 1 回目だけ差し戻す", () => {
    const dir = makeRun("plan-changes");
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("request_changes");
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("approve");
    expect(readdirSync(join(dir, "agent-work/issue-1/reviews")).sort()).toEqual([
      "plan-01.md",
      "plan-02.md",
    ]);
  });

  test("scenario=plan-loop は常に差し戻す（ラウンド上限で blocked になる）", () => {
    const dir = makeRun("plan-loop");
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("request_changes");
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("request_changes");
  });

  test("scenario ファイルが無ければ happy として扱う", () => {
    const dir = makeRun();
    expect(runPhase(dir, "plan_review", "plan-reviewer").verdict).toBe("approve");
  });

  test("レビューファイルの frontmatter に verdict が入る（ハーネスが読む唯一の値）", () => {
    const dir = makeRun("happy");
    runPhase(dir, "plan_review", "plan-reviewer");
    const md = readFileSync(join(dir, "agent-work/issue-1/reviews/plan-01.md"), "utf8");
    expect(md.startsWith("---\nverdict: approve\n")).toBe(true);
    expect(md).toContain("reviewer: plan-reviewer");
  });
});

describe("scripts/run-cli.sh（action の実体）", () => {
  test("シェル構文が通る", () => {
    const r = spawnSync("bash", ["-n", join(ROOT, "scripts/run-cli.sh")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("空の入力を引数に渡さない（CLI 側で未指定として扱わせる）", () => {
    const sh = readFileSync(join(ROOT, "scripts/run-cli.sh"), "utf8");
    expect(sh).toContain('[ -n "${2:-}" ] && args+=("$1" "$2")');
  });
});

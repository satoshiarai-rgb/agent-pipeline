import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { defaultSettings, validateRun } from "../../src/index.ts";
import type { AgentName } from "../../src/types.ts";

/**
 * ワークフローの run: ブロックと、action の実体（scripts/run-cli.sh）を検査する。
 * .github/ 配下に置くと bun test の既定スキャン（ドットで始まるディレクトリを飛ばす）に
 * 乗らないため、ここに置いている。
 * GitHub に push してからでないと分からない失敗を、ローカルで捕まえるのが目的。
 * 実際に踏んだ失敗:
 *   - heredoc の終端子のインデント（YAML のブロックスカラーと二重の制約）
 *   - `ls 存在しない | wc -l` が pipefail で失敗し set -e がステップを殺す
 *   - 式の中の算術（`fromJSON(...) + 10`）で startup failure（run 33902073957）
 */
const ROOT = join(import.meta.dir, "../..");
const CENTRAL = join(ROOT, ".github/workflows");
const VERIFY = join(ROOT, "work/verify");
/** 配布先に置くラッパーの原本。docs も検証用リポジトリもこれを参照する（A-51） */
const CALLER = join(ROOT, "install/agent-pipeline.yml");

interface Step {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  steps?: Step[];
}
interface Doc {
  name?: string;
  permissions?: Record<string, string>;
  jobs?: Record<string, CallerJob>;
}
interface CallerJob extends Job {
  uses?: string;
}
interface Workflow {
  name: string;
  path: string;
  doc: Doc;
}

/** 中央の reusable workflow と、配布先に置くラッパー（原本・検証用）を集める */
function workflows(): Workflow[] {
  const files = [
    CALLER,
    ...readdirSync(CENTRAL)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => join(CENTRAL, f)),
    ...readdirSync(VERIFY, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? readdirSync(join(VERIFY, d.name))
            .filter((f) => f.endsWith(".yml"))
            .map((f) => join(VERIFY, d.name, f))
        : d.name.endsWith(".yml")
          ? [join(VERIFY, d.name)]
          : [],
    ),
  ];
  return files.map((path) => ({
    name: basename(path),
    path,
    doc: parse(readFileSync(path, "utf8")) as Doc,
  }));
}

const all = workflows();

/** action の入力の宣言と、それを CLI に渡す実体 */
const ACTION = parse(readFileSync(join(ROOT, "action.yml"), "utf8")) as {
  inputs?: Record<string, unknown>;
};
const RUN_CLI = readFileSync(join(ROOT, "scripts/run-cli.sh"), "utf8");

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

  // 名前は `agent-` で始める（他のワークフローと混ざらないため / 2026-09-08）。
  // ファイル名と name: が食い違うと、run 一覧のどれがどのファイルか分からなくなる
  test("ファイル名と name: が一致している（コピーの事故を防ぐ）", () => {
    for (const wf of all) {
      expect(wf.doc.name, wf.name).toBe(wf.name.replace(/\.yml$/, ""));
    }
  });

  test("中央のワークフローと配布先のラッパーは agent- で始まる", () => {
    for (const wf of all.filter((w) => !w.name.startsWith("check-"))) {
      expect(wf.name.startsWith("agent-"), wf.name).toBe(true);
    }
  });

  test("中央リポジトリの参照はすべて同じ ref を使う（A-11 の版ずれ防止）", () => {
    const refs = new Set<string>();
    for (const wf of all) {
      const text = readFileSync(wf.path, "utf8");
      // uses: owner/repo/...@ref の形
      for (const m of text.matchAll(/satoshiarai-rgb\/agent-pipeline\S*@(\S+)/g)) {
        refs.add(m[1] as string);
      }
      // actions/checkout の repository: + ref: の形
      for (const m of text.matchAll(/repository: satoshiarai-rgb\/agent-pipeline\s+ref: (\S+)/g)) {
        refs.add(m[1] as string);
      }
    }
    expect([...refs]).toEqual(["main"]);
  });

  /**
   * composite action は**宣言していない `with:` を黙って捨てる**。
   * 実際に踏んだ失敗: `agent-bootstrap.yml` が `issue:` を渡していたが `action.yml` に
   * 入力が無く、CLI に `--issue` が届かないまま exit 2（run 34196607818）。
   */
  test("action に渡す with: のキーはすべて action.yml が宣言している", () => {
    const declared = Object.keys(ACTION.inputs ?? {});
    for (const wf of all) {
      for (const [job, cfg] of Object.entries(wf.doc.jobs ?? {})) {
        for (const step of cfg.steps ?? []) {
          if (!step.uses?.startsWith("satoshiarai-rgb/agent-pipeline@")) continue;
          for (const key of Object.keys(step.with ?? {})) {
            expect(declared, `${wf.name} ${job}: with.${key}`).toContain(key);
          }
        }
      }
    }
  });

  test("action.yml の入力はすべて run-cli.sh が CLI に渡す", () => {
    for (const key of Object.keys(ACTION.inputs ?? {})) {
      // command は位置引数、dir は必ず組み立てるので add を通らない
      if (key === "command" || key === "dir") continue;
      expect(RUN_CLI, `run-cli.sh に --${key} が無い`).toContain(`--${key}`);
    }
  });

  test("blocked で失敗させるステップは push より後", () => {
    // 先に失敗させると push とラベル更新がスキップされ、状態が git に載らないまま止まる
    for (const wf of all) {
      const steps = Object.values(wf.doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
      const failAt = steps.findIndex((st) => st.name?.includes("blocked を失敗として扱う"));
      if (failAt < 0) continue;
      const pushAt = steps.reduce((last, st, i) => (st.run?.includes("git push") ? i : last), -1);
      expect(failAt, wf.name).toBeGreaterThan(pushAt);
    }
  });

  test("中央リポジトリを .pipeline に取得するのは成果物の push より後", () => {
    // 先に取得すると .pipeline が git add -A で配布先にコミットされてしまう
    for (const wf of all) {
      const steps = Object.values(wf.doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
      const pipelineAt = steps.findIndex((st) => st.name?.includes(".pipeline"));
      if (pipelineAt < 0) continue;
      // git add -A を含むステップは複数あるので、最後のものと比べる
      const pushAt = steps.reduce((last, st, i) => (st.run?.includes("git add -A") ? i : last), -1);
      if (pushAt < 0) continue;
      expect(pipelineAt, wf.name).toBeGreaterThan(pushAt);
    }
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
  const dispatch = all.find((w) => w.path === join(CENTRAL, "agent-dispatch.yml"));
  const script = dispatch?.doc.jobs?.run?.steps?.find((s) => s.id === "dummy")?.run;
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** 1 フェーズ分を実行する */
  function runPhase(dir: string, phase: string, agent: string): { ok: boolean } {
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
        GITHUB_OUTPUT: join(dir, "out.txt"),
        GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        GITHUB_RUN_ID: "1",
      },
    });
    return { ok: r.status === 0 };
  }

  /**
   * 直近のレビューファイルの verdict。ハーネスもここを読む（frontmatter の 1 行だけ）。
   * ダミーの GITHUB_OUTPUT ではなく成果物から読むので、本番と同じ経路を検査できる
   */
  function verdictOf(dir: string, kind: "plan" | "dev"): string {
    const reviews = join(dir, "agent-work/issue-1/reviews");
    if (!existsSync(reviews)) return "";
    const last = readdirSync(reviews)
      .filter((n) => n.startsWith(`${kind}-`))
      .sort()
      .at(-1);
    if (!last) return "";
    return /^verdict: (\S+)$/m.exec(readFileSync(join(reviews, last), "utf8"))?.[1] ?? "";
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

  test("レビュアーのフェーズだけレビューファイルを書く", () => {
    const dir = makeRun("happy");
    runPhase(dir, "planning", "planner");
    expect(verdictOf(dir, "plan")).toBe("");
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("approve");
    runPhase(dir, "developing", "developer");
    expect(verdictOf(dir, "dev")).toBe("");
    runPhase(dir, "dev_review", "dev-reviewer");
    expect(verdictOf(dir, "dev")).toBe("approve");
  });

  test("scenario=plan-changes は 1 回目だけ差し戻す", () => {
    const dir = makeRun("plan-changes");
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("request_changes");
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("approve");
    expect(readdirSync(join(dir, "agent-work/issue-1/reviews")).sort()).toEqual([
      "plan-01.md",
      "plan-02.md",
    ]);
  });

  test("scenario=plan-loop は常に差し戻す（ラウンド上限で blocked になる）", () => {
    const dir = makeRun("plan-loop");
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("request_changes");
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("request_changes");
  });

  test("scenario ファイルが無ければ happy として扱う", () => {
    const dir = makeRun();
    runPhase(dir, "plan_review", "plan-reviewer");
    expect(verdictOf(dir, "plan")).toBe("approve");
  });

  test("ダミーの成果物が契約を満たす（dry run でも validate を通る / I-9d）", () => {
    // 本番と同じ validate に掛ける。ここが通らないと dry run が blocked で止まる
    const dir = makeRun("happy");
    const runDir = join(dir, "agent-work/issue-1");
    const v = (agent: AgentName, changed: string[] = []) =>
      validateRun({ dir: runDir, settings: defaultSettings, agent, changed_files: changed });

    runPhase(dir, "planning", "planner");
    expect(v("planner")).toEqual({ result: "ok" });

    runPhase(dir, "plan_review", "plan-reviewer");
    expect(v("plan-reviewer")).toEqual({ result: "ok", verdict: "approve" });

    runPhase(dir, "developing", "developer");
    expect(v("developer", ["dummy-src/change-1.txt"])).toEqual({ result: "ok" });
    // 差分の一覧が空なら developer は invalid（実装していないのと同じ）
    expect(v("developer").result).toBe("invalid");

    runPhase(dir, "dev_review", "dev-reviewer");
    expect(v("dev-reviewer")).toEqual({ result: "ok", verdict: "approve" });

    runPhase(dir, "completing", "completion");
    expect(v("completion")).toEqual({ result: "ok", acceptance_passed: true });
  });

  test("レビューファイルの frontmatter に verdict が入る（ハーネスが読む唯一の値）", () => {
    const dir = makeRun("happy");
    runPhase(dir, "plan_review", "plan-reviewer");
    const md = readFileSync(join(dir, "agent-work/issue-1/reviews/plan-01.md"), "utf8");
    expect(md.startsWith("---\nverdict: approve\n")).toBe(true);
    expect(md).toContain("reviewer: plan-reviewer");
  });
});

describe("規模超過の PR コメント（実際に走らせる）", () => {
  // 上限超過でも止めずに警告を出す（K-21）。heredoc が閉じるかを実行して確かめる
  const dispatch = all.find((w) => w.path === join(CENTRAL, "agent-dispatch.yml"));
  const step = dispatch?.doc.jobs?.run?.steps?.find((st) => st.name?.includes("規模超過"));
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("PR 番号を引いて、本文を --body-file で渡す", () => {
    expect(step?.run).toBeString();
    const dir = mkdtempSync(join(tmpdir(), "oversize-"));
    dirs.push(dir);
    const bin = join(dir, "bin");
    spawnSync("mkdir", ["-p", bin]);
    // gh のスタブ: pr list は番号を返し、pr comment は本文をそのまま出す
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\ncase "$2" in\n  list) echo 42 ;;\n' +
        '  comment) while [ "$1" != "--body-file" ]; do shift; done; cat "$2" ;;\nesac\n',
      { mode: 0o755 },
    );
    const f = join(dir, "s.sh");
    writeFileSync(f, step?.run as string);
    const r = spawnSync("bash", [f], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_REF_NAME: "claude/issue-11",
        RUNNER_TEMP: dir,
        RUN_DIR: "agent-work/issue-11",
        GITHUB_STEP_SUMMARY: join(dir, "sum"),
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("規模超過の警告");
    expect(r.stdout).toContain("agent-work/issue-11/plan.md");
    expect(r.stdout).toContain("作業は止めずに進めます");
    expect(r.stdout).toContain("::warning title=規模超過");
  });
});

describe("install/ の雛形（配布先にそのままコピーされる）", () => {
  // 壊れていても中央では何も起きず、コピーした配布先で初めて失敗するファイル。
  // issue フォームは GitHub 側の検証に落ちると issue を立てられなくなる
  const INSTALL = join(ROOT, "install");
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("install.sh が 4 ファイルを置き、既にあるものを壊さない（実際に走らせる）", () => {
    // bash -n では見つからない失敗を捕まえる（`$var` の直後に全角文字を書くと、
    // macOS の bash はそれを変数名の一部として読み、set -u で落ちる）。
    // 一時ディレクトリで git init するだけで、このリポジトリの git 状態には触らない
    const dir = mkdtempSync(join(tmpdir(), "install-"));
    dirs.push(dir);
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    const run = (...args: string[]) =>
      spawnSync("bash", [join(INSTALL, "install.sh"), ...args], { cwd: dir, encoding: "utf8" });

    const first = run();
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    const placed = [
      ".github/workflows/agent-pipeline.yml",
      ".agent/conventions.md",
      ".agent/setup.sh",
      ".github/ISSUE_TEMPLATE/agent-task.yml",
    ];
    for (const rel of placed) expect(existsSync(join(dir, rel)), rel).toBe(true);
    // setup.sh は実行できる状態で置く
    expect(statSync(join(dir, ".agent/setup.sh")).mode & 0o111).toBeGreaterThan(0);

    // 2 回目は既にあるものを飛ばす（人が書いた規約を上書きしない）
    writeFileSync(join(dir, ".agent/conventions.md"), "人が書いた規約");
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("skip");
    expect(readFileSync(join(dir, ".agent/conventions.md"), "utf8")).toBe("人が書いた規約");

    // --force なら上書きする
    expect(run("--force").status).toBe(0);
    expect(readFileSync(join(dir, ".agent/conventions.md"), "utf8")).toContain(
      "このリポジトリの規約",
    );
  });

  test("setup.sh のシェル構文が通る", () => {
    const r = spawnSync("bash", ["-n", join(INSTALL, "setup.sh")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("issue-template.yml が issue フォームの形をしている", () => {
    const doc = parse(readFileSync(join(INSTALL, "issue-template.yml"), "utf8")) as {
      name?: string;
      description?: string;
      body?: { type?: string; id?: string; attributes?: Record<string, unknown> }[];
    };
    expect(doc.name).toBeString();
    expect(doc.description).toBeString();
    expect(doc.body?.length).toBeGreaterThan(0);
    for (const field of doc.body ?? []) {
      // type と attributes.label は必須（markdown だけは label を持たない）
      expect(field.type, JSON.stringify(field)).toBeString();
      if (field.type !== "markdown") expect(field.attributes?.label).toBeString();
    }
  });

  test("README.md が置き場所の対応表を持つ", () => {
    const text = readFileSync(join(INSTALL, "README.md"), "utf8");
    for (const f of [
      "install.sh",
      "agent-pipeline.yml",
      "conventions.md",
      "setup.sh",
      "issue-template.yml",
    ]) {
      expect(text, f).toContain(f);
    }
    expect(text).toContain(".gitignore"); // A-46 の前提
  });
});

describe("scripts/run-cli.sh（action の実体）", () => {
  test("シェル構文が通る", () => {
    const r = spawnSync("bash", ["-n", join(ROOT, "scripts/run-cli.sh")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("改行を含む値はヒアドキュメント形式で GITHUB_OUTPUT に渡す（explain の markdown）", () => {
    // key=value 形式に混ぜると 2 行目以降が壊れる。実際に走らせて確かめる
    const dir = mkdtempSync(join(tmpdir(), "run-cli-"));
    const runDir = join(dir, "agent-work/issue-1");
    spawnSync("mkdir", ["-p", join(runDir, "events")]);
    // 状態の正はイベントログ。止まっている run は「失敗のイベント」で作る（K-26）
    writeFileSync(
      join(runDir, "events/0001-20260908T000000Z-1-1-bootstrap.json"),
      JSON.stringify({
        type: "agent-pipeline/BOOTSTRAP",
        payload: {
          timestamp: "20260908T000000Z",
          by: "harness",
          issue: 1,
          branch: "claude/issue-1",
          pipeline_version: 1,
        },
      }),
    );
    writeFileSync(
      join(runDir, "events/0002-20260908T000001Z-1-1-agent_failed.json"),
      JSON.stringify({
        type: "agent-pipeline/app/AGENT_FAILED",
        error: true,
        payload: {
          timestamp: "20260908T000001Z",
          by: "harness",
          run_id: "1",
          attempt: 1,
          reason: "acceptance_not_passed",
        },
      }),
    );
    const out = join(dir, "output.txt");
    const r = spawnSync("bash", [join(ROOT, "scripts/run-cli.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ACTION_PATH: ROOT,
        GITHUB_OUTPUT: out,
        CLI_COMMAND: "explain",
        CLI_DIR: runDir,
      },
    });
    expect(r.status).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("markdown<<MARKDOWN_EOF");
    expect(text).toContain("MARKDOWN_EOF\n");
    // markdown 自体は key=value 側に出さない（改行で壊れるため）
    expect(text).not.toContain("markdown=##");
    expect(text).toContain("reason=acceptance_not_passed");
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * 実際に踏んだ失敗（compass-wiki の run 34301459405）: `explain` は人間の手番でない
   * phase では `null` を返すが、`jq` は null からキーを取れず `exit 5` でステップが落ちた。
   * 状態の push は済んでいたので進行は止まらないが、run が赤くなる。
   */
  test("null を返すコマンドでも落ちず、output を書かない", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-cli-null-"));
    const runDir = join(dir, "agent-work/issue-2");
    spawnSync("mkdir", ["-p", join(runDir, "events")]);
    // bootstrap だけの run は phase=planning。人間の手番ではないので explain は null
    writeFileSync(
      join(runDir, "events/0001-20260908T000000Z-1-1-bootstrap.json"),
      JSON.stringify({
        type: "agent-pipeline/BOOTSTRAP",
        payload: {
          timestamp: "20260908T000000Z",
          by: "harness",
          issue: 2,
          branch: "claude/issue-2",
          pipeline_version: 2,
        },
      }),
    );
    const out = join(dir, "output.txt");
    const r = spawnSync("bash", [join(ROOT, "scripts/run-cli.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ACTION_PATH: ROOT,
        GITHUB_OUTPUT: out,
        CLI_COMMAND: "explain",
        CLI_DIR: runDir,
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("null");
    // output の書き出しに到達しないので、ファイル自体ができない
    expect(existsSync(out)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("空の入力を引数に渡さない（CLI 側で未指定として扱わせる）", () => {
    const sh = readFileSync(join(ROOT, "scripts/run-cli.sh"), "utf8");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: シェルの ${2:-} を文字列として検査する
    expect(sh).toContain('[ -n "${2:-}" ] && args+=("$1" "$2")');
  });
});

describe("呼び出し側の権限が中央のワークフローを満たしているか", () => {
  // reusable workflow は呼び出し側より広い権限を要求できない。
  // GitHub は実行時にしか教えてくれないので、ここで静的に確認する。
  const level = (v?: string) => (v === "write" ? 2 : v === "read" ? 1 : 0);
  const central = new Map<string, Record<string, string>>();
  for (const wf of all.filter((w) => w.path.includes("/.github/workflows/"))) {
    central.set(wf.name, wf.doc.permissions ?? {});
  }

  const callers = all.filter((w) => Object.values(w.doc.jobs ?? {}).some((j) => j.uses));

  test("uses: で中央を呼ぶワークフローが存在する", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  for (const caller of callers) {
    for (const [job, cfg] of Object.entries(caller.doc.jobs ?? {})) {
      const m = cfg.uses?.match(/\.github\/workflows\/([^@]+)@/);
      if (!m) continue;
      const callee = m[1] as string;
      test(`${caller.name} の ${job} → ${callee}`, () => {
        const need = central.get(callee);
        expect(need, `${callee} が見つからない`).toBeDefined();
        const have = caller.doc.permissions ?? {};
        for (const [scope, want] of Object.entries(need ?? {})) {
          expect(
            level(have[scope]),
            `${scope}: 呼び出し側が ${have[scope] ?? "none"}`,
          ).toBeGreaterThanOrEqual(level(want));
        }
      });
    }
  }
});

describe("式の書き方", () => {
  // 実際に踏んだ失敗（run 33902073957 は startup failure でジョブが 1 つも起動しなかった）。
  //   (Line: 66, Col: 22): Unexpected symbol: '+' ... fromJSON(...) + 10
  // GitHub の式には算術演算子が無い。計算はハーネス側で済ませて出力として渡す。
  // reusable workflow は呼び出し側の式もまとめて検証されるため、片方が壊れると全体が起動しない
  const files = all.map((wf) => ({ name: wf.name, text: readFileSync(wf.path, "utf8") }));

  for (const { name, text } of files) {
    test(`${name} の式に算術演算子が無い`, () => {
      const exprs = [...text.matchAll(/\$\{\{(.+?)\}\}/gs)].map((m) => m[1] as string);
      for (const e of exprs) {
        // 文字列リテラルの中（'a-b' や '10 + 20'）は除いてから見る
        const bare = e.replace(/'[^']*'/g, "''");
        expect(bare, `${name}: ${e.trim()}`).not.toMatch(/[\w)'\s][+*/](?![*/])|[\w)']\s-\s/);
      }
    });
  }
});

describe("gh コマンドの書き方", () => {
  // checkout より前のステップでは git remote が無く、gh はリポジトリを推測できない。
  // ステップの順序に依存しないよう、常に --repo を明示する規則にしている。
  for (const [wf, step, script] of runBlocks()) {
    const calls = [...script.matchAll(/gh (pr|issue|label|release) [^\n]*/g)].map((m) => m[0]);
    if (calls.length === 0) continue;
    test(`${wf} ${step} は --repo を明示している`, () => {
      for (const call of calls) {
        expect(call, `${wf} ${step}`).toContain("--repo");
      }
    });
  }
});

describe("PR コメントの解析（人間が書いた文字列の境界）", () => {
  const comment = all.find((w) => w.name === "agent-comment.yml");
  const parse = comment?.doc.jobs?.comment?.steps?.find((st) => st.id === "parse")?.run;
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** parse ステップを実行して GITHUB_OUTPUT を読む。gh はスタブに差し替える */
  function runParse(body: string): Record<string, string> {
    const dir = mkdtempSync(join(tmpdir(), "parse-"));
    dirs.push(dir);
    // gh pr view のスタブ（ネットワークに出ない）
    const bin = join(dir, "bin");
    spawnSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "gh"), "#!/bin/sh\necho claude/issue-1\n", { mode: 0o755 });
    const out = join(dir, "out.txt");
    writeFileSync(out, "");
    const script = join(dir, "parse.sh");
    writeFileSync(script, parse as string);
    spawnSync("bash", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BODY: body,
        PR: "2",
        GH_TOKEN: "dummy",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_OUTPUT: out,
      },
    });
    // GITHUB_OUTPUT の key=value と、ヒアドキュメント形式の値を読む
    const text = readFileSync(out, "utf8");
    const result: Record<string, string> = {};
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const heredoc = line.match(/^(\w+)<<(\w+)$/);
      if (heredoc) {
        const [, key, delim] = heredoc;
        const body: string[] = [];
        while (++i < lines.length && lines[i] !== delim) body.push(lines[i] as string);
        result[key as string] = body.join("\n");
        continue;
      }
      const kv = line.match(/^(\w+)=(.*)$/);
      if (kv) result[kv[1] as string] = kv[2] as string;
    }
    return result;
  }

  test("ステップが取り出せている", () => {
    expect(parse).toBeString();
  });

  test("CRLF 改行でもコマンドを取り出せる（GitHub のコメントは CRLF）", () => {
    expect(runParse("/agent approve\r\n").command).toBe("approve");
    expect(runParse("/agent request-changes 理由\r\n").command).toBe("request-changes");
  });

  test("run のディレクトリを PR のブランチから導出する", () => {
    expect(runParse("/agent approve").dir).toBe("agent-work/issue-1");
    expect(runParse("/agent approve").branch).toBe("claude/issue-1");
  });

  test("理由は 1 行目のコマンド以降すべて（改行を含む）", () => {
    const r = runParse("/agent request-changes 1 行目\r\n2 行目\r\n");
    expect(r.command).toBe("request-changes");
    expect(r.reason).toContain("1 行目");
    expect(r.reason).toContain("2 行目");
    expect(r.reason).not.toContain("\r");
  });

  test("理由が空の request-changes は no-reason として弾く", () => {
    expect(runParse("/agent request-changes\r\n").command).toBe("no-reason");
    expect(runParse("/agent request-changes   ").command).toBe("no-reason");
  });

  test("知らないコマンドはそのまま返して応答側で扱う", () => {
    expect(runParse("/agent foo").command).toBe("foo");
  });
});

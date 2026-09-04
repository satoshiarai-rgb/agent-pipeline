import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { defaults, validateRun } from "../../src/index.ts";
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

/** 中央の reusable workflow と、配布先に置く検証用ラッパーを集める */
function workflows(): Workflow[] {
  const files = [
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
  const dispatch = all.find((w) => w.path === join(CENTRAL, "dispatch.yml"));
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
      validateRun({ dir: runDir, config: defaults, agent, changed_files: changed });

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

describe("scripts/run-cli.sh（action の実体）", () => {
  test("シェル構文が通る", () => {
    const r = spawnSync("bash", ["-n", join(ROOT, "scripts/run-cli.sh")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
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
  const comment = all.find((w) => w.name === "comment.yml");
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

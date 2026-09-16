import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AcceptanceFile, saveAcceptance } from "../../file/acceptanceFile.ts";
import { nextReviewNumber, saveReview } from "../../file/reviewFile.ts";
import type { AgentName } from "../../types.ts";

/**
 * **お試し実行（dry run）のダミーエージェント。** エージェントを呼ばずに、契約
 * （`docs/agent-contract.md` §4）を満たす最小の成果物だけを書く。これで状態機械と
 * 契約の検査と連鎖が、Claude を呼ばずに一周する。
 *
 * ハーネスに置くのは、**契約を知っているのがハーネスだから**。ワークフローのシェルに
 * 書くと、CI とローカル（`scripts/run-local.sh`）で同じものが 2 か所になる。
 *
 * `plan.md` と `completion.md` は `src/file/` にモジュールを持たない。誰も解析しない
 * ただのマークダウンで、契約が見るのは「空でないか」と見出しの有無だけのため。
 */

/** ダミー実行の筋書き。`<dir>/scenario` に 1 行で書く（bootstrap が置く） */
export type Scenario = "happy" | "plan-changes" | "plan-loop" | "dev-changes";

export function readScenario(dir: string): Scenario {
  const path = join(dir, "scenario");
  if (!existsSync(path)) return "happy";
  return (readFileSync(path, "utf8").trim() || "happy") as Scenario;
}

interface Context {
  dir: string;
  scenario: Scenario;
  /** developer が作る差分のファイル名に使う（実行ごとに変える） */
  run_id: string;
  /** 配布先のチェックアウト。developer のダミーはここにコードの差分を作る（既定はカレント） */
  repo: string;
}

const acceptance = (status: "pending" | "passed", evidence: string | null): AcceptanceFile => ({
  criteria: [{ id: "AC-1", description: "ダミー", verification: "manual", status, evidence }],
});

/**
 * 差し戻すかどうかは筋書きが決める。`plan-loop` は毎回差し戻して上限まで回し、
 * `plan-changes` / `dev-changes` は 1 回だけ差し戻して 2 周目で通す
 */
function verdictFor(dir: string, kind: "plan" | "dev", scenario: Scenario) {
  const first = nextReviewNumber(dir, kind) === 1;
  if (kind === "plan" && scenario === "plan-loop") return "request_changes" as const;
  if (kind === "plan" && scenario === "plan-changes" && first) return "request_changes" as const;
  if (kind === "dev" && scenario === "dev-changes" && first) return "request_changes" as const;
  return "approve" as const;
}

const write = (path: string, text: string): string => {
  writeFileSync(path, text);
  return path;
};

/** エージェントごとの成果物。1 行 1 エージェントで読めるようにする */
const ARTIFACTS: Record<AgentName, (context: Context) => string[]> = {
  // 規模判定は planner の必須出力。「上限超過」の語が無ければ実装に進む（K-21）
  planner: ({ dir }) => [
    write(
      join(dir, "plan.md"),
      "# ダミー計画\n\n## 規模判定\n\n- 変更ファイル数見込み: テストを除いて 1 / テストを含めて 1\n- 上限（テスト除き 20 / 込み 40）以内: yes\n",
    ),
    saveAcceptance(dir, acceptance("pending", null)),
  ],

  "plan-reviewer": ({ dir, scenario }) => [
    saveReview({
      dir,
      kind: "plan",
      verdict: verdictFor(dir, "plan", scenario),
      reviewer: "plan-reviewer",
      body: "ダミーレビュー",
    }),
  ],

  // 差分が無いと契約違反になるので、コードを 1 ファイル触る
  developer: ({ dir, run_id, repo }) => {
    const src = join(repo, "dummy-src");
    mkdirSync(src, { recursive: true });
    return [
      write(join(src, `change-${run_id}.txt`), `${new Date().toISOString()}\n`),
      saveAcceptance(dir, acceptance("passed", "ダミー実行")),
    ];
  },

  "dev-reviewer": ({ dir, scenario }) => [
    saveReview({
      dir,
      kind: "dev",
      verdict: verdictFor(dir, "dev", scenario),
      reviewer: "dev-reviewer",
      body: "ダミーレビュー",
    }),
  ],

  completion: ({ dir }) => [write(join(dir, "completion.md"), "# ダミー完了報告\n")],
};

/** いま走っているエージェントのダミー成果物を書き、書いたパスを返す */
export function writeDummyArtifacts(agent: AgentName, context: Context): string[] {
  const artifacts = ARTIFACTS[agent];
  return artifacts(context);
}

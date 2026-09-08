// `effects/` は **dispatch の外で走る I/O**。`store/middlewares/` は dispatch の中で走る
// もの（`hydrate` の読み取りも含む）で、分かれ目は読み書きではなく dispatch の内か外か。
// ここは finish が action を作る前に成果物を読む側。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../../defaults.ts";
import {
  acceptanceProblems,
  allPassed,
  hasAcceptance,
  readAcceptance,
} from "../../file/acceptanceFile.ts";
import { decisionRecordProblems } from "../../file/decisionRecords.ts";
import { completedCleanly, readApiErrorStatus } from "../../file/executionLog.ts";
import { latestReviewPath, readVerdict } from "../../file/reviewFile.ts";
import type { AgentName, RunResult, Verdict } from "../../types.ts";

/**
 * 「1 回の実行の検証結果」。成果物（`plan.md` / `acceptance.json` / `reviews/*.md` /
 * 実行ログ / 差分）を契約（`work/agent-contract.md` §4）に照らした結果で、
 * `finish` がこれを action に写す（`redux/mapValidationToAction.ts`）。
 */
export interface ValidationReport {
  result: RunResult;
  verdict?: Verdict | null;
  /**
   * planner の規模判定が上限超過。**`validate` の出力としてワークフローが読み**、
   * PR に警告コメントを出す（K-21）。状態は変えないので store には渡らない
   */
  oversize?: boolean;
  /** completing で acceptance.json が全 passed だったか */
  acceptance_passed?: boolean;
  /** A-31: 設定ミスとエージェントの失敗を区別するために残す */
  api_error_status?: number | null;
  /** invalid のとき、何が契約を満たしていないか（人間が原因を追えるように） */
  detail?: string;
}

// ---------------------------------------------------------------- 検証の部品
//
// 各部品は「満たしていれば null、満たしていなければ理由」を返す。
// 理由はそのまま blocked_reason に載るので、人間が原因を追える文にする。

/** 検証に使える情報 */
interface Artifacts {
  /** run のディレクトリ */
  dir: string;
  /** developer の差分（git status から取ったファイル名） */
  changed: string[];
}

type Check = (a: Artifacts) => string | null;

const nonEmpty =
  (rel: string): Check =>
  ({ dir }) => {
    const path = join(dir, rel);
    return existsSync(path) && readFileSync(path, "utf8").trim() !== ""
      ? null
      : `${rel} が無いか空`;
  };

const contains =
  (rel: string, needle: string): Check =>
  ({ dir }) =>
    readFileSync(join(dir, rel), "utf8").includes(needle) ? null : `${rel} に ${needle} が無い`;

const acceptanceSchema: Check = ({ dir }) => {
  if (!hasAcceptance(dir)) return "acceptance.json が無い";
  try {
    const problems = acceptanceProblems(readAcceptance(dir));
    return problems.length > 0 ? `acceptance.json: ${problems.join(" / ")}` : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const reviewWithVerdict =
  (kind: "plan" | "dev"): Check =>
  ({ dir }) => {
    const path = latestReviewPath(dir, kind);
    if (!path) return `reviews/${kind}-NN.md が無い`;
    return readVerdict(path) ? null : `${path} の frontmatter に verdict が無い`;
  };

const hasDiff: Check = ({ changed }) => (changed.length > 0 ? null : "差分が無い");

/** 決定記録は任意。書いたなら 1 ファイル 1 レコードの形であること（名前も含む） */
const decisionRecords: Check = ({ dir }) => {
  const problems = decisionRecordProblems(dir);
  return problems.length > 0 ? `decision-records/: ${problems.join(" / ")}` : null;
};

/** K-4: エージェントは自身の起動条件を書き換えられない */
const noWorkflowChanges: Check = ({ changed }) => {
  const hits = changed.filter((f) => f.startsWith(".github/workflows/"));
  return hits.length > 0 ? `.github/workflows を変更している: ${hits.join(", ")}` : null;
};

// ------------------------------------------------------------------ 契約の表
//
// work/agent-contract.md §4 をそのまま写したもの。

interface Contract {
  /** 満たさなければ invalid。上から順に見て最初の違反を理由にする */
  checks: Check[];
  /** checks を通ったあとに走る。成果物から読み取った値を検証結果に足す */
  postProcess?: (a: Artifacts) => Partial<ValidationReport>;
}

const CONTRACT: Record<AgentName, Contract> = {
  planner: {
    checks: [nonEmpty("plan.md"), contains("plan.md", "## 規模判定"), acceptanceSchema],
    // 規模超過なら実装に進まず issue の分割を促す（設計書 §1）
    postProcess: ({ dir }) => {
      const text = readFileSync(join(dir, "plan.md"), "utf8");
      const scale = text.slice(text.indexOf("## 規模判定"));
      return scale.includes("上限超過") ? { oversize: true } : {};
    },
  },

  "plan-reviewer": {
    checks: [reviewWithVerdict("plan")],
    postProcess: ({ dir }) => ({ verdict: readLatestVerdict(dir, "plan") }),
  },

  developer: {
    checks: [hasDiff, noWorkflowChanges, acceptanceSchema, decisionRecords],
  },

  "dev-reviewer": {
    checks: [reviewWithVerdict("dev")],
    postProcess: ({ dir }) => ({ verdict: readLatestVerdict(dir, "dev") }),
  },

  completion: {
    checks: [nonEmpty("completion.md"), acceptanceSchema],
    postProcess: ({ dir }) => ({ acceptance_passed: allPassed(readAcceptance(dir)) }),
  },
};

// -------------------------------------------------------------------- 入り口

/**
 * 契約（work/agent-contract.md §4）を強制し、finish に渡す検証結果を組み立てる。
 * プロンプトは配布先で差し替えられる（K-15）ので、成果物の形を見るのはここだけ（K-16）。
 *
 * 見る順序:
 *   1. API エラー（設定ミスと区別できるようステータスを残す / A-31）
 *   2. 実行そのものの失敗。ただし**実行ログが正常終了を示すなら成果物で判断する**
 *      （base-action は max_turns 超過を step の失敗として返すが、そのとき成果物は
 *       完成している。捨てずに契約で見る / K-20）
 *   3. 成果物が契約を満たすか
 */
export function validateRun(input: {
  dir: string;
  config: Config;
  agent: AgentName;
  /** エージェントの step が失敗したか */
  agent_failed?: boolean;
  /** base-action の実行ログ */
  execution_file?: string | null;
  /** developer の差分。git status から取ったファイル名の一覧 */
  changed_files?: string[];
}): ValidationReport {
  const { dir, agent, agent_failed = false, execution_file, changed_files = [] } = input;

  const apiError = readApiErrorStatus(execution_file);
  if (apiError !== null) return { result: "api_error", api_error_status: apiError };
  if (agent_failed && !completedCleanly(execution_file)) return { result: "agent_failed" };

  const artifacts: Artifacts = { dir, changed: changed_files };
  const contract = CONTRACT[agent];
  for (const check of contract.checks) {
    const detail = check(artifacts);
    if (detail) return { result: "invalid", detail };
  }
  return { result: "ok", ...contract.postProcess?.(artifacts) };
}

function readLatestVerdict(dir: string, kind: "plan" | "dev") {
  const path = latestReviewPath(dir, kind);
  return path ? readVerdict(path) : null;
}

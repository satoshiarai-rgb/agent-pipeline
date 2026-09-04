import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  acceptanceProblems,
  allPassed,
  hasAcceptance,
  readAcceptance,
} from "../file/acceptance-file.ts";
import { latestReviewPath, readVerdict } from "../file/review-file.ts";
import type { AgentName } from "../types.ts";
import { parseJson } from "../utils/parse-json.ts";
import type { Outcome } from "./finish.ts";
import type { CommandInput } from "./input.ts";

/**
 * 契約（work/agent-contract.md §4）を強制し、finish に渡す Outcome を組み立てる。
 * プロンプトは配布先で差し替えられる（K-15）ので、成果物の形を見るのはここだけ（K-16）。
 */
export function validateRun(
  input: CommandInput & {
    agent: AgentName;
    /** エージェントの step が失敗したか */
    agent_failed?: boolean;
    /** base-action の実行ログ（api_error の判定に使う / A-31） */
    execution_file?: string | null;
    /** developer の差分。git status から取ったファイル名の一覧 */
    changed_files?: string[];
  },
): Outcome {
  const { dir, agent, agent_failed = false, execution_file, changed_files = [] } = input;

  // 1. API エラーは設定ミスと区別できるようステータスを残す（A-31）
  const apiError = readApiError(execution_file);
  if (apiError !== null) {
    return { result: "api_error", api_error_status: apiError };
  }

  // 2. 実行そのものの失敗
  if (agent_failed) return { result: "agent_failed" };

  // 3. 成果物の検証（契約 §4）
  const invalid = (detail: string): Outcome => ({ result: "invalid", detail });
  const nonEmpty = (path: string) => existsSync(path) && readFileSync(path, "utf8").trim() !== "";

  switch (agent) {
    case "planner": {
      const plan = join(dir, "plan.md");
      if (!nonEmpty(plan)) return invalid("plan.md が無いか空");
      const text = readFileSync(plan, "utf8");
      if (!text.includes("## 規模判定")) return invalid("plan.md に ## 規模判定 が無い");
      if (!hasAcceptance(dir)) return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems) return invalid(problems);
      // 規模超過なら実装に進まず issue の分割を促す（設計書 §1）
      const scale = text.slice(text.indexOf("## 規模判定"));
      if (scale.includes("上限超過")) return { result: "ok", oversize: true };
      return { result: "ok" };
    }

    case "plan-reviewer":
    case "dev-reviewer": {
      const kind = agent === "plan-reviewer" ? "plan" : "dev";
      const path = latestReviewPath(dir, kind);
      if (!path) return invalid(`reviews/${kind}-NN.md が無い`);
      const verdict = readVerdict(path);
      if (!verdict) return invalid(`${path} の frontmatter に verdict が無い`);
      return { result: "ok", verdict };
    }

    case "developer": {
      if (changed_files.length === 0) return invalid("差分が無い");
      const workflows = changed_files.filter((f) => f.startsWith(".github/workflows/"));
      if (workflows.length > 0) {
        // K-4: エージェントは自身の起動条件を書き換えられない
        return invalid(`.github/workflows を変更している: ${workflows.join(", ")}`);
      }
      if (!hasAcceptance(dir)) return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems) return invalid(problems);
      return { result: "ok" };
    }

    case "completion": {
      if (!nonEmpty(join(dir, "completion.md"))) return invalid("completion.md が無いか空");
      if (!hasAcceptance(dir)) return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems) return invalid(problems);
      return { result: "ok", acceptance_passed: allPassed(readAcceptance(dir)) };
    }
  }
}

/** acceptance.json のスキーマ違反をまとめた文字列。妥当なら null */
function acceptanceSchema(dir: string): string | null {
  let problems: string[];
  try {
    problems = acceptanceProblems(readAcceptance(dir));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return problems.length > 0 ? `acceptance.json: ${problems.join(" / ")}` : null;
}

/** base-action の実行ログから API エラーのステータスを読む。無ければ null */
function readApiError(path?: string | null): number | null {
  if (!path || !existsSync(path)) return null;
  const events = parseJson<unknown>(readFileSync(path, "utf8"), "execution_file");
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) {
    const ev = e as { type?: string; terminal_reason?: string; api_error_status?: number };
    if (ev?.type === "result" && (ev.terminal_reason === "api_error" || ev.api_error_status)) {
      return ev.api_error_status ?? 0;
    }
  }
  return null;
}

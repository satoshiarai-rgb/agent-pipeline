import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "../utils/parse-json.ts";

/**
 * acceptance.json の内容（契約 §4）。planner が書き、developer が status を更新し、
 * completion で全 passed が確認される。id は developer と dev-reviewer が共通に参照する。
 */
export interface Criterion {
  id: string;
  description: string;
  verification: "automated" | "manual";
  /** verification が automated なら必須 */
  command?: string | null;
  status: "pending" | "passed" | "failed";
  /** status を passed にした根拠。passed なら必須 */
  evidence?: string | null;
}

export interface AcceptanceFile {
  criteria: Criterion[];
}

export function acceptancePath(dir: string): string {
  return join(dir, "acceptance.json");
}

export function readAcceptance(dir: string): AcceptanceFile {
  const raw = parseJson<AcceptanceFile>(
    readFileSync(acceptancePath(dir), "utf8"),
    "acceptance.json",
  );
  if (!Array.isArray(raw?.criteria)) throw new Error("acceptance.json に criteria がありません");
  return raw;
}

/**
 * 契約 §4 のスキーマ違反を列挙する。空なら妥当。
 * エージェント（プロンプト差し替え可）が書くファイルなので、ここで厳しく見る。
 */
export function acceptanceProblems(file: AcceptanceFile): string[] {
  const problems: string[] = [];
  if (file.criteria.length === 0) problems.push("criteria が空");

  const seen = new Set<string>();
  for (const [i, c] of file.criteria.entries()) {
    const at = c?.id ? `criteria[${i}] (${c.id})` : `criteria[${i}]`;
    if (!c?.id) problems.push(`${at}: id が無い`);
    else if (seen.has(c.id)) problems.push(`${at}: id が重複`);
    else seen.add(c.id);

    if (!c?.description) problems.push(`${at}: description が無い`);
    if (c?.verification !== "automated" && c?.verification !== "manual") {
      problems.push(`${at}: verification は automated か manual`);
    }
    if (c?.verification === "automated" && !c?.command) {
      problems.push(`${at}: verification が automated なら command が必要`);
    }
    if (!["pending", "passed", "failed"].includes(c?.status)) {
      problems.push(`${at}: status は pending / passed / failed`);
    }
    if (c?.status === "passed" && !c?.evidence) {
      problems.push(`${at}: passed にするなら evidence が必要`);
    }
  }
  return problems;
}

/** completing の判定に使う（設計書 §6.3） */
export function allPassed(file: AcceptanceFile): boolean {
  return file.criteria.length > 0 && file.criteria.every((c) => c.status === "passed");
}

export function hasAcceptance(dir: string): boolean {
  return existsSync(acceptancePath(dir));
}

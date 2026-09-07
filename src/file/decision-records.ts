import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "../utils/parse-json.ts";

/**
 * decision-records.jsonl の 1 行（契約 §4）。
 * developer が「計画に無い判断」をしたときだけ追記する。1 行 1 レコードの追記専用なので、
 * 並行更新でも行が混ざらず、`reversibility` で機械的に絞り込める
 * （後戻りが困難な判断だけを人間が重点確認する運用 / 設計書 §5.4）。
 */
export interface DecisionRecord {
  /** D-<n>。レコードの識別子 */
  id: string;
  /** 一行の見出し */
  title: string;
  /** 何をどう決めたか */
  decision: string;
  /** 後戻りの容易さ。困難なものだけを人間が重点確認する */
  reversibility: "easy" | "hard";
  /** そう判断した前提 */
  premise?: string;
  /** 影響が及ぶファイルや領域 */
  impact?: string[];
  /** 検討して採らなかった案 */
  alternatives?: string;
  note?: string;
}

const REVERSIBILITY = ["easy", "hard"];

export function decisionRecordsPath(dir: string): string {
  return join(dir, "decision-records.jsonl");
}

export function hasDecisionRecords(dir: string): boolean {
  return existsSync(decisionRecordsPath(dir));
}

/** 空行を飛ばして 1 行ずつ読む。行が壊れていれば例外 */
export function readDecisionRecords(dir: string): DecisionRecord[] {
  return lines(readFileSync(decisionRecordsPath(dir), "utf8")).map(({ text, at }) =>
    parseJson<DecisionRecord>(text, `decision-records.jsonl ${at}`),
  );
}

/**
 * 契約 §4 の違反を列挙する。空なら妥当。
 * エージェント（プロンプト差し替え可）が書くファイルなので、形だけをここで見る。
 */
export function decisionRecordProblems(text: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const { text: line, at } of lines(text)) {
    let r: Partial<DecisionRecord>;
    try {
      r = parseJson<DecisionRecord>(line, at);
    } catch (e) {
      problems.push(`${at}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!r.id) problems.push(`${at}: id が無い`);
    else if (seen.has(r.id)) problems.push(`${at}: id ${r.id} が重複`);
    else seen.add(r.id);

    if (!r.title) problems.push(`${at}: title が無い`);
    if (!r.decision) problems.push(`${at}: decision が無い`);
    if (!REVERSIBILITY.includes(r.reversibility as string)) {
      problems.push(`${at}: reversibility は easy か hard`);
    }
  }
  return problems;
}

/** 中身のある行だけを、位置（人間が追える形）付きで返す */
function lines(text: string): { text: string; at: string }[] {
  return text
    .split("\n")
    .map((t, i) => ({ text: t.trim(), at: `${i + 1} 行目` }))
    .filter((l) => l.text !== "");
}

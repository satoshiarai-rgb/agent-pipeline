import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * reviews/<kind>-NN.md の形式。
 * ハーネスは frontmatter の verdict だけを見て遷移を決める（設計書 §5.5）。
 * 本文は次のエージェントへの入力になる。
 */
function renderReview(input: {
  verdict: "approve" | "request_changes";
  round: number;
  reviewer: string;
  body: string;
}): string {
  const { verdict, round, reviewer, body } = input;
  return `---
verdict: ${verdict}
round: ${round}
reviewer: ${reviewer}
---

${body.trim()}
`;
}

/** 次のレビュー番号。番号はハーネスが決める（エージェントは rounds を知らない） */
export function nextReviewNumber(dir: string, kind: "plan" | "dev"): number {
  const reviews = join(dir, "reviews");
  if (!existsSync(reviews)) return 1;
  return (
    readdirSync(reviews).filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".md")).length + 1
  );
}

/** レビューファイルのパス（reviews/plan-01.md 形式） */
export function reviewPath(dir: string, kind: "plan" | "dev", round: number): string {
  return join(dir, "reviews", `${kind}-${String(round).padStart(2, "0")}.md`);
}

/**
 * レビューファイルを書き、そのパスを返す。番号は既存ファイルの次を取る。
 * エージェントは rounds を知らないので、番号を決めるのはハーネス側（設計書 §5.5）。
 */
export function saveReview(input: {
  dir: string;
  kind: "plan" | "dev";
  verdict: "approve" | "request_changes";
  reviewer: string;
  body: string;
}): string {
  const { dir, kind, verdict, reviewer, body } = input;
  const round = nextReviewNumber(dir, kind);
  const path = reviewPath(dir, kind, round);
  mkdirSync(join(dir, "reviews"), { recursive: true });
  writeFileSync(path, renderReview({ verdict, round, reviewer, body }));
  return path;
}

/**
 * reviews/ のファイルを名前順に返す。kind を省略すると全種別。
 * 番号は 0 埋めなので名前順がそのまま古い順になる。
 */
export function reviewPaths(dir: string, kind?: "plan" | "dev"): string[] {
  const reviews = join(dir, "reviews");
  if (!existsSync(reviews)) return [];
  const prefix = kind ? `${kind}-` : "";
  return readdirSync(reviews)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".md"))
    .sort()
    .map((n) => join(reviews, n));
}

/** 直近のレビューファイルのパス。無ければ null */
export function latestReviewPath(dir: string, kind: "plan" | "dev"): string | null {
  return reviewPaths(dir, kind).at(-1) ?? null;
}

/**
 * レビューの frontmatter から verdict を読む（契約 §4）。
 * ハーネスが遷移判断に使う唯一の値。読めなければ null。
 * 本文の書式は自由なので、frontmatter の 1 行だけを見る。
 */
export function readVerdict(path: string): "approve" | "request_changes" | null {
  const text = readFileSync(path, "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  const line = (frontmatter[1] as string).split(/\r?\n/).find((l) => /^verdict:/.test(l.trim()));
  if (!line) return null;
  const value = line.split(":")[1]?.trim();
  return value === "approve" || value === "request_changes" ? value : null;
}

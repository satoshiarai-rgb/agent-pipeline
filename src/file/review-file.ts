import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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

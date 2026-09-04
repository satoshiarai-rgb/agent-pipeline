/**
 * レビューファイル（reviews/<kind>-NN.md）を組み立てる。
 * ハーネスは frontmatter の verdict だけを見て遷移を決める（設計書 §5.5）。
 */
export function renderReview(input: {
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

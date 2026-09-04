import { describe, expect, test } from "bun:test";
import { renderReview } from "../render-review.ts";

describe("renderReview", () => {
  test("frontmatter に verdict / round / reviewer が入る", () => {
    const out = renderReview({
      verdict: "request_changes",
      round: 2,
      reviewer: "human:OWNER",
      body: "  認証の順序を先に決めてほしい  ",
    });
    expect(out.startsWith("---\nverdict: request_changes\n")).toBe(true);
    expect(out).toContain("round: 2");
    expect(out).toContain("reviewer: human:OWNER");
    expect(out).toContain("認証の順序を先に決めてほしい");
    expect(out).not.toContain("  認証"); // 本文は trim される
  });
});

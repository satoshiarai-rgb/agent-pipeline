import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextReviewNumber, reviewPath, saveReview } from "../review-file.ts";

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const make = (files: string[]) => {
  dir = mkdtempSync(join(tmpdir(), "reviews-"));
  if (files.length) mkdirSync(join(dir, "reviews"), { recursive: true });
  for (const f of files) writeFileSync(join(dir, "reviews", f), "");
  return dir;
};

describe("saveReview", () => {
  test("frontmatter に verdict / round / reviewer が入り、本文は trim される", () => {
    const d = make(["plan-01.md"]);
    const path = saveReview({
      dir: d,
      kind: "plan",
      verdict: "request_changes",
      reviewer: "human:OWNER",
      body: "  認証の順序を先に決めてほしい  ",
    });
    expect(path).toBe(reviewPath(d, "plan", 2));
    const out = readFileSync(path, "utf8");
    expect(out.startsWith("---\nverdict: request_changes\n")).toBe(true);
    expect(out).toContain("round: 2");
    expect(out).toContain("reviewer: human:OWNER");
    expect(out).toContain("認証の順序を先に決めてほしい");
    expect(out).not.toContain("  認証"); // 本文は trim される
  });
});

describe("nextReviewNumber", () => {
  test("reviews/ が無ければ 1", () => {
    expect(nextReviewNumber(make([]), "plan")).toBe(1);
  });

  test("同じ種別の数の次を返す", () => {
    expect(nextReviewNumber(make(["plan-01.md", "plan-02.md"]), "plan")).toBe(3);
  });

  test("種別ごとに独立して数える", () => {
    const d = make(["plan-01.md", "plan-02.md", "dev-01.md"]);
    expect(nextReviewNumber(d, "dev")).toBe(2);
  });
});

describe("reviewPath", () => {
  test("番号を 2 桁に揃える", () => {
    expect(reviewPath("/run", "plan", 1)).toBe("/run/reviews/plan-01.md");
    expect(reviewPath("/run", "dev", 12)).toBe("/run/reviews/dev-12.md");
  });
});

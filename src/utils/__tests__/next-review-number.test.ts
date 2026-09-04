import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { nextReviewNumber } from "../next-review-number.ts";

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const make = (files: string[]) => {
  dir = mkdtempSync(join(tmpdir(), "reviews-"));
  if (files.length) mkdirSync(join(dir, "reviews"), { recursive: true });
  for (const f of files) writeFileSync(join(dir, "reviews", f), "");
  return dir;
};

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

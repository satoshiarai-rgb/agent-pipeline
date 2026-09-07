import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "../frontmatter.ts";

describe("frontmatter の読み取り", () => {
  test("key: value の行と本文に分ける", () => {
    const f = parseFrontmatter("---\nverdict: approve\nround: 2\n---\n\n本文\n");
    expect(f?.fields).toEqual({ verdict: "approve", round: "2" });
    expect(f?.body).toBe("本文");
  });

  test("frontmatter が無ければ null", () => {
    expect(parseFrontmatter("# 見出し\n\n本文")).toBeNull();
  });

  test("本文が無くても読める", () => {
    expect(parseFrontmatter("---\nverdict: approve\n---\n")?.body).toBe("");
  });

  test("本文に --- があっても最初のブロックだけを見る", () => {
    const f = parseFrontmatter("---\nverdict: approve\n---\n\n本文\n\n---\n\n続き\n");
    expect(f?.fields.verdict).toBe("approve");
    expect(f?.body).toContain("続き");
  });

  test("リストや入れ子は読まない（値は本文側に置く決め）", () => {
    const f = parseFrontmatter(
      "---\nverdict: approve\nblocking:\n  - AC-2 の検証方法\n---\n\n本文",
    );
    expect(f?.fields).toEqual({ verdict: "approve", blocking: "" });
  });

  test("CRLF でも読める", () => {
    expect(parseFrontmatter("---\r\nverdict: approve\r\n---\r\n\r\n本文")?.fields.verdict).toBe(
      "approve",
    );
  });
});

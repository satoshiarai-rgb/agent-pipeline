import { describe, expect, test } from "bun:test";
import { parseYamlDocument } from "../parse-yaml-document.ts";

describe("parseYamlDocument", () => {
  test("値を取り出せる", () => {
    const doc = parseYamlDocument("# コメント\na: 1\n");
    expect(doc.toJS()).toEqual({ a: 1 });
  });

  test("何も変えずに文字列化すると元のまま（コメント込み）", () => {
    const text = "# 先頭のコメント\na: 1\n\n# b の説明\nb: keep\n";
    expect(parseYamlDocument(text).toString()).toBe(text);
  });
});

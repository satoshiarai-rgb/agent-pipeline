import { describe, expect, test } from "bun:test";
import { parseYamlDocument } from "../parse-yaml-document.ts";
import { setYamlFields } from "../set-yaml-fields.ts";

const withComments = `# 先頭のコメント
a: 1

# b の説明
b: keep
c: null
`;
const apply = (fields: Record<string, unknown>) =>
  setYamlFields(parseYamlDocument(withComments), fields);

describe("setYamlFields", () => {
  test("指定フィールドだけを書き換え、コメントとキー順を保持する", () => {
    const out = apply({ a: 2 });
    expect(out).toContain("# 先頭のコメント");
    expect(out).toContain("# b の説明");
    expect(out).toContain("a: 2");
    expect(out).toContain("b: keep");
    expect(out.indexOf("a:")).toBeLessThan(out.indexOf("b:"));
  });

  test("存在しないキーは追記される", () => {
    expect(apply({ d: "new" })).toContain("d: new");
  });

  test("null を書ける", () => {
    expect(apply({ b: null })).toContain("b: null");
  });

  test("複数フィールドを一度に書ける", () => {
    const out = apply({ a: 9, b: "changed" });
    expect(out).toContain("a: 9");
    expect(out).toContain("b: changed");
  });
});

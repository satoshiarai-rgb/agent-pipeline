import { describe, expect, test } from "bun:test";
import { parseYaml } from "../parse-yaml.ts";

describe("parseYaml", () => {
  test("素の値として読む", () => {
    const v = parseYaml<{ a: number; b: string; c: null }>("a: 1\nb: keep\nc: null\n");
    expect(v.a).toBe(1);
    expect(v.b).toBe("keep");
    expect(v.c).toBeNull();
  });

  test("コメントは落ちる（書き戻さない用途）", () => {
    expect(parseYaml<{ a: number }>("# コメント\na: 1\n")).toEqual({ a: 1 });
  });
});

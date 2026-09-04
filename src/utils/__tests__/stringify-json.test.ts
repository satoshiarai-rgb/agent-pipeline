import { describe, expect, test } from "bun:test";
import { stringifyJson } from "../stringify-json.ts";

describe("stringifyJson", () => {
  test("読み直して同じ値になる", () => {
    const value = { agent: "planner", attempt: 1, finished_at: null };
    expect(JSON.parse(stringifyJson(value))).toEqual(value);
  });

  test("キー順は組み立てた順のまま（差分を安定させる）", () => {
    expect(Object.keys(JSON.parse(stringifyJson({ b: 1, a: 2 })))).toEqual(["b", "a"]);
  });

  test("末尾に改行を付ける", () => {
    expect(stringifyJson({ a: 1 }).endsWith("}\n")).toBe(true);
  });
});

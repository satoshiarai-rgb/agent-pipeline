import { describe, expect, test } from "bun:test";
import { parseYaml } from "../parse-yaml.ts";
import { stringifyYaml } from "../stringify-yaml.ts";

describe("stringifyYaml", () => {
  test("読み直して同じ値になる", () => {
    const value = { agent: "planner", attempt: 1, finished_at: null };
    expect(parseYaml<typeof value>(stringifyYaml(value))).toEqual(value);
  });

  test("長い文字列を折り返さない（レコードを 1 行 1 項目に保つ）", () => {
    const long = "x".repeat(200);
    expect(stringifyYaml({ reason: long }).trimEnd().split("\n")).toHaveLength(1);
  });
});

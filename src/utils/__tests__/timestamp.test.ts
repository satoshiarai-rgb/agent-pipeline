import { describe, expect, test } from "bun:test";
import { formatTimestamp, parseTimestamp } from "../timestamp.ts";

describe("イベントの時刻（ISO 基本形式）", () => {
  test("コロンとハイフンを含まない形で書く", () => {
    expect(formatTimestamp(new Date("2026-09-08T05:45:12.345Z"))).toBe("20260908T054512Z");
  });

  test("書いた形式は読み戻せる", () => {
    const date = new Date("2026-09-08T05:45:12.000Z");
    expect(parseTimestamp(formatTimestamp(date))).toBe(date.getTime());
  });

  test("読めない形式は null（手で書いたイベントで落とさない）", () => {
    expect(parseTimestamp("2026-09-08T05:45:12Z")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

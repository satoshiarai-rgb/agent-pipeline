import { describe, expect, test } from "bun:test";
import { pick } from "../pick.ts";

describe("pick", () => {
  test("keys の順番どおりに取り出す", () => {
    const picked = pick({ a: 1, b: 2, c: 3 }, ["c", "a"] as const);
    expect(Object.keys(picked)).toEqual(["c", "a"]);
    expect(picked).toEqual({ c: 3, a: 1 });
  });

  test("keys に無いフィールドは落ちる", () => {
    expect(pick({ a: 1, b: 2 }, ["a"] as const)).toEqual({ a: 1 });
  });

  test("null は残すが undefined は含めない", () => {
    const picked = pick({ a: null, b: undefined } as { a: null; b?: number }, ["a", "b"] as const);
    expect(Object.keys(picked)).toEqual(["a"]);
    expect(picked.a).toBeNull();
  });
});

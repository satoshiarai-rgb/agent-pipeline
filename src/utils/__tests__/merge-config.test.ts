import { describe, expect, test } from "bun:test";
import { config } from "../../__tests__/helpers.ts";
import { defaults } from "../../defaults.ts";
import { mergeConfig } from "../merge-config.ts";

const base = config();
/** 上書きを重ねる。エラーが無いことを前提にする呼び方 */
const merged = (over: unknown) => {
  const r = mergeConfig(base, over);
  expect(r.errors).toEqual([]);
  return r.config;
};
/** エラーの 1 本目 */
const error = (over: unknown) => {
  const r = mergeConfig(base, over);
  expect(r.errors.length).toBeGreaterThan(0);
  return r.errors[0] as string;
};

describe("mergeConfig（書いたキーだけを上書きする）", () => {
  test("書いたキーだけが変わり、書かなかったキーは既定に追従する", () => {
    const c = merged({ limits: { dev_review_rounds: 3 } });
    expect(c.limits.dev_review_rounds).toBe(3);
    expect(c.limits.plan_review_rounds).toBe(base.limits.plan_review_rounds);
    expect(c.limits.total_steps).toBe(base.limits.total_steps);
  });

  test("入れ子も同じ規則で重なる（agents の 1 エージェントの 1 キーだけ）", () => {
    const c = merged({ agents: { developer: { max_turns: 80 } } });
    expect(c.agents.developer.max_turns).toBe(80);
    expect(c.agents.developer.timeout_minutes).toBe(base.agents.developer.timeout_minutes);
    expect(c.agents.planner).toEqual(base.agents.planner);
  });

  test("null は継承（キーを消さずに既定へ戻せる）", () => {
    const c = merged({ limits: { total_steps: null }, models: { default: null } });
    expect(c.limits.total_steps).toBe(base.limits.total_steps);
    expect(c.models.default).toBe(base.models.default);
  });

  test("既定が null のキー（models.reviewer）は文字列を受ける", () => {
    expect(merged({ models: { reviewer: "claude-sonnet-5" } }).models.reviewer).toBe(
      "claude-sonnet-5",
    );
  });

  test("配列は置き換える（既定に足さない）", () => {
    expect(merged({ approvers: ["OWNER"] }).approvers).toEqual(["OWNER"]);
  });

  test("上書きしても既定値そのものは変わらない", () => {
    merged({ agents: { developer: { max_turns: 80 } } });
    expect(defaults.agents.developer.max_turns).toBe(60);
    expect(base.agents.developer.max_turns).toBe(60);
  });

  test("上書きが無ければ既定がそのまま返る", () => {
    expect(merged({})).toEqual(base);
  });
});

describe("mergeConfig（受け付けないもの）", () => {
  test("既定に無いキーはエラー（誤字を黙って無視しない）", () => {
    expect(error({ limits: { plan_rounds: 3 } })).toContain("limits.plan_rounds");
    expect(error({ agents: { planer: { max_turns: 3 } } })).toContain("agents.planer");
  });

  test("版の握手は配布先では上書きできない", () => {
    expect(error({ pipeline_version: 2 })).toContain("上書きできません");
  });

  test("状態機械はそもそも設定に無い（遷移表は中央のコードが持つ / K-26）", () => {
    expect(error({ transitions: {} })).toContain("上書きできません");
  });

  test("型が違えばエラー", () => {
    expect(error({ limits: { total_steps: "24" } })).toContain("number で書いてください");
    expect(error({ approvers: "OWNER" })).toContain("配列");
    expect(error({ limits: 5 })).toContain("オブジェクト");
    expect(error({ approvers: [1, 2] })).toContain("string");
  });

  test("回数と分数は 1 以上の整数だけ（0 は実行されない run になる）", () => {
    expect(error({ limits: { total_steps: 0 } })).toContain("1 以上の整数");
    expect(error({ agents: { developer: { timeout_minutes: 1.5 } } })).toContain("1 以上の整数");
    expect(error({ limits: { plan_review_rounds: -1 } })).toContain("1 以上の整数");
  });

  test("最上位がオブジェクトでなければエラー", () => {
    expect(error([])).toContain("最上位");
    expect(error("limits")).toContain("最上位");
    expect(error(null)).toContain("最上位");
  });

  test("無いツールプロファイルを指していればエラー（マージ後にしか分からない）", () => {
    expect(error({ agents: { planner: { tools: "readwrite" } } })).toContain("tool_profiles");
    // プロファイル自体を書き換えるのは通る
    expect(merged({ tool_profiles: { readonly: "Read,Grep" } }).tool_profiles.readonly).toBe(
      "Read,Grep",
    );
  });

  test("エラーがあるときは設定を一部だけ適用しない（既定のまま返す）", () => {
    const r = mergeConfig(base, { limits: { dev_review_rounds: 3 }, pipeline_version: 2 });
    expect(r.errors.length).toBe(1);
    expect(r.config).toEqual(base);
  });

  test("エラーは全部集めて返す（1 つ直すたびに止まらない）", () => {
    const r = mergeConfig(base, { limits: { total_steps: 0, plan_rounds: 3 } });
    expect(r.errors.length).toBe(2);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../../../__tests__/helpers.ts";
import { cleanupRuns, makeRun, runOnce } from "../../../../__tests__/runDirFixture.ts";
import { middlewares } from "../index.ts";

const c = config();
afterEach(cleanupRuns);

/**
 * middleware の並びは仕様である。**`next` より後のコードは内側から外側へ逆順に走る**ので、
 * 配列の順序が「ファイルへの書き込みの順序」を決める。
 */
describe("middleware の並び", () => {
  test("外側から guard → snapshot → reviewFile → eventLog → hydrate", () => {
    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      "guard",
      "snapshot",
      "reviewFile",
      "eventLog",
      "hydrate",
    ]);
  });

  test("**イベントの追記はスナップショットの書き出しより先**（落ちても正が残る）", () => {
    const dir = makeRun("planning");
    const before = readdirSync(join(dir, "events")).length;
    // state.json をディレクトリに差し替えて、スナップショットの書き出しだけを失敗させる
    rmSync(join(dir, "state.json"));
    mkdirSync(join(dir, "state.json"));

    // スナップショットの書き出しで落ちる（実行の開始を記録した直後）
    expect(() => runOnce(dir, "planner", { result: "ok" }, c)).toThrow();

    // **状態の正であるイベントは残っている**（次の起動が畳み込み直せる）。
    // 逆順だとスナップショットだけが進み、この記録が失われる
    const after = readdirSync(join(dir, "events")).sort();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toContain("agent_started");
  });
});

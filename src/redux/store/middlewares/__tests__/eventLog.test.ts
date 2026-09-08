import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../../../__tests__/helpers.ts";
import {
  approve,
  cleanupRuns,
  makeRun,
  requestChanges,
  route,
  runOnce,
} from "../../../../__tests__/runDirFixture.ts";
import { readEvents } from "../../../../file/eventLog.ts";

const c = config();
afterEach(cleanupRuns);

const types = (dir: string) => readEvents(dir).map((event) => event.type.split("/").at(-1));

/**
 * イベントログが状態の正であること（K-26 / A-53 段取り 2）。
 * 状態は毎回このログの畳み込みから組み上がるので、記録の漏れは即座に振る舞いに出る。
 */
describe("eventLog middleware", () => {
  test("エージェントの実行は開始と終了の 2 イベントで残る", () => {
    const dir = makeRun();
    runOnce(dir, "planner", { result: "ok" }, c);
    expect(types(dir)).toEqual(["BOOTSTRAP", "AGENT_STARTED", "PLANNED"]);
  });

  test("**人間の介入も同じログに載る**（承認・差し戻し・retry）", () => {
    const dir = makeRun("awaiting_human");
    approve(dir, "OWNER", c);
    expect(types(dir).at(-1)).toBe("HUMAN_APPROVAL");

    const other = makeRun("awaiting_human");
    requestChanges(other, "OWNER", "やり直し", c);
    expect(types(other).at(-1)).toBe("HUMAN_REQUEST_CHANGES");
  });

  test("受け付けられなかった action は記録しない（状態も変わらない）", () => {
    const dir = makeRun("planning");
    const before = types(dir);
    expect(approve(dir, "OWNER", c).ok).toBe(false);
    expect(types(dir)).toEqual(before);
  });

  test("読み取り専用のコマンドは何も書かない", () => {
    const dir = makeRun("plan_review");
    const before = types(dir);
    route(dir, c);
    expect(types(dir)).toEqual(before);
  });

  test("再生では追記しない（畳み込みが 2 倍にならない）", () => {
    const dir = makeRun("dev_review");
    const count = types(dir).length;
    // route は init を dispatch して全イベントを再生する
    route(dir, c);
    route(dir, c);
    expect(types(dir).length).toBe(count);
  });
});

describe("hydrate middleware", () => {
  test("イベントを畳み込んで状態を組み上げる（起動をまたいで一致する）", () => {
    const dir = makeRun("completing");
    const r = route(dir, c);
    expect(r.phase).toBe("completing");
    expect(r.run?.agent).toBe("completion");
    // 往復は判定のイベントから数える
    expect(r.rounds).toEqual({ plan_review: 1, dev_review: 1 });
    expect(r.total_steps).toBe(4);
  });

  test("**過去は検証しない。** 上限を後から下げても畳み込みは変わらない（A-19 との相互作用）", () => {
    const dir = makeRun("completing");
    const strict = { ...c, limits: { ...c.limits, plan_review_rounds: 1, dev_review_rounds: 1 } };
    expect(route(dir, strict).phase).toBe("completing");
  });
});

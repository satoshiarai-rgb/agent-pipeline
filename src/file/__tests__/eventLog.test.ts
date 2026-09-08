import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { cleanupRuns, makeRun } from "../../__tests__/runDirFixture.ts";
import { agentFailed, planReviewed } from "../../redux/store/app/actions.ts";
import { appendEvent, eventFileName, eventPaths, readEvents } from "../eventLog.ts";

afterEach(cleanupRuns);

const origin = { timestamp: "20260908T054512Z", by: "harness" };
const run = { run_id: "17301992044", attempt: 1 };

describe("イベントのファイル名", () => {
  test("連番・時刻・実行・種類の順に並ぶ", () => {
    const action = planReviewed({ ...origin, ...run, verdict: "approve" });
    expect(eventFileName(action, run, 7)).toBe(
      "0007-20260908T054512Z-17301992044-1-plan_reviewed.json",
    );
  });

  test("時刻にコロンを含まない（Windows でチェックアウトできなくなる）", () => {
    const name = eventFileName(planReviewed({ ...origin, ...run, verdict: "approve" }), run, 1);
    expect(name).not.toContain(":");
  });

  test("並び順は連番が決める（run_id の桁数に依存しない）", () => {
    const dir = makeRun();
    for (const run_id of ["9999999999", "17301992044"]) {
      appendEvent(dir, agentFailed({ ...origin, run_id, attempt: 1, reason: "x" }), {
        run_id,
        attempt: 1,
      });
    }
    // 文字列比較だと 17301992044 が 9999999999 より前に来るが、連番が順序を決める
    expect(eventPaths(dir).map((path) => basename(path).slice(0, 4))).toEqual([
      "0001",
      "0002",
      "0003",
    ]);
  });

  test("timestamp が無い action は書けない（順序の根拠が失われる）", () => {
    expect(() => eventFileName({ type: "agent-pipeline/app/X", payload: {} }, run, 1)).toThrow(
      /timestamp/,
    );
  });
});

describe("追記と読み出し", () => {
  test("書くのは type / payload / error だけ（meta は文脈なので残さない）", () => {
    const dir = makeRun();
    const action = agentFailed({ ...origin, ...run, reason: "agent_failed" });
    const path = appendEvent(dir, { ...action, meta: { hydrate: true } }, run);

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(written).sort()).toEqual(["error", "payload", "type"]);
    expect(written.error).toBe(true);
    expect(written.payload.reason).toBe("agent_failed");
  });

  test("読み出したものはそのまま action として流せる形", () => {
    const dir = makeRun();
    appendEvent(dir, planReviewed({ ...origin, ...run, verdict: "request_changes" }), run);
    const events = readEvents(dir);

    expect(events[0]?.type).toBe("agent-pipeline/BOOTSTRAP");
    expect(events.at(-1)?.type).toBe("agent-pipeline/app/PLAN_REVIEWED");
    expect((events.at(-1)?.payload as { verdict: string }).verdict).toBe("request_changes");
  });

  test("イベントが無ければ空（bootstrap 前）", () => {
    expect(eventPaths("/tmp/存在しない-run")).toEqual([]);
    expect(readEvents("/tmp/存在しない-run")).toEqual([]);
  });
});

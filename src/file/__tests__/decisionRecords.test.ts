import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { cleanupRuns, makeRun } from "../../__tests__/runDirFixture.ts";
import {
  decisionRecordPath,
  decisionRecordPaths,
  decisionRecordProblems,
  decisionRecordsDir,
} from "../decisionRecords.ts";

afterEach(cleanupRuns);

const RUN = { run_id: "17293840112", attempt: 1 };

const RECORD = `---
type: design
title: セッション有効期限を 24h にした
reversibility: easy
---

## 決めたこと
既存の refresh token に揃えた。
`;

/** レコードを 1 ファイル書く。name を渡せば契約違反の名前も置ける */
const write = (dir: string, slug: string, text = RECORD, name?: string) => {
  mkdirSync(decisionRecordsDir(dir), { recursive: true });
  const path = name ? `${decisionRecordsDir(dir)}/${name}` : decisionRecordPath(dir, RUN, slug);
  writeFileSync(path, text);
  return path;
};

describe("書き込み先（契約 §5）", () => {
  test("名前は <run_id>-<attempt>-<slug>.md で、prefix はハーネスが決める", () => {
    const dir = makeRun();
    expect(decisionRecordPath(dir, RUN, "session-ttl")).toBe(
      `${dir}/decision-records/17293840112-1-session-ttl.md`,
    );
  });

  test("実行が変われば prefix も変わる（過去のラウンドの記録を上書きできない）", () => {
    const dir = makeRun();
    const first = decisionRecordPath(dir, RUN, "session-ttl");
    const second = decisionRecordPath(dir, { run_id: "17301992044", attempt: 2 }, "session-ttl");
    expect(first).not.toBe(second);
  });
});

describe("読み込み", () => {
  test("無ければ空", () => {
    expect(decisionRecordPaths(makeRun())).toEqual([]);
  });

  test("1 ファイル 1 レコードとしてパスを列挙する（中身は読まない）", () => {
    const dir = makeRun();
    write(dir, "session-ttl");
    write(dir, "token-rotation", RECORD.replace("easy", "hard").replace("design", "requirements"));

    // prefix が同じなら名前順（session-ttl → token-rotation）
    expect(decisionRecordPaths(dir).map((p) => basename(p))).toEqual([
      "17293840112-1-session-ttl.md",
      "17293840112-1-token-rotation.md",
    ]);
  });

  test("実行順に返す（run_id の桁が増えても順序が壊れない）", () => {
    const dir = makeRun();
    write(dir, "b", RECORD, "9999999999-1-b.md");
    write(dir, "a", RECORD, "17301992044-1-a.md");
    write(dir, "c", RECORD, "17301992044-2-c.md");

    expect(decisionRecordPaths(dir).map((p) => basename(p))).toEqual([
      "9999999999-1-b.md",
      "17301992044-1-a.md",
      "17301992044-2-c.md",
    ]);
  });
});

describe("契約（§4）の検査", () => {
  test("1 つも書かないことは違反ではない", () => {
    expect(decisionRecordProblems(makeRun())).toEqual([]);
  });

  test("妥当なら何も返さない", () => {
    const dir = makeRun();
    write(dir, "session-ttl");
    write(dir, "token-rotation");
    expect(decisionRecordProblems(dir)).toEqual([]);
  });

  test("名前の形を見る（prefix を無視した名前・日本語の名前を通さない）", () => {
    const dir = makeRun();
    write(dir, "x", RECORD, "D-1.md");
    expect(decisionRecordProblems(dir)[0]).toContain("名前が <run_id>-<attempt>-<slug>.md");

    const other = makeRun();
    write(other, "x", RECORD, "17293840112-1-セッション.md");
    expect(decisionRecordProblems(other)[0]).toContain("名前が");
  });

  test("frontmatter が無ければ 1 つの理由だけを返す", () => {
    const dir = makeRun();
    write(dir, "session-ttl", "## 決めたこと\n\n24h にした\n");
    expect(decisionRecordProblems(dir)).toEqual([
      "17293840112-1-session-ttl.md: frontmatter が無い",
    ]);
  });

  test("type は決めた 4 つだけ（受け手で振り分けるための値なので自由記述を通さない）", () => {
    const dir = makeRun();
    write(dir, "session-ttl", RECORD.replace("type: design", "type: performance"));
    expect(decisionRecordProblems(dir)[0]).toContain("type は requirements | design");
  });

  test("reversibility は easy か hard だけ", () => {
    const dir = makeRun();
    write(dir, "session-ttl", RECORD.replace("reversibility: easy", "reversibility: 容易"));
    expect(decisionRecordProblems(dir)[0]).toContain("reversibility は easy か hard");
  });

  test("title と本文の欠落を見る", () => {
    const noTitle = makeRun();
    write(noTitle, "session-ttl", RECORD.replace("title: セッション有効期限を 24h にした", ""));
    expect(decisionRecordProblems(noTitle)[0]).toContain("title が無い");

    const noBody = makeRun();
    write(noBody, "session-ttl", "---\ntype: design\ntitle: x\nreversibility: easy\n---\n");
    expect(decisionRecordProblems(noBody)[0]).toContain("本文が無い");
  });
});

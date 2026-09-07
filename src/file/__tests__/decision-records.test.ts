import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { cleanupRuns, makeRun } from "../../__tests__/run-dir-fixture.ts";
import {
  type DecisionRecord,
  decisionRecordProblems,
  decisionRecordsPath,
  hasDecisionRecords,
  readDecisionRecords,
} from "../decision-records.ts";

afterEach(cleanupRuns);

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: "D-1",
  title: "セッション有効期限を 24h にした",
  decision: "既存の refresh token に揃えた",
  reversibility: "easy",
  ...over,
});

const write = (dir: string, records: Partial<DecisionRecord>[] | string) => {
  const text =
    typeof records === "string" ? records : `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
  writeFileSync(decisionRecordsPath(dir), text);
  return dir;
};

describe("読み込み", () => {
  test("無ければ無いと分かる", () => {
    expect(hasDecisionRecords(makeRun())).toBe(false);
  });

  test("1 行 1 レコードとして読む", () => {
    const dir = write(makeRun(), [record(), record({ id: "D-2", reversibility: "hard" })]);
    const rs = readDecisionRecords(dir);
    expect(rs.map((r) => r.id)).toEqual(["D-1", "D-2"]);
    expect(rs[1]?.reversibility).toBe("hard");
  });

  test("空行は飛ばす（追記で末尾に改行が増えても読める）", () => {
    const dir = write(makeRun(), `${JSON.stringify(record())}\n\n`);
    expect(readDecisionRecords(dir)).toHaveLength(1);
  });
});

describe("契約（§4）の検査", () => {
  const problems = (records: Partial<DecisionRecord>[] | string) =>
    decisionRecordProblems(
      typeof records === "string" ? records : records.map((r) => JSON.stringify(r)).join("\n"),
    );

  test("妥当なら何も返さない", () => {
    expect(problems([record(), record({ id: "D-2" })])).toEqual([]);
  });

  test("空でも妥当（任意の出力なので）", () => {
    expect(problems("")).toEqual([]);
  });

  test("壊れた行は行番号を添えて返す", () => {
    const [p] = problems(`${JSON.stringify(record())}\nこれは JSON ではない`);
    expect(p).toContain("2 行目");
  });

  test("必須フィールドの欠落を見る", () => {
    expect(problems([{ title: "x", decision: "y", reversibility: "easy" }])[0]).toContain(
      "id が無い",
    );
    expect(problems([record({ title: undefined })])[0]).toContain("title が無い");
    expect(problems([record({ decision: undefined })])[0]).toContain("decision が無い");
  });

  test("reversibility は easy か hard だけ", () => {
    // 後戻りの容易さで機械的に絞り込むための値なので、自由記述を通さない
    expect(problems([record({ reversibility: "容易" as never })])[0]).toContain("reversibility");
    expect(problems([record({ reversibility: "hard" })])).toEqual([]);
  });

  test("id の重複を見る（追記のたびに新しい番号を振らせる）", () => {
    expect(problems([record(), record()])[0]).toContain("D-1 が重複");
  });
});

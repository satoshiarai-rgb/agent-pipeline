import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRunDir } from "../read-run-dir.ts";

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const make = (records: string[]) => {
  dir = mkdtempSync(join(tmpdir(), "run-dir-"));
  writeFileSync(join(dir, "state.json"), '{"phase":"planning"}\n');
  if (records.length) mkdirSync(join(dir, "runs"), { recursive: true });
  for (const [i, n] of records.entries()) writeFileSync(join(dir, "runs", n), `{"n":${i}}\n`);
  return dir;
};

describe("readRunDir", () => {
  test("state.json を読み、runs/ が無ければレコードは空", () => {
    const r = readRunDir(make([]));
    expect(r.stateText).toContain('"phase":"planning"');
    expect(r.records).toEqual([]);
  });

  test("runs/ の .json だけを名前順に読む", () => {
    const r = readRunDir(make(["b.json", "a.json", "notes.md"]));
    expect(r.records.map((x) => x.path.split("/").pop())).toEqual(["a.json", "b.json"]);
  });
});

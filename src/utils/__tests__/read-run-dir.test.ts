import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { readRunDir } from "../read-run-dir.ts";

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const make = (records: string[]) => {
  dir = mkdtempSync(join(tmpdir(), "run-dir-"));
  writeFileSync(join(dir, "state.yml"), "phase: planning\n");
  if (records.length) mkdirSync(join(dir, "runs"), { recursive: true });
  for (const [i, n] of records.entries()) writeFileSync(join(dir, "runs", n), `n: ${i}\n`);
  return dir;
};

describe("readRunDir", () => {
  test("state.yml を読み、runs/ が無ければレコードは空", () => {
    const r = readRunDir(make([]));
    expect(r.stateText).toContain("phase: planning");
    expect(r.records).toEqual([]);
  });

  test("runs/ の .yml だけを名前順に読む", () => {
    const r = readRunDir(make(["b.yml", "a.yml", "notes.md"]));
    expect(r.records.map((x) => x.path.split("/").pop())).toEqual(["a.yml", "b.yml"]);
  });
});

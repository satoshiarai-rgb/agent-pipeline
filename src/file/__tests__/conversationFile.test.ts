import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationPath, conversationPaths, conversationsDir } from "../conversationFile.ts";

const run = { run_id: "17293840112", attempt: 1 };

describe("やり取りの記録（conversations/）", () => {
  test("名前は run と エージェント で閉じ、番号と相手だけをエージェントに任せる", () => {
    const path = conversationPath(
      "agent-work/issue-12",
      run,
      "planner",
      "02",
      "leader-performance",
    );
    expect(path).toBe(
      "agent-work/issue-12/conversations/17293840112-1-planner-02-leader-performance.md",
    );
  });

  test("同じ run の中で種類の違う往復を見分けられる", () => {
    const consult = conversationPath("d", run, "planner", "01", "leader-consult");
    const review = conversationPath("d", run, "planner", "02", "leader-review");
    expect(consult).not.toBe(review);
  });

  test("保管されたやり取りは名前順に返る。無ければ空", () => {
    const dir = mkdtempSync(join(tmpdir(), "conv-"));
    expect(conversationPaths(dir)).toEqual([]);
    mkdirSync(conversationsDir(dir));
    for (const name of ["b-02-x.md", "a-01-x.md", "notes.txt"]) {
      writeFileSync(join(conversationsDir(dir), name), "");
    }
    expect(conversationPaths(dir)).toEqual([
      join(conversationsDir(dir), "a-01-x.md"),
      join(conversationsDir(dir), "b-02-x.md"),
    ]);
  });
});

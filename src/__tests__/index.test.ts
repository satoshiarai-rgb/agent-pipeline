import { describe, expect, test } from "bun:test";
import { defaults } from "../defaults.ts";
import { MissingArg, runCommand } from "../redux/runCommand.ts";

describe("公開 IF（index.ts）", () => {
  test("ワークフローから呼ぶものを re-export している", async () => {
    const api = await import("../index.ts");
    for (const name of ["runCommand", "createStore", "validateRun", "composeRun", "readConfig"]) {
      expect(typeof api[name as keyof typeof api], name).toBe("function");
    }
  });

  // 語彙は runCommand の中の表にある。知っているコマンドは引数不足で MissingArg になり、
  // 知らないコマンドだけが undefined を返す（CLI が使い方を出す分岐）
  test("CLI の語彙がそろっている（対応表の取りこぼしを防ぐ）", () => {
    const vocabulary = [
      "approve",
      "bootstrap",
      "compose",
      "explain",
      "finish",
      "label",
      "request-changes",
      "retry",
      "route",
      "snapshot",
      "start",
      "validate",
    ];
    for (const name of vocabulary) {
      expect(() => runCommand(name, {}, defaults), name).toThrow(MissingArg);
    }
    // 知らないコマンドはどの分岐にも当たらず undefined（--dir は分岐の手前で要る）
    expect(runCommand("nope", { dir: "/nonexistent-run" }, defaults)).toBeUndefined();
  });
});

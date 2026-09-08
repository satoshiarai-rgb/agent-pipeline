import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../pipelineSettings.ts";
import { MissingArg, runCommand } from "../redux/runCommand.ts";

describe("公開 IF（index.ts）", () => {
  test("外から import されるものだけを re-export している（A-55）", async () => {
    const api = await import("../index.ts");
    // 実際の利用者は scripts/__tests__/workflows.test.ts の 2 つだけ。
    // 増やすなら「誰が import するか」を先に決める
    expect(Object.keys(api).sort()).toEqual(["defaultSettings", "validateRun"]);
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
    ];
    for (const name of vocabulary) {
      expect(() => runCommand(name, {}, defaultSettings), name).toThrow(MissingArg);
    }
    // 知らないコマンドはどの分岐にも当たらず undefined（--dir は分岐の手前で要る）
    expect(runCommand("nope", { dir: "/nonexistent-run" }, defaultSettings)).toBeUndefined();
  });
});

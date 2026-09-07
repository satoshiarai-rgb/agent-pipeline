import { describe, expect, test } from "bun:test";
import { COMMANDS } from "../redux/commands.ts";

describe("公開 IF（index.ts）", () => {
  test("ワークフローから呼ぶものを re-export している", async () => {
    const api = await import("../index.ts");
    for (const name of [
      "runCommand",
      "createAgentStore",
      "validateRun",
      "composeRun",
      "readConfig",
    ]) {
      expect(typeof api[name as keyof typeof api], name).toBe("function");
    }
  });

  test("CLI の語彙が 11 個そろっている（対応表の取りこぼしを防ぐ）", () => {
    expect(Object.keys(COMMANDS).sort()).toEqual([
      "approve",
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
    ]);
  });
});

import { describe, expect, test } from "bun:test";

describe("公開 IF（index.ts）", () => {
  test("ワークフローから呼ぶ 6 コマンドを re-export している", async () => {
    const api = await import("../index.ts");
    for (const name of [
      "startRun",
      "routeRun",
      "finishRun",
      "approveRun",
      "requestChangesRun",
      "blockRun",
    ]) {
      expect(typeof api[name as keyof typeof api], name).toBe("function");
    }
  });
});

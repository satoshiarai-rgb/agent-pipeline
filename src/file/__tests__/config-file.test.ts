import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "../../defaults.ts";
import { CONFIG_PATH, readConfig } from "../config-file.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 配布先のチェックアウトを作る。text を渡したら .agent/config.json として置く */
function repo(text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-repo-"));
  dirs.push(dir);
  if (text !== undefined) {
    mkdirSync(join(dir, ".agent"), { recursive: true });
    writeFileSync(join(dir, CONFIG_PATH), text);
  }
  return dir;
}

describe("readConfig（配布先の .agent/config.json）", () => {
  test("ファイルが無ければ既定がそのまま使われる", () => {
    const r = readConfig(repo());
    expect(r.config).toBe(defaults);
    expect(r.source).toBeNull();
    expect(r.error).toBeNull();
  });

  test("書いたキーだけを既定に重ねる", () => {
    const r = readConfig(repo(JSON.stringify({ agents: { developer: { timeout_minutes: 60 } } })));
    expect(r.error).toBeNull();
    expect(r.source).toContain(CONFIG_PATH);
    expect(r.config.agents.developer.timeout_minutes).toBe(60);
    expect(r.config.agents.developer.max_turns).toBe(defaults.agents.developer.max_turns);
  });

  test("JSON が壊れていれば理由を返し、設定は既定のまま", () => {
    const r = readConfig(repo("{ limits: 1 }"));
    expect(r.error).toContain("JSON として壊れています");
    expect(r.config).toBe(defaults);
  });

  test("受け付けられない上書きは理由にパスを含める（PR コメントに出るため）", () => {
    const r = readConfig(repo(JSON.stringify({ limits: { plan_rounds: 3 } })));
    expect(r.error).toContain(CONFIG_PATH);
    expect(r.error).toContain("limits.plan_rounds");
    expect(r.config).toBe(defaults);
  });

  test("install/config.json（雛形）はそのまま置いても何も変えない", () => {
    // 雛形は上書きできるキーの一覧で、値はすべて null（= 既定を継承）。
    // 配ったものがそのままでは通らない、あるいは黙って既定を変える、という事故を防ぐ
    const template = readFileSync(join(import.meta.dir, "../../../install/config.json"), "utf8");
    const r = readConfig(repo(template));
    expect(r.error).toBeNull();
    expect(r.config).toEqual(defaults);
  });
});

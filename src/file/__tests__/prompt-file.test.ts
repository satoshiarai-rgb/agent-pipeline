import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  promptCandidates,
  readConventions,
  readPrompt,
  writeComposedPrompt,
} from "../prompt-file.ts";

const dirs: string[] = [];
const root = () => {
  const d = mkdtempSync(join(tmpdir(), "prompt-root-"));
  dirs.push(d);
  return d;
};
const put = (base: string, rel: string, text: string) => {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("役割プロンプトの解決順（契約 §2）", () => {
  test("配布先の .agent/prompts が中央の既定より優先される", () => {
    const repo = root();
    const central = root();
    put(repo, ".agent/prompts/developer.md", "配布先の developer");
    put(central, "prompts/developer.md", "中央の developer");

    const found = readPrompt("developer", { repo, central });
    expect(found.path).toBe(join(repo, ".agent", "prompts", "developer.md"));
    expect(found.text).toBe("配布先の developer");
  });

  test("配布先に無いエージェントだけ中央の既定に落ちる", () => {
    const repo = root();
    const central = root();
    put(repo, ".agent/prompts/developer.md", "配布先の developer");
    put(central, "prompts/developer.md", "中央の developer");
    put(central, "prompts/planner.md", "中央の planner");

    expect(readPrompt("planner", { repo, central }).text).toBe("中央の planner");
  });

  test("どちらにも無ければ探した順を添えてエラーにする", () => {
    const repo = root();
    const central = root();
    expect(() => readPrompt("planner", { repo, central })).toThrow(
      /planner のプロンプトがありません/,
    );
    expect(promptCandidates("planner", { repo, central })).toEqual([
      join(repo, ".agent", "prompts", "planner.md"),
      join(central, "prompts", "planner.md"),
    ]);
  });
});

describe("配布先の規約", () => {
  test("あれば中身を返す", () => {
    const repo = root();
    put(repo, ".agent/conventions.md", "  コミットは日本語で書く  \n");
    expect(readConventions(repo)?.text).toBe("コミットは日本語で書く");
  });

  test("無ければ null", () => {
    expect(readConventions(root())).toBeNull();
  });

  test("空ファイルは無いものとして扱う（空の節を作らない）", () => {
    const repo = root();
    put(repo, ".agent/conventions.md", "\n \n");
    expect(readConventions(repo)).toBeNull();
  });
});

describe("組み立てたプロンプトの書き出し", () => {
  test("親ディレクトリが無ければ作り、末尾に改行を 1 つ置く", () => {
    const out = join(root(), "nested", "agent-prompt.md");
    expect(writeComposedPrompt(out, "本文\n\n\n")).toBe(out);
    expect(readFileSync(out, "utf8")).toBe("本文\n");
  });
});

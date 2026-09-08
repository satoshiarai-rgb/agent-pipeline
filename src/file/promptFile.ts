import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentName } from "../types.ts";

/**
 * 役割プロンプトと配布先の規約を読む（契約 §2）。
 *
 * プロンプトは配布先で差し替えられる（K-15）。中央は既定を提供するだけなので、
 * 「どのファイルを使ったか」を返して呼び出し側が記録できるようにする。
 */

/** プロンプトを探す 2 つの根。repo は配布先のチェックアウト、central は中央リポジトリ */
export interface PromptRoots {
  repo: string;
  central: string;
}

/**
 * 解決順（契約 §2）。エージェント単位で先に見つかったものを使うため、
 * 配布先は一部のプロンプトだけを差し替えられる。
 */
export function promptCandidates(agent: AgentName, roots: PromptRoots): string[] {
  return [
    join(roots.repo, ".agent", "prompts", `${agent}.md`),
    join(roots.central, "prompts", `${agent}.md`),
  ];
}

/** 役割プロンプト。どちらの根にも無ければ実行できないのでエラーにする */
export function readPrompt(agent: AgentName, roots: PromptRoots): { path: string; text: string } {
  const candidates = promptCandidates(agent, roots);
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(`${agent} のプロンプトがありません（探した順: ${candidates.join(" → ")}）`);
  }
  return { path, text: readFileSync(path, "utf8").trim() };
}

/** 配布先の規約（全エージェントに差し込まれる）。無ければ null */
export function readConventions(repo: string): { path: string; text: string } | null {
  const path = join(repo, ".agent", "conventions.md");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? null : { path, text };
}

/**
 * 組み立てたプロンプトを書き、そのパスを返す。
 * run のディレクトリではなく実行時の作業領域に書く（成果物ではないため git に載せない）。
 */
export function writeComposedPrompt(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${text.trimEnd()}\n`);
  return path;
}

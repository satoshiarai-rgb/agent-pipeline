import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunFile } from "../run-file.ts";

const dirs: string[] = [];

/** templates/state.yml を元に一時的な run ディレクトリを作る */
export function makeRun(phase = "planning"): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-run-"));
  dirs.push(dir);
  const template = readFileSync(join(import.meta.dir, "../../templates/state.yml"), "utf8")
    .replace("issue: 0", "issue: 123")
    .replace('branch: ""', "branch: claude/issue-123")
    .replace("phase: planning", `phase: ${phase}`);
  writeFileSync(join(dir, "state.yml"), template);
  return dir;
}

/** 作った run ディレクトリを片付ける（afterEach から呼ぶ） */
export function cleanupRuns(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const phaseOf = (dir: string) => parseRunFile(readFileSync(join(dir, "state.yml"), "utf8"));

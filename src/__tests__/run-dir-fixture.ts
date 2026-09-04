import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStateFile } from "../state-file.ts";

const dirs: string[] = [];

/** templates/state.json を元に一時的な run ディレクトリを作る */
export function makeRun(phase = "planning"): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-run-"));
  dirs.push(dir);
  const template = JSON.parse(
    readFileSync(join(import.meta.dir, "../../templates/state.json"), "utf8"),
  );
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({ ...template, issue: 123, branch: "claude/issue-123", phase }, null, 2),
  );
  return dir;
}

/** 作った run ディレクトリを片付ける（afterEach から呼ぶ） */
export function cleanupRuns(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const phaseOf = (dir: string) =>
  parseStateFile(readFileSync(join(dir, "state.json"), "utf8"));

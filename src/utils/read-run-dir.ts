import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * run のディレクトリ（agent-work/issue-<n>/）から生のテキストを読む。
 * YAML の解釈はしない。ドメインを知らない層に閉じるため。
 */
export function readRunDir(dir: string): {
  stateText: string;
  records: { path: string; text: string }[];
} {
  const runsDir = join(dir, "runs");
  const records = existsSync(runsDir)
    ? readdirSync(runsDir)
        .filter((n) => n.endsWith(".yml"))
        .sort()
        .map((n) => ({ path: join(runsDir, n), text: readFileSync(join(runsDir, n), "utf8") }))
    : [];
  return { stateText: readFileSync(join(dir, "state.yml"), "utf8"), records };
}

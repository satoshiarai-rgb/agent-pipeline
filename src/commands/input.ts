import type { Config } from "../defaults.ts";

/**
 * すべてのコマンドが受け取る入力。
 * dir は run のディレクトリ（agent-work/issue-<n>）、now はテストから時刻を固定するため。
 */
export interface CommandInput {
  dir: string;
  config: Config;
  now?: Date;
}

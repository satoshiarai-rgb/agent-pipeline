import type { Config } from "../defaults.ts";

/**
 * すべてのコマンドが受け取る入力。
 * dir は run のディレクトリ（agent-work/issue-<n>）、now はテストから時刻を固定するため。
 */
export interface CommandInput {
  dir: string;
  config: Config;
  now?: Date;
  /**
   * 配布先の `.agent/config.json` を受け付けられなかった理由（`readConfig` の error）。
   * 読むのは `route` だけで、`blocked` にして人間に伝える。
   * ほかのコマンドは cli.ts の入口で失敗させるのでここには来ない
   */
  config_error?: string | null;
}

/**
 * ハーネスの公開 IF。実装は `redux/`（状態と、状態を使う判断）と `commands/`
 * （状態を使わない処理）にあり、ここは「外から呼べるもの」の一覧としてまとめるだけ。
 *
 * ワークフローが叩くのは CLI（`cli.ts` → `redux/runCommand.ts` の分岐）で、
 * この一覧はテストと将来の埋め込み利用のためにある。
 */

export type { ComposeResult } from "./commands/compose.ts";
export { composeRun } from "./commands/compose.ts";

export type { Config } from "./defaults.ts";
export { defaults } from "./defaults.ts";
export type { LoadedConfig } from "./file/configFile.ts";
export { CONFIG_PATH, readConfig } from "./file/configFile.ts";
export * from "./redux/index.ts";

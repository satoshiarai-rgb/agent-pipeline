/**
 * ハーネスの公開 IF。実装は `redux/`（状態と判断）と `commands/`（成果物の検証と
 * プロンプトの組み立て）にあり、ここは「外から呼べるもの」の一覧としてまとめるだけ。
 *
 * ワークフローが叩くのは CLI（`cli.ts` → `redux/commands.ts` の対応表）で、
 * この一覧はテストと将来の埋め込み利用のためにある。
 */

export type { ComposeResult } from "./commands/compose.ts";
export { composeRun } from "./commands/compose.ts";
export { explainRun } from "./commands/explain.ts";
export { validateRun } from "./commands/validate.ts";
export type { Config } from "./defaults.ts";
export { defaults } from "./defaults.ts";
export type { LoadedConfig } from "./file/config-file.ts";
export { CONFIG_PATH, readConfig } from "./file/config-file.ts";
export * from "./redux/index.ts";

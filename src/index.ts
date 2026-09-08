/**
 * ハーネスを埋め込んで使うための公開 IF。**ワークフローが叩くのは CLI**
 * （`cli.ts` → `redux/runCommand.ts` の分岐）で、ここは外から import される分だけを並べる。
 *
 * 一覧を広く持つと、どこからも使われない re-export が溜まって「何が外向きか」が
 * 分からなくなるので、**実際に import されているものだけ**を置く（A-55）。
 */

export type { PipelineSettings } from "./pipelineSettings.ts";
export { defaultSettings } from "./pipelineSettings.ts";
export { validateRun } from "./redux/effects/validate.ts";

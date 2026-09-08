/**
 * redux 層の公開 IF。store の中身（ducks・middleware・ガード・selector）は
 * `store/` 以下にあり、外から使うものだけをここに並べる。
 *
 * **store の値で実行を判断するものはこの層に置く** — `validate` は検査する相手を
 * `selectInFlightAgent` から受け取り、`explain` は `selectStatus` を読む。
 */

export { explainRun } from "./explain.ts";
export { mapValidationToAction } from "./mapValidationToAction.ts";
export type { Args } from "./runCommand.ts";
export { MissingArg, runCommand } from "./runCommand.ts";
export * from "./store/app/actions.ts";
export type { RootState, Wiring } from "./store/createStore.ts";
export { createStore } from "./store/createStore.ts";
export type { PipelineAction, PipelineDispatch } from "./store/global/actions.ts";
export { init } from "./store/global/actions.ts";
export * from "./store/global/selectors.ts";
export type { ValidationReport } from "./validate.ts";
export { validateRun } from "./validate.ts";

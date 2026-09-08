/**
 * redux 層の公開 IF。store の中身（ducks・middleware・ガード・selector）は
 * `store/` 以下にあり、外から使うものだけをここに並べる。
 *
 * **store の値で実行を判断するものはこの層に置く。** 状態を読んでファイルに触るもの
 * （`validate` は成果物、`explain` は受け入れ条件）は `effects/` にまとめる —
 * 書き込みの副作用は dispatch の中で起きるので `store/middlewares/` にある。
 */

export { explainRun } from "./effects/explain.ts";
export type { ValidationReport } from "./effects/validate.ts";
export { validateRun } from "./effects/validate.ts";
export { mapValidationToAction } from "./mapValidationToAction.ts";
export type { Args } from "./runCommand.ts";
export { MissingArg, runCommand } from "./runCommand.ts";
export * from "./store/app/actions.ts";
export type { RootState, Wiring } from "./store/createStore.ts";
export { createStore } from "./store/createStore.ts";
export type { PipelineAction, PipelineDispatch } from "./store/global/actions.ts";
export { init } from "./store/global/actions.ts";
export * from "./store/global/selectors.ts";

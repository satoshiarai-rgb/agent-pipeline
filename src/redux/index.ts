/**
 * redux 層の公開 IF。store の中身（ducks・middleware・ガード・selector）は
 * `store/` 以下にあり、外から使うものだけをここに並べる。
 */

export type { Args } from "./commands.ts";
export { COMMANDS, isRejection, MissingArg, runCommand } from "./commands.ts";
export type { Outcome } from "./from-outcome.ts";
export { fromOutcome } from "./from-outcome.ts";
export * from "./store/app/actions.ts";
export type { RootState, Wiring } from "./store/createStore.ts";
export { createStore } from "./store/createStore.ts";
export type { PipelineAction, PipelineDispatch, RestorePayload } from "./store/global/actions.ts";
export { init, restore } from "./store/global/actions.ts";
export * from "./store/selectors.ts";

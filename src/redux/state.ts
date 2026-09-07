import type { AppState } from "./app/reducer.ts";
import type { InfoState } from "./info/reducer.ts";

/** store 全体。selector は ducks の慣習どおりこれを引数に取る */
export interface RootState {
  info: InfoState;
  app: AppState;
}

/** `RESTORE` の payload（既存のファイルから戻す値）。段取り 2 で消える */
export interface RestorePayload {
  info: Pick<InfoState, "issue" | "branch" | "pipeline_version">;
  app: Pick<AppState, "phase" | "blocked_reason" | "blocked_from" | "counts" | "in_flight">;
}

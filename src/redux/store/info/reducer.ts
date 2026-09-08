import { reducerWithInitialState } from "../../../utils/typescriptFsaReducers.ts";
import { bootstrap } from "../global/actions.ts";
import { configure } from "./actions.ts";

/** 設置と環境。ここは他のスライスを読まないので `combineReducers` に素直に載る */
export interface InfoState {
  /** ここから 3 つは `BOOTSTRAP` イベントが確定する run の識別子 */
  issue: number | null;
  branch: string | null;
  pipeline_version: number | null;
  /** ここから下は起動時に注入する環境（永続化しない） */
  dir: string;
  run_id: string | null;
  attempt: number;
}

export const initialInfo: InfoState = {
  issue: null,
  branch: null,
  pipeline_version: null,
  dir: "",
  run_id: null,
  attempt: 1,
};

/** **どの action がどう状態を変えるかの表**（`switch` を書かない） */
export const infoReducer = reducerWithInitialState(initialInfo)
  .case(configure, (state, payload) => ({ ...state, ...payload }))
  .case(bootstrap, (state, payload) => ({
    ...state,
    issue: payload.issue,
    branch: payload.branch,
    pipeline_version: payload.pipeline_version,
  }))
  .build();

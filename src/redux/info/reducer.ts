import { reducerWithInitialState } from "../../utils/typescript-fsa-reducers.ts";
import { restore } from "../actions.ts";
import { configure, hydrated } from "./actions.ts";

/** 設置と環境。ここは他のスライスを読まないので `combineReducers` に素直に載る */
export interface InfoState {
  /** ここから 3 つは run の識別子（イベントログから再現できる） */
  issue: number | null;
  branch: string | null;
  pipeline_version: number | null;
  /** ここから下は起動時に注入する環境（永続化しない） */
  dir: string;
  run_id: string | null;
  attempt: number;
  /** 再生が終わったか。subscriber が見る */
  hydrated: boolean;
}

export const initialInfo: InfoState = {
  issue: null,
  branch: null,
  pipeline_version: null,
  dir: "",
  run_id: null,
  attempt: 1,
  hydrated: false,
};

/** **どの action がどう状態を変えるかの表**（`switch` を書かない） */
export const infoReducer = reducerWithInitialState(initialInfo)
  .case(configure, (s, p) => ({ ...s, ...p }))
  .case(hydrated, (s) => ({ ...s, hydrated: true }))
  .case(restore, (s, p) => ({ ...s, ...p.info }))
  .build();

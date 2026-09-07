import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
  type Dispatch,
} from "redux";
import type { Config } from "../defaults.ts";
import type { Action } from "../utils/typescript-fsa.ts";
import { init } from "./actions.ts";
import type { AppPayload } from "./app/actions.ts";
import createAppReducer from "./app/index.ts";
import type { InfoPayload } from "./info/actions.ts";
import infoReducer, { configure } from "./info/index.ts";
import { middlewares } from "./middleware/index.ts";
import type { RestorePayload, RootState } from "./state.ts";

/**
 * store の組み立て。ここが唯一の配線で、判断は reducer とガードの表にある。
 *
 *   1. `combineReducers` で 2 スライス（設置と実行状況）に分ける
 *   2. middleware を並べる（順序の意味は `middleware/index.ts` に書いてある）
 *   3. `configure` で環境（run ディレクトリ・ラン ID）を注入する
 *   4. **`init` を dispatch する。これが最初の処理**で、`hydrate` middleware が
 *      ファイルを読んで状態を復元する
 *
 * `legacy_createStore` を使うのは、Redux 5 で `createStore` が非推奨（RTK の
 * `configureStore` 推奨）になっており、RTK は immer / reselect を連れてきて
 * バンドルの桁が変わるため（K-26）。
 */
/**
 * この store が受け取る action の全体（公開 IF）。FSA は「最上位のキーは
 * type / payload / error / meta だけ」なので Redux 5 の `UnknownAction`
 * （任意のキーを許す索引シグネチャ付き）には当てはまらない。dispatch の型を
 * この union で固定して FSA の形を保つ。
 */
export type PipelineAction = Action<AppPayload | InfoPayload | RestorePayload>;
export type PipelineDispatch = Dispatch<PipelineAction>;

export interface Wiring {
  dir: string;
  config: Config;
  run_id?: string | null;
  attempt?: number;
}

export function createAgentStore(input: Wiring) {
  const outputs: Record<string, unknown> = {};
  const wiring = { config: input.config, outputs };
  const store = createStore(
    combineReducers({ info: infoReducer, app: createAppReducer(input.config) }),
    applyMiddleware(...middlewares.map((m) => m(wiring))),
  );
  store.dispatch(
    configure({ dir: input.dir, run_id: input.run_id ?? null, attempt: input.attempt ?? 1 }),
  );
  store.dispatch(init(undefined));
  return { store, outputs, state: () => store.getState() as RootState };
}

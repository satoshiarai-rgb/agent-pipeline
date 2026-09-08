import { applyMiddleware, combineReducers, legacy_createStore } from "redux";
import type { Settings } from "../../settings.ts";
import createAppReducer from "./app/index.ts";
import type { AppState } from "./app/reducer.ts";
import { init } from "./global/actions.ts";
import infoReducer, { configure } from "./info/index.ts";
import type { InfoState } from "./info/reducer.ts";
import { middlewares } from "./middlewares/index.ts";

/**
 * store の組み立てと初期化。**ここが唯一の配線**で、判断は reducer とガードの表にある。
 *
 *   1. `combineReducers` で 2 スライスに分ける（設置と実行状況）
 *   2. middleware を並べる（順序の意味は `middlewares/index.ts` に書いてある）
 *   3. `configure` で環境（run ディレクトリ・ラン ID）を注入する
 *   4. **`init` を dispatch する。これが最初の処理**で、`hydrate` middleware が
 *      ファイルを読んで状態を復元する
 *
 * `legacy_createStore` を使うのは、Redux 5 で `createStore` が非推奨（RTK の
 * `configureStore` 推奨）になっており、RTK は immer / reselect を連れてきて
 * バンドルの桁が変わるため（K-26）。
 */

/** store 全体。selector は ducks の慣習どおりこれを引数に取る */
export interface RootState {
  info: InfoState;
  app: AppState;
}

export interface Wiring {
  dir: string;
  settings: Settings;
  run_id?: string | null;
  attempt?: number;
}

export function createStore(input: Wiring) {
  const outputs: Record<string, unknown> = {};
  const wiring = { settings: input.settings, outputs };
  const store = legacy_createStore(
    combineReducers({ info: infoReducer, app: createAppReducer(input.settings) }),
    applyMiddleware(...middlewares.map((m) => m(wiring))),
  );
  store.dispatch(
    configure({
      dir: input.dir,
      run_id: input.run_id ?? null,
      attempt: input.attempt ?? 1,
    }),
  );
  store.dispatch(init(undefined));
  return { store, outputs, state: () => store.getState() as RootState };
}

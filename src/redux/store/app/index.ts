/**
 * 実行状況の duck（ducks: reducer を default export、それ以外を named export）。
 * `settings` を畳み込む必要があるので、default は reducer を作る関数になる。
 */
import { createAppReducer } from "./reducer.ts";

export default createAppReducer;
export * from "./actions.ts";
export * from "./reducer.ts";

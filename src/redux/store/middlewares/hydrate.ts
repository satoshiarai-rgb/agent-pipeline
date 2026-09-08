import { readEvents } from "../../../file/eventLog.ts";
import { init, REPLAY } from "../global/actions.ts";
import type { AgentMiddleware } from "./types.ts";

/**
 * 最初の処理。`init` action を捕まえて **`events/*.json` を起きた順に 1 件ずつ再生する**。
 * 状態はこの畳み込みで組み上がり、`state.json` はその射影（スナップショット）にすぎない。
 *
 * 再生する action には `meta: { hydrate: true }` を付ける。**書き込み系の middleware は
 * 素通しし、ガードも過去を検証しない** — 現在の設定で過去のイベントを再検証すると、
 * `.agent/config.json` で上限や approvers を変えたあとに過去のイベントが弾かれ、
 * 畳み込みが実際と違う phase を返す（A-19 との相互作用 / K-26）。
 *
 * 読み取りも action で表すので、**読み取り専用のコマンド（route / label / explain）は
 * 何も書かない**（書き込み系の middleware は状態を変える action にだけ反応する）。
 */
export const hydrate: AgentMiddleware = () => (store) => (next) => (action) => {
  if (!init.match(action as never)) return next(action);

  const { dir } = store.getState().info;
  for (const event of readEvents(dir)) {
    store.dispatch({ ...event, meta: REPLAY } as never);
  }
  return undefined; // init は reducer に渡さない
};

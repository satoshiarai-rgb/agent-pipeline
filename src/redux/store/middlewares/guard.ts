import type { AnyAction } from "../../../utils/typescript-fsa.ts";
import { rejection } from "../guards.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * 受け付けない action を止める。**`next` を呼ばず、理由を `dispatch` の戻り値にする**
 * （middleware が戻り値を差し替えられる仕組みは thunk と同じ）。
 *
 * **再生中は素通しする — 過去は検証しない。** 現在の設定で過去のイベントを再検証すると、
 * `.agent/config.json` で上限や approvers を変えたあとに過去のイベントが弾かれ、
 * 畳み込みが実際と違う phase を返す（A-19 との相互作用 / K-26）。
 */
export const guard: AgentMiddleware =
  ({ config }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    const a = action as AnyAction;
    // 実行状況を動かす action だけがガードの対象（ducks の名前空間で見分ける）
    if (!String(a.type).startsWith("agent-pipeline/app/")) return next(action);

    const reason = rejection(store.getState(), a, config);
    if (reason) return { ok: false, reason };
    return next(action);
  };

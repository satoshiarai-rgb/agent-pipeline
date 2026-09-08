import type { Settings } from "../../../settings.ts";
import type { Action, AnyAction } from "../../../utils/typescriptFsa.ts";
import type { AppPayload, Origin } from "../app/actions.ts";
import { humanApproval, humanRequestChanges, retry } from "../app/actions.ts";
import type { RootState } from "../createStore.ts";
import { selectStale, selectStatus } from "../global/selectors.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * 受け付けない action を止める middleware。**`next` を呼ばず、理由を `dispatch` の
 * 戻り値にする**（middleware が戻り値を差し替えられる仕組みは thunk と同じ）。
 *
 * **再生中は素通しする — 過去は検証しない。** 現在の設定で過去のイベントを再検証すると、
 * `.agent/config.json` で上限や approvers を変えたあとに過去のイベントが弾かれ、
 * 畳み込みが実際と違う phase を返す（A-19 との相互作用 / K-26）。
 *
 * ここで弾くのは「状態を変えなくても破綻しないもの」だけ — 人間の操作である。
 * ラウンド上限のようにエージェントの実行結果として起きる停止は**必ず状態を変える**
 * （拒否すると誰も状態を書かず、次の push も同じ所に戻って run が無音で止まる）ので、
 * 遷移の規則（`app/reducer.ts`）が担う。
 */

export type Guard = (
  root: RootState,
  action: Action<AppPayload>,
  settings: Settings,
) => string | null;

/** payload.by は "human:<author_association>"。認可は入口でのみ見る（設計書 §7.3） */
function associationOf(action: Action<AppPayload>): string {
  const by = (action.payload as Origin).by ?? "";
  return by.replace(/^human:/, "");
}

const authorized: Guard = (_root, action, settings) => {
  const association = associationOf(action);
  if (settings.approvers.includes(association)) return null;
  return `not_authorized: ${association}`;
};

/**
 * 対象外のフェーズでのコメントは何もしない（取り違えを黙って進めない）。
 * 人間が判断を入れられるのは計画の承認待ちだけ（設計書 §3.1 / K-10）。
 */
const awaitingHuman: Guard = ({ app }) => {
  if (app.phase === "awaiting_human") return null;
  return `not_awaiting_approval: phase=${app.phase}`;
};

/**
 * 「止まっている」は導出された状態（`selectStatus`）で判断する。
 * **死んだ実行（stale）も「止まっている」に含める** — 記録の上では走っているが、
 * ジョブはもう居ないので誰も次を書かない（I-8）。
 */
const mustBeBlocked: Guard = (root, action, settings) => {
  if (selectStatus(root, settings).blocked_reason) return null;
  const now = (action.payload as Origin).timestamp;
  if (selectStale(root, settings, now)) return null;
  return `not_blocked: phase=${root.app.phase}`;
};

/** 上限で止まったものはやり直しても同じ理由で止まる。issue を分けて立て直す方が正しい */
const notLimitReached: Guard = (root, _action, settings) => {
  const reason = selectStatus(root, settings).blocked_reason;
  if (reason?.includes("_exceeded")) return `limit_reached: ${reason}`;
  return null;
};

/**
 * route は実行中のレコードを見て何もしないので、走っている最中に戻しても静かに
 * 止まったままになる。**ただし死んだ実行は戻してよい**（それが復旧手段 / I-8）。
 */
const notInFlight: Guard = (root, action, settings) => {
  const { in_flight_agent, in_flight_run_id } = root.app;
  if (!in_flight_agent) return null;
  const now = (action.payload as Origin).timestamp;
  if (selectStale(root, settings, now)) return null;
  return `run_in_progress: ${in_flight_agent} run=${in_flight_run_id}`;
};

/** action ごとのガード。**上から順に適用し、最初に返った理由を使う** */
const GUARDS: Record<string, Guard[]> = {
  [humanApproval.type]: [authorized, awaitingHuman],
  [humanRequestChanges.type]: [authorized, awaitingHuman],
  [retry.type]: [authorized, mustBeBlocked, notLimitReached, notInFlight],
};

/** 受け付けない理由。null なら通す */
export function rejection(root: RootState, action: AnyAction, settings: Settings): string | null {
  for (const guard of GUARDS[action.type] ?? []) {
    const reason = guard(root, action as Action<AppPayload>, settings);
    if (reason) return reason;
  }
  return null;
}

/** 実行状況を動かす action だけがガードの対象（ducks の名前空間で見分ける） */
const isAppAction = (action: AnyAction): boolean =>
  String(action.type).startsWith("agent-pipeline/app/");

export const guard: AgentMiddleware =
  ({ settings }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    if (!isAppAction(action as AnyAction)) return next(action);

    const reason = rejection(store.getState(), action as AnyAction, settings);
    if (reason) return { ok: false, reason };
    return next(action);
  };

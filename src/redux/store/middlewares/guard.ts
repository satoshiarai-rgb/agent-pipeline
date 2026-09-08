import type { Config } from "../../../defaults.ts";
import type { Action, AnyAction } from "../../../utils/typescript-fsa.ts";
import type { AppPayload, Origin } from "../app/actions.ts";
import { humanApproval, humanRequestChanges, retry } from "../app/actions.ts";
import type { RootState } from "../createStore.ts";
import { selectStatus } from "../global/selectors.ts";
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

export type Guard = (root: RootState, action: Action<AppPayload>, config: Config) => string | null;

/** payload.by は "human:<author_association>"。認可は入口でのみ見る（設計書 §7.3） */
function associationOf(action: Action<AppPayload>): string {
  const by = (action.payload as Origin).by ?? "";
  return by.replace(/^human:/, "");
}

const authorized: Guard = (_root, action, config) => {
  const association = associationOf(action);
  if (config.approvers.includes(association)) return null;
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

/** 「止まっている」は導出された状態（`selectBlocked`）で判断する */
const mustBeBlocked: Guard = (root, _action, config) => {
  if (selectStatus(root, config).blocked_reason) return null;
  return `not_blocked: phase=${root.app.phase}`;
};

/** 上限で止まったものはやり直しても同じ理由で止まる。issue を分けて立て直す方が正しい */
const notLimitReached: Guard = (root, _action, config) => {
  const reason = selectStatus(root, config).blocked_reason;
  if (reason?.includes("_exceeded")) return `limit_reached: ${reason}`;
  return null;
};

/** 実行位置が失われている（スナップショットの phase が blocked のまま復元された場合） */
const knowsWhereToResume: Guard = ({ app }) => {
  if (app.phase === "blocked") return "no_records: 実行の記録が無いので戻る先が決まらない";
  return null;
};

/** route は実行中のレコードを見て何もしないので、戻しても静かに止まったままになる */
const notInFlight: Guard = ({ app }) => {
  if (app.in_flight_agent) {
    return `run_in_progress: ${app.in_flight_agent} run=${app.in_flight_run_id}`;
  }
  return null;
};

/** action ごとのガード。**上から順に適用し、最初に返った理由を使う** */
const GUARDS: Record<string, Guard[]> = {
  [humanApproval.type]: [authorized, awaitingHuman],
  [humanRequestChanges.type]: [authorized, awaitingHuman],
  [retry.type]: [authorized, mustBeBlocked, notLimitReached, knowsWhereToResume, notInFlight],
};

/** 受け付けない理由。null なら通す */
export function rejection(root: RootState, action: AnyAction, config: Config): string | null {
  for (const guard of GUARDS[action.type] ?? []) {
    const reason = guard(root, action as Action<AppPayload>, config);
    if (reason) return reason;
  }
  return null;
}

/** 実行状況を動かす action だけがガードの対象（ducks の名前空間で見分ける） */
const isAppAction = (action: AnyAction): boolean =>
  String(action.type).startsWith("agent-pipeline/app/");

export const guard: AgentMiddleware =
  ({ config }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    if (!isAppAction(action as AnyAction)) return next(action);

    const reason = rejection(store.getState(), action as AnyAction, config);
    if (reason) return { ok: false, reason };
    return next(action);
  };

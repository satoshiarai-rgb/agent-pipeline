import type { Config } from "../../defaults.ts";
import type { Action, AnyAction } from "../../utils/typescript-fsa.ts";
import type { AppPayload, Origin } from "./app/actions.ts";
import { humanApproval, humanRequestChanges, retry } from "./app/actions.ts";
import { TRANSITIONS } from "./app/reducer.ts";
import type { RootState } from "./createStore.ts";
import { selectBlocked } from "./selectors.ts";

/**
 * dispatch を受け付けない条件。**理由を返せば reducer を呼ばない**（`guard` middleware が
 * `next` を呼ばずに、この文字列を `dispatch` の戻り値にする）。
 *
 * ここに置くのは「状態を変えなくても破綻しないもの」だけ — 人間の操作である。
 * ラウンド上限のようにエージェントの実行結果として起きる停止は**必ず状態を変える**
 * （拒否すると誰も状態を書かず、次の push も同じ所に戻って run が無音で止まる）ので、
 * 遷移のルール表（`app/reducer.ts`）が担う。
 */
export type Guard = (root: RootState, action: Action<AppPayload>, config: Config) => string | null;

/** payload.by は "human:<author_association>"。認可は入口でのみ見る（設計書 §7.3） */
const associationOf = (action: Action<AppPayload>) =>
  ((action.payload as Origin).by ?? "").replace(/^human:/, "");

const authorized: Guard = (_root, action, config) => {
  const association = associationOf(action);
  return config.approvers.includes(association) ? null : `not_authorized: ${association}`;
};

/** 対象外のフェーズでのコメントは何もしない（取り違えを黙って進めない） */
const canApprove: Guard = ({ app }) =>
  TRANSITIONS[app.phase]?.approval ? null : `not_awaiting_approval: phase=${app.phase}`;

const canRequestChanges: Guard = ({ app }) =>
  TRANSITIONS[app.phase]?.request_changes ? null : `not_awaiting_approval: phase=${app.phase}`;

/** 「止まっている」は導出された状態（`selectBlocked`）で判断する */
const mustBeBlocked: Guard = (root, _action, config) =>
  selectBlocked(root, config).blocked ? null : `not_blocked: phase=${root.app.phase}`;

/** 上限で止まったものはやり直しても同じ理由で止まる。issue を分けて立て直す方が正しい */
const notLimitReached: Guard = (root, _action, config) => {
  const reason = selectBlocked(root, config).reason;
  return reason?.includes("_exceeded") ? `limit_reached: ${reason}` : null;
};

/** 実行位置が失われている（スナップショットの phase が blocked のまま復元された場合） */
const knowsWhereToResume: Guard = ({ app }) =>
  app.phase === "blocked" ? "no_records: 実行の記録が無いので戻る先が決まらない" : null;

/** route は実行中のレコードを見て何もしないので、戻しても静かに止まったままになる */
const notInFlight: Guard = ({ app }) =>
  app.in_flight_agent
    ? `run_in_progress: ${app.in_flight_agent} run=${app.in_flight_run_id}`
    : null;

/** action ごとのガード。**上から順に適用し、最初に返った理由を使う** */
const GUARDS: Record<string, Guard[]> = {
  [humanApproval.type]: [authorized, canApprove],
  [humanRequestChanges.type]: [authorized, canRequestChanges],
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

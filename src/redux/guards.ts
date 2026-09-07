import type { Config } from "../defaults.ts";
import type { Action, AnyAction } from "../utils/typescript-fsa.ts";
import type { AppPayload, Origin } from "./app/actions.ts";
import { humanApproval, humanRequestChanges, retry } from "./app/actions.ts";
import { nextPhase, type TransitionEvent } from "./app/reducer.ts";
import type { RootState } from "./state.ts";

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
const transitionExists =
  (event: TransitionEvent): Guard =>
  ({ app }, _action, config) =>
    nextPhase(app.phase, event, config) ? null : `not_awaiting_approval: phase=${app.phase}`;

const mustBeBlocked: Guard = ({ app }) =>
  app.phase === "blocked" ? null : `not_blocked: phase=${app.phase}`;

/** 上限で止まったものはやり直しても同じ理由で止まる。issue を分けて立て直す方が正しい */
const notLimitReached: Guard = ({ app }) =>
  app.blocked_reason?.includes("_exceeded") ? `limit_reached: ${app.blocked_reason}` : null;

const knowsWhereToResume: Guard = ({ app }) =>
  app.blocked_from ? null : "no_records: 実行の記録が無いので戻る先が決まらない";

/** route は実行中のレコードを見て何もしないので、戻しても静かに止まったままになる */
const notInFlight: Guard = ({ app }) =>
  app.in_flight ? `run_in_progress: ${app.in_flight.agent} run=${app.in_flight.run_id}` : null;

/** action ごとのガード。**上から順に適用し、最初に返った理由を使う** */
const GUARDS: Record<string, Guard[]> = {
  [humanApproval.type]: [authorized, transitionExists("approval")],
  [humanRequestChanges.type]: [authorized, transitionExists("request_changes")],
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

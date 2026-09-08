import { appendEvent } from "../../../file/eventLog.ts";
import {
  agentFailed,
  agentStarted,
  completed,
  devReviewed,
  humanApproval,
  humanRequestChanges,
  implemented,
  planned,
  planReviewed,
  retry,
} from "../app/actions.ts";
import { bootstrap } from "../global/actions.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * **状態の正を書く middleware。** 記録する action を `events/` に 1 ファイル追記する。
 *
 * 追記するのは「起きた事実」だけで、環境の注入（`CONFIGURE`）や再生（`meta.hydrate`）は
 * 対象外。**人間の介入（承認・差し戻し・retry）も同じログに載る**ので、`log.md` の
 * 読み物も completion への入力もここから作れる（A-34）。
 *
 * 順序の理由: この middleware は `snapshot` より内側に置く。イベントが先に落ちれば
 * スナップショットが古いだけで次の畳み込みが直すが、逆順だと**正であるイベントが
 * 失われる**（`middlewares/index.ts`）。
 */
const APPENDABLE: Record<string, true> = {
  [bootstrap.type]: true,
  [agentStarted.type]: true,
  [planned.type]: true,
  [planReviewed.type]: true,
  [implemented.type]: true,
  [devReviewed.type]: true,
  [completed.type]: true,
  [agentFailed.type]: true,
  [humanApproval.type]: true,
  [humanRequestChanges.type]: true,
  [retry.type]: true,
};

export const eventLog: AgentMiddleware =
  ({ outputs }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    const { type } = action as { type: string };
    if (!APPENDABLE[type]) return next(action);

    const { info } = store.getState();
    const result = next(action);
    outputs.event_path = appendEvent(info.dir, action as never, {
      run_id: info.run_id,
      attempt: info.attempt,
    });
    return result;
  };

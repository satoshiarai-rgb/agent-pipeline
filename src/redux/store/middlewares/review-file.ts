import { saveReview } from "../../../file/review-file.ts";
import { humanRequestChanges } from "../app/actions.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * 人間の差し戻し（`/agent request-changes <理由>`）の本文を、人間のレビューとして
 * `reviews/<kind>-NN.md` に残す。**ここを通らずに phase を戻すと、planner は
 * 何を直すべきか分からないまま再走する**（設計書 §3.2）。
 *
 * レビュー種別は**遷移前の phase** から引くので、`next` の前に書く。
 */
export const reviewFile: AgentMiddleware =
  ({ outputs }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    const a = action as { type: string; payload?: { by?: string; body?: string } };
    if (!humanRequestChanges.match(action as never)) return next(action);

    const { info, app } = store.getState();
    // 人間が差し戻せるのは計画の承認待ちだけなので、通常は計画側になる
    let kind: "plan" | "dev" = "plan";
    if (app.phase === "dev_review") kind = "dev";
    outputs.review_path = saveReview({
      dir: info.dir,
      kind,
      verdict: "request_changes",
      reviewer: a.payload?.by ?? "human",
      body: a.payload?.body ?? "",
    });
    return next(action);
  };

import { writeStateFile } from "../../../file/state-file.ts";
import type { RootState } from "../createStore.ts";
import { selectSnapshot } from "../selectors.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * `state.json` を書き出す。**中身は状態の射影**（人が読む確認用のスナップショット）で、
 * 状態を変えた action の後にだけ書く。
 *
 * 再生中は書かない（再生は既にファイルにある過去を読み直しているだけ）。
 * 実行状況（`app`）が変わらなかった action でも書かない — 読み取り専用のコマンド
 * （route / label / explain）が状態を書かないことを、条件ではなく構造で保つため。
 */
export const snapshot: AgentMiddleware =
  ({ config }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    const before: RootState = store.getState();
    const result = next(action);
    const after: RootState = store.getState();
    if (after.app !== before.app) {
      writeStateFile(after.info.dir, selectSnapshot(after, config), new Date());
    }
    return result;
  };

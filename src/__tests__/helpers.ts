import { type Config, defaults } from "../defaults.ts";
import type { AppState } from "../redux/store/app/reducer.ts";
import { initialApp } from "../redux/store/app/reducer.ts";
import type { RootState } from "../redux/store/createStore.ts";
import type { InfoState } from "../redux/store/info/reducer.ts";
import { initialInfo } from "../redux/store/info/reducer.ts";

/**
 * テスト用の設定。毎回複製して返す。
 * defaults をそのまま返すと、遷移表を壊すテストの変更が他のテストに漏れる。
 */
export const config = (): Config => structuredClone(defaults);

/**
 * selector とガードを直接試すための root state。
 * ファイルを作らずに状態を組み立てられるので、判断だけを速く検証できる。
 */
export const rootOf = (app: Partial<AppState> = {}, info: Partial<InfoState> = {}): RootState => ({
  info: {
    ...initialInfo,
    issue: 123,
    branch: "claude/issue-123",
    pipeline_version: defaults.pipeline_version,
    dir: "agent-work/issue-123",
    ...info,
  },
  app: { ...initialApp, ...app },
});

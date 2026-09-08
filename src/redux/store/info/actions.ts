import actionCreatorFactory from "../../../utils/typescript-fsa.ts";

/**
 * この起動の環境を動かす action。**永続化しない。**
 *
 * **`issue` / `branch` / `pipeline_version` はここに無い。** それらは環境ではなく
 * run 自身の記録なので、`RESTORE`（いまはスナップショット、段取り 2 以降は
 * bootstrap イベント）が入れる。環境から注入すると、`--dir` の取り違えで
 * 別の run の識別子が入り込み、版の握手（`pipeline_version`）も意味を失う。
 */
export interface ConfigurePayload {
  /** run のディレクトリ（`agent-work/issue-<n>`）。ファイルを読み書きする起点 */
  dir: string;
  /** この GitHub Actions の実行。イベントの payload に載る */
  run_id: string | null;
  attempt: number;
}

export type InfoPayload = ConfigurePayload;

const create = actionCreatorFactory("agent-pipeline/info");

/** 起動時に環境を注入する */
export const configure = create<ConfigurePayload>("CONFIGURE");

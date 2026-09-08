import type { Dispatch } from "redux";
import actionCreatorFactory, { type Action } from "../../../utils/typescriptFsa.ts";
import type { AppPayload } from "../app/actions.ts";
import type { AppState } from "../app/reducer.ts";
import type { InfoPayload } from "../info/actions.ts";
import type { InfoState } from "../info/reducer.ts";

/**
 * スライスを跨ぐ起動の骨組み。どちらも **`meta: { hydrate: true }` を持つ**ので、
 * 書き込み系の middleware は素通しする（各 middleware が自分で見て分岐する）。
 *
 * `INIT` は **middleware だけが見る action**。`hydrate` middleware が捕まえてファイルを
 * 読み、状態を復元する（reducer には届かない）。**これが最初の処理。**
 *
 * `RESTORE` は既存のファイル（`state.json` と `runs/*.json`）から状態を戻す。
 * **段取り 2（イベントログの追記専用化）で消える暫定の action** — そこでは過去の
 * イベントを 1 件ずつ `meta.hydrate` 付きで再生するので、復元専用の action が要らなくなる。
 *
 * ducks の名前空間は 1 つの reducer に属さないため `agent-pipeline/<TYPE>` にしている。
 */
const create = actionCreatorFactory("agent-pipeline");

export const init = create<undefined>("INIT", { hydrate: true });
export const restore = create<RestorePayload>("RESTORE", { hydrate: true });

/** `RESTORE` の payload（既存のファイルから戻す値）。段取り 2 で消える */
export interface RestorePayload {
  info: Pick<InfoState, "issue" | "branch" | "pipeline_version">;
  app: Pick<
    AppState,
    | "phase"
    | "failure_reason"
    | "total_steps"
    | "plan_review_rounds"
    | "dev_review_rounds"
    | "in_flight_agent"
    | "in_flight_run_id"
  >;
}

/**
 * store が受け取る action の全体。FSA は「最上位のキーは type / payload / error / meta
 * だけ」なので Redux 5 の `UnknownAction`（任意のキーを許す索引シグネチャ付き）には
 * 当てはまらない。dispatch の型をこの union で固定して FSA の形を保つ。
 */
export type PipelineAction = Action<AppPayload | InfoPayload | RestorePayload>;
export type PipelineDispatch = Dispatch<PipelineAction>;

import type { Dispatch } from "redux";
import actionCreatorFactory, { type Action } from "../../../utils/typescriptFsa.ts";
import type { AppPayload, Origin } from "../app/actions.ts";
import type { InfoPayload } from "../info/actions.ts";

/**
 * 起動の骨組み。`INIT` は **middleware だけが見る action** で、`hydrate` middleware が
 * 捕まえて `events/*.json` を 1 件ずつ再生する（reducer には届かない）。**これが最初の処理。**
 *
 * `meta: { hydrate: true }` を持つので、書き込み系の middleware は素通しする
 * （各 middleware が自分で見て分岐する）。再生されるイベントにも同じ meta が付く。
 *
 * ducks の名前空間は 1 つの reducer に属さないため `agent-pipeline/<TYPE>` にしている。
 */
const create = actionCreatorFactory("agent-pipeline");

export const init = create<undefined>("INIT", { hydrate: true });

/**
 * run の最初のイベント（`agent-bootstrap.yml` が 1 度だけ書く）。**識別子はここで確定し、
 * 以後変わらない。** 環境の注入（`CONFIGURE`）と違って永続化する — 畳み込みで
 * 復元できる必要があるため。
 *
 * **両方のスライスが反応する**: `info` は識別子を、`app` は phase を `planning` にする。
 */
export interface BootstrapPayload extends Origin {
  issue: number;
  branch: string;
  pipeline_version: number;
}

export const bootstrap = create<BootstrapPayload>("BOOTSTRAP");

/** 再生であることを示す meta。書き込み系の middleware とガードはこれを見て素通しする */
export const REPLAY = { hydrate: true } as const;

/**
 * store が受け取る action の全体。FSA は「最上位のキーは type / payload / error / meta
 * だけ」なので Redux 5 の `UnknownAction`（任意のキーを許す索引シグネチャ付き）には
 * 当てはまらない。dispatch の型をこの union で固定して FSA の形を保つ。
 */
export type PipelineAction = Action<AppPayload | InfoPayload | BootstrapPayload>;
export type PipelineDispatch = Dispatch<PipelineAction>;

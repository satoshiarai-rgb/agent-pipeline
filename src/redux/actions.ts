import type { Dispatch } from "redux";
import actionCreatorFactory, { type Action } from "../utils/typescript-fsa.ts";
import type { AppPayload } from "./app/actions.ts";
import type { InfoPayload } from "./info/actions.ts";
import type { RestorePayload } from "./state.ts";

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

/** store が受け取る action の全体。FSA の形を保つため dispatch の型をこれで固定する */
export type PipelineAction = Action<AppPayload | InfoPayload | RestorePayload>;
export type PipelineDispatch = Dispatch<PipelineAction>;

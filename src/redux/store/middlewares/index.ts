import { guard } from "./guard.ts";
import { hydrate } from "./hydrate.ts";
import { reviewFile } from "./review-file.ts";
import { runRecord } from "./run-record.ts";
import { snapshot } from "./snapshot.ts";
import type { AgentMiddleware } from "./types.ts";

/**
 * 並びには意味がある。**`next` より後のコードは内側から外側へ逆順に走る**ので、
 * この配列が「ファイルへの書き込みの順序」を決める。
 *
 *   guard      受け付けない action をここで止める（`next` を呼ばない）
 *   snapshot   ← 最後に書く。落ちても次の畳み込みが直すので害がない
 *   reviewFile 人間の差し戻し本文（遷移前の phase が要るので next の前に書く）
 *   runRecord  ← 先に書く。実行の記録が正なので、失われてはいけない
 *   hydrate    init を捕まえて状態を復元する（一番内側）
 *
 * 逆順にすると、スナップショットだけが進んで正の記録が失われる経路ができる。
 */
export const middlewares: AgentMiddleware[] = [guard, snapshot, reviewFile, runRecord, hydrate];
export { guard, hydrate, reviewFile, runRecord, snapshot };

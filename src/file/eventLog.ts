import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "../utils/parseJson.ts";
import { stringifyJson } from "../utils/stringifyJson.ts";
import type { Action } from "../utils/typescriptFsa.ts";

/**
 * `events/<連番>-<timestamp>-<run_id>-<attempt>-<type>.json` の形式。
 * **状態の正はこのログ**で、`state.json` はその畳み込みのスナップショットにすぎない（K-26）。
 * base-action が書くセッションの記録（`executionLog.ts` の `execution_file`）とは別物。
 *
 * 名前の決め方には 3 つの理由がある。
 *
 *   - **先頭の連番（追記時点のイベント数）が畳み込みの順序を決める。** 時計の分解能や
 *     `run_id` の桁数に依存しない（`9999999999` と `17301992044` を文字列で並べると
 *     桁数の少ない方が後になる。決定記録が同じ問題を踏んだ / K-25）
 *   - **時刻は人間のため。** ISO 基本形式（`20260908T054512Z`）でコロンを含めない
 *     （コロンを含むファイル名は Windows でチェックアウトできない）
 *   - **`run_id` と `attempt` を挟むので、同じ連番でも別ファイルになる。** 並行 push で
 *     2 つの起動が同じ連番を計算しても、名前が衝突せず両方が残る（B-1 の実測）。
 *     1 本の jsonl だと追記が同じ行域に集まり、競合するか静かに順序が入れ替わる
 *
 * 書くのは `type` / `payload` / `error` だけ。`meta` は「その dispatch の文脈」
 * （再生中かどうか）で、記録される事実ではないので落とす。
 */

/** イベントの置き場 */
export const eventsDir = (dir: string): string => join(dir, "events");

/** この起動（GitHub Actions のラン）。名前を一意にするために使う */
export interface Invocation {
  run_id: string | null;
  attempt: number;
}

/** `agent-pipeline/app/PLAN_REVIEWED` → `plan_reviewed` */
function suffixOf(type: string): string {
  const last = type.split("/").at(-1) ?? type;
  return last.toLowerCase();
}

export function eventFileName(
  action: Action<unknown>,
  invocation: Invocation,
  sequence: number,
): string {
  const timestamp = (action.payload as { timestamp?: string } | undefined)?.timestamp;
  if (!timestamp) throw new Error(`イベントに timestamp がありません: ${action.type}`);
  const seq = String(sequence).padStart(4, "0");
  return `${seq}-${timestamp}-${invocation.run_id ?? "0"}-${invocation.attempt}-${suffixOf(action.type)}.json`;
}

/** イベントを 1 ファイル追記する。書いたパスを返す */
export function appendEvent(dir: string, action: Action<unknown>, invocation: Invocation): string {
  const path = join(eventsDir(dir), eventFileName(action, invocation, eventPaths(dir).length + 1));
  mkdirSync(eventsDir(dir), { recursive: true });
  const event: Record<string, unknown> = { type: action.type, payload: action.payload };
  if (action.error) event.error = true;
  writeFileSync(path, stringifyJson(event));
  return path;
}

/** イベントのパスを名前順（= 起きた順）に返す。ディレクトリが無ければ空 */
export function eventPaths(dir: string): string[] {
  const base = eventsDir(dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(base, name));
}

/** イベントを起きた順に読む。**そのまま action として reducer に流せる形** */
export function readEvents(dir: string): Action<unknown>[] {
  return eventPaths(dir).map((path) => {
    const event = parseJson<Partial<Action<unknown>>>(readFileSync(path, "utf8"), "イベント");
    if (typeof event?.type !== "string") throw new Error(`イベントに type がありません: ${path}`);
    return { type: event.type, payload: event.payload, error: event.error } as Action<unknown>;
  });
}

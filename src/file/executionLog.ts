import { existsSync, readFileSync } from "node:fs";
import { parseJson } from "../utils/parseJson.ts";

/**
 * base-action が書く実行ログ（execution_file）。**Claude Code のセッションの記録**で、
 * 書くのは base-action、ハーネスは読むだけ。
 *
 * **`events/**` の状態イベント（`eventLog.ts`）とは別物** — あちらは状態の正で
 * ハーネスが書き、こちらは 1 回の実行がどう終わったかを分類するためだけに読む。
 *
 * 中身はイベントの配列で、結末は最後の `type: "result"` イベントが持つ。
 * ハーネスが見るのは失敗の分類に必要な数フィールドだけ（A-31）。
 */
export interface ResultEvent {
  type?: string;
  /** success | error_max_turns など。正常終了の判定に使う */
  subtype?: string;
  /** completed | api_error など */
  terminal_reason?: string;
  /** API エラーのときの HTTP ステータス */
  api_error_status?: number;
  is_error?: boolean;
  session_id?: string;
}

/** 最後の result イベント。無ければ null */
export function readResultEvent(path: string): ResultEvent | null {
  if (!existsSync(path)) return null;
  const parsed = parseJson<unknown>(readFileSync(path, "utf8"), "execution_file");
  const events = Array.isArray(parsed) ? parsed : [parsed];
  const results = events.filter((e) => (e as ResultEvent)?.type === "result");
  return (results.at(-1) as ResultEvent) ?? null;
}

/**
 * エージェント自身が正常に終わったか。実行ログの最後の result イベントが
 * `subtype: "success"` かつ `is_error` でないことを見る。
 *
 * base-action は step の exit code で「エージェントが死んだ」と
 * 「正常終了したが num_turns が max_turns を超えた」を区別しない。後者は
 * **成果物が完成している**ので、step の失敗だけを見て捨てると作業を失う
 * （実測 2 件: developer 43/40 で $4.05、plan-reviewer 27/25 で $1.42。
 * どちらも成果物は書き終わっていた）。判定はここに閉じ、成果物の可否は契約に委ねる。
 */
export function completedCleanly(path?: string | null): boolean {
  if (!path) return false;
  const result = readResultEvent(path);
  if (!result) return false;
  return result.subtype === "success" && result.is_error !== true;
}

/**
 * API エラーの HTTP ステータス。API エラーでなければ null。
 * ステータスが取れないときは 0 を返す（「API エラーだが番号不明」を表す）。
 *
 * 実測（V-15）: モデル名の誤りは terminal_reason: "api_error" と
 * api_error_status: 404 として出る。使用量上限も同じ形（429）で出る見込み。
 */
export function readApiErrorStatus(path?: string | null): number | null {
  if (!path) return null;
  const result = readResultEvent(path);
  if (!result) return null;
  const isApiError = result.terminal_reason === "api_error" || Boolean(result.api_error_status);
  return isApiError ? (result.api_error_status ?? 0) : null;
}

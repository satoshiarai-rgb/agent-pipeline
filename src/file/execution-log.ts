import { existsSync, readFileSync } from "node:fs";
import { parseJson } from "../utils/parse-json.ts";

/**
 * base-action が書く実行ログ（execution_file）。
 * イベントの配列で、結末は最後の `type: "result"` イベントが持つ。
 * ハーネスが見るのは失敗の分類に必要な数フィールドだけ（A-31）。
 */
export interface ResultEvent {
  type?: string;
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

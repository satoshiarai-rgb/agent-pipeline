import type { AgentName, Phase, RunResult, Verdict } from "./types.ts";
import { parseJson } from "./utils/parse-json.ts";
import { pick } from "./utils/pick.ts";
import { stringifyJson } from "./utils/stringify-json.ts";

/**
 * runs/<agent>-<run_id>-<attempt>.json の内容。1 実行 1 ファイルの追記専用（A-33）。
 * ファイル名が衝突しないため、並行更新でも rebase が取りこぼさない。
 */
export interface RunRecord {
  agent: AgentName;
  phase: Phase;
  run_id: string;
  attempt: number;
  started_at: string;
  /** null なら実行中。stale 検知の対象（A-14） */
  finished_at: string | null;
  result: RunResult | null;
  verdict: Verdict | null;
  /** 設定ミスとエージェントの失敗を区別するために残す（A-31） */
  api_error_status: number | null;
  model: string | null;
  session_id: string | null;
}

/**
 * 実行レコードを読む。ハーネス自身が書くファイルなので存在確認だけする。
 * spread を使わず明示的に組み立てるので、宣言外のフィールドは落ちる
 * （読んだ内容をそのまま書き戻して未知の値が残り続けるのを避ける）。
 */
export function parseRecord(text: string): RunRecord {
  const r = parseJson<Partial<RunRecord>>(text, "実行レコード");
  if (!r?.agent || !r.run_id) throw new Error("実行レコードに agent か run_id がありません");
  return {
    agent: r.agent,
    phase: r.phase as Phase,
    run_id: String(r.run_id),
    attempt: Number(r.attempt ?? 1),
    started_at: r.started_at ?? "",
    finished_at: r.finished_at ?? null,
    result: r.result ?? null,
    verdict: r.verdict ?? null,
    api_error_status: r.api_error_status ?? null,
    model: r.model ?? null,
    session_id: r.session_id ?? null,
  };
}

/**
 * ファイルに書くときのキー順。
 * 書き忘れると renderRecord の型注釈で tsc が落ちる（フィールドが欠けた型になるため）。
 */
const RECORD_KEYS = [
  "agent",
  "phase",
  "run_id",
  "attempt",
  "started_at",
  "finished_at",
  "result",
  "verdict",
  "api_error_status",
  "model",
  "session_id",
] as const satisfies readonly (keyof RunRecord)[];

/** 実行レコードを書く。キー順を固定して差分を安定させる */
export function renderRecord(r: RunRecord): string {
  // 注釈が網羅チェックを兼ねる: RECORD_KEYS に書き忘れたキーがあると代入できない
  const ordered: RunRecord = pick(r, RECORD_KEYS);
  return stringifyJson(ordered);
}

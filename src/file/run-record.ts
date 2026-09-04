import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentName, Phase, RunResult, Verdict } from "../types.ts";
import { parseJson } from "../utils/parse-json.ts";
import { pick } from "../utils/pick.ts";
import { stringifyJson } from "../utils/stringify-json.ts";

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
 * 部分的な値から RunRecord を組み立てる。読み込み・作成・結末の書き込みで共通に使う。
 * フィールドを 1 つずつ写すので、宣言外のフィールドは落ち（未知の値が書き戻され続けない）、
 * 欠けているフィールドには既定値が入る。
 */
function normalizeRecord(r: Partial<RunRecord>): RunRecord {
  return {
    agent: r.agent as AgentName,
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

/** 実行レコードを読む。ハーネス自身が書くファイルなので存在確認だけする */
function parseRecord(text: string): RunRecord {
  const r = parseJson<Partial<RunRecord>>(text, "実行レコード");
  if (!r?.agent || !r.run_id) throw new Error("実行レコードに agent か run_id がありません");
  return normalizeRecord(r);
}

/** 実行開始時のレコードを作る。結末に関わるフィールドは未定（null）で始まる */
export function openRecord(input: {
  agent: AgentName;
  phase: Phase;
  run_id: string;
  attempt: number;
  model: string;
  started_at: string;
}): RunRecord {
  return normalizeRecord(input);
}

/**
 * 実行の結末を書き込んだレコードを作る。
 * session_id は指定が無ければ元の値を残す（base-action が返さない場合がある）。
 */
export function closeRecord(
  current: RunRecord,
  patch: {
    finished_at: string;
    result: RunResult;
    verdict?: Verdict | null;
    api_error_status?: number | null;
    session_id?: string | null;
  },
): RunRecord {
  return normalizeRecord({
    ...current,
    finished_at: patch.finished_at,
    result: patch.result,
    verdict: patch.verdict ?? null,
    api_error_status: patch.api_error_status ?? null,
    session_id: patch.session_id ?? current.session_id,
  });
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
function renderRecord(r: RunRecord): string {
  // 注釈が網羅チェックを兼ねる: RECORD_KEYS に書き忘れたキーがあると代入できない
  const ordered: RunRecord = pick(r, RECORD_KEYS);
  return stringifyJson(ordered);
}

/** 実行レコードのファイル名。ラン ID と試行回数を含むので並行実行でも衝突しない */
export function recordFileName(r: { agent: string; run_id: string; attempt: number }): string {
  return `${r.agent}-${r.run_id}-${r.attempt}.json`;
}

/** 実行レコードのパス */
export function recordPath(dir: string, r: Parameters<typeof recordFileName>[0]): string {
  return join(dir, "runs", recordFileName(r));
}

/** runs/ のレコードを名前順に読む。ディレクトリが無ければ空 */
export function readRecords(dir: string): RunRecord[] {
  const runs = join(dir, "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => parseRecord(readFileSync(join(runs, n), "utf8")));
}

/** 実行レコードを書き、そのパスを返す */
export function saveRecord(dir: string, record: RunRecord): string {
  const path = recordPath(dir, record);
  mkdirSync(join(dir, "runs"), { recursive: true });
  writeFileSync(path, renderRecord(record));
  return path;
}

/** パスからレコードを引く（ファイル名で照合する） */
export function findRecord(records: RunRecord[], path: string): RunRecord | undefined {
  return records.find((r) => path.endsWith(recordFileName(r)));
}

import type { AgentName, Phase, RunResult, Verdict } from "../types.ts";
import { parseYaml } from "./parse-yaml.ts";

/**
 * runs/<agent>-<run_id>-<attempt>.yml の内容。1 実行 1 ファイルの追記専用（A-33）。
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
  model?: string | null;
  session_id?: string | null;
}

/** 実行レコードを読む。ハーネス自身が書くファイルなので存在確認だけする */
export function parseRecord(text: string): RunRecord {
  const r = parseYaml<RunRecord>(text);
  if (!r?.agent || !r.run_id) throw new Error("実行レコードに agent か run_id がありません");
  return { ...r, finished_at: r.finished_at ?? null };
}

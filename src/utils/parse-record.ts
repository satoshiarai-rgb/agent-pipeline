import type { RunRecord } from "../types.ts";
import { parseYaml } from "./parse-yaml.ts";

/** 実行レコードを読む。ハーネス自身が書くファイルなので存在確認だけする */
export function parseRecord(text: string): RunRecord {
  const r = parseYaml<RunRecord>(text);
  if (!r?.agent || !r.run_id) throw new Error("実行レコードに agent か run_id がありません");
  return { ...r, finished_at: r.finished_at ?? null };
}

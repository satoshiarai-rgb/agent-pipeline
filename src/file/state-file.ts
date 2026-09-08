import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "../types.ts";
import { parseJson } from "../utils/parse-json.ts";
import { pick } from "../utils/pick.ts";
import { stringifyJson } from "../utils/stringify-json.ts";

/** state.json のうち、遷移判断に使わない識別子とメタ情報 */
interface RunMeta {
  pipeline_version: number;
  issue: number;
  branch: string;
}

export interface StateFile {
  meta: RunMeta;
  phase: Phase;
  blocked_reason: string | null;
}

function parseStateFile(text: string): StateFile {
  const raw = parseJson<Partial<RunMeta & { phase: Phase; blocked_reason: string | null }>>(
    text,
    "state.json",
  );
  if (typeof raw.phase !== "string" || typeof raw.issue !== "number") {
    throw new Error("state.json に issue か phase がありません");
  }
  return {
    meta: {
      pipeline_version: Number(raw.pipeline_version ?? 0),
      issue: raw.issue,
      branch: typeof raw.branch === "string" ? raw.branch : "",
    },
    phase: raw.phase,
    blocked_reason: typeof raw.blocked_reason === "string" ? raw.blocked_reason : null,
  };
}

/** ファイルに書くときのキー順。書き忘れると renderStateFile の型注釈で tsc が落ちる */
const STATE_KEYS = [
  "pipeline_version",
  "issue",
  "branch",
  "phase",
  "blocked_reason",
  "updated_at",
] as const satisfies readonly (keyof StateFileShape)[];

/** 書き出す内容。`updated_at` は書くときに入れる（読み戻して使う値ではない） */
export type Snapshot = RunMeta & { phase: Phase; blocked_reason: string | null };

/** state.json の平坦な形（書くときの形） */
type StateFileShape = Snapshot & { updated_at: string };

/**
 * state.json を組み立てる。キー順を固定して差分を安定させる。
 * 可変値は phase と blocked_reason だけ（rounds と total_steps は導出する / A-33）。
 */
function renderStateFile(snapshot: Snapshot, now: Date): string {
  const shape: StateFileShape = {
    ...snapshot,
    updated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  // 注釈が網羅チェックを兼ねる: STATE_KEYS に書き忘れたキーがあると代入できない
  const ordered: StateFileShape = pick(shape, STATE_KEYS);
  return stringifyJson(ordered);
}

/** state.json のパス */
export function stateFilePath(dir: string): string {
  return join(dir, "state.json");
}

/** state.json を読む */
export function readStateFile(dir: string): StateFile {
  return parseStateFile(readFileSync(stateFilePath(dir), "utf8"));
}

/**
 * state.json を書く。**中身は状態の射影**（`selectSnapshot`）で、書くのは
 * `snapshot` middleware だけ。書き換わるのは phase / blocked_reason / updated_at。
 */
export function writeStateFile(dir: string, snapshot: Snapshot, now: Date): void {
  writeFileSync(stateFilePath(dir), renderStateFile(snapshot, now));
}

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../defaults.ts";
import type { Phase } from "../types.ts";
import { parseJson } from "../utils/parse-json.ts";
import { pick } from "../utils/pick.ts";
import { stringifyJson } from "../utils/stringify-json.ts";

/** state.json のうち、遷移判断に使わない識別子とメタ情報 */
interface RunMeta {
  pipeline_version: number;
  issue: number;
  branch: string;
  updated_at: string | null;
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
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
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

/** state.json の平坦な形（読むときは meta と phase に分けるが、書くときはこの形） */
type StateFileShape = RunMeta & { phase: Phase; blocked_reason: string | null };

/**
 * state.json を組み立てる。キー順を固定して差分を安定させる。
 * 可変値は phase と blocked_reason だけ（rounds と total_steps は導出する / A-33）。
 */
function renderStateFile(
  file: StateFile,
  patch: { phase: Phase; blocked_reason: string | null; now: Date },
): string {
  const shape: StateFileShape = {
    ...file.meta,
    phase: patch.phase,
    blocked_reason: patch.blocked_reason,
    updated_at: patch.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  // 注釈が網羅チェックを兼ねる: STATE_KEYS に書き忘れたキーがあると代入できない
  const ordered: StateFileShape = pick(shape, STATE_KEYS);
  return stringifyJson(ordered);
}

/**
 * 中央の破壊的変更が進行中の run を壊さないための前提チェック。
 * 遷移の規則ではないためこの層に置く。不一致なら理由を返す。
 */
export function checkPipelineVersion(meta: RunMeta, config: Config): string | null {
  return meta.pipeline_version === config.pipeline_version
    ? null
    : `pipeline_version_mismatch: run=${meta.pipeline_version} harness=${config.pipeline_version}`;
}

/** state.json のパス */
export function stateFilePath(dir: string): string {
  return join(dir, "state.json");
}

/** state.json を読む */
export function readStateFile(dir: string): StateFile {
  return parseStateFile(readFileSync(stateFilePath(dir), "utf8"));
}

/** state.json を書く。書き換わるのは phase / blocked_reason / updated_at だけ */
export function writeStateFile(
  dir: string,
  file: StateFile,
  patch: { phase: Phase; blocked_reason: string | null },
  now: Date,
): void {
  writeFileSync(stateFilePath(dir), renderStateFile(file, { ...patch, now }));
}

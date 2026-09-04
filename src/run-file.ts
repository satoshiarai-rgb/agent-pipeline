import type { Document } from "yaml";
import type { Config, Phase } from "./types.ts";
import { parseYamlDocument } from "./utils/parse-yaml-document.ts";
import { setYamlFields } from "./utils/set-yaml-fields.ts";

/** state.yml のうち、遷移判断に使わない識別子とメタ情報 */
export interface RunMeta {
  pipeline_version: number;
  issue: number;
  branch: string;
  updated_at: string | null;
}

export interface RunFile {
  /** コメントとキー順を保持して書き戻すための Document */
  doc: Document;
  meta: RunMeta;
  phase: Phase;
  blocked_reason: string | null;
}

export function parseRunFile(text: string): RunFile {
  const doc = parseYamlDocument(text);
  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw.phase !== "string" || typeof raw.issue !== "number") {
    throw new Error("state.yml に issue か phase がありません");
  }
  return {
    doc,
    meta: {
      pipeline_version: Number(raw.pipeline_version ?? 0),
      issue: raw.issue,
      branch: typeof raw.branch === "string" ? raw.branch : "",
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    },
    phase: raw.phase as Phase,
    blocked_reason: typeof raw.blocked_reason === "string" ? raw.blocked_reason : null,
  };
}

/** phase / blocked_reason / updated_at だけを書き換える */
export function applyRunFile(
  doc: Document,
  patch: { phase: Phase; blocked_reason: string | null; now: Date },
): string {
  return setYamlFields(doc, {
    phase: patch.phase,
    blocked_reason: patch.blocked_reason,
    updated_at: patch.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
}

/**
 * 中央の破壊的変更が進行中の run を壊さないための前提チェック。
 * 遷移の規則ではないため state.ts ではなくこの層に置く。不一致なら理由を返す。
 */
export function checkPipelineVersion(meta: RunMeta, config: Config): string | null {
  return meta.pipeline_version === config.pipeline_version
    ? null
    : `pipeline_version_mismatch: run=${meta.pipeline_version} harness=${config.pipeline_version}`;
}

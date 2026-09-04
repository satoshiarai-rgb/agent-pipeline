import { readStateFile } from "../file/state-file.ts";
import type { Phase } from "../types.ts";
import { PHASES } from "../types.ts";
import type { CommandInput } from "./input.ts";

/**
 * phase をラベル名に射影する。`plan_review` → `agent:plan-review`。
 * 状態の正は state.json で、ラベルはその写し（設計書 §2.3）。
 */
export function labelFor(phase: Phase, prefix: string): string {
  return `${prefix}${phase.replace(/_/g, "-")}`;
}

/** パイプラインが管理するラベルの全体（射影先 + 起動用） */
export function allLabels(prefix: string, trigger: string): string[] {
  return [...PHASES.map((p) => labelFor(p, prefix)), trigger];
}

/**
 * いま issue に付いているべきラベルを返す（dispatch / bootstrap / comment から呼ぶ）。
 * どのラベルを外すかは、issue の現在のラベルから prefix で絞ってワークフロー側が決める。
 */
export function labelRun(input: CommandInput): {
  label: string;
  issue: number;
  phase: Phase;
  prefix: string;
  trigger: string;
} {
  const file = readStateFile(input.dir);
  const { prefix, trigger } = input.config.labels;
  return {
    label: labelFor(file.phase, prefix),
    issue: file.meta.issue,
    phase: file.phase,
    prefix,
    trigger,
  };
}

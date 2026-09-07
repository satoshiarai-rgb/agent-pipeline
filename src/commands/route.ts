import { readRecords } from "../file/run-record.ts";
import { checkPipelineVersion, readStateFile } from "../file/state-file.ts";
import { type RouteResult, route } from "../transitions.ts";
import type { CommandInput } from "./input.ts";

/**
 * 次に何をするかを決める（dispatch.yml の route ジョブ）。
 * 版と設定の整合性は遷移の規則ではないため、遷移判断の前にここで見る。
 *
 * どちらも `blocked` として返すのがこの層の役目である。ここで例外を投げると
 * 状態が git に載らないまま job が落ち、run が無音で止まる（設計書 §7.1）。
 */
export function routeRun(input: CommandInput): RouteResult {
  const file = readStateFile(input.dir);
  const records = readRecords(input.dir);
  const blocked = (reason: string): RouteResult => ({
    action: "block",
    reason,
    phase: file.phase,
    total_steps: records.length,
    rounds: { plan_review: 0, dev_review: 0 },
  });

  if (input.config_error) return blocked(`config_invalid: ${input.config_error}`);
  const mismatch = checkPipelineVersion(file.meta, input.config);
  if (mismatch) return blocked(mismatch);
  return route({ phase: file.phase, records, config: input.config });
}

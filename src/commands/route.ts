import { readRecords } from "../file/run-record.ts";
import { checkPipelineVersion, readStateFile } from "../file/state-file.ts";
import { type RouteResult, route } from "../transitions.ts";
import type { CommandInput } from "./input.ts";

/**
 * 次に何をするかを決める（dispatch.yml の route ジョブ）。
 * 版の整合性は遷移の規則ではないため、遷移判断の前にここで見る。
 */
export function routeRun(input: CommandInput): RouteResult {
  const file = readStateFile(input.dir);
  const records = readRecords(input.dir);
  const mismatch = checkPipelineVersion(file.meta, input.config);
  if (mismatch) {
    return {
      action: "block",
      reason: mismatch,
      phase: file.phase,
      total_steps: records.length,
      rounds: { plan_review: 0, dev_review: 0 },
    };
  }
  return route({ phase: file.phase, records, config: input.config });
}

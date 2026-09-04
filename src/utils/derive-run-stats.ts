import type { RunRecord } from "../file/run-record.ts";
import type { RoundKey } from "../types.ts";

/**
 * 実行レコードから状態を導出する（A-33）。
 * カウントを state.json に保存しないため、並行更新で取りこぼす値が存在しない。
 */
export function deriveRunStats(records: RunRecord[]) {
  return {
    /** 自走ループの最終防波堤 */
    total_steps: records.length,
    /** 該当レビュアーのレコード数。失敗した実行も 1 ラウンドとして数える */
    rounds: {
      plan_review: records.filter((r) => r.agent === "plan-reviewer").length,
      dev_review: records.filter((r) => r.agent === "dev-reviewer").length,
    } satisfies Record<RoundKey, number>,
    /** finished_at が null のレコードがあれば実行中とみなす */
    in_flight: records.find((r) => r.finished_at === null) ?? null,
  };
}

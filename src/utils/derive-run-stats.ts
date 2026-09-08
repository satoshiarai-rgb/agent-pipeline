import type { RunRecord } from "../file/run-record.ts";

/**
 * 実行レコードから状態を導出する（A-33）。
 * カウントを state.json に保存しないため、並行更新で取りこぼす値が存在しない。
 * **レビューの往復はここでは数えない** — 数える規則（判定が付いた実行だけ）は
 * `hydrate` middleware と reducer が持つ（規則を 2 箇所に置かないため）。
 */
export function deriveRunStats(records: RunRecord[]) {
  return {
    /** 自走ループの最終防波堤 */
    total_steps: records.length,
    /** finished_at が null のレコードがあれば実行中とみなす */
    in_flight: records.find((r) => r.finished_at === null) ?? null,
  };
}

import { latestRecord, readRecords } from "../file/run-record.ts";
import { readStateFile, writeStateFile } from "../file/state-file.ts";
import type { AgentName, Phase } from "../types.ts";
import { authorized } from "./human-transition.ts";
import type { CommandInput } from "./input.ts";

export type RetryResult =
  | { ok: true; phase: Phase; agent: AgentName }
  | { ok: false; reason: string };

/**
 * 人間の `/agent retry` による復旧（K-23）。
 *
 * **戻る先は遷移表ではなく履歴が決める。** `runs/*.json` の直前のレコードが
 * 「どのフェーズが走っていたか」を持っているので、その phase に戻して再実行させる。
 * これは blocked からの復旧で人間が手で `state.json` を書き換えていた操作
 * （設計書 §7.1 の唯一の手作業）を、そのままコマンドにしたもの。
 *
 * 受け付けないもの:
 *   - blocked 以外の phase（取り違えを黙って進めない）
 *   - 上限で止まったもの。やり直しても同じ理由で止まるので、新しい issue を立てるか
 *     上限を上げる方が正しい
 *   - 実行の記録が無いもの（戻る先が決まらない）
 *   - 直前のレコードが閉じていないもの。`route` は `finished_at` が null のレコードを
 *     「実行中」と見て何もしないため、phase を戻しても**静かに何も起きない**。
 *     ここで断らないと「retry したのに動かない」になる（stale 検知の仕事 / A-14）
 *
 * route が止めた blocked（`pipeline_version_mismatch`）だけは、走る前のフェーズが
 * state から失われているため直前の完了フェーズに戻る。この 1 ケースは手で直す。
 */
export function retryRun(input: CommandInput & { association: string }): RetryResult {
  const { dir, association, config, now = new Date() } = input;
  if (!authorized(association, config)) {
    return { ok: false, reason: `not_authorized: ${association}` };
  }

  const file = readStateFile(dir);
  if (file.phase !== "blocked") return { ok: false, reason: `not_blocked: phase=${file.phase}` };
  if (file.blocked_reason?.includes("_exceeded")) {
    return { ok: false, reason: `limit_reached: ${file.blocked_reason}` };
  }

  const last = latestRecord(readRecords(dir));
  if (!last) return { ok: false, reason: "no_records: 実行の記録が無いので戻る先が決まらない" };
  if (last.finished_at === null) {
    // route が in_flight と見て何もしないので、戻しても静かに止まったままになる
    return { ok: false, reason: `run_in_progress: ${last.agent} run=${last.run_id}` };
  }

  writeStateFile(dir, file, { phase: last.phase, blocked_reason: null }, now);
  return { ok: true, phase: last.phase, agent: last.agent };
}

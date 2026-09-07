import type { Config } from "../defaults.ts";
import type { Snapshot } from "../file/state-file.ts";
import type { Phase, RoundKey } from "../types.ts";
import { PHASES } from "../types.ts";
import { resolveAgent } from "../utils/resolve-agent.ts";
import { agentFor, isIdle } from "./app/reducer.ts";
import type { RootState } from "./state.ts";

/**
 * selector。**引数は root state**（ducks の慣習）で、スライスを跨いで読んでよい
 * （制約がかかるのは reducer だけ）。
 *
 * ここに集めるのは、**同じ導出を subscriber とコマンドの両方が使う**ため
 * （`selectLabel` は label subscriber と label コマンド、
 *  `selectBlocked` は comment subscriber と explain コマンド）。
 * `reselect` は入れない（1 起動 1 dispatch なのでメモ化する対象が無い）。
 */

/** phase をラベル名に射影する。`plan_review` → `agent:plan-review`（設計書 §2.3） */
export const labelFor = (phase: Phase, prefix: string): string =>
  `${prefix}${phase.replace(/_/g, "-")}`;

/** パイプラインが管理するラベルの全体（射影先 + 起動用） */
export const allLabels = (prefix: string, trigger: string): string[] => [
  ...PHASES.map((p) => labelFor(p, prefix)),
  trigger,
];

/** いま issue に付いているべきラベル。どれを外すかはワークフローが prefix で決める */
export function selectLabel(root: RootState, config: Config) {
  const { prefix, trigger } = config.labels;
  return {
    label: labelFor(root.app.phase, prefix),
    issue: root.info.issue ?? 0,
    phase: root.app.phase,
    prefix,
    trigger,
  };
}

/**
 * false なら HEAD コミットに `[skip ci]` を付けて連鎖を止める（A-36 / V-5）。
 * 判定は「次にエージェントを起動するか」。`awaiting_human` も止める
 * （人間のコメントを待つ間の push は route が none を返すだけの run を作る）
 */
export const selectContinueChain = (root: RootState): boolean => !isIdle(root.app.phase);

/** `state.json` に書き出す内容。状態の射影であって、状態の正ではない（K-26） */
export const selectSnapshot = (root: RootState): Snapshot => ({
  pipeline_version: root.info.pipeline_version ?? 0,
  issue: root.info.issue ?? 0,
  branch: root.info.branch ?? "",
  phase: root.app.phase,
  blocked_reason: root.app.blocked_reason,
});

/** blocked かどうかと理由（comment subscriber と explain コマンドが使う） */
export const selectBlocked = (root: RootState) =>
  root.app.phase === "blocked"
    ? { blocked: true as const, reason: root.app.blocked_reason ?? "（理由が記録されていません）" }
    : { blocked: false as const, reason: null };

/** 中央の破壊的変更が進行中の run を壊さないための前提チェック（遷移の規則ではない） */
const versionMismatch = (root: RootState, config: Config): string | null =>
  root.info.pipeline_version === config.pipeline_version
    ? null
    : `pipeline_version_mismatch: run=${root.info.pipeline_version} harness=${config.pipeline_version}`;

export interface NextAction {
  /** run=実行する / none=何もしない / block=phase を blocked に書く必要がある */
  action: "run" | "none" | "block";
  /** 判断理由。ログとサマリーに出す */
  reason: string;
  phase: Phase;
  total_steps: number;
  rounds: Record<RoundKey, number>;
  /** action=run のときだけ */
  run?: ReturnType<typeof resolveAgent>;
}

/**
 * 次に何をするかを決める（`route` コマンド。**読み取りだけで何も書かない**）。
 * 版と設定の整合性は遷移の規則ではないので、遷移の判断より先に見る。
 * どちらも `block` として返す — ここで例外を投げると状態が git に載らないまま
 * job が落ち、run が無音で止まる（設計書 §7.1）。
 */
export function selectNextAction(
  root: RootState,
  config: Config,
  config_error: string | null = null,
): NextAction {
  const { phase, counts, in_flight } = root.app;
  const base = { phase, total_steps: counts.total_steps, rounds: counts.rounds };
  const block = (reason: string): NextAction => ({ ...base, action: "block", reason });
  const none = (reason: string): NextAction => ({ ...base, action: "none", reason });

  if (config_error) return block(`config_invalid: ${config_error}`);
  const mismatch = versionMismatch(root, config);
  if (mismatch) return block(mismatch);
  if (isIdle(phase)) return none(`phase_${phase}`);
  // 実行中の再入による二重起動を防ぐ。ここで止まったまま落ちた run は stale 検知が拾う（A-14）
  if (in_flight) return none(`run_in_progress: ${in_flight.agent} run=${in_flight.run_id}`);
  if (counts.total_steps >= config.limits.total_steps) {
    return block(`total_steps_exceeded: ${counts.total_steps}/${config.limits.total_steps}`);
  }
  const agent = agentFor(phase, config);
  if (!agent) return block(`no_transition_for_phase: ${phase}`);
  return { ...base, action: "run", reason: "dispatch", run: resolveAgent(config, agent) };
}

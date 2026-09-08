import type { Config } from "../../../defaults.ts";
import type { Snapshot } from "../../../file/stateFile.ts";
import type { AgentName, Phase, RoundKey } from "../../../types.ts";
import { resolveAgent } from "../../../utils/resolveAgent.ts";
import { agentFor, isIdle } from "../app/reducer.ts";
import type { RootState } from "../createStore.ts";

/**
 * selector。**引数は root state**（ducks の慣習）で、スライスを跨いで読んでよい
 * （制約がかかるのは reducer だけ）。
 *
 * ここに集めるのは、**同じ導出を subscriber とコマンドの両方が使う**ため
 * （`selectLabel` は label subscriber と label コマンド、
 *  `selectBlocked` は comment subscriber と explain コマンド）。
 * `reselect` は入れない（1 起動 1 dispatch なのでメモ化する対象が無い）。
 */

/**
 * 契約の検査対象。**いま走っているエージェントはイベントログが知っている**
 * （`start` が `agent_started` に記録した）ので、`validate` は引数で受け取らない。
 * null なら実行が記録されていない（`start` を通っていない = ワークフローの壊れ）。
 */
export const selectInFlightAgent = (root: RootState): AgentName | null => root.app.in_flight_agent;

/** phase をラベル名に射影する。`plan_review` → `agent:plan-review`（設計書 §2.3） */
export const labelFor = (phase: Phase, prefix: string): string =>
  `${prefix}${phase.replace(/_/g, "-")}`;

/** いま issue に付いているべきラベル。どれを外すかはワークフローが prefix で決める */
export function selectLabel(root: RootState, config: Config) {
  const { prefix, trigger } = config.labels;
  const { phase } = selectStatus(root, config);
  return {
    label: labelFor(phase, prefix),
    issue: root.info.issue ?? 0,
    phase,
    prefix,
    trigger,
  };
}

/**
 * **「止まっている」は導出された状態。** `blocked` という action は無く、
 * 次の 4 つのどれかが立っていれば止まっている（K-26）。
 *
 *   1. 実行が失敗した / 契約を満たさなかった / 上限に達した（reducer が `failure_reason` に残す）
 *   2. 配布先の `.agent/config.json` が受け付けられない（`config_error`）
 *   3. 中央の版が進行中の run と合わない
 *   4. 実行回数の総数が上限に達した
 *
 * 2〜4 は状態と設定から毎回計算できるので、イベントとして記録しない。
 */
/**
 * 状態と設定から毎回計算できる停止の理由（イベントとして記録しない 3 つ）。
 * `route` はこれを見たときだけスナップショットを書き直させる（まだ記録されていないため）。
 */
function selectEnvStop(
  root: RootState,
  config: Config,
  config_error: string | null = null,
): string | null {
  const { total_steps } = root.app;
  const version = root.info.pipeline_version;
  if (config_error) return `config_invalid: ${config_error}`;
  if (version !== config.pipeline_version) {
    return `pipeline_version_mismatch: run=${version} harness=${config.pipeline_version}`;
  }
  if (total_steps >= config.limits.total_steps) {
    return `total_steps_exceeded: ${total_steps}/${config.limits.total_steps}`;
  }
  return null;
}

interface Status {
  /** 導出された phase。止まっていれば blocked、そうでなければ実行位置そのもの */
  phase: Phase;
  /** 止まっている理由。null なら止まっていない */
  blocked_reason: string | null;
}

export function selectStatus(
  root: RootState,
  config: Config,
  config_error: string | null = null,
): Status {
  const { phase, failure_reason } = root.app;
  if (failure_reason) return { phase: "blocked", blocked_reason: failure_reason };
  const env = selectEnvStop(root, config, config_error);
  if (env) return { phase: "blocked", blocked_reason: env };
  // スナップショットが blocked のまま復元され、理由が残っていない場合
  if (phase === "blocked") {
    return { phase: "blocked", blocked_reason: "（理由が記録されていません）" };
  }
  return { phase, blocked_reason: null };
}

/**
 * false なら HEAD コミットに `[skip ci]` を付けて連鎖を止める（A-36 / V-5）。
 * 判定は「次にエージェントを起動するか」。`awaiting_human` も止める
 * （人間のコメントを待つ間の push は route が none を返すだけの run を作る）
 */
export const selectContinueChain = (root: RootState, config: Config): boolean =>
  !isIdle(selectStatus(root, config).phase);

/** `state.json` に書き出す内容。状態の射影であって、状態の正ではない（K-26） */
export const selectSnapshot = (
  root: RootState,
  config: Config,
  config_error: string | null = null,
): Snapshot => ({
  pipeline_version: root.info.pipeline_version ?? 0,
  issue: root.info.issue ?? 0,
  branch: root.info.branch ?? "",
  ...selectStatus(root, config, config_error),
});

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
  const { app } = root;
  const { phase } = selectStatus(root, config, config_error);
  const base = {
    phase,
    total_steps: app.total_steps,
    rounds: { plan_review: app.plan_review_rounds, dev_review: app.dev_review_rounds },
  };

  // 環境由来の停止だけは、まだスナップショットに記録されていないので書かせる
  const env = selectEnvStop(root, config, config_error);
  if (env) return { ...base, action: "block", reason: env };
  // 記録済みの停止（失敗・上限・契約違反）と人間待ちは何もしない
  if (app.failure_reason || isIdle(phase))
    return { ...base, action: "none", reason: `phase_${phase}` };
  // 実行中の再入による二重起動を防ぐ。ここで止まったまま落ちた run は stale 検知が拾う（A-14）
  if (app.in_flight_agent) {
    return {
      ...base,
      action: "none",
      reason: `run_in_progress: ${app.in_flight_agent} run=${app.in_flight_run_id}`,
    };
  }
  const agent = agentFor(phase);
  if (!agent) return { ...base, action: "block", reason: `no_transition_for_phase: ${phase}` };
  return { ...base, action: "run", reason: "dispatch", run: resolveAgent(config, agent) };
}

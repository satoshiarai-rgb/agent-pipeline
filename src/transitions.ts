import type { Config } from "./defaults.ts";
import type { RunRecord } from "./file/run-record.ts";
import type { AgentName, Phase, RoundKey } from "./types.ts";
import { deriveRunStats } from "./utils/derive-run-stats.ts";
import { resolveAgent } from "./utils/resolve-agent.ts";

export interface RouteResult {
  /** run=実行する / none=何もしない / block=phase を blocked に書く必要がある */
  action: "run" | "none" | "block";
  /** 判断理由。ログとサマリーに出す */
  reason: string;
  phase: Phase;
  total_steps: number;
  rounds: Record<RoundKey, number>;
  /** action=run のときだけ */
  run?: {
    agent: AgentName;
    model: string;
    max_turns: number;
    timeout_minutes: number;
    tools: string;
  };
}

/** 遷移表を引くためのイベント。エージェントの実行結果をこの語彙に落としてから渡す */
type TransitionEvent = "ok" | "approve" | "request_changes" | "pass" | "fail" | "approval";

/** エージェントを起動しない phase */
const IDLE_PHASES: readonly Phase[] = ["bootstrap", "awaiting_human", "done", "blocked"];
/** これ以上進まない phase */
const TERMINAL_PHASES: readonly Phase[] = ["done", "blocked"];

const isIdle = (phase: Phase): boolean => IDLE_PHASES.includes(phase);
export const isTerminal = (phase: Phase): boolean => TERMINAL_PHASES.includes(phase);

/** その phase で動かすエージェント。遷移表に無ければ null */
function agentFor(phase: Phase, config: Config): AgentName | null {
  return config.transitions[phase]?.agent ?? null;
}

/** 人間の差し戻しをどちらのレビューファイルとして残すか */
export function reviewKindFor(phase: Phase, config: Config): "plan" | "dev" | null {
  return config.transitions[phase]?.review_kind ?? null;
}

/** その phase がレビューのラウンドを数える対象なら、そのキー */
export function roundKeyFor(phase: Phase, config: Config): RoundKey | null {
  return config.transitions[phase]?.round_key ?? null;
}

/** 遷移表を引く。行き先が定義されていなければ null（設定の壊れは呼び出し側が blocked にする） */
export function nextPhase(phase: Phase, event: TransitionEvent, config: Config): Phase | null {
  const t = config.transitions[phase];
  if (!t) return null;
  switch (event) {
    case "ok":
      return t.on_ok ?? null;
    case "approve":
      return t.on_approve ?? null;
    case "request_changes":
      return t.on_request_changes ?? null;
    case "pass":
      return t.on_pass ?? null;
    case "fail":
      return t.on_fail ?? null;
    case "approval":
      return t.on_approval ?? null;
  }
}

/**
 * 現在の状態から次に何をするかを決める（読み取り専用の判断）。
 * 識別子や版の整合性はこの層では見ない（run-file.ts の責務）。
 */
export function route(input: { phase: Phase; records: RunRecord[]; config: Config }): RouteResult {
  const { phase, records, config } = input;
  const stats = deriveRunStats(records);
  const base = { phase, total_steps: stats.total_steps, rounds: stats.rounds };

  if (isIdle(phase)) return { ...base, action: "none", reason: `phase_${phase}` };
  if (stats.in_flight) {
    // 実行中の再入による二重起動を防ぐ。ここで止まったまま落ちた run は stale 検知が拾う（A-14）
    return {
      ...base,
      action: "none",
      reason: `run_in_progress: ${stats.in_flight.agent} run=${stats.in_flight.run_id}`,
    };
  }
  if (stats.total_steps >= config.limits.total_steps) {
    return {
      ...base,
      action: "block",
      reason: `total_steps_exceeded: ${stats.total_steps}/${config.limits.total_steps}`,
    };
  }

  const agent = agentFor(phase, config);
  if (!agent) return { ...base, action: "block", reason: `no_transition_for_phase: ${phase}` };
  return { ...base, action: "run", reason: "dispatch", run: resolveAgent(config, agent) };
}

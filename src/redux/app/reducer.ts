import type { Config } from "../../defaults.ts";
import type { AgentName, Phase, RoundKey } from "../../types.ts";
import type { Action } from "../../utils/typescript-fsa.ts";
import { reducerWithInitialState } from "../../utils/typescript-fsa-reducers.ts";
import { restore } from "../actions.ts";
import {
  APP_ACTIONS,
  type AppPayload,
  agentFailed,
  agentOk,
  agentStarted,
  humanApproval,
  humanRequestChanges,
  isFailure,
  retry,
  review,
} from "./actions.ts";

/**
 * 実行状況（= イベントログの畳み込み）。この 1 ファイルに、
 * 状態 / 遷移表の引き方 / カウント表 / retry の戻り先 / reducer を置く。
 *
 *   1. 状態と初期値
 *   2. 遷移表を引く小さな関数（**辺そのものは `defaults.transitions` が持つ**）
 *   3. retry の戻り先の表
 *   4. カウント表
 *   5. 遷移のルール表（順序付き。上から最初に一致したものを使う）
 *   6. フィールドごとの合成と reducer
 */

// ------------------------------------------------------------------ 1. 状態

export interface AppState {
  phase: Phase;
  blocked_reason: string | null;
  /** blocked に入る直前の phase。`/agent retry` の戻り先（K-27） */
  blocked_from: Phase | null;
  counts: { total_steps: number; rounds: Record<RoundKey, number> };
  /** 実行中のエージェント。終了系の action で落ちる。二重起動の防止（A-14） */
  in_flight: { agent: AgentName; run_id: string } | null;
  /** 直前の遷移の理由。ワークフローの output と Actions のサマリーに出す（永続化しない） */
  last_reason: string | null;
}

export const initialApp: AppState = {
  phase: "bootstrap",
  blocked_reason: null,
  blocked_from: null,
  counts: { total_steps: 0, rounds: { plan_review: 0, dev_review: 0 } },
  in_flight: null,
  last_reason: null,
};

// -------------------------------------------------------------- 2. 遷移表

/** 遷移表を引くための事象。action をこの語彙に落としてから表を引く */
export type TransitionEvent = "ok" | "approve" | "request_changes" | "pass" | "fail" | "approval";

/** 遷移表を引く。行き先が定義されていなければ null（呼び出し側が blocked にする） */
export function nextPhase(phase: Phase, event: TransitionEvent, config: Config): Phase | null {
  const t = config.transitions[phase];
  if (!t) return null;
  const edges: Record<TransitionEvent, Phase | undefined> = {
    ok: t.on_ok,
    approve: t.on_approve,
    request_changes: t.on_request_changes,
    pass: t.on_pass,
    fail: t.on_fail,
    approval: t.on_approval,
  };
  return edges[event] ?? null;
}

/** エージェントを起動しない phase。連鎖（`[skip ci]` の要否）もこれで決める */
const IDLE_PHASES: readonly Phase[] = ["bootstrap", "awaiting_human", "done", "blocked"];
export const isIdle = (phase: Phase): boolean => IDLE_PHASES.includes(phase);

/** その phase で動かすエージェント。遷移表に無ければ null */
export const agentFor = (phase: Phase, config: Config) => config.transitions[phase]?.agent ?? null;

/** 人間の差し戻しをどちらのレビューファイルとして残すか */
export const reviewKindFor = (phase: Phase, config: Config) =>
  config.transitions[phase]?.review_kind ?? null;

/** その phase がレビューのラウンドを数える対象なら、そのキー */
export const roundKeyFor = (phase: Phase, config: Config) =>
  config.transitions[phase]?.round_key ?? null;

// --------------------------------------------------- 3. retry の戻り先の表

/**
 * `/agent retry` の戻り先（K-27）。**`blocked_from` から決め打ちで引く。**
 *
 * 値は identity（止まったフェーズをやり直す）から始める。実機で止まる主因は
 * `api_error` と `missing_verdict` で、どちらも同じフェーズの再実行で直り、
 * 計画（planner の $0.7〜1.0 の実行）を捨てずに済む。
 * 「1 つ戻して入力から作り直す」に変えるなら、この表の値を書き換える。
 *
 * `blocked_reason` から逆引きする表は作らない — 理由の大半（invalid_artifacts /
 * missing_verdict / api_error / agent_failed）は phase を一意に決めないため。
 */
export const RETRY_TO: Record<Phase, Phase> = {
  bootstrap: "bootstrap",
  planning: "planning",
  plan_review: "plan_review",
  awaiting_human: "awaiting_human",
  developing: "developing",
  dev_review: "dev_review",
  completing: "completing",
  done: "done",
  blocked: "blocked",
};

// ------------------------------------------------------------ 4. カウント表

/**
 * **数えるのは「実行の開始」だけ。** 人間の介入（承認・差し戻し・retry）は 0 なので、
 * A-41（差し戻しは total_steps を増やさないが、戻った先のエージェント実行は数える）が
 * 表として読める。レビューの上限判定は自分を含んだ数を見る（開始で +1 されるため）。
 */
interface CountRule {
  total_steps: number;
  /** いまの phase の round_key に足す数（round_key を持たない phase では捨てる） */
  rounds: number;
}

const NONE: CountRule = { total_steps: 0, rounds: 0 };

const COUNTS: Record<string, CountRule> = {
  [agentStarted.type]: { total_steps: 1, rounds: 1 },
};

function nextCounts(s: AppState, a: Action<AppPayload>, c: Config): AppState["counts"] {
  const rule = COUNTS[a.type] ?? NONE;
  const key = roundKeyFor(s.phase, c);
  return {
    total_steps: s.counts.total_steps + rule.total_steps,
    rounds:
      key && rule.rounds
        ? { ...s.counts.rounds, [key]: s.counts.rounds[key] + rule.rounds }
        : s.counts.rounds,
  };
}

// --------------------------------------------------------- 5. 遷移のルール表

/** 遷移の結果。reason は人間とログ向けの理由（ワークフローの output に出る） */
export interface Transition {
  phase: Phase;
  blocked_reason: string | null;
  reason: string;
}

type Rule = (s: AppState, a: Action<AppPayload>, c: Config) => Transition | null;

const blocked = (reason: string): Transition => ({
  phase: "blocked",
  blocked_reason: reason,
  reason,
});

/** 遷移表を引いて次へ進む。行き先が無いのは設定の壊れなので blocked にする */
function advance(s: AppState, event: TransitionEvent, c: Config, reason: string): Transition {
  const next = nextPhase(s.phase, event, c);
  if (!next) return blocked(`transition_incomplete: ${s.phase} (${event})`);
  return { phase: next, blocked_reason: null, reason };
}

/** action を遷移表の事象に落とす表。REVIEW だけ payload から決まる */
const EVENT_OF: Record<string, TransitionEvent | ((a: Action<AppPayload>) => TransitionEvent)> = {
  [agentOk.type]: "ok",
  [review.type]: (a) => (review.match(a) ? a.payload.verdict : "ok"),
  [humanApproval.type]: "approval",
  [humanRequestChanges.type]: "request_changes",
};

/** **上から最初に一致したものを使う**（`validate` / `explain` と同じ形） */
const RULES: Rule[] = [
  /** 実行の開始は phase を動かさない（数えるのは counts、記録するのは in_flight） */
  (s, a) => (agentStarted.match(a) ? { ...s, reason: "started" } : null),

  /** 失敗（error: true）は理由をそのまま blocked_reason にする */
  (_s, a) => (isFailure(a) ? blocked(a.payload.reason) : null),

  /** retry は決め打ち表で戻す（戻り先が無いのはガードが弾いている / K-27） */
  (s, a) =>
    retry.match(a) && s.blocked_from
      ? {
          phase: RETRY_TO[s.blocked_from],
          blocked_reason: null,
          reason: `retry: ${s.blocked_from}`,
        }
      : null,

  /** レビューのフェーズ: verdict を事象に落とし、差し戻しはラウンド上限を見る */
  (s, a, c) => {
    const key = roundKeyFor(s.phase, c);
    if (!key) return null;
    if (review.match(a) && a.payload.verdict === "approve")
      return advance(s, "approve", c, "approve");
    if (!review.match(a)) return blocked("missing_verdict");
    const used = s.counts.rounds[key];
    const limit = c.limits[`${key}_rounds`];
    if (used >= limit) return blocked(`${key}_rounds_exceeded: ${used}/${limit}`);
    return advance(s, "request_changes", c, `request_changes (${used}/${limit})`);
  },

  /** completing: acceptance.json が全 passed かで分岐する */
  (s, a, c) => {
    if (!agentOk.match(a) || nextPhase(s.phase, "pass", c) === null) return null;
    if (!a.payload.acceptance_passed) return blocked("acceptance_not_passed");
    return advance(s, "pass", c, "acceptance_passed");
  },

  /** それ以外は表で事象に落として進む */
  (s, a, c) => {
    const e = EVENT_OF[a.type];
    if (!e) return null;
    const event = typeof e === "function" ? e(a) : e;
    return advance(s, event, c, event);
  },
];

export function nextTransition(s: AppState, a: Action<AppPayload>, c: Config): Transition {
  for (const rule of RULES) {
    const t = rule(s, a, c);
    if (t) return t;
  }
  // 表に無い action は状態を変えない（ここに来るのは vocabulary の取りこぼし）
  return { ...s, reason: "no_rule" };
}

// ------------------------------------------------------ 6. フィールドの合成

/** 実行中のエージェント。開始で立ち、終了系（ok / review / failed）で落ちる */
function nextInFlight(s: AppState, a: Action<AppPayload>): AppState["in_flight"] {
  if (agentStarted.match(a)) return { agent: a.payload.agent, run_id: a.payload.run_id };
  const closes = agentOk.match(a) || review.match(a) || agentFailed.match(a);
  return closes ? null : s.in_flight;
}

/** blocked に入る直前の phase。状態から導けるので新しいファイルのキーが要らない */
function nextBlockedFrom(s: AppState, t: Transition): Phase | null {
  if (t.phase !== "blocked") return null; // blocked を離れたら忘れる
  // blocked が重なった場合は最初に入ったときの記録を保つ
  return s.phase === "blocked" ? s.blocked_from : s.phase;
}

/**
 * 1 つの action を状態に適用する。**フィールドごとの関数を並べるだけ**で、
 * 判断は上の表にある。`config` はクロージャで畳み込む（`combineReducers` 越しに
 * `info` スライスを読めないので state には入れない / K-26）。
 */
const step =
  (config: Config) =>
  (state: AppState, action: Action<AppPayload>): AppState => {
    const t = nextTransition(state, action, config);
    return {
      phase: t.phase,
      blocked_reason: t.blocked_reason,
      blocked_from: nextBlockedFrom(state, t),
      counts: nextCounts(state, action, config),
      in_flight: nextInFlight(state, action),
      last_reason: t.reason,
    };
  };

/**
 * **どの action が状態を変えるかの表**。8 つとも同じ手順（上の `step`）を通り、
 * 表に無い action は状態を変えない（`@@redux/INIT` や info スライスの action）。
 */
export const createAppReducer = (config: Config) =>
  APP_ACTIONS.reduce(
    (builder, creator) => builder.caseWithAction(creator, step(config)),
    reducerWithInitialState(initialApp).caseWithAction(restore, (s, a) => ({
      ...s,
      ...a.payload.app,
    })),
  ).build();

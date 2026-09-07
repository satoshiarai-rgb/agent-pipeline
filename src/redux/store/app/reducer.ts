import type { Config } from "../../../defaults.ts";
import type { AgentName, Phase, RoundKey } from "../../../types.ts";
import { reducerWithInitialState } from "../../../utils/typescript-fsa-reducers.ts";
import { restore } from "../global/actions.ts";
import {
  agentFailed,
  agentOk,
  agentStarted,
  humanApproval,
  humanRequestChanges,
  retry,
  review,
} from "./actions.ts";

/**
 * 実行状況（= イベントログの畳み込み）。状態・遷移表・reducer をこの 1 ファイルに置く。
 *
 * **`phase` は blocked にならない。** 「止まっている」は `failure_reason` から導出する
 * 状態（`redux/selectors.ts`）なので、実行位置は失敗で潰されず、`/agent retry` は
 * そのまま同じフェーズを引き直せる（K-26 / K-27）。
 */

// ------------------------------------------------------------ 状態（フラット）

export interface AppState {
  /** 実行位置。blocked にはならない */
  phase: Phase;
  /** 停止の理由。null でなければ導出された phase は blocked になる */
  failure_reason: string | null;
  total_steps: number;
  plan_review_rounds: number;
  dev_review_rounds: number;
  /** 実行中のエージェント。終了系の action で null に戻る（二重起動の防止 / A-14） */
  in_flight_agent: AgentName | null;
  in_flight_run_id: string | null;
  /** 直前の遷移の理由。ワークフローの output と Actions のサマリーに出す */
  last_reason: string | null;
}

export const initialApp: AppState = {
  phase: "bootstrap",
  failure_reason: null,
  total_steps: 0,
  plan_review_rounds: 0,
  dev_review_rounds: 0,
  in_flight_agent: null,
  in_flight_run_id: null,
  last_reason: null,
};

// ------------------------------------------------------------------- 遷移表

/**
 * 遷移表。**中央のものなので配布先の設定では上書きできない**（`.agent/config.json` で
 * 変えられるのは上限・モデル・ツールなど / A-19）。`done` は終端で辺を持たない（K-10）。
 */
interface Edges {
  /** 無ければエージェントを起動しない（人間が起こす遷移） */
  agent?: AgentName;
  /** レビューのラウンドを数える対象なら、そのキー */
  round_key?: RoundKey;
  /** 人間の差し戻しをどちらのレビューファイルとして残すか */
  review_kind?: "plan" | "dev";
  ok?: Phase;
  approve?: Phase;
  request_changes?: Phase;
  approval?: Phase;
}

export const TRANSITIONS: Partial<Record<Phase, Edges>> = {
  planning: { agent: "planner", ok: "plan_review" },
  plan_review: {
    agent: "plan-reviewer",
    round_key: "plan_review",
    approve: "awaiting_human",
    request_changes: "planning",
  },
  developing: { agent: "developer", ok: "dev_review" },
  dev_review: {
    agent: "dev-reviewer",
    round_key: "dev_review",
    approve: "completing",
    request_changes: "developing",
  },
  /** 受け入れ条件が全 passed なら done、そうでなければ止まる */
  completing: { agent: "completion", ok: "done" },
  /** 人間のコメントで進む / 戻る（設計書 §6.5） */
  awaiting_human: { approval: "developing", request_changes: "planning", review_kind: "plan" },
};

/** エージェントを起動しない phase。連鎖（`[skip ci]` の要否）もこれで決める */
const IDLE_PHASES: readonly Phase[] = ["bootstrap", "awaiting_human", "done", "blocked"];
export const isIdle = (phase: Phase): boolean => IDLE_PHASES.includes(phase);

/** その phase で動かすエージェント。遷移表に無ければ null */
export const agentFor = (phase: Phase): AgentName | null => TRANSITIONS[phase]?.agent ?? null;

/** 人間の差し戻しをどちらのレビューファイルとして残すか */
export const reviewKindFor = (phase: Phase) => TRANSITIONS[phase]?.review_kind ?? null;

/** その phase がレビューのラウンドを数える対象なら、そのキー */
export const roundKeyFor = (phase: Phase) => TRANSITIONS[phase]?.round_key ?? null;

/**
 * `/agent retry` の戻り先。**`phase` から決め打ちで引く表**（K-27）。
 *
 * 値は identity（止まったフェーズをやり直す）から始める。実機で止まる主因は
 * `api_error` と `missing_verdict` で、どちらも同じフェーズの再実行で直り、
 * 計画（planner の $0.7〜1.0 の実行）を捨てずに済む。
 * 「1 つ戻して入力から作り直す」に変えるなら、この表の値を書き換える。
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

// -------------------------------------------------------------------- reducer

/**
 * **どの action がどう状態を変えるかの表。** 1 action = 1 case で、各 case は
 * 次の状態をそのまま返す（ヘルパを重ねて呼ばない）。
 *
 * `config` を畳み込むのはレビューのラウンド上限（`limits`）だけで、遷移の辺は
 * 上の表が持つ。
 */
export const createAppReducer = (config: Config) =>
  reducerWithInitialState(initialApp)
    // 既存のファイルからの復元（段取り 2 でイベントの再生に置き換わる）
    .case(restore, (s, p) => ({ ...s, ...p.app }))

    // 実行の開始。phase は動かさず、数と「実行中」だけを記録する
    .case(agentStarted, (s, p) => ({
      ...s,
      total_steps: s.total_steps + 1,
      plan_review_rounds: s.plan_review_rounds + (s.phase === "plan_review" ? 1 : 0),
      dev_review_rounds: s.dev_review_rounds + (s.phase === "dev_review" ? 1 : 0),
      in_flight_agent: p.agent,
      in_flight_run_id: p.run_id,
      last_reason: "started",
    }))

    // 実行そのものの失敗と契約違反。理由がそのまま停止の理由になる
    .case(agentFailed, (s, p) => ({
      ...s,
      failure_reason: p.reason,
      in_flight_agent: null,
      in_flight_run_id: null,
      last_reason: p.reason,
    }))

    // 成果物が契約を満たした。completing だけは受け入れ条件が全 passed かを見る
    .case(agentOk, (s, p) => {
      const next = TRANSITIONS[s.phase]?.ok;
      const needsVerdict = roundKeyFor(s.phase) !== null;
      const acceptance = s.phase === "completing" && !p.acceptance_passed;
      return {
        ...s,
        phase: acceptance || needsVerdict ? s.phase : (next ?? s.phase),
        failure_reason: acceptance
          ? "acceptance_not_passed"
          : needsVerdict
            ? "missing_verdict"
            : next
              ? null
              : `transition_incomplete: ${s.phase} (ok)`,
        in_flight_agent: null,
        in_flight_run_id: null,
        last_reason: s.phase === "completing" ? "acceptance_passed" : "ok",
      };
    })

    // レビューの判定。差し戻しはラウンド上限を見る（上限に達したら止まる）
    .case(review, (s, p) => {
      const key = roundKeyFor(s.phase);
      const used = key === "dev_review" ? s.dev_review_rounds : s.plan_review_rounds;
      const limit =
        key === "dev_review" ? config.limits.dev_review_rounds : config.limits.plan_review_rounds;
      const exceeded = p.verdict === "request_changes" && used >= limit;
      const next = TRANSITIONS[s.phase]?.[p.verdict];
      return {
        ...s,
        phase: exceeded ? s.phase : (next ?? s.phase),
        failure_reason: exceeded
          ? `${key}_rounds_exceeded: ${used}/${limit}`
          : next
            ? null
            : `transition_incomplete: ${s.phase} (${p.verdict})`,
        in_flight_agent: null,
        in_flight_run_id: null,
        last_reason: p.verdict === "approve" ? "approve" : `request_changes (${used}/${limit})`,
      };
    })

    // 人間の承認。数は増やさない（A-41）
    .case(humanApproval, (s) => ({
      ...s,
      phase: TRANSITIONS[s.phase]?.approval ?? s.phase,
      failure_reason: TRANSITIONS[s.phase]?.approval
        ? null
        : `transition_incomplete: ${s.phase} (approval)`,
      last_reason: "approval",
    }))

    // 人間の差し戻し。本文は middleware がレビューファイルに残す
    .case(humanRequestChanges, (s) => ({
      ...s,
      phase: TRANSITIONS[s.phase]?.request_changes ?? s.phase,
      failure_reason: TRANSITIONS[s.phase]?.request_changes
        ? null
        : `transition_incomplete: ${s.phase} (request_changes)`,
      last_reason: "request_changes",
    }))

    // 復旧。停止の理由を消し、表の戻り先から再開する
    .case(retry, (s) => ({
      ...s,
      phase: RETRY_TO[s.phase],
      failure_reason: null,
      last_reason: `retry: ${s.phase}`,
    }))

    .build();

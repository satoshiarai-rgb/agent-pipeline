import type { PipelineSettings } from "../../../pipelineSettings.ts";
import type { AgentName, Phase } from "../../../types.ts";
import { reducerWithInitialState } from "../../../utils/typescriptFsaReducers.ts";
import { bootstrap } from "../global/actions.ts";
import {
  agentFailed,
  agentStarted,
  completed,
  devReviewed,
  humanApproval,
  humanRequestChanges,
  implemented,
  planned,
  planReviewed,
  retry,
} from "./actions.ts";

/**
 * 実行状況（= イベントログの畳み込み）。
 *
 * **`phase` は blocked にならない。** 「止まっている」は `failure_reason` から導出する
 * 状態（`store/selectors.ts`）なので、実行位置は失敗で潰されず、`/agent retry` は
 * そのまま同じフェーズを引き直せる（K-26 / K-27）。
 *
 * **遷移は reducer の中に直接書く。** エージェントの終了はフェーズごとに別の action
 * なので、1 case = 1 遷移になり、case の中に phase の分岐が無い。
 */

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
  /** 実行の開始時刻。**死んだ実行（stale）の判定に使う**（I-8 / A-14） */
  in_flight_since: string | null;
}

export const initialApp: AppState = {
  phase: "bootstrap",
  failure_reason: null,
  total_steps: 0,
  plan_review_rounds: 0,
  dev_review_rounds: 0,
  in_flight_agent: null,
  in_flight_run_id: null,
  in_flight_since: null,
};

/**
 * レビューの往復が上限に達していれば停止の理由を返す。達していなければ null。
 * `used` は**今回の判定を含んだ数**（差し戻しの案内に出る `(n/limit)` と同じ数）。
 *
 * **この文字列は `explain` の案内・`docs/troubleshooting.md` の表・プロンプトが
 * 依存している**（K-26 の受け入れ条件）。
 */
function roundLimitReason(
  phase: "plan_review" | "dev_review",
  used: number,
  limit: number,
): string | null {
  if (used >= limit) return `${phase}_rounds_exceeded: ${used}/${limit}`;
  return null;
}

// --------------------------------------------------------------- フェーズの性質

/** エージェントを起動しない phase。連鎖（`[skip ci]` の要否）もこれで決める */
const IDLE: Partial<Record<Phase, true>> = {
  bootstrap: true,
  awaiting_human: true,
  done: true,
  blocked: true,
};

export const isIdle = (phase: Phase): boolean => IDLE[phase] === true;

/** その phase で動かすエージェント。人間が起こす遷移では null */
const AGENTS: Partial<Record<Phase, AgentName>> = {
  planning: "planner",
  plan_review: "plan-reviewer",
  developing: "developer",
  dev_review: "dev-reviewer",
  completing: "completion",
};

export const agentFor = (phase: Phase): AgentName | null => AGENTS[phase] ?? null;

// -------------------------------------------------------------------- reducer

/** エージェントの実行が終わったときに毎回落とすもの（実行中の記録） */
const closed = {
  in_flight_agent: null,
  in_flight_run_id: null,
  in_flight_since: null,
} as const;

/**
 * **どの action がどう状態を変えるかの表。** 1 action = 1 遷移で、遷移先は case の中に
 * 直接書く。`settings` を畳み込むのはレビューの往復上限（`limits`）だけ。
 */
export const createAppReducer = (settings: PipelineSettings) =>
  reducerWithInitialState(initialApp)
    // run が始まった。ここから計画のフェーズ（識別子は info スライスが受ける）
    .case(bootstrap, (state) => ({ ...state, phase: "planning" as const }))

    /**
     * 実行の開始。phase は動かさず、総数と「実行中」だけを記録する。
     * レビューの往復は判定の側（`planReviewed` / `devReviewed`）で数える。
     */
    .case(agentStarted, (state, payload) => ({
      ...state,
      total_steps: state.total_steps + 1,
      in_flight_agent: payload.agent,
      in_flight_run_id: payload.run_id,
      in_flight_since: payload.timestamp,
    }))

    // 実行そのものの失敗と契約違反。理由がそのまま停止の理由になる
    .case(agentFailed, (state, payload) => ({
      ...state,
      ...closed,
      failure_reason: payload.reason,
    }))

    // 計画ができた
    .case(planned, (state) => ({
      ...state,
      ...closed,
      phase: "plan_review",
      failure_reason: null,
    }))

    // 計画のレビュー。承認は人間に渡し、差し戻しは往復の上限を見る（設計書 §3.1）
    .case(planReviewed, (state, payload) => {
      const rounds = state.plan_review_rounds + 1;
      if (payload.verdict === "approve") {
        return {
          ...state,
          ...closed,
          phase: "awaiting_human",
          plan_review_rounds: rounds,
          failure_reason: null,
        };
      }
      const exceeded = roundLimitReason("plan_review", rounds, settings.limits.plan_review_rounds);
      if (exceeded) {
        return {
          ...state,
          ...closed,
          plan_review_rounds: rounds,
          failure_reason: exceeded,
        };
      }
      return {
        ...state,
        ...closed,
        phase: "planning",
        plan_review_rounds: rounds,
        failure_reason: null,
      };
    })

    // 実装ができた
    .case(implemented, (state) => ({
      ...state,
      ...closed,
      phase: "dev_review",
      failure_reason: null,
    }))

    // 実装のレビュー
    .case(devReviewed, (state, payload) => {
      const rounds = state.dev_review_rounds + 1;
      if (payload.verdict === "approve") {
        return {
          ...state,
          ...closed,
          phase: "completing",
          dev_review_rounds: rounds,
          failure_reason: null,
        };
      }
      const exceeded = roundLimitReason("dev_review", rounds, settings.limits.dev_review_rounds);
      if (exceeded) {
        return {
          ...state,
          ...closed,
          dev_review_rounds: rounds,
          failure_reason: exceeded,
        };
      }
      return {
        ...state,
        ...closed,
        phase: "developing",
        dev_review_rounds: rounds,
        failure_reason: null,
      };
    })

    // 完了報告。受け入れ条件が全 passed でなければ止まる（人間が確かめて直す / K-2）
    .case(completed, (state, payload) => {
      if (payload.acceptance_passed) {
        return {
          ...state,
          ...closed,
          phase: "done",
          failure_reason: null,
        };
      }
      return {
        ...state,
        ...closed,
        failure_reason: "acceptance_not_passed",
      };
    })

    // 人間の承認。総数も往復も増やさない（A-41）
    .case(humanApproval, (state) => ({
      ...state,
      phase: "developing",
      failure_reason: null,
    }))

    // 人間の差し戻し。本文は middleware がレビューファイルに残す
    .case(humanRequestChanges, (state) => ({
      ...state,
      phase: "planning",
      failure_reason: null,
    }))

    /**
     * 復旧（K-27）。停止の理由を消し、**同じフェーズをやり直す**。
     * 実機で止まる主因は `api_error` と `missing_verdict` で、どちらも同じフェーズの
     * 再実行で直り、計画（planner の $0.7〜1.0 の実行）を捨てずに済む。
     * 「1 つ戻して入力から作り直す」に変えるなら、ここに戻り先を書く。
     */
    .case(retry, (state) => ({
      ...state,
      // 死んだ実行（stale）から戻すときは、実行中の記録も落とす
      // — 残っていると route が「実行中」と見て何もしない（I-8）
      ...closed,
      failure_reason: null,
    }))

    .build();

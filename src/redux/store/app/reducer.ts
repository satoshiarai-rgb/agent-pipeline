import type { Config } from "../../../defaults.ts";
import type { AgentName, Phase } from "../../../types.ts";
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
 * 実行状況（= イベントログの畳み込み）。
 *
 * **`phase` は blocked にならない。** 「止まっている」は `failure_reason` から導出する
 * 状態（`store/selectors.ts`）なので、実行位置は失敗で潰されず、`/agent retry` は
 * そのまま同じフェーズを引き直せる（K-26 / K-27）。
 *
 * **遷移は reducer の中に直接書く。** どの action がどのフェーズをどこへ動かすかは
 * 各 case の `switch` を読めば分かる（表を挟まない）。
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

// ------------------------------------------------------------ 停止の理由の文言
//
// **この文字列は `explain` の案内・`docs/troubleshooting.md` の表・プロンプトが
// 依存している**（K-26 の受け入れ条件）。作る場所をここだけに閉じる。

/** 遷移表に行き先が無い組み合わせ（設定やプロンプトの壊れを黙って通さない） */
const transitionIncomplete = (phase: Phase, event: string): string =>
  `transition_incomplete: ${phase} (${event})`;

/** レビューの往復が上限に達した */
const roundsExceeded = (phase: "plan_review" | "dev_review", used: number, limit: number): string =>
  `${phase}_rounds_exceeded: ${used}/${limit}`;

/** レビューの往復が上限に達していれば理由を返す。達していなければ null */
function roundLimitReason(state: AppState, config: Config): string | null {
  switch (state.phase) {
    case "plan_review":
      return state.plan_review_rounds >= config.limits.plan_review_rounds
        ? roundsExceeded("plan_review", state.plan_review_rounds, config.limits.plan_review_rounds)
        : null;
    case "dev_review":
      return state.dev_review_rounds >= config.limits.dev_review_rounds
        ? roundsExceeded("dev_review", state.dev_review_rounds, config.limits.dev_review_rounds)
        : null;
    default:
      return null;
  }
}

// --------------------------------------------------------------- フェーズの性質

/** エージェントを起動しない phase。連鎖（`[skip ci]` の要否）もこれで決める */
export function isIdle(phase: Phase): boolean {
  switch (phase) {
    case "bootstrap":
    case "awaiting_human":
    case "done":
    case "blocked":
      return true;
    default:
      return false;
  }
}

/** その phase で動かすエージェント。人間が起こす遷移では null */
export function agentFor(phase: Phase): AgentName | null {
  switch (phase) {
    case "planning":
      return "planner";
    case "plan_review":
      return "plan-reviewer";
    case "developing":
      return "developer";
    case "dev_review":
      return "dev-reviewer";
    case "completing":
      return "completion";
    default:
      return null;
  }
}

// -------------------------------------------------------------------- reducer

/**
 * **どの action がどう状態を変えるかの表。** 1 action = 1 case で、遷移先は case の中に
 * 直接書く。`config` を畳み込むのはレビューの往復上限（`limits`）だけ。
 */
export const createAppReducer = (config: Config) =>
  reducerWithInitialState(initialApp)
    // 既存のファイルからの復元（段取り 2 でイベントの再生に置き換わる）
    .case(restore, (state, payload) => ({ ...state, ...payload.app }))

    // 実行の開始。phase は動かさず、数と「実行中」だけを記録する
    .case(agentStarted, (state, payload) => ({
      ...state,
      total_steps: state.total_steps + 1,
      plan_review_rounds: state.plan_review_rounds + (state.phase === "plan_review" ? 1 : 0),
      dev_review_rounds: state.dev_review_rounds + (state.phase === "dev_review" ? 1 : 0),
      in_flight_agent: payload.agent,
      in_flight_run_id: payload.run_id,
      last_reason: "started",
    }))

    // 実行そのものの失敗と契約違反。理由がそのまま停止の理由になる
    .case(agentFailed, (state, payload) => ({
      ...state,
      failure_reason: payload.reason,
      in_flight_agent: null,
      in_flight_run_id: null,
      last_reason: payload.reason,
    }))

    // 成果物が契約を満たした
    .case(agentOk, (state, payload) => {
      const closed = { ...state, in_flight_agent: null, in_flight_run_id: null };
      switch (state.phase) {
        case "planning":
          return { ...closed, phase: "plan_review", failure_reason: null, last_reason: "ok" };
        case "developing":
          return { ...closed, phase: "dev_review", failure_reason: null, last_reason: "ok" };
        case "completing":
          // 受け入れ条件が全 passed でなければ止まる（人間が確かめて直す / K-2）
          return payload.acceptance_passed
            ? { ...closed, phase: "done", failure_reason: null, last_reason: "acceptance_passed" }
            : {
                ...closed,
                failure_reason: "acceptance_not_passed",
                last_reason: "acceptance_not_passed",
              };
        case "plan_review":
        case "dev_review":
          // レビューのフェーズなのに verdict が無い（frontmatter の欠落）
          return { ...closed, failure_reason: "missing_verdict", last_reason: "missing_verdict" };
        default:
          return {
            ...closed,
            failure_reason: transitionIncomplete(state.phase, "ok"),
            last_reason: "ok",
          };
      }
    })

    // レビューの判定。差し戻しは往復の上限を見る（上限に達したら止まる）
    .case(review, (state, payload) => {
      const closed = { ...state, in_flight_agent: null, in_flight_run_id: null };
      if (payload.verdict === "approve") {
        switch (state.phase) {
          case "plan_review":
            // 計画の承認は人間が行う（設計書 §3.1）
            return {
              ...closed,
              phase: "awaiting_human",
              failure_reason: null,
              last_reason: "approve",
            };
          case "dev_review":
            return { ...closed, phase: "completing", failure_reason: null, last_reason: "approve" };
          default:
            return {
              ...closed,
              failure_reason: transitionIncomplete(state.phase, "approve"),
              last_reason: "approve",
            };
        }
      }

      const exceeded = roundLimitReason(state, config);
      if (exceeded) return { ...closed, failure_reason: exceeded, last_reason: exceeded };
      switch (state.phase) {
        case "plan_review":
          return {
            ...closed,
            phase: "planning",
            failure_reason: null,
            last_reason: `request_changes (${state.plan_review_rounds}/${config.limits.plan_review_rounds})`,
          };
        case "dev_review":
          return {
            ...closed,
            phase: "developing",
            failure_reason: null,
            last_reason: `request_changes (${state.dev_review_rounds}/${config.limits.dev_review_rounds})`,
          };
        default:
          return {
            ...closed,
            failure_reason: transitionIncomplete(state.phase, "request_changes"),
            last_reason: "request_changes",
          };
      }
    })

    // 人間の承認。数は増やさない（A-41）
    .case(humanApproval, (state) => {
      switch (state.phase) {
        case "awaiting_human":
          return { ...state, phase: "developing", failure_reason: null, last_reason: "approval" };
        default:
          return {
            ...state,
            failure_reason: transitionIncomplete(state.phase, "approval"),
            last_reason: "approval",
          };
      }
    })

    // 人間の差し戻し。本文は middleware がレビューファイルに残す
    .case(humanRequestChanges, (state) => {
      switch (state.phase) {
        case "awaiting_human":
          return {
            ...state,
            phase: "planning",
            failure_reason: null,
            last_reason: "request_changes",
          };
        default:
          return {
            ...state,
            failure_reason: transitionIncomplete(state.phase, "request_changes"),
            last_reason: "request_changes",
          };
      }
    })

    /**
     * 復旧（K-27）。停止の理由を消し、**同じフェーズをやり直す**。
     * 実機で止まる主因は `api_error` と `missing_verdict` で、どちらも同じフェーズの
     * 再実行で直り、計画（planner の $0.7〜1.0 の実行）を捨てずに済む。
     * 「1 つ戻して入力から作り直す」に変えるなら、ここに `switch` を書く。
     */
    .case(retry, (state) => ({
      ...state,
      failure_reason: null,
      last_reason: `retry: ${state.phase}`,
    }))

    .build();

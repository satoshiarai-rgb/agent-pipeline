import type { AgentName, Verdict } from "../../../types.ts";
import actionCreatorFactory from "../../../utils/typescriptFsa.ts";

/**
 * 実行状況を動かす action（FSA）。**型定義と creator だけを置き、判断は持たない。**
 *
 * type は `actionCreatorFactory` の prefix によって `agent-pipeline/app/<TYPE>` になる
 * （ducks の MUST）。この文字列はイベントログにそのまま永続化される。
 *
 * **「止まる」は action ではない。** `blocked` は失敗や上限といった別の action から
 * 導出される状態なので、ここには「何が起きたか」だけが並ぶ（K-26）。
 * **エージェントの終了はフェーズごとに別の action** にしてあり、reducer 側に
 * phase の分岐を持たない。
 */

/** すべての action に載る「いつ・誰が」。人間の介入も同じ形で記録する */
export interface Origin {
  /** ISO 基本形式（20260907T054512Z）。イベントのファイル名の先頭になる */
  timestamp: string;
  /** "harness" か "human:<author_association>" */
  by: string;
}

/** エージェント実行 1 回は「開始」と「終了」の 2 つの action で表す */
interface Run {
  run_id: string;
  attempt: number;
}

export interface AgentStartedPayload extends Origin, Run {
  agent: AgentName;
  model: string;
}

/** 成果物が契約を満たした（計画・実装のフェーズ） */
export interface DonePayload extends Origin, Run {
  session_id?: string | null;
}

/** レビュアーの判定 */
export interface ReviewedPayload extends Origin, Run {
  verdict: Verdict;
  session_id?: string | null;
}

/** 完了報告。受け入れ条件が全 passed かどうかで done か停止かが決まる */
export interface CompletedPayload extends Origin, Run {
  session_id?: string | null;
  acceptance_passed: boolean;
}

/** 実行そのものの失敗と契約違反。reason がそのまま停止の理由になる */
export interface AgentFailedPayload extends Origin, Run {
  reason: string;
  api_error_status?: number | null;
  session_id?: string | null;
}

export interface HumanRequestChangesPayload extends Origin {
  body: string;
}

/** app スライスの action の payload をまとめたもの（middleware が引数に取る） */
export type AppPayload =
  | AgentStartedPayload
  | DonePayload
  | ReviewedPayload
  | CompletedPayload
  | AgentFailedPayload
  | HumanRequestChangesPayload
  | Origin;

const create = actionCreatorFactory("agent-pipeline/app");

export const agentStarted = create<AgentStartedPayload>("AGENT_STARTED");

/**
 * **フェーズごとに action を分けている。** 1 action = 1 遷移になるので reducer に
 * phase の分岐が要らず、イベントログも「何が起きたか」で読める（K-26）。
 */
export const planned = create<DonePayload>("PLANNED");
export const planReviewed = create<ReviewedPayload>("PLAN_REVIEWED");
export const implemented = create<DonePayload>("IMPLEMENTED");
export const devReviewed = create<ReviewedPayload>("DEV_REVIEWED");
export const completed = create<CompletedPayload>("COMPLETED");
/** 第 3 引数の true が FSA の `error: true` を立てる */
export const agentFailed = create<AgentFailedPayload>("AGENT_FAILED", undefined, true);
export const humanApproval = create<Origin>("HUMAN_APPROVAL");
export const humanRequestChanges = create<HumanRequestChangesPayload>("HUMAN_REQUEST_CHANGES");
export const retry = create<Origin>("RETRY");

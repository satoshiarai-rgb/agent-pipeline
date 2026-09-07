import type { AgentName, Verdict } from "../../../types.ts";
import actionCreatorFactory from "../../../utils/typescript-fsa.ts";

/**
 * 実行状況を動かす action（FSA）。**型定義と creator だけを置き、判断は持たない。**
 *
 * type は `actionCreatorFactory` の prefix によって `agent-pipeline/app/<TYPE>` になる
 * （ducks の MUST）。この文字列はイベントログにそのまま永続化される。
 *
 * **「止まる」は action ではない。** `blocked` は失敗や上限といった別の action から
 * 導出される状態なので、ここには「何が起きたか」だけが並ぶ（K-26）。
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

/** 成果物が契約を満たした。completing では acceptance_passed も見る */
export interface AgentOkPayload extends Origin, Run {
  session_id?: string | null;
  acceptance_passed?: boolean;
}

export interface ReviewPayload extends Origin, Run {
  verdict: Verdict;
  session_id?: string | null;
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

/** 7 つの action の payload をまとめたもの（middleware が引数に取る） */
export type AppPayload =
  | AgentStartedPayload
  | AgentOkPayload
  | ReviewPayload
  | AgentFailedPayload
  | HumanRequestChangesPayload
  | Origin;

const create = actionCreatorFactory("agent-pipeline/app");

export const agentStarted = create<AgentStartedPayload>("AGENT_STARTED");
export const agentOk = create<AgentOkPayload>("AGENT_OK");
export const review = create<ReviewPayload>("REVIEW");
/** 第 3 引数の true が FSA の `error: true` を立てる */
export const agentFailed = create<AgentFailedPayload>("AGENT_FAILED", undefined, true);
export const humanApproval = create<Origin>("HUMAN_APPROVAL");
export const humanRequestChanges = create<HumanRequestChangesPayload>("HUMAN_REQUEST_CHANGES");
export const retry = create<Origin>("RETRY");

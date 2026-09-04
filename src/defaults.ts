import type { AgentName, Phase, RoundKey } from "./types.ts";

/** 遷移表の 1 エントリ。エージェントが起こす辺と人間が起こす辺の両方を持つ */
interface TransitionEntry {
  /** 無ければエージェントを起動しない（人間が起こす遷移） */
  agent?: AgentName;
  round_key?: RoundKey;
  on_ok?: Phase;
  on_approve?: Phase;
  on_request_changes?: Phase;
  on_pass?: Phase;
  on_fail?: Phase;
  /** 人間の承認で進む先 */
  on_approval?: Phase;
  /** 人間の差し戻しをどちらのレビューとして残すか */
  review_kind?: "plan" | "dev";
}

export interface Config {
  pipeline_version: number;
  models: { default: string; reviewer: string | null };
  limits: Record<"plan_review_rounds" | "dev_review_rounds" | "total_steps", number>;
  tool_profiles: Record<string, string>;
  agents: Record<AgentName, { max_turns: number; timeout_minutes: number; tools: string }>;
  approvers: string[];
  labels: { prefix: string; trigger: string };
  transitions: Partial<Record<Phase, TransitionEntry>>;
}

/**
 * ハーネスの既定値。データファイルではなくコードとして持つ:
 *   - 説明のコメントを書ける（JSON には書けない）
 *   - 型チェックが効く（遷移表の phase 名の誤字を tsc が見つける）
 *   - YAML パーサが不要になり、バンドルが 248KB → 15KB になった
 * 配布先の `.agent/config.json` による上書き（深いマージ）は Step B-5 で実装する（A-19）。
 */
export const defaults: Config = {
  /** 中央リポジトリのメジャー版。合わない run は blocked にする */
  pipeline_version: 1,

  models: {
    default: "claude-opus-5",
    /** null なら default と同じ。生成とレビューでモデルを分けたいときに指定する（設計書 §3.3） */
    reviewer: null,
  },

  limits: {
    plan_review_rounds: 3,
    dev_review_rounds: 3,
    /**
     * 自走ループの最終防波堤。正常系は 5〜8 実行で終わる。
     * ラウンド上限（3 + 3）から到達しうる最悪は 13 実行
     * （planner 3 + plan-reviewer 3 + developer 3 + dev-reviewer 3 + completion 1）。
     * それより上に置くのは、止まった理由が「どのレビューが収束しなかったか」として
     * 残るようにするため。ここで先に止まると総数しか分からない
     */
    total_steps: 16,
  },

  /**
   * ツールは 2 プロファイルに寄せる（A-30）。エージェントごとに集合を変えると
   * プロンプトキャッシュのプレフィックスが分かれるため。
   * `--tools` は利用可能なツールを絞る指定で、実測でコンテキストからも消える（V-15）。
   */
  tool_profiles: {
    readonly: "Read,Glob,Grep,Write",
    exec: "Read,Glob,Grep,Write,Edit,Bash",
  },

  agents: {
    planner: { max_turns: 25, timeout_minutes: 20, tools: "readonly" },
    "plan-reviewer": { max_turns: 15, timeout_minutes: 15, tools: "readonly" },
    developer: { max_turns: 40, timeout_minutes: 45, tools: "exec" },
    "dev-reviewer": { max_turns: 20, timeout_minutes: 20, tools: "exec" },
    completion: { max_turns: 15, timeout_minutes: 15, tools: "exec" },
  },

  /**
   * /approve と /request-changes を受け付ける author_association。
   * 個人アカウント配下では MEMBER が返らないため COLLABORATOR を使う（K-1）
   */
  approvers: ["OWNER", "COLLABORATOR"],

  /**
   * issue ラベルは状態の射影（設計書 §2.3）。ラベル操作の失敗は状態を壊さない。
   * trigger はパイプラインを起動するラベルで、bootstrap が成功したら外す。
   */
  labels: {
    prefix: "agent:",
    trigger: "agent:go",
  },

  /**
   * 遷移表。エージェントが起こす辺と人間が起こす辺をすべてここに集約する。
   * agent を持たないエントリはエージェントを起動しない。
   * done は終端で、辺を持たない（K-10: 作り直しが必要なら新しい issue を立てる）。
   */
  transitions: {
    planning: { agent: "planner", on_ok: "plan_review" },
    plan_review: {
      agent: "plan-reviewer",
      round_key: "plan_review",
      on_approve: "awaiting_human",
      on_request_changes: "planning",
    },
    developing: { agent: "developer", on_ok: "dev_review" },
    dev_review: {
      agent: "dev-reviewer",
      round_key: "dev_review",
      on_approve: "completing",
      on_request_changes: "developing",
    },
    completing: { agent: "completion", on_pass: "done", on_fail: "blocked" },
    /** 人間のコメントで進む/戻る（設計書 §6.5） */
    awaiting_human: {
      on_approval: "developing",
      on_request_changes: "planning",
      review_kind: "plan",
    },
  },
};

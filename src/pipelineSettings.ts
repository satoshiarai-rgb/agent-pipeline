import type { AgentName } from "./types.ts";

export interface PipelineSettings {
  pipeline_version: number;
  models: { default: string; reviewer: string | null };
  limits: Record<"plan_review_rounds" | "dev_review_rounds" | "total_steps", number>;
  tool_profiles: Record<string, string>;
  agents: Record<AgentName, { max_turns: number; timeout_minutes: number; tools: string }>;
  approvers: string[];
  labels: { prefix: string; trigger: string };
}

/**
 * ハーネスの既定値。データファイルではなくコードとして持つ:
 *   - 説明のコメントを書ける（JSON には書けない）
 *   - 型チェックが効く（遷移表の phase 名の誤字を tsc が見つける）
 *   - YAML パーサが不要になり、バンドルが 248KB → 15KB になった
 * 配布先の `.agent/config.json` による上書きは `src/file/configFile.ts` が重ねる（A-19）。
 * 上書きできるキーと規則は `src/utils/mergeSettings.ts` の `OVERRIDABLE` が正。
 * **フェーズの遷移はここに無い** — 状態機械は中央のもので配布先が変えられてはならないので、
 * `src/redux/store/app/reducer.ts` の各 case が直接持つ（K-26）。
 */
export const defaultSettings: PipelineSettings = {
  /**
   * 中央リポジトリのメジャー版。合わない run は blocked にする。
   * 2 にしたのは状態の正を `state.json` からイベントログに移したため（K-26 / A-53 段取り 2）。
   * 版 1 で始まった run は `events/` を持たないので、続けると状態を失う
   */
  pipeline_version: 2,

  models: {
    default: "claude-opus-5",
    /** null なら default と同じ。生成とレビューでモデルを分けたいときに指定する（設計書 §3.3） */
    reviewer: null,
  },

  limits: {
    plan_review_rounds: 5,
    dev_review_rounds: 5,
    /**
     * 自走ループの最終防波堤。正常系は 5〜8 実行で終わる。
     * ラウンド上限（5 + 5）から到達しうる最悪は 21 実行
     * （planner 5 + plan-reviewer 5 + developer 5 + dev-reviewer 5 + completion 1）。
     * それより上に置くのは、止まった理由が「どのレビューが収束しなかったか」として
     * 残るようにするため。ここで先に止まると総数しか分からない
     */
    total_steps: 24,
  },

  /**
   * ツールは 2 プロファイルに寄せる（A-30）。エージェントごとに集合を変えると
   * プロンプトキャッシュのプレフィックスが分かれるため。
   * `--tools` は利用可能なツールを絞る指定で、実測でコンテキストからも消える（V-15）。
   */
  tool_profiles: {
    readonly: "Read,Glob,Grep,Write",
    /**
     * planner だけ `Task`（サブエージェント）を持つ。計画を作る過程で
     * **計画者と回答者を自分の中で往復させる**ため（grilling / A-58）。
     * 3 プロファイルにしたのは、レビュアーに使わない道具を見せないため（A-30 の趣旨は保つ）
     */
    plan: "Read,Glob,Grep,Write,Task",
    exec: "Read,Glob,Grep,Write,Edit,Bash",
  },

  /**
   * max_turns は実測に合わせている（2026-09-07、compass-wiki issue #7）。
   * base-action は実行後に num_turns > max_turns を検査して**失敗**にするため、
   * 上限が足りないと完成した成果物ごと agent_failed になる。実測は
   * planner 18〜22 / plan-reviewer 13〜15 / developer 43。
   */
  agents: {
    planner: { max_turns: 35, timeout_minutes: 20, tools: "plan" },
    "plan-reviewer": { max_turns: 25, timeout_minutes: 15, tools: "readonly" },
    developer: { max_turns: 60, timeout_minutes: 45, tools: "exec" },
    "dev-reviewer": { max_turns: 30, timeout_minutes: 20, tools: "exec" },
    completion: { max_turns: 20, timeout_minutes: 15, tools: "exec" },
  },

  /**
   * /approve と /request-changes を受け付ける author_association。
   * 個人アカウント配下では MEMBER が返らないため COLLABORATOR を使う（K-1）
   */
  approvers: ["OWNER", "COLLABORATOR"],

  /**
   * issue ラベルは状態の射影（設計書 §2.3）。ラベル操作の失敗は状態を壊さない。
   * trigger はパイプラインを起動するラベルで、bootstrap が成功したら外す。
   * **配布先から上書きできない**（起動ラベルは配布先のラッパーの `if:` に直書きなので、
   * ここだけ変えても効かず、prefix を変えると起動ラベルが外れなくなる / A-55）。
   */
  labels: {
    prefix: "agent:",
    trigger: "agent:go",
  },
};

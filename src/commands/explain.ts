import type { Config } from "../defaults.ts";
import { hasAcceptance, readAcceptance } from "../file/acceptance-file.ts";
import { selectBlocked } from "../redux/selectors.ts";
import type { RootState } from "../redux/state.ts";

/**
 * 止まった理由と次の一手を markdown で返す（`blocked` になったとき PR に貼る）。
 *
 * 設計書 §5.5 の「`blocked` になったら理由と復旧方法を人間に届ける」の実体。
 * 状態を読むだけで何も書かないので、ワークフローは出力をコメントするだけでよい。
 */

/** 案内を組み立てるのに使える情報 */
interface Context {
  dir: string;
  reason: string;
}

/**
 * 理由ごとの案内。**上から順に最初に一致したものを使う**。
 * `blocked_reason` の文字列は finish が組み立てるものと 1 対 1 に対応する。
 */
interface Advice {
  /** blocked_reason のどの部分に反応するか */
  when: string;
  title: string;
  /** markdown の本文。番号付きの手順を返す */
  body: (c: Context) => string;
}

/** 未達の受け入れ条件を表にする。人間が「何を確かめればよいか」を読めるように */
function pendingCriteria(dir: string): string {
  if (!hasAcceptance(dir)) return "";
  const rows = readAcceptance(dir)
    .criteria.filter((c) => c.status !== "passed")
    .map(
      (c) => `| \`${c.id}\` | ${c.verification} | ${c.description} | ${c.evidence ?? "（なし）"} |`,
    );
  if (rows.length === 0) return "";
  return [
    "",
    "未達の受け入れ条件:",
    "",
    "| id | 検証 | 内容 | いまの evidence |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const retryLine = "PR に `/agent retry` とコメントする（直前のフェーズからやり直します）";

const ADVICE: Advice[] = [
  {
    when: "acceptance_not_passed",
    title: "受け入れ条件が全て `passed` になっていません",
    body: ({ dir }) =>
      `${pendingCriteria(dir)}
**\`manual\` の項目は人間が確認します。** 手順は次のとおりです。

1. 条件の内容を実際に確かめる（エージェントが代替検証をしている場合は \`evidence\` に何をどこまで確認したかが書かれています）
2. \`${dir}/acceptance.json\` の該当項目を \`"status": "passed"\` にし、\`"evidence"\` に**何をどう確認したか**を書く（空のままだと契約違反で再び止まります）
3. その変更を作業ブランチに push する
4. ${retryLine}

\`automated\` の項目が未達なら、まず \`command\` を手元で走らせて原因を見てください。
実装を直す必要がある場合は \`/agent retry\` では completing に戻るだけなので、
\`${dir}/state.json\` の \`phase\` を \`developing\` にして push してください。`,
  },
  {
    when: "invalid_artifacts",
    title: "成果物が契約を満たしていません",
    body: ({ dir }) =>
      `理由は上の \`blocked_reason\` に出ています（\`work/agent-contract.md\` §4 の検証列に対応します）。

1. 足りない成果物を確かめる（\`${dir}/\` の中身）
2. プロンプトや設定に原因があれば直す
3. ${retryLine}`,
  },
  {
    when: "missing_verdict",
    title: "レビューに `verdict` がありません",
    body: ({ dir }) =>
      `ハーネスはレビューの frontmatter の \`verdict\`（\`approve\` か \`request_changes\`）だけを見て遷移を決めます。

1. \`${dir}/reviews/\` の最新のファイルを見る
2. 人間が判断を入れるなら frontmatter を直して push する
3. レビュアーにやり直させるなら ${retryLine}`,
  },
  {
    when: "api_error",
    title: "API のエラーで止まりました",
    body: () =>
      `ステータスが \`blocked_reason\` に出ています（429 なら使用量の上限、404 ならモデル名などの設定ミス）。

1. 設定ミスなら直す。使用量なら時間を置く
2. ${retryLine}`,
  },
  {
    when: "agent_failed",
    title: "エージェントの実行そのものが失敗しました",
    body: () =>
      `Actions の run のログ（\`##[error]\` の行）に原因が出ています。

1. ログを読む。タイムアウトやツールの許可漏れなら設定を直す
2. ${retryLine}`,
  },
  {
    when: "_exceeded",
    title: "上限に達しました",
    body: () =>
      `**\`/agent retry\` は受け付けません。** やり直しても同じ理由で止まるためです。

- レビューが収束していないなら、**issue を分けて立て直す**のが正しい対処です（同一 issue の 2 周目は行いません）
- 上限そのものを変えるなら、中央の \`src/defaults.ts\` の \`limits\` を直します`,
  },
  {
    when: "config_invalid",
    title: "`.agent/config.json` を受け付けられません",
    body: ({ dir }) =>
      `どのキーがどう違うかは上の \`blocked_reason\` に出ています。**設定は一部だけ適用せず全体を捨てる**ので、
直すまで中央の既定で動くことはありません（どの設定で動いたのか分からなくなるのを避けるため）。

1. \`.agent/config.json\` を直す。書いたキーだけが上書きされ、\`null\` は「既定を継承」、既定に無いキーはエラーになります
2. その変更を作業ブランチに push する
3. ${retryLine}

やり直せない（\`/agent retry\` が「レコードが無い」と返す）場合は、\`${dir}/state.json\` の
\`phase\` を止まる前のフェーズ（最初なら \`planning\`）に戻して push してください。`,
  },
  {
    when: "pipeline_version_mismatch",
    title: "中央リポジトリの版が合いません",
    body: () =>
      `進行中の run を壊さないための停止です。**この停止は状態から毎回導かれる**ので、
版が揃った時点で解け、続きから動きます（\`/agent retry\` も要りません）。

1. 配布先が参照している中央のタグと、run の \`pipeline_version\` を揃える
2. 作業ブランチに何か push する（または \`/agent retry\` とコメントする）`,
  },
];

const FALLBACK: Advice = {
  when: "",
  title: "止まりました",
  body: ({ dir }) =>
    `1. \`${dir}/state.json\` の \`blocked_reason\` と Actions のログを読む
2. 原因を直す
3. ${retryLine}`,
};

/**
 * `blocked` の理由に応じた案内を markdown で返す。
 * blocked でなければ null（呼び出し側はコメントしない）。
 */
export function explainRun(
  root: RootState,
  dir: string,
  config: Config,
  config_error: string | null = null,
): { markdown: string; reason: string } | null {
  const blocked = selectBlocked(root, config, config_error);
  if (!blocked.blocked || blocked.reason === null) return null;

  const reason = blocked.reason;
  const advice = ADVICE.find((a) => reason.includes(a.when)) ?? FALLBACK;
  const context: Context = { dir, reason };

  return {
    reason,
    markdown: `## 止まりました: ${advice.title}

\`\`\`
blocked_reason: ${reason}
\`\`\`

${advice.body(context)}`,
  };
}

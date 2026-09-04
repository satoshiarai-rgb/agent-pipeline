# run ディレクトリのファイル

`agent-work/issue-<n>/` に作られるファイルの説明。書くのはハーネスだけで、
エージェントは `state.json` と `runs/` を書かない（設計書 §7.1）。

| ファイル | 書く主体 | 内容 |
|---|---|---|
| `state.json` | ハーネス | run の状態。可変値は `phase` と `blocked_reason` だけ |
| `runs/<agent>-<run_id>-<attempt>.json` | ハーネス | 1 実行 1 ファイルの追記専用レコード。`total_steps` と `rounds` はこの数から導出する（A-33） |
| `plan.md` / `acceptance.json` | planner | 計画と受け入れ条件 |
| `reviews/plan-NN.md` / `reviews/dev-NN.md` | レビュアー / 人間 | frontmatter の `verdict` だけがハーネスの遷移判断に使われる |
| `decisions.md` | developer | 実装中の判断（追記のみ） |
| `completion.md` | completion | 完了報告 |
| `log.md` | ハーネス | `runs/` を時刻順に連結した読み物（completing で生成 / A-34） |

## blocked からの復旧

`state.json` の `phase` を戻したい地点に書き換えて push すれば再開する。
`agent-work/**` の変更で dispatch が起動するため、それ以外の操作は不要。

`phase` に入る値: `bootstrap` / `planning` / `plan_review` / `awaiting_human` /
`developing` / `dev_review` / `completing` / `done` / `blocked`

`blocked_reason` の例: `plan_review_rounds_exceeded: 2/2`、`api_error:429`、
`total_steps_exceeded: 12/12`、`invalid_artifacts`

JSON にはコメントを書けないため、この説明をファイルの外に置いている。
`blocked` になったときは issue コメントにも同じ復旧手順を投稿する。

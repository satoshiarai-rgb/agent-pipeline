# run ディレクトリのファイル

`agent-work/issue-<n>/` に作られるファイルの説明。書くのはハーネスだけで、
エージェントは `state.json` と `runs/` を書かない（設計書 §7.1）。

| ファイル | 書く主体 | 内容 |
|---|---|---|
| `state.json` | ハーネス | run の状態。可変値は `phase` と `blocked_reason` だけ |
| `runs/<agent>-<run_id>-<attempt>.json` | ハーネス | 1 実行 1 ファイルの追記専用レコード。`total_steps` と `rounds` はこの数から導出する（A-33） |
| `plan.md` / `acceptance.json` | planner | 計画と受け入れ条件 |
| `reviews/plan-NN.md` / `reviews/dev-NN.md` | レビュアー / 人間 | frontmatter の `verdict` だけがハーネスの遷移判断に使われる |
| `decision-records.jsonl` | developer | 実装中の判断。1 行 1 レコードの JSON（追記のみ） |
| `completion.md` | completion | 完了報告 |
| `log.md` | ハーネス | `runs/` を時刻順に連結した読み物（completing で生成 / A-34） |

## blocked からの復旧

**まず理由（`blocked_reason`）を読んで原因を直し、PR に `/agent retry` とコメントする。**
直前に走っていたフェーズ（`runs/` の最新レコードの `phase`）に戻して再実行する。

受け付けないのは次の 3 つで、いずれも理由が PR に返る。

- `blocked` 以外の phase（取り違えを黙って進めない）
- 上限で止まったもの（`*_exceeded`）。やり直しても同じ理由で止まるので、issue を分けて立て直す
- 実行の記録が無いもの（戻る先が決まらない）
- 直前のレコードが閉じていないもの（`finished_at` が `null`）。実行中か、途中で落ちて記録が
  閉じられていない状態。戻しても `route` が「実行中」と見て動かさないため、断る

別のフェーズから始めたいときや、`pipeline_version_mismatch` で止まったとき（走る前のフェーズが
state から失われている）は、`state.json` の `phase` を書き換えて push する。
`agent-work/**` の変更で dispatch が起動するため、それ以外の操作は不要。

`phase` に入る値: `bootstrap` / `planning` / `plan_review` / `awaiting_human` /
`developing` / `dev_review` / `completing` / `done` / `blocked`

`blocked_reason` の例: `plan_review_rounds_exceeded: 5/5`、`api_error:429`、
`total_steps_exceeded: 24/24`、`invalid_artifacts: plan.md が無いか空`

JSON にはコメントを書けないため、この説明をファイルの外に置いている。
`blocked` になったときは issue コメントにも同じ復旧手順を投稿する。

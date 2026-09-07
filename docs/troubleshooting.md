# 止まったとき

パイプラインが進まない、あるいは思ったとおりに動かないときに見るところです。

まず現在地を確認してください。**正しいのは作業ブランチ上の `agent-work/issue-<n>/state.json`**
で、issue のラベルはその写しです（ラベルの付け替えに失敗しても進行そのものには影響しません）。

```bash
gh pr checkout <PR 番号>
cat agent-work/issue-<n>/state.json
```

## `blocked` になった

続けられないと判断して止まった状態です。**止まった理由と次の手順は、その場で PR に
コメントされます。** まずそれを読んでください（`state.json` の `blocked_reason` にも同じ理由が
入り、Actions の run も赤くなります）。

原因を直したら、PR に `/agent retry` とコメントすれば直前のフェーズからやり直します。

| `blocked_reason` | 意味 | 対処 |
|---|---|---|
| `invalid_artifacts: <詳細>` | 成果物が決められた形式を満たしていない（`plan.md` が空、`acceptance.json` の形式違反、実装の差分が空 など） | 詳細を読み、原因を直して `/agent retry` |
| `missing_verdict` | レビューに `approve` / `request_changes` の判定が無い | `reviews/` の最新ファイルの frontmatter を直して push するか、`/agent retry` でレビューをやり直す |
| `acceptance_not_passed` | 受け入れ条件に `passed` でないものが残っている | `manual` の項目はあなたが確認し、`acceptance.json` の `status` と `evidence` を直して push してから `/agent retry`。PR コメントに未達の項目が表で出ます |
| `plan_review_rounds_exceeded: 5/5` | 計画レビューが規定の往復で収束しなかった | **`/agent retry` は受け付けません**（やり直しても同じ理由で止まるため）。`reviews/plan-*.md` を読んで争点をあなたが決め、`plan.md` に反映して承認待ちへ進めるのが早い |
| `dev_review_rounds_exceeded: 5/5` | 実装レビューが収束しなかった | 同上。`reviews/dev-*.md` を読む |
| `agent_failed` | エージェントの実行が失敗した、またはタイムアウトした | Actions のログ（`##[error]` の行）を読む。一時的な失敗なら `/agent retry` で進みます |
| `total_steps_exceeded: 24/24` | 実行回数の総数が上限に達した | 往復が多すぎます。issue を分割して立て直すことを検討してください |
| `api_error:429` など | Claude API のエラー（429 は使用量の上限、404 はモデル名などの設定ミス） | 設定ミスなら直す。使用量なら時間をおいて `/agent retry` |
| `pipeline_version_mismatch: run=1 harness=2` | パイプライン本体が更新され、進行中の作業と噛み合わなくなった | `/agent retry` では戻れません（走る前のフェーズが失われているため）。`state.json` の `phase` を手で書き換えるか、issue を立て直します |

### `/agent retry` が断られたとき

`/agent retry` は次の場合に受け付けず、理由を PR に返します。

| 返ってくる理由 | 意味 |
|---|---|
| `not_blocked: phase=...` | 止まっていません。取り違えを黙って進めないための拒否です |
| `limit_reached: ...` | 上限で止まったものです。やり直しても同じ理由で止まります |
| `no_records: ...` | 実行の記録が無く、戻る先が決まりません |
| `run_in_progress: <agent> run=<id>` | 直前の実行の記録が閉じていません（下記） |

**`run_in_progress` が返る場合**、その実行の記録が `finished_at: null` のまま残っています。
実行が job のタイムアウトやキャンセルで死んだときに起きます。まだ動いている可能性があるので、
Actions でその run が終わっていることを確かめてから、次の 2 つを 1 コミットで push してください。

1. `runs/<agent>-<run_id>-<attempt>.json` の `finished_at` に時刻を入れ、`result` を `agent_failed` にする
2. `state.json` の `phase` をそのレコードの `phase` に戻し、`blocked_reason` を `null` にする

### 手で再開する

別のフェーズから始めたいときは、`state.json` の `phase` を書き換えて push します。
`agent-work/**` への push が次のフェーズを起動します。

```bash
gh pr checkout <PR 番号>
# state.json の "phase": "blocked" を "planning" などに書き換える
git commit -am "agent: retry planning"
git push
```

`phase` に入る値: `bootstrap` / `planning` / `plan_review` / `awaiting_human` /
`developing` / `dev_review` / `completing` / `done` / `blocked`
（戻す先に使うのは `planning` から `completing` までのいずれかです）

`blocked_reason` は書き換えなくてかまいません（次の実行で上書きされます）。

**往復の上限に達して止まった場合、同じフェーズに戻すとまたすぐ止まります。** 争点をあなたが
決めて成果物に反映してから、その先のフェーズに進めてください。

## 進まない・動かない

| 症状 | 見るところ |
|---|---|
| ラベルを付けても何も起きない | ラベル名が `agent:go` と一致しているか。ラベルを付けた人にリポジトリへの push 権限があるか（無い場合は何もせずに終了します）。Actions が有効か |
| draft PR はできたが、そこから進まない | `agent-work/**` への push で run が起動しているか。パイプライン自身が打つコミットには `[skip ci]` が付くことがありますが、これは実行の開始と終端の記録なので正常です |
| コメントが効かない | **PR 側**にコメントしているか（issue 側は見ていません）。先頭が `/agent ` で始まっているか。使えるのは `/agent approve` / `/agent request-changes <理由>` / `/agent retry` の 3 つで、受け付けなかった場合は PR にその旨が返信されます |
| 差し戻したのに同じ計画が返ってくる | `/agent request-changes` に理由を書いているか。理由がそのまま次の計画の入力になります |
| 中身の無い run が並ぶ | 起動条件に合わないイベント（`agent:go` 以外のラベル、`/agent` 以外のコメント）でも run 自体は作られます。全ジョブが skipped なら無害です |
| 認証で失敗する | `AGENT_APP_CLIENT_ID` に数値の App ID を入れていないか（正しくは `Iv23li...` の Client ID）。App が**あなたのリポジトリと本体の両方**にインストールされているか |
| ワークフローが見つからない | agent-pipeline 本体が private になっていないか |
| 実装が既存のファイルを壊した | PR の差分で確認できます。差し戻しではなく、そのまま通常の PR レビューとして修正を依頼するか、PR を閉じて issue を立て直してください |

## PR に「規模超過の警告」が付いた

1 PR あたりの目安（5〜10 ファイル）を超えると planner が判断した、という通知です。
**作業は止まりません。** 判断の根拠は `plan.md` の「規模判定」にあります。分割するなら
PR を閉じて issue を分け直し、そのまま進めるなら何もしなくてかまいません。

## 作業ディレクトリのファイル

`agent-work/issue-<n>/` に何があるかの一覧です。

| ファイル | 書く主体 | 内容 |
|---|---|---|
| `state.json` | パイプライン | 現在の状態。人が触ってよいのは `phase` です |
| `runs/<agent>-<run_id>-<attempt>.json` | パイプライン | 1 実行 1 ファイルの記録。往復回数はこの数から数えます |
| `issue.md` | パイプライン | 起点になった issue 本文の写し |
| `plan.md` / `acceptance.json` | planner | 計画と受け入れ条件 |
| `reviews/plan-NN.md` / `reviews/dev-NN.md` | レビュアー、または差し戻したあなた | 先頭の `verdict` だけが進行の判断に使われ、本文は次のエージェントへの入力になります |
| `decision-records/<run_id>-<attempt>-<slug>.md` | developer | 実装中の判断。判断 1 つにつき 1 ファイル |
| `completion.md` | completion | 完了報告 |

エージェントは `state.json` と `runs/` を書きません。状態を書くのはパイプラインだけで、
だからこそエージェントが途中でクラッシュしても状態が食い違いません。

## それでも分からないとき

`runs/` の各レコードに、どのエージェントを・どのモデルで・どのプロンプトで動かし、
どういう結果になったかが残っています。Actions の該当 run のログと合わせて読んでください。
run のサマリーには、そのフェーズで何を判断したかが 1 行ずつ出ます。

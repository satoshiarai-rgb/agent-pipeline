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
| `config_invalid: <詳細>` | `.agent/config.json` の上書きを受け付けられなかった（既定に無いキー、型違い、1 未満の数値 など） | 詳細に**どのキーがどう違うか**が出ます。直して push してから `/agent retry`（記録がまだ無い最初の実行で止まった場合は `state.json` の `phase` を `planning` に戻して push）。設定は一部だけ適用せず全体を捨てるので、直すまで既定で動くことはありません |
| `pipeline_version_mismatch: run=1 harness=2` | パイプライン本体が更新され、進行中の作業と噛み合わなくなった | 参照している本体のタグと run の `pipeline_version` を揃えれば、そのまま続きから動きます（この停止は状態から毎回導かれるので、揃った時点で解けます） |

### `/agent retry` が断られたとき

`/agent retry` は次の場合に受け付けず、理由を PR に返します。

| 返ってくる理由 | 意味 |
|---|---|
| `not_authorized: <association>` | コメントした人にこの操作の権限がありません（承認と同じ権限が必要です） |
| `not_blocked: phase=...` | 止まっていません。取り違えを黙って進めないための拒否です |
| `limit_reached: ...` | 上限で止まったものです。やり直しても同じ理由で止まります |
| `run_in_progress: <agent> run=<id>` | まだ実行中です（開始からジョブの上限を過ぎていません。下記） |

### 実行が死んで止まったとき（run が無音で進まない）

job のタイムアウトやキャンセルで実行が死ぬと、開始のイベントだけが残り、誰も次を書きません。
この状態は `blocked` にはならない（失敗のイベントが無いため）ので、ラベルは実行中のフェーズの
ままです。

**開始からジョブの上限（そのエージェントの上限 + 10 分。planner なら 30 分、developer なら
55 分）を過ぎていれば、`/agent retry` がそのまま受け付けます。** 同じフェーズを最初から
やり直し、実行中の記録は落ちます。

上限より前に戻したい場合（Actions でその run が死んでいると確認できたとき）は、`events/` に
「その実行が失敗した」イベントを 1 件足して push してください（直前の開始イベントと同じ
`run_id` / `attempt` を書く）。次の run が畳み込み直して `blocked` になり、`/agent retry`
で再開できます。

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
| 実行が始まったのに戻ってこない | Actions でその run がタイムアウト・キャンセルで死んでいないか。死んでいれば、開始からジョブの上限を過ぎた時点で `/agent retry` で戻せます（上の「実行が死んで止まったとき」） |
| コメントが効かない | **PR 側**にコメントしているか（issue 側は見ていません）。先頭が `/agent ` で始まっているか。使えるのは `/agent approve` / `/agent request-changes <理由>` / `/agent retry` の 3 つで、受け付けなかった場合は PR にその旨が返信されます |
| 差し戻したのに同じ計画が返ってくる | `/agent request-changes` に理由を書いているか。理由がそのまま次の計画の入力になります |
| 中身の無い run が並ぶ | 起動条件に合わないイベント（`agent:go` 以外のラベル、`/agent` 以外のコメント）でも run 自体は作られます。全ジョブが skipped なら無害です |
| 認証で失敗する | `AGENT_APP_CLIENT_ID` に数値の App ID を入れていないか（正しくは `Iv23li...` の Client ID）。App が**そのリポジトリ**にインストールされているか（agent-pipeline 本体へのインストールは不要です） |
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
| `events/<連番>-<時刻>-<run_id>-<attempt>-<種類>.json` | パイプライン | **状態の正。** 起きたことを 1 イベント 1 ファイルで追記します（実行の開始と終了、人間の承認・差し戻し・retry）。往復回数もここから数えます |
| `issue.md` | パイプライン | 起点になった issue 本文の写し |
| `plan.md` / `acceptance.json` | planner | 計画と受け入れ条件 |
| `reviews/plan-NN.md` / `reviews/dev-NN.md` | レビュアー、または差し戻したあなた | 先頭の `verdict` だけが進行の判断に使われ、本文は次のエージェントへの入力になります |
| `decision-records/<run_id>-<attempt>-<slug>.md` | developer | 実装中の判断。判断 1 つにつき 1 ファイル |
| `completion.md` | completion | 完了報告 |

エージェントは `events/` と `state.json` を書きません。状態を書くのはパイプラインだけで、
だからこそエージェントが途中でクラッシュしても状態が食い違いません。

## それでも分からないとき

`events/` の各イベントに、どのエージェントを・どのモデルで動かし、
どういう結果になったかが残っています。Actions の該当 run のログと合わせて読んでください。
run のサマリーには、そのフェーズで何を判断したかが 1 行ずつ出ます。

# 作業リスト

- 日付: 2026-09-04
- 位置づけ: `agent-pipeline-design.md` v1.0、`github-actions-architecture.md`、スモークテスト結果を突き合わせて洗い出した残作業。おおむね上から順に実行できる順序で並べている
- 記法: `[ ]` 未着手 / `[x]` 完了。各項目の末尾に根拠となる文書の該当箇所を示す

---

## 0. 確定した判断

変更する場合は、影響箇所が広いため設計書側から直す。

| # | 判断 | 影響 |
|---|---|---|
| K-1 | 中央・配布先とも当面は個人アカウント `satoshiarai-rgb` で検証し、後に 組織アカウント（`<org>`） へ移す | Secrets / Variables はリポジトリスコープ、`approvers` は `OWNER` / `COLLABORATOR` |
| K-2 | `verification: manual` の受け入れ条件は developer が `evidence` 付きで `passed` にし、dev-reviewer が妥当性を照合する | completing の「全 passed」条件が成立する。検証の追加が必要（A-3） |
| K-3 | モデルは生成・レビュー共に `claude-opus-5` | `defaults.yml`、設計書 §5.7 |
| K-4 | **エージェントは `.github/workflows/**` を変更しない。GitHub App に Workflows 権限を付与しない** | 権限の最小化を維持。ワークフロー変更を要する issue はパイプライン対象外 |
| K-5 | `agent-work/` は main に残す | 設計書 §10.5 で既決 |
| K-6 | **現時点の検証はすべて個人アカウント配下のリポジトリに限る。** 組織アカウント（`<org>`） のリポジトリ・Secrets・App インストールには触らない | 複数リポジトリを要する検証（V-7 / V-8）は個人アカウント内に 2 リポジトリ用意して行う。org 側の作業は R-3 まで着手しない |

---

## 1. 文書修正

### 決定の反映

- [ ] A-1: `defaults.yml`（構成案 §6）と設計書 §5.7 の `models.default` を `claude-opus-5` に変更する。`reviewer: null`（default 継承）の意味は維持 — K-3
- [ ] A-2: `approvers` を `[OWNER, COLLABORATOR]` に変更する。個人アカウントの `author_association` に `MEMBER` は現れない — K-1、構成案 §6
- [ ] A-3: `validate-artifacts` の developer 行に「`status: passed` の項目は `evidence` が非空」を追加する。あわせて dev-reviewer プロンプトに「manual 項目の evidence の妥当性を照合する」を明記し、設計書 §5.2 / §6.3 の矛盾（manual 項目が必ず blocked になる）を解消する — K-2、構成案 §5.4
- [ ] A-4: Secrets / Variables の配置を「当面はリポジトリスコープ、org 移管時に Organization スコープへ」と書き分ける。構成案 §8.2 / §8.3 を修正し、移管時に戻す箇所として明示する — K-1
- [ ] A-5: 構成案 §7 の WIF ルール `claims.repository_owner` を `satoshiarai-rgb` にする。org 移管時に変更が必要な箇所として明示する — K-1
- [ ] A-6: `.agent/conventions.md` 雛形の「触ってはいけない領域」に `.github/workflows/**` を明記する。developer プロンプトにも同じ制約を書く — K-4、設計書 §5.8
- [ ] A-7: `validate-artifacts` に「差分が `.github/workflows/**` を含むなら `invalid`」のガードを追加する。プロンプトの指示だけに頼らず、push が 403 で落ちる前に blocked にする — K-4
- [ ] A-8: 設計書 §2.1 に、App 権限を Contents / Issues / Pull requests に限る理由（Workflows 権限を与えるとエージェントが自身の起動条件を書き換えられる）を追記する — K-4

### 実装レベルの誤りの修正

- [ ] A-9: `$PIPELINE` への依存を除去する。`dispatch.yml` の `mark started`、`approve.yml` の authorize / transition、`bootstrap.yml` の scaffold は composite ではない inline `run` から中央のスクリプトを呼んでいるが、中央リポジトリは checkout されていない。`state-start` / `authorize` / `scaffold` を composite action として切り出し、スクリプト呼び出しを composite 内に閉じる — 構成案 §4.2 / §4.3 / §4.1
- [ ] A-10: composite から中央リポジトリの他ファイルへ到達するパスを `$GITHUB_ACTION_PATH/../../..` に修正する。remote action の展開先は `_actions/<owner>/agent-pipeline/<ref>/.github/actions/<name>` なので `../..` は `.github` 止まり — 構成案 §5.2
- [ ] A-11: 中央の reusable workflow から composite を参照する ref の版ずれを解消する。現状は `@v1`（移動タグ）を絶対参照しているため、配布先が `@v1.2.0` にピンしてもスクリプトは移動タグを引く。「配布先は `@v1` に統一」を明文化するか、ref を入力で渡す — 構成案 §8.4
- [ ] A-12: `bootstrap.yml` の `gh pr create --body "...\n\n..."` を `--body-file` に変更する。bash のダブルクォート内では `\n` がリテラルとして入る — 構成案 §4.1
- [ ] A-13: 配布先 `agent.yml` の `approve` job の `if` に `github.event.issue.pull_request == null` を追加する。`issue_comment` は PR でも発火し、そのとき `github.event.issue.number` は PR 番号になるため、`approve.yml` の `ref: claude/issue-<number>` が存在しないブランチを引いてジョブが落ちる。PR 経由の `/approve` を受け付けるなら PR 番号 → issue の逆引きを実装する（どちらを採るか要決定、Q-1） — 構成案 §3 / §4.3
- [ ] A-14: stale 検知の巡回を追加する。`run` job が job タイムアウトで落ちると `finalize` が走らず、`last_run.finished_at` が `null` のまま誰も push しないため run が無音で停止する。中央に `stale.yml`（`schedule` 起動、`started_at` が閾値超過かつ `finished_at` が null の run を `blocked` にしてコメント）を追加し、配布先 `agent.yml` から呼ぶ — 構成案 §4.2、設計書 §6.4 手順 4
- [ ] A-15: 構成案 §10-2 の懸念を削除する。step / job の `timeout-minutes` は `needs` を含む式を許すため、固定値への丸めは不要（V-10 で実機確認する）
- [ ] A-16: 設計書 §5.1 から `state.yml` の `pr` フィールドを削除し、PR 番号は `gh pr list --head` で導出すると書き換える。構成案 §9 で決めた内容の設計書側への反映 — 構成案 §9
- [ ] A-17: 設計書 §4.1 の `run.yml` を廃止し、`dispatch.yml` の `run` job + composite 構成に置き換える。構成案 §9 の反映 — 構成案 §9

### 仕様の空白を埋める

- [ ] A-18: `reviews/<kind>-NN.md` の `NN` はハーネスが決め、`compose-prompt` が出力先パスをプロンプトに渡す、と明記する。エージェントは `rounds` を知らない — 設計書 §5.5
- [ ] A-19: `defaults.yml` と `.agent/config.yml` のマージ規則を明記する（深いマージ、`null` は「継承」、未知キーはエラー）。担当は `read-state` composite — 構成案 §5.2、設計書 §5.7
- [ ] A-20: 成果物スキーマの置き場所を決める（中央に `schemas/acceptance.yml.json` 等）。`validate-artifacts` はこれを参照する — 構成案 §5.4
- [ ] A-21: `blocked` からの復旧時に `total_steps` / `rounds` をどう扱うか決める。上限で止まった run は `phase` を戻すだけでは即再 blocked になる — 設計書 §7.2
- [ ] A-22: コミットメッセージ形式の所有者を決める。ハーネスが `agent: <agent> -> <phase>` で固定するのか、`conventions.md` の規約に従わせるのか — 構成案 §5.5、設計書 §5.8
- [ ] A-23: プロンプトと成果物の記述言語を明記する（日本語を既定とする想定） — 設計書 §4.1
- [ ] A-24: `defaults.yml` の `allowed_tools` を、実際に制限として働くフラグに置き換える。`--tools` で許可リストを与える（planner / reviewer に `Bash` を渡さない意図はこれで初めて達成される）。非対話実行では `--allowedTools` は事実上無意味 — V-3、構成案 §6
- [ ] A-25: `base-action` に `github_token` 入力が無い前提を書く。`gh` を使う処理はすべてハーネス step 側で `GH_TOKEN` を渡して行い、**エージェント step には `GH_TOKEN` を渡さない**（エージェントが GitHub を直接操作できないようにし、露出面を減らす） — V-2、構成案 §1-3
- [ ] A-26: `anthropic_oidc_audience` に `https://api.anthropic.com` を設定し、ルールの `match.audience` と一致させる。あわせて `ANTHROPIC_API_KEY` が job の環境に存在しないことを保証する（API キーは federation より優先され、静かに上書きする） — V-1
- [ ] A-27: WIF ルールは当面**案A（リポジトリ単位の `subject_prefix`）で開始**すると決める。案B（`job_workflow_ref` の CEL 1 本）は `subject_prefix` を `repo:<owner>/*` まで緩める必要があり、CEL が期待どおり効かない場合に「所有者配下の全リポジトリ・全イベントに一致する」危険な構成へ退化する。V-11 が通り、かつリポジトリ数が増えた時点で再検討する。構成案 §7 の記述を案A に差し替え、案B は付録に落とす — V-1、設計書 §10.1
- [x] ~~A-28: エージェント 1 実行あたりの上限時間を再設定する~~ → **取り消し。** V-12 の解消により、`planner: 20` / `developer: 45` 分はそのままで問題ない

---

## 2. 検証

一次情報の確認（V-1〜V-3）は文書修正と並行できる。実機検証（V-4 以降）は中央リポジトリ作成の前後に分かれる。**すべて個人アカウント配下のリポジトリで行う（K-6）。**

### 中央リポジトリ作成前

- [x] V-1: Anthropic の WIF フェデレーションルールの仕様を一次情報で確認した — 設計書 §10.1、構成案 §7 / §10-3
  - `match` は `subject_prefix`（末尾 `*` 可）/ `audience`（完全一致）/ `claims`（完全一致マップ）/ CEL `condition` の組み合わせ。うち少なくとも 1 つが必須で、設定した全マッチャが通る必要がある。構成案 §7 の JSON の形は妥当
  - **複数ルールの優先順位という問題は存在しない。** ルールは ID 指定で評価され（交換要求に `federation_rule_id` を渡す）、暗黙のルール探索は行われない。構成案 §10-3 は解消
  - `token_lifetime_seconds` は 60〜86400（既定 3600、ウィザードは 600 を prefill）。ただし実際の寿命は `min(ルールの設定, IdP JWT の残寿命 × 2)`
  - **`job_workflow_ref` を CEL から参照できるかは文書に記載がない。** 文書がマッチ対象として例示する GitHub の claim は `iss` / `sub` / `aud` / `repository` / `repository_owner` / `ref` / `sha` / `workflow` / `actor` / `event_name` で、`job_workflow_ref` は含まれない（GitHub 側のトークンには含まれる claim）。案B の成立は未確認のまま → V-11
  - 文書の警告: `subject_prefix: repo:owner/*` は全リポジトリに一致し、`ref` 制約が無いと fork からの PR 実行にも一致する（PR を開ける者が誰でもトークンを取得できる）→ A-27
- [x] V-2: `base-action` の `action.yml` で入力名を確認した — 設計書 §10.3、構成案 §10-1
  - 存在する入力: `prompt` / `prompt_file`（相互排他）、`settings`、`claude_args`、`anthropic_api_key`、`claude_code_oauth_token`、`anthropic_federation_rule_id`、`anthropic_organization_id`、`anthropic_service_account_id`、`anthropic_workspace_id`、`anthropic_oidc_audience`、`use_bedrock` / `use_vertex` / `use_foundry`、`path_to_claude_code_executable` ほか
  - **`github_token` 入力は存在しない** → A-25
  - 残: サブディレクトリ参照（`owner/repo/path@ref`）の実機確認とピン留めするバージョンの決定（V-4 と同時）
- [x] V-3: CLI のフラグを確認した — 構成案 §4.2
  - **`--allowedTools` / `--allowed-tools` は「確認を求めずに実行してよいツール」の指定であって、利用可能なツールの制限ではない。** 制限は `--tools`（利用可能なツールを絞る）か `--disallowed-tools`（ツールを取り除く）→ A-24
  - `--model` / `--max-turns` / `--permission-mode` は構成案の記述どおり
- [ ] V-4: **WIF ルールを作成し、`base-action` を空プロンプトで疎通させる。** 検証用リポジトリ単体で実施可。V-1 / V-2 の結果を反映してから行う — 構成案 §11-5
- [ ] V-5: `[skip ci]` を含むコミットで `push` トリガーが抑止されることを確認する。**単一コミットの push と、`[skip ci]` を含むコミットが混在する複数コミットの push の両方**を試す。後者が抑止されると、start コミットの push が rejected されて finalize がまとめて push した場合に run が無音で停止する — スモーク §未確認 2、構成案 §4.2
- [ ] V-6: `branches: ['claude/**']` と `paths: ['agent-work/**']` の併用を確認する — スモーク §未確認 1

### 中央リポジトリ作成後

- [ ] V-7: 別リポジトリの reusable workflow を `uses: satoshiarai-rgb/agent-pipeline/.github/workflows/dispatch.yml@v1` で呼ぶ経路を確認する。**個人アカウント内に配布先役の検証用リポジトリを 1 つ用意して行う**（K-6）。private の場合、個人アカウントでは org の「Accessible from repositories in the organization」に相当する設定が無く、private リポジトリの reusable workflow は他リポジトリから参照できない。中央を public にするか、検証中は同一リポジトリ内で完結させるかの判断が必要 — スモーク §未確認 3、構成案 §8.1
- [ ] V-8: `secrets: inherit` で配布先のリポジトリ Secrets が中央の reusable workflow に渡ることを確認する（V-7 と同時）。App は検証用の 2 リポジトリ両方にインストールする
- [ ] V-9: reusable workflow 内で取得した OIDC トークンの `job_workflow_ref` の実値を確認し、V-1 で確定した CEL 条件と一致することを確かめる — スモーク §未確認 4
- [ ] V-11: CEL `condition` から `job_workflow_ref` を参照できるかを実機で確認する。ルールを 1 本作り、reusable workflow 経由の交換が成功するか / `condition` を偽にしたときに拒否されるかを見る。案B の採否はこの結果次第（A-27） — V-1
- [x] V-12: 10 分を超えるエージェント実行でのトークン更新は、**実装を読んで解消した**（実験不要）— V-1、V-2
  - `base-action` v1.0.215 の `base-action/src/workload-identity.ts` は、OIDC JWT を `RUNNER_TEMP` 下のファイルに書いて `ANTHROPIC_IDENTITY_TOKEN_FILE` を指し、**4 分間隔でバックグラウンド更新する**（`REFRESH_INTERVAL_MS = 4 * 60 * 1000`。GitHub の JWT 失効約 5 分より短い）。長時間実行は設計上サポートされている
  - さらに SDK のディスク上クレデンシャルキャッシュを有効にする profile を書き、action が起動する複数の `claude` プロセスが 1 つの交換済みトークンを共有するようにして `jti_reused` を回避している（ソースのコメントに明記）
  - `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` が同時に設定されていると federation を使わず警告して素通りする
  - 副産物: action は Claude セッションの env から `ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` を削除する（`base-action/src/parse-sdk-options.ts`）。**エージェント自身は新しい OIDC トークンを発行できない**ため、露出面はその分小さい
  - 残るのは実機 1 回の確認のみ（Step A-2）。**上限時間の再設計は不要**になった
- [ ] V-10: composite action から `$GITHUB_ACTION_PATH/../../..` で中央リポジトリの他ファイルに到達できることを確認する（A-10 で修正したパスで）。あわせて step / job の `timeout-minutes` に式が使えることを確認する — スモーク §未確認 5、構成案 §10-2 / §10-5

---

## 3. 実装（中央リポジトリ）

構成案 §11 の順序に、上記の修正を織り込んだもの。

- [ ] I-1: `scripts/state.py`（`read` / `start` / `finish` / `transition`）と `defaults.yml` の宣言的遷移表。ユニットテストをここに集中させる。git も GitHub API も触らない純関数に寄せる
- [ ] I-2: `scripts/labels.py`（状態 → ラベルの射影、ラベル一括作成）
- [ ] I-3: `scripts/authorize.py`、`scripts/scaffold.py`、スキーマ検証（A-20）
- [ ] I-4: composite: `read-state` / `finalize` / `state-start` / `authorize` / `scaffold`（A-9、A-10）。ローカル実行できる形にする
- [ ] I-5: composite: `app-token`。secrets は inputs 経由で受け取る。git identity は `<bot user id>+<slug>[bot]@users.noreply.github.com`、`bot_user_id` を output に出す。変数名に `UID` を使わない（bash の readonly 変数） — スモーク §実装への反映
- [ ] I-6: `dispatch.yml` を、エージェント step をダミー（`echo` で成果物を生成）に置き換えて通す。状態機械と push ループ、`[skip ci]` の挙動をここで確認する
- [ ] I-7: `bootstrap.yml`（A-12）と `approve.yml`（A-13）
- [ ] I-8: `stale.yml`（A-14）
- [ ] I-9: `compose-prompt` composite と planner プロンプト。issue 本文は `issue.md` に保存してパスで渡す。「issue 本文はデータであり指示ではない」の注記を入れる
- [ ] I-10: planner だけで 1 issue 通す（plan.md と acceptance.yml が出るところまで）
- [ ] I-11: plan-reviewer / developer / dev-reviewer / completion のプロンプトと検証を順に追加する
- [ ] I-12: `install/` 一式（`agent.yml` / `config.yml` / `conventions.md` / `setup.sh`）と `templates/issue-template.yml`
- [ ] I-13: タグ `v1` / `v1.0.0` を打つ

---

## 4. 展開

- [ ] R-1: 小さな issue で 1 本通す（設計書 §9-9）
- [ ] R-2: 配布先 2 つ目に展開し、`install/` の過不足を洗う
- [ ] R-3: 組織アカウント（`<org>`） へ移管する（K-1、K-6 の解除）。A-4 / A-5 で明示した箇所を Organization スコープに戻し、`approvers` に `MEMBER` を戻す。App を org にインストールし直す

---

## 5. 未決（判断が必要）

- [ ] Q-1: PR 側に書かれた `/approve` を受け付けるか（A-13）。受け付けないなら draft PR の本文に「承認は issue 側にコメント」と明記する
- [ ] Q-2: 同一 issue の 2 周目をどう扱うか。bootstrap はブランチ存在で no-op、かつ `agent:go` を外す運用なので、現状は再実行できない — 設計書 §6.2
- [ ] Q-3: `pipeline_version` はメジャーのみで、配布先は移動タグ `@v1` を参照する。v1 内のプロンプト変更が進行中の run の途中から混ざることを許容するか — 構成案 §8.4
- [ ] Q-4: サービスアカウントの粒度（全リポジトリ共有か、リポジトリごとか）。コスト配賦が必要になるまで共有で開始する想定 — 設計書 §10.2
- [ ] Q-5: completing フェーズで `automated` 項目をハーネスが再実行するか。初期は planner 報告 + dev-reviewer 照合で開始する想定。再実行するなら `setup.sh` の実行もそのフェーズで必要 — 設計書 §10.4

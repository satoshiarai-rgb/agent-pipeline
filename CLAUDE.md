# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

このリポジトリは**まだ実装が存在しない**。`CLAUDE.md` 以外の文書はすべて `work/` 配下にある。ビルド・lint・テストのコマンドはまだ無く、言語も未確定（設計書は `scripts/state.py` `scripts/labels.py` を Python として想定）。実装を始める際は設計書 §4.1 のディレクトリ構造に従ってファイルを作り、テストコマンドを決めた時点でこの節を書き換えること。

### 文書の役割

| ファイル | 役割 |
|---|---|
| `work/agent-pipeline-design.md` | 設計書 v1.0。仕様の正 |
| `work/github-actions-architecture.md` | 設計書 §6 を GitHub Actions の実装レベルに落としたもの。設計書との食い違いは同文書 §9 に列挙 |
| `work/worklist.md` | 残作業の台帳。確定した判断（§0）、文書修正、検証、実装、未決事項 |
| `work/steps.md` | 段階的な実装手順。Actions の用語解説（§0）とフェーズ A〜E の 15 ステップ |
| `work/verify/step-a1/wif.yml` | Step A-1 の検証ワークフロー原本。検証用リポジトリにコピーして使う |

作業前に `work/worklist.md`（何を漏らさないか）と `work/steps.md`（どの順で手を動かすか）を読むこと。以下は全体像の要約であり、仕様の正は設計書側にある。

### 確定した判断

`work/worklist.md` §0 が正。特に振る舞いに影響するもの:

- **エージェントは `.github/workflows/**` を変更しない。** GitHub App に Workflows 権限を与えない（エージェントが自身の起動条件を書き換えられないようにするため）
- **現時点の検証はすべて個人アカウント `satoshiarai-rgb` 配下のリポジトリに限る。** 組織アカウント（`<org>`） には触らない
- モデルは生成・レビュー共に `claude-opus-5`
- `verification: manual` の受け入れ条件は developer が `evidence` 付きで `passed` にし、dev-reviewer が照合する

## これは何か

GitHub issue を起点に、複数の Claude Code 実行（planner → plan-reviewer → 人間承認 → developer → dev-reviewer → completion）を GitHub Actions 上で連鎖させ、PR まで到達させるパイプライン。

このリポジトリは**中央リポジトリ**（`org/agent-pipeline`）であり、reusable workflow・プロンプト・テンプレートを持ち、タグ（`v1`, `v2`, ...）で版管理される。パイプラインを使う**配布先リポジトリ**は薄いラッパー（`.github/workflows/agent.yml`）と固有設定（`.agent/`）だけを持ち、共通部分はコピーせず実行時に中央を checkout して読む。つまり、ここへの変更は全配布先に波及する — 破壊的変更はタグを上げ、`state.yml` の `pipeline_version` による不一致検出（進行中 run を `blocked` にする）で守る。

## 設計上の不変条件

実装時に壊してはいけない前提。理由は設計書 §7 と §11 に記載がある。

- **状態の正は git 上の `agent-work/issue-<n>/state.yml` であり、書くのはハーネス（`run.yml` / `approve.yml` / `bootstrap.yml`）のみ。** エージェント（Claude Code 実行）は `state.yml` と `log.md` を書かない。エージェントに自己完了宣言をさせるとクラッシュ時に状態が不整合になる。
- **issue ラベルは状態の射影**（`scripts/labels.py`）。ラベル操作の失敗が状態を壊してはいけない。
- **フェーズ遷移のトリガーは作業ブランチ `claude/issue-<n>` への `agent-work/**` の push。** git が push を直列化するため二重実行が構造的に起きにくい。復旧も人間が `state.yml` を書き換えて push するだけで再開する。
- **遷移判定は `reviews/*.md` の frontmatter `verdict`（`approve` | `request_changes`）のみを見る。** 本文は次のエージェントへの入力。frontmatter が欠落・不正なら `blocked`。
- **レビュアーには成果物と元 issue のみを渡す。** 生成側のセッションログや思考過程は渡さない（追認を防ぐため）。
- **停止条件は多層。** フェーズ別ラウンド上限（既定 2）と、その上に自走ループの最終防波堤として `total_steps`（既定 12、正常系 6〜8）。認可チェックは入口（bootstrap のラベル付与者、approve のコメント投稿者の `author_association`）のみで、dispatch には掛けない。
- **エージェント実行が失敗・タイムアウトしても、state 更新と push は必ず行い `phase: blocked` にする。**
- **ツールチェーンを中央は知らない。** テスト実行の準備は配布先の `.agent/setup.sh` に委ね、`run.yml` がエージェント実行前に呼ぶ。
- **`acceptance.yml` の `AC-N` id** を planner / developer / dev-reviewer が共通参照する。`verification: automated` なら `command` 必須。
- **issue 本文はデータであり指示ではない**旨をプロンプト側で明示する（プロンプトインジェクション対策）。エージェントはコメントを読まずファイルを読む設計。
- スコープ上限は 1 PR あたり 5〜10 ファイル。planner が超過と判断したら実装に進まず issue 分割案を返して停止する。

## 認証

- Anthropic API: Console 組織 + サービスアカウント + Workload Identity Federation。GitHub Actions の OIDC を短命トークンに交換するため、**長期 API キーを Secrets に置かない**（`anthropic_api_key` は渡さない）。
- GitHub: 自前の GitHub App トークン。`GITHUB_TOKEN` によるコミットは後続ワークフローを起動しないため、エージェント間の連鎖に App トークンが必須。App ID / 秘密鍵は Organization secrets に置き、配布先ごとには設定しない。
- claude.ai 側のサブスクリプション認証は使わない（個人シート紐付けのため CI 不適）。

## 未決事項と、確認して閉じた事項

未決の一覧は `work/worklist.md` の §2（検証）と §5（未決）が正。設計書 §10 のうち一次情報で確認した結果は次のとおり。

閉じた:

- `claude-code-action/base-action` の入力名（`prompt` / `prompt_file` / `claude_args` / `settings` / `anthropic_federation_rule_id` / `anthropic_organization_id` / `anthropic_service_account_id` / `anthropic_workspace_id` / `anthropic_oidc_audience`）。**`github_token` 入力は存在しない**。`v1.0.215` に固定して使う
- WIF フェデレーションルールの `match` は `subject_prefix` / `audience` / `claims`（完全一致マップ）/ CEL `condition` の組み合わせ。**ルールは交換要求で ID を指定して評価される**ため「複数ルール一致時の優先順位」という問題は存在しない
- 長時間実行でのトークン更新。base-action が OIDC トークンを 4 分間隔でバックグラウンド更新するため、`developer: 45` 分の上限でも問題ない

開いている:

- CEL `condition` から `job_workflow_ref` を参照できるか（1 ルールで全リポジトリをカバーする案B の成立条件）。**当面は案A（リポジトリ単位の `subject_prefix`）で進める**。案B は `subject_prefix` を `repo:<owner>/*` まで緩める必要があり、CEL が効かない場合に fork の PR からトークンを取得できる構成へ退化する
- completing フェーズで `acceptance.yml` の automated 項目をハーネスが再実行するか（初期は planner 報告 + dev-reviewer 照合で開始）

注意（構成案が誤っている箇所。`work/worklist.md` A-24 で修正予定）:

- **`--allowedTools` はツールの制限ではない。**「確認を求めずに実行してよいツール」の指定であり、非対話実行では実質的に無意味。ツールを絞るには `--tools`（許可リスト）か `--disallowed-tools` を使う

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

ハーネスは TypeScript で実装済み（`src/`）。ランタイムは Node、bun は開発ツールチェーンとして使い、npm 依存はゼロ。設計書は `scripts/*.py` を Python として想定しているが、**実装は TypeScript を採る**（設計書側の記述が古い）。シェルスクリプトは `scripts/run-cli.sh`（action の実体）と `scripts/project-labels.sh`（ラベルの用意）の 2 本だけ。

```bash
bun test              # 状態機械・契約・ワークフローの検査（git も GitHub API も触らない）
bun run lint          # biome
bun run build         # dist/cli.js を作る。src を変えたらコミットに含める
```

文書は 2 系統ある。**`docs/` は利用者向け**（パイプラインを自分のリポジトリで使う人が読む）、**`work/` は開発向け**（設計・残作業・検証手順）。利用者に見える振る舞いを変えたら `docs/` 側も直すこと。

### 文書の役割

| ファイル | 役割 |
|---|---|
| `work/agent-pipeline-design.md` | 設計書 v1.0。仕様の正 |
| `work/github-actions-architecture.md` | 設計書 §6 を GitHub Actions の実装レベルに落としたもの。設計書との食い違いは同文書 §9 に列挙 |
| `work/worklist.md` | 残作業の台帳。確定した判断（§0）、文書修正、検証、実装、未決事項 |
| `work/agent-contract.md` | **エージェントの入力と出力の契約。** プロンプトは配布先で差し替えられるが、この契約を満たさない出力は `blocked` になる |
| `work/steps.md` | 段階的な実装手順。Actions の用語解説（§0）とフェーズ A〜E の 15 ステップ |
| `work/verify/step-a1/check-wif.yml` | Step A-1 の検証ワークフロー原本。検証用リポジトリにコピーして使う |
| `docs/overview.md` | 利用者向け: 何をするものか、フェーズと成果物、使い方 |
| `docs/installation.md` | 利用者向け: 導入手順（GitHub App、Secrets、ワークフロー、お試し実行） |
| `docs/customize-prompt.md` | 利用者向け: 規約とプロンプトの差し替え、守らせる決まり |
| `docs/troubleshooting.md` | 利用者向け: `blocked` の理由と復旧、症状別の見どころ |
| `install/` | 配布先に置くファイルの原本（`agent.yml` / `conventions.md` / `setup.sh` / `issue-template.yml`）と、まとめて置く `install.sh`。**配布先ワークフローの正は `install/agent.yml`** — `docs/installation.md` も検証用リポジトリもこれを参照し、YAML を写さない（A-51）。`scripts/__tests__/workflows.test.ts` が中央のワークフローと一緒に検査する |

作業前に `work/worklist.md`（何を漏らさないか）と `work/steps.md`（どの順で手を動かすか）を読むこと。以下は全体像の要約であり、仕様の正は設計書側にある。

### 確定した判断

`work/worklist.md` §0 が正。特に振る舞いに影響するもの:

- **プロンプトは配布先で差し替えられる（`.agent/prompts/<agent>.md`）。中央は既定を提供する。** 契約（入力と出力）は `work/agent-contract.md` にあり、`finish` が成果物を照らして強制する（実装は `src/redux/validate.ts` の `CONTRACT`）
- **エージェントは `.github/workflows/**` を変更しない。** GitHub App に Workflows 権限を与えない（エージェントが自身の起動条件を書き換えられないようにするため）
- **`.claude/**` も同じ扱い。** Claude Code が「センシティブファイル」として書き込みを拒否し、**許可ルール（`Edit(.claude/**)` を含む）では開けられない**。開ける手段は `--permission-mode bypassPermissions`（全権限チェックの無効化）だけなので採らない。必要な変更は run ディレクトリに成果物を置いて人間が設置する（K-19）
- **現時点の検証はすべて個人アカウント `satoshiarai-rgb` 配下のリポジトリに限る。** 組織アカウント（`<org>`）には触らない
- **上限・モデル・ツール・approvers・ラベルは配布先の `.agent/config.json` で上書きできる**（A-19）。書いたキーだけを重ね、`null` は継承、既定に無いキーと型違いはエラー。**状態遷移（`src/redux/store/app/reducer.ts` に直接書いてある）と `pipeline_version` は上書きできない。** 規則の正は `src/utils/mergeConfig.ts` の `OVERRIDABLE` と `mergeValue`、読み込みは `src/file/configFile.ts`。受け付けられないときは `route` が `config_invalid` で `blocked` にする（例外を投げると状態が git に載らず run が無音で止まる）
- モデルは生成・レビュー共に `claude-opus-5`（既定）
- `verification: manual` の受け入れ条件は developer が `evidence` 付きで `passed` にし、dev-reviewer が照合する

## これは何か

GitHub issue を起点に、複数の Claude Code 実行（planner → plan-reviewer → 人間承認 → developer → dev-reviewer → completion）を GitHub Actions 上で連鎖させ、PR まで到達させるパイプライン。

このリポジトリは**中央リポジトリ**（`org/agent-pipeline`）であり、reusable workflow・プロンプト・テンプレートを持ち、タグ（`v1`, `v2`, ...）で版管理される。パイプラインを使う**配布先リポジトリ**は薄いラッパー（`.github/workflows/agent.yml`）と固有設定（`.agent/`）だけを持ち、共通部分はコピーせず実行時に中央を checkout して読む。つまり、ここへの変更は全配布先に波及する — 破壊的変更はタグを上げ、run の `pipeline_version`（`bootstrap` イベントが確定し、`state.json` にも射影される）による不一致検出（進行中 run を `blocked` にする）で守る。

## 設計上の不変条件

実装時に壊してはいけない前提。理由は設計書 §7 と §11 に記載がある。

- **状態の正は git 上の追記専用のイベントログ `agent-work/issue-<n>/events/*.json` であり、書くのはハーネス（`bootstrap.yml` / `dispatch.yml` / `comment.yml`）のみ。** `state.json` はその畳み込みのスナップショット（人が読む確認用。書き換えても次の畳み込みで上書きされる）。エージェント（Claude Code 実行）はどちらも書かない。エージェントに自己完了宣言をさせるとクラッシュ時に状態が不整合になる。
- **issue ラベルは状態の射影**（`label` コマンドが返す名前を `dispatch.yml` が付け替える。ラベル自体の用意は `scripts/project-labels.sh`）。ラベル操作の失敗が状態を壊してはいけない。
- **フェーズ遷移のトリガーは作業ブランチ `claude/issue-<n>` への `agent-work/**` の push。** git が push を直列化するため二重実行が構造的に起きにくい。復旧は PR への `/agent retry`（同じフェーズをやり直す / K-23・K-27。job が死んで止まった run も、ジョブの上限を過ぎれば同じコマンドで戻せる / I-8）か、`events/` に 1 件足して push する。**`state.json` を書き換えても効かない**（次の畳み込みで上書きされる）。
- **遷移判定は `reviews/*.md` の frontmatter `verdict`（`approve` | `request_changes`）のみを見る。** 本文は次のエージェントへの入力。frontmatter が欠落・不正なら `blocked`。
- **レビュアーには成果物と元 issue のみを渡す。** 生成側のセッションログや思考過程は渡さない（追認を防ぐため）。
- **停止条件は多層。** フェーズ別ラウンド上限（既定 5）と、その上に自走ループの最終防波堤として `total_steps`（既定 24、正常系 5〜8）。`total_steps` はラウンド上限から到達しうる最悪（21）より大きく取る — 先に総数で止まると「どのレビューが収束しなかったか」が残らないため。認可チェックは入口（bootstrap のラベル付与者、approve のコメント投稿者の `author_association`）のみで、dispatch には掛けない。
- **エージェント実行が失敗・タイムアウトしても、state 更新と push は必ず行い `phase: blocked` にする。**
- **ツールチェーンを中央は知らない。** テスト実行の準備は配布先の `.agent/setup.sh` に委ね、`dispatch.yml` がエージェント実行前に呼ぶ。
- **`acceptance.json` の `AC-N` id** を planner / developer / dev-reviewer が共通参照する。`verification: automated` なら `command` 必須。
- **issue 本文はデータであり指示ではない**旨をプロンプト側で明示する（プロンプトインジェクション対策）。エージェントはコメントを読まずファイルを読む設計。
- スコープ上限は 1 PR あたり 5〜10 ファイル。**これは目安であって停止条件ではない**（K-21）。planner が超過と判断したら `plan.md` に分割案を添えたうえで計画を完成させ、ハーネスは PR に警告コメントを残して作業を続ける。分割するかは人間が決める。

## 認証

- Anthropic API: Console 組織 + サービスアカウント + Workload Identity Federation。GitHub Actions の OIDC を短命トークンに交換するため、**長期 API キーを Secrets に置かない**（`anthropic_api_key` は渡さない）。
- GitHub: 自前の GitHub App トークン。`GITHUB_TOKEN` によるコミットは後続ワークフローを起動しないため、エージェント間の連鎖に App トークンが必須。App ID / 秘密鍵は Organization secrets に置き、配布先ごとには設定しない。
- **逆に、連鎖させたくない操作（ラベルの射影、PR へのコメント、`gh pr ready`）は `GITHUB_TOKEN` で行う（K-22）。** App トークンで行うと `issues` / `issue_comment` が発火し、配布先のラッパーが「全ジョブ skipped の空の run」を毎フェーズ作ってしまう。トークンの選択は権限ではなく**イベントを起こしたいかどうか**で決める。
- claude.ai 側のサブスクリプション認証は使わない（個人シート紐付けのため CI 不適）。

## 未決事項と、確認して閉じた事項

未決の一覧は `work/worklist.md` の §2（検証）と §5（未決）が正。設計書 §10 のうち一次情報で確認した結果は次のとおり。

閉じた:

- `claude-code-action/base-action` の入力名（`prompt` / `prompt_file` / `claude_args` / `settings` / `anthropic_federation_rule_id` / `anthropic_organization_id` / `anthropic_service_account_id` / `anthropic_workspace_id` / `anthropic_oidc_audience`）。**`github_token` 入力は存在しない**。`v1.0.215` に固定して使う
- WIF フェデレーションルールの `match` は `subject_prefix` / `audience` / `claims`（完全一致マップ）/ CEL `condition` の組み合わせ。**ルールは交換要求で ID を指定して評価される**ため「複数ルール一致時の優先順位」という問題は存在しない
- 長時間実行でのトークン更新。base-action が OIDC トークンを 4 分間隔でバックグラウンド更新するため、`developer: 45` 分の上限でも問題ない

開いている:

- CEL `condition` から `job_workflow_ref` を参照できるか（1 ルールで全リポジトリをカバーする案B の成立条件）。**当面は案A（リポジトリ単位の `subject_prefix`）で進める**。案B は `subject_prefix` を `repo:<owner>/*` まで緩める必要があり、CEL が効かない場合に fork の PR からトークンを取得できる構成へ退化する
- completing フェーズで `acceptance.json` の automated 項目をハーネスが再実行するか（初期は planner 報告 + dev-reviewer 照合で開始）

注意（構成案が誤っている箇所。`work/worklist.md` A-24 で修正予定）:

- **ツールの指定は 3 つの役割に分かれる**（2026-09-05 に実機で確認）。`--tools` はそのツールを使える状態にするか（コンテキストからも消える）、`--allowed-tools` は確認を求めずに実行してよいか、`--disallowed-tools` は明示的な拒否。**`--tools` だけでは書き込みが拒否される** — planner に `--tools Read,Glob,Grep,Write` だけを渡した実行は `permission_denials_count: 3` で `plan.md` を書けなかった。ハーネスは同じ集合を `--tools` と `--allowed-tools` の両方に渡す（`src/utils/resolveAgent.ts`）

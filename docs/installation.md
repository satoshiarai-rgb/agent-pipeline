# 導入

あなたのリポジトリでパイプラインを動かすための手順です。置くのは**ワークフロー 1 枚**と、
必要なら固有の設定（`.agent/`）だけで、中身は実行時に agent-pipeline 本体を読みます。
所要はおよそ 30 分（GitHub App の作成が大半）です。

パイプラインが何をするものかは [overview.md](overview.md) を参照してください。

## 前提

| | 内容 |
|---|---|
| agent-pipeline 本体 | 本体リポジトリが public であること。private だと、あなたのリポジトリからワークフローを参照できません |
| GitHub App | 自前の App を用意します。GitHub 標準の `GITHUB_TOKEN` によるコミットは次のワークフローを起動しないため、フェーズを連鎖させるには App が要ります |
| Claude の認証 | Claude のサブスクリプション（Pro / Max / Team / Enterprise）で発行するトークンを使います |
| ランナー | `ubuntu-latest`。ランナー側に追加のセットアップは要りません |

## 1. GitHub App を用意する

1. App を作ります（Settings → Developer settings → GitHub Apps → New GitHub App）
2. Repository permissions を **Contents / Issues / Pull requests: Read & Write** にします。
   **Workflows 権限は与えないでください** — 与えると、エージェントが自分の起動条件
   （`.github/workflows/**`）を書き換えられてしまいます
3. Webhook は使いません（Active のチェックを外す）
4. 秘密鍵を生成して `.pem` をダウンロードします
5. App を**あなたのリポジトリと agent-pipeline 本体の両方**にインストールします

## 2. Secrets を設定する

あなたのリポジトリの Secrets に登録します（組織なら Organization secrets に置けば、
リポジトリごとの設定が要りません）。

| 名前 | 値 |
|---|---|
| `AGENT_APP_CLIENT_ID` | App 設定ページの **Client ID**（`Iv23li...` 形式）。数値の App ID とは別物です |
| `AGENT_APP_PRIVATE_KEY` | 手順 1 でダウンロードした秘密鍵の PEM 全体 |
| `CLAUDE_CODE_OAUTH_TOKEN` | 手元で `claude setup-token` を実行して得られるトークン。秘密情報なので Variables ではなく Secrets に置きます |

`CLAUDE_CODE_OAUTH_TOKEN` は実行した人のサブスクリプションに紐づき、使用量もそこに計上されます。
チームで使うなら、誰のトークンを登録するかを決めておいてください。

## 3. ワークフローを置く

`.github/workflows/agent.yml` を作ります。3 つのイベント（ラベル・PR コメント・push）を
受けて、あとは本体に任せます。

```yaml
name: agent

# Actions の一覧に出る run の名前。push（実作業）はコミットメッセージのままにし、
# それ以外は固定の文言にします（起動条件に合わないイベントでも run 自体は作られるため、
# 既定のままだと issue のタイトルが付いて実作業と見分けが付きません）
run-name: >-
  ${{ github.event_name == 'push' && github.event.head_commit.message || 'agent: trigger check' }}

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
  push:
    branches: ["claude/**"]
    paths: ["agent-work/**"]

# 呼び出す側より広い権限は要求できないので、本体が使う分をここで与えます
permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write # 将来の認証方式（Workload Identity Federation）で必要になります

# 同じ issue の実行を直列化します。実行中のものは止めず、順番待ちにします
concurrency:
  group: agent-${{ github.event.issue.number || github.ref_name }}
  cancel-in-progress: false

jobs:
  # 入口: agent:go ラベルで起動します（ラベルを付けるには write / triage 権限が要ります）
  bootstrap:
    if: github.event_name == 'issues' && github.event.label.name == 'agent:go'
    uses: satoshiarai-rgb/agent-pipeline/.github/workflows/bootstrap.yml@main
    with:
      issue: ${{ github.event.issue.number }}
      actor: ${{ github.actor }}
    secrets: inherit

  # 入口: PR のコメントで承認・差し戻しを受けます。
  # issue 側のコメントは pull_request == null で弾き、bot のコメントも無視します
  comment:
    if: >-
      github.event_name == 'issue_comment' &&
      github.event.issue.pull_request != null &&
      github.event.comment.user.type != 'Bot' &&
      startsWith(github.event.comment.body, '/agent ')
    uses: satoshiarai-rgb/agent-pipeline/.github/workflows/comment.yml@main
    with:
      pr: ${{ github.event.issue.number }}
      body: ${{ github.event.comment.body }}
      association: ${{ github.event.comment.author_association }}
    secrets: inherit

  # 作業ブランチへの push が次のフェーズを起動します。
  # push イベントでは入力を受け取れないので、お試し実行との切り替えは
  # リポジトリ変数で行います（with: の中では式を使えません）
  dispatch:
    if: github.event_name == 'push' && vars.AGENT_DRY_RUN != 'false'
    uses: satoshiarai-rgb/agent-pipeline/.github/workflows/dispatch.yml@main
    with:
      dry_run: true
    secrets: inherit

  dispatch-live:
    if: github.event_name == 'push' && vars.AGENT_DRY_RUN == 'false'
    uses: satoshiarai-rgb/agent-pipeline/.github/workflows/dispatch.yml@main
    with:
      dry_run: false
    secrets: inherit
```

参照先は現時点では `@main` を指定してください。版が切られたら `@v1` のようなタグに
固定できるようになります。

## 4. リポジトリごとの設定（任意）

無くても動きます。必要なものだけ置いてください。

```
.agent/
  conventions.md       全エージェントに渡される、このリポジトリの約束事
  setup.sh             テストを実行できる状態にするための準備
  prompts/<agent>.md   エージェントの役割プロンプトの差し替え
```

- **`conventions.md`** には、命名・ディレクトリ構成・テストの置き場所など、守らせたい約束を
  書きます。パイプラインはあなたのリポジトリの流儀を知らないので、ここが唯一の伝え方です
- **`setup.sh`** はエージェントを動かす直前に実行されます（無ければ何もしません）。
  受け入れ条件に書いたテストコマンドが走る状態を、ここで作ってください

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  npm ci
  ```

- **`.gitignore` を確認してください。** `setup.sh` の実行後に、そのまま成果物をコミットします。
  無視され忘れている生成物（`coverage/`、ビルド出力、`.venv` など）があると PR に混ざります
- **`prompts/`** はエージェントの考え方そのものを変えたいときに使います
  → [customize-prompt.md](customize-prompt.md)

レビューの往復回数やモデルは、現時点では変更できません（パイプライン側の既定が適用されます）。

## 5. お試し実行で配線を確かめる

Claude を呼ばず、ダミーの成果物で最初から最後まで一巡させられます。トークンを使わずに、
ワークフローの配線・権限・ラベルだけを確認できます。`AGENT_DRY_RUN` が未設定なら
お試し実行になります（手順 3 のワークフローの `if` を参照）。

適当な issue を立てて `agent:go` ラベルを付けると、次が起きます。

1. `claude/issue-<n>` ブランチと作業ディレクトリができ、draft PR が開く
2. issue のラベルが `agent:go` から `agent:planning` に付け替わる（ラベルは自動で作られます）
3. 計画 → 計画レビューと進み、`agent:awaiting-human` で止まる
4. その PR に `/agent approve` とコメントすると、実装 → 実装レビュー → 完了報告と進む
5. `agent:done` になり、PR の draft が外れる

**5 まで進み、Actions にひとつも赤い run が無ければ成功です。** 途中で止まったら
[troubleshooting.md](troubleshooting.md) を見てください。確認できたら本番に切り替えます。

```bash
gh variable set AGENT_DRY_RUN --body false
```

お試し実行に戻すときは `--body true`、または変数そのものを削除します。

## 6. 使う

使い方は [overview.md の「使い方」](overview.md#使い方) にまとめてあります。
最初の 1 件は、変更範囲の小さい issue で試すことをおすすめします。

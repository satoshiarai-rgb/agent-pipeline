# 導入

あなたのリポジトリでパイプラインを動かすための手順です。置くのは**ワークフロー 1 枚**と、
必要なら固有の設定（`.agent/`）だけで、中身は実行時に agent-pipeline 本体を読みます。
所要はおよそ 30 分で、その大半は GitHub App の作成です。App は一度作れば他のリポジトリでも
使い回せるので、2 つ目以降は 10 分ほどで済みます。

パイプラインが何をするものかは [overview.md](overview.md) を参照してください。

## 前提

| | 内容 |
|---|---|
| agent-pipeline 本体 | 本体リポジトリが public であること。private だと、あなたのリポジトリからワークフローを参照できません |
| GitHub App | 自前の App を用意します。GitHub 標準の `GITHUB_TOKEN` によるコミットは次のワークフローを起動しないため、フェーズを連鎖させるには App が要ります |
| Claude の認証 | Claude のサブスクリプション（Pro / Max / Team / Enterprise）で発行するトークンを使います |
| ランナー | `ubuntu-latest`。ランナー側に追加のセットアップは要りません |

## 1. GitHub App を用意する

**App は 1 つを使い回します。** アカウント（または組織）に 1 つ作れば、あとは使いたい
リポジトリごとにインストールするだけです。**2 つ目以降のリポジトリでは手順 4 だけ**を行い、
手順 2 の Secrets も同じ値をそのまま使えます（組織なら Organization secrets に置けば、
リポジトリごとの登録も要りません）。

1. App を作ります（Settings → Developer settings → GitHub Apps → New GitHub App）。
   Webhook は使わないので Active のチェックを外します
2. Repository permissions を **Contents / Issues / Pull requests: Read & Write** にします。
   **Workflows 権限は与えないでください** — 与えると、エージェントが自分の起動条件
   （`.github/workflows/**`）を書き換えられてしまいます
3. 秘密鍵を生成して `.pem` をダウンロードします
4. App を**あなたのリポジトリ**にインストールします

agent-pipeline 本体へのインストールは要りません。本体は public で、実行時の読み取りには
GitHub 標準の `GITHUB_TOKEN` で足りるためです。

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

置くのは `.github/workflows/agent.yml` の**1 枚だけ**です。本体の
[`install/agent.yml`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/agent.yml)
がそのまま使えます（配布先ごとに変える箇所はありません）。

```bash
mkdir -p .github/workflows
curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/agent.yml \
  -o .github/workflows/agent.yml
```

3 つのイベントを受けて、あとは本体の reusable workflow に任せます。

| イベント | 何が起きるか |
|---|---|
| issue に `agent:go` ラベルが付く | run を作って計画を始める |
| draft PR に `/agent ...` のコメント | 承認・差し戻し・再開を受ける（issue 側のコメントは見ません） |
| `claude/**` ブランチへの `agent-work/**` の push | 次のフェーズを起動する（フェーズの連鎖はこれで起きます） |

呼び出す側より広い権限は要求できないため、このワークフローが `contents` / `pull-requests` /
`issues` / `id-token` の write を宣言します。作業ブランチへの push は `concurrency` で
直列化されます（理由はファイル内のコメントに書いてあります）。

参照先は現時点では `@main` を指定してください。版が切られたら `@v1` のようなタグに
固定できるようになります。

## 4. リポジトリごとの設定（任意）

無くても動きます。必要なものだけ置いてください。雛形は本体の
[`install/`](https://github.com/satoshiarai-rgb/agent-pipeline/tree/main/install) にあります。

| 置き場所 | 内容 | 雛形 |
|---|---|---|
| `.agent/conventions.md` | 全エージェントに渡される、このリポジトリの約束事 | [`install/conventions.md`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/conventions.md) |
| `.agent/setup.sh` | テストを実行できる状態にするための準備 | [`install/setup.sh`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/setup.sh) |
| `.agent/prompts/<agent>.md` | エージェントの役割プロンプトの差し替え | 本体の [`prompts/`](https://github.com/satoshiarai-rgb/agent-pipeline/tree/main/prompts) |
| `.github/ISSUE_TEMPLATE/agent-task.yml` | issue の入力を揃えるフォーム | [`install/issue-template.yml`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/issue-template.yml) |

- **`conventions.md`** には、命名・ディレクトリ構成・テストの置き場所など、守らせたい約束を
  書きます。パイプラインはあなたのリポジトリの流儀を知らないので、ここが唯一の伝え方です。
  埋めなかった節は削ってください（見出しだけが残ると、空の規約として渡ります）
- **`setup.sh`** はエージェントを動かす直前に実行されます（無ければ何もしません）。
  受け入れ条件に書いたテストコマンドが走る状態を、ここで作ってください。
  実行の直後にそのまま成果物をコミットするので、**生成物が `.gitignore` で無視されているか
  確認してください**（→
  [install/README.md の「前提」](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/README.md#前提)）
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

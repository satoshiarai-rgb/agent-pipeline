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

## 3. ファイルを置く

あなたのリポジトリで次を実行します。**既にあるファイルは上書きしません**。置いたあとに
やることも最後に表示されます。

```bash
curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/install.sh | bash
```

上書きしたいときは `--force` を渡します（パイプで渡すので `-s --` が必要です）。

```bash
curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/install.sh | bash -s -- --force
```

置かれるのは 4 つで、**必須はワークフロー 1 枚だけ**です。残りは雛形なので、使わないものは
ファイルごと削ってかまいません（無くても動きます）。

| 置き場所 | 内容 | 原本 |
|---|---|---|
| `.github/workflows/agent-pipeline.yml` | **必須。** 唯一の入口。中央を呼ぶだけなので直す箇所はありません | [`install/agent-pipeline.yml`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/agent-pipeline.yml) |
| `.agent/conventions.md` | 全エージェントに渡される、このリポジトリの約束事 | [`install/conventions.md`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/conventions.md) |
| `.agent/setup.sh` | テストを実行できる状態にするための準備 | [`install/setup.sh`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/setup.sh) |
| `.github/ISSUE_TEMPLATE/agent-task.yml` | issue の入力を揃えるフォーム | [`install/issue-template.yml`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/issue-template.yml) |

上限やモデルを変えるための `.agent/config.json` は既定では置きません（必要になってから
手順 4 で足します）。1 枚ずつ置きたい場合や版を指定したい場合は
[`install/README.md`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/README.md#コピー)
を参照してください。

ワークフローは 3 つのイベントを受けて、あとは本体の reusable workflow に任せます。

| イベント | 何が起きるか |
|---|---|
| issue に `agent:go` ラベルが付く | run を作って計画を始める |
| draft PR に `/agent ...` のコメント | 承認・差し戻し・再開を受ける（issue 側のコメントは見ません） |
| `claude/**` ブランチへの `agent-work/**` の push | 次のフェーズを起動する（フェーズの連鎖はこれで起きます） |

呼び出す側より広い権限は要求できないため、このワークフローが `contents` / `pull-requests` /
`issues` の write を宣言します（`id-token: write` も書いてありますが、これは将来の認証方式
（Workload Identity Federation）用で、現時点では使っていません）。作業ブランチへの push は
`concurrency` で直列化されます（理由はファイル内のコメントに書いてあります）。

参照先は **`@v1.0.3` のような正確な版**です（`install.sh` が置くファイルはそうなっています）。
**動かないタグなので、同じ入力で同じ動きが再現できます。**

- **上げるときは、このワークフローの `uses:` の版を書き換えて PR にします**（4 行）。
  何が変わるかは中央リポジトリのタグの差分で確認できます
- 自動で追随したいなら `@v1`（移動する major タグ）に書き換えることもできます。パッチを入れると
  付け替わるので、意図せず挙動が変わることを受け入れる場合だけにしてください
- `@main` は**開発版**です。パイプライン自体を開発している場合を除いて使わないでください

## 4. 置いた雛形を埋める（任意）

無くても動きます。必要なものだけ書いてください。

- **`.agent/conventions.md`** には、命名・ディレクトリ構成・テストの置き場所など、守らせたい
  約束を書きます。パイプラインはあなたのリポジトリの流儀を知らないので、ここが唯一の伝え方です。
  **埋めなかった節は削ってください**（見出しだけが残ると、空の規約として渡ります）
- **submodule を読ませたいなら、App をその submodule のリポジトリにも入れてください。**
  パイプラインは checkout のあとに `git submodule update --init --recursive` を試しますが、
  **失敗しても警告を出して続けます**（submodule 配下は空のままエージェントに渡ります）。
  これは、読めない submodule のために run 全体を落とさないためです
- **`.agent/setup.sh`** はエージェントを動かす直前に実行されます（無ければ何もしません）。
  受け入れ条件に書いたテストコマンドが走る状態を、ここで作ってください。
  実行の直後にそのまま成果物をコミットするので、**生成物が `.gitignore` で無視されているか
  確認してください**（→
  [install/README.md の「前提」](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/README.md#前提)）
- **`.agent/config.json`** で、レビューの往復回数・モデル・エージェントの上限・ツール・
  **承認できる人（`approvers`）**を、このリポジトリだけ変えられます（雛形は
  [`install/config.json`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/config.json)
  で、**上書きできるキーの一覧**です。値はすべて `null` = 既定を継承なので、変えたいキーにだけ
  値を書きます）

  ```json
  {
    "limits": { "dev_review_rounds": 3 },
    "models": { "reviewer": "claude-sonnet-5" },
    "agents": { "developer": { "timeout_minutes": 60 } }
  }
  ```

  規則は 3 つです。**書いたキーだけが上書きされ**（書かなかったキーは本体の既定に追従します）、
  **`null` は「既定を継承」**、**既定に無いキーや型違いはエラー**になります（誤字を黙って
  無視しないため）。エラーのときは一部だけ適用せず、`blocked` にして理由を PR にコメントします。
  フェーズの遷移そのものと版（`pipeline_version`）は本体のもので、上書きできません

  **組織のリポジトリで使うなら `approvers` を確認してください。** 既定は
  `["OWNER", "COLLABORATOR"]` で、組織のメンバーがコメントすると GitHub は `MEMBER` を返すため、
  `/agent approve` が `not_authorized: MEMBER` で弾かれます

  ```json
  { "approvers": ["OWNER", "COLLABORATOR", "MEMBER"] }
  ```
- **`.agent/prompts/<agent>.md`** はエージェントの考え方そのものを変えたいときに使います。
  雛形は置かれないので、本体の
  [`prompts/`](https://github.com/satoshiarai-rgb/agent-pipeline/tree/main/prompts) から写します
  → [customize-prompt.md](customize-prompt.md)

## 5. お試し実行で配線を確かめる

Claude を呼ばず、ダミーの成果物で最初から最後まで一巡させられます。トークンを使わずに、
ワークフローの配線・権限・ラベルだけを確認できます。`AGENT_DRY_RUN` が未設定なら
お試し実行になります（手順 3 のワークフローの `if` を参照）。

**起動ラベルは自分で作ります**（状態のラベル `agent:planning` などはパイプラインが必要に
なった時点で作りますが、起動用の `agent:go` だけは最初に用意する必要があります）。

```bash
gh label create agent:go --description "エージェントパイプラインを起動する" --color 1f883d
```

**`.agent/setup.sh` は雛形のまま `npm ci` を実行します。** あなたのリポジトリに
`package-lock.json` が無ければ失敗し、そのフェーズは `agent_failed` で止まります。
お試し実行の前に、中身を自分のリポジトリに合うものへ（あるいは空に）してください。

適当な issue を立てて `agent:go` ラベルを付けると、次が起きます。

1. `claude/issue-<n>` ブランチと作業ディレクトリができ、draft PR が開く
2. issue のラベルが `agent:go` から `agent:planning` に付け替わる
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

## 7. 版を上げる

配布先は**正確な版**（`@v1.0.3` のようなタグ）を参照しています。上げる作業は
**`.github/workflows/agent-pipeline.yml` の `uses:` の版を書き換えて PR にする**だけです（4 行）。

**`install.sh --force` は使わないでください。** `.agent/conventions.md` や `.agent/setup.sh` まで
雛形に戻ります（あなたが書いた内容が消えます）。上げるのはワークフローの版だけです。

**自動で PR を作らせるなら Dependabot** を使います（`install.sh` が
[`dependabot.yml`](https://github.com/satoshiarai-rgb/agent-pipeline/blob/main/install/dependabot.yml)
を置きます。既に `.github/dependabot.yml` があるなら、次の項目だけ足してください）。

```yaml
- package-ecosystem: github-actions
  directory: "/"
  schedule:
    interval: weekly
```

上げる前に見るところ:

- **中央のタグ間の差分**（`https://github.com/satoshiarai-rgb/agent-pipeline/compare/v1.0.3...v1.0.4`）
- **`pipeline_version` が上がっていないか。** 上がっている版に切り替えると、**進行中の run は
  `pipeline_version_mismatch` で止まります**（噛み合わない状態で続けて状態を失わないための設計です）。
  進行中の run が無いタイミング（`agent:` ラベルの付いた issue が無い状態）で上げてください。
  止まってしまった issue は、新しい issue で立て直します
- パッチ（`v1.0.x`）で `pipeline_version` は上げません。上げるときは major タグも上がります

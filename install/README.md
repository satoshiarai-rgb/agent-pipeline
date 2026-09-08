# 導入セット

配布先（パイプラインを使うリポジトリ）に置くファイルの原本。**手順の説明は
[`docs/installation.md`](../docs/installation.md) にあります。** ここは置き場所の対応表と、
コピーする前に確かめることだけを持ちます。

| 原本 | 置き場所 | 必須 |
|---|---|---|
| [`install.sh`](install.sh) | （コピーしない。実行するだけ） | 下の「コピー」を参照 |
| [`agent-pipeline.yml`](agent-pipeline.yml) | `.github/workflows/agent-pipeline.yml` | **必須。** これが唯一の入口 |
| [`conventions.md`](conventions.md) | `.agent/conventions.md` | 任意。このリポジトリの流儀を伝える唯一の手段 |
| [`setup.sh`](setup.sh) | `.agent/setup.sh` | 任意。テストを走らせる準備が必要なら |
| [`issue-template.yml`](issue-template.yml) | `.github/ISSUE_TEMPLATE/agent-task.yml` | 任意。issue の入力を揃える |
| [`config.json`](config.json) | `.agent/config.json` | 任意。往復回数・モデル・上限・ツール・承認できる人を変えたいときだけ |

`agent-pipeline.yml` は原則そのままコピーして使えます（中央の reusable workflow を呼ぶだけなので、
配布先ごとに変える箇所がありません）。残りは雛形で、中身を書き換えて使います。

**`config.json` は `install.sh` では置きません。** 中身は上書きできるキーの一覧で、値はすべて
`null`（= 既定を継承）です。何も変えないなら置く必要がなく、置いたまま値を書き入れると
その項目は中央の既定に追従しなくなります。変えたくなってから取ってください。

役割プロンプトの差し替え（`.agent/prompts/<agent>.md`）はここに雛形を置きません。本体の
[`prompts/`](../prompts) から必要なものを写してください →
[`docs/customize-prompt.md`](../docs/customize-prompt.md)。

## 前提

- **生成物が `.gitignore` で無視されていること。** パイプラインは `.agent/setup.sh` を
  実行したあと、同じワークスペースで成果物をコミットします。無視され忘れている生成物
  （`coverage/`、ビルド出力、`.venv`、`node_modules/` など）は PR に混ざり、レビュー対象の
  差分も汚します。パイプライン側では判別できないので、導入前に確かめてください
- GitHub App が**このリポジトリ**にインストールされていること。App はアカウント（または組織）に
  1 つ作れば使い回せます。本体リポジトリへのインストールは要りません（本体は public で、
  実行時の読み取りは `GITHUB_TOKEN` で足りるため）
- Secrets に `AGENT_APP_CLIENT_ID` / `AGENT_APP_PRIVATE_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`

**起動ラベル `agent:go` は自分で作ります。**

```bash
gh label create agent:go --description "エージェントパイプラインを起動する" --color 1f883d
```

状態のラベル（`agent:planning`、`agent:awaiting-human`、…）は事前に作らなくてよく、
パイプラインが必要になった時点で作ります。

## コピー

上の 4 つをまとめて置きます（**既にあるファイルは上書きしません**）。置いたあとに何をするかも
最後に出ます。

```bash
curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/install.sh | bash
```

上書きするなら `--force` を渡します（パイプ経由では `-s --` が必要です）。

```bash
curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/install.sh | bash -s -- --force
```

手元に本体の checkout があるなら、そこから置くこともできます（同じ内容です）。

```bash
bash <clone した場所>/install/install.sh
AGENT_PIPELINE_REF=v1 bash <clone した場所>/install/install.sh   # 版を指定する
```

1 つだけ欲しいときは、その原本を直接取ってください（`config.json` はこの方法だけです）。

```bash
BASE=https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install
mkdir -p .github/workflows .agent
curl -fsSL "$BASE/agent-pipeline.yml" -o .github/workflows/agent-pipeline.yml
curl -fsSL "$BASE/config.json" -o .agent/config.json
```

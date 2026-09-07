#!/usr/bin/env bash
# 配布先に導入セットを置く。
#
# 使い方（あなたのリポジトリの中で実行する）:
#   curl -fsSL https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/main/install/install.sh | bash
#   bash <agent-pipeline を clone した場所>/install/install.sh
#
#   --force               既にあるファイルを上書きする（既定は飛ばす）
#   AGENT_PIPELINE_REF    取ってくる版（既定 main）
#
# 手元に agent-pipeline の checkout があればそこから、無ければ GitHub から取ります。
# 置いたあと何を書くかは docs/installation.md にあります。
set -euo pipefail

REF=${AGENT_PIPELINE_REF:-main}
BASE="https://raw.githubusercontent.com/satoshiarai-rgb/agent-pipeline/${REF}/install"
FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

# このスクリプト自身の場所。curl | bash では実体が無いので空にする（GitHub から取る）
SELF=${BASH_SOURCE[0]:-}
SRC=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then SRC=$(cd "$(dirname "$SELF")" && pwd); fi

# 原本 | 置き場所 | 実行ビット
FILES="
agent.yml|.github/workflows/agent.yml|
conventions.md|.agent/conventions.md|
setup.sh|.agent/setup.sh|x
issue-template.yml|.github/ISSUE_TEMPLATE/agent-task.yml|
"

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "エラー: git リポジトリの中で実行してください" >&2
  exit 1
}
cd "$ROOT"

fetch() { # <原本> <置き場所>
  if [ -n "$SRC" ] && [ -f "$SRC/$1" ]; then
    cp "$SRC/$1" "$2"
  else
    curl -fsSL "$BASE/$1" -o "$2"
  fi
}

placed=0
skipped=0
while IFS='|' read -r src dest exec_bit; do
  [ -n "${src:-}" ] || continue
  if [ -e "$dest" ] && [ "$FORCE" = false ]; then
    echo "skip    ${dest}（既にある。上書きするなら --force）"
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  fetch "$src" "$dest"
  [ "$exec_bit" = "x" ] && chmod +x "$dest"
  echo "placed  $dest"
  placed=$((placed + 1))
done <<< "$FILES"

echo
echo "置いた: ${placed} / 飛ばした: ${skipped}（ref: ${REF}、場所: ${ROOT}）"
cat <<'NEXT'

次にやること（詳しくは docs/installation.md）:

  1. GitHub App をこのリポジトリにインストールする。App はアカウント（組織）に 1 つ作れば
     使い回せるので、作るのは初回だけ。本体へのインストールは不要（本体は public）。
     権限は Contents / Issues / Pull requests の Read & Write。Workflows 権限は与えない
  2. Secrets を 3 つ登録する
       gh secret set AGENT_APP_CLIENT_ID
       gh secret set AGENT_APP_PRIVATE_KEY < <秘密鍵>.pem
       gh secret set CLAUDE_CODE_OAUTH_TOKEN      # 手元で claude setup-token
  3. .agent/conventions.md を埋める（埋めない節は削る）。.agent/setup.sh にテストの準備を書く。
     使わない雛形はファイルごと削ってよい（無くても動く）
  4. .gitignore を確認する（setup.sh の実行後に、そのまま成果物をコミットするため）
  5. お試し実行で配線を確かめる。AGENT_DRY_RUN が未設定ならダミーの成果物で一巡する
       gh issue create --title "ダミー: 配線確認" --body "..."
       gh issue edit <n> --add-label agent:go
     一巡したら本番に切り替える
       gh variable set AGENT_DRY_RUN --body false
NEXT

#!/usr/bin/env bash
# ローカルでパイプラインを回す（開発用。配布はしない）。
#
#   使い方: 配布先リポジトリの作業ツリーで実行する
#     <agent-pipeline>/scripts/run-local.sh agent-work/issue-12 --issue 12
#     <agent-pipeline>/scripts/run-local.sh agent-work/issue-12          # 続きから
#     <agent-pipeline>/scripts/run-local.sh agent-work/issue-12 --approve
#
# **CI との違いは「連鎖のさせ方」だけ。** GitHub Actions ではフェーズの成果物を push して
# 次の run を起こすが、ここでは while ループが route を呼び直す。状態の正は同じ
# `events/*.json` で、遷移も契約の検査も同じ `dist/cli.js` が行う。
#
# **フェーズごとに `claude -p` を別プロセスで起動する。** レビュアーに生成側の思考過程を
# 渡さないという設計の前提（設計書 §7）は、プロセスが分かれていることで守られている。
# 1 セッションの中で役割を切り替える形にはしない。
#
# 前提: node / jq / claude（ログイン済み）。docker が要るかは配布先の setup.sh 次第
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)   # agent-pipeline（中央）の場所
CLI="$ROOT/dist/cli.js"
DIR=${1:-}
shift || true

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}
[ -n "$DIR" ] || usage
[ -f "$CLI" ] || { echo "エラー: $CLI がありません（agent-pipeline で bun run build）" >&2; exit 1; }

ISSUE="" ONCE=false DRY=false DUMMY=false APPROVE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --issue) ISSUE=${2:?}; shift 2 ;;
    --once) ONCE=true; shift ;;
    --dry) DRY=true; shift ;;          # claude を呼ばず route の判断だけ見る（1 フェーズで終わる）
    --dummy) DUMMY=true; shift ;;      # claude の代わりにダミー成果物を書く（CI の dry run と同じ）
    --approve) APPROVE=true; shift ;;  # 人間の承認（PR コメントの代わり）
    *) usage ;;
  esac
done

cli() { node "$CLI" "$@" --dir "$DIR"; }

if [ "$APPROVE" = true ]; then
  cli approve --association OWNER
  exit $?
fi

# run の入口。ブランチ名は CI と同じ形にしておく（state の見た目を揃えるため）
if [ ! -d "$DIR/events" ]; then
  [ -n "$ISSUE" ] || { echo "エラー: 新しい run には --issue が要ります" >&2; exit 2; }
  mkdir -p "$DIR"
  [ -f "$DIR/issue.md" ] || { echo "エラー: $DIR/issue.md に issue 本文を置いてください" >&2; exit 2; }
  cli bootstrap --issue "$ISSUE" --branch "claude/issue-$ISSUE" \
    --run-id "local-$(date -u +%Y%m%dT%H%M%SZ)" --attempt 1 > /dev/null
  echo "▶ bootstrap: $DIR"
fi

while :; do
  ROUTE=$(cli route) || { echo "route が失敗しました" >&2; exit 1; }
  ACTION=$(jq -r .action <<<"$ROUTE")
  PHASE=$(jq -r .phase <<<"$ROUTE")
  if [ "$ACTION" != "run" ]; then
    echo "■ 止まりました: phase=$PHASE action=$ACTION $(jq -r .reason <<<"$ROUTE")"
    [ "$PHASE" = "awaiting_human" ] && echo "  承認するなら: $0 $DIR --approve"
    exit 0
  fi

  AGENT=$(jq -r .run.agent <<<"$ROUTE")
  ARGS=$(jq -r .run.claude_args <<<"$ROUTE")
  RUN_ID="local-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "▶ ${PHASE} / ${AGENT}（${ARGS}）"
  if [ "$DRY" = true ]; then exit 0; fi

  cli start --run-id "$RUN_ID" --attempt 1 --agent "$AGENT" > /dev/null
  PROMPT=$(mktemp)
  cli compose --central "$ROOT" --out "$PROMPT" --run-id "$RUN_ID" --attempt 1 --repo . > /dev/null

  # 配布先の準備（CI の setup.sh の step と同じ環境変数を渡す）
  if [ -x .agent/setup.sh ]; then
    AGENT_NAME="$AGENT" AGENT_PHASE="$PHASE" AGENT_RUN_DIR="$DIR" bash .agent/setup.sh || true
  fi

  if [ "$DUMMY" = true ]; then
    # CI の dry run と同じダミー（実装はハーネス側。同じものを 2 か所に書かない）
    cli dummy --run-id "$RUN_ID" > /dev/null
    STATUS=0
  else
    # shellcheck disable=SC2086 — claude_args はフラグ列なので分割して渡す
    claude -p "$(cat "$PROMPT")" $ARGS
    STATUS=$?
  fi
  FAILED=""
  [ $STATUS -eq 0 ] || FAILED="--agent-failed"   # 失敗しても finish は必ず呼ぶ（状態を残す）

  # 「差分がある」の見方は CI と同じ（ブランチ全体 + 作業ツリー、agent-work は除く）
  BASE=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/main)
  CHANGED=$(mktemp)
  {
    git -c core.quotePath=false diff --name-only "$BASE...HEAD" -- . ':!agent-work' 2>/dev/null
    git -c core.quotePath=false status --porcelain -uall -- . ':!agent-work' | cut -c4-
  } | sort -u > "$CHANGED"

  # shellcheck disable=SC2086 — FAILED は空か --agent-failed
  RESULT=$(cli finish --run-id "$RUN_ID" --attempt 1 --changed-files "$CHANGED" $FAILED)
  echo "  → $(jq -r '"\(.phase) result=\(.result) \(.detail // "")"' <<<"$RESULT")"

  [ "$ONCE" = true ] && exit 0
done

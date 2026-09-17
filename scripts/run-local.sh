#!/usr/bin/env bash
# ローカルでパイプラインを回す（開発用。配布はしない）。
#
#   使い方: **配布先リポジトリの専用 worktree** で実行する（主チェックアウトでは回さない。
#           run ディレクトリ・作業ブランチ・dummy-src・submodule のずれが残って実作業と混ざる）
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

# 進行が見えるようにする。**いま何が走っていて、何分経ったか**が分からないと
# 30 分の実行を眺めるしかなくなる（実機でそうなった）
LOG_DIR=${AGENT_LOCAL_LOG_DIR:-${TMPDIR:-/tmp}/agent-local}
mkdir -p "$LOG_DIR"
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$1"; }
elapsed() { # elapsed <開始の epoch>
  local s=$(( $(date +%s) - $1 ))
  printf '%dm%02ds' $(( s / 60 )) $(( s % 60 ))
}

if [ "$APPROVE" = true ]; then
  cli approve --association OWNER
  exit $?
fi

# run の入口。ブランチ名は CI と同じ形にしておく（state の見た目を揃えるため）
if [ ! -d "$DIR/events" ]; then
  [ -n "$ISSUE" ] || { echo "エラー: 新しい run には --issue が要ります" >&2; exit 2; }
  mkdir -p "$DIR"
  [ -f "$DIR/issue.md" ] || { echo "エラー: $DIR/issue.md に issue 本文を置いてください" >&2; exit 2; }
  # CI の bootstrap は作業ブランチを作ってそこで作業する。記録と実体を合わせる
  BR="claude/issue-$ISSUE"
  git rev-parse --verify --quiet "$BR" > /dev/null || git checkout -q -b "$BR"
  [ "$(git branch --show-current)" = "$BR" ] || git checkout -q "$BR"
  cli bootstrap --issue "$ISSUE" --branch "$BR" \
    --run-id "$(date -u +%Y%m%d%H%M%S)" --attempt 1 > /dev/null
  say "bootstrap: ${DIR}（${BR}）"
fi

while :; do
  # `--central` は plugin として読ませる場所（CI では run-cli.sh が action の展開先を渡す）
  ROUTE=$(cli route --central "$ROOT") || { echo "route が失敗しました" >&2; exit 1; }
  ACTION=$(jq -r .action <<<"$ROUTE")
  PHASE=$(jq -r .phase <<<"$ROUTE")
  if [ "$ACTION" != "run" ]; then
    say "止まりました: phase=${PHASE} action=${ACTION} $(jq -r .reason <<<"$ROUTE")"
    [ "$PHASE" = "awaiting_human" ] && echo "  承認するなら: $0 $DIR --approve"
    exit 0
  fi

  AGENT=$(jq -r .run.agent <<<"$ROUTE")
  ARGS=$(jq -r .run.claude_args <<<"$ROUTE")
  # **run_id は数値にする。** ハーネスは GitHub の run id を数値として扱っていて、
  # 判断の記録の名前の検査（`<run_id>-<attempt>-<slug>.md`）も並び替えも数値前提。
  # `local-…` のような文字列を使うと成果物ごと invalid になる（実機で踏んだ）
  RUN_ID="$(date -u +%Y%m%d%H%M%S)"
  say "${PHASE} / ${AGENT} を開始"
  echo "    ${ARGS}"
  if [ "$DRY" = true ]; then exit 0; fi
  STARTED=$(date +%s)
  PHASE_LOG="$LOG_DIR/${RUN_ID}-${AGENT}.log"

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
    echo "    プロンプト: ${PROMPT}"
    echo "    ログ: ${PHASE_LOG}"
    # shellcheck disable=SC2086 — claude_args はフラグ列なので分割して渡す
    # tee でログに落としつつ流す。**pipefail なので claude の終了コードは PIPESTATUS で取る**
    claude -p "$(cat "$PROMPT")" $ARGS 2>&1 | tee "$PHASE_LOG"
    STATUS=${PIPESTATUS[0]}
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
  say "$(jq -r '"\(.phase) result=\(.result) \(.detail // "")"' <<<"$RESULT")（${AGENT} に $(elapsed "$STARTED")、コード差分 $(wc -l < "$CHANGED" | tr -d " ") ファイル）"

  [ "$ONCE" = true ] && exit 0
done

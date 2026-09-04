#!/usr/bin/env bash
# action.yml から呼ばれる実体。空の入力は引数に渡さない。
# 出力は JSON をそのままログに出しつつ、主要フィールドを個別の output に展開する。
set -euo pipefail

args=("$CLI_COMMAND" --dir "$CLI_DIR")

add() { # add <flag> <value>: 値が空なら渡さない
  [ -n "${2:-}" ] && args+=("$1" "$2")
  return 0
}
add --agent "${CLI_AGENT:-}"
add --run-id "${CLI_RUN_ID:-}"
add --attempt "${CLI_ATTEMPT:-}"
add --model "${CLI_MODEL:-}"
add --record-path "${CLI_RECORD_PATH:-}"
add --result "${CLI_RESULT:-}"
add --verdict "${CLI_VERDICT:-}"
add --api-error-status "${CLI_API_ERROR_STATUS:-}"
add --session-id "${CLI_SESSION_ID:-}"
add --association "${CLI_ASSOCIATION:-}"
add --body "${CLI_BODY:-}"
add --reason "${CLI_REASON:-}"
add --detail "${CLI_DETAIL:-}"
add --execution-file "${CLI_EXECUTION_FILE:-}"
add --changed-files "${CLI_CHANGED_FILES:-}"
add --repo "${CLI_REPO:-}"
# 中央のプロンプトは action 自身の展開先にある。書き出し先はランナーの作業領域
add --central "${CLI_CENTRAL:-$GITHUB_ACTION_PATH}"
add --out "${CLI_OUT:-${RUNNER_TEMP:-/tmp}/agent-prompt.md}"
[ "${CLI_AGENT_FAILED:-}" = "true" ] && args+=(--agent-failed)
[ "${CLI_OVERSIZE:-}" = "true" ] && args+=(--oversize)
[ "${CLI_ACCEPTANCE_PASSED:-}" = "true" ] && args+=(--acceptance-passed)

out=$(node "$GITHUB_ACTION_PATH/dist/cli.js" "${args[@]}")
echo "$out"

{
  echo "json=$(jq -c . <<<"$out")"
  # 最上位のスカラーと、route の run オブジェクトの中身を output に展開する
  jq -r 'to_entries[] | select((.value | type) as $t | $t != "object" and $t != "array")
         | "\(.key)=\(.value)"' <<<"$out"
  jq -r '(.run // {}) | to_entries[] | "\(.key)=\(.value)"' <<<"$out"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"

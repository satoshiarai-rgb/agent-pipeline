#!/usr/bin/env bash
# state.json の phase を issue のラベルに射影する（設計書 §2.3）。
#
# 必要な環境変数:
#   GH_TOKEN          App トークン
#   GITHUB_REPOSITORY owner/repo
#   RUN_DIR           agent-work/issue-<n>
#   CLI               dist/cli.js のパス
#   PR                （任意）PR 番号。phase=done なら draft を外す
#
# ラベル操作の失敗は状態を壊さない（設計書 §2.3）ので、失敗しても exit 0 で抜ける。
set -uo pipefail

INFO=$(node "$CLI" label --dir "$RUN_DIR") || { echo "::warning::ラベルの射影に失敗"; exit 0; }
TARGET=$(printf '%s' "$INFO" | jq -r .label)
ISSUE=$(printf '%s' "$INFO" | jq -r .issue)
PREFIX=$(printf '%s' "$INFO" | jq -r .prefix)
PHASE=$(printf '%s' "$INFO" | jq -r .phase)

# 付ける
if ! gh issue edit "$ISSUE" --repo "$GITHUB_REPOSITORY" --add-label "$TARGET" 2>/dev/null; then
  # ラベルが無ければ作ってから付け直す
  gh label create "$TARGET" --repo "$GITHUB_REPOSITORY" --color ededed \
    --description "エージェントパイプラインの状態: $PHASE" 2>/dev/null || true
  gh issue edit "$ISSUE" --repo "$GITHUB_REPOSITORY" --add-label "$TARGET" 2>/dev/null ||
    echo "::warning::ラベル $TARGET を付けられなかった"
fi

# 同じ prefix の古いラベルを外す（起動用ラベルもここで落ちる）
CURRENT=$(gh issue view "$ISSUE" --repo "$GITHUB_REPOSITORY" --json labels -q '.labels[].name' 2>/dev/null || true)
for l in $CURRENT; do
  case "$l" in
    "$PREFIX"*)
      [ "$l" = "$TARGET" ] && continue
      gh issue edit "$ISSUE" --repo "$GITHUB_REPOSITORY" --remove-label "$l" 2>/dev/null || true
      ;;
  esac
done

echo "- ラベル: \`$TARGET\`（issue #$ISSUE）" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

# 完了したら draft を外して人間のレビューに回す（設計書 §6.3）
if [ "$PHASE" = "done" ] && [ -n "${PR:-}" ]; then
  gh pr ready "$PR" --repo "$GITHUB_REPOSITORY" 2>/dev/null &&
    echo "- PR #$PR を ready for review にした" >> "${GITHUB_STEP_SUMMARY:-/dev/null}" ||
    echo "::warning::PR #$PR の ready 化に失敗"
fi
exit 0

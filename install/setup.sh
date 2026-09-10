#!/usr/bin/env bash
# 置き場所: あなたのリポジトリの .agent/setup.sh
#
# エージェントを動かす直前に、そのワークスペースで実行されます（無ければ何もしません）。
# 受け入れ条件に書いたテストコマンドが走る状態を、ここで作ってください。
# 中央リポジトリはあなたのツールチェーンを知りません。
#
# 渡ってくる環境変数（重い準備を必要なフェーズだけに絞れます）:
#   AGENT_NAME    これから走るエージェント（planner / plan-reviewer / developer /
#                 dev-reviewer / completion）
#   AGENT_PHASE   いまのフェーズ（planning / plan_review / developing / …）
#   AGENT_RUN_DIR run のディレクトリ（agent-work/issue-<n>）
#
# **失敗させないでください。** 非ゼロで終わるとそのフェーズが agent_failed になって
# 止まります。準備できなかったときは警告を出して exit 0 にし、受け入れ条件の
# `evidence` で「走らせられなかった」ことが分かるようにするのが安全です。
#
# 注意: この直後に同じワークスペースで成果物をコミットします。ここで作られる生成物
#       （依存、ビルド出力、カバレッジ）が .gitignore で無視されているか確認してください
#       （install/README.md の「前提」を参照）。
set -uo pipefail

# 読むだけのフェーズには重い準備が不要（例）。必要に応じて絞ってください
case "${AGENT_NAME:-}" in
  planner | plan-reviewer)
    echo "::notice title=setup.sh::${AGENT_NAME} は読むだけなので準備を飛ばす"
    exit 0
    ;;
esac

npm ci || {
  echo "::warning title=setup.sh::依存の用意に失敗した（テストは走らせられない）"
  exit 0
}

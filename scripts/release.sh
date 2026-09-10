#!/usr/bin/env bash
# 版を切る。使い方: scripts/release.sh v1.0.0
#
# **配布先は正確な版を参照する**（`@v1.0.3` のようなパッチまで含むタグ / 2026-09-10 の判断）。
# そのため 2 か所を書き換える。
#
#   1. main の `install/agent-pipeline.yml`（配布物の正）の参照を `@<version>` にして push
#   2. タグの中の**中央の自己参照**（composite action・reusable workflow・中央の checkout）も
#      `@<version>` にする
#
# 2 が必要なのは、配布先が `@v1.0.3` にピンしても reusable workflow の中が `@main` や `@v1` の
# ままだと、ハーネス本体（`dist/cli.js` を持つ composite action）が別の版から来てしまうため
# （A-11 の版ずれ）。書き換えたコミットを作り、そこにタグを置く。main の中央側は `@main` の
# ままなので、開発と検証は常に最新を通せる。
#
# タグは 2 本:
#   v1.0.3  動かない。**配布先が参照するのはこれ**
#   v1      移動する。最新の v1 系を指すだけの目印（自動追随したい場合に使える）
set -euo pipefail

VERSION=${1:?使い方: scripts/release.sh v1.0.0}
case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) : ;;
  *) echo "エラー: v<major>.<minor>.<patch> の形で指定してください（例: v1.0.0）" >&2; exit 1 ;;
esac
MAJOR=${VERSION%%.*}

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

[ -z "$(git status --porcelain)" ] || { echo "エラー: 作業ツリーがクリーンではありません" >&2; exit 1; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || { echo "エラー: main で実行してください（いま $BRANCH）" >&2; exit 1; }
git fetch origin --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  { echo "エラー: origin/main と一致していません（先に push するか取り込んでください）" >&2; exit 1; }

# 出荷するのはコミット済みの dist なので、ソースと一致しているかを確かめる
bun run lint
bunx tsc --noEmit
bun test
bun run check:dist

# 配布物（install/agent-pipeline.yml）の参照をこの版にする。**これは main に載せる** —
# install.sh は main から取るので、以降の導入はこの版を指す
VERSION="${VERSION}" perl -pi -e \
  's{(satoshiarai-rgb/agent-pipeline/\S+)\@v[0-9.]+}{$1\@$ENV{VERSION}}g' install/agent-pipeline.yml
if ! git diff --quiet -- install/agent-pipeline.yml; then
  git --no-pager diff --stat -- install/agent-pipeline.yml
  git commit --quiet -m "release: 配布物の参照を ${VERSION} にする" -- install/agent-pipeline.yml
  git push --quiet origin main
fi

TMP="release-$VERSION"
git switch --quiet --create "$TMP"
# 失敗しても書き換えを main に持ち出さない。**reset を先に置く** —
# 変更を抱えたまま switch すると、その変更が main の作業ツリーに移る（実際に踏んだ）
trap 'git reset --hard --quiet; git switch --quiet "${BRANCH}"; git branch --quiet -D "${TMP}" 2>/dev/null || true' EXIT

# 中央の自己参照だけを書き換える（配布先のラッパー install/*.yml は既に @v1 を指している）。
# perl のスクリプトは単一引用符で渡し、版は環境変数で渡す（$1 をシェルに食わせない）。
# 中央のワークフローに出てくる @main はすべて自分自身への参照なので、まとめて置き換えてよい
for f in .github/workflows/*.yml; do
  VERSION="${VERSION}" perl -pi -e \
    's/\@main\b/\@$ENV{VERSION}/g; s/^(\s*)ref: main$/$1ref: $ENV{VERSION}/g' "$f"
done
git --no-pager diff --stat -- .github/workflows

# 書き換え漏れがあればここで止める（漏れたまま出荷すると版ずれが残る）
if grep -rn "@main\|ref: main" .github/workflows/*.yml; then
  echo "エラー: 中央の自己参照が残っています" >&2
  exit 1
fi

git commit --quiet --all --message "release: ${VERSION}（中央の自己参照を @${MAJOR} にする）"
git tag --annotate "${VERSION}" --message "${VERSION}"
git tag --annotate --force "${MAJOR}" --message "${MAJOR}（${VERSION} を指す）"
git push --quiet origin "refs/tags/${VERSION}" "refs/tags/${MAJOR}" --force
echo "打ちました: ${VERSION} と ${MAJOR}（$(git rev-parse --short HEAD)）"

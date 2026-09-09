#!/usr/bin/env bash
# 版を切る。使い方: scripts/release.sh v1.0.0
#
# **タグの中では中央の自己参照を @<major> に書き換える。** 配布先が `@v1` にピンしたとき、
# reusable workflow だけでなくハーネス本体（`dist/cli.js` を持つ composite action）も
# 同じ版から来るようにするため（A-11 の版ずれ）。書き換えたコミットを作り、そこにタグを
# 置く。main は `@main` のままなので、開発と検証（compass-wiki は @main を参照）は
# 常に最新を通す。
#
# タグは 2 本:
#   v1.0.0  動かない。この時点の中身を指す
#   v1      移動する。パッチを入れたらここを付け替える（配布先はこれを参照する / Q-3）
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

TMP="release-$VERSION"
git switch --quiet --create "$TMP"
trap 'git switch --quiet "$BRANCH"; git branch --quiet -D "$TMP" 2>/dev/null || true' EXIT

# 中央の自己参照だけを書き換える（配布先のラッパー install/*.yml は既に @v1 を指している）
for f in .github/workflows/*.yml; do
  perl -pi -e "s{(satoshiarai-rgb/agent-pipeline\\S*)\\\@main}{\$1\\\@$MAJOR}g" "$f"
  perl -pi -e "s{^(\\s*)ref: main\$}{\$1ref: $MAJOR}g" "$f"
done
git diff --stat -- .github/workflows

git commit --quiet --all --message "release: $VERSION（中央の自己参照を @$MAJOR にする）"
git tag --annotate "$VERSION" --message "$VERSION"
git tag --annotate --force "$MAJOR" --message "$MAJOR（$VERSION を指す）"
git push --quiet origin "refs/tags/$VERSION" "refs/tags/$MAJOR" --force
echo "打ちました: $VERSION と $MAJOR（$(git rev-parse --short HEAD)）"

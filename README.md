# agent-pipeline

**issue を書くと、レビュー可能な PR が返ってくる。** その間の計画・実装・レビューを、
複数の Claude Code 実行の連鎖として GitHub Actions 上で回すパイプラインです。

使う側のリポジトリに置くのはワークフロー 1 枚と固有の設定だけで、共通部分は実行時に
このリポジトリを読みます。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/overview.md](docs/overview.md) | **何をするものか。** 全体の流れ、フェーズと成果物、PR に何が残るか、使い方 |
| [docs/installation.md](docs/installation.md) | **導入手順。** GitHub App、Secrets、ワークフロー、お試し実行での確認 |
| [docs/customize-prompt.md](docs/customize-prompt.md) | **エージェントの振る舞いを変える。** 規約とプロンプトの差し替え、守らせる決まり |
| [docs/troubleshooting.md](docs/troubleshooting.md) | **止まったとき。** `blocked` の理由と再開のしかた、症状別の見どころ |

## 現在の対応状況

実装中です。ダミーのエージェントでは完了まで一巡し、本物のエージェントでは計画レビューまで
実機で通っています。現時点の制約は次のとおりです。

- 参照は `@main` を指定してください（版のタグはまだありません）
- Claude の認証はサブスクリプションのトークン（`CLAUDE_CODE_OAUTH_TOKEN`）のみ
- レビューの往復回数・モデル・タイムアウトは、リポジトリごとに変更できません

## 開発

ランタイムは Node、bun は開発ツールチェーンとして使います。npm 依存はゼロです。

```bash
bun test              # 状態機械・契約・ワークフローの検査（git も GitHub API も触らない）
bun run lint          # biome
bun run build         # dist/cli.js を作る。src を変えたらコミットに含める
```

設計と現在地は `work/` 配下にあります。

| ファイル | 役割 |
|---|---|
| `work/agent-pipeline-design.md` | 設計書。仕様の正 |
| `work/agent-contract.md` | エージェントの入力と出力の契約 |
| `work/github-actions-architecture.md` | GitHub Actions の実装レベルに落としたもの |
| `work/worklist.md` | 確定した判断・残作業・未決事項。**現在地はここ** |
| `work/steps.md` | 段階的な実装手順と実機確認の手順 |
| `CLAUDE.md` | 実装時に壊してはいけない不変条件 |

# 雛形

`agent-work/issue-<n>/`（作業ディレクトリ）に置かれるファイルの雛形。
`state.json` はテストが形を検査している（`src/file/__tests__/`）。

利用者向けの説明——各ファイルの中身、`blocked` の理由と復旧手順——は
[`docs/troubleshooting.md`](../docs/troubleshooting.md) にある。ここには実装側の注記だけを置く。

- 作業ディレクトリを書くのはハーネス（`bootstrap.yml` / `dispatch.yml` / `comment.yml`）だけで、
  エージェントは `state.json` と `events/` を書かない（設計書 §7.1）
- **状態の正は `events/` のイベントログ**（1 イベント 1 ファイルの追記専用 / K-26）。
  `state.json` はその畳み込みのスナップショットで、**編集しても効かない**
- `log.md`（イベントを時刻順に連結した読み物）は未実装（A-34）。
  実装したら `docs/troubleshooting.md` のファイル一覧にも足すこと

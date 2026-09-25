---
name: shared-verdict
description: レビューの判定（reviews/*.md）を書く形式。plan-reviewer と dev-reviewer が同じ形で書く。書く直前に呼ぶ
---

# レビューの判定を書く

書き込み先は `## 出力` に示されたパス（例: `agent-work/issue-12/reviews/plan-02.md`）。
**番号はハーネスが決めているので、自分で採番しない。**

```markdown
---
verdict: request_changes
round: 2
reviewer: plan-reviewer
---

## 差し戻す理由

- AC-12-2 の検証方法が manual だが、既存の tests/auth_test.py で自動化できる

## 任意の指摘

- 命名は conventions.md に合わせるとよい（差し戻しの理由ではない）

確かめた範囲: <何を見たかを 1 行>
```

| キー・節 | 書き方 |
|---|---|
| `verdict` | `approve` か `request_changes`。**ハーネスはこの 1 行だけを見て遷移を決める** |
| `round` | 出力パスの番号（`plan-02.md` なら 2） |
| `reviewer` | 自分の役割名（`plan-reviewer` / `dev-reviewer`） |
| `## 差し戻す理由` | `request_changes` なら必ず書く。**この本文が次のエージェントへの入力になる**ので、何をどこでどう直せばよいかが分かる粒度で書く。`approve` なら節ごと置かない |
| `## 任意の指摘` | 差し戻すほどではないが直したほうがよいもの。**承認するときも書く**（捨てられず、次のエージェントに届く） |
| 確かめた範囲 | 何を見たかを 1 行。**項目ごとの「問題なし」は書かない** — 読み手が要るのは「何を直すか」で、それが埋もれる |

**差し戻すか任意の指摘にするかの基準は、役割ごとに違う**（あなたの役割のプロンプトにある）。
この skill は形式だけを持つ。

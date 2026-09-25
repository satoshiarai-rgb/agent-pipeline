---
name: shared-evidence
description: acceptance.json の受け入れ条件に status と evidence を付ける書き方と、それを照合する見方。developer が書き、dev-reviewer と completion が照合する
---

# 受け入れ条件に evidence を付ける・照合する

受け入れ条件は `AC-<issue>-<n>` の id で planner・developer・dev-reviewer・completion が同じものを指す。
**最終フェーズで全項目が `passed` であることが、run が終わる条件**になる。

## 書く（developer）

各項目の `status` と `evidence` だけを更新する。

```json
{
  "id": "AC-12-1",
  "description": "未ログインで /settings にアクセスするとログイン画面へ遷移する",
  "verification": "automated",
  "command": "npm test -- auth-redirect",
  "status": "passed",
  "evidence": "npm test -- auth-redirect: 3 passed, 0 failed"
}
```

- **`id` / `description` / `verification` は変えない**（id で照合するため）
- **`command` は直してよいが、黙って直さない。** planner がテストを書く前に予言したものなので、実際の
  テスト名と食い違うことがある。直したら判断の記録（`type: requirements`）に「元のコマンド / 直した
  コマンド / なぜ」を残し、`## 影響する受け入れ条件` にその id を書く
- **`status: passed` なら `evidence` を必ず書く**（空だと `blocked`）

| 項目 | `evidence` に書くこと |
|---|---|
| `automated` | コマンド + 走らせた場所 + 結果 |
| `manual` | 何をどう確かめたかを 1〜2 行。**「確認した」だけは不可** |
| 実行環境で走らせられないもの（DB やサービスが要るテスト） | PR の CI の結果（run の URL か、ジョブ名と結果） |

- 満たせなかった項目は `failed` にし、`evidence` に何が起きたかを書く。**通っていない項目を `passed`
  にしない**
- 条件そのものが誤っていると思うなら、書き換えずに判断の記録（`type: requirements`）に書く

## 照合する（dev-reviewer / completion）

| 項目 | 見ること |
|---|---|
| `automated` | **`command` を自分で実行し**、`evidence` の主張が実態と合っているか |
| `manual` | `evidence` が「何をどう確かめたか」を具体的に述べているか。「確認した」だけのものは根拠にならない |
| すべて | `status: passed` なのに通っていない項目が無いか。`command` を直した項目に判断の記録があるか |

- 照合する側は `acceptance.json` を書き換えない（`status` を更新するのは developer だけ）
- 通っていない項目を `passed` にして通過させない。未達は未達として `blocked` になるのが正しい

---
name: plan-writing
description: planner が plan.md と acceptance.json を書き、出す前に点検するための skill。形式と点検の一覧を reference として持つ。plan-reviewer は点検の一覧だけを使う
---

# 計画を書く・点検する

この skill の本体は 2 つの reference である。**必要な場面で、必要なほうだけを読む。**
reference は、この skill を呼んだときに示される base directory からの相対パスで `Read` する。

| reference | 読む場面 | 読む役割 |
|---|---|---|
| `references/format.md` | `plan.md` と `acceptance.json` を書く直前 | planner |
| `references/checklist.md` | 出す前の自己点検 / 計画の審査 | planner / plan-reviewer |

- **形式と点検の一覧はここが正である。** プロンプトや成果物に写さない（写すと片方だけが直って食い違う）
- **進め方（何を調べ、何を問い、誰に答えさせるか）はここには無い。** planner の進め方は
  `agent-pipeline:plan-grilling` と planner のプロンプトにある
- plan-reviewer は `references/format.md` を読まなくてよい。審査の基準は点検の一覧と、
  plan-reviewer のプロンプトにある

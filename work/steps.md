# 段階的実装ステップ

- 日付: 2026-09-04
- 位置づけ: `worklist.md` の項目を、GitHub Actions を理解しながら一つずつ進められる順序に並べ替えたもの。`worklist.md` が「何を漏らさないか」の台帳、この文書が「どの順で手を動かすか」の手順書
- 設計原則
  1. **1 ステップで新しく学ぶ Actions の概念は 1 つだけ。** 複数を同時に入れると、失敗したときに原因が切り分けられない
  2. **エージェント（Claude）は最後に入れる。** 状態機械が動くまでは `echo` で成果物を作るダミーで代替する。エージェントは遅くて高価で非決定的なので、土台のデバッグには向かない
  3. **先に潰すのは「失敗したら設計が変わる」リスク。** 具体的には認証（フェーズ A）。ここが通らないと上限時間の設計から作り直しになる
  4. 1 ステップ = 1 セッション（1 PR）。**必ず実機で 1 回動かしてから次に進む**。「動いたはず」を積み上げない

---

## 0. 先に押さえる用語（ここだけ読めば以降の YAML が読める）

### 4 つの階層

| 用語 | 実体 | 押さえどころ |
|---|---|---|
| **workflow** | `.github/workflows/*.yml` 1 ファイル | **イベントで起動する**。`on:` が起動条件 |
| **job** | workflow 内の実行単位 | **1 job = 1 台の使い捨て VM（runner）**。job 同士は既定で並列、`needs:` で直列化 |
| **step** | job 内の 1 手順 | `run:`（シェルを実行）か `uses:`（他人が作った部品を実行）のどちらか |
| **runner** | job が動く VM | job が終わると**消える**。job をまたいでファイルは残らない |

最初につまずくのはたいてい**「job をまたぐとファイルが消える」**点。だからこのパイプラインは、エージェント実行から成果物の commit・push までを**1 つの job の中で**やる。

### ワークフローの `run:` は push する前にローカルで走らせる

GitHub に push してからでないと分からない失敗を、手元で捕まえるためのテストがある。

```
bun test ./.github/workflows/__tests__/workflows.test.ts
```

検査するのは 3 つ。

1. **YAML の妥当性** — パースできるか、ファイル名と `name:` が一致しているか、中央 action の
   参照 ref が揃っているか（A-11 の版ずれ防止）
2. **`run:` ブロックのシェル構文** — 全ブロックを取り出して `bash -n` にかける
3. **dry run のダミーエージェントの実挙動** — 一時ディレクトリで全フェーズを実際に実行し、
   成果物・`acceptance.json` の妥当性・`verdict` の出力・シナリオ分岐を確認する

実際にこれで捕まえられた失敗が 2 つある。どちらも push して初めて気付いた。

| 失敗 | 原因 |
|---|---|
| `syntax error: unexpected end of file` | `case` の内側の heredoc は終端子の字下げが残って閉じない |
| ステップが無言で死ぬ | `ls 存在しない \| wc -l` が `pipefail` で失敗し、代入の終了ステータスが非ゼロになって `set -e` が殺す |

### `run:` の中で heredoc を書くときの罠

`run: |` のブロックスカラーには制約が 2 つ同時にかかる。

1. **全行がブロックのインデント以上**でなければならない（列 0 に書くとブロックが終わる）
2. **剥がされるのはブロックの共通インデントだけ**。`case` や `if` の内側に書くと字下げが残る

そのため heredoc の終端子は**ブロックの基準インデントにちょうど揃える**必要がある。
それより浅いと YAML が壊れ、深いと heredoc が閉じずに `syntax error: unexpected end of file` になる。

内側で使いたい場合は、基準インデントに関数として置いて呼び出す。

```yaml
run: |
  set -euo pipefail
  write_json() {
  cat > "$1" <<JSON
  {
    "status": "$2"
  }
  JSON
  }

  case "$PHASE" in
    planning) write_json out.json pending ;;
  esac
```

Step B-2 で実際に踏んだ。短い内容なら `printf` の方が安全。

### 状態を次のランに引き継ぐ手段

ランナーは使い捨てで、**コンテナは再利用されない**。ラン間で値を引き継ぐ手段は 4 つある。

| 手段 | 範囲 | 評価 |
|---|---|---|
| **git（commit & push）** | 無期限、ラン間・リポジトリ間 | **採用。** 人間が PR で読める / 履歴が残る / **push 自体が次の起動トリガーになる** / git が push を直列化するので二重実行が起きにくい |
| artifacts（`upload-artifact`） | 既定 90 日、ラン間で受け渡し可 | 人間が PR 上で読めず、保持期間で消える。成果物を後から追跡する設計に合わない |
| cache（`actions/cache`） | いつ消えてもよい前提 | 状態の正には使えない |
| job outputs / `needs` | **同一ラン内のみ** | B-4 の `route` job → `run` job の値渡しに使う。ラン間には使えない |

設計書 §2.3 の「状態の正は `agent-work/issue-<n>/state.yml`」は、この表の 1 行目を選んだという宣言。**コンテナ再利用に依存する設計は、並列実行・再実行・キューされたランが別マシンに乗った時点で壊れる**ため、その依存を最初から持たない。

なお git に置くだけでは連鎖しない。`GITHUB_TOKEN` の push では後続ワークフローが起動しないため、**「git に状態を置く」と「App トークンで push する」の組み合わせ**で初めてループになる。

### 再利用の 2 つの仕組み（名前が似ていて混同しやすい）

| | reusable workflow | composite action |
|---|---|---|
| 再利用の単位 | **job まるごと** | **step の束** |
| 書く場所 | `.github/workflows/x.yml` に `on: workflow_call` | `.github/actions/x/action.yml` に `runs.using: composite` |
| 呼び方 | `jobs.<id>.uses: owner/repo/.github/workflows/x.yml@ref` | step の中で `uses: owner/repo/.github/actions/x@ref` |
| 使い分け | イベントごとの入口（bootstrap / dispatch / approve） | 手順（トークン取得、状態読み、commit & push） |

このプロジェクトでは **reusable workflow = イベント単位、composite action = 手順単位**、ネストは呼ぶ側 → reusable の 2 段までに固定する（構成案 §1-2）。

### 認証まわり

- **`secrets`**: 秘密（App の秘密鍵）。ログに出ない。reusable workflow には `secrets: inherit` で渡す
- **`vars`**: 秘密でない識別子（Anthropic の組織 ID 等）。可視で構わないもの
- **`permissions`**: その workflow に自動で配られる `GITHUB_TOKEN` の権限。`id-token: write` は OIDC トークン（WIF 用）を要求する権限で、**呼ぶ側（配布先）に必要**
- **`GITHUB_TOKEN`**: 自動で配られるトークン。**これで push したコミットは後続の workflow を起動しない**（無限ループ防止の仕様）。だから自前の GitHub App のトークンを使う（スモークテストで確認済み）

### 同時実行

- **`concurrency`**: 同じグループ名の実行を直列化する。`cancel-in-progress: false` なら実行中を止めずにキューする。エージェント実行中の取り消しは成果物を失うので必ず `false`

---

## フェーズ A: 認証の土台

**目的**: 「Claude を CI から呼べる」ことを、パイプラインとは無関係に単体で確定させる。

**認証方式（K-7）**: Anthropic Console が未取得のため、**当面は Claude Team サブスクリプションの認証（`claude_code_oauth_token`）で全体を検証し、後日 Console + WIF に差し替える**（Step E-3）。設計書 §2.1 の「サブスク認証は個人シートに紐づき CI に向かない」という結論は目標構成として維持する。差し替えで変わるのは認証の 3 行と `permissions` だけなので、パイプライン本体の検証はこの方式で先に進められる。

### Step A-1: サブスクリプション認証で Claude を 1 回呼ぶ ✅ 完了（2026-09-04）

- **学ぶ概念**: `uses:` で他人の action を使う、`secrets` の使い方、`workflow_dispatch` による手動起動
- **やること**:
  1. ローカルで `claude setup-token` を実行し、長期の OAuth トークンを発行する（Pro / Max / Team / Enterprise プランで利用可能）
  2. 検証用リポジトリの Secrets に `CLAUDE_CODE_OAUTH_TOKEN` として登録する（秘密情報なので Variables ではなく Secrets）
  3. `ANTHROPIC_API_KEY` を登録していないことを確認する（API キーはサブスクトークンより優先される）
  4. `work/verify/step-a1/check-oauth.yml` を検証用リポジトリの `.github/workflows/check-oauth.yml` にコピーし、Actions タブから手動起動する
  - **このステップに GitHub App は不要**（App トークンが必要になるのは Step B-1 以降）。**OIDC を使わないので `id-token: write` も不要**
- **確認**: ログに Claude の応答（`subscription auth ok`）が出る
- **完了条件**: 手動起動で 1 回成功する → **達成**（`result: "subscription auth ok"`、`apiKeySource: "none"`、`claude-opus-5`）
- **つまずきやすい点**: `ANTHROPIC_API_KEY` が残っている（優先されて素通りする）、プランで指定モデルが使えない（`--model` を外して既定モデルで試す）、トークンを Variables に入れてしまう（ログに残る）
- **この方式の性質（後で差し替える理由）**: トークンは `claude setup-token` を実行した個人のサブスクに紐づく長期の秘密情報で、使用量はサブスクリプションに計上される。組織で共有する用途には向かない（公式ドキュメントも、複数リポジトリで共有する秘密には API キーを推奨している）
- 対応: worklist V-13、K-7

### Step A-2: 15 分かかる実行でも落ちないことを確認する（**Step E-3 まで延期を推奨**）

- **学ぶ概念**: step / job の `timeout-minutes`、長時間ステップの扱い
- **やること**: A-1 のプロンプトを、実行が 15 分程度に伸びるものに差し替えて流す
- **延期の判断**: このステップが検証していた唯一の failure mode（OIDC トークンの更新）は WIF 固有で、サブスクリプション認証では発生しない。一方でサブスクの 5 時間枠は CI とローカル作業で共有されており（V-14: 実測 45% 消費済み）、15 分の実行を試すコストが相対的に高い。**WIF に差し替える Step E-3 で実施するのが合理的**
- **サブスクリプション認証では、当初懸念した 10 分の壁は関係ない。** OAuth トークンは長期なので、OIDC トークンの更新という問題がそもそも発生しない。ここで確認したいのは「長い実行が job タイムアウトや使用量上限で落ちないか」
- **WIF に差し替えた後も問題ない**ことは実装確認済み: `base-action` v1.0.215（`base-action/src/workload-identity.ts`）は OIDC JWT をファイルに書き、**4 分間隔でバックグラウンド更新する**（GitHub の JWT 失効約 5 分より短い）。加えて SDK のクレデンシャルキャッシュを有効にする profile を書き、複数の `claude` プロセスが 1 つの交換済みトークンを共有して `jti_reused` を避けている
- **確認**: 15 分の実行が完走する。使用量上限に当たった場合は、action がどう失敗するか（エラーか待機か）を記録しておく（worklist V-14）
- **完了条件**: 15 分の実行が完走する
- **背景（WIF に差し替えたときの数字）**: Anthropic トークンの寿命は `min(ルールの token_lifetime_seconds, JWT 残寿命 × 2)` で、GitHub の JWT が約 5 分なので実効上限は約 10 分。つまり 10 分を超える実行は必ず 1 回以上の更新を経る（それを action が担う）
- 対応: worklist V-12（解消済み）
---

## フェーズ B: 状態機械（エージェント無し）

**目的**: パイプラインの心臓部である「push で次が動く」ループを、Claude を一切呼ばずに確定させる。すべて 1 リポジトリ内で完結させる。

### Step B-1: push で自分が再起動する連鎖と、その止め方 ✅ 完了（2026-09-04）

- **学ぶ概念**: `on: push` の `branches` / `paths` フィルタ、`[skip ci]`、`concurrency`
- **やること**: `work/verify/step-b1/check-loop.yml` を検証用リポジトリの `.github/workflows/check-loop.yml` にコピーし、`mode` を選んで手動起動する。4 モードあり、それぞれ 1 回の起動で 1 つの問いに答える
  - `normal`: 連鎖が 3 本まで進んで止まる（ループと停止条件）。**カウントは保存せず、`agent-work/loop/runs/` のファイル数から導出する**
  - `skip-single`: `[skip ci]` 付きの単独コミット → 次のランが立たない
  - `skip-mixed`: `[skip ci]` 付きと無しを 1 回の push にまとめる → **立つか立たないかがこの検証の本題**
  - `outside-paths`: `agent-work` の外だけを変更 → `paths` フィルタで起動しない
- **設計原則が 2 つ入っている**:
  1. push で起動したジョブは `workflow_dispatch` の入力を受け取れないため、モードも `agent-work/loop/mode` というファイルに書いて渡している。パイプライン本体の「状態はイベントではなく git 上のファイルに置く」原則の最小版
  2. **カウントを保存せず導出する。** 1 行の共有カウンタは、並行した 2 つの更新が rebase で自動マージされて「どちらのランも書いていない値」を生む余地がある。実行ごとに別ファイル（`<run_id>-<attempt>`）を作れば名前が衝突しないので、マージは常に「両方を保持」になる。本体でも `rounds` / `total_steps` を同じ形にする（worklist A-33）
- **確認**: 3 本のランが連鎖する。`[skip ci]` を付けたコミットでは連鎖が止まる。**`[skip ci]` を含むコミットと含まないコミットを混ぜた 1 回の push でどうなるかも試す**（start マーカーの push が失敗して 2 コミットまとまったときに無音で止まらないか）
- **完了条件**: 連鎖の起動と抑止を意図どおりに制御できる → **達成**。4 モードすべて期待どおり（normal: 3 ラン連鎖 / skip-single: 抑止 / skip-mixed: **抑止されない** = 判定は HEAD コミット / outside-paths: paths フィルタで起動せず）
- **この段階では持ち込まない**: state.yml、YAML パース、エージェント。数字を数えるだけ
- 対応: worklist V-5、V-6

### Step B-2: `state.json` と遷移表で「次に何をするか」を決める ✅ 完了（2026-09-04）

- **学ぶ概念**: step の `outputs` と step 間の値の受け渡し、`if:` 条件
- **やること**: `scripts/state.py`（`read` / `start` / `finish`）と `defaults.yml` の宣言的な遷移表を書く。ワークフローは 1 job のまま、エージェントの位置は `echo` で成果物ファイルを作るダミーに置き換える。`planning → plan_review → ... → done` を一巡させる
- **確認**: ダミーだけで `phase` が `bootstrap` から `done` まで進む。ラウンド上限と `total_steps` 上限で `blocked` になる
- **完了条件**: 状態機械が実機で一巡し、上限で止まる → **達成**（検証リポジトリ `compass-wiki`、`claude/issue-1`）
  - `bootstrap` → `planning` → `plan_review` → `awaiting_human` で停止（push ラン 3 本）
  - `op=approve` → `developing` → `dev_review` → `completing` → `done`（push ラン 3 本）
  - `runs/` に 5 件のレコード（全件 `finished_at` 済み・`result: ok`）、`state.json` は `phase: done`
  - `done` の push は `[skip ci]` 付きで後続のランが立たない（`continue_chain=false`）
  - **`uses:` で中央 action を呼べること、`$GITHUB_ACTION_PATH` がリポジトリ root を指すことを実機で確認**（V-10）
- **ここに単体テストを集中させる**: `state.py` は git も GitHub API も触らない純関数に寄せ、遷移の網羅テストをローカルで回す。以降のステップで最も壊れやすいのが遷移なので、ここで固める
- 対応: worklist I-1、A-19、A-21

### Step B-3: 手順を composite action に切り出す

- **学ぶ概念**: composite action、`inputs` / `outputs`、`$GITHUB_ACTION_PATH`
- **やること**: B-2 のワークフローから `app-token` / `read-state` / `finalize` を composite action に抜き出す。スクリプト呼び出しは**すべて composite の中に閉じる**（ワークフロー側の `run:` から中央のスクリプトを呼ぶと、中央リポジトリが checkout されていないので動かない）
- **確認**: `$GITHUB_ACTION_PATH/../../..` でリポジトリ root に到達できる（`../..` は `.github` 止まりで足りない）
- **完了条件**: ワークフロー本体が `uses:` の並びだけになる
- 対応: worklist I-4、I-5、A-9、A-10、V-10

### Step B-4: reusable workflow にする ✅ 完了（2026-09-04）

- **学ぶ概念**: `on: workflow_call`、`jobs.<id>.uses`、`needs` と job 間 outputs、reusable workflow の権限の継承
- **やること**: 配布先の 343 行を中央の reusable workflow 3 本に移し、ラッパーを 69 行にする
  - 中央 `.github/workflows/{bootstrap,approve,dispatch}.yml`（`on: workflow_call`）
  - 配布先はイベントを受けて `jobs.<id>.uses` で呼び分けるだけ。認証は `secrets: inherit`
  - ダミーエージェントは中央 `dispatch.yml` の `dry_run` 入力で分岐する。**新しい配布先を
    導入するときトークンを使わず配線を確認できるので、検証用の足場としてだけでなく
    本番でも役に立つ**（設計書 §9-9「小さな issue で 1 本通す」）
- **確認**: `route` の outputs が `run` に渡る。`route` が `agent=none` を返したとき `run` が skip される
- **完了条件**: 呼ぶ側が「イベントを振り分けるだけ」になる → **達成**（配布先 69 行 / 中央 366 行）
  - `bootstrap` → `awaiting_human` → 承認 → `done` まで、B-2 の 343 行版と同じ挙動で完走
  - **`secrets: inherit` で App の認証情報が中央の reusable workflow に渡ることを確認**（設計書 §8 の前提）
  - `route` → `run` の job outputs が reusable workflow の内部で渡ることを確認
  - 効果が早速出た: `pipefail` の修正を中央だけに入れ、配布先を触らずに反映できた
- **注意**: job を分けた瞬間に「ファイルは job をまたがない」が効いてくる。`route` は状態を読むだけ、`run` が改めて checkout する
- 対応: worklist I-6

### Step B-5: 中央と配布先の 2 リポジトリに分ける

- **学ぶ概念**: 別リポジトリの reusable workflow / composite action の参照、`secrets: inherit`、リポジトリの可視性と Actions のアクセス設定
- **やること**: 個人アカウント内に配布先役の検証用リポジトリを 1 つ作り、`uses: satoshiarai-rgb/agent-pipeline/.github/workflows/dispatch.yml@v1` で呼ぶ。App を両方のリポジトリにインストールする
- **確認**: 配布先の Secrets が `secrets: inherit` で中央の reusable に渡る。OIDC トークンの `job_workflow_ref` の実値をログに出して確認する
- **完了条件**: 配布先には `agent.yml` と `.agent/` しか無い状態で一巡する
- **判断が必要な点**: 個人アカウントには org の「Accessible from repositories in the organization」に相当する設定が無いため、**private リポジトリの reusable workflow は他リポジトリから参照できない**。中央を public にするか、検証中は 1 リポジトリで完結させるかを決める
- 対応: worklist V-7、V-8、V-9、V-11、A-11

---

## フェーズ C: 人間との接点

**目的**: 入口（issue）と承認（コメント）を付ける。ここまでで「Claude 以外の全部」が完成する。

### Step C-1: issue のラベルで起動する

- **学ぶ概念**: `on: issues: types: [labeled]`、`github.event` の中身、`author_association`、`gh` CLI
- **やること**: `bootstrap.yml`。`agent:go` ラベルで起動し、認可を確認してブランチ・雛形・draft PR を作る。冪等（ブランチがあれば何もしない）
- **確認**: 権限のない人がラベルを付けても何も起きない。ラベルを 2 回付けても二重に作られない
- **完了条件**: issue にラベルを付けるだけで、フェーズ B のループが最後まで回る
- 対応: worklist I-7、A-12、Q-2

### Step C-2: `/approve` コメントで再開する

- **学ぶ概念**: `on: issue_comment`（**PR にも発火する**こと）、イベントごとの `concurrency` グループの違い
- **やること**: `approve.yml`。`awaiting_human` のときだけ `developing` に進める。`if` に `github.event.issue.pull_request == null` を入れて PR 側のコメントを除外する（または PR → issue の逆引きを実装する）
- **確認**: `awaiting_human` 以外で `/approve` しても何も起きない。PR 側にコメントしてもジョブが落ちない
- **完了条件**: 人間の 1 回の承認を挟んで一巡する
- 対応: worklist I-7、A-13、Q-1

### Step C-3: ラベルの射影と PR の仕上げ

- **学ぶ概念**: `gh` によるラベル・PR 操作、失敗時のフォールバック
- **やること**: `labels.py` で `phase` → ラベルを射影。`completing → done` で `gh pr ready`。**push に失敗したときはラベルとコメントで人間に通知する**（git が使えない状況でも届く経路）
- **確認**: ラベル操作の失敗が状態を壊さない
- 対応: worklist I-2、A-7

---

## フェーズ D: エージェント投入

**目的**: ダミーを 1 体ずつ本物の Claude に置き換える。土台が固まっているので、ここからの失敗は「プロンプトの質」の問題に限定される。

**前提（2026-09-05 に完了）**: 配線は済んでいる。`compose-prompt` / `validate-artifacts` は composite ではなく
ハーネスの CLI コマンド（`compose` / `validate`）として実装され、`dispatch.yml` の `run` job が
`compose` → `base-action@v1.0.215` → `validate` → `finish` を通す（worklist I-9 / I-9b / I-9c / I-9d）。
既定プロンプト 5 本は中央の `prompts/<agent>.md` にある。したがって以下の各ステップでやることは
「そのエージェントを `dry_run: false` で走らせ、成果物の質を見てプロンプトを直す」ことに絞られる。

### Step D-0: 実機確認の手順（配線 → 本物）

配布先は `satoshiarai-rgb/compass-wiki`。`dry_run` はリポジトリ変数 `AGENT_DRY_RUN` で
切り替える（未設定なら dry run。`work/verify/check-dispatch.yml` を配布先にコピーしておく）。

**段 1: dry run で 1 周（トークン消費なし）** — 2026-09-05 に issue #5 で完了

```
gh variable delete AGENT_DRY_RUN --repo satoshiarai-rgb/compass-wiki   # 未設定 = dry run
gh issue create --repo satoshiarai-rgb/compass-wiki --title "ダミー: D-0 の配線確認" --body "..."
gh issue edit <n> --repo satoshiarai-rgb/compass-wiki --add-label agent:go
```

見るところ（I-9d で tail が変わったので、ここまでは同じ経路を通る）:

- bootstrap が `agent-work/issue-<n>/issue.md` を作っている（新しく足した / I-9d）
- run job の `compose` ステップの出力 `role_prompt` が中央の `prompts/<agent>.md` を指している
- `outcome` ステップのサマリーに「変更ファイル数」が出ていて、developing のときだけ 1 以上になる
- `validate` の `result` が `ok`。planning で `invalid` になるならダミーの `plan.md` の
  `## 規模判定` が届いていない
- `done` まで進み、ラベルが `agent:done` になり draft PR が ready になる

段 1 の結果（issue #5）: 上記すべて確認。`role_prompt` は
`_actions/satoshiarai-rgb/agent-pipeline/main/prompts/<agent>.md`、`prompt_path` は
`$RUNNER_TEMP/agent-prompt.md`、`setup.sh` が無い配布先では notice を出して通過、
`validate` は 5 フェーズすべて `ok`、`dispatch-live` は skip（二重起動なし）。

**段 2: 本物のエージェントで `awaiting_human` まで（planner + plan-reviewer の 2 実行）**

```
gh variable set AGENT_DRY_RUN --body false --repo satoshiarai-rgb/compass-wiki
gh issue create --repo satoshiarai-rgb/compass-wiki --title "<小さな実タスク>" --body "..."
gh issue edit <n> --repo satoshiarai-rgb/compass-wiki --add-label agent:go
```

承認しなければ `awaiting_human` で止まるので、ここで一度切れる。見るところ:

- `claude_args` が引用ごと壊れずに渡っている（`--tools` の値がそのまま 1 引数になっているか）
- `execution_file` / `session_id` の出力名が実在する（`runs/*.json` の `session_id` が埋まるか）
- `plan.md` に `## 規模判定` があり、`acceptance.json` が契約の形になっている
- `reviews/plan-01.md` の frontmatter に `verdict` がある。本文が次の planner に渡せる粒度か
- planner が `agent-work/` の外を書き換えていない（読み取り専用プロファイルの確認）

**段 3: 承認して developer 以降（3 実行）**

draft PR に `/agent approve` とコメントする。見るところ:

- `.agent/setup.sh` が無い配布先でも run job が落ちない
- developer の差分が `agent-work/` の外にある。`acceptance.json` の `passed` に `evidence` がある
- dev-reviewer が差分を読めている（`git diff origin/HEAD...HEAD` が空でない）
- completion が `completion.md` を書き、`done` になる

サブスクの 5 時間枠はローカルの Claude Code と共有される（V-13）。段 2 と段 3 は分けて回す。

### Step D-1: planner だけを本物にする

- **学ぶ概念**: `base-action` への入力、プロンプトの組み立て、成果物の検証
- **やること**: 小さな issue で planner を本物にする。組み立てと検証は実装済み（`compose` / `validate`）なので、見るのは `prompts/planner.md` の質と、`claude_args` / `prompt_file` / `execution_file` が実行時に食い違わないこと
- **確認**: 小さな issue で `plan.md` と `acceptance.yml` が出る。壊れた出力（frontmatter 欠落など）で `blocked` になる
- **完了条件**: planner → （ダミーのレビュアー）→ 一巡
- **ツールの制限はここで入れる**: `--allowedTools` は「確認を求めずに実行してよいツール」の指定であって制限ではない。planner に `Bash` を渡さないなら **`--tools`（許可リスト）か `--disallowed-tools`** を使う
- 対応: worklist I-9、I-10、A-24、A-25、A-20、A-23

### Step D-2: plan-reviewer と verdict による分岐

- **やること**: レビューファイルの frontmatter `verdict` だけで遷移を決める。レビュアーには成果物と issue 本文のパスだけを渡し、生成側のログは渡さない。出力先パス（`reviews/plan-01.md`）はハーネスが決めてプロンプトに渡す
- **確認**: `request_changes` で `planning` に戻り、ラウンド上限で `blocked` になる
- 対応: worklist I-11、A-18

### Step D-3: developer

- **学ぶ概念**: 配布先の `setup.sh` の実行、コード変更を含む commit
- **やること**: `.agent/setup.sh` を実行してから developer を動かす。`.github/workflows/**` への変更は禁止（プロンプトで指示し、`validate-artifacts` でも差分を検出して `blocked` にする）
- **確認**: コードと `acceptance.yml` の `status` 更新、`decisions.md` が出る。`status: passed` の項目に `evidence` があること
- 対応: worklist I-11、A-3、A-6、A-7

### Step D-4: dev-reviewer / Step D-5: completing

- **やること**: 差分ベースのレビューと、完了報告 + `gh pr ready`
- **確認**: `acceptance.yml` 全件 `passed` で `done`、そうでなければ `blocked`
- 対応: worklist I-11、Q-5

---

## フェーズ E: 運用

### Step E-1: stale 検知

- **学ぶ概念**: `on: schedule`（cron）
- **やること**: `stale.yml`。`last_run.started_at` が閾値を超え、`finished_at` が `null` の run を `blocked` にしてコメントする
- **なぜ必要か**: job タイムアウトで落ちると `finalize` が走らず、誰も push しないため run が無音で停止する。この経路を塞ぐまで「動いているつもりで止まっている」ことに気付けない
- 対応: worklist A-14、I-8

### Step E-2: 配布先 2 つ目へ展開

- **やること**: `install/` 一式を使って 2 つ目に導入し、過不足を洗う。タグ `v1` / `v1.0.0` を打つ
- 対応: worklist I-12、I-13、R-1、R-2

### Step E-3: Console + WIF へ認証を差し替える

- **学ぶ概念**: OIDC（`permissions.id-token: write`）、Secrets と Variables の使い分け
- **前提**: Anthropic Console のアカウントを取得済み（K-7 の解除）
- **やること**:
  1. Console → **Settings → Workload identity → Connect workload → GitHub Actions** で issuer（`https://token.actions.githubusercontent.com`、JWKS は discovery）、サービスアカウント、ルールを作る
  2. ルールの `match` は `subject_prefix: repo:<owner>/<repo>:`、`audience: https://api.anthropic.com`、`claims.repository_owner: <owner>`（案A）
  3. サービスアカウントが対象ワークスペースのメンバーになっていることを確認する
  4. `fdrl_...` / `svac_...` / 組織 UUID を **Variables** に登録する（秘密ではないので Secrets ではない）
  5. `claude_code_oauth_token` 入力を WIF の 3 入力に置き換え、workflow に `id-token: write` を追加する（**caller 側**に必要）
  6. **`CLAUDE_CODE_OAUTH_TOKEN` Secret を削除する**（残っていると federation より優先され、action は警告して素通りする）
  7. `work/verify/step-a1/check-wif.yml` で Step A-1 / A-2 を再実行する
- **失敗したときの切り分け**: 交換が拒否されると `401` と `Authentication failed` しか返らない（どの検査で落ちたかは伏せられる）。理由は Console の **Workload identity → History** に記録される。最も多い原因は `sub` の形式不一致（理由 `match_subject_prefix`）。`wif.yml` を `debug_claims: true` で起動すると実際の claim を表示できる
- **ここで初めてコスト制御が効く**: ワークスペース単位の月次支出上限（設計書 §7.5）は Console 前提。それまでの検証はサブスクリプションの使用量上限が唯一のブレーキになる
- 対応: worklist A-29、V-4、V-11、A-26、A-27

---

## この順序にした理由

- **A を最初に置いた**のは、トークン寿命の制約（約 10 分）が `defaults.yml` の上限時間やフェーズ分割そのものを変える可能性があるため。土台を作った後に判明すると作り直しになる
- **B でエージェントを使わない**のは、状態機械のバグとプロンプトのバグを同時にデバッグしないため。ダミーは数秒で終わり、無料で、決定的
- **C を D より前に置いた**のは、入口と承認が付いていれば D 以降の各ステップを「issue を立てて 1 本流す」形で試せるようになるため
- **E-1 を最後にしていない理由はない**が、B-2 の時点で「無音で止まる」経験をするので、必要性は体感してから作ることになる

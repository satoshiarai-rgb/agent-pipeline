import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Execution } from "./journal.ts";

/**
 * `conversations/<run_id>-<attempt>-<agent>-<NN>-<slug>.md` の 1 ファイル。
 * **エージェント同士のやり取りの生ログ**で、1 往復につき 1 ファイル書く（A-58）。
 *
 * 名前に `<agent>` と `<slug>` を入れるのは、**どのフェーズの誰と誰のやり取りか**を
 * 一覧で見分けるため（`...-planner-02-leader-performance.md`）。run の中には
 * 種類の違う往復が混ざる — planner の grilling（計画者 ⇄ 回答者）、レビューチームへの相談、
 * 成果物レビューの取りまとめ。番号だけでは後から追えない。
 *
 * 判断の記録（`journal/` と `decision-records/`）との違い:
 *
 *   判断の記録        片付いた決定の要約。次のエージェントと人間が読む（契約の一部）
 *   conversations     そこに至るやり取りそのもの。**後から経緯を追うための保管**
 *
 * ハーネスは**名前を決めて渡すだけ**で、中身は読まないし検査もしない（遷移に関わらない）。
 * 名前の prefix（`<run_id>-<attempt>`）をハーネスが決めるのは判断の記録と同じ理由で、
 * 実行をまたいだ上書きが構造的に起きないようにするため。
 */

const DIR = "conversations";

export function conversationsDir(dir: string): string {
  return join(dir, DIR);
}

/**
 * エージェントに伝える書き込み先。**通し番号と相手の名前（slug）をエージェントに任せる**。
 * prefix（`<run_id>-<attempt>-<agent>`）をハーネスが決めるのは判断の記録と同じ理由で、
 * 実行をまたいだ上書きが構造的に起きないようにするため。
 */
export function conversationPath(
  dir: string,
  run: Execution,
  agent: string,
  round: string,
  slug: string,
): string {
  return join(conversationsDir(dir), `${run.run_id}-${run.attempt}-${agent}-${round}-${slug}.md`);
}

/** 保管されているやり取りを名前順に返す。ディレクトリが無ければ空 */
export function conversationPaths(dir: string): string[] {
  const base = conversationsDir(dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(base, name));
}

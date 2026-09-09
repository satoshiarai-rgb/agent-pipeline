import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Execution } from "./decisionRecords.ts";

/**
 * `conversations/<run_id>-<attempt>-round-<NN>.md` の 1 ファイル。
 * **エージェント同士のやり取りの生ログ**で、planner が計画を詰める過程で
 * 計画者と回答者を往復させたときに、**回答者が 1 ラウンドにつき 1 ファイル書く**（A-58）。
 *
 * 決定記録（`decision-records/`）との違い:
 *
 *   decision-records  片付いた決定の要約。次のエージェントと人間が読む（契約の一部）
 *   conversations     そこに至るやり取りそのもの。**後から経緯を追うための保管**
 *
 * ハーネスは**名前を決めて渡すだけ**で、中身は読まないし検査もしない（遷移に関わらない）。
 * 名前の prefix（`<run_id>-<attempt>`）をハーネスが決めるのは決定記録と同じ理由で、
 * 実行をまたいだ上書きが構造的に起きないようにするため。
 */

const DIR = "conversations";

export function conversationsDir(dir: string): string {
  return join(dir, DIR);
}

/** エージェントに伝える書き込み先。ラウンド番号だけをエージェントに任せる */
export function conversationPath(dir: string, run: Execution, round: string): string {
  return join(conversationsDir(dir), `${run.run_id}-${run.attempt}-round-${round}.md`);
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

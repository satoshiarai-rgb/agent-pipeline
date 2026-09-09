import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Frontmatter, parseFrontmatter } from "../utils/frontmatter.ts";

/**
 * `decision-records/<run_id>-<attempt>-<slug>.md` の 1 ファイル（契約 §4）。
 * planner が「計画を詰める過程で片付いた決定」を、developer が「計画に無い判断」を、
 * 判断 1 つにつき 1 ファイルで書く。
 *
 * トピックごとにファイルを分けるので、追記が競合せず diff に新規ファイルとして現れる。
 * 名前の prefix（`<run_id>-<attempt>`）はハーネスが決めるため、実行をまたいだ名前の衝突
 * — 過去のラウンドの記録の上書き — が構造的に起きない。エージェントの裁量は `<slug>` だけ。
 *
 * frontmatter は機械が読む 4 つ（`type` / `title` / `reversibility` / `status`）だけで、内容は本文にある
 * （`reviews/*.md` と同じ「機械は frontmatter、人は本文」の形 / 設計書 §5.4）。
 *
 * ハーネスがするのは**名前と形の検査**（`decisionRecordProblems`）と**パスの列挙**
 * （`decisionRecordPaths` → 次のエージェントへの入力）だけで、中身は読まない。
 */
/** 実行を一意にする組。`runs/<agent>-<run_id>-<attempt>.json` と同じもの */
export interface Execution {
  run_id: string;
  attempt: number;
}

const DIR = "decision-records";
const SHAPE = "<run_id>-<attempt>-<slug>.md";

/** `<slug>` は英小文字・数字をハイフンで繋いだもの。日本語のタイトルは frontmatter に置く */
const NAME = /^(\d+)-(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const REVERSIBILITY = ["easy", "hard"];

/**
 * 判断の行き先（2026-09-09 に追加）。**書いてあれば検査するが、無くても違反にしない** —
 * 進行中の run や既存の配布先に `status` の無い記録が残っており、必須にすると
 * それらが次のフェーズで `invalid` になって止まるため。プロンプト側は必ず書かせる。
 *
 *   adopted   採択した（計画や実装に反映した）
 *   open      未処理（決めきれなかった。`plan.md` の「前提」にも未確認として残る）
 *   withdrawn 取り下げた（問い自体が成立しなくなった。経緯として残す）
 */
const STATUS = ["adopted", "open", "withdrawn"];

/**
 * 記録の種類（契約 §4）。「次に誰が受け取る記録か」だけで切る。
 * 何についての判断か（性能・構造など）は `title` と本文が持つので値にしない。
 *
 *   requirements 計画・受け入れ条件の不足や誤り     → planner / issue の作者
 *   design       実装方針の選択                     → dev-reviewer
 *   harness      パイプライン側の問題               → 中央リポジトリの保守者
 *   friction     判断ではない観察（詰まった点）     → 配布先 / 中央の改善ネタ
 */
const TYPES = ["requirements", "design", "harness", "friction"] as const;

export type DecisionType = (typeof TYPES)[number];

export function decisionRecordsDir(dir: string): string {
  return join(dir, DIR);
}

/** エージェントに伝える書き込み先。prefix はハーネスが決め、`<slug>` だけを任せる */
export function decisionRecordPath(dir: string, run: Execution, slug: string): string {
  return join(decisionRecordsDir(dir), `${run.run_id}-${run.attempt}-${slug}.md`);
}

/** 実行順（古い順）に返す。名前の prefix がそのまま実行の順序を持つ */
export function decisionRecordPaths(dir: string): string[] {
  const base = decisionRecordsDir(dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .sort(byExecution)
    .map((name) => join(base, name));
}

/**
 * 契約 §4 の違反を列挙する。空なら妥当（1 つも書かないことは違反ではない）。
 * エージェント（プロンプト差し替え可）が書くファイルなので、名前と形だけをここで見る。
 */
export function decisionRecordProblems(dir: string): string[] {
  return decisionRecordPaths(dir).flatMap((path) =>
    fileProblems(basename(path), readFileSync(path, "utf8")),
  );
}

/** frontmatter と本文の契約。満たしていれば null */
const CONTENT: ((f: Frontmatter) => string | null)[] = [
  ({ fields }) =>
    TYPES.includes(fields.type as DecisionType) ? null : `type は ${TYPES.join(" | ")}`,
  ({ fields }) => (fields.title ? null : "title が無い"),
  ({ fields }) =>
    REVERSIBILITY.includes(fields.reversibility ?? "") ? null : "reversibility は easy か hard",
  ({ fields }) => {
    // 無いのは許す（上の STATUS のコメント）。書いてあるなら 3 値のどれか
    if (fields.status === undefined) return null;
    if (STATUS.includes(fields.status)) return null;
    return `status は ${STATUS.join(" | ")}`;
  },
  ({ body }) => (body ? null : "本文が無い（何をどう決めたかを書く）"),
];

/** 名前の形 → frontmatter の有無 → 中身 の順に見る */
function fileProblems(name: string, text: string): string[] {
  const frontmatter = parseFrontmatter(text);
  return [
    NAME.test(name) ? null : `名前が ${SHAPE} ではない`,
    frontmatter ? null : "frontmatter が無い",
    ...(frontmatter ? CONTENT.map((check) => check(frontmatter)) : []),
  ]
    .filter((reason): reason is string => reason !== null)
    .map((reason) => `${name}: ${reason}`);
}

/** run_id と attempt は数値として比べる（桁数が変わっても順序が壊れない） */
function byExecution(a: string, b: string): number {
  const [aRun = 0, aAttempt = 0] = execution(a);
  const [bRun = 0, bAttempt = 0] = execution(b);
  return aRun - bRun || aAttempt - bAttempt || a.localeCompare(b);
}

const execution = (name: string): number[] => (NAME.exec(name)?.slice(1, 3) ?? []).map(Number);

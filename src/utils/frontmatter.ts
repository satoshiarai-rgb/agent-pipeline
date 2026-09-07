/**
 * frontmatter（ファイル先頭の `---` で囲まれたブロック）を読む。
 *
 * 機械が読むのは 1 行 1 スカラーの値だけ（`reviews/*.md` の `verdict`、
 * `decision-records/*.md` の `title` と `reversibility`）なので YAML パーサは持たない。
 * リストや入れ子は読まず、その分は本文側に置く決めにしている（契約 §4）。
 */
export interface Frontmatter {
  /** `key: value` の行だけを集めたもの */
  fields: Record<string, string>;
  /** frontmatter より下。書式は自由で、機械は読まない */
  body: string;
}

/** 先頭のブロックと、それ以降すべて */
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** `key: value` の 1 行。値は空でもよい（欠落として扱えるように） */
const FIELD = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/;

/** frontmatter が無ければ null（契約違反として呼び出し側が理由を付ける） */
export function parseFrontmatter(text: string): Frontmatter | null {
  const block = text.match(BLOCK);
  if (!block) return null;
  const fields = (block[1] as string)
    .split(/\r?\n/)
    .map((line) => line.match(FIELD))
    .filter((f): f is RegExpMatchArray => f !== null);
  return {
    fields: Object.fromEntries(fields.map((f) => [f[1] as string, (f[2] as string).trim()])),
    body: (block[2] ?? "").trim(),
  };
}

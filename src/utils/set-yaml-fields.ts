import type { Document } from "yaml";

/**
 * Document の指定フィールドだけを書き換えて文字列にする。
 * コメントとキー順は保持される（state.yml は blocked からの復旧で人間が編集するファイル）。
 */
export function setYamlFields(doc: Document, fields: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(fields)) doc.set(key, value);
  return doc.toString();
}

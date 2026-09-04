import { parseDocument } from "yaml";
import type { Document } from "yaml";

/**
 * コメントと書式を保持したまま編集できる Document として読む。
 * 書き戻す必要があるファイル（state.yml）に使う。
 */
export function parseYamlDocument(text: string): Document {
  return parseDocument(text);
}

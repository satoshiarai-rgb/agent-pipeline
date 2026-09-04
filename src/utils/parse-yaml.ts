import { parse } from "yaml";

/** YAML を素の値として読む。書き戻さない用途（defaults.yml、実行レコード） */
export function parseYaml<T>(text: string): T {
  return parse(text) as T;
}

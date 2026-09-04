import { stringify } from "yaml";

/** 機械が書くファイル（実行レコード）を YAML にする */
export function stringifyYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}

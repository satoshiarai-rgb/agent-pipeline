/**
 * 機械が書くファイル（state.json、実行レコード）を JSON にする。
 * キー順は呼び出し側が組み立てた順のまま保たれるので、差分が安定する。
 */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

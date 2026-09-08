/** JSON を読む。壊れているファイルはパスを添えて失敗させる */
export function parseJson<T>(text: string, source = "JSON"): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `${source} の解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

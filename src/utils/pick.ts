/**
 * source から keys の順番どおりにフィールドを取り出す。
 * JSON を書くときのキー順を配列 1 つで決められるようにするための関数
 * （キー順が固定されると差分が安定する）。undefined の項目は含めない。
 */
export function pick<T extends object, K extends readonly (keyof T)[]>(
  source: T,
  keys: K,
): { [P in K[number]]: T[P] } {
  const out = {} as { [P in K[number]]: T[P] };
  for (const key of keys) {
    if (source[key] !== undefined) out[key as K[number]] = source[key];
  }
  return out;
}

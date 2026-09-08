/**
 * イベントの時刻。**ISO 基本形式**（`20260908T054512Z`）でコロンを含めない
 * — コロンを含むファイル名は Windows でチェックアウトできないため（K-25）。
 * 書くのはこの形式だけなので、読み戻しもここに閉じる。
 */

export const formatTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** epoch ミリ秒に戻す。読めなければ null（古い形式や手書きのイベントを落とさない） */
export function parseTimestamp(timestamp: string): number | null {
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(timestamp);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

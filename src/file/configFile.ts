import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings, type Settings } from "../settings.ts";
import { mergeSettings } from "../utils/mergeSettings.ts";

/**
 * 配布先の `.agent/config.json`（既定値への差分）を読む。
 *
 * 書くのは人間だけで、ハーネスは読むだけ。上限・モデル・ツールを配布先ごとに変えられる
 * ようにするためのファイルで、無くても動く（A-19 / 設計書 §5.7）。
 * 重ね方の規則は `src/utils/merge-settings.ts` にある。
 */

/** 配布先のチェックアウトからの相対パス */
export const CONFIG_PATH = join(".agent", "config.json");

export interface LoadedSettings {
  settings: Settings;
  /** 読んだファイル。無ければ null（既定のまま動く） */
  source: string | null;
  /**
   * 上書きを受け付けられなかった理由。**null でないとき settings は既定のまま**。
   * 一部だけ適用すると「どの設定で動いたのか」が分からなくなるため、全体を捨てる。
   */
  error: string | null;
}

export function readConfig(repo: string): LoadedSettings {
  const path = join(repo, CONFIG_PATH);
  if (!existsSync(path)) return { settings: defaultSettings, source: null, error: null };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      settings: defaultSettings,
      source: path,
      error: `${CONFIG_PATH} が JSON として壊れています: ${detail}`,
    };
  }

  const { settings, errors } = mergeSettings(defaultSettings, raw);
  if (errors.length > 0) {
    return {
      settings: defaultSettings,
      source: path,
      error: `${CONFIG_PATH}: ${errors.join(" / ")}`,
    };
  }
  return { settings, source: path, error: null };
}

import type { Config } from "../defaults.ts";

/**
 * 既定値（`src/defaults.ts`）に配布先の上書きを重ねる（A-19 / K-11）。
 *
 * 規則は 4 つだけで、すべてこのファイルの中で表現している:
 *   - **書いたキーだけを上書きする**（深いマージ）。書かなかったキーは中央の既定に追従する
 *   - **`null` は「継承」**。既定に戻したいときに、キーを消さずに書ける
 *   - **既定に無いキーはエラー**（誤字を黙って無視しない）。型が違うのもエラー
 *   - **上書きできるのは下の OVERRIDABLE だけ。** 状態機械（`transitions`）と版の握手
 *     （`pipeline_version`）は中央のもので、配布先が変えると遷移の意味が壊れる
 *
 * エラーは投げずに集めて返す。呼び出し側（`route`）が `blocked` にして人間に伝えるため。
 */

/** 配布先が上書きできる最上位キー。ここに書かれていないキーは中央のもの */
const OVERRIDABLE = [
  "models",
  "limits",
  "tool_profiles",
  "agents",
  "approvers",
  "labels",
] as const satisfies readonly (keyof Config)[];

/** マージ後にだけ確かめられる整合性（1 つのキーだけを見ても決まらないもの） */
const CONSISTENCY: ((c: Config) => string | null)[] = [
  (c) => {
    const dangling = Object.entries(c.agents)
      .filter(([, a]) => !(a.tools in c.tool_profiles))
      .map(([name, a]) => `agents.${name}.tools=${a.tools}`);
    return dangling.length === 0
      ? null
      : `tool_profiles に無いプロファイルを指しています: ${dangling.join(", ")}（使えるのは ${Object.keys(c.tool_profiles).join(" / ")}）`;
  },
];

export interface MergeResult {
  config: Config;
  /** 空なら上書きは受け付けられた。1 つでもあれば config は既定のまま返る */
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 既定値の型に照らして 1 つの値をマージする。エラーは errors に積み、既定を返す */
function mergeValue(path: string, base: unknown, over: unknown, errors: string[]): unknown {
  // null は「継承」。既定に戻したいときにキーを消さずに書ける
  if (over === null) return base;

  // 既定が null のキー（models.reviewer）は型を決められないので、そのまま受ける
  if (base === null) return over;

  if (isRecord(base)) {
    if (!isRecord(over)) {
      errors.push(`${path}: オブジェクトを書いてください`);
      return base;
    }
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(over)) {
      if (!(key in base)) {
        errors.push(
          `${path}.${key}: 既定にないキーです（使えるのは ${Object.keys(base).join(" / ")}）`,
        );
        continue;
      }
      merged[key] = mergeValue(`${path}.${key}`, base[key], value, errors);
    }
    return merged;
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(over)) {
      errors.push(`${path}: 配列を書いてください`);
      return base;
    }
    // 置き換える（既定に足すのではない）。approvers を絞れるようにするため
    const wrong = over.filter((v) => typeof v !== typeof base[0]);
    if (wrong.length > 0) {
      errors.push(`${path}: 要素は ${typeof base[0]} で書いてください`);
      return base;
    }
    return over;
  }

  if (typeof base !== typeof over) {
    errors.push(`${path}: ${typeof base} で書いてください（いまは ${typeof over}）`);
    return base;
  }

  // 上書きできる数値はすべて回数か分数なので、1 以上の整数に限る
  // （0 や小数を受けると、実行されないまま止まる run になる）
  if (typeof over === "number" && (!Number.isInteger(over) || over < 1)) {
    errors.push(`${path}: 1 以上の整数で書いてください（いまは ${over}）`);
    return base;
  }

  return over;
}

/** 既定値に上書きを重ねる。errors が空でなければ config は base のまま */
export function mergeConfig(base: Config, override: unknown): MergeResult {
  const errors: string[] = [];
  if (!isRecord(override))
    return { config: base, errors: ["最上位はオブジェクトで書いてください"] };

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!(OVERRIDABLE as readonly string[]).includes(key)) {
      errors.push(
        `${key}: 配布先では上書きできません（上書きできるのは ${OVERRIDABLE.join(" / ")}）`,
      );
      continue;
    }
    merged[key] = mergeValue(key, merged[key], value, errors);
  }

  const config = merged as unknown as Config;
  errors.push(...CONSISTENCY.map((check) => check(config)).filter((e): e is string => e !== null));
  return errors.length > 0 ? { config: base, errors } : { config, errors };
}

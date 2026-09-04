import type { Config } from "../types.ts";
import { parseYaml } from "./parse-yaml.ts";

/** defaults.yml を読む（配布先の config.yml とのマージは Step B-5 で足す / A-19） */
export function loadConfig(text: string): Config {
  return parseYaml<Config>(text);
}

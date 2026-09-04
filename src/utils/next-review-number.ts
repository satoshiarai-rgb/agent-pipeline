import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** reviews/<kind>-NN.md の次の番号。番号はハーネスが決める（エージェントは rounds を知らない） */
export function nextReviewNumber(dir: string, kind: "plan" | "dev"): number {
  const reviews = join(dir, "reviews");
  if (!existsSync(reviews)) return 1;
  return (
    readdirSync(reviews).filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".md")).length + 1
  );
}

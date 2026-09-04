import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../utils/load-config.ts";
import type { AgentName, RunRecord, Verdict } from "../types.ts";

export const defaultsText = readFileSync(join(import.meta.dir, "../../defaults.yml"), "utf8");
export const config = () => loadConfig(defaultsText);

let seq = 0;
export const rec = (agent: AgentName, over: Partial<RunRecord> = {}): RunRecord => ({
  agent,
  phase: "planning",
  run_id: String(++seq),
  attempt: 1,
  started_at: "2026-09-04T10:00:00Z",
  finished_at: "2026-09-04T10:05:00Z",
  result: "ok",
  verdict: null,
  ...over,
});

export const review = (agent: AgentName, verdict: Verdict) => rec(agent, { verdict });

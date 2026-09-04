#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from "node:util";

// src/index.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";

// src/utils/derive-run-stats.ts
function deriveRunStats(records) {
  return {
    total_steps: records.length,
    rounds: {
      plan_review: records.filter((r) => r.agent === "plan-reviewer").length,
      dev_review: records.filter((r) => r.agent === "dev-reviewer").length
    },
    in_flight: records.find((r) => r.finished_at === null) ?? null
  };
}

// src/utils/resolve-agent.ts
function resolveAgent(config, agent) {
  const a = config.agents[agent];
  if (!a)
    throw new Error(`既定値に agents.${agent} がありません`);
  const tools = config.tool_profiles[a.tools];
  if (!tools)
    throw new Error(`tool_profiles に ${a.tools} がありません`);
  const isReviewer = agent === "plan-reviewer" || agent === "dev-reviewer";
  return {
    agent,
    model: (isReviewer ? config.models.reviewer : null) ?? config.models.default,
    max_turns: a.max_turns,
    timeout_minutes: a.timeout_minutes,
    tools
  };
}

// src/transitions.ts
var IDLE_PHASES = ["bootstrap", "awaiting_human", "done", "blocked"];
var TERMINAL_PHASES = ["done", "blocked"];
var isIdle = (phase) => IDLE_PHASES.includes(phase);
var isTerminal = (phase) => TERMINAL_PHASES.includes(phase);
function agentFor(phase, config) {
  return config.transitions[phase]?.agent ?? null;
}
function reviewKindFor(phase, config) {
  return config.transitions[phase]?.review_kind ?? null;
}
function roundKeyFor(phase, config) {
  return config.transitions[phase]?.round_key ?? null;
}
function nextPhase(phase, event, config) {
  const t = config.transitions[phase];
  if (!t)
    return null;
  switch (event) {
    case "ok":
      return t.on_ok ?? null;
    case "approve":
      return t.on_approve ?? null;
    case "request_changes":
      return t.on_request_changes ?? null;
    case "pass":
      return t.on_pass ?? null;
    case "fail":
      return t.on_fail ?? null;
    case "approval":
      return t.on_approval ?? null;
  }
}
function route(input) {
  const { phase, records, config } = input;
  const stats = deriveRunStats(records);
  const base = { phase, total_steps: stats.total_steps, rounds: stats.rounds };
  if (isIdle(phase))
    return { ...base, action: "none", reason: `phase_${phase}` };
  if (stats.in_flight) {
    return {
      ...base,
      action: "none",
      reason: `run_in_progress: ${stats.in_flight.agent} run=${stats.in_flight.run_id}`
    };
  }
  if (stats.total_steps >= config.limits.total_steps) {
    return {
      ...base,
      action: "block",
      reason: `total_steps_exceeded: ${stats.total_steps}/${config.limits.total_steps}`
    };
  }
  const agent = agentFor(phase, config);
  if (!agent)
    return { ...base, action: "block", reason: `no_transition_for_phase: ${phase}` };
  return { ...base, action: "run", reason: "dispatch", run: resolveAgent(config, agent) };
}

// src/commands/human-transition.ts
function humanTransition(input) {
  const { phase, association, config, event } = input;
  if (!config.approvers.includes(association)) {
    return { ok: false, reason: `not_authorized: ${association}` };
  }
  const next = nextPhase(phase, event, config);
  if (!next)
    return { ok: false, reason: `not_awaiting_approval: phase=${phase}` };
  return { ok: true, phase: next };
}

// src/commands/approve.ts
function approve(input) {
  return humanTransition({ ...input, event: "approval" });
}

// src/commands/finish.ts
function blocked(reason) {
  return { phase: "blocked", blocked_reason: reason, continue_chain: false, reason };
}
function advance(phase, event, config, reason) {
  const next = nextPhase(phase, event, config);
  if (!next)
    return blocked(`transition_incomplete: ${phase} (${event})`);
  return { phase: next, blocked_reason: null, continue_chain: !isTerminal(next), reason };
}
function finish(input) {
  const { phase, records, config, outcome } = input;
  if (outcome.result === "api_error") {
    return blocked(`api_error:${outcome.api_error_status ?? "unknown"}`);
  }
  if (outcome.result === "invalid")
    return blocked("invalid_artifacts");
  if (outcome.result === "agent_failed")
    return blocked("agent_failed");
  if (outcome.oversize)
    return blocked("oversize: issue の分割が必要");
  const roundKey = roundKeyFor(phase, config);
  if (roundKey) {
    if (outcome.verdict === "approve")
      return advance(phase, "approve", config, "approve");
    if (outcome.verdict !== "request_changes")
      return blocked("missing_verdict");
    const used = deriveRunStats(records).rounds[roundKey];
    const limit = config.limits[`${roundKey}_rounds`];
    if (used >= limit)
      return blocked(`${roundKey}_rounds_exceeded: ${used}/${limit}`);
    return advance(phase, "request_changes", config, `request_changes (${used}/${limit})`);
  }
  const canPass = nextPhase(phase, "pass", config) !== null;
  if (canPass && !outcome.acceptance_passed)
    return blocked("acceptance_not_passed");
  if (canPass)
    return advance(phase, "pass", config, "acceptance_passed");
  return advance(phase, "ok", config, "ok");
}

// src/commands/request-changes.ts
function requestChanges(input) {
  return humanTransition({ ...input, event: "request_changes" });
}

// src/utils/parse-json.ts
function parseJson(text, source = "JSON") {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${source} の解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// src/utils/stringify-json.ts
function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}

// src/state-file.ts
function parseStateFile(text) {
  const raw = parseJson(text, "state.json");
  if (typeof raw.phase !== "string" || typeof raw.issue !== "number") {
    throw new Error("state.json に issue か phase がありません");
  }
  return {
    meta: {
      pipeline_version: Number(raw.pipeline_version ?? 0),
      issue: raw.issue,
      branch: typeof raw.branch === "string" ? raw.branch : "",
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null
    },
    phase: raw.phase,
    blocked_reason: typeof raw.blocked_reason === "string" ? raw.blocked_reason : null
  };
}
function renderStateFile(file, patch) {
  return stringifyJson({
    pipeline_version: file.meta.pipeline_version,
    issue: file.meta.issue,
    branch: file.meta.branch,
    phase: patch.phase,
    blocked_reason: patch.blocked_reason,
    updated_at: patch.now.toISOString().replace(/\.\d{3}Z$/, "Z")
  });
}
function checkPipelineVersion(meta, config) {
  return meta.pipeline_version === config.pipeline_version ? null : `pipeline_version_mismatch: run=${meta.pipeline_version} harness=${config.pipeline_version}`;
}

// src/utils/next-review-number.ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
function nextReviewNumber(dir, kind) {
  const reviews = join(dir, "reviews");
  if (!existsSync(reviews))
    return 1;
  return readdirSync(reviews).filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".md")).length + 1;
}

// src/utils/parse-record.ts
function parseRecord(text) {
  const r = parseJson(text, "実行レコード");
  if (!r?.agent || !r.run_id)
    throw new Error("実行レコードに agent か run_id がありません");
  return { ...r, finished_at: r.finished_at ?? null };
}

// src/utils/read-run-dir.ts
import { existsSync as existsSync2, readdirSync as readdirSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";
function readRunDir(dir) {
  const runsDir = join2(dir, "runs");
  const records = existsSync2(runsDir) ? readdirSync2(runsDir).filter((n) => n.endsWith(".json")).sort().map((n) => ({ path: join2(runsDir, n), text: readFileSync(join2(runsDir, n), "utf8") })) : [];
  return { stateText: readFileSync(join2(dir, "state.json"), "utf8"), records };
}

// src/utils/render-review.ts
function renderReview(input) {
  const { verdict, round, reviewer, body } = input;
  return `---
verdict: ${verdict}
round: ${round}
reviewer: ${reviewer}
---

${body.trim()}
`;
}

// src/defaults.ts
var defaults = {
  pipeline_version: 1,
  models: {
    default: "claude-opus-5",
    reviewer: null
  },
  limits: {
    plan_review_rounds: 2,
    dev_review_rounds: 2,
    total_steps: 12
  },
  tool_profiles: {
    readonly: "Read,Glob,Grep,Write",
    exec: "Read,Glob,Grep,Write,Edit,Bash"
  },
  agents: {
    planner: { max_turns: 25, timeout_minutes: 20, tools: "readonly" },
    "plan-reviewer": { max_turns: 15, timeout_minutes: 15, tools: "readonly" },
    developer: { max_turns: 40, timeout_minutes: 45, tools: "exec" },
    "dev-reviewer": { max_turns: 20, timeout_minutes: 20, tools: "exec" },
    completion: { max_turns: 15, timeout_minutes: 15, tools: "exec" }
  },
  approvers: ["OWNER", "COLLABORATOR"],
  transitions: {
    planning: { agent: "planner", on_ok: "plan_review" },
    plan_review: {
      agent: "plan-reviewer",
      round_key: "plan_review",
      on_approve: "awaiting_human",
      on_request_changes: "planning"
    },
    developing: { agent: "developer", on_ok: "dev_review" },
    dev_review: {
      agent: "dev-reviewer",
      round_key: "dev_review",
      on_approve: "completing",
      on_request_changes: "developing"
    },
    completing: { agent: "completion", on_pass: "done", on_fail: "blocked" },
    awaiting_human: {
      on_approval: "developing",
      on_request_changes: "planning",
      review_kind: "plan"
    }
  }
};

// src/index.ts
var load = (dir) => {
  const { stateText, records } = readRunDir(dir);
  return { file: parseStateFile(stateText), records: records.map((r) => parseRecord(r.text)) };
};
var recordName = (r) => `${r.agent}-${r.run_id}-${r.attempt}.json`;
var writeState = (dir, file, patch, now) => writeFileSync(join3(dir, "state.json"), renderStateFile(file, { ...patch, now }));
function startRun(input) {
  const { dir, agent, run_id, attempt, model, now = new Date } = input;
  const { file } = load(dir);
  const record = {
    agent,
    phase: file.phase,
    run_id,
    attempt,
    started_at: now.toISOString(),
    finished_at: null,
    result: null,
    verdict: null,
    model,
    session_id: null
  };
  const path = join3(dir, "runs", recordName({ agent, run_id, attempt }));
  mkdirSync(join3(dir, "runs"), { recursive: true });
  writeFileSync(path, stringifyJson(record));
  return { record_path: path };
}
function routeRun(input) {
  const { file, records } = load(input.dir);
  const mismatch = checkPipelineVersion(file.meta, input.config);
  if (mismatch) {
    return {
      action: "block",
      reason: mismatch,
      phase: file.phase,
      total_steps: records.length,
      rounds: { plan_review: 0, dev_review: 0 }
    };
  }
  return route({ phase: file.phase, records, config: input.config });
}
function finishRun(input) {
  const { dir, record_path, outcome, config, session_id = null, now = new Date } = input;
  const before = load(dir);
  const current = before.records.find((r) => record_path.endsWith(recordName(r)));
  if (!current)
    throw new Error(`実行レコードが見つかりません: ${record_path}`);
  const updated = {
    ...current,
    finished_at: now.toISOString(),
    result: outcome.result,
    verdict: outcome.verdict ?? null,
    session_id: session_id ?? current.session_id ?? null
  };
  writeFileSync(record_path, stringifyJson({ ...updated, api_error_status: outcome.api_error_status ?? null }));
  const records = before.records.map((r) => r === current ? updated : r);
  const result = finish({ phase: before.file.phase, records, config, outcome });
  writeState(dir, before.file, result, now);
  return result;
}
function approveRun(input) {
  const { dir, association, config, now = new Date } = input;
  const { file } = load(dir);
  const decision = approve({ phase: file.phase, association, config });
  if (!decision.ok)
    return decision;
  writeState(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return decision;
}
function requestChangesRun(input) {
  const { dir, association, body, config, now = new Date } = input;
  const { file } = load(dir);
  const decision = requestChanges({ phase: file.phase, association, config });
  if (!decision.ok)
    return decision;
  const kind = reviewKindFor(file.phase, config) ?? "plan";
  const round = nextReviewNumber(dir, kind);
  const review_path = join3(dir, "reviews", `${kind}-${String(round).padStart(2, "0")}.md`);
  mkdirSync(join3(dir, "reviews"), { recursive: true });
  writeFileSync(review_path, renderReview({ verdict: "request_changes", round, reviewer: `human:${association}`, body }));
  writeState(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return { ...decision, review_path };
}
function blockRun(input) {
  const { dir, reason, now = new Date } = input;
  const { file } = load(dir);
  const result = {
    phase: "blocked",
    blocked_reason: reason,
    continue_chain: false,
    reason
  };
  writeState(dir, file, result, now);
  return result;
}

// src/cli.ts
var USAGE = `使い方: cli.ts <command> --dir <agent-work/issue-N> [options]

commands:
  start    エージェント実行の開始を記録する   --agent --run-id --attempt [--model]
  route    次に何をするかを決める
  finish   実行の結末を書き次の phase を決める --record-path --result [--verdict] [--api-error-status]
                                              [--oversize] [--acceptance-passed] [--session-id]
  approve  /approve による遷移                --association
  request-changes  /request-changes による差し戻し  --association --body
  block    phase を blocked にする            --reason

出力: 結果を JSON で標準出力に書く
`;
var { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    agent: { type: "string" },
    "run-id": { type: "string" },
    attempt: { type: "string", default: "1" },
    model: { type: "string" },
    "record-path": { type: "string" },
    result: { type: "string" },
    verdict: { type: "string" },
    "api-error-status": { type: "string" },
    oversize: { type: "boolean", default: false },
    "acceptance-passed": { type: "boolean", default: false },
    "session-id": { type: "string" },
    association: { type: "string" },
    body: { type: "string" },
    reason: { type: "string" }
  }
});
var need = (v, name) => {
  if (v === undefined || v === "") {
    console.error(`--${name} が必要です

${USAGE}`);
    process.exit(2);
  }
  return v;
};
var command = positionals[0];
var dir = need(values.dir, "dir");
var outcome = () => ({
  result: need(values.result, "result"),
  verdict: values.verdict ?? null,
  oversize: values.oversize,
  acceptance_passed: values["acceptance-passed"],
  api_error_status: values["api-error-status"] ? Number(values["api-error-status"]) : null
});
var run = () => {
  switch (command) {
    case "start":
      return startRun({
        dir,
        config: defaults,
        agent: need(values.agent, "agent"),
        run_id: need(values["run-id"], "run-id"),
        attempt: Number(values.attempt),
        model: values.model ?? defaults.models.default
      });
    case "route":
      return routeRun({ dir, config: defaults });
    case "finish":
      return finishRun({
        dir,
        config: defaults,
        record_path: need(values["record-path"], "record-path"),
        outcome: outcome(),
        session_id: values["session-id"] ?? null
      });
    case "approve":
      return approveRun({ dir, config: defaults, association: need(values.association, "association") });
    case "request-changes":
      return requestChangesRun({
        dir,
        config: defaults,
        association: need(values.association, "association"),
        body: need(values.body, "body")
      });
    case "block":
      return blockRun({ dir, config: defaults, reason: need(values.reason, "reason") });
    default:
      console.error(`不明なコマンド: ${command ?? "(なし)"}

${USAGE}`);
      return process.exit(2);
  }
};
console.log(JSON.stringify(run(), null, 2));

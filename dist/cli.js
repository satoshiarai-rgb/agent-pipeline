#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { parseArgs } from "node:util";

// src/file/state-file.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/utils/parse-json.ts
function parseJson(text, source = "JSON") {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${source} の解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// src/utils/pick.ts
function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined)
      out[key] = source[key];
  }
  return out;
}

// src/utils/stringify-json.ts
function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}

// src/file/state-file.ts
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
var STATE_KEYS = [
  "pipeline_version",
  "issue",
  "branch",
  "phase",
  "blocked_reason",
  "updated_at"
];
function renderStateFile(file, patch) {
  const shape = {
    ...file.meta,
    phase: patch.phase,
    blocked_reason: patch.blocked_reason,
    updated_at: patch.now.toISOString().replace(/\.\d{3}Z$/, "Z")
  };
  const ordered = pick(shape, STATE_KEYS);
  return stringifyJson(ordered);
}
function checkPipelineVersion(meta, config) {
  return meta.pipeline_version === config.pipeline_version ? null : `pipeline_version_mismatch: run=${meta.pipeline_version} harness=${config.pipeline_version}`;
}
function stateFilePath(dir) {
  return join(dir, "state.json");
}
function readStateFile(dir) {
  return parseStateFile(readFileSync(stateFilePath(dir), "utf8"));
}
function writeStateFile(dir, file, patch, now) {
  writeFileSync(stateFilePath(dir), renderStateFile(file, { ...patch, now }));
}

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
function approveRun(input) {
  const { dir, association, config, now = new Date } = input;
  const file = readStateFile(dir);
  const decision = approve({ phase: file.phase, association, config });
  if (!decision.ok)
    return decision;
  writeStateFile(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return decision;
}
// src/commands/block.ts
function blockRun(input) {
  const { dir, reason, now = new Date } = input;
  const file = readStateFile(dir);
  const result = {
    phase: "blocked",
    blocked_reason: reason,
    continue_chain: false,
    reason
  };
  writeStateFile(dir, file, result, now);
  return result;
}
// src/file/run-record.ts
import { existsSync, mkdirSync, readdirSync, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
function normalizeRecord(r) {
  return {
    agent: r.agent,
    phase: r.phase,
    run_id: String(r.run_id),
    attempt: Number(r.attempt ?? 1),
    started_at: r.started_at ?? "",
    finished_at: r.finished_at ?? null,
    result: r.result ?? null,
    verdict: r.verdict ?? null,
    api_error_status: r.api_error_status ?? null,
    model: r.model ?? null,
    session_id: r.session_id ?? null
  };
}
function parseRecord(text) {
  const r = parseJson(text, "実行レコード");
  if (!r?.agent || !r.run_id)
    throw new Error("実行レコードに agent か run_id がありません");
  return normalizeRecord(r);
}
function openRecord(input) {
  return normalizeRecord(input);
}
function closeRecord(current, patch) {
  return normalizeRecord({
    ...current,
    finished_at: patch.finished_at,
    result: patch.result,
    verdict: patch.verdict ?? null,
    api_error_status: patch.api_error_status ?? null,
    session_id: patch.session_id ?? current.session_id
  });
}
var RECORD_KEYS = [
  "agent",
  "phase",
  "run_id",
  "attempt",
  "started_at",
  "finished_at",
  "result",
  "verdict",
  "api_error_status",
  "model",
  "session_id"
];
function renderRecord(r) {
  const ordered = pick(r, RECORD_KEYS);
  return stringifyJson(ordered);
}
function recordFileName(r) {
  return `${r.agent}-${r.run_id}-${r.attempt}.json`;
}
function recordPath(dir, r) {
  return join2(dir, "runs", recordFileName(r));
}
function readRecords(dir) {
  const runs = join2(dir, "runs");
  if (!existsSync(runs))
    return [];
  return readdirSync(runs).filter((n) => n.endsWith(".json")).sort().map((n) => parseRecord(readFileSync2(join2(runs, n), "utf8")));
}
function saveRecord(dir, record) {
  const path = recordPath(dir, record);
  mkdirSync(join2(dir, "runs"), { recursive: true });
  writeFileSync2(path, renderRecord(record));
  return path;
}
function findRecord(records, path) {
  return records.find((r) => path.endsWith(recordFileName(r)));
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
  if (outcome.result === "invalid") {
    return blocked(outcome.detail ? `invalid_artifacts: ${outcome.detail}` : "invalid_artifacts");
  }
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
function finishRun(input) {
  const { dir, record_path, outcome, config, session_id = null, now = new Date } = input;
  const file = readStateFile(dir);
  const records = readRecords(dir);
  const current = findRecord(records, record_path);
  if (!current)
    throw new Error(`実行レコードが見つかりません: ${record_path}`);
  const updated = closeRecord(current, {
    finished_at: now.toISOString(),
    result: outcome.result,
    verdict: outcome.verdict,
    api_error_status: outcome.api_error_status,
    session_id
  });
  saveRecord(dir, updated);
  const result = finish({ phase: file.phase, records, config, outcome });
  writeStateFile(dir, file, result, now);
  return result;
}
// src/commands/label.ts
function labelFor(phase, prefix) {
  return `${prefix}${phase.replace(/_/g, "-")}`;
}
function labelRun(input) {
  const file = readStateFile(input.dir);
  const { prefix, trigger } = input.config.labels;
  return {
    label: labelFor(file.phase, prefix),
    issue: file.meta.issue,
    phase: file.phase,
    prefix,
    trigger
  };
}
// src/file/review-file.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
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
function nextReviewNumber(dir, kind) {
  const reviews = join3(dir, "reviews");
  if (!existsSync2(reviews))
    return 1;
  return readdirSync2(reviews).filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".md")).length + 1;
}
function reviewPath(dir, kind, round) {
  return join3(dir, "reviews", `${kind}-${String(round).padStart(2, "0")}.md`);
}
function saveReview(input) {
  const { dir, kind, verdict, reviewer, body } = input;
  const round = nextReviewNumber(dir, kind);
  const path = reviewPath(dir, kind, round);
  mkdirSync2(join3(dir, "reviews"), { recursive: true });
  writeFileSync3(path, renderReview({ verdict, round, reviewer, body }));
  return path;
}
function latestReviewPath(dir, kind) {
  const reviews = join3(dir, "reviews");
  if (!existsSync2(reviews))
    return null;
  const files = readdirSync2(reviews).filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".md")).sort();
  const last = files.at(-1);
  return last ? join3(reviews, last) : null;
}
function readVerdict(path) {
  const text = readFileSync3(path, "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter)
    return null;
  const line = frontmatter[1].split(/\r?\n/).find((l) => /^verdict:/.test(l.trim()));
  if (!line)
    return null;
  const value = line.split(":")[1]?.trim();
  return value === "approve" || value === "request_changes" ? value : null;
}

// src/commands/request-changes.ts
function requestChanges(input) {
  return humanTransition({ ...input, event: "request_changes" });
}
function requestChangesRun(input) {
  const { dir, association, body, config, now = new Date } = input;
  const file = readStateFile(dir);
  const decision = requestChanges({ phase: file.phase, association, config });
  if (!decision.ok)
    return decision;
  const kind = reviewKindFor(file.phase, config) ?? "plan";
  const review_path = saveReview({
    dir,
    kind,
    verdict: "request_changes",
    reviewer: `human:${association}`,
    body
  });
  writeStateFile(dir, file, { phase: decision.phase, blocked_reason: null }, now);
  return { ...decision, review_path };
}
// src/commands/route.ts
function routeRun(input) {
  const file = readStateFile(input.dir);
  const records = readRecords(input.dir);
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
// src/commands/start.ts
function startRun(input) {
  const { dir, agent, run_id, attempt, model, now = new Date } = input;
  const file = readStateFile(dir);
  const record = openRecord({
    agent,
    phase: file.phase,
    run_id,
    attempt,
    model,
    started_at: now.toISOString()
  });
  return { record_path: saveRecord(dir, record) };
}
// src/commands/validate.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";

// src/file/acceptance-file.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
function acceptancePath(dir) {
  return join4(dir, "acceptance.json");
}
function readAcceptance(dir) {
  const raw = parseJson(readFileSync4(acceptancePath(dir), "utf8"), "acceptance.json");
  if (!Array.isArray(raw?.criteria))
    throw new Error("acceptance.json に criteria がありません");
  return raw;
}
function acceptanceProblems(file) {
  const problems = [];
  if (file.criteria.length === 0)
    problems.push("criteria が空");
  const seen = new Set;
  for (const [i, c] of file.criteria.entries()) {
    const at = c?.id ? `criteria[${i}] (${c.id})` : `criteria[${i}]`;
    if (!c?.id)
      problems.push(`${at}: id が無い`);
    else if (seen.has(c.id))
      problems.push(`${at}: id が重複`);
    else
      seen.add(c.id);
    if (!c?.description)
      problems.push(`${at}: description が無い`);
    if (c?.verification !== "automated" && c?.verification !== "manual") {
      problems.push(`${at}: verification は automated か manual`);
    }
    if (c?.verification === "automated" && !c?.command) {
      problems.push(`${at}: verification が automated なら command が必要`);
    }
    if (!["pending", "passed", "failed"].includes(c?.status)) {
      problems.push(`${at}: status は pending / passed / failed`);
    }
    if (c?.status === "passed" && !c?.evidence) {
      problems.push(`${at}: passed にするなら evidence が必要`);
    }
  }
  return problems;
}
function allPassed(file) {
  return file.criteria.length > 0 && file.criteria.every((c) => c.status === "passed");
}
function hasAcceptance(dir) {
  return existsSync3(acceptancePath(dir));
}

// src/commands/validate.ts
function validateRun(input) {
  const { dir, agent, agent_failed = false, execution_file, changed_files = [] } = input;
  const apiError = readApiError(execution_file);
  if (apiError !== null) {
    return { result: "api_error", api_error_status: apiError };
  }
  if (agent_failed)
    return { result: "agent_failed" };
  const invalid = (detail) => ({ result: "invalid", detail });
  const nonEmpty = (path) => existsSync4(path) && readFileSync5(path, "utf8").trim() !== "";
  switch (agent) {
    case "planner": {
      const plan = join5(dir, "plan.md");
      if (!nonEmpty(plan))
        return invalid("plan.md が無いか空");
      const text = readFileSync5(plan, "utf8");
      if (!text.includes("## 規模判定"))
        return invalid("plan.md に ## 規模判定 が無い");
      if (!hasAcceptance(dir))
        return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems)
        return invalid(problems);
      const scale = text.slice(text.indexOf("## 規模判定"));
      if (scale.includes("上限超過"))
        return { result: "ok", oversize: true };
      return { result: "ok" };
    }
    case "plan-reviewer":
    case "dev-reviewer": {
      const kind = agent === "plan-reviewer" ? "plan" : "dev";
      const path = latestReviewPath(dir, kind);
      if (!path)
        return invalid(`reviews/${kind}-NN.md が無い`);
      const verdict = readVerdict(path);
      if (!verdict)
        return invalid(`${path} の frontmatter に verdict が無い`);
      return { result: "ok", verdict };
    }
    case "developer": {
      if (changed_files.length === 0)
        return invalid("差分が無い");
      const workflows = changed_files.filter((f) => f.startsWith(".github/workflows/"));
      if (workflows.length > 0) {
        return invalid(`.github/workflows を変更している: ${workflows.join(", ")}`);
      }
      if (!hasAcceptance(dir))
        return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems)
        return invalid(problems);
      return { result: "ok" };
    }
    case "completion": {
      if (!nonEmpty(join5(dir, "completion.md")))
        return invalid("completion.md が無いか空");
      if (!hasAcceptance(dir))
        return invalid("acceptance.json が無い");
      const problems = acceptanceSchema(dir);
      if (problems)
        return invalid(problems);
      return { result: "ok", acceptance_passed: allPassed(readAcceptance(dir)) };
    }
  }
}
function acceptanceSchema(dir) {
  let problems;
  try {
    problems = acceptanceProblems(readAcceptance(dir));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return problems.length > 0 ? `acceptance.json: ${problems.join(" / ")}` : null;
}
function readApiError(path) {
  if (!path || !existsSync4(path))
    return null;
  const events = parseJson(readFileSync5(path, "utf8"), "execution_file");
  const list = Array.isArray(events) ? events : [events];
  for (const e of list) {
    const ev = e;
    if (ev?.type === "result" && (ev.terminal_reason === "api_error" || ev.api_error_status)) {
      return ev.api_error_status ?? 0;
    }
  }
  return null;
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
  labels: {
    prefix: "agent:",
    trigger: "agent:go"
  },
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
  label    いま付いているべきラベルを返す
  validate 成果物が契約を満たすか検証し Outcome を返す
             --agent [--agent-failed] [--execution-file <path>] [--changed-files <path>]

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
    detail: { type: "string" },
    oversize: { type: "boolean", default: false },
    "acceptance-passed": { type: "boolean", default: false },
    "session-id": { type: "string" },
    association: { type: "string" },
    "agent-failed": { type: "boolean", default: false },
    "execution-file": { type: "string" },
    "changed-files": { type: "string" },
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
  api_error_status: values["api-error-status"] ? Number(values["api-error-status"]) : null,
  detail: values.detail
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
    case "label":
      return labelRun({ dir, config: defaults });
    case "validate":
      return validateRun({
        dir,
        config: defaults,
        agent: need(values.agent, "agent"),
        agent_failed: values["agent-failed"],
        execution_file: values["execution-file"] ?? null,
        changed_files: values["changed-files"] ? readFileSync6(values["changed-files"], "utf8").split(`
`).filter(Boolean) : []
      });
    default:
      console.error(`不明なコマンド: ${command ?? "(なし)"}

${USAGE}`);
      return process.exit(2);
  }
};
console.log(JSON.stringify(run(), null, 2));

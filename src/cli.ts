#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { approveRun, blockRun, finishRun, loadConfig, requestChangesRun, routeRun, startRun } from "./index.ts";
import type { AgentName, Outcome, RunResult, Verdict } from "./types.ts";

/**
 * 公開 IF（index.ts）をワークフローから叩くための薄い入口。
 * 判断はすべて index.ts 以下にあり、ここは引数の受け渡しと JSON 出力だけを行う。
 */
const USAGE = `使い方: cli.ts <command> --dir <agent-work/issue-N> [options]

commands:
  start    エージェント実行の開始を記録する   --agent --run-id --attempt [--model]
  route    次に何をするかを決める
  finish   実行の結末を書き次の phase を決める --record-path --result [--verdict] [--api-error-status]
                                              [--oversize] [--acceptance-passed] [--session-id]
  approve  /approve による遷移                --association
  request-changes  /request-changes による差し戻し  --association --body
  block    phase を blocked にする            --reason

共通: --defaults <path>（既定 defaults.yml）
出力: 結果を JSON で標準出力に書く
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    defaults: { type: "string", default: "defaults.yml" },
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
    reason: { type: "string" },
  },
});

const need = <T>(v: T | undefined, name: string): T => {
  if (v === undefined || v === "") {
    console.error(`--${name} が必要です\n\n${USAGE}`);
    process.exit(2);
  }
  return v;
};

const command = positionals[0];
const dir = need(values.dir, "dir");
const config = loadConfig(readFileSync(values.defaults!, "utf8"));

const outcome = (): Outcome => ({
  result: need(values.result, "result") as RunResult,
  verdict: (values.verdict as Verdict | undefined) ?? null,
  oversize: values.oversize,
  acceptance_passed: values["acceptance-passed"],
  api_error_status: values["api-error-status"] ? Number(values["api-error-status"]) : null,
});

const run = () => {
  switch (command) {
    case "start":
      return startRun({
        dir,
        config,
        agent: need(values.agent, "agent") as AgentName,
        run_id: need(values["run-id"], "run-id"),
        attempt: Number(values.attempt),
        model: values.model ?? config.models.default,
      });
    case "route":
      return routeRun({ dir, config });
    case "finish":
      return finishRun({
        dir,
        config,
        record_path: need(values["record-path"], "record-path"),
        outcome: outcome(),
        session_id: values["session-id"] ?? null,
      });
    case "approve":
      return approveRun({ dir, config, association: need(values.association, "association") });
    case "request-changes":
      return requestChangesRun({
        dir,
        config,
        association: need(values.association, "association"),
        body: need(values.body, "body"),
      });
    case "block":
      return blockRun({ dir, config, reason: need(values.reason, "reason") });
    default:
      console.error(`不明なコマンド: ${command ?? "(なし)"}\n\n${USAGE}`);
      return process.exit(2);
  }
};

console.log(JSON.stringify(run(), null, 2));

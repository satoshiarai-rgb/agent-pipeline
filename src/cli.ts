#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  approveRun,
  blockRun,
  composeRun,
  defaults as config,
  finishRun,
  labelRun,
  type Outcome,
  requestChangesRun,
  routeRun,
  startRun,
  validateRun,
} from "./index.ts";
import type { AgentName, RunResult, Verdict } from "./types.ts";

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
  label    いま付いているべきラベルを返す
  validate 成果物が契約を満たすか検証し Outcome を返す
             --agent [--agent-failed] [--execution-file <path>] [--changed-files <path>]
  compose  エージェントに渡すプロンプトを組み立てる --agent --central --out [--repo]

出力: 結果を JSON で標準出力に書く
`;

const { positionals, values } = parseArgs({
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
    reason: { type: "string" },
    repo: { type: "string" },
    central: { type: "string" },
    out: { type: "string" },
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

const outcome = (): Outcome => ({
  result: need(values.result, "result") as RunResult,
  verdict: (values.verdict as Verdict | undefined) ?? null,
  oversize: values.oversize,
  acceptance_passed: values["acceptance-passed"],
  api_error_status: values["api-error-status"] ? Number(values["api-error-status"]) : null,
  detail: values.detail,
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
    case "label":
      return labelRun({ dir, config });
    case "validate":
      return validateRun({
        dir,
        config,
        agent: need(values.agent, "agent") as AgentName,
        agent_failed: values["agent-failed"],
        execution_file: values["execution-file"] ?? null,
        // 1 行 1 ファイルのリスト（ワークフローが git status から作る）
        changed_files: values["changed-files"]
          ? readFileSync(values["changed-files"], "utf8").split("\n").filter(Boolean)
          : [],
      });
    case "compose":
      return composeRun({
        dir,
        config,
        agent: need(values.agent, "agent") as AgentName,
        repo: values.repo ?? ".",
        central: need(values.central, "central"),
        out: need(values.out, "out"),
      });
    default:
      console.error(`不明なコマンド: ${command ?? "(なし)"}\n\n${USAGE}`);
      return process.exit(2);
  }
};

console.log(JSON.stringify(run(), null, 2));

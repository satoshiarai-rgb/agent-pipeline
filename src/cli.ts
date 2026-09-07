#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readConfig } from "./file/config-file.ts";
import { type Args, MissingArg, runCommand } from "./redux/commands.ts";

/**
 * ワークフローから store を叩くための薄い入口。**引数を解析して JSON を書くだけ。**
 * どのコマンドが何をするかは `src/store/commands.ts` の対応表にある。
 */
const USAGE = `使い方: cli.ts <command> --dir <agent-work/issue-N> [options]

状態を変える（action を 1 つ dispatch する）:
  start    エージェント実行の開始を記録する   --agent --run-id --attempt [--model]
  finish   実行の結末を書き次の phase を決める --run-id --result [--verdict] [--detail]
                                              [--api-error-status] [--acceptance-passed] [--session-id]
  approve  /agent approve による遷移           --association
  request-changes  /agent request-changes による差し戻し  --association --body
  retry    blocked から直前のフェーズに戻す    --association
  block    phase を blocked にする            --reason

読むだけ（何も書かない）:
  route    次に何をするかを決める
  label    いま付いているべきラベルを返す
  explain  blocked の理由と次の一手を markdown で返す（PR に貼る）

store を使わない:
  validate 成果物が契約を満たすか検証し Outcome を返す
             --agent [--agent-failed] [--execution-file <path>] [--changed-files <path>]
  compose  エージェントに渡すプロンプトを組み立てる --agent --run-id --attempt --central --out
                                              [--repo]

--repo は配布先のチェックアウト（既定はカレント）。.agent/config.json があれば
既定値に重ねる。書いたキーだけが上書きされ、null は継承、既定に無いキーはエラー

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

const command = positionals[0] ?? "";
const fail = (message: string): never => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
};

/**
 * 既定値（src/defaults.ts）に配布先の `.agent/config.json` を重ねる（A-19）。
 * 上書きが壊れていたとき、**route は落とさず `blocked` として返す**（状態を書かずに
 * 落ちると run が無音で止まる）。他のコマンドは人間の操作が起点なので即座に失敗させる。
 */
const loaded = readConfig(values.repo ?? ".");
if (loaded.error && command !== "route") fail(loaded.error);

try {
  const result = runCommand(command, values as Args, loaded.config, loaded.error);
  if (result === undefined) fail(`不明なコマンド: ${command || "(なし)"}`);
  console.log(JSON.stringify(result, null, 2));
} catch (e: unknown) {
  if (e instanceof MissingArg) fail(e.message);
  throw e;
}

#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readConfig } from "./file/configFile.ts";
import { type Args, CLI_OPTIONS, MissingArg, runCommand } from "./redux/runCommand.ts";

/**
 * ワークフローから store を叩くための薄い入口。**引数を解析して JSON を書くだけ。**
 * どのコマンドが何をするかは `src/redux/runCommand.ts` の分岐にある。
 */
const USAGE = `使い方: cli.ts <command> --dir <agent-work/issue-N> [options]

状態を変える（action を 1 つ dispatch する）:
  bootstrap run の最初のイベントを書く              --issue --branch
  start    エージェント実行の開始を記録する   --agent --run-id --attempt [--model]
  finish   成果物を契約に照らし、結末を書いて次の phase を決める --run-id --attempt
                                              [--agent-failed] [--execution-file <path>]
                                              [--changed-files <path>] [--session-id]
  approve  /agent approve による遷移           --association
  request-changes  /agent request-changes による差し戻し  --association --body
  retry    blocked から直前のフェーズに戻す    --association
  snapshot state.json を書き直す（止まったことを記録する。blocked は導出される状態）

読むだけ（何も書かない）:
  route    次に何をするかを決める
  label    いま付いているべきラベルを返す
  explain  blocked の理由と次の一手を markdown で返す（PR に貼る）

store を使わない:
  compose  エージェントに渡すプロンプトを組み立てる --agent --run-id --attempt --central --out
                                              [--repo]

finish が検査する相手（エージェント）は start が記録した in_flight から取るので渡さない

--repo は配布先のチェックアウト（既定はカレント）。.agent/config.json があれば
既定値に重ねる。書いたキーだけが上書きされ、null は継承、既定に無いキーはエラー

出力: 結果を JSON で標準出力に書く
`;

const { positionals, values } = parseArgs({ allowPositionals: true, options: CLI_OPTIONS });

const command = positionals[0] ?? "";
const fail = (message: string): never => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
};

/**
 * 既定値（src/pipelineSettings.ts）に配布先の `.agent/config.json` を重ねる（A-19）。
 * 上書きが壊れていたとき、**route は落とさず `blocked` として返す**（状態を書かずに
 * 落ちると run が無音で止まる）。他のコマンドは人間の操作が起点なので即座に失敗させる。
 */
const loaded = readConfig(values.repo ?? ".");
if (loaded.error && command !== "route") fail(loaded.error);

try {
  const result = runCommand(command, values as Args, loaded.settings, loaded.error);
  if (result === undefined) fail(`不明なコマンド: ${command || "(なし)"}`);
  console.log(JSON.stringify(result, null, 2));
} catch (e: unknown) {
  if (e instanceof MissingArg) fail(e.message);
  throw e;
}

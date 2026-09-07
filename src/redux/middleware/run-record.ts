import {
  closeRecord,
  openRecord,
  readRecords,
  recordPath,
  saveRecord,
} from "../../file/run-record.ts";
import type { RunResult } from "../../types.ts";
import { agentFailed, agentOk, agentStarted, review } from "../app/actions.ts";
import type { AgentMiddleware } from "./types.ts";
import { isReplay } from "./types.ts";

/**
 * `runs/<agent>-<run_id>-<attempt>.json` を書く（**段取り 2 で消える middleware**）。
 *
 * 段取り 2 では実行の記録そのものがイベントログになる（開始と終了で 2 ファイル）ので、
 * このファイル形式と middleware は不要になる。それまでは形式を変えないために、
 * action からレコードを組み立て直す。
 *
 * 終了のレコードは `in_flight`（開始で立てた state）からエージェント名を引いて特定する。
 * `--record-path` は受け取らない（同じものが state から分かるため）。
 */

/** 終了の action から、レコードに書く `result` を決める。理由の文字列と 1 対 1 */
const resultOf = (type: string, reason: string): RunResult => {
  if (type !== agentFailed.type) return "ok";
  if (reason.startsWith("api_error:")) return "api_error";
  if (reason.startsWith("invalid_artifacts")) return "invalid";
  return "agent_failed";
};

export const runRecord: AgentMiddleware =
  ({ outputs }) =>
  (store) =>
  (next) =>
  (action) => {
    if (isReplay(action)) return next(action);
    const { info, app } = store.getState();
    const a = action as { type: string; payload?: Record<string, unknown> };

    if (a.type === agentStarted.type) {
      const p = a.payload as { agent: string; run_id: string; attempt: number; model: string };
      const record = openRecord({
        agent: p.agent as never,
        phase: app.phase,
        run_id: p.run_id,
        attempt: p.attempt,
        model: p.model,
        started_at: new Date().toISOString(),
      });
      outputs.record_path = saveRecord(info.dir, record);
      return next(action);
    }

    if (a.type !== agentOk.type && a.type !== review.type && a.type !== agentFailed.type) {
      return next(action);
    }
    const agent = app.in_flight_agent;
    const p = (a.payload ?? {}) as {
      run_id: string;
      attempt: number;
      reason?: string;
      verdict?: string;
      api_error_status?: number | null;
      session_id?: string | null;
    };
    const result = next(action);
    if (!agent) return result; // 開始のレコードが無い（手で state を戻した場合など）
    const path = recordPath(info.dir, { agent, run_id: p.run_id, attempt: p.attempt });
    const current = readRecords(info.dir).find((r) =>
      path.endsWith(`${r.agent}-${r.run_id}-${r.attempt}.json`),
    );
    if (!current) return result;
    saveRecord(
      info.dir,
      closeRecord(current, {
        finished_at: new Date().toISOString(),
        result: resultOf(a.type, p.reason ?? ""),
        verdict: (p.verdict as never) ?? null,
        api_error_status: p.api_error_status ?? null,
        session_id: p.session_id ?? null,
      }),
    );
    return result;
  };

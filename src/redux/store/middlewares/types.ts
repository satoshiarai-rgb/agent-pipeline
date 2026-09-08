import type { Middleware } from "redux";
import type { PipelineSettings } from "../../../pipelineSettings.ts";
import type { RootState } from "../createStore.ts";
import type { PipelineDispatch } from "../global/actions.ts";

/**
 * middleware が受け取るもの。`settings` はクロージャで畳み込む（state に入れない / K-26）。
 * `outputs` はワークフローに渡す値の受け皿で、1 起動 1 dispatch なのでこれで足りる
 * （store の enhancer は要らない）。
 */
export interface Wiring {
  settings: PipelineSettings;
  outputs: Record<string, unknown>;
}

export type AgentMiddleware = (
  w: Wiring,
) => Middleware<Record<string, never>, RootState, PipelineDispatch>;

/** 再生（過去の状態の復元）中かどうか。**各 middleware が自分で見て分岐する** */
export const isReplay = (action: unknown): boolean =>
  (action as { meta?: { hydrate?: true } })?.meta?.hydrate === true;

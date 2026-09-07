import actionCreatorFactory from "../../utils/typescript-fsa.ts";

/**
 * 設置（issue・ブランチ・版）と、この起動の環境を動かす action。
 * どちらも**永続化しない**（`CONFIGURE` は環境、`HYDRATED` は再生の合図）。
 */
export interface ConfigurePayload {
  dir: string;
  run_id: string | null;
  attempt: number;
}

/** `hydrated` は payload を持たないので undefined を含む */
export type InfoPayload = ConfigurePayload | undefined;

const create = actionCreatorFactory("agent-pipeline/info");

/** 起動時に環境を注入する */
export const configure = create<ConfigurePayload>("CONFIGURE");

/** 再生が終わった合図。subscriber がこれを見て書き込みを判断する */
export const hydrated = create<undefined>("HYDRATED");

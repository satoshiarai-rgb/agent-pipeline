/**
 * スライスを跨ぐ action の置き場（reducer を持たない）。
 * `init` は middleware だけが見る action、`RESTORE` は既存のファイルからの復元で、
 * どちらも 1 つのスライスに属さないのでここに置く。
 */
export * from "./actions.ts";

/**
 * File-backed working memory for long tasks. Two model-facing tools —
 * `memorize` and `recall` — keep key premises as VERBATIM BYTES in a
 * session-scoped notes file inside the workspace, so they survive context
 * compaction losslessly: a summarizer can blur or drop a fact, but a file
 * round-trips it byte-exact. This is the lossless complement to prompt-space
 * compaction checkpoints (which are LLM-rewritten generation after
 * generation).
 * @module @deepseek-ai/dsh-file-memory
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "file-memory";
export declare const inject: string[];
/** Plugin config, validated by the same-named schemastery schema plus fail-loud load checks in `apply`. */
export interface Config {
    /** Recall output cap in characters (default 6000). */
    maxRecallChars?: number;
    /** Notes directory name inside the workspace (default `.dsh-notes`). */
    notesDir?: string;
}
export declare const Config: z<Config>;
/**
 * Install the plugin: register the `memorize` and `recall` tools.
 * @param ctx - plugin context carrying the tools service; listeners and tools are disposed with it.
 * @param config - validated {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map
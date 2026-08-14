import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region lib/types/index.js
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
const name = "file-memory";
const inject = ["tools"];
const Config = z.object({
	maxRecallChars: z.number().default(6e3),
	notesDir: z.string().default(".dsh-notes")
});
/** Fail-loud integer validation. */
function validateInt(label, value, fallback) {
	const resolved = value === void 0 ? fallback : value;
	if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`file-memory: invalid ${label} ${resolved} — must be an integer >= 1`);
	return resolved;
}
/** Require an agent-backed session, returning its id and workspace cwd. */
function sessionContext(exec) {
	if (exec.agent === void 0) throw new Error("file-memory tools require an Agent-backed session");
	return {
		id: String(exec.agent.session.id),
		cwd: exec.agent.session.header.cwd
	};
}
/** Resolve the notes target through the fs service, relative to the workspace when it has a cwd. */
async function resolveNotes(fs, notesDir, id, cwd) {
	const rel = `${notesDir}/${id}.md`;
	return cwd === void 0 ? fs.resolve(rel) : fs.resolve(rel, { cwd });
}
/** Existing lines of the notes file, or `[]` when absent. */
async function existingLines(fs, target) {
	if (await fs.stat(target) === void 0) return [];
	return (await fs.readText(target)).split("\n");
}
/**
* Install the plugin: register the `memorize` and `recall` tools.
* @param ctx - plugin context carrying the tools service; listeners and tools are disposed with it.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const maxRecallChars = validateInt("maxRecallChars", config.maxRecallChars, 6e3);
	const notesDir = config.notesDir.trim();
	if (notesDir.length === 0 || notesDir.includes("..") || notesDir.includes("\\") || notesDir.includes("/")) throw new Error(`file-memory: invalid notesDir ${JSON.stringify(config.notesDir)} — must be a bare directory name`);
	const fsOf = () => ctx.get("fs");
	ctx.tools.register(defineTool({
		name: "memorize",
		description: "Append key facts to this session's notes file (workspace `.dsh-notes/<session>.md`), stored verbatim and deduplicated. Use BEFORE long work and whenever a premise, constraint, parameter, or decision must survive context compaction: notes are bytes, compaction summaries are lossy. Recall them later with `recall`.",
		parameters: { entries: {
			type: "array",
			items: { type: "string" },
			description: "Facts to persist, one per entry. Prefer exact strings: error codes, paths, values, decisions."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					added: { type: "integer" },
					total: { type: "integer" },
					reason: { type: "string" }
				}
			},
			render(_args, value) {
				return [{
					type: "text",
					text: JSON.stringify(value)
				}];
			}
		},
		async execute(args, exec) {
			const entries = args.entries;
			if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) throw new Error("memorize: `entries` must be an array of strings");
			const fs = fsOf();
			if (fs === void 0) return {
				ok: false,
				reason: "fs service unavailable in this deployment"
			};
			const { id, cwd } = sessionContext(exec);
			const target = await resolveNotes(fs, notesDir, id, cwd);
			const lines = await existingLines(fs, target);
			let added = 0;
			for (const entry of entries) {
				const line = entry.trim();
				if (line === "" || lines.includes(line)) continue;
				lines.push(line);
				added += 1;
			}
			await fs.writeText(target, lines.join("\n"));
			return {
				ok: true,
				added,
				total: lines.length
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "recall",
		description: "Read this session's notes file back, optionally filtered to lines containing `query`. Call AFTER compaction when a premise seems blurred or missing, at task start, or before abandoning a direction. Notes are verbatim; nothing was re-summarized.",
		parameters: { query: {
			type: "string",
			description: "Optional substring filter for the lines to return."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					found: { type: "boolean" },
					note: { type: "string" },
					reason: { type: "string" }
				}
			},
			render(_args, value) {
				const v = value;
				if (typeof v.note === "string") return [{
					type: "text",
					text: v.note
				}];
				return [{
					type: "text",
					text: JSON.stringify(value)
				}];
			}
		},
		async execute(args, exec) {
			const raw = args.query;
			const query = typeof raw === "string" && raw.length > 0 ? raw : void 0;
			const fs = fsOf();
			if (fs === void 0) return {
				ok: false,
				found: false,
				reason: "fs service unavailable in this deployment"
			};
			const { id, cwd } = sessionContext(exec);
			const lines = await existingLines(fs, await resolveNotes(fs, notesDir, id, cwd));
			if (lines.length === 0) return {
				ok: true,
				found: false,
				note: "no notes yet for this session"
			};
			let note = (query === void 0 ? lines : lines.filter((line) => line.includes(query))).join("\n");
			if (note.length > maxRecallChars) note = `${note.slice(0, maxRecallChars)}… (truncated)`;
			return {
				ok: true,
				found: true,
				note
			};
		}
	}));
}
//#endregion
export { Config, apply, inject, name };

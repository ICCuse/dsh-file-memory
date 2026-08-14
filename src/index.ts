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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'file-memory'
export const inject = ['tools']

/** Plugin config, validated by the same-named schemastery schema plus fail-loud load checks in `apply`. */
export interface Config {
  /** Recall output cap in characters (default 6000). */
  maxRecallChars?: number
  /** Notes directory name inside the workspace (default `.dsh-notes`). */
  notesDir?: string
}

export const Config: z<Config> = z.object({
  maxRecallChars: z.number().default(6000),
  notesDir: z.string().default('.dsh-notes'),
})

/** Minimal structural face of the optional `fs` service the plugin consumes. */
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<{ targetKey: string }>
  stat(target: unknown): Promise<{ kind: string } | undefined>
  readText(target: unknown): Promise<string>
  writeText(target: unknown, content: string): Promise<unknown>
}

/** Fail-loud integer validation. */
function validateInt(label: string, value: number | undefined, fallback: number): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`file-memory: invalid ${label} ${resolved} — must be an integer >= 1`)
  }
  return resolved
}

/** Require an agent-backed session, returning its id and workspace cwd. */
function sessionContext(exec: ToolExecution): { id: string; cwd: string | undefined } {
  if (exec.agent === undefined) throw new Error('file-memory tools require an Agent-backed session')
  return { id: String(exec.agent.session.id), cwd: exec.agent.session.header.cwd }
}

/** Resolve the notes target through the fs service, relative to the workspace when it has a cwd. */
async function resolveNotes(
  fs: FsLike,
  notesDir: string,
  id: string,
  cwd: string | undefined,
): Promise<{ targetKey: string }> {
  const rel = `${notesDir}/${id}.md`
  return cwd === undefined ? fs.resolve(rel) : fs.resolve(rel, { cwd })
}

/** Existing lines of the notes file, or `[]` when absent. */
async function existingLines(fs: FsLike, target: { targetKey: string }): Promise<string[]> {
  const info = await fs.stat(target)
  if (info === undefined) return []
  const text = await fs.readText(target)
  return text.split('\n')
}

/**
 * Install the plugin: register the `memorize` and `recall` tools.
 * @param ctx - plugin context carrying the tools service; listeners and tools are disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const maxRecallChars = validateInt('maxRecallChars', config.maxRecallChars, 6000)
  const notesDir = (config.notesDir as string).trim()
  if (notesDir.length === 0 || notesDir.includes('..') || notesDir.includes('\\') || notesDir.includes('/')) {
    throw new Error(`file-memory: invalid notesDir ${JSON.stringify(config.notesDir)} — must be a bare directory name`)
  }

  const fsOf = (): FsLike | undefined => ctx.get('fs') as FsLike | undefined

  ctx.tools.register(defineTool({
    name: 'memorize',
    description:
      'Append key facts to this session\'s notes file (workspace `.dsh-notes/<session>.md`), stored verbatim and '
      + 'deduplicated. Use BEFORE long work and whenever a premise, constraint, parameter, or decision must survive '
      + 'context compaction: notes are bytes, compaction summaries are lossy. Recall them later with `recall`.',
    parameters: {
      entries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Facts to persist, one per entry. Prefer exact strings: error codes, paths, values, decisions.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          added: { type: 'integer' },
          total: { type: 'integer' },
          reason: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: unknown, exec: ToolExecution) {
      const entries = (args as { entries?: unknown }).entries
      if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
        throw new Error('memorize: `entries` must be an array of strings')
      }
      const fs = fsOf()
      if (fs === undefined) return { ok: false, reason: 'fs service unavailable in this deployment' }
      const { id, cwd } = sessionContext(exec)
      const target = await resolveNotes(fs, notesDir, id, cwd)
      const lines = await existingLines(fs, target)
      let added = 0
      for (const entry of entries) {
        const line = entry.trim()
        if (line === '' || lines.includes(line)) continue
        lines.push(line)
        added += 1
      }
      await fs.writeText(target, lines.join('\n'))
      return { ok: true, added, total: lines.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'recall',
    description:
      'Read this session\'s notes file back, optionally filtered to lines containing `query`. Call AFTER compaction '
      + 'when a premise seems blurred or missing, at task start, or before abandoning a direction. Notes are verbatim; '
      + 'nothing was re-summarized.',
    parameters: {
      query: {
        type: 'string',
        description: 'Optional substring filter for the lines to return.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          found: { type: 'boolean' },
          note: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render(_args, value) {
        const v = value as { note?: unknown }
        if (typeof v.note === 'string') return [{ type: 'text', text: v.note }]
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: unknown, exec: ToolExecution) {
      const raw = (args as { query?: unknown }).query
      const query = typeof raw === 'string' && raw.length > 0 ? raw : undefined
      const fs = fsOf()
      if (fs === undefined) return { ok: false, found: false, reason: 'fs service unavailable in this deployment' }
      const { id, cwd } = sessionContext(exec)
      const target = await resolveNotes(fs, notesDir, id, cwd)
      const lines = await existingLines(fs, target)
      if (lines.length === 0) return { ok: true, found: false, note: 'no notes yet for this session' }
      const filtered = query === undefined ? lines : lines.filter(line => line.includes(query))
      let note = filtered.join('\n')
      if (note.length > maxRecallChars) {
        note = `${note.slice(0, maxRecallChars)}… (truncated)`
      }
      return { ok: true, found: true, note }
    },
  }))
}

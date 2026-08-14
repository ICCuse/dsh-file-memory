import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as FileMemory from 'dsh-file-memory'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/**
 * Behavior suite for the file-backed working memory: memorize appends verbatim
 * deduplicated lines, recall reads them back with an optional filter, absent
 * notes answer cleanly, and both tools require an agent-backed session. The fs
 * service is a fake in-memory map provided by the test.
 */

/** In-memory fake of the `fs` service face the plugin consumes. */
class FakeFs {
  readonly files = new Map<string, string>()

  async resolve(path: string, opts?: { cwd?: string }): Promise<{ targetKey: string }> {
    const key = opts?.cwd === undefined ? path : `${opts.cwd}/${path}`
    return { targetKey: key }
  }

  async stat(target: { targetKey: string }): Promise<{ kind: string } | undefined> {
    return this.files.has(target.targetKey) ? { kind: 'file' } : undefined
  }

  async readText(target: { targetKey: string }): Promise<string> {
    const value = this.files.get(target.targetKey)
    if (value === undefined) throw new Error(`missing file ${target.targetKey}`)
    return value
  }

  async writeText(target: { targetKey: string }, content: string): Promise<void> {
    this.files.set(target.targetKey, content)
  }
}

async function harness(): Promise<{ ctx: Context; fs: FakeFs }> {
  const ctx = new Context()
  const fs = new FakeFs()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('fs', fs)
  await ctx.plugin(FileMemory, {})
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return { ctx, fs }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

describe('memorize / recall through a real loop', () => {
  it('appends deduplicated verbatim lines and recalls them with a filter', async () => {
    const { ctx, fs } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'memorize', { entries: ['alpha=1.5', 'alpha=1.5', 'params=C:\\data\\backtest\\params.json'] }),
      textResponse('noted'),
      toolCallResponse('c2', 'recall', { query: 'alpha' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const stored = [...fs.files.entries()][0]
    expect(stored).toBeDefined()
    expect(stored![0]).toContain('.dsh-notes/a1.md')
    const lines = stored![1].split('\n')
    expect(lines).toContain('alpha=1.5')
    expect(lines).toContain('params=C:\\data\\backtest\\params.json')
    expect(lines.filter(line => line === 'alpha=1.5')).toHaveLength(1)
  })

  it('recall answers cleanly when no notes exist yet', async () => {
    const { ctx } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'recall', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const results = [...agent.session.events].filter(e => e.type === 'tool/result')
    const text = results.map(e => e.data.message.content[0]!.content.map(b => b.type === 'text' ? b.text : '').join('')).join('')
    expect(text).toContain('no notes yet')
  })
})

describe('tool admission', () => {
  it('registers both tools', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.get('memorize')).toBeDefined()
    expect(ctx.tools.get('recall')).toBeDefined()
  })
})

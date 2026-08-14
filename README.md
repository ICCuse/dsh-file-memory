# @deepseek-ai/dsh-file-memory

[中文](README.zh.md) | English

File-backed working memory for long tasks. Two model-facing tools — `memorize` and `recall` — keep key premises as **verbatim bytes** in a session-scoped notes file inside the workspace, so they survive context compaction losslessly: a summarizer can blur or drop a fact, but a file round-trips it byte-exact.

## Why

Compaction checkpoints are LLM-generated and LLM-rewritten generation after generation; the prompt-space "state document" proposals still re-summarize the previous state every pass. Files are the only lossless medium the agent already has: write once, read back exactly. This is the pragmatic complement to prompt-space compaction, usable today on the shipped `compaction-basic` backend.

## Tools

| Tool | Behavior |
|---|---|
| `memorize(entries)` | Appends verbatim deduplicated lines to `<workspace>/.dsh-notes/<session>.md`. |
| `recall(query?)` | Reads the notes back, optionally filtered to lines containing `query`; caps output at `maxRecallChars`. |

Both require an agent-backed session and a mounted `fs` service; they resolve the notes file relative to the session's workspace cwd (falling back to the backend default when the session has no cwd).

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxRecallChars` | `6000` | Recall output cap. |
| `notesDir` | `.dsh-notes` | Notes directory name inside the workspace; must be a bare directory name. |

`maxRecallChars` must be an integer `>= 1`; misconfiguration throws at plugin load.

## Install

Not on npm yet - install from this repository:

```sh
npm install github:ICCuse/dsh-file-memory
# or: pnpm add github:ICCuse/dsh-file-memory
```

Then mount the bundle (declared in package.json 'dsh.bundle'):

```yaml
- id: dsh-file-memory
  name: 'dsh-file-memory'
```

Or, once published, 'dsh plugin --profile web add dsh-file-memory'.

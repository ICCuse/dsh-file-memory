# @deepseek-ai/dsh-file-memory

[English](README.md) | 中文

面向长任务的文件型工作记忆。两个模型侧工具——`memorize` 与 `recall`——把关键前提以**逐字字节**形式保存在工作区内按会话隔离的笔记文件里，因此能无损地挺过上下文压缩：摘要器可以把事实模糊或丢掉，但文件能逐字节原样往返。

## 为什么

压缩检查点是 LLM 生成的、并逐代被 LLM 重写；prompt 空间里的"状态文档"提案每一轮仍会对上一版状态再摘要。文件是 agent 手上唯一无损的介质：写一次，读回即原样。这是对 prompt 空间压缩的务实补充，在当前随附的 `compaction-basic` 后端上今天就能用。

## 工具

| 工具 | 行为 |
|---|---|
| `memorize(entries)` | 把逐字去重后的行追加到 `<workspace>/.dsh-notes/<session>.md`。 |
| `recall(query?)` | 读回笔记，可选按包含 `query` 的行过滤；输出上限 `maxRecallChars`。 |

两者都要求 agent 会话与已挂载的 `fs` 服务；笔记文件相对会话工作区 cwd 解析（会话无 cwd 时回退到后端默认基准）。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxRecallChars` | `6000` | recall 输出上限。 |
| `notesDir` | `.dsh-notes` | 工作区内的笔记目录名；必须是裸目录名。 |

`maxRecallChars` 必须为 `>= 1` 的整数；配置错误在插件加载时直接抛错。

## 安装

尚未发布到 npm —— 直接从此仓库安装：

```sh
npm install github:ICCuse/dsh-file-memory
# 或：pnpm add github:ICCuse/dsh-file-memory
```

然后在 profile 组装中挂载（package.json 已声明 `dsh.bundle`）：

```yaml
- id: dsh-file-memory
  name: 'dsh-file-memory'
```

发布后亦可 `dsh plugin --profile web add dsh-file-memory`。

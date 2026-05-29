# WorldForge — 文学创作 Agent 完整设计文档

> 一个帮助世界观创作者管理设定词条、基于设定创作故事的桌面 AI Agent。
> 针对文学创作场景从头设计的桌面 AI Agent。

---

> **⚠️ 全局开发提示 — 数据持久化**
> 
> WorldForge **没有数据库**。所有数据都以文件形式直接存储在文件系统上。前端 Zustand store 只是运行时缓存，**一切数据都必须通过 Tauri invoke → Rust 命令持久化到磁盘**，否则重启后会丢失。
>
> 持久化覆盖的 6 种数据类型见 §四。核心原则：**Agent Loop 中每一次工具调用（读、写、删）都必须对应一个 Rust 命令 + 文件系统操作**。聊天消息本身不会被自动保存——`append_session_message` 必须在每条消息发出后主动调用。同样，对话标题改名、故事创建、词条修改等所有变更都需要对应的 `invoke()` 调用，不能只修改前端 store。

---

## 一、目录结构

```
worldforge/
│
├── src-tauri/                              # 🔴 Tauri Rust 后端 (全新)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/
│   └── src/
│       ├── main.rs                         # 入口
│       ├── lib.rs
│       ├── commands/                       # IPC 命令
│       │   ├── mod.rs
│       │   ├── entry_crud.rs               # 词条 CRUD
│       │   ├── entry_search.rs             # 语义搜索
│       │   ├── graph_traverse.rs           # 图遍历
│       │   ├── file_watch.rs               # 文件监听 (Obsidian 互通)
│       │   └── api_proxy.rs                # LLM API 代理
│       ├── models/
│       │   ├── mod.rs
│       │   ├── entry.rs                    # 词条数据模型
│       │   ├── relationship.rs             # 关联关系
│       │   ├── constraint.rs               # 约束规则
│       │   └── compression.rs              # 四层压缩算法
│       ├── services/
│       │   ├── mod.rs
│       │   ├── entry_index.rs              # 索引管理 (→ memdir)
│       │   ├── search.rs                   # 搜索服务
│       │   ├── consistency.rs              # 一致性检查引擎
│       │   └── template.rs                 # 压缩模板引擎
│       └── utils/
│           ├── mod.rs
│           ├── markdown.rs
│           └── tags.rs
│
├── src/                                    # React 前端
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── components/
│   │   ├── layout/                         # 🟢 复用现有 components/layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── StatusBar.tsx
│   │   │
│   │   ├── chat/                           # 🟢 复用现有 components/chat/
│   │   │   ├── ChatLayout.tsx
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── MarkdownContent.tsx
│   │   │
│   │   ├── entry-panel/                    # 🔴 全新 — 词条系统UI
│   │   │   ├── EntryPanel.tsx
│   │   │   ├── EntryList.tsx
│   │   │   ├── EntryCard.tsx
│   │   │   ├── EntryEditor.tsx
│   │   │   ├── EntryGraph.tsx              # 关联图可视化
│   │   │   └── EntryTimeline.tsx           # 时间线视图
│   │   │
│   │   ├── story/                          # 🔴 全新 — 创作面板
│   │   │   ├── StoryPanel.tsx
│   │   │   ├── SceneEditor.tsx
│   │   │   ├── OutlineView.tsx
│   │   │   └── ConsistencyReport.tsx
│   │   │
│   │   ├── buddy/                          # 🟡 灵感来自现有 buddy/
│   │   │   ├── BuddyWidget.tsx
│   │   │   └── BuddySpecies.ts
│   │   │
│   │   ├── settings/                       # 🟢 复用现有 web/components/settings/
│   │   │   └── SettingsPanel.tsx
│   │   │
│   │   └── ui/                             # 🟢 直接复用现有 components/ui/
│   │       ├── button.tsx                  #    Radix + Tailwind 组件
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── tabs.tsx
│   │       ├── toast.tsx
│   │       └── tooltip.tsx
│   │
│   ├── lib/
│   │   ├── store.ts                        # 🟢 复用现有 lib/store.ts
│   │   ├── api.ts                          # 🔴 Tauri invoke 封装 (非 fetch)
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   └── theme.ts
│   │
│   ├── hooks/
│   │   ├── useEntries.ts                   # 🟡 SWR 模式复用
│   │   ├── useChat.ts
│   │   ├── useConsistencyCheck.ts
│   │   └── useCommandPalette.ts
│   │
│   └── styles/
│       ├── globals.css                     # 🟢 复用现有 app/globals.css
│       └── design-tokens.css
│
├── prompts/                                # 🟢 复用现有 prompts/ 结构
│   ├── identity.md                         # Agent 身份
│   ├── constraint-rules.md                 # 约束检查规则
│   ├── worldbuilding-rules.md              # 构建规范
│   ├── character-creation.md               # 人物创建指南
│   ├── tone-and-style.md                   # 文体风格
│   ├── tool-usage.md                       # 工具使用说明
│   └── context-assembly.md                 # 上下文组装规则
│
├── tools/                                  # 🟢 复用现有 tools/ 结构
│   ├── entry/                              # 词条操作工具
│   │   ├── EntryRead.ts
│   │   ├── EntryCreate.ts
│   │   ├── EntryUpdate.ts
│   │   ├── EntrySearch.ts
│   │   └── EntryLink.ts
│   ├── story/                              # 创作辅助工具
│   │   ├── ConsistencyCheck.ts
│   │   ├── RelationshipTrace.ts
│   │   ├── ImplicationTrace.ts
│   │   ├── StoryGenerate.ts
│   │   └── SceneAnalyze.ts
│   ├── agents/                             # 🟡 子Agent定义 (远期)
│   │   ├── VerificationAgent.ts            # 独立一致性校验Agent
│   │   └── constants.ts
│   ├── system/                             # 保留的系统工具
│   │   ├── AskUserQuestion.ts
│   │   ├── TodoWrite.ts
│   │   └── AgentTool.ts                    # 子Agent生成器 (远期启用)
│   └── tools.ts                            # 工具注册表
│
├── commands/                               # 🟢 复用现有 commands/ 框架
│   ├── commands.ts                         # 注册表 (三类命令)
│   ├── creative/                           # 创作类 (PromptCommand)
│   │   ├── check.ts                        # 一致性检查
│   │   ├── write.ts                        # 续写
│   │   ├── brainstorm.ts                   # 创意发散
│   │   ├── outline.ts                      # 大纲
│   │   └── rewrite.ts                      # 重写
│   ├── entry/                              # 设定类 (PromptCommand + LocalJSX)
│   │   ├── new-entry.tsx                   # 创建词条
│   │   ├── edit-entry.ts                   # 修改词条
│   │   ├── link.ts                         # 建立关联
│   │   ├── graph.tsx                       # 关联图 (LocalJSX)
│   │   └── timeline.tsx                    # 时间线 (LocalJSX)
│   └── info/                               # 查询类 (LocalCommand)
│       ├── stats.ts                        # 统计
│       ├── tags.ts                         # 标签
│       ├── desc.ts                         # 快查
│       └── cost.ts                         # 消耗
│
├── core/                                   # 🟡 改造自通用 Agent 核心
│   ├── query-engine.ts                     # Agent Loop (骨架复用)
│   ├── context.ts                          # 分层上下文 (模式复用)
│   ├── context/                            # 🟢 复用现有 context/
│   │   ├── projectContext.ts               # 项目上下文
│   │   ├── sessionContext.ts               # 会话上下文
│   │   └── constraintContext.ts            # 约束摘要
│   └── prompts.ts                          # 系统提示词组装 (完全复用)
│
├── services/                               # 🟡 精简后的服务
│   ├── api/
│   │   └── llm.ts                          # LLM API 调用
│   ├── compact/
│   │   └── compact.ts                      # 🟢 对话压缩 (几乎直接复用)
│   └── consistency/
│       └── engine.ts                       # 🔴 一致性检查引擎 (全新)
│
├── memory/                                 # 🟢 复用 memdir 架构
│   ├── index.ts                            # INDEX.md 管理
│   ├── types.ts                            # 词条类型定义
│   ├── entryLoader.ts                      # 词条加载器
│   └── compression.ts                      # 四层压缩服务
│
├── state/                                  # 🟢 复用现有 state/ 模式
│   └── appState.ts
│
├── schemas/                                # 🟢 复用现有 schemas/ 模式
│   ├── entry.schema.ts
│   ├── config.schema.ts
│   └── constraint.schema.ts
│
├── utils/
│   ├── markdown.ts
│   ├── graph.ts                            # 🔴 图遍历 (全新)
│   ├── compression.ts                      # 🔴 压缩工具 (全新)
│   └── tokenCounter.ts
│
├── package.json
├── tailwind.config.ts                      # 🟢 复用现有 web/tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## 二、逐模块复用分析

```
图例: 🟢 直接复用  🟡 模式复用(重写内容)  🔴 全新设计  ⬜ 砍掉
```

### 前端层

| 模块 | 复用 | 说明与解决方法 |
|------|------|---------------|
| `components/ui/` | 🟢 | Radix + Tailwind 组件，直接拷贝并替换品牌色 CSS 变量 |
| `components/layout/` | 🟢 | Sidebar/Header/StatusBar 结构保留，内容换成词条导航 |
| `components/chat/` | 🟡 | ChatLayout/ChatWindow/ChatInput 框架复用。消息类型增加 `constraint_violation` 和 `entry_reference` 渲染卡片 |
| `components/entry-panel/` | 🔴 | 全新。用 Radix Tabs + @tanstack/react-virtual 做词条列表，D3.js/vis-network 做关联图可视化 |
| `components/story/` | 🔴 | 全新。SceneEditor 用 TipTap/ProseMirror 做富文本编辑器，ConsistencyReport 用 diff 风格展示约束违反 |
| `components/buddy/` | 🟡 | 参考 buddy 互动模式。framer-motion 做动画精灵，根据状态触发不同表情 |
| `lib/store.ts` | 🟢 | Zustand 模式直接复用，store 内容换成 Entry/Story/Chat |
| `lib/api.ts` | 🔴 | 通用方案用 fetch 调 API。改用 `@tauri-apps/api` 的 `invoke()` 调 Rust 后端 |
| `hooks/` | 🟡 | SWR/useState 模式复用。新增 `useConsistencyCheck`、`useGraphTraverse` |
| `styles/` | 🟢 | Tailwind config + CSS 变量体系直接复用，换品牌色 |
| `package.json` | 🟡 | 依赖清单复用（React/Zustand/SWR/Radix/Framer/Lucide），加 Tauri 依赖 |

### Agent 核心层

| 模块 | 复用 | 说明与解决方法 |
|------|------|---------------|
| `core/query-engine.ts` | 🟡 | Agent Loop 骨架复用（stream → tool_call → execute → feed back）。工具调用链改为设定检索优先于创作；增加 constraint interruption（硬约束违反时中断循环） |
| `core/context.ts` | 🟡 | memoize 分层收集完全复用。`getSystemContext` → `getProjectContext`（词条索引），`getUserContext` → `getSessionContext`（场景上下文） |
| `core/prompts.ts` | 🟢 | `systemPromptSections` 缓存机制直接复用。替换静态段和动态段的内容。⚠️ 词条四层压缩 + 缓存二分法推迟到 Phase 6（详见 §15 注释）。2026-05-20: 加入"够用就停"约束——GrepEntries/EntrySearch 返回已足够时不再逐条 EntryRead |
| `tools/` | 🟡 | 工具描述需标注返回格式（如 `{id, name, type}`），帮助 Agent 判断信息是否足够，减少不必要的后续调用 |
| `core/context/` | 🟡 | React Context Provider 模式复用。新增 `ConstraintContext`（注入当前活跃约束） |
| `tools/` | 🟡 | `buildTool()` 接口复用。工具从文件操作变为词条操作，`inputSchema` 全部重写 |
| `tools/tools.ts` | 🟢 | 分段注册（核心工具 + 可选工具）直接复用。砍掉 `USER_TYPE === 'ant'` 判断 |
| `commands/commands.ts` | 🟢 | 三类命令（Prompt/Local/LocalJSX）框架直接复用 |
| `prompts/` | 🟡 | 分文件管理提示词的模式复用。内容从 "软件工程规范" 变为 "文学创作规范" |
| `schemas/` | 🟢 | Zod schema 模式直接复用 |
| `state/appState.ts` | 🟢 | 全局状态管理模式复用 |

### 服务层

| 模块 | 复用 | 说明与解决方法 |
|------|------|---------------|
| `services/api/` | 🔴 | 通用方案用 Anthropic SDK，需多 Provider。Rust 侧用 `reqwest` 统一封装 Anthropic/OpenAI/DeepSeek 等 API |
| `services/compact/` | 🟢 | 消息压缩触发+执行逻辑几乎直接复用。压缩目标从 code block 变为 setting reference |
| `services/consistency/` | 🔴 | 全新。基于约束规则的模板匹配引擎。硬约束用精确匹配（名字/属性值），软规则用 LLM 辅助判断 |
| `memory/` | 🟢 | 完全复用 memdir 架构。`MEMORY.md` → 词条索引；`memoryTypes.ts` → 词条类型定义（character/location/faction/magic/timeline/event） |
| `memory/compression.ts` | 🔴 | 全新。模板驱动的四层压缩，保存词条时自动生成 Tier 0/1/2/3 |
| `utils/graph.ts` | 🔴 | 全新。基于关系边的 BFS 图遍历，输入词条 ID → 输出一跳/二跳邻居。用邻接表实现 |

### 后端层（Tauri/Rust）

| 模块 | 复用 | 说明与解决方法 |
|------|------|---------------|
| `src-tauri/` 全部 | 🔴 | 通用 Agent 框架没有这层。Rust 负责 FS 读写、Markdown 解析、图遍历、LLM API 代理 |
| `commands/entry_crud.rs` | 🔴 | 全新。词条的创建/读取/更新/删除，操作文件系统上的 `.md` 文件 |
| `commands/entry_search.rs` | 🔴 | 全新。轻量搜索——标签过滤（精确）、标题匹配（模糊）、内容搜索（ripgrep 或 Tantivy 索引） |
| `commands/graph_traverse.rs` | 🔴 | 全新。从 INDEX.md 构建邻接表，BFS 遍历，返回词条 ID 列表 + 距离 |
| `commands/file_watch.rs` | 🔴 | 全新。监听 entries/ 目录变化，自动更新索引。与 Obsidian 互通的关键 |
| `commands/api_proxy.rs` | 🔴 | 全新。reqwest 封装多 LLM Provider，前端不直接调 API |
| `models/entry.rs` | 🔴 | 全新。Serde 序列化的词条数据结构，含 frontmatter 解析 |
| `models/compression.rs` | 🔴 | 全新。根据词条类型选择压缩模板，生成四层压缩文本 |
| `services/consistency.rs` | 🔴 | 全新。硬约束用规则引擎（字段匹配），软规则调用 LLM 辅助判断 |
| `services/entry_index.rs` | 🟡 | memdir 思想复用。扫描 entries/ 目录，解析 frontmatter，维护 INDEX.md |

### 砍掉的模块

| 砍掉的模块 | 原因 |
|------------------|------|
| `bridge/` (IDE桥接) | 无 IDE 集成场景 |
| `services/lsp/` | 无编程语言支持需求 |
| `services/analytics/` (GrowthBook) | 个人工具，不需要遥测 |
| `services/oauth/` | 本地 API Key 配置即可 |
| `services/policyLimits/` | 无企业策略需求 |
| `services/remoteManagedSettings/` | 无远程配置下发需求 |
| `services/teamMemorySync/` | 暂不做团队协作 |
| `services/x402/` | 无支付协议需求 |
| `voice/` | MVP 阶段不需要 |
| `vim/` | GUI 不需要终端 vim 模式 |
| `ink/` | GUI 替代终端渲染 |
| `plugins/` | MVP 阶段不开放插件 |
| `coordinator/` (多Agent编排) | MVP 只做单 Agent |
| `upstreamproxy/` | 无企业代理需求 |
| `migrations/` | 从零开始，无旧配置 |
| `cost-tracker.ts` | 简化版合并到 `utils/tokenCounter.ts` |

---

## 三、工作区设计（World = 一个架空世界）

### 通用工作区机制参考

通用模式采用**隐式**项目检测：
- `getOriginalCwd()` = 当前终端目录，即"项目根"
- `getMemoryFiles()` 从 CWD 向上遍历目录树，寻找项目配置文件
- `pathInWorkingPath()` 检查文件是否在允许的目录内
- `--add-dir` 可添加额外目录到工作区范围
- 文件越靠近 CWD，优先级越高

### WorldForge 的工作区模型

WorldForge 需要**显式**的项目管理（GUI 应用无"当前目录"概念）：

```
一个 WorldForge 项目 = 一个架空世界

/Users/xxx/艾琳纪元.worldforge/
├── world.json                # 世界元信息
├── INDEX.md                  # 词条索引 (复用 memdir 架构)
├── entries/                  # 设定词条 — 所有故事共享
│   ├── characters/
│   │   ├── 艾琳·暗月.md
│   │   └── 凯恩·血誓.md
│   ├── locations/
│   │   └── 暗月要塞.md
│   ├── factions/
│   ├── magic_systems/
│   ├── events/
│   └── timeline/
├── stories/                  # 故事 — 每本书独立目录
│   ├── 暗月纪事/
│   │   ├── story.json         # 故事元信息
│   │   ├── outline.md
│   │   └── chapters/
│   └── 自由城邦风云/
│       ├── story.json
│       ├── outline.md
│       └── chapters/
├── outline/<storyId>/        # 大纲章节 (每章独立 .md)
│   ├── 01-序章.md
│   └── 02-暗月之影.md
├── sessions/                 # 对话历史持久化
├── memory/                   # 世界级记忆 — 已实现 ✅
│   ├── MEMORY.md             # 索引：每条记忆一行链接+描述
│   └── *.md                  # 单个记忆文件 (Agent MemoryWrite 创建)
│                              # 分类: user / feedback / project / reference
├── uploads/<convId>/         # 上传文件 (按对话隔离)
└── exports/                  # 导出 (Phase 6)
```

### 故事切换时的上下文变化

```
用户切换到"自由城邦风云"：
  1. 加载 story.json → 活跃人物、时间线范围
  2. 从设定层提取相关词条 (Tier 1 Header)
  3. 筛选该时间线范围内的约束
  4. 上下文注入: 世界名 + 故事名 + 时间线位置 + 活跃词条 + 约束
```

### 工作区模型映射

| 通用模式 | WorldForge |
|---|---|
| `getOriginalCwd()` → 当前终端目录 | `openWorld(path)` → 用户选择的文件夹 |
| `getMemoryFiles()` → 向上遍历配置文件 | `scanEntries()` → 向下遍历 entries/ |
| 项目配置文件注入每条消息 | INDEX.md + 词条 Header 注入上下文 |
| `--add-dir` 扩展范围 | 无需（世界文件夹即边界） |
| `pathInWorkingPath()` | 文件读写限制在世界文件夹内 |

### UI 三级导航

侧边栏结构: 世界 → 故事 → 对话

```
状态 A — 无世界打开:
  [创建新世界] [打开已有世界]

状态 B — 世界已打开:
  📖 艾琳纪元        ▾
    📚 暗月纪事      ▸  → [对话列表]
    📚 自由城邦风云  ▸
    + 新建故事
  ─────────
  📋 词条面板
  ⚙ 设置 / 切换世界
```

---

## 四、数据持久化架构 (Persistence Architecture)

> WorldForge 以**文件系统即数据库**为设计原则，没有关系型数据库，没有 ORM。所有数据以人类可读的文件格式存储在磁盘上。前端 Zustand store 是运行时缓存，唯一的数据权威是磁盘文件。

### 4.1 数据存储概览

所有世界数据存储在 macOS 应用数据目录下（`~/Library/Application Support/com.worldforge.app/worlds/`），每个世界一个子目录。以下是单个世界的目录结构：

```
<world_path>/
├── world.json                      # 世界元数据
├── entries/                        # 设定词条 (.md + YAML frontmatter)
│   ├── 艾琳·暗月.md
│   ├── 暗月要塞.md
│   └── ...
├── stories/                        # 故事元数据
│   ├── <storyId>.json              # 单个故事元信息 + 对话列表
│   └── ...
├── outline/<storyId>/              # 大纲章节 (每章一个文件)
│   ├── 01-序章.md
│   ├── 02-暗月之影.md
│   └── ...
├── sessions/                       # 对话历史 (JSONL)
│   └── <convId>.jsonl              # 单个对话的消息日志
└── uploads/<convId>/               # 对话上传文件 (每对话独立目录)
    └── <filename>                  # 上传文件
```

### 4.2 6 种数据类型的持久化细节

#### 类型 1 — 世界元数据 (world.json)

```json
{
  "name": "演示世界",
  "created_at": "2026-05-20T12:00:00Z"
}
```

| 属性 | 说明 |
|------|------|
| 路径 | `<world_path>/world.json` |
| 写入时机 | `initWorld()` 创建世界时 |
| 读取时机 | 打开世界时（Rust `list_worlds` 扫描全部 world.json） |
| 修改命令 | `rename_world` — 修改 name 字段 |
| Rust 文件 | `src-tauri/src/commands/world_init.rs` |

#### 类型 2 — 设定词条 (entries/)

词条以 Markdown 文件存储，YAML frontmatter 承载结构化元数据，正文承载详细描述：

```markdown
---
id: "erin-darkmoon"
name: "艾琳·暗月"
type: "character"
tags: ["血族", "皇室"]
created_at: "2026-05-20T12:00:00Z"
---

艾琳·暗月是暗月家族的长女...
```

| 属性 | 说明 |
|------|------|
| 路径 | `<world_path>/entries/<id>.md` |
| 写入时机 | Agent 调用 `EntryWrite` 工具时 |
| 读取时机 | `list_entries`（前端侧边栏）、`EntryRead`/`EntrySearch`（Agent 工具） |
| 修改命令 | `create_entry`, `read_entry`, `update_entry`, `delete_entry` — 统一在 `entry_crud.rs` |
| Agent 工具 | `EntryWrite`（合并 create/update 为单一工具）、`EntryRead`, `EntrySearch` |
| Rust 文件 | `src-tauri/src/commands/entry_crud.rs` |

#### 类型 3 — 故事元数据 (stories/)

每个故事一个 JSON 文件，包含故事标题、状态、以及下属对话列表：

```json
{
  "id": "story_xxxxx",
  "title": "暗月纪事",
  "status": "drafting",
  "created_at": "2026-05-20T12:00:00Z",
  "conversations": [
    { "id": "conv_xxxxx", "title": "对话 1", "created_at": "2026-05-20T12:00:00Z" },
    { "id": "conv_xxxxy", "title": "对话 2", "created_at": "2026-05-21T09:00:00Z" }
  ]
}
```

| 属性 | 说明 |
|------|------|
| 路径 | `<world_path>/stories/<storyId>.json` |
| 写入时机 | 创建故事、修改故事标题、新建/删除/重命名对话时 |
| 读取时机 | 打开世界时 — `load_stories` 读取所有 `<world_path>/stories/*.json` |
| 修改命令 | `save_story_meta`, `load_stories`, `delete_story_meta` |
| Rust 文件 | `src-tauri/src/commands/story.rs` |

**关键约束**：对话标题（conversation title）存储在 story JSON 中，而不是单独的文件。修改对话名时，必须调用 `save_story_meta` 更新整个故事 JSON。

#### 类型 4 — 大纲章节 (outline/)

每章一个独立 Markdown 文件，文件名 `NN-名称.md`（NN 为两位数字序号）：

```markdown
---
title: "序章"
order: 1
status: "done"    # done / drafting / outline
summary: "艾琳在暗月要塞遇险"
word_count: 2340
---

（正文内容...）
```

| 属性 | 说明 |
|------|------|
| 路径 | `<world_path>/outline/<storyId>/NN-<title>.md` |
| 写入时机 | Agent 调用 `WriteOutline` 工具（需要权限确认）、或前端 OutlineDetail 编辑保存 |
| 读取时机 | `read_outline`（读取全部章节概要）、`read_chapter`（读取单章正文） |
| 修改命令 | `read_outline`, `read_chapter`, `write_outline`, `delete_chapter` |
| 迁移 | `migrate_old_outline` — 自动将旧版单文件大纲分割为每章独立文件 |
| Rust 文件 | `src-tauri/src/commands/outline.rs` |

**注意**：大纲文件不含 "body" frontmatter 字段（title/order/status/summary 等元数据在 frontmatter，正文在 frontmatter 之后）。`build_chapter_md` 会自动剥离正文中可能重复的 frontmatter。

#### 类型 5 — 对话消息 (sessions/)

JSONL 格式（每行一个 JSON 对象），4 种消息类型：

```jsonl
{"type":"user","content":"帮我写第一章","timestamp":"2026-05-21T15:30:00Z"}
{"type":"assistant","content":"让我先查阅词条...","thinking":"（链式思考...）","timestamp":"2026-05-21T15:30:05Z"}
{"type":"tool_use","tool":"EntrySearch","input":{"query":"暗月要塞"},"timestamp":"2026-05-21T15:30:06Z"}
{"type":"tool_result","tool":"EntrySearch","output":"搜索到 3 个结果","timestamp":"2026-05-21T15:30:06Z"}
```

| 属性 | 说明 |
|------|------|
| 路径 | `<world_path>/sessions/<convId>.jsonl` |
| 写入时机 | 每条消息发出后立即 `append_session_message`（用户消息、assistant 回复含 thinking、tool_use、tool_result 均单独追加） |
| 读取时机 | 切换对话时 — `load_session` 读取 JSONL，前端再重建 thinking + toolCalls 结构 |
| 修改命令 | `append_session_message`, `load_session`, `list_sessions`, `delete_session` |
| Rust 文件 | `src-tauri/src/commands/session.rs` |

**消息重建规则**（前端 ChatLayout.tsx / AppShell.tsx）：

```
JSONL 原始流 (tool_use / tool_result 是独立行)
  → 遍历 JSONL 数组
  → "user" → StoreMessage (role: user)
  → "assistant" → StoreMessage (role: assistant, 含 thinking)
  → "tool_use" → 暂存到 pendingToolCalls
  → "tool_result" → 匹配 pendingToolCalls[-1] 的 result
  → "assistant" 出现时，把已收集的 toolCalls 附加到该消息

恢复后的结构:
  { id, role, content, thinking?, toolCalls?: [{ id, name, input, result }], timestamp }
```

#### 类型 6 — LLM 配置与凭据

API 配置存储在用户目录下的 JSON 文件：

```
~/.worldforge/credentials.json
  { "llmProvider": "openai", "llmModels": [...], "activeModel": "gpt-4o" }
```

| 属性 | 说明 |
|------|------|
| 路径 | `~/.worldforge/credentials.json` |
| 加载时机 | 应用启动时（`load_config` 从 Rust 读取） |
| 保存时机 | 设置面板保存时（Rust 命令写入） |

### 4.3 持久化注意事项

1. **所有变更都必须 invoke** — 不要只修改 Zustand store 而不调用对应的 Rust 命令。store 是缓存，磁盘是权威。
2. **会话消息是最后一公里** — Agent Loop 中的 `onComplete` / `onError` 回调必须调用 `append_session_message`。工具调用的 `tool_use` / `tool_result` 也需要分别持久化。
3. **JSONL 只追加，不修改** — 历史消息以追加方式写入，支持断点续传。删除会话时直接删除整个 `.jsonl` 文件。
4. **Story JSON 是全量覆盖** — `save_story_meta` 每次写入完整 story 对象（含 conversations 列表），不是增量更新。
5. **大纲文件名含序号** — 文件名 `NN-名称.md` 中的 NN 确定章节顺序。修改章节标题时，如果文件名变了也需要同步 rename 文件。
6. **上传文件按对话隔离** — 路径为 `<world>/uploads/<convId>/<filename>`，不同对话的文件不会混合。同时**文件内容在发送时自动注入到用户消息中**（最大 8000 字符截断），Agent 无需手动调用 FileRead 即可看到文件内容。

---

## 五、配置 & API Key 管理

> App 级 + World 级双层配置。

### 配置分层

```
┌─ App 级 (全局) ───────────────────┐
│ ~/.worldforge/config.json          │
│ { theme, language, fontSize,       │
│   defaultModel, apiKeySource }     │
├─ World 级 (每个世界) ──────────────│
│ <世界文件夹>/world.json            │
│ { name, defaultTimeline, language }│
└────────────────────────────────────┘
```

### API Key 存储策略

**API Key 不存入明文配置文件**（安全优先）。

```
macOS:  Keychain (通过 Tauri plugin 读取)
        security add-generic-password -a "worldforge" -s "anthropic-api-key" -w "sk-ant-..."

Windows: Credential Manager (通过 Tauri plugin)
Linux:  加密的 ~/.worldforge/credentials (chmod 600)

前端:   设置面板中输入 → Tauri invoke → Rust 侧存入系统凭据库
Agent:  每次 API 调用时 Rust 侧从凭据库读取，不经过前端
```

### LLM Provider 配置

```
设置面板 → LLM 配置:
  Provider:  [Anthropic ▼]  /  OpenAI  /  DeepSeek  /  自定义
  API Key:   [••••••••••]  (从 Keychain 读取)
  Model:     [claude-opus-4-7 ▼]
  Base URL:  (自定义 provider 时填写)
```

**实现时机**: Phase 1 — 第 0 步就是创建世界 + 配 API Key，否则 Phase 2 无法调 LLM。

---

## 六、错误处理 & 韧性

> Agent Loop 的重试逻辑 + API 错误处理。

### 错误分类

| 类别 | 场景 | 处理策略 |
|------|------|---------|
| **网络错误** | 无网络、超时 | 自动重试 3 次，指数退避。第 3 次失败后提示用户检查网络 |
| **API 错误** | 401 (Key 无效)、429 (限流)、5xx (服务端错误) | 401 → 提示检查 API Key；429 → 等待 Retry-After；5xx → 重试 |
| **文件 IO 错误** | 权限不足、磁盘满 | 提示具体错误 + 路径。不自动重试 |
| **约束违反** | Agent 创建了矛盾的设定 | 标记为 `constraint_violation`，提示用户选择：回滚 / 覆盖 / 记录为叙事事件 |
| **LLM 拒绝** | 安全策略拒绝 | 提示用户调整措辞 |
| **空响应** | LLM 返回空 | 重试一次，若仍空则提示切换模型 |

### 用户可见的错误层次

```
Toast 通知:  "文件写入失败: 权限不足"
            "API 限流，45 秒后重试..."
            ← 5 秒后自动消失，非阻塞

消息气泡:   硬约束违反 → 红色卡片，展示违反的规则 + 段落 + 建议
            ← 需要用户决策，不清除

StatusBar:  "⚠ 已重试 2/3 次" → "❌ API 不可达"
            ← 实时状态
```

### Agent 级保护

Agent 级保护策略：
- 单次 API 调用最多重试 3 次
- 单次对话最多 50 个 tool-call 循环（防死循环）
- Token 预算告警：当对话消费超过 $0.50 时 StatusBar 提示
- 硬约束违反时暂停 Agent Loop，等用户确认后继续

**实现时机**: Phase 2 — 第一次调 LLM API 时就必须有。

---

## 七、工具执行权限

> 工具执行权限模型。

权限系统采用简化版设计。

### 权限分级

```
只读工具 — 永远自动批准:
  EntryRead, EntrySearch, RelationshipTrace, SceneAnalyze

写入工具 — 首次使用该工具时确认，后续记住选择:
  EntryCreate, EntryUpdate, EntryLink
  → "允许本次操作? [是] [是，本次对话记住] [否]"

破坏性工具 — 每次都需要确认:
  EntryDelete
  → "确定删除「艾琳·暗月」？此操作不可撤销。[确定] [取消]"

外部调用:
  StoryGenerate, ConsistencyCheck
  → 这些调用 LLM API 产生费用，不是权限问题而是成本问题
  → 首次对话开始时提示 "此对话可能产生 API 费用"
```

### 前端交互

权限对话框设计：
```
┌─────────────────────────────────────────┐
│ Agent 想要创建词条                        │
│                                          │
│ 类型: character                         │
│ 名称: 新角色                             │
│                                          │
│ [本次允许] [本次对话始终允许] [拒绝]       │
└─────────────────────────────────────────┘
```

**实现时机**: Phase 2 — 首次实现 EntryCreate/EntryUpdate 工具时就需要。

---

## 八、Skill 系统

> 可复用的命名工作流。

Skill 是**可复用的创作工作流**。

### 内置 Skill（6 个）

| Skill | 触发 | 功能 |
|-------|------|------|
| **create-character** | 用户说 "创建人物" | 加载人物词条模板，引导填写属性，校验关联 |
| **world-audit** | 用户说 "审计世界观" | 扫描全部词条，检查硬/软约束，输出矛盾报告 |
| **chapter-outline** | 用户说 "生成大纲" | 基于当前故事和设定，生成章节大纲 |
| **expand-entry** | 用户说 "拓展词条" | 基于已有词条的关联，建议拓展方向和缺失属性 |
| **scene-check** | 写完场景后 | 检查场景一致性 + 叙事结构分析 |
| **export-ebook** | 用户说 "导出" | 组装所有章节为完整书稿，输出 Markdown/EPUB |

### Skill 定义格式

每个 Skill 是一个 `.md` 文件，包含触发条件 + 提示词模板：

```markdown
---
name: create-character
description: 创建新的人物设定词条。当用户说"创建人物""新角色"时触发。
---

# 创建人物

使用 EntryCreate 工具，按以下模板引导用户填写...

必填: name, bloodline, era
选填: appearance, personality, relationships
约束检查: 血统是否与魔法体系兼容？是否有同名人物？
```

### 扩展

用户可创建自定义 Skill（如 "fight-scene" 战斗场景模板，"dialogue-polish" 对话润色），存储在 `.worldforge/skills/` 下。

**实现时机**: Phase 4 — 在工具系统稳定后。

---

## 九、文件监听 & Obsidian 双向同步

> WorldForge 独有功能。

### 场景

用户同时用 Obsidian 编辑词条 `.md` 文件，WorldForge 需要在后台感知变化。

### 实现

```
Rust 侧: notify crate 监听 entries/ 目录
  → 文件变化事件 (创建/修改/删除)
  → 解析 frontmatter
  → 更新 INDEX.md
  → Tauri event → 前端刷新

前端: 监听 Tauri event
  → SWR mutate → 词条列表自动刷新
  → 如果 Agent 当前正在使用该词条，发出 toast 提示
```

### 冲突处理

```
场景: Agent 正在通过 EntryUpdate 修改词条，
      用户同时在 Obsidian 中修改了同一个文件

策略: Last-write-wins（简单可靠）
      Agent 写入前检查文件 mtime，
      如果外部修改时间晚于 Agent 读取时间 → 提示用户
      "词条在外部被修改，Agent 的修改可能覆盖。是否继续？"
```

**实现时机**: Phase 1 — 和词条 CRUD 同步实现。

---

## 十、时间线版本管理

> WorldForge 独有——同一词条在不同世界时代可能有不同状态。

### 数据模型

```typescript
type EntryTimeline = {
  era: string              // "奥雷利亚帝国时期"
  effectiveFrom: string    // 341 AC
  effectiveTo?: string     // 360 AC (undefined = 至今)
  properties: {
    // 此时期特有的属性覆盖
    status?: string        // "流亡中" vs "在位"
    location?: string      // 不同时期在不同地点
    abilities?: string[]   // 能力可能觉醒/丧失
  }
}
```

### 查询语义

```
"艾琳在 355 AC 时在哪里？"
  → 找 timeline 中 effectiveFrom <= 355 <= effectiveTo 的条目
  → 返回该时间段内的 location 属性

"艾琳当前的状态？"
  → 找 effectiveTo 为空（至今）的条目
```

### 存储

时间线版本直接存储在词条的 `.md` frontmatter 中：

```markdown
---
name: 艾琳·暗月
type: character
timeline:
  - era: 奥雷利亚帝国时期
    from: 341 AC
    to: 349 AC
    status: 皇女
    location: 奥雷利亚皇宫
  - era: 暗月纪第三纪元
    from: 349 AC
    status: 流亡者
    location: 自由城邦
---
```

**实现时机**: Phase 4 — 在一致性引擎建设后，为约束检查提供时间线感知。

---

## 十一、更新后的 Phase 任务排列

以上遗漏项集成到现有 Phase 中：

### Phase 1 更新（加入 API Key + 持久化 + 文件监听）
```
Task 1.0  世界观初始化 + world.json/entries/ 生成
Task 1.1  API Key 配置 (设置面板 → Tauri Keychain → Rust 读取)
Task 1.2  词条数据模型 (Rust)
Task 1.3  词条 CRUD + INDEX.md 自动维护
Task 1.4  文件监听 (notify crate → Tauri event → SWR mutate)
Task 1.5  会话持久化 (JSONL 读写 → 自动保存 → 恢复)
Task 1.6  前端词条面板 (EntryPanel + EntryEditor)
```

### Phase 2 更新（加入错误处理 + 权限）
```
Task 2.1  LLM API 代理 (Rust reqwest, 从 Keychain 读取 Key)
Task 2.2  错误处理框架 (重试/退避/Toast 通知)
Task 2.3  系统提示词组装
Task 2.4  Agent Loop 骨架 + 工具权限确认
Task 2.5  首批工具实现 (EntryRead/EntrySearch/EntryCreate)
Task 2.6  前端 Chat 对接 Agent (streaming + tool_use 卡片)
```

### Phase 4 更新（加入 Skill + 时间线）
```
Task 4.1  约束解析引擎
Task 4.2  图遍历加载器
Task 4.3  一致性检查工具 + 时间线感知
Task 4.4  前端一致性报告
Task 4.5  下游影响追踪
Task 4.6  Skill 系统 (6 个内置 Skill)
```

---

## 十二、最终完整性确认

系统完整性对照：

| 系统模块 | WorldForge 对应 | 状态 | Phase |
|---|---|---|---|
| main.tsx / 入口 | Tauri main.rs + App.tsx | ✅ | 0 |
| QueryEngine (Loop) | src/lib/agent-loop.ts | ✅ | 2 |
| Tool 系统 | agent-loop.ts tools[] + 执行 switch | ✅ | 2 |
| Command 系统 | /stats /desc /outline /write 等 | ✅ | 3 |
| Context 系统 | system-prompt.ts + 四层压缩(远期) | ⚠️ 基础完成, 压缩推迟 | 2/6 |
| State 管理 | Zustand store | ✅ | 0 |
| UI 层 | React + Tailwind + Radix | ✅ | 0 |
| 配置/Schemas | ~/.worldforge/credentials.json | ✅ | 1 |
| 错误处理 | 六类错误 + 三级呈现 | ✅ | 2 |
| 成本追踪 | per-conversation tokens + StatusBar | ✅ | 2 |
| 工作区/项目 | 世界观文件夹 + 三级导航 | ✅ | 0 |
| 记忆系统 (memdir) | entries/ + INDEX.md + world memory/ | ✅ | 1 |
| 世界级记忆 | memory/ + MEMORY.md + Agent工具 | ✅ | 1 (2026-05-21) |
| Permission | 三级权限 (一次/本对话/拒绝) | ✅ | 2 |
| Skill 系统 | 远期 | ⬜ | 6+ |
| 对话持久化 | JSONL (含thinking+tool) + 故事+大纲+词条 | ✅ | 1 |
| 搜索结果折叠 | CollapsedGroupMessage + groupSearchRead | ✅ | 3 (2026-05-21) |
| 文件监听 | notify crate + Obsidian 互通 | ✅ | 1 |
| 上传文件 | per-conversation + 内容自动注入 | ✅ | 3 (2026-05-21) |
| 对话压缩 + 四层压缩 | 远期 (Phase 6) | ⬜ | 6 |
| MCP | 远期 | ⬜ | 6+ |
| Bridge | 不需要 | ⬜ | — |
| Voice | MVP 不需要 | ⬜ | 6+ |
| 时间线版本 | 词条 timeline 属性 (远期) | ⬜ | 6+ |

### 当前设计: 单 Agent + 完整工具链

创作是线性的、依赖链式的——步骤之间有严格的顺序依赖，不存在"可同时进行的独立子任务"。因此 WorldForge 只使用 **一个 Agent**，拥有完整工具集：

```
单 Agent
  ├── 查设定词条 (EntryRead + EntrySearch)
  ├── 遍历关联 (RelationshipTrace)
  ├── 创作续写 (StoryGenerate)
  ├── 一致性检查 (ConsistencyCheck)
  ├── 大纲管理 (TodoWrite)
  ├── 修改词条 (EntryUpdate + EntryLink)
  └── 询问用户 (AskUserQuestion)
```

### 远期预留: 一致性校验子 Agent

当世界观的词条数量和复杂度增长后（100+ 词条、长章节），可启用独立校验子 Agent：

```
用户写完一章
  → 主 Agent spawn VerificationAgent (fork 模式)
      - 继承当前设定上下文
      - 专用工具: ConsistencyCheck, EntryRead, RelationshipTrace
      - 只读权限
      - 独立上下文窗口（不污染主对话）
  → 主 Agent 继续和用户讨论
  → VerificationAgent 返回独立校验报告
```

目录已预留 `tools/agents/VerificationAgent.ts` 和 `tools/system/AgentTool.ts`，远期待实现。

---

## 十三、0→1 构建流程

每个 Phase 的产出是可验证的功能增量。

### Phase 0 — 骨架搭建 ✅ 已完成

**目标**: 桌面壳 + 世界管理 + 对话界面能跑起来

```
Task 0.1  初始化 Tauri v2 + React + TS 项目
          npm create tauri-app@latest worldforge -- --template react-ts

Task 0.2  安装 UI 依赖
          Tailwind CSS, Radix UI, Zustand, Framer Motion, Lucide

Task 0.3  设计系统
          - tailwind.config.ts (琥珀品牌色, 暗色优先, CSS 变量 surface 调色板)
          - design-tokens.css (dark/light 双模式, 空间分隔 RGB)
          - globals.css (Apple 系统字体栈, 分隔线阴影, 滚动条)
          - components/ui/ (Button, Input, ScrollArea, Tooltip)

Task 0.4  Zustand Store
          - 世界→故事→对话 三层数据结构
          - 消息管理、流式状态、主题切换、侧边栏折叠

Task 0.5  AppShell + Sidebar (三级导航)
          - 状态 A (无世界): "创建新世界" / "打开已有世界"
          - 状态 B (有世界): 世界名▾ → 故事列表▸ → 对话列表
          - 新建故事、新建对话、删除 (hover 显示操作按钮)
          - 侧边栏折叠/展开 (ChevronLeft + 细竖线)

Task 0.6  Header (面包屑导航)
          - 世界名 / 故事名 / 对话名 层级显示
          - ⌘K 命令面板占位按钮
          - 暗/亮主题切换 (Sun/Moon 图标)

Task 0.7  StatusBar
          - 就绪/生成中状态
          - 消息计数、世界名、版本号

Task 0.8  Chat 组件
          - ChatLayout: 无世界→空态引导，无对话→选择提示，有对话→聊天界面
          - ChatWindow: 消息列表 + 空态提示词 + 流式 placeholder
          - ChatInput: 无边框输入框 + 低调发送按钮 + mock 逐字流式

Task 0.9  MessageBubble + MarkdownContent
          - 用户/AI 头像区分
          - Markdown 渲染 (标题/代码/引用/列表/粗体)
          - 流式文本光标效果

Task 0.10 主题 + 美化
          - 暗/亮双模式 (CSS 变量 + Tailwind surface 调色板反转)
          - Apple 系统字体栈 (SF Pro Text, Helvetica Neue)
          - 分隔线/侧边栏微阴影
          - 无容器输入框 (无边框、无发光、无背景块)

验证:
  [x] Tauri 窗口打开 (1200×800)
  [x] 创建世界 → 创建故事 → 创建对话 → 发送消息 → mock 流式回复
  [x] 暗/亮主题无缝切换 (surface 色值自动反转)
  [x] 侧边栏折叠/展开
  [x] 世界/故事/对话 CRUD (hover 显示删除按钮)
  [x] Header 面包屑: WorldForge → 世界名 / 故事名 / 对话名
  [x] 输入框极简风格 (无边框无发光)
  [x] 字体干净清晰 (Apple SF Pro Text)
```

### Phase 1 — 知识库核心（Day 3-6）✅ 已完成

**目标**: 创建/打开世界 → 项目结构初始化 → 词条 CRUD → 持久化

```
Task 1.0  世界观初始化 (Rust + 前端) ✅
          - 前端: "创建新世界" → 选择文件夹 → 生成 world.json + entries/ + INDEX.md
          - Rust: 扫描已有 entries/ → 解析 frontmatter → 构建 INDEX.md

Task 1.1  API Key 配置 (Rust + 前端) ✅
          - 设置面板 → 输入 API Key → Tauri invoke → Rust 存入凭据文件
          - ~/.worldforge/credentials.json (简化版，未用 Keychain)

Task 1.2  词条数据模型 (Rust) ✅
          - Entry / Relationship / Constraint struct
          - frontmatter 解析 (serde + gray_matter)

Task 1.3  词条 CRUD + INDEX.md 自动维护 (Rust) ✅
          - create/read/update/delete
          - 每次写操作后自动更新 INDEX.md

Task 1.4  文件监听 (notify crate) ✅
          - 监听 entries/ 目录变化 → Tauri event → 前端 SWR mutate
          - Obsidian 互通: 用户在 Obsidian 编辑 → WorldForge 自动感知

Task 1.5  会话持久化 (Rust + 前端) ✅
          - JSONL 格式存储对话，每条消息自动追加
          - 窗口关闭时 flush → 恢复时读取 JSONL → 左侧栏显示历史会话

Task 1.6  前端词条面板 ✅
          - EntryPanel + EntryCard + EntryEditor
          - 按类型分组，卡片式渲染

Task 1.7  故事/大纲/记忆持久化 ✅ (2026-05-21 新增)
          - stories/<id>.json 保存故事元信息+对话列表
          - outline/<storyId>/NN-name.md 每章独立文件
          - memory/ 目录 + MEMORY.md 索引，Agent 可读写
          - 所有 CRUD 操作都调用对应 Rust 命令同步磁盘

验证:  创建世界 → 创建词条 → 关闭重开 → 词条和对话都在。
       在 Obsidian 中修改词条 → WorldForge 自动刷新。
```

### Phase 2 — Agent 呼吸（Day 7-9）

**目标**: Agent 调 LLM，读/写词条，带错误处理和权限确认

```
Task 2.1  LLM API 代理 (Rust)
          - reqwest → Anthropic API (SSE streaming)
          - 从 Keychain/Credential Manager 读取 API Key
          - 支持多 Provider (Anthropic / OpenAI / DeepSeek)
          - Tauri event 推送 streaming chunks 到前端

Task 2.2  错误处理框架
          - 六类错误分类 + 三级呈现 (Toast / 消息卡片 / StatusBar)
          - 自动重试 (3 次, 指数退避)
          - Token 预算告警
          - Agent Loop 最大循环限制 (防死循环)

Task 2.3  系统提示词组装 ✅
          - 基础版: Agent 身份 + 工具说明 + 词条数量统计
          - ⚠️ 四层压缩 + 缓存二分法 + 图遍历加载 → 推迟到 Phase 6（和对话压缩一起做）

Task 2.4  Agent Loop 骨架 + 权限确认
          - 流式响应 + Tool Loop
          - 工具执行前检查权限 (只读/写入/破坏)
          - 权限对话框: "Agent 想创建词条 '新角色' [允许] [一直允许] [拒绝]"

Task 2.5  首批工具实现 (带权限)
          - EntryRead, EntrySearch (只读, 自动批准)
          - EntryCreate, EntryUpdate (写入, 首次确认)
          - Prompt 注入: 每个工具的用途描述

Task 2.6  前端 Chat 对接
          - Streaming 文本渲染
          - tool_use 卡片 (工具名 + 状态 spinner)
          - 约束违反消息渲染 (红色/黄色卡片)

验证:  "查艾琳的能力" → Agent 搜索词条 → 回复。
       "创建暗月要塞" → 权限弹窗 → 确认后文件生成。
       断开网络 → "网络不可用" Toast → 重试按钮。
```

### Phase 3 — 创作体验（Day 9-12）✅ 已完成

**目标**: 搜索折叠展示 + 故事续写 + 大纲系统 + 命令面板
**提前完成**: EntryUpdate, 三级侧边栏, GrepEntries, EntryWrite(合并), 权限弹窗, 文件上传含内容注入

```
Task 3.0  搜索/读取工具折叠展示 ✅ (2026-05-21)
          - 搜索结果折叠展示模式
          - groupSearchReadMessages() 检测连续 EntrySearch/GrepEntries/EntryRead 调用
          - 2条及以上纯搜索/读取工具消息合并为 CollapsedGroupMessage
          - 默认折叠显示 "EntryRead x3, EntrySearch x1 (5 次 / 3 轮)"，展开逐行查看
          - ToolCallsSummary 增强：显示 queried/read 的具体参数名而非仅计数
          - 不改工具定义，仅在渲染层 (ChatWindow+MessageBubble) 合并

Task 3.1  故事续写工具 ✅
          - Agent 基于词条上下文直接生成文本
          - 配合 EntrySearch/GrepEntries 自动加载相关词条
          - Agent 组合 "搜词条→读词条→生成文本" 流程

Task 3.2  大纲系统 ✅
          - 大纲存储: outline/<storyId>/NN-name.md (每章独立文件)
          - 右侧栏展示大纲树，点击章节在中间栏查看/编辑
          - ReadOutline / ReadChapter / WriteOutline / delete_chapter 工具

Task 3.3  更多工具 ✅
          - EntryLink: 建立/删除词条关联 ✅
          - SceneAnalyze: 分析场景叙事结构 ✅
          - EntryWrite: create+update 合并 ✅
          - MemoryRead / MemoryWrite: 世界级记忆体系 ✅ (2026-05-21)

Task 3.4  命令系统 ✅
          - /stats → 词条统计 (数量、类型分布)
          - /desc <词条名> → 快速查看词条摘要
          - /outline → 大纲概览（章数、完成度、摘要）
          - /write / /brainstorm / /rewrite → 透传到 Agent Loop

Task 3.5  ⌘K 命令面板 ✅
          - 快捷键: ⌘K
          - 模糊搜索: 命令名、词条名
          - 选中后直接执行或跳转

验证:
  [x] 说"续写一个场景"，Agent 自动搜索词条→加载上下文→生成文本
  [x] ⌘K 打开命令面板→搜索命令
  [x] 大纲面板展示章节树，点击跳转详情
  [x] 连续工具调用可折叠展示
```

### Phase 4 — 一致性引擎 + Skill（Day 14-17）

**目标**: Agent 检查设定一致性 + 可复用创作工作流 + 时间线感知

```
Task 4.0  分组工具消息聚合
          - 分组工具消息聚合模式
          - 按工具种类统计: "Read 100 files, Grep 30 patterns, Edited 5 files"
          - 在消息层聚合 TimelineBlock，生成 GroupedToolUseMessage
          - 与 TimelineBlock 同级展示，点击可展开每一类明细

Task 4.1  约束解析引擎 (Rust)
          - 解析词条 constraint 字段 → 硬约束(精确匹配)/软规则(LLM辅助)
          - 时间线感知: 约束在不同时间段可能不同

Task 4.2  图遍历加载器 (Rust)
          - BFS 邻接表遍历 → 下游影响分析

Task 4.3  一致性检查工具
          - ConsistencyCheck: 故事文本 vs 已知设定
          - 时间线感知: 检查规则在故事时间点是否生效

Task 4.4  前端一致性报告
          - ConsistencyReport: Diff 风格 + 违规高亮
          - 软规则 "有意为之" 确认 → 记录为叙事事件

Task 4.5  下游影响追踪
          - ImplicationTrace: 修改词条 → 追溯受影响的下游词条

Task 4.6  Skill 系统 (6 个内置 Skill)
          - create-character / world-audit / chapter-outline
          - expand-entry / scene-check / export-ebook
          - 用户可自定义 Skill (存储在 .worldforge/skills/)

验证:  写 "艾琳用冰魔法" → /check → 硬约束违反报告。
       精灵用铁剑 → WARNING + 有意为之确认 → 叙事事件记录。
       /skill create-character → 引导式创建新人物词条。
```

### Phase 5 — GUI 美化（Day 16-18）

**目标**: 像专业桌面应用一样精致

```
Task 5.1  主题系统完善
          - 暗色/亮色切换
          - 语义化 Token 全面覆盖
          - 字体: Inter + 中文字体 (Noto Sans SC)

Task 5.2  动画打磨
          - framer-motion 微交互
          - 消息气泡淡入
          - 词条卡片 Hover 效果
          - 命令面板弹出动画
          - Tool 调用状态流转动画

Task 5.3  关联图可视化
          - EntryGraph.tsx: D3.js / vis-network 力导向图
          - 节点 = 词条 (按类型着色)
          - 边 = 关联关系 (按关系类型着色)
          - 点击节点跳转词条详情

Task 5.4  时间线视图
          - EntryTimeline.tsx: 横向时间轴
          - 显示多个词条在不同世界时间的状态变化
          - 可拖拽缩放

Task 5.5  Buddy 电子宠物
          - BuddyWidget.tsx: 窗口右下角静动态精灵
          - 状态联动: 检测到矛盾 → 焦急表情；写完一章 → 庆祝
          - 物种/稀有度定义 (可后期扩展)

验证:  窗口精美，动画流畅，暗色模式下品牌色和谐，
       关联图可交互，时间线可视化可用，Buddy 有基本表情切换。
```

### Phase 6 — 打磨 + 发布（Day 19-21）

```
Task 6.1  对话压缩 + 词条上下文压缩
          - 🟢 对话压缩的触发 + 执行逻辑
          - 词条四层压缩 (Tier 0-3): 保存时自动生成，注入时按需加载
          - systemPromptSections 缓存二分法: 静态段全局缓存，动态段每 turn 刷新
          - 对话压缩: 上下文 tokens > 阈值 → 自动压缩早期 tool result
          - 图遍历选择性加载: 实体抽取 → 一跳关系 → 约束收集 → 语义补充
          - 摘要由 LLM 生成: "此阶段完成了 XX 设定修改，结果..."
          - 压缩后透明过渡，不丢失关键事实

Task 6.2  性能优化
          - 虚拟滚动确保 1000+ 词条列表不卡
          - Rust 侧图遍历优化 (邻接表缓存)
          - SWR 缓存策略调优

Task 6.3  Token 成本追踪
          - 🟡 Token 成本追踪
          - 每次 API 调用记录: tokens_in/out, cost, model
          - /cost 命令展示统计

Task 6.4  导出功能
          - 设定数据库导出 (JSON/Markdown/HTML)
          - 对话导出
          - 与 Obsidian 格式双向兼容

Task 6.5  打包发布
          - Tauri build: macOS .dmg + Windows .msi
          - 图标设计
          - README + 基本使用文档

验证:  完整工作流: 创建词条 → Agent 检索设定 → 续写故事 → 
       一致性检查 → 修改词条 → 下游影响提示 → 导出设定。
       全程无崩溃，token 消耗合理。
```

---

## 十四、关键架构决策

| 决策 | 理由 |
|------|------|
| Tauri 而非 Electron | 体积 15MB vs 150MB，内存 100MB vs 300MB，创作工具长期开着 |
| Rust 做后端而非 Node | 文件系统操作更快，图遍历性能好，macOS 沙盒权限模型更契合 |
| React + Tailwind + Radix | 使用成熟的 UI 设计系统 |
| 词条存储在文件系统 (.md) | 与 Obsidian 互通，人类可读，不需要数据库 |
| 四层压缩 + 图遍历加载 | 解决 "150 条词条无法全放上下文" 的核心问题 |
| 三层约束 (Hard/Soft/Narrative) | 精确区分 "设定错误" 和 "创作选择" |
| 单 Agent 而非多 Agent | 创作任务是线性的、依赖链式的，不存在可并行的独立子任务 |
| 预留 VerificationAgent | 远期当词条数量增长后启用独立一致性校验 |
| 文件监听自动同步 | WorldForge 和 Obsidian 可以同时使用 |

---

## 十五、上下文管理核心机制

### 词条四层压缩

每个词条在保存时自动生成四个压缩版本（模板驱动，非 LLM 摘要）：

- **Tier 0 — Token (~5-8 tokens/条)**: `艾琳·暗月 \| char \| 341-360 \| 火血` — 用于全局索引遍历
- **Tier 1 — Header (~30-50 tokens/条)**: 身份+能力+关联+位置 — 上下文注入的主力粒度
- **Tier 2 — Summary (~200-300 tokens/条)**: 完整结构化摘要 — 当前任务直接涉及的词条
- **Tier 3 — Full**: 文件原文 — Agent 需要深度阅读时加载

### 图遍历选择性加载

```
用户输入 → 实体抽取 → 直接词条 Tier 2 → 
一跳关系遍历 Tier 1 → 约束收集 → 
语义补充 → 上下文组装 (~1,500 tokens)
```

### 场景感知加载策略

5 种场景各有不同的加载策略：创作新内容、修改设定、一致性检查、探索浏览、创建新词条。

---

## 十六、远期基础设施规划

以下三项为面向大规模世界（500+ 词条）的远期基础设施升级，当前架构无需修改即可支撑。实施时机取决于用户群规模和数据量增长。

### 语义向量索引

**目标**：从"关键词匹配 + 图一跳遍历"升级为"语义相似度检索"。

**方案**：使用本地 ONNX 嵌入模型，将词条 Tier 1/2 文本转为向量，存入 sqlite-vec 扩展。搜索时对查询做同款嵌入，按余弦相似度返回 top-K，与现有 `EntrySearch` 的关键词结果合并排序。

- **模型选择**：`all-MiniLM-L6-v2`（~80MB，384 维），导出为 ONNX 格式本地推理
- **向量存储**：利用 Tauri 已有的 SQLite 能力，加载 [sqlite-vec](https://github.com/asg017/sqlite-vec) 扩展，向量与词条 ID 存在同一行
- **写入时机**：词条创建/更新时异步生成嵌入（debounce 2s），不阻塞用户操作
- **查询流程**：用户输入 → LLM 抽取搜索意图 → 本地嵌入 → sqlite-vec top-K → 与关键词结果合并去重 → 按相关性排序返回
- **优势**：完全本地、零 API 成本、离线可用；向量维度低，万条词条索引 < 15MB

**数据结构影响**：无。向量库为独立表，通过 `entry_id` 关联现有词条。

### 分面搜索

**目标**：在语义搜索之上叠加结构化过滤，实现"200 个角色中找出性格暴躁的火系法师"这类精确查询。

**方案**：纯计算层，对 `EntrySearch` 返回的 `IndexEntry` 列表做多维度筛选，不修改任何数据结构。

- **维度**：词条类型（7 种）、标签（tags）、属性字段（properties 的 key-value 对）、时间范围、关联密度（关系数多/少）
- **实现**：Rust 侧新增 `facet_entries(filters: FacetFilter) -> Vec<IndexEntry>` 命令，在 `EntrySearch` 结果集上做内存过滤。FacetFilter 支持 AND/OR 组合
- **UI**：搜索结果面板左侧显示分面计数（类似电商筛选栏），点击 facet 即时缩小结果集
- **优势**：零存储成本，纯计算；与语义搜索正交，互不影响

**数据结构影响**：无。`IndexEntry` 的 `tags` 和 `entry_type` 已包含分面所需的核心字段。

### 图谱驱动的关联推荐

**目标**：主动发现"你可能想关联"的词条，减少用户手动维护关系图的心智负担。

**方案**：基于现有 BFS 关系图做离线分析，不依赖 LLM。

- **协同过滤**：两词条共同关联的第三方越多，推荐权重越高（"A 关联了 B/C/D，B 关联了 C/D，则 A 可能也该关联 B"）
- **路径补全**：检测图中长度 2 的路径（A→B→C），若 A 与 C 无直接关联且共享属性或标签，推荐建立关联
- **属性相似度**：比较两词条 properties 的 key-value 重叠度，高重叠 + 无关联 = 推荐
- **实现**：Rust 后台定时（每 5 分钟或手动触发）遍历图，产出推荐列表存入 `relations/recommendations.json`。前端在词条详情页展示"推荐关联"卡片
- **计算量**：200 词条、1,000 条关系的图，全量分析 < 100ms；10,000 条关系时需优化为增量计算（仅分析变更波及的子图）

**数据结构影响**：无。推荐结果为独立 JSON 文件，不修改 `relations/index.json` 结构。

---

## 十七、技术栈总览

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri v2 (Rust) |
| 前端框架 | React 18 + TypeScript |
| 样式 | Tailwind CSS 3.4 |
| 组件库 | Radix UI |
| 状态管理 | Zustand |
| 数据获取 | SWR |
| 动画 | Framer Motion |
| 图标 | Lucide React |
| Markdown | react-markdown + remark-gfm |
| 虚拟滚动 | @tanstack/react-virtual |
| 字体 | Inter + JetBrains Mono + Noto Sans SC |
| LLM API | Anthropic (主) + OpenAI/DeepSeek (可选) |
| 后端通信 | Tauri invoke + Tauri event |
| 存储 | 文件系统 (.md) + frontmatter |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/WorldForge-amber?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMCAyMCAxMCAxMCAwIDEgMCAwLTIwWiIvPjxwYXRoIGQ9Ik0xMiA2djZsNCAyIi8+PC9zdmc+" />
    <img src="https://img.shields.io/badge/WorldForge-amber?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMCAyMCAxMCAxMCAwIDEgMCAwLTIwWiIvPjxwYXRoIGQ9Ik0xMiA2djZsNCAyIi8+PC9zdmc+" />
  </picture>
</p>

<p align="center">
  <strong>桌面的 AI 世界观工坊</strong><br/>
  管理架空世界设定词条 · 创作一致性故事 · 时间线可视化<br/>
  以文件为数据库，以 Agent 为作家
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-prototype-amber?style=flat-square" alt="status" />
  <img src="https://img.shields.io/badge/tauri-v2-blue?style=flat-square&logo=tauri" alt="tauri" />
  <img src="https://img.shields.io/badge/react-18-61DAFB?style=flat-square&logo=react" alt="react" />
  <img src="https://img.shields.io/badge/rust-backend-orange?style=flat-square&logo=rust" alt="rust" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

---

## 💡 核心哲学

> **设定是确定性的，故事是子集投影。**
>
> 先建好世界——它的物理法则、历史事件、人物关系——然后在里面讲各种故事。
> 每一次创作都是对"世界数据库"的一次查询和投影，AI Agent 确保投影不会违反设定约束。

**和其他方案的根本区别：**

| 方案 | 有词条数据库 | Agent 主动读写 | 时间线引擎 | 离线可用 |
|------|:-----------:|:------------:|:--------:|:------:|
| ChatGPT / Claude 对话 | ❌ 纯文本记忆 | ❌ 靠记忆硬编 | ❌ | ❌ |
| World Anvil / Campfire | ✅ | ❌ 无 AI Agent | ❌ 手动 | ✅ |
| Sudowrite | ❌ 无结构化世界 | ✅ 但有幻觉 | ❌ | ❌ |
| Obsidian + Claude | ✅ 手动维护 | ❌ 两个工具拼凑 | ❌ | ✅ |
| **WorldForge** | ✅ **文件即数据库** | ✅ **闭环工具链** | ✅ **事件桥接** | ✅ **本地 Tauri** |

---

## 🎯 能做什么

<p align="center">
  <em>一个完整的世界观 → AI Agent 理解它 → 在你创造的世界上写任何故事</em>
</p>

### 词条系统 —— 你的世界数据库

7 种类型的结构化设定词条（人物、地点、组织、体系、器物、时代、概念），Markdown 文件存储，YAML frontmatter 承载元数据。词条间可建立关联关系和约束规则。

```
🔮 赵远航 — 黎明号舰长，仿生义肢，对量子跃迁有PTSD
  ├── 关联：艾丽莎·陈（首席科学家）、黎明号（指挥）、暗物质异常区（警惕）
  └── 约束：任何他主持的跃迁操作，必须完成72小时充能周期
```

### 时间线 + 事件 —— 唯一的叙事桥梁

时间轴上的事件连接词条和大纲章。一个事件坐落在时间点、关联多个词条和大纲章。词条的关联变化（增/删/改）挂在事件上。

```
3纪元
  └─ 327年
       └─ 3月
            └─ 15日  [黎明号启航] —— 🏷 赵远航 · 艾丽莎·陈 · 黎明号 · 前哨7号
            └─ 15日  [舰长宣誓]     —— 🏷 赵远航 · 黎明号
                                        + 赵远航 ↔ 空壳受害者: 幸存者
  └─ 328年
       └─ 7月 ——— [遭遇暗物质异常]
       └─ 8月 ——— [量子通讯中断]
  └─ 330年
       └─ 2月 ——— [发现新地球]
       └─ 6月 ——— [第一次接触信号]
```

### AI Agent —— 理解你世界的作家

Agent 拥有完整工具链（读/写词条、创建事件、遍历关联图、检查一致性），在创作前自动搜索相关设定，在修改后自动检查约束冲突。

> "写一章关于黎明号在暗物质区的经历" → Agent 自动查词条 → 读关联 → 遍历图 → 检查约束 → 创作 → 一致性检查 → 输出

### 大纲 + 对话 —— 线性的创作

大纲章关联时间线事件，Agent 辅助创作。所有对话（Thinking + Tool Calls）持久化为 JSONL，重启不丢失。

---

## ⚡ 快速开始

```bash
git clone https://github.com/yourname/worldforge.git
cd worldforge
npm install
npm run tauri dev
```

启动后在设置面板填入 LLM API Key（支持 Anthropic/OpenAI/DeepSeek），创建一个世界，开始对话。

或者直接导入测试世界：解压 `test-world-星际拓荒纪元.zip` 到 `~/Library/Application Support/com.worldforge.app/worlds/`，立即体验词条 → 时间线 → 大纲 → 对话的完整链路。

---

## 🏗 架构

```mermaid
graph TB
    subgraph Frontend["React 前端"]
        Chat[ChatLayout 对话界面]
        Entry[EntryPanel 词条面板]
        Timeline[TimelinePanel 时间线]
        Outline[OutlineDetail 大纲详情]
    end

    subgraph Agent["Agent 循环 (agent-loop.ts)"]
        LLM[LLM API]
        Tools[工具注册表]
        Perm[权限控制]
        Stream[流式渲染]
    end

    subgraph Rust["Tauri/Rust 后端"]
        CRUD[词条 CRUD]
        Events[事件 + 时间线]
        Relations[关联图 BFS]
        Cascade[级联引擎]
        Constraint[约束检查]
        Session[对话持久化]
    end

    subgraph Storage["文件系统"]
        Entries[entries/*.md]
        TL[timelines/*.json]
        OL[outline/<id>/*.md]
        Rel[relations/index.json]
        Sessions[sessions/*.jsonl]
        Memory[memory/*.md]
    end

    Chat --> Agent
    Agent --> LLM
    Agent --> Tools
    Tools --> Rust
    Rust --> Storage
    Agent --> Cascade
    Cascade --> Entries
    Cascade --> TL
    Cascade --> Rel
```

---

## 📁 数据存储

没有数据库。所有数据以人类可读文件存在你的电脑上，和 Obsidian 互通。

```
<world>/
├── world.json                世界元数据
├── entries/                  词条 (.md + YAML frontmatter)
│   ├── characters/           人物
│   ├── locations/            地点
│   ├── organizations/        组织
│   ├── systems/              体系
│   ├── artifacts/            器物
│   ├── eras/                 时代
│   └── concepts/             概念
├── timelines/                时间轴 + 事件
│   ├── index.json            时间轴列表
│   └── <id>/events.json      事件数据
├── relations/index.json      统一关联图
├── outline/<storyId>/        大纲章 (.md)
├── stories/<id>.json         故事元数据
├── sessions/<id>.jsonl       对话历史
├── memory/                   世界记忆 (.md)
└── uploads/<convId>/         上传文件
```

---

## 🗺 路线图

| Phase | 内容 | 状态 |
|-------|------|:----:|
| 0 | 骨架搭建 — Tauri + React + Tailwind + 对话界面 | ✅ |
| 1 | 知识库核心 — 词条 CRUD + 持久化 + 文件监听 | ✅ |
| 2 | Agent 呼吸 — LLM API + Agent Loop + 权限 | ✅ |
| 3 | 创作体验 — 大纲 + 命令面板 + 搜索折叠 | ✅ |
| 4 | 要素关联 — 统一关系图 + 图遍历 + 一致性引擎 | ✅ |
| 5 | 时间线 — 事件系统 + 级联引擎 + 时间轴面板 | 🚧 90% |
| 6 | 打磨发布 — 上下文压缩 + 导出 + 打包 | ⬜ 远期 |

**Phase 5 剩余工作：** 前端 UI 精修、LLM 提示词调优、事件编辑 UI、旧 type:"event" 迁移

---

## 🧬 设计决策

| 决策 | 为什么 |
|------|--------|
| Tauri 而非 Electron | 15MB vs 150MB，创作工具长期开着 |
| 文件而非数据库 | 人类可读，与 Obsidian 互通，Git 可追踪 |
| 单 Agent 而非多 Agent | 创作是线性依赖链式的，不可并行 |
| 事件作为词条↔大纲的唯一桥梁 | 杜绝"章直接关联词条但事件里没有它"的矛盾 |
| 时间线 world-scoped 而非 story-scoped | 不同故事共享世界历史，通过事件筛选视角 |
| Precision 控制展示精度 | 底层的 08:00:00 只在你指定"8点"时才显示 |

---

## 🔧 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri v2 (Rust) |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 组件库 | Radix UI + Lucide Icons |
| 状态管理 | Zustand |
| 图算法 | BFS 邻接表 (Rust) |
| LLM | Anthropic / OpenAI / DeepSeek |
| 存储 | 文件系统 (.md / .json / .jsonl) |

---

## 📖 延伸阅读

- [完整设计文档](DESIGN.md) — 架构决策、Phase 规划、数据持久化方案、Claude Code 对比
- [时间线模块设计](TIMELINE_DESIGN.md) — 时间格式、事件模型、级联引擎、UI 设计

---

## 📄 License

MIT © WorldForge

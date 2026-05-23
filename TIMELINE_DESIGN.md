# WorldForge 时间线模块 — 完整设计框架

> 2026-05-23 讨论定稿。新增时间线顶级模块，重构词条/大纲/关联的时间维度。

---

## 一、架构概览

### 模块地位

```
当前 (Phase 4)                    本次设计后

entries/    (词条)                entries/    (词条, 7 种类型)
outline/    (大纲)                outline/    (大纲)
relations/  (关联图)              relations/  (关联图, 边类型调整)
                                  timelines/  (🆕 时间线, 顶级模块)
```

时间线从"词条/大纲的附属字段"升级为与词条/大纲平级的独立模块。

### 从属关系

```
World (世界)
├── entries/                       ← 世界级共享, 7 种类型
├── timelines/                     ← 🆕 世界级共享
│   ├── index.json                 ← 时间轴列表
│   └── <timeline_id>/
│       └── events.json            ← 该时间轴的所有事件
├── outline/<story_id>/            ← 故事级
├── relations/index.json           ← 世界级统一关联图
├── stories/<story_id>.json
├── sessions/<conv_id>.jsonl
└── memory/
```

---

## 二、核心实体

### 2.1 时间轴 (Timeline)

一个时间轴代表一个平行世界。默认只有一条，架构支持多条。

```typescript
type Timeline = {
  id: string;
  name: string;                   // "主线" / "平行世界A"
  description?: string;
  is_default: boolean;            // 默认时间轴
  world_id: string;
  time_format: TimeFormat;        // 🆕 创建时强制定义
  created_at: string;
  updated_at: string;
};
```

### 2.2 时间格式 (TimeFormat)

创建时间轴前，用户必须指定该世界观的时间单位体系。不同世界观的时间概念完全不同（中世纪奇幻有"纪元"和"年"，科幻可能有"星历"，修仙可能有"劫"和"会元"）。

```typescript
type TimeFormat = {
  units: TimeUnit[];              // 从大到小排列
};

type TimeUnit = {
  key: string;                    // "era" / "year" / "month" / "day" / "hour" / "minute" / "second" ...
  name: string;                   // 前端展示名: "纪元" / "年" / "月" ...
  max: number | null;             // 最大值 (null = 无上限)
  display_order: number;          // 前端展示顺序
  digits: number;                 // 底层存储位数 (用于零填充)
};
```

**示例——标准中世纪奇幻**：
```
unit        key     max     digits
占位符      _reserved  —     3       (始终 000, 预留更大时间概念)
纪元        era      3      1       (最多 3 个纪元)
年          year     null   6       (无限, 最多 999999 年)
月          month    12     2       (12 个月)
日          day      30     2       (30 天)
时          hour     24     2       (24 小时)
分          minute   60     2       (60 分钟)
秒          second   60     2       (60 秒)
```

每个 unit 的 `digits` 由 `max` 决定：`digits = max.toString().length`。null（无上限）时用默认 6 位，或由用户指定。

### 2.3 事件 (Event)

事件是时间轴上的基本单位，坐落在唯一时间点。是词条与大纲之间唯一的叙事桥梁。

```typescript
type Event = {
  id: string;
  timeline_id: string;

  // ── 核心字段 ──
  time_point: string;             // 🆕 8 段零填充数字串, 如 "000-3-000225-05-15-08-30-00"
  summary: string;                // 必须: 文字概述

  // ── 关联字段 (可选) ──
  linked_entries: LinkedEntry[];  // 关联词条
  linked_chapters: LinkedChapter[];// 关联大纲章 (衍生)
  relationship_changes: RelationChange[]; // 关联变化 (挂在事件上)

  // ── 衍生字段 ──
  belongs_to_stories: string[];   // 所属故事 (从 linked_chapters 推导)

  created_at: string;
  updated_at: string;
};

type LinkedEntry = {
  entry_id: string;
  perspective_summary?: string;   // 从该词条视角的概述 (可与 Event.summary 不同)
};

type LinkedChapter = {
  story_id: string;
  chapter_order: number;
};

type RelationChange = {
  entry_a: string;                // 主体词条
  entry_b: string;                // 目标词条
  change_type: "add" | "update" | "delete";
  relation: string;               // 关系类型: "ally_of", "located_in" 等
  description?: string;
};
```

### 2.4 词条 (Entry) — 改造后

```typescript
type Entry = {
  id: string;
  type: EntryType;                // 7 种: character/location/organization/system/artifact/era/concept
                                  // ⚠️ 删除 "event"
  name: string;
  properties: Record<string, unknown>;
  relationships: Relationship[];  // 词条间关联 (保留, 全量关联不受影响)
  constraints: Constraint[];
  tags: string[];
  timeline_summary: TimelinePeriod[]; // 🆕 保留, 改为系统生成的缓存 (不再手动编辑)
  body?: string;
};

// ENTRY_TYPES: ["character", "location", "organization", "system", "artifact", "era", "concept"]
```

### 2.5 大纲章 (Chapter) — 改造后

```typescript
type Chapter = {
  order: number;
  title: string;
  status: "outline" | "drafting" | "done";
  summary: string;
  body?: string;

  linked_events: {                // 🆕 关联事件 (创建时可空, 但鼓励尽快补齐)
    event_id: string;
    timeline_id: string;
  }[];

  // ── 衍生字段 ──
  involved_entries: string[];     // 从 linked_events → linked_entries 聚合
                                  // ⚠️ 删除 time_period (从事件推导)
};
```

---

## 三、底层时间存储格式

### 3.1 格式定义

```
xxx - yyy - a - b - c - d - e - f
 │      │    │   │   │   │   │   │
占位符  纪元  年  月  日  时  分  秒
```

8 段数字串，以 `-` 分隔。每段按该时间轴配置的 `digits` 做零填充，确保所有事件的时间串长度一致，字符串排序即为时间排序。

### 3.2 填充规则

**写入时**：用户指定的最细粒度以下全部填零。

```
用户输入: "第三纪元 225 年"           → 000-3-000225-00-00-00-00-00
用户输入: "第三纪元 225 年 5 月"      → 000-3-000225-05-00-00-00-00
用户输入: "第三纪元 225 年 5 月 15 日" → 000-3-000225-05-15-00-00-00
用户输入: "8:30"                      → 000-0-000000-00-00-08-30-00 (年/月/日待补齐)
```

**展示时**：去掉前导零，尾部连续零截断。

```
000-3-000225-05-15-08-30-00  →  "第三纪元 225 年 5 月 15 日 8:30"
000-3-000225-05-00-00-00-00  →  "第三纪元 225 年 5 月"
000-3-000225-00-00-00-00-00  →  "第三纪元 225 年"
000-0-000000-00-00-00-00-00  →  (未设置, 展示为空或提示)
```

### 3.3 排序保证

所有事件 `time_point` 字符串长度相同、每段位数固定、从粗到细降序排列 → 字符串自然排序 = 正确的时间顺序。不需要额外的比较逻辑。

---

## 四、关联图 (relations/index.json)

### 4.1 节点类型（改造后）

```typescript
type EntityType = "entry" | "outline" | "timeline" | "event";  // 🆕 新增 event
```

### 4.2 边类型

| from | to | 含义 | 方向 | 写入触发 |
|---|---|---|---|---|
| Entry | Entry | 词条间关系 (保留) | Phase 3 | Agent EntryLink |
| Entry | Event | 词条参与事件 | 🆕 | Event 创建/更新 linked_entries |
| Outline | Event | 章描绘事件 | 🆕 | 大纲章写入 linked_events |
| Event | Event | 事件因果/时序 | 远期 | 远期 |
| ~~Outline~~ | ~~Entry~~ | ~~章直接关联词条~~ | ❌ 删除 | — |

### 4.3 设计原则

Event 是 Outline 和 Entry 之间的**唯一桥梁**。章的 `involved_entries` 从事件聚合，不建直接边。杜绝"章直接关联了某词条但章的事件里没有它"的矛盾。

---

## 五、写入链路

### 5.1 创建/更新时间轴

```
创建 Timeline
  → 用户指定 time_format (强制)
  → 写入 timelines/index.json (追加)
  → 创建 timelines/<timeline_id>/events.json (空数组)
```

### 5.2 创建/更新事件

级联更新链路：

```
创建/更新 Event
  │
  ├─→ 写入 timelines/<timeline_id>/events.json
  │
  ├─→ 遍历 linked_entries
  │     ├─→ 更新 relations/index.json (Entry↔Event 边)
  │     └─→ 重算该词条的 timeline_summary[] 缓存
  │           └─→ 更新 entries/<id>.md 的 frontmatter
  │
  ├─→ 遍历 linked_chapters
  │     ├─→ 反向确保章的 linked_events 包含此事件 (自动补全)
  │     ├─→ 更新 relations/index.json (Outline↔Event 边)
  │     └─→ 重算章的 involved_entries (衍生)
  │
  ├─→ 如果有 relationship_changes
  │     └─→ 更新 relations/index.json (Entry↔Entry 边, 增/删/改)
  │
  └─→ 重算 belongs_to_stories (从 linked_chapters 的故事去重)
```

### 5.3 写入大纲章（关联事件）

双向写入，支持两种创作流程：

**路径 A — 先事件后章**：
```
创建 Event → 选择 Event → 写大纲章 (填入 linked_events)
  → 更新章 frontmatter
  → 反向填充 Event.linked_chapters
  → 更新 Event.belongs_to_stories
  → 聚合 linked_events 的所有 linked_entries → 生成章 involved_entries
  → 更新 relations/index.json (Outline↔Event 边)
```

**路径 B — 先章后事件**：
```
写大纲章 (linked_events 留空)
  → 章详情页提示"未关联时间线事件"
  → 用户事后创建/选择 Event
     → 回填章的 linked_events
     → 其余级联同路径 A
```

### 5.4 删除事件

```
删除 Event
  → 从 timelines/<timeline_id>/events.json 移除
  → 从 relations/index.json 移除所有关联边
  → 遍历 linked_entries → 重算各词条 timeline_summary[]
  → 遍历 linked_chapters → 从章的 linked_events 移除该项
  → 重算受影响章的 involved_entries
```

---

## 六、词条 timeline_summary[] 缓存重算

### 6.1 重算触发时机

- Event 创建/更新/删除（该事件 linked_entries 中的每个词条）
- Event 的 `linked_entries` 增删改
- Event 的 `time_point` 变更（移动事件在时间轴上的位置）

### 6.2 重算逻辑

```
对于词条 E:
  1. 查询 relations/index.json → 所有 Entry↔Event 边 → 得到 E 关联的所有 Event
  2. 按 Event.time_point 升序排列
  3. 对每个 Event:
     - 提取该词条在 linked_entries 中的 perspective_summary (如无则用 Event.summary)
     - 提取 relationship_changes 中 entry_a = E 或 entry_b = E 的变更
     - 生成一条 TimelinePeriod:
       { period: [time_point, null], state: perspective_summary, summary: event_summary,
         relationships: [{ target, description }] }
  4. 相邻事件合并: 如果连续两个 Event 的 state/relationships 无变化, 合并 period 的起始点
  5. 写入 E 的 frontmatter timeline_summary
```

### 6.3 节点边映射

通过 `relations/index.json` 统一关联图，不走文件系统搜索。Event 和 Entry 的关联存储在图边中，与词条内嵌 `relationships[]` 字段并存但互不冲突。

---

## 七、前端展示

### 7.1 侧边栏入口

侧边栏左下角功能区，时间线按钮位于"新故事"和"设置"之间：

```
📖 艾琳纪元
  📚 暗月纪事
  📚 自由城邦风云
  ─────────
  📋 词条面板
  ─────────
  🕐 时间线        ← 🆕 左下角
  ➕ 新故事
  ⚙ 设置
```

点击后，时间线面板在中间对话窗口区域覆盖展示（与词条面板、大纲面板等一致）。

### 7.2 时间线面板布局

```
┌──────────────────────── 时间线面板 ────────────────────────────┐
│  [词条▾]  [大纲▾]  [故事▾]   ← 筛选栏                           │
│                                                                  │
│  时间轴                        事件                              │
│  ────────────    ─────────────────────────────────────────────   │
│  第三纪元225年   │ [暗月陷落] [艾琳逃亡] [凯恩决裂] ←横向滚动→  │
│  第三纪元225年5月│ [新盟约签订]                                   │
│  第三纪元226年   │ [自由城邦建国] [魔法复兴] [瘟疫爆发]           │
│  第三纪元228年   │                                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**时间轴列 (左侧)**：
- 从上到下按时间升序排列，每个有事件的时间点占一行
- 展示文字使用世界观本地化格式（如"第三纪元 225 年"、"第三纪元 225 年 5 月 15 日"），截断尾部连续零值
- 排序依据底层 `time_point` 字符串（零填充数字串，字符串排序即时间排序）

**事件列 (右侧)**：
- 同一时间点的事件在同一行，从左到右横向排列
- 同一时间点事件过多时**横向滚动**，不换行
- 事件卡片为紧凑的圆角矩形，显示事件标题/摘要的前几个字

**事件详情气泡框**：
- 点击事件卡片触发，气泡框出现在该事件**上方**
- 气泡框底部有箭头（▼）突出连接指向事件卡片
- 气泡框内展示：
  - 概述 (Event.summary)
  - 关联大纲 (linked_chapters → 章标题列表)
  - 关联词条 (linked_entries → 词条名列表，含 perspective_summary)

### 7.3 筛选栏

面板顶部的筛选栏支持三种维度的筛选：

| 筛选项 | 效果 |
|---|---|
| 词条 | 选中某词条后，只显示该词条参与的事件 |
| 大纲 | 选中某大纲章后，只显示该章关联的事件 |
| 故事 | 选中某故事后，只显示 `belongs_to_stories` 包含该故事的事件 |

三个筛选项可组合使用（AND 逻辑）。不选时显示时间轴上全部事件。

### 7.4 大纲详情页 — 事件关联模块

章详情页新增区域：展示该章关联的所有事件。未关联事件时醒目提示引导用户补齐。

### 7.5 词条详情页 — 时间线模块

按时间轴展示该词条关联的所有事件，包含：事件概述（词条视角）、与其他词条关联的变化（增/删/改）。全量关联模块（`relationships[]`）保持不变，独立展示。

### 7.6 时间线视图面板（远期）

以词条为主体，Gantt 风格展示生命线 + 状态变化 + 事件标记。从所有词条的 `timeline_summary[]` 聚合渲染。

---

## 八、迁移路径

### 8.1 现有数据迁移

| 数据 | 迁移操作 |
|---|---|
| `entries/events/*.md` (type: "event" 词条) | 提取为 Event, 写入对应时间轴的 events.json |
| 词条 `timeline_summary[]` | 保留字段，重置为从 Event 重算 |
| 大纲章 `time_period` | 删除字段，引导用户创建 Event 并关联到章 |
| 大纲章 `involved_entries` | 保留字段，改为衍生 (从 linked_events 聚合) |
| `relations/index.json` | 移除 Outline↔Entry 边；新增 Entry↔Event 和 Outline↔Event 边 |
| 大纲章与词条的关联 (旧 `add_chapter_entry_relations`) | 逻辑删除，不再在写章时自动建 Entry↔Outline 边 |

### 8.2 ENTRY_TYPES 变更

```
变更前: ["character", "location", "organization", "event", "system", "artifact", "era", "concept"]
变更后: ["character", "location", "organization", "system", "artifact", "era", "concept"]
```

### 8.3 存储变更

新增文件：
- `<world>/timelines/index.json`
- `<world>/timelines/<timeline_id>/events.json`

保留不变：
- `<world>/entries/` (内部删除 `events/` 子目录)
- `<world>/outline/<story_id>/`
- `<world>/relations/index.json` (边类型调整)
- `<world>/stories/`, `<world>/sessions/`, `<world>/memory/`

---

## 九、Rust 层新增模块

### 9.1 命令

```
commands/timeline.rs           ← 🆕 时间轴与事件 CRUD
  create_timeline
  update_timeline
  delete_timeline
  list_timelines
  create_event
  update_event
  delete_event
  list_events (支持按 timeline_id / story_id 筛选)
  move_event                ← 修改事件 time_point
```

### 9.2 模型

```
models/timeline.rs             ← 🆕 Timeline, Event, TimeFormat, TimeUnit
models/entry.rs                ← 删除 EntryType::Event, EntryType 减为 7 种
models/graph.rs                ← EntityType 新增 Event
```

### 9.3 服务

```
services/event_cascade.rs      ← 🆕 事件级联更新引擎
  - recalc_entry_timeline_summary()
  - sync_chapter_linked_events()
  - sync_event_linked_chapters()
  - derive_belongs_to_stories()
  - apply_relation_changes()
```

### 9.4 变更

```
commands/relations.rs          ← 节点类型新增 "event"
commands/outline.rs            ← 删除 add_chapter_entry_relations()
                                 linked_events 替代 time_period
commands/entry_crud.rs         ← 禁止创建 type: "event" 的词条
```

---

## 十、任务分解 (建议 Phase 5)

```
Task 5.0  时间格式引擎
          - Rust: TimeFormat/TimeUnit 模型 + 填充/解析/排序/展示转换
          - 前端: 时间轴创建向导 (选择时间单位体系)

Task 5.1  时间轴与事件存储
          - Rust: Timeline/Event CRUD, timelines/index.json + events.json
          - Event 模型: time_point + summary + linked_* + relationship_changes
          - EntityType 扩展为 entry/outline/timeline/event

Task 5.2  事件级联更新引擎
          - 创建/更新/删除 Event 的完整级联链路
          - timeline_summary[] 自动重算
          - linked_chapters ↔ linked_events 双向同步
          - belongs_to_stories 自动推导
          - relation_change → relations/index.json 自动更新

Task 5.3  大纲改造
          - 删除 time_period, 新增 linked_events
          - involved_entries 改为衍生 (从 Event 聚合)
          - 删除 add_chapter_entry_relations()
          - 大纲详情页新增事件关联模块
          - 写章双向流程: 先事件后章 / 先章后事件

Task 5.4  词条改造
          - 删除 ENTRY_TYPES 中的 "event"
          - timeline_summary[] 改为只读缓存 (不再手动写入)
          - 词条详情页时间线模块: 按时间轴展示关联事件 + 关联变化
          - 全量关联模块保持不变

Task 5.5  关联图调整
          - 新增 EntityType::Event 节点
          - 删除 Outline↔Entry 直连边
          - BFS 遍历支持 4 种节点类型

Task 5.6  数据迁移
          - type:"event" 词条 → Event
          - 词条 timeline_summary[] 全量重算
          - 大纲章迁移引导

Task 5.7  前端 UI
          - 侧边栏新增时间线入口
          - 时间轴详情页 (事件列表 + 事件详情)
          - 大纲详情页事件关联模块
          - 词条详情页时间线展示改造
```

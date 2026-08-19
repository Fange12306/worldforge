# WorldForge 世界构建研究 — 全流程模板

> **用途**: 新上下文(新会话)中按此模板从头复现/接续"宏观大类研究→落知识库"的全部工作。
> **启动方式**: 新会话先读本文件, 再读 `public/knowledge-base/index.json`(当前知识库状态)和 `docs/research/`(已有报告), 然后按模板执行。
> **当前完成状态**(截至本模板编写): 11 大分类、137 篇知识库文档、160 份研究笔记。经济/军事/技术/语言/宇宙/种族六大骨架重做扩为 13 篇(笔记 70-147), 新增第 11 类「文化」(意义系统面, 笔记 148-160)。**宏观十一大类全部完成。**

---

## 一、总体架构(先理解全貌)

### 1.1 已完成的大类与产出

| 大类 | 研究主报告 | 笔记编号 | 知识库目录(文档数) |
|---|---|---|---|
| 地理 | `docs/research/geo-worldbuilding-from-zero.md` | 01-13 | `geography/`(13) |
| 文明 | `docs/research/civilization-from-zero.md` | 14-26 | `civilization/`(13) |
| 历史 | `docs/research/history-from-zero.md` | 27-38 | `history/`(13) |
| 法则 | `docs/research/laws-from-zero.md` | 39-50 | `laws/`(7) |
| 宏观扩展(旧骨架笔记已全部删除) | —— | 51-57(经济/军事/技术/语言/宇宙/种族旧笔记已删) | 全部大类已重做, 见下行各行 |
| 经济(重做) | `docs/research/economy-from-zero.md` | 70-82 | `economy/`(13) |
| 军事(重做) | `docs/research/military-from-zero.md` | 83-95 | `military/`(13) |
| 技术(重做) | `docs/research/technology-from-zero.md` | 96-108 | `technology/`(13) |
| 语言(重做) | `docs/research/language-from-zero.md` | 109-121 | `language/`(13) |
| 宇宙(重做) | `docs/research/cosmos-from-zero.md` | 122-134 | `cosmos/`(13) |
| 种族(重做) | `docs/research/species-from-zero.md` | 135-147 | `species/`(13) |
| 文化(新增) | `docs/research/culture-from-zero.md` | 148-160 | `culture/`(13) |

**宏观十一大类全部完成。后续方向: 微观要素**(力量体系/人物角色/物品神器/聚落场景/组织势力)——每个微观大类也走同一套流程, 新笔记编号从 161 开始。

### 1.2 世界观完整框架(六大维度)

**超验(法则) × 物理(宇宙/地理) × 生命(种族/生物) × 社会(文明/经济/军事/技术) × 文化载体(语言) × 时间(历史)**

宏观维度已全部补齐。后续方向: **微观要素**(力量体系/人物角色/物品神器/聚落场景/组织势力)——每个微观大类也走同一套流程。

### 1.3 贯穿示例世界「米拉斯」

所有主报告内嵌同一个示例世界"米拉斯", 各篇互相衔接, 展示每个大类如何落地:
- 法则: 灵脉法则(能量沿板块缝合线)/血月法则(41 年周期)/灵魂法则(能量实体死后归灵脉)
- 地理: 龙骨山脉/苍原高原/丰饶平原/风语草原/白雾荒漠/北寒原/火链群岛/缝合地峡
- 文明: 灵枢城(神权城邦)/潮邦(航海共和国)/云顶寺(隐修)/风语游牧/雾盐邦/北境遗民
- 历史: 血月 41 年周期=历史节拍器; 灵权革命(轴心时刻, 800 年前); 三次灵脉战争

---

## 二、研究阶段(workflow 并行调研)

### 2.1 方案设计(先给用户确认)

1. 把大类拆成 **10~13 个主题块**, 按阶段组织(如: 起源/结构/互动/兴衰/方法论);
2. 用 `ask_user_question` 让用户确认方案(或自定义增删);
3. 方案示例(文明篇的拆分模式): 每主题块一句话描述研究内容。

### 2.2 分批并行研究(防截断的关键!)

**坑**: workflow 返回值超过约 90KB 会被截断(只剩前几个主题)。**必须分批跑**: 每批 **3~5 个主题**, 每主题 2500~4000 汉字。3 个批次左右完成一个大类。

#### 模板 A: workflow 方式(推荐, 一个调用并行多主题)

完整可复制脚本(每批一个, 只需改 TOPICS 数组):

```js
// meta 部分(workflow 工具调用参数)
// { "name": "xxx-research-batchN", "description": "...", "phases": [{"title": "Research", "detail": "N topic researchers"}] }

const TOPICS = [
  { id: "slug-a", title: "主题块 A: 研究内容一句话(含需覆盖的子主题)" },
  { id: "slug-b", title: "主题块 B: 研究内容一句话" },
  // ... 每批 3~5 个, 总字符量控制在 90KB 以内
];

const basePrompt = (t) => `你是一名世界构建(Worldbuilding)/[领域]研究者。围绕主题「${t.title}」做文献/理论研究, 产出紧凑的中文研究报告笔记。

服务目标: 帮助"从0到1构建一个完整、合理、契合主题的虚构世界"。本主题属于[大类名]大类。研究理论与方法(经典理论、学术机制、代表学者与著作), 不是 AI 工具。

要求:
1. 用 web_search 搜索 4~6 次。
2. 输出 markdown 笔记, 结构:
   ## 核心理论 (概念与原理, 分点)
   ## 机制与案例 (机制细节, 经典案例)
   ## 关键学者与著作 (人名/书名/观点, 中文+英文)
   ## 对虚构世界构建的启示 (具体指导)
   ## 来源链接 (实际用过的 URL, 每条标注内容点)
3. 控制篇幅: 全文 2500~4000 汉字, 信息密度高, 不冗余。
4. 全部中文撰写(专有名词可保留英文)。
5. 最终只输出这份 markdown 笔记, 不要寒暄。`;

const results = {};
for (const t of TOPICS) {
  results[t.id] = await agent(basePrompt(t), { label: t.title.slice(0, 12), phase: "Research" });
}
const failed = TOPICS.filter((t) => !results[t.id]).map((t) => t.id);
return { topics: TOPICS.map((t) => t.id), notes: results, failed };
```

#### 模板 B: 裸 subagent 方式(不用 workflow, 直接调 subagent 工具)

**关键**: 多个 subagent 在同一消息里并行发起(每条独立、自包含); 每个 subagent 的提示词必须**完整自足**(它看不到本会话上下文); 每个 subagent 独立执行 web_search 与整理。

```text
subagent 提示词模板(每主题一个):

你是一名世界构建(Worldbuilding)/[领域]研究者。围绕主题「[主题块标题+内容]」做文献/理论研究, 产出紧凑的中文研究报告笔记。

服务目标: 帮助"从0到1构建一个完整、合理、契合主题的虚构世界"。本主题属于[大类名]大类。研究理论与方法(经典理论、学术机制、代表学者与著作), 不是 AI 工具。

要求:
1. 用 web_search 搜索 4~6 次。
2. 输出 markdown 笔记, 结构:
   ## 核心理论 (概念与原理, 分点)
   ## 机制与案例 (机制细节, 经典案例)
   ## 关键学者与著作 (人名/书名/观点, 中文+英文)
   ## 对虚构世界构建的启示 (具体指导)
   ## 来源链接 (实际用过的 URL, 每条标注内容点)
3. 控制篇幅: 全文 2500~4000 汉字, 信息密度高, 不冗余。
4. 全部中文撰写(专有名词可保留英文)。
5. 最终只输出这份 markdown 笔记, 不要寒暄。
```

调用方式(并行发起 3~5 个, run_in_background 默认 true):

```text
subagent({ description: "研究: [主题块A]", prompt: "<上面的模板, 填入主题A>" })
subagent({ description: "研究: [主题块B]", prompt: "<上面的模板, 填入主题B>" })
// 同一消息里并行发起全部; 全部完成后收集结果
```

注意: 裸 subagent 方式每批 3~5 个并行, 批次之间也要等上一批收集完再发下一批(避免同时产出过多超出上下文); 若用 workflow 则无此顾虑(前台阻塞)。

#### 派生子代理的提示词模板(其余任务类型)

研究完成后的整理/撰写任务也可派生 subagent(提示词同样须自足, 且要传入文件路径与内容要求):

```text
[写主报告] 提示词要点:
- 提供: 各主题笔记的完整内容(粘贴), 目标文件路径 `docs/research/<slug>-from-zero.md`;
- 要求: 按"执行流程(每步[输入]→[操作]→[决策规则]→[输出产物]→[检查点])+ 贯穿示例 + 一致性总检清单 + 关键学者总表 + 笔记索引"组织; 全部中文; 操作步骤具体可执行。
- 若笔记内容过长, 可让子代理只写骨架, 由主 agent 填充。

[写研究笔记归档] 提示词要点:
- 提供: 主题笔记原文(或要点), 目标路径 `docs/research/notes/<编号>-<slug>.md`;
- 要求: 结构固定(`# 笔记 NN: 标题` → `## 核心理论` → `## 机制与案例` → `## 关键学者与著作` → `## 对虚构世界构建的启示` → `## 来源链接`); 保留全部文献与 URL。

[写知识库文档] 提示词要点:
- 提供: 笔记原文(或要点), 目标路径 `public/knowledge-base/<分类>/<编号>-<slug>.md`;
- 要求: **去掉文献式内容**(不保留"关键文献/来源链接"章节), 只留可操作知识/表格/清单; 每节含"构建操作"(可执行步骤); 全部中文。
```

### 2.3 抢救截断结果(如发生)

- 截断的完整输出保存在 `/var/folders/.../dsh-spill-*/session-*/xxx-workflow.txt`;
- 用 node 脚本按 `"<key>": "` 提取各主题值(注意转义); 若完整文件仍超限, 重跑该主题(可单独跑一个主题)。

---

## 三、产出阶段(三份交付物)

### 3.1 研究主报告 `docs/research/<slug>-from-zero.md`

结构(参考已有报告):
1. **标题+目的+定位**(与其他大类的衔接关系);
2. **执行流程**: 每步含 `[输入] → [操作] → [决策规则] → [输出产物] → [检查点]`(操作要具体可执行, 决策规则是"纪律", 检查点是清单);
3. **贯穿示例**: 用米拉斯世界展示每一步实际输出;
4. **一致性总检清单**(分层的 checkboxes);
5. **关键学者与著作总表**(表格);
6. **各主题研究笔记索引**(编号+文件路径)。

### 3.2 主题笔记归档 `docs/research/notes/<编号>-<slug>.md`

- 每个主题块一份, 编号接续(当前已到 69, 新的从 70 开始);
- 结构固定: `# 笔记 NN: 标题(slug)` → `## 核心理论` → `## 机制与案例` → `## 关键学者与著作` → `## 对虚构世界构建的启示` → `## 来源链接`;
- 保留全部文献与来源(知识库文档里才去掉)。

### 3.3 知识库文档 `public/knowledge-base/<分类目录>/<编号>-<slug>.md`

- **去掉文献式内容**: 不保留"关键文献/来源链接/数据出处"章节——只留可操作的知识、表格、清单;
- 按章节主题拆分(一个大类可拆 2~13 篇);
- 文件内结构: `# 标题` → 核心理论/机制要点 → 构建操作(可执行步骤)→ 检查点/清单;
- **命名**: `<两位数编号>-<slug>.md`(如 `01-overview.md`, `02-magic-systems.md`)。

---

## 四、知识库注册与验证

### 4.1 index.json 结构

```json
{
  "name": "WorldForge 知识库",
  "nameEn": "WorldForge Knowledge Base",
  "categories": [
    {
      "id": "geography", "title": "地理", "titleEn": "Geography",
      "description": "...", "descriptionEn": "...",
      "docs": [
        { "id": "01-overview", "title": "...", "titleEn": "...", "path": "geography/01-overview.md" },
        // ...
      ]
    }
    // 每个大类一个 category
  ]
}
```

### 4.2 铁律: 每个大类一个目录!

- **绝不把一个大类的文档塞进另一个大类的目录**(曾犯过把经济/军事/技术/语言塞进文明目录的错误, 用户明确要求每个大类独立目录);
- 新增大类 → 新建 `public/knowledge-base/<id>/` 目录 + index.json 加 category;
- doc id 建议加分类前缀避免冲突(如 `civ-13-methodology`, `cosmos-01`, `economy-01`)。

### 4.3 验证命令

```bash
node -e "
const idx = require('./public/knowledge-base/index.json');
const fs = require('fs');
let ok = 0, fail = 0;
for (const cat of idx.categories) {
  for (const d of cat.docs) {
    const p = 'public/knowledge-base/' + d.path;
    if (fs.existsSync(p)) ok++; else { fail++; console.log('MISSING:', p); }
  }
}
console.log('total docs ok:', ok, 'missing:', fail);
console.log('categories:', idx.categories.map(c => c.id + ':' + c.docs.length).join(', '));
"
npx tsc --noEmit   # 前端类型检查(知识库工具在 agent-loop.ts)
```

---

## 五、基础设施与工具

### 5.1 知识库搜索工具(已实现, 无需改动)

- `KnowledgeBaseSearch`(src/lib/agent-loop.ts): 关键词搜索知识库(标题+全文)+ `doc_id` 读全文; 只读、无权限弹窗、与 world 无关;
- 新文档入库后自动覆盖, 无需改代码。

### 5.2 知识库面板(已实现)

- 侧边栏「知识库」入口 → `KnowledgeBasePanel` 组件; 读 `knowledge-base/index.json` 渲染分类/文档, fetch md 渲染只读内容。

### 5.3 文件与权限

- 当前沙箱: 需写入时若被拒(只读模式), 用 `sandbox_permissions: "workspace-write"` 重试并附一句话 justification;
- 若报 "file changed since it was read": 先 read 该文件再重试 edit。

---

## 六、用户偏好与约定(必须遵守)

1. **知识库文档不带文献/来源**(理论出处全部留在 `docs/research/notes/`);
2. **政治/文化层不放入地理大类**(用户明确范围: 地理只含自然区划树+类型层; 政治文化另行处理);
3. **区划树 vs 类型层区分**: 自然区划=严格树状(空间连续/不重叠/可拼回上级); 类型层=非树覆盖层(柯本/群系/土壤可多处重复);
4. **每个大类一个目录**(见 4.2);
5. **内容详尽、信息密度高、全部中文**(专有名词保留英文);
6. **研究先给方案让用户确认**(ask_user_question), 确认后再跑 workflow;
7. **方法论为主, 不是 AI 工具、不是现实国别编年史**;
8. **贯穿示例用米拉斯世界**, 与其他大类衔接。

---

## 七、执行检查清单(新大类跑一遍)

- [ ] 1. 拆主题块(10~13 个), 分阶段, 给用户确认方案;
- [ ] 2. workflow 分批跑(每批 3~5 主题), 每主题 2500~4000 汉字, 防截断;
- [ ] 3. 写主报告 `docs/research/<slug>-from-zero.md`(流程+示例+学者表+笔记索引);
- [ ] 4. 归档笔记 `docs/research/notes/<编号>-<slug>.md`(编号接续, 结构固定, 保留文献);
- [ ] 5. 写知识库文档 `public/knowledge-base/<分类>/<编号>-<slug>.md`(去文献, 章节拆分);
- [ ] 6. 更新 `index.json`(新分类独立目录, doc id 加前缀);
- [ ] 7. 验证: node 检查全部 path 存在 + `npx tsc --noEmit`;
- [ ] 8. 汇报: 主报告路径 / 笔记编号段 / 知识库新分类与文档数 / 与既有大类的衔接点。

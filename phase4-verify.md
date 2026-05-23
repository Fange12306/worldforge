# Phase 4 验证清单

> 按依赖顺序逐项验证。每项可打 ✓ 表示通过，✗ 表示有问题。

---

## 1. 编译验证

- [ ] `cd src-tauri && cargo check` — Rust 层无编译错误
- [ ] `npm run build` — 前端层无 TS 编译错误

---

## 2. Task 4.0 — relations/index.json 基础设施

### 数据文件

- [ ] 创建世界后，`<world>/relations/` 目录存在
- [ ] 目录下有 `index.json` 文件，内容为 `{"edges":[]}`
- [ ] `index.json` 格式：`{"edges": [{"from":{"type":"entry","id":"..."},"to":{"type":"entry","id":"..."},"type":"..."}]}`

### 命令行操作（通过 Agent 对话）

- [ ] 用 RelationAdd 创建词条 ↔ 词条关联（如 `from: "艾琳"``to: "暗月要塞"``type: "located_in"`）
- [ ] 用 RelationAdd 创建词条 ↔ 大纲章节关联（如 `from_type: "entry"``to_type: "outline"`）
- [ ] 用 QueryRelations 查询某词条的所有关联 — 返回正确
- [ ] 用 RelationRemove 删除某个关联 — 删除后 QueryRelations 不再包含该关联
- [ ] 用 RelationRemove 删除关联后，重新查询确认已移除

---

## 3. Task 4.1 — 时间字段升级

### 词条 timeline_summary

- [ ] 《演示世界》打开已有词条（如"艾琳·暗月"），词条正常展示（无解析错误）
- [ ] 用 EntryWrite 创建新词条，在 body 含 timeline 信息后，手动在 frontmatter 写入 timeline_summary 测试：

  用 FileWrite 写入 frontmatter：
  ```yaml
  timeline_summary:
    - period: [341, 349]
      state: "皇女"
      location: "奥雷利亚皇宫"
  ```

- [ ] 重新读取该词条，timeline_summary 数据保留
- [ ] 已有的没有 timeline_summary 的词条正常加载（默认空数组兼容）

### 大纲 time_period + involved_entries

- [ ] WriteOutline 时传入 `time_period: "355,355"` 和 `involved_entries: "艾琳·暗月,暗月要塞"`
- [ ] ReadChapter 读取该章，frontmatter 中包含 time_period 和 involved_entries
- [ ] ReadOutline 返回的章节列表包含 time_period 字段
- [ ] 已有的章节文件不受影响（无 time_period 时正常展示）

---

## 4. Task 4.2 — 统一图遍历

### Rust 层

- [ ] 建立至少 3 个关系：`艾琳 ↔ 暗月要塞 ↔ 奥雷利亚帝国 ↔ 艾琳`
- [ ] 调用 traverse_graph(entity_type="entry", entity_id="艾琳", max_depth=1)
  - 返回：暗月要塞（距离1）
- [ ] 调用 traverse_graph max_depth=2
  - 返回：暗月要塞（距离1）+ 奥雷利亚帝国（距离2）
- [ ] 不存在的实体返回空数组

### Agent 工具

- [ ] Agent 使用 TraverseGraph 工具查询
- [ ] 返回值包含 entity.type、entity.id、distance、via_relation、via_entity
- [ ] 跨类型：关联 `艾琳`(entry) 到 `第3章`(outline) 后，traverse_graph 能找到

---

## 5. Task 4.3 — 约束解析引擎

### 约束加载

- [ ] 创建一个带 constraints 的词条：
  ```
  constraints:
    - rule: "艾琳不能使用精灵武器"
      severity: hard
    - rule: "暗月要塞不对外开放"
      severity: soft
  ```
- [ ] 用 EntryRead 读取，constraints 字段正确解析

### 关键字匹配

- [ ] 写一段含"精灵武器"的文本，用 ConsistencyCheck 检查 → 返回硬约束违反（红色）
- [ ] 写一段含"暗月要塞开放"的文本 → 返回软约束提醒（黄色）
- [ ] 写一段与约束无关的文本 → 返回"未发现潜在冲突"
- [ ] 中英文混合关键词正常工作

---

## 6. Task 4.4 — ConsistencyCheck Agent 工具

### 自动图遍历加载

- [ ] 建立关联链：`艾琳 ·暗月`(entry) ↔ `暗月要塞`(entry)
- [ ] 在 `暗月要塞` 词条定义约束："艾琳不能进入要塞"
- [ ] 用 ConsistencyCheck 传入 entity_type="entry", entity_id="艾琳", passage="艾琳步入暗月要塞"
- [ ] 工具应自动遍历图→加载暗月要塞的约束→检查→返回违反报告

### 直接指定实体

- [ ] ConsistencyCheck 传入 entity_ids=["暗月要塞"] 和同样 passage
- [ ] 结果应与上一步一致（验证 entity_ids 路径也可用）

### 错误处理

- [ ] 词条没有 constraints → 返回"未找到任何约束"
- [ ] entity_id 不存在 → 不会崩溃，跳过未找到的词条

---

## 7. Task 4.5 — 前端一致性报告 UI

### 卡片渲染

- [ ] 在对话中触发 ConsistencyCheck 并返回违反 → 右下角出现浮动面板
- [ ] 硬约束显示红色（error）卡片
- [ ] 软约束显示黄色（warning）卡片
- [ ] 每张卡片显示：约束原文 + 涉及段落 + 建议
- [ ] 卡片支持逐条关闭（✗ 按钮）
- [ ] 全部关闭后面板变为绿色"已处理"条

### 面板交互

- [ ] 折叠/展开按钮正常工作
- [ ] 面板最大高度 70vh，超长可滚动
- [ ] 多次触发 ConsistencyCheck → 面板内容替换为最新结果

---

## 8. Task 4.6 — ImplicationTrace 下游影响追踪

### 词条查看

- [ ] 在右侧词条列表点击一个有关联的词条 → 在详情页底部显示"关联影响"区块
- [ ] 区块按关系类型分组（如 "located_in"、"ally_of"）
- [ ] 显示关联实体数量
- [ ] 点击关联实体标签 → 跳转到该词条详情

### 边界

- [ ] 没有关联的词条 → 不显示"关联影响"区块
- [ ] 加载中 → 显示"加载中…"
- [ ] 编辑模式 → 不显示 ImplicationTrace（只读时显示）

---

## 9. Task 4.7 — Skill 系统

### UseSkill 工具

- [ ] Agent 调用 UseSkill（不带参数）→ 返回 6 个可用技能列表
- [ ] Agent 调用 UseSkill(name="create-character") → 返回完整技能引导
- [ ] Agent 调用 UseSkill(name="world-audit") → 返回审计引导
- [ ] Agent 调用 UseSkill(name="chapter-outline") → 返回大纲引导
- [ ] Agent 调用 UseSkill(name="expand-entry") → 返回扩展引导
- [ ] Agent 调用 UseSkill(name="scene-check") → 返回场景检查引导
- [ ] Agent 调用 UseSkill(name="export-ebook") → 返回导出引导
- [ ] 不存在的 skill name → 返回"未找到技能"提示

### 系统提示

- [ ] 新建对话的 system prompt 中包含 Skills 索引节
- [ ] skills.ts 中 6 个 skill 的描述在 system prompt 中可见

---

## 10. Task 4.8 — 工具消息聚合

### 自动折叠

- [ ] 连续多个 EntrySearch → 折叠为"搜索 x3"
- [ ] 连续多个 EntryRead → 折叠为"EntryRead x4"
- [ ] 混合搜索和读 → 折叠为"搜索 x1, EntryRead x2"
- [ ] QueryRelations + TraverseGraph 连续调用 → 折叠为"图谱 x2"（紫色标识）
- [ ] ConsistencyCheck 调用 → 折叠后为玫瑰色标识
- [ ] UseSkill 调用 → 折叠后为绿色标识

### 展开详情

- [ ] 折叠后可展开查看每条调用的具体参数
- [ ] Phase 4 工具显示正确的 hint 文本（如 traverse_graph "艾琳 (2跳)"）
- [ ] 结果预览（→ 后截断显示）

---

## 快速回归路径（5 分钟）

```text
1. cargo check                    # 编译验证
2. 启动 App > 演示世界
3. "搜索暗月要塞"                  # 确认基本功能正常
4. "关联 艾琳 到 暗月要塞"         # 4.0
5. "查一下 艾琳 有什么关联"         # 4.0
6. "写一章关于艾琳的故事" -> 带时间  # 4.1
7. "查查艾琳两跳内的关联"           # 4.2
8. "检查刚才写的内容是否一致"        # 4.3 + 4.4
9. 看右下角卡片                     # 4.5
10. 双击词条 -> 底部关联影响         # 4.6
11. "有什么技能可用"                # 4.7
12. 检查对话历史中的折叠样式         # 4.8
```

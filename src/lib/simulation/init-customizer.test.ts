// @ts-nocheck — 测试文件由 node --experimental-strip-types 运行, 不参与主 tsconfig 构建
/**
 * 初始状态定制器测试。
 *
 * 验证：
 * - 确定性冲突检测: 区域重叠/排除冲突/法则矛盾
 * - initialStateToSession: 转换用户指定到会话输入, 用户要素锁定
 * - parseUserDescription/completeInitialState 用 mock LLM
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EARTH_LAWS } from "./physics.ts";
import { createRng } from "./random.ts";
import { createMockLLM } from "./llm.ts";
import { createSession } from "./engine.ts";
import { deriveRegionScales } from "./measure.ts";
import {
  parseUserDescription, completeInitialState, detectInitialConflicts,
  initialStateToSession,
} from "./init-customizer.ts";

describe("确定性冲突检测", () => {
  test("区域重叠 → 硬冲突", () => {
    const parsed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east" },
        { name: "兽人国", species: "兽人", regionId: "east" },
      ],
    };
    const conflicts = detectInitialConflicts(parsed);
    assert.ok(conflicts.some((c) => c.kind === "region_overlap" && c.severity === "hard"), "区域重叠应报硬冲突");
  });

  test("排除项与实体冲突 → 硬冲突", () => {
    const parsed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [{ name: "兽人部落", species: "兽人" }],
      exclusions: ["兽人"],
    };
    const conflicts = detectInitialConflicts(parsed);
    assert.ok(conflicts.some((c) => c.kind === "exclusion_conflict"), "排除兽人但指定兽人 → 冲突");
  });

  test("法则矛盾 → 硬冲突", () => {
    const parsed = {
      laws: { rules: ["魔法存在", "没有魔法"], narrative: [], ontology: [] },
      regions: [], entities: [],
    };
    const conflicts = detectInitialConflicts(parsed);
    assert.ok(conflicts.some((c) => c.kind === "law_contradiction"), "魔法存在 vs 没有魔法 → 矛盾");
  });

  test("无冲突时返回空", () => {
    const parsed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "a", name: "A", biome: "plains" }],
      entities: [{ name: "王国", species: "人类", regionId: "a" }],
    };
    assert.equal(detectInitialConflicts(parsed).length, 0);
  });
});

describe("initialStateToSession 转换", () => {
  test("用户实体进入 entities, 用户法则并入 laws", () => {
    const completed = {
      laws: { rules: ["精灵不会死"], narrative: ["崇尚自然"], ontology: ["有月神"] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [{ name: "精灵国", species: "精灵", regionId: "east", population: 80000 }],
    };
    const result = initialStateToSession(completed, createRng(1), EARTH_LAWS);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, "精灵国");
    assert.equal(result.entities[0].identity.species, "精灵");
    assert.ok(result.laws.rules.includes("精灵不会死"), "用户法则并入");
    assert.ok(result.laws.narrative.includes("崇尚自然"), "用户叙事并入");
    assert.ok(result.regions["east"], "用户区域存在");
    // 用户指定锁定
    assert.ok(result.userSpecified.some((u) => u.scope.includes("精灵国")), "用户实体进锁定");
    assert.ok(result.userSpecified.some((u) => u.scope === "world-law"), "用户法则进锁定");
  });

  test("无用户区域 → 用默认布局", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [{ name: "王国", species: "人类", population: 60000 }],
    };
    const result = initialStateToSession(completed, createRng(2), EARTH_LAWS);
    assert.ok(Object.keys(result.regions).length > 0, "默认区域填充");
  });
});

describe("initialStateToSession — 空间拓扑 + 关系（修复点）", () => {
  test("多区域建立双向邻接, 实体邻居按区域映射", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "east", name: "东域", biome: "forest", neighbors: ["west"] },
        { id: "west", name: "西域", biome: "steppe" },
        { id: "north", name: "北地", biome: "mountains" },
      ],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", population: 80000 },
        { name: "兽人国", species: "兽人", regionId: "west", population: 60000 },
        { name: "矮人国", species: "矮人", regionId: "north", population: 50000 },
      ],
    };
    const result = initialStateToSession(completed, createRng(3), EARTH_LAWS);
    // 邻接完全由初始化输入决定, 不做硬编码补边
    assert.ok(result.regions["east"].neighbors.includes("west"), "east 邻接 west(用户声明)");
    // 孤立区域 north 保持孤立, 不补边
    assert.equal(result.regions["north"].neighbors.length, 0, "north 孤立, 不硬编码补边");
    // 实体邻居按区域邻接 + 感知过滤
    const elf = result.entities.find((e) => e.name === "精灵国")!;
    const dwarf = result.entities.find((e) => e.name === "矮人国")!;
    assert.ok(!elf.geography.neighbors.includes(dwarf.id), "矮人(north 孤立) 不邻接精灵");
  });

  test("用户关系/信仰/意识形态进入实体, 关系按名字映射 id", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "east", name: "东域", biome: "forest", neighbors: ["west"] },
        { id: "west", name: "西域", biome: "steppe", neighbors: ["east"] },
      ],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", religion: "月神", ideology: "崇尚自然", population: 80000,
          relations: [{ target: "兽人国", stance: "war", note: "争夺边境" }] },
        { name: "兽人国", species: "兽人", regionId: "west", religion: "战神", population: 60000 },
      ],
    };
    const result = initialStateToSession(completed, createRng(4), EARTH_LAWS);
    const elf = result.entities.find((e) => e.name === "精灵国")!;
    const orc = result.entities.find((e) => e.name === "兽人国")!;
    assert.equal(elf.identity.religion, "月神");
    assert.equal(elf.identity.ideology, "崇尚自然");
    assert.equal(orc.identity.religion, "战神");
    assert.equal(elf.relations[0].target, orc.id, "关系 target 映射到实体 id");
    assert.equal(elf.relations[0].stance, "war");
    assert.ok(result.userSpecified.some((u) => u.content.includes("war")), "关系锁定进背景规则");
  });

  test("约束: 含规则词进 laws.rules, 其余进背景规则锁定", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", population: 80000, constraints: ["精灵不能伤害生灵", "精灵每百年举行一次祭月大典"] },
      ],
    };
    const result = initialStateToSession(completed, createRng(5), EARTH_LAWS);
    assert.ok(result.laws.rules.includes("精灵不能伤害生灵"), "规则词约束升级为硬约束");
    assert.ok(result.userSpecified.some((u) => u.content.includes("祭月大典")), "非规则词约束锁定为背景事实");
  });

  test("实体 regionId 落空 → 回退到空间全景内首个区域", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [{ name: "游民", species: "人类", regionId: "nonexistent", population: 30000 }],
    };
    const result = initialStateToSession(completed, createRng(6), EARTH_LAWS);
    const ent = result.entities[0];
    assert.ok(ent.geography.region in result.regions, "实体区域回退到合法区域, 不再挂空");
  });
});

describe("initialStateToSession — 种族身份保留（修复点）", () => {
  test("species 缺省时兜底用实体名（用户只写种族名）", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "north", name: "北境", biome: "tundra" }],
      entities: [
        { name: "精灵", regionId: "north", population: 50000 },   // species 缺省 → 应兜底为"精灵"
        { name: "人类王国", species: "人类", regionId: "north", population: 70000 },  // 有 species → 保留
      ],
    };
    const result = initialStateToSession(completed, createRng(9), EARTH_LAWS);
    const elf = result.entities.find((e) => e.name === "精灵")!;
    const human = result.entities.find((e) => e.name === "人类王国")!;
    assert.equal(elf.identity.species, "精灵", "species 缺省兜底用 name");
    assert.equal(human.identity.species, "人类", "有 species 时保留");
  });

  test("政体缺省 → 符合时代的合理默认（非预设枚举 kingdom）", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "大陆", biome: "plains" }],
      entities: [
        { name: "精灵", regionId: "r", population: 50000 },   // 缺省政体
        { name: "兽人", regionId: "r", population: 40000 },   // 缺省政体
      ],
    };
    const result = initialStateToSession(completed, createRng(11), EARTH_LAWS);
    for (const e of result.entities) {
      assert.ok(!["kingdom", "empire", "city_state"].includes(e.identity.political_form),
        `政体应为部落时代的自由描述, 实际: ${e.identity.political_form}`);
      assert.ok(e.identity.political_form.length > 0, "政体非空");
    }
  });

  test("用户指定政体 → 原样保留（自由描述）", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "大陆", biome: "plains" }],
      entities: [
        { name: "精灵", species: "精灵", regionId: "r", population: 50000, politicalForm: "长老议事会-仲裁复合体" },
      ],
    };
    const result = initialStateToSession(completed, createRng(12), EARTH_LAWS);
    assert.equal(result.entities[0].identity.political_form, "长老议事会-仲裁复合体", "自由描述的政体原样保留");
  });

  test("多物种世界各自保留 species, 不坍缩成单一种族", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "大陆", biome: "plains" }],
      entities: [
        { name: "精灵", regionId: "r", population: 50000 },
        { name: "兽人", regionId: "r", population: 40000 },
        { name: "矮人", regionId: "r", population: 45000 },
      ],
    };
    const result = initialStateToSession(completed, createRng(10), EARTH_LAWS);
    const species = result.entities.map((e) => e.identity.species);
    assert.deepEqual(new Set(species), new Set(["精灵", "兽人", "矮人"]), "三种族各自保留");
    // 每种族独立文化/语言绑定（不共享"人类"）
    assert.ok(result.entities.every((e) => e.identity.culture.includes(e.identity.species)), "文化按种族生成");
  });
});

describe("LLM 解析与补全（mock）", () => {
  test("parseUserDescription 解析用户文本", async () => {
    const mock = createMockLLM(() => JSON.stringify({
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [{ name: "精灵国", species: "精灵", regionId: "east" }],
    }));
    const parsed = await parseUserDescription("我想要一个东边的森林里有精灵王国", mock);
    assert.ok(parsed, "解析成功");
    assert.equal(parsed.entities[0].name, "精灵国");
    assert.equal(parsed.entities[0].species, "精灵");
  });

  test("parseUserDescription 失败 → null", async () => {
    const mock = createMockLLM(() => "不是JSON");
    const parsed = await parseUserDescription("随便", mock);
    assert.equal(parsed, null);
  });

  test("completeInitialState 单次调用: 一次返回完整世界, 用户指定保留, 补全填空", async () => {
    // 单次补全: LLM 一次返回完整 ParsedInitialState(区域分层+实体+法则+尺度)
    const mock = createMockLLM(() => JSON.stringify({
      laws: { rules: ["精灵不会死"], narrative: [], ontology: [] },
      regions: [
        { id: "east", name: "东域", biome: "forest", neighbors: ["west"] },
        { id: "west", name: "西域", biome: "steppe", neighbors: ["east"] },
      ],
      entities: [{ name: "精灵国", species: "精灵", regionId: "east", politicalForm: "部落" }],
      measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 },
    }));
    const user = {
      laws: { rules: ["精灵不会死"], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [{ name: "精灵国", species: "精灵", regionId: "east" }],
    };
    const completed = await completeInitialState(user, mock);
    assert.equal(completed.entities[0].name, "精灵国", "用户实体保留");
    assert.equal(completed.entities[0].politicalForm, "部落", "实体补全了政体");
    assert.ok(completed.laws.rules.includes("精灵不会死"), "用户规则保留");
    assert.equal(completed.regions.length, 2, "补全了西域");
    assert.equal(completed.regions[0].neighbors?.[0], "west", "区域补全了邻接");
  });

  test("completeInitialState 用户 4 物种保留, 不新增物种", async () => {
    const mock = createMockLLM(() => JSON.stringify({
      regions: [
        { id: "goldreach", name: "金穗平原", biome: "温带草原" },
        { id: "emerald-forest", name: "翡翠森林", biome: "温带森林" },
        { id: "great-ridge", name: "矿脉山脊", biome: "温带山地" },
        { id: "sunbreak", name: "曦照草原", biome: "热带草原" },
      ],
      entities: [
        { name: "人类", species: "人类", regionId: "goldreach", politicalForm: "部落" },
        { name: "精灵", species: "精灵", regionId: "emerald-forest", politicalForm: "部落" },
        { name: "矮人", species: "矮人", regionId: "great-ridge", politicalForm: "部落" },
        { name: "兽人", species: "兽人", regionId: "sunbreak", politicalForm: "部落" },
      ],
      measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 },
    }));
    const user = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [
        { name: "人类", species: "人类" }, { name: "精灵", species: "精灵" },
        { name: "矮人", species: "矮人" }, { name: "兽人", species: "兽人" },
      ],
    };
    const completed = await completeInitialState(user, mock);
    assert.equal(completed.entities.length, 4, "只保留用户 4 物种, 不新增");
    const species = new Set(completed.entities.map((e) => e.species));
    assert.deepEqual([...species].sort(), ["人类", "兽人", "精灵", "矮人"].sort(), "物种与用户一致");
    assert.ok(completed.entities.every((e) => e.regionId && /^[a-z0-9-]+$/.test(e.regionId)), "regionId 都是英文 slug");
  });

  test("按 species 合并: parse 的'人类'(无pop) 吸收 LLM 的'索利亚部落'(species=人类, 有pop), 不抛缺population", async () => {
    // parse 提取用户物种(无 population) → LLM 实体层用不同文明名(有 population) → 按 species 合并,
    // 不会出现 parse 的「人类」缺 population 导致 initialStateToSession 抛错
    const mock = createMockLLM((prompt) => {
      if (prompt.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "索利亚部落", species: "人类", regionId: "r1", politicalForm: "部落联盟", population: 200000 },
          { name: "精灵", species: "精灵", regionId: "r1", politicalForm: "长老议会", population: 150000 },
          { name: "兽人", species: "兽人", regionId: "r1", politicalForm: "部落", population: 120000 },
          { name: "矮人", species: "矮人", regionId: "r1", politicalForm: "氏族议事会", population: 100000 },
        ] });
      }
      return JSON.stringify({ laws: { rules: [], narrative: [], ontology: [] }, measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 }, regions: [{ id: "r1", name: "平原", biome: "plains" }] });
    });
    const user = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [],
      entities: [
        { name: "人类", species: "人类" }, { name: "精灵", species: "精灵" },
        { name: "兽人", species: "兽人" }, { name: "矮人", species: "矮人" },
      ],
    };
    // 完整链路: parse 实体 + LLM 分层合并 → 应保留 4 物种, 全部有 population, 不抛错
    const completed = await completeInitialState(user, mock, "演化出人类精灵兽人矮人, 部落时代");
    assert.equal(completed.entities.length, 4, "4 物种保留");
    assert.ok(completed.entities.every((e) => e.population && e.population > 0), "所有实体有 population");
    const species = completed.entities.map((e) => e.species);
    assert.deepEqual([...new Set(species)].sort(), ["人类", "兽人", "精灵", "矮人"].sort(), "物种完整");
    // initialStateToSession 不抛错(之前会因「人类」缺 population 抛)
    const result = initialStateToSession(completed, createRng(1), EARTH_LAWS);
    assert.equal(result.entities.length, 4);
  });

  test("每步自洽校验: 校验 LLM 修正同名实体, 用修正版", async () => {
    const mock = createMockLLM((prompt) => {
      // 生成层: 骨架/区域
      if (prompt.includes("世界骨架") || prompt.includes("补充分区划")) {
        return JSON.stringify({ laws: { rules: [], narrative: [], ontology: [] }, measurement: { lengthUnit: "公里", worldWidth: 2000, worldHeight: 1500 }, regions: [{ id: "r1", name: "平原", biome: "plains" }, { id: "r2", name: "山地", biome: "mountains" }] });
      }
      // 实体层: 生成两个同名"人类"
      if (prompt.includes("文明/种族实体")) {
        return JSON.stringify({ entities: [
          { name: "人类", species: "人类", regionId: "r1", politicalForm: "部落", population: 50000 },
          { name: "人类", species: "人类", regionId: "r2", politicalForm: "部落", population: 40000 },
        ] });
      }
      // 自洽校验层: 修正同名"人类"为区分命名(固定修正版, 不解析输入)
      if (prompt.includes("自洽校验者")) {
        if (prompt.includes("实体(文明/种族")) {
          return JSON.stringify({ entities: [
            { name: "北地人类", species: "人类", regionId: "r1", politicalForm: "部落", population: 50000 },
            { name: "山地人类", species: "人类", regionId: "r2", politicalForm: "部落", population: 40000 },
          ] });
        }
        // 其他层校验: 原样输出
        const body = prompt.split("该层输出\n")[1]?.split("\n# ")[0];
        if (body) return body;
        return "{}";
      }
      // 关系层
      return JSON.stringify({ relations: [] });
    });
    const user = { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [] };
    const completed = await completeInitialState(user, mock, "演化出人类, 部落时代");
    // 校验修正版生效: 无同名实体
    const names = completed.entities.map((e) => e.name);
    assert.equal(new Set(names).size, names.length, "实体名无重复(校验修正)");
    assert.ok(names.includes("北地人类") && names.includes("山地人类"), "校验 LLM 修正了同名实体");
  });

  test("completeInitialState LLM 返回非法 JSON → 降级用 parsed 原始字段", async () => {
    // 单次补全返回非法 JSON → 返回用户 parsed, 不静默清空
    const mock = createMockLLM(() => "不是JSON");
    const user = {
      laws: { rules: ["无魔法"], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [{ name: "精灵国", species: "精灵", regionId: "east" }],
    };
    const completed = await completeInitialState(user, mock);
    assert.equal(completed.entities.length, 1, "LLM 失败 → 用户实体兜底");
    assert.equal(completed.entities[0].name, "精灵国");
    assert.equal(completed.regions.length, 1, "用户区域保留");
  });

  test("空种子 → 单次补全推构完整世界（多区域多实体, §4.0）", async () => {
    // 模拟真实 LLM: 用户几乎什么都没填, 一次补全返回完整世界
    const mock = createMockLLM(() => JSON.stringify({
      laws: { rules: ["无魔法"], narrative: ["多种族并存"], ontology: [] },
      regions: [
        { id: "north", name: "北境冻原", biome: "tundra", neighbors: ["central"] },
        { id: "central", name: "中央平原", biome: "plains", neighbors: ["north", "south"] },
        { id: "south", name: "南方海岸", biome: "coast", neighbors: ["central"] },
      ],
      entities: [
        { name: "北境部落", species: "兽人", regionId: "north", politicalForm: "部落", population: 40000 },
        { name: "中央王国", species: "人类", regionId: "central", politicalForm: "王国", population: 90000 },
        { name: "南方城邦", species: "人类", regionId: "south", politicalForm: "城邦", population: 70000 },
      ],
    }));
    const seed = { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [] };
    const completed = await completeInitialState(seed, mock);
    assert.equal(completed.entities.length, 3, "LLM 推构出 3 个实体");
    assert.ok(completed.regions.length >= 3, "LLM 推构出多区域");
    assert.ok(completed.regions.some((r) => (r.neighbors?.length ?? 0) > 0), "补全的区域有邻接");
    const result = initialStateToSession(completed, createRng(8), EARTH_LAWS);
    assert.ok(Object.keys(result.regions).length >= 3, "多区域进入空间全景");
    assert.ok(result.entities.length >= 3, "多实体进入会话");
    assert.ok(result.laws.rules.includes("无魔法"), "LLM 推构的法则并入");
  });

  test("complete 接收用户原文作为权威, 物种从原文推导", async () => {
    // 用户原文提到 4 物种; mock LLM 返回含这 4 物种的实体
    const mock = createMockLLM(() => JSON.stringify({
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "asia", name: "亚洲大陆", biome: "plains" }],
      entities: [
        { name: "人类部落", species: "人类", regionId: "asia", population: 50000 },
        { name: "精灵", species: "精灵", regionId: "asia", population: 30000 },
        { name: "兽人", species: "兽人", regionId: "asia", population: 40000 },
        { name: "矮人", species: "矮人", regionId: "asia", population: 35000 },
      ],
    }));
    const parsed = { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [] };
    // 传 seedText(用户原文)——complete 应把它作为权威输入
    const completed = await completeInitialState(parsed, mock, "宇宙中的类地行星, 演化出了人类、精灵、兽人、矮人等类人生物亚种, 部落时代晚期");
    // mock 返回的实体被保留(用户物种原样)
    assert.equal(completed.entities.length, 4, "保留 4 物种");
    const species = completed.entities.map((e) => e.species);
    assert.deepEqual(species.sort(), ["人类", "兽人", "精灵", "矮人"].sort(), "4 个物种完整保留");
  });

  test("物种兜底: 组织名实体不用实体名当 species（防御改动3）", async () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "大陆", biome: "plains" }],
      entities: [
        { name: "霜语氏族", species: "", regionId: "r", population: 3000 },   // 组织名, 无 species
        { name: "精灵", species: "", regionId: "r", population: 3000 },        // 实体名=物种名
      ],
    };
    const result = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    const clan = result.entities.find((e) => e.name === "霜语氏族")!;
    const elf = result.entities.find((e) => e.name === "精灵")!;
    assert.notEqual(clan.identity.species, "霜语氏族", "组织名实体不用实体名当 species");
    assert.equal(clan.identity.species, "人类", "组织名实体 species 回退通用'人类'");
    assert.equal(elf.identity.species, "精灵", "实体名=物种名时用实体名");
  });
});

describe("世界尺度 + 空间拓扑（类地行星）", () => {
  test("measurement 写入 worldScale", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "r", name: "大陆", biome: "plains" }],
      entities: [{ name: "族", species: "人类", regionId: "r", population: 50000 }],
      measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 },
    };
    const result = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    assert.equal(result.laws.measurement_system?.worldScale.width, 40000, "worldWidth 进入 worldScale");
    assert.equal(result.laws.measurement_system?.worldScale.height, 30000, "worldHeight 进入 worldScale");
  });

  test("地球尺度 + 分散区域 → 实体不相邻无关系", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "r1", name: "北境", biome: "tundra", neighbors: [] },
        { id: "r2", name: "东境", biome: "plains", neighbors: [] },
        { id: "r3", name: "西境", biome: "desert", neighbors: [] },
        { id: "r4", name: "南境", biome: "forest", neighbors: [] },
      ],
      entities: [
        { name: "北族", species: "人类", regionId: "r1", population: 40000 },
        { name: "东族", species: "人类", regionId: "r2", population: 40000 },
        { name: "西族", species: "人类", regionId: "r3", population: 40000 },
        { name: "南族", species: "人类", regionId: "r4", population: 40000 },
      ],
      measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 },
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    const scaled = deriveRegionScales(EARTH_LAWS, init.regions, { continentKm: { width: 40000, height: 30000 } });
    const session = createSession({ laws: init.laws, regions: scaled, entities: init.entities, config: { seed: 42, yearsPerTick: 10 }, languages: init.languages, cultures: init.cultures });
    for (const e of Object.values(session.entities)) {
      assert.equal(e.geography.neighbors.length, 0, `${e.name} 地球尺度下不相邻`);
      assert.equal(e.relations.length, 0, `${e.name} 地球尺度下无关系`);
    }
  });
});

describe("初始化 lore 同步（用户锁定可被回读）", () => {
  test("被 awareness 丢弃的用户关系不锁进 lore（与 relations 一致）", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "north", name: "北境", biome: "tundra", neighbors: [] },
        { id: "south", name: "南境", biome: "desert", neighbors: [] },
      ],
      entities: [
        { name: "北族", species: "人类", regionId: "north", population: 40000,
          relations: [{ target: "南族", stance: "war", note: "世代战争" }] }, // 跨洲, 感知<0.15
        { name: "南族", species: "人类", regionId: "south", population: 40000,
          relations: [{ target: "北族", stance: "war", note: "世代战争" }] },
      ],
      measurement: { lengthUnit: "公里", worldWidth: 40000, worldHeight: 30000 },
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    // 双方关系因感知过低被丢弃
    assert.equal(init.entities[0].relations.length, 0, "跨洲关系被 awareness 过滤丢弃");
    // 关键: 被丢弃的关系也不锁进 userSpecified(否则 lore 与 relations 矛盾)
    assert.ok(!init.userSpecified.some((u) => u.content.includes("世代战争")),
      "被丢弃的关系不锁进 lore");
  });

  test("存活的关系锁进 lore, 且用实际 stance（含降级）", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "east", name: "东域", biome: "forest", neighbors: ["west"] },
        { id: "west", name: "西域", biome: "steppe", neighbors: ["east"] },
      ],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", population: 80000,
          relations: [{ target: "兽人国", stance: "war", note: "争夺边境" }] },
        { name: "兽人国", species: "兽人", regionId: "west", population: 60000,
          relations: [{ target: "精灵国", stance: "war", note: "争夺边境" }] },
      ],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    // 关系存活 → 锁进 lore
    assert.ok(init.userSpecified.some((u) => u.content.includes("争夺边境")),
      "存活的关系锁进 lore");
  });

  test("实体级用户事实携带 entityScope, 可被 loreFactsFor 按实体 id 回读", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest" }],
      entities: [
        { name: "精灵国", species: "精灵", regionId: "east", population: 80000,
          constraints: ["精灵崇尚自然"], ideology: "崇尚自然" },
      ],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    // 实体事实带 entityScope(实体 id), 且 content 含用户设定
    const fact = init.userSpecified.find((u) => u.content.includes("崇尚自然"));
    assert.ok(fact, "用户设定的意识形态进 userSpecified");
    assert.ok(fact.entityScope, `实体事实携带 entityScope, got ${fact.entityScope}`);
    // 该 entityScope 指向实际实体 id
    assert.ok(init.entities.some((e) => e.id === fact.entityScope), "entityScope 是真实实体 id");
  });
});

describe("区域方位与连接通道（connections）", () => {
  test("LLM 输出的 connections 进入区域, geography 透传", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "south-asia", name: "南亚次大陆", biome: "plains", neighbors: [] },
        { id: "gangetic-plain", name: "恒河平原", biome: "plains", parent: "south-asia", neighbors: ["himalaya"] },
        { id: "himalaya", name: "喜马拉雅山区", biome: "mountains", parent: "south-asia", neighbors: ["gangetic-plain"], connections: { "gangetic-plain": { direction: "南", via: "山谷" } } },
      ],
      entities: [
        { name: "雅利安", species: "人类", regionId: "gangetic-plain", population: 90000 },
        { name: "山地", species: "人类", regionId: "himalaya", population: 30000 },
      ],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    // connections 进入 region
    assert.equal(init.regions["himalaya"].connections?.["gangetic-plain"].direction, "南", "方位进入 region");
    assert.equal(init.regions["himalaya"].connections?.["gangetic-plain"].via, "山谷", "连接通道进入 region");
    // geography 透传 connections
    const session = createSession({ laws: init.laws, regions: init.regions, entities: init.entities, config: { seed: 42, yearsPerTick: 10 }, languages: init.languages, cultures: init.cultures });
    assert.equal(session.geography["himalaya"].connections?.["gangetic-plain"].direction, "南", "geography 透传 connections");
  });

  test("agent 输入含方位与连接通道", async () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "south-asia", name: "南亚次大陆", biome: "plains", neighbors: [] },
        { id: "gangetic-plain", name: "恒河平原", biome: "plains", parent: "south-asia", neighbors: ["himalaya"] },
        { id: "himalaya", name: "喜马拉雅山区", biome: "mountains", parent: "south-asia", neighbors: ["gangetic-plain"], connections: { "gangetic-plain": { direction: "南", via: "山谷" } } },
      ],
      entities: [
        { name: "雅利安", species: "人类", regionId: "gangetic-plain", population: 90000 },
        { name: "山地", species: "人类", regionId: "himalaya", population: 30000 },
      ],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    const session = createSession({ laws: init.laws, regions: init.regions, entities: init.entities, config: { seed: 42, yearsPerTick: 10 }, languages: init.languages, cultures: init.cultures });
    const { buildAgentInput, buildEntityKnowledge, classifyAttention } = await import("./context.ts");
    const ent = Object.values(session.entities).find((e) => e.name === "山地");
    const input = buildAgentInput(session, ent, buildEntityKnowledge(session, ent), classifyAttention(0.3));
    assert.ok(input.user.includes("山谷"), "agent 输入含连接通道");
  });
});

describe("海洋层级 + 岛屿归属（点2）", () => {
  test("海洋层级透传 borders_land, 岛屿归陆邻海", () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        // 陆地
        { id: "asia", name: "亚洲大陆", biome: "plains", neighbors: [] },
        { id: "hainan", name: "海南岛", biome: "forest", parent: "asia", neighbors: ["south-china-sea"], share: 0.02 }, // 岛归陆, 邻海
        // 海洋层级
        { id: "pacific", name: "太平洋", biome: "ocean", neighbors: [] },
        { id: "south-china-sea", name: "南海", biome: "ocean", parent: "pacific", neighbors: ["hainan"], borders_land: ["asia", "hainan"], share: 0.2 },
      ],
      entities: [
        { name: "岛民", species: "人类", regionId: "hainan", population: 30000 },
      ],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    // 海洋层级: 边缘海 parent 指向大洋, borders_land 透传
    assert.equal(init.regions["south-china-sea"].parent, "pacific", "边缘海 parent 指向大洋");
    assert.deepEqual(init.regions["south-china-sea"].borders_land, ["asia", "hainan"], "海洋透传相邻陆地");
    assert.equal(init.regions["south-china-sea"].biome, "ocean", "海洋 biome");
    // 岛屿: parent 归陆, neighbors 邻海
    assert.equal(init.regions["hainan"].parent, "asia", "岛屿 parent 归陆");
    assert.ok(init.regions["hainan"].neighbors.includes("south-china-sea"), "岛屿 neighbors 邻海");
    assert.notEqual(init.regions["hainan"].biome, "ocean", "岛屿 biome 非海洋(是陆地地形)");
  });

  test("海洋区域 share 落地面积", async () => {
    const completed = {
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [
        { id: "pacific", name: "太平洋", biome: "ocean", neighbors: [], share: 0.6 },
        { id: "atlantic", name: "大西洋", biome: "ocean", neighbors: [], share: 0.4 },
      ],
      entities: [],
    };
    const init = initialStateToSession(completed, createRng(42), EARTH_LAWS);
    const session = createSession({ laws: init.laws, regions: init.regions, entities: init.entities, config: { seed: 42 }, languages: init.languages, cultures: init.cultures });
    // 顶层海洋 share 落地面积: 大陆尺度 3000×2500, pacific 0.6/1.0 ≈ 4500000 km²
    const { toKm2 } = await import("./measure.ts");
    const pacArea = toKm2(EARTH_LAWS, session.regions["pacific"].dimensions!.area);
    assert.ok(Math.abs(pacArea - 3000 * 2500 * 0.6) < 3000 * 2500 * 0.1, `太平洋面积≈60% 大陆尺度: ${pacArea}`);
  });
});

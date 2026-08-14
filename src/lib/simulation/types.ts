/**
 * 历史推演模式 — 数据模型类型定义 (Phase 0)
 *
 * 对应 SIMULATION_DESIGN.md §3。所有 schema 落地于此。
 * 模块内部用相对路径 import（便于 node:test 直接运行，不依赖 @/ 别名）。
 */

// ── 实体卡片 (EntityCard, §3.1) ───────────────────────

/**
 * 对外关系立场 —— **自由描述, 不预设枚举**（§3.1: 关系由 LLM 结合状态综合判断）。
 * 常见参考: 战争/同盟/朝贡/敌对/中立/联姻/互市...
 * 实际值由 LLM 按世界状态与时代推演, 不受枚举约束。
 * 数值化参考: 关系上的 hostility(0-1) 由 LLM 判定, 供引擎做软冲突估计。
 */
export type Stance = string;

export type ActiveLevel = "hotspot" | "regular" | "longtail";

export type EntityStatus = "active" | "dormant" | "extinct";

export type EntityKind = "entity" | "micro";

/**
 * 政权形态 —— **自由描述, 不预设枚举**（§3.1: 政体只是实体的一种常见形态, 不是全部;
 * §5.2: agent 可自由描述演化后的治理形态, 不必套用任何既有的政体类别）。
 * 常见形态参考: 部落 / 城邦 / 王国 / 帝国 / 游牧联盟 / 无政权 / 长老议事会 / 神权政体...
 * 实际值由 LLM 按世界状态与时代推演, 不受枚举约束。
 */
export type PoliticalForm = string;

/**
 * 实体卡片 —— 推演的最小决策单位。
 * 种族 × 政权形态正交（§3.1）：一个实体可以是独立文明/国度，也可以是
 * 非国度的部落/部族/流浪民族，甚至同一种族内部的一个分支。
 */
export type EntityCard = {
  id: string;
  name: string;
  parent?: string;             // 分裂/衍生前的父实体 id
  kind: EntityKind;
  status: EntityStatus;

  // ── 核心指标（物理层数值引擎维护, §4.1）──
  // 由世界法则派生。真实世界的最小集：人口/粮食/经济/军力/合法性/稳定。
  metrics: {
    population: number;        // 人口
    food: number;              // 粮食盈余/赤字（季节性）
    economy: number;           // 经济/生产力（粮食盈余 + 生产技术 → 可养活脱产者, 政体的物质基础）
    military: number;          // 军力
    legitimacy: number;        // 统治合法性（无政权形态时=内部凝聚力）
    stability: number;         // 内部稳定度
  };

  // ── 维度值（发展轴, 动态涌现, §3.5/§4.2）──
  // tech=技术类已注册维度→当前值; values=理念类→当前值。均为 0-100。
  tech: Record<string, number>;
  values: Record<string, number>;

  // ── 身份与形态 ──
  identity: {
    species: string;           // 种族: 精灵/兽人/人类...
    ethnicity: string;         // 民族/文化分支
    culture: string;           // 文化
    political_form: PoliticalForm;
    ideology: string;          // 主导意识形态
    religion?: string;         // 宗教/信仰体系
    origin_story: string;      // 起源叙事
    /** 时代（初始化时由 LLM 从用户指令推断, §: 时代 → 政体/人口规模/区域面积的推导枢纽） */
    era?: string;              // "部落时代" / "青铜时代" / "古典城邦时代" / "中世纪王国"...
  };

  // ── 位置与邻接（空间层, 引用 space.ts 的区域）──
  geography: {
    region: string;            // 核心区域 id（对应 SpaceRegion.id）
    neighbors: string[];       // 相邻实体 id（基于空间全景的邻接）
    capital?: string;          // 都城/核心聚落
  };
  /** 领土: 控制的区划 id 列表(任意层级, 可含整个大区划 + 另一区划的子区划)。缺省 [geography.region] */
  territory?: string[];

  // ── 对外关系（Board, 对外）──
  relations: { target: string; stance: Stance; note?: string; hostility?: number }[];

  // ── 内部状态（Stick, 对内）──
  internal: {
    recent_events: string[];   // 最近 3-5 个内部事件摘要
    active_issues: string[];   // 未解决议题
    succession?: string;       // 掌权者/继任线索
  };

  // ── 指标历史（环形缓冲, 供走势注入, 自动落盘）──
  // 每 tick 记录一次该 tick 结束时的核心指标快照（时间升序, cap 20）。
  // 引擎注入"近期走势"给 agent/稀有事件, 让 LLM 看到趋势而非当前快照。
  history?: { tick: number; metrics: EntityCard["metrics"] }[];

  // ── 政体（轻结构化, B方案）──
  // 物理层追踪几个确定性信号（组织复杂度/集权度/经济支撑力）,
  // 形态描述由 agent 在 identity.political_form 里自由维护（涌现）。
  regime: {
    organizational_complexity: number;  // 组织复杂度 0-100: 能支撑多复杂的层级（由经济盈余驱动）
    centralization: number;             // 集权度 0-100: 决策是否集中（随政体演化变化）
    economic_base: number;              // 经济支撑力: 能养活多少脱产者（官僚/军队/工匠）
    evolve_signal?: boolean;            // 物理层信号: 当前条件是否支持政体演化（agent 决策用）
    evolve_reason?: string;             // 演化信号原因（供 agent 判断）
  };

  // ── 元信息 ──
  active_level: ActiveLevel;   // 注意力分层结果
  last_tick: number;
  created_at: number;
  updated_at: number;
};

// ── 推演事件 (SimulationEvent, §3.2) ──────────────────

/**
 * 事件类型 —— **自由描述, 不预设枚举**。
 * 是展示标签, 由 LLM/生成器结合世界状态综合判断, 可以是任何契合时代/实体状态的类别
 * (如"彗星观象""王室决裂""银根紧缩")。引擎不按 type 分支做机制。
 */
export type EventType = string;

export type SimulationEvent = {
  id: string;
  tick: number;
  time_label: string;          // 人类可读时间
  type: EventType;
  participants: string[];      // 涉及实体 id
  region: string;              // 区域 id
  /** 事件所在时间轴（§4.3 timeline_id 作用域校验用） */
  timeline_id?: string;
  description: string;         // 2-3 句叙事
  /** 事件是否"结构性/重大"(战争·征服·灭亡·分裂·建国·大迁移), 供信息传播/仲裁参考。
   *  由 LLM/生成器判断, 引擎不预设——major 是语义标志, 非类型枚举。 */
  major?: boolean;
  changes: {
    entity: string;
    metrics?: Partial<EntityCard["metrics"]>;
    tech?: Record<string, number>;   // 已注册维度名 → 变化量
    values?: Record<string, number>;
    /** 关系立场变化（自由文本） */
    stance?: Stance;
    /** 关系敌意变化(0-1, LLM 判定) */
    hostility?: number;
    /** 被吞并 → 吸收实体 id */
    absorbed_by?: string;
    /** 建国/分裂 → 新实体 */
    founded?: { name: string; from: string };
    /** 灭亡 → 实体灭亡 */
    collapsed?: boolean;
  }[];
  causals?: string[];          // 前因事件 id（因果链追踪）
  random: boolean;             // 是否黑天鹅事件
  source?: "agent" | "decree" | "engine";  // 事件来源
};

// ── 推演参数 (SimulationConfig, §3.4) ─────────────────

export type Granularity = "macro" | "standard" | "micro";

export type SimulationConfig = {
  randomness: number;          // 0-1 黑天鹅事件发生率（乘数）
  surprise: number;            // 0-1 意外结果比例（计划外结局）
  rigor: number;               // 0-1 因果严密性（高=拒绝巧合救场）
  granularity: Granularity;
  /** 每 tick 代表的真实年数（开放数值, 不预设枚举; agent 可结合世界判断调整） */
  yearsPerTick: number;
  autoJump: boolean;           // 时代跳跃
  maxTicks: number;            // 本次推演总 tick 上限
  budget: {
    perTickGlobal: number;     // 每 tick 全局 token 上限
    perEntity: number;         // 每实体每次推演 token 上限
    hotspotMultiplier: number; // 热点地区倍率
  };
  infoDelay: number;           // 信息传播延迟 tick 数
  maxEntities: number | null;  // 实体数量上限（null=无上限, 涌现决定）
  /** 冻结的维度名（§12 风险缓解: 注册表可人工冻结, 防维度涌现失控） */
  frozenDims?: string[];
  seed: number;                // 伪随机种子（Phase 0 用）
};

// ── 维度注册表 (DimensionRegistry, §3.5) ──────────────

export type DimensionKind = "tech" | "value";

export type DimensionDef = {
  name: string;                // 维度名（中文, 如 "航海" / "真气修为"）
  kind: DimensionKind;
  potential: number;           // 0-100 潜力上限（法则/空间推导）
  weight: number;              // 该维度对结果的影响权重
  description?: string;
  first_tick: number;
  last_active: number;
};

export type DimensionRegistry = {
  dims: Record<string, DimensionDef>;
  history: {
    tick: number;
    action: "register" | "promote" | "demote" | "retire";
    dim: string;
    reason: string;
  }[];
  /** 被冻结的维度名（§十二 风险缓解: 注册表可人工冻结, 防维度涌现失控） */
  frozen: string[];
};

// ── 背景规则库 (CanonicalLore, §3.6) ─────────────────

export type LoreAxis = "space" | "time";
export type LoreSource = "initial" | "refinement" | "history" | "past_refinement";

export type LoreFact = {
  id: string;
  axis: LoreAxis;              // space=细化即锁定; time=历史锁定+细化过去
  layer: number;               // 细化层级（space: 大陆→区域→子区域; time: 宏观=0, 细化过去越深越大）
  scope: string;               // 事实适用的空间/概念范围
  content: string;             // 事实内容
  source: LoreSource;
  locked_tick: number;         // 锁定时的 tick（initial=0）
  refined_from?: string;       // 若由某事实细化而来, 记录父事实 id
  /** 关联的实体 id（用户指定的实体级事实, 供按实体回读。scope 保留可读名, 匹配用此字段） */
  entityScope?: string;
  notes?: string;
};

export type CanonicalLore = {
  facts: LoreFact[];
  max_layer: number;
};

// ── 干预指令 (Decree, §3.7) ───────────────────────────

export type DecreeDirection = "future" | "past";
export type DecreeStrength = "command" | "lean" | "nudge";
export type DecreeVerdict = "accepted" | "adjusted" | "twisted" | "rejected";

export type Decree = {
  id: string;
  direction: DecreeDirection;
  target_tick: number;         // future=从哪开始生效; past=细化哪个时代
  target: { type: "entity" | "region" | "global"; id?: string };
  intent: string;
  strength: DecreeStrength;
  verdict?: DecreeVerdict;
  verdict_note?: string;
  effective_tick?: number;
};

// ── 世界法则 + 空间全景（§4.0）──
// 数值引擎用的物理参数由世界法则的 physical 层派生（§4.1）。
// Phase 0 内置三种示例物理参数集（真实/魔法/真气），验证"法则不同→演化不同"。

/**
 * 生物群系 —— **自由描述, 不预设枚举**（§4.0② 空间全景按世界真实尺度铺全）。
 * 常见参考: coast 沿海/群岛, plains 平原, mountains 山地, desert 沙漠, steppe 草原,
 * forest 森林, tundra 苔原, ocean 海洋, space 星域...
 * 实际值由世界/LLM 定义, 引擎用 inferBiome() 对未知值做名称子串推断兜底。
 */
export type Biome = string;

/** 由生物群系推导的资源潜力（物理层, §4.0② + §4.1） */
export type RegionResources = {
  food_capacity: number;       // 0-100 粮食承载（决定人口上限）
  naval_potential: number;     // 0-100 航海潜力
  mineral_potential: number;   // 0-100 冶金潜力
  agriculture_potential: number; // 0-100 农业潜力
  mana_potential: number;      // 0-100 魔力潜力（魔法世界用）
  qi_potential: number;        // 0-100 灵气潜力（真气世界用）
};

/** 空间区域（空间全景的最小单位, §4.0②） */
/** 区域的确定性尺寸（用世界度量单位, 初始确定） */
export type RegionDimensions = {
  /** 宽度（world 的 length 单位） */
  width: number;
  /** 高度（world 的 length 单位） */
  height: number;
  /** 面积（world 的 area 单位） */
  area: number;
};

/** 环境三层（初始确定; 地理固定, 气候慢变, 生态动态） */
export type RegionEnvironment = {
  /** 地理（地形/海拔）——初始确定, 只细化, 基本不变 */
  geography: {
    elevation: number;           // 平均海拔（m）
    terrain: string;             // 地形描述（平原/山地/丘陵...）
    rivers?: number;             // 主要河流数
    coastline?: number;          // 海岸线长度（world length 单位）
  };
  /** 气候（温带/降水/季节）——初始确定, 长周期慢变 */
  climate: {
    temperature: number;         // 平均温度（℃）
    precipitation: number;       // 年降水（mm）
    seasons: string[];           // 季节模式
    variability: number;         // 气候变率（0-1, 长周期漂移程度）
  };
  /** 生态（生物群系/植被/可耕地）——最动态: 被文明改变 + 自然演替 */
  ecology: {
    vegetation: number;          // 植被覆盖 0-100
    arable_land: number;         // 可耕地比例 0-100
    biodiversity: number;        // 生物多样性 0-100
    modified: boolean;           // 是否已被文明改变（砍伐/垦殖/灌溉）
  };
};

export type SpaceRegion = {
  id: string;
  name: string;
  biome: Biome;
  resources: RegionResources;
  neighbors: string[];         // 相邻区域 id
  /** 位置关系: neighborId → 方位 + 连接通道(如"河谷在平原东边, 经山谷连接山区") */
  connections?: Record<string, { direction?: string; via?: string }>;
  /** 与邻接区域的距离（world length 单位） */
  distances?: Record<string, number>;
  /** 确定性尺寸（初始确定, 只细化） */
  dimensions?: RegionDimensions;
  /** 环境三层（初始确定） */
  environment?: RegionEnvironment;
  parent?: string;             // 父区域 id（层级细化的上一层）
  /** 有名有姓的子区划 id（层级: 次大陆→恒河平原→中游） */
  children?: string[];
  /** 一句话自然语言描述内部地形混合（"主体冲积平原, 东北丘陵, 沿河沼泽"——非百分比, 自由文本） */
  character?: string;
  /** 占父级的比例(0-1, LLM 给)。顶层=占世界大陆比例。引擎按此落地面积, 保证子面积和=父面积 */
  share?: number;
  /** 大概形状(自然语言, 供叙事/agent 判断): "狭长河谷/盆地/半岛/带状平原" */
  shape?: string;
  /** 位于父级的位置(自然语言): "华北平原东部" / "大陆西海岸" */
  position?: string;
  /** 海洋区域的相邻陆地区域 id（大洋→边缘海→海域, 每个海洋记录与哪些陆地相邻） */
  borders_land?: string[];
  /** 是否已做过多实体自动细分(防重复细分, 改动 C) */
  subdivided?: boolean;
  layer: number;               // 细化层级（0=初始全景）
  refined?: boolean;           // 是否已被细化（细化即锁定）
  /** 命名主观性: 不同实体对同一区域的称谓（无则 fallback name） */
  namesByEntity?: Record<string, string>;
};

/**
 * 地理单元（§4.0② 独立地理地图）— 统一表示区域与自然实体。
 * - 区域(unitKind=region): 生态区划, 可细化层级。
 * - 自然实体(unitKind=feature): 山脉/河流/湖泊/海洋/灵脉... kind 自由字符串, 不预设枚举。
 * - 每个单元有全局唯一 id, 名称取决于发现者(per-entity 称谓)。
 */
export type GeographyUnit = {
  id: string;
  /** 发现者/默认名 */
  name: string;
  /** region=区划(可细化), feature=自然实体 */
  unitKind: "region" | "feature";
  /** 自然实体的具体类型(开放, 不枚举): "山脉" "河流" "湖泊" "海洋" "灵脉" "雾海"... */
  kind?: string;
  /** 生态类型(region 用) */
  biome?: string;
  /** 同级位置关系 */
  neighbors: string[];
  /** 位置关系: neighborId → 方位 + 连接通道 */
  connections?: Record<string, { direction?: string; via?: string }>;
  /** 上一级区划 id(上下级关系) */
  parent?: string;
  /** 下一级区划(细化生成) */
  children?: string[];
  /** 一句话自然语言描述内部地形混合(自由文本, 非百分比) */
  character?: string;
  /** 大概形状(自然语言, 供叙事/agent 判断) */
  shape?: string;
  /** 位于父级的位置(自然语言) */
  position?: string;
  /** 命名主观性: 不同实体称谓 */
  namesByEntity: Record<string, string>;
  /** 控制此区划的实体 id(可多实体共享, 不同实体控不同子区划) */
  controllers?: string[];
  /** 自然实体所属区域 id(feature 用) */
  region?: string;
  /** 区划细节(region 用, 复用现有) */
  dimensions?: RegionDimensions;
  environment?: RegionEnvironment;
  resources?: RegionResources;
  layer?: number;
  refined?: boolean;
};

/** 物理层参数（由世界法则 physical 层派生, §4.1） */
export type PhysicsParams = {
  /** 每位成年人口每年所需粮食单位（粮食赤字会压人口） */
  food_per_capita: number;
  /** 基础人口自然增长率（每 tick 比率） */
  pop_growth_base: number;
  /** 人口→军力的转化率 */
  military_per_pop: number;
  /** 军力由 military 技术维度的放大系数 */
  military_tech_mult: number;
  /** 粮食充足时稳定度回正速率 */
  stability_recovery: number;
  /** 粮食严重赤字时稳定度流失速率 */
  stability_decay: number;
  /** 人口相对区域承载力的压力系数（过载→稳定/合法性下降） */
  overpopulation_pressure: number;
  /** 额外本体规则（第二物理），如魔法/真气。名称 → 强度 */
  metaphysics?: Record<string, number>;
};

/** 度量单位（世界的度量单位 → 真实单位换算率） */
export type MeasureUnit = {
  name: string;                  // 单位名（"里" / "钟程" / "亩"）
  kind: "length" | "area" | "volume" | "weight" | "time";
  /** 到真实单位的换算率（SI）：
   *  length → 米; area → 平方米; volume → 立方米; weight → 千克; time → 秒 */
  to_si: number;
  description?: string;
};

/** 世界的度量单位系统（所有单位可换算成真实单位） */
export type MeasurementSystem = {
  length: MeasureUnit;           // 距离基准单位
  area: MeasureUnit;             // 面积基准单位
  weight?: MeasureUnit;
  volume?: MeasureUnit;
  /** 时间单位（世界历, 与 time_format 关联） */
  time: MeasureUnit;
  /** 大陆/世界的总空间尺度（用 length 单位） */
  worldScale: {
    width: number;               // 大陆/世界总宽
    height: number;              // 总高
    /** 世界尺度描述（"可观测宇宙" → 巨量; "类地球大陆" → 大陆级） */
    description: string;
  };
};

/** 世界法则（三层, §4.0① + §4.3 + §4.4） */
/** 带时间轴作用域的规则（§4.3: 部分规则可带 timeline_id 作用域） */
export type TimelineRule = {
  rule: string;
  /** 空 = 通用（所有时间轴生效）; 指定 = 仅该时间轴生效 */
  timeline_id?: string;
};

export type WorldLaws = {
  id: string;
  name: string;
  /** 物理层：数值引擎参数（§4.1） */
  physics: PhysicsParams;
  /** 规则层：硬约束（字符串, 仲裁时校验, §4.3） */
  rules: string[];
  /** 带时间轴作用域的规则（§4.3）——规则只在指定时间轴生效 */
  timeline_rules?: TimelineRule[];
  /** 叙事层：软约束（风格引导, §4.4） */
  narrative: string[];
  /** 本体规则描述（可读, 人类可查） */
  ontology: string[];
  /** 世界的空间尺度描述（如 "可观测宇宙" / "类地球大陆"） */
  spatial_scale: string;
  /** 度量单位系统（所有度量可换算真实单位） */
  measurement_system?: MeasurementSystem;
};

// ── 会话状态 (Session, §二 数据隔离) ──────────────────

export type SimulationSession = {
  id: string;
  world_id: string;            // 关联的 WorldForge world
  current_tick: number;
  laws: WorldLaws;
  regions: Record<string, SpaceRegion>;
  /** 独立地理地图（§4.0② 区域 + 自然实体, 命名主观性） */
  geography: Record<string, GeographyUnit>;
  entities: Record<string, EntityCard>;
  registry: DimensionRegistry;
  lore: CanonicalLore;
  config: SimulationConfig;
  events: SimulationEvent[];   // 全局事件日志（有序, 追加不可改写）
  decrees: Decree[];
  archive: SimulationArchiveEntry[];  // 灭亡/消失实体的历史档案（§5.4）
  /** 文化-语言系统（命名生成源 + 历史演化对象） */
  languages: Record<string, LanguageSystem>;
  cultures: Record<string, Culture>;
  started_at: number;
};

/** 历史档案条目（灭亡/消失实体的冻结快照, 可被复兴） */
export type SimulationArchiveEntry = {
  entity: EntityCard;
  archived_tick: number;
  reason: string;
};

// ── 推演结果（顶层输出, 供 UI/测试使用）──

export type SimulationResult = {
  session: SimulationSession;
  ticks_run: number;
  // 每个 tick 的实体数 / 事件数（供成本与演化监控）
  population_trace: { tick: number; entities: number; events: number }[];
  /** 本次推进的 LLM 成本估算（输入/输出 token, 调用次数）——预算熔断 + UI 监控（§3.4） */
  cost?: { inputTokens: number; outputTokens: number; calls: number };
};

// ── 文化-语言系统（命名与文化强相关, 随历史演化）──

/**
 * 语言系统 — 一个文化的命名生成源。
 * 命名不是套模板，而是从该文化的音系、词根、构词规则里"长出来"。
 * 语言系统随历史演化（征服→借词, 分裂→方言分化）。
 */
export type LanguageSystem = {
  id: string;
  name: string;                    // "中原语" / "古西语"
  /** 音系：可用辅音/元音（命名必须从这些音素里组合） */
  phonology: {
    consonants: string[];          // 如 ["k","g","s","h","r","m","n","t","p","l","w","j"]
    vowels: string[];              // 如 ["a","e","i","o","u"]
    /** 音节结构模板（C=辅音 V=元音），如 ["CV","CVC","VC"] */
    syllablePatterns: string[];
    /** 禁止的音素组合（避免"张伟"出现在北欧音系） */
    forbidden: string[];
  };
  /** 词根库（语义 → 词根），用于复合地名/国名 */
  roots: Record<string, string>;   // { "大地": "terra", "河": "fluv", "城": "burg" ... }
  /** 构词规则：如何组合词根成地名/国名/人名 */
  morphology: {
    /** 地名后缀（"-burg" "-grad" "-州" "-城"） */
    placeSuffixes: string[];
    /** 国名后缀（"-land" "-ia" "-王国"） */
    nationSuffixes: string[];
    /** 人名规则: 前缀/中缀/后缀（如北欧 "son"/"dottir" 父名制） */
    namePatterns: {
      prefix?: string[];
      infix?: string[];
      suffix?: string[];           // 父名/身份后缀
      parts: string[];             // ["root","suffix"] 结构
    };
    /** 是否父名制（如 埃里克之子 = 埃里克松） */
    patronymic: boolean;
  };
  /** 文字体系描述（表意/表音, 供叙事与演变判断）。自由描述, 常见: logographic/syllabic/alphabetic/abjad */
  script: string;
  /** 借用词（来自其他语言的词, 记录征服/接触历史） */
  loanwords: { from: string; word: string; meaning: string; tick: number }[];
  /** 方言/变体（分裂后产生） */
  dialects: string[];
  first_tick: number;
  updated_at: number;
};

/**
 * 文化 — 绑定一个语言系统 + 命名习惯。
 * 文化是推演中的身份单位，命名从关联的语言系统生成。
 */
export type Culture = {
  id: string;
  name: string;
  languageId: string;              // 关联的 LanguageSystem
  /** 命名习惯（可覆盖语言系统的默认） */
  namingStyle?: {
    /** 优先用哪些词根语义命名（"河""山""王"等） */
    favoredRoots?: string[];
    /** 是否偏好神名/祖先名入名 */
    theophoric?: boolean;
  };
  /** 文化演化记录（征服/迁徙/宗教影响） */
  history: { tick: number; event: string }[];
  first_tick: number;
};

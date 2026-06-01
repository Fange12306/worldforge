# WorldForge 地图模块 —— 技术规划书

## 概述

在 WorldForge 中增加**架空地图（Fantasy Map）系统**，覆盖从地图生成、存储、AI 理解到前端展示的完整链路。用户可以通过文字描述或已有 entry 数据生成地图，AI agent 能够理解地图中的地形、面积、方位和空间关系，并在地图上进行创作。

---

## 一、核心架构

```
┌─────────────────────────────────────────────────────┐
│                   用户 / LLM Agent                    │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│               Agent Map Tools (5个)                  │
│  MapQuery / MapRoute / MapTerrain / MapMarker /     │
│  MapRegion / MapGenerate                            │
└────────────────────┬────────────────────────────────┘
                     │ IPC (Tauri commands)
┌────────────────────▼────────────────────────────────┐
│               Map Engine (Rust)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Generator   │  │ Spatial      │  │ Integration│  │
│  │ - Heightmap │  │ - Distance   │  │ - Entry    │  │
│  │ - Rivers    │  │ - Area       │  │   sync     │  │
│  │ - Biomes    │  │ - Adjacency  │  │ - Timeline │  │
│  │ - Cities    │  │ - Pathfinding│  │   sync     │  │
│  │ - Roads     │  │ - Terrain    │  │ - Relation │  │
│  │ - Borders   │  │   query      │  │   sync     │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│               File System Storage                    │
│  <world>/maps/<map_id>/                              │
│  ├── map.json          (所有矢量特征)                 │
│  ├── precomputed.json  (预计算查询表)                 │
│  ├── heightmap.png     (高度图)                      │
│  └── biome.png         (生物群落图)                   │
└─────────────────────────────────────────────────────┘
```

### 核心模块分层

| 层 | 技术 | 职责 |
|----|------|------|
| **Agent Tools** | TypeScript (agent-loop.ts) | 6 个地图工具，LLM 通过工具调用访问地图 |
| **IPC Bridge** | Tauri commands (Rust) | generate_map, load_map, map_query, map_route 等 |
| **Map Engine** | Rust 原生 | 生成、查询、空间计算、与 entry 系统联动 |
| **Storage** | 文件系统 | map.json + precomputed.json + PNG 导出 |

---

## 二、数据模型

### 2.1 地图数据（map.json）

```rust
/// 顶层地图数据结构，存储在 <world>/maps/<map_id>/map.json
pub struct MapData {
    pub version: u32,
    pub map_id: String,
    pub name: String,
    pub seed: u32,
    pub width: u32,           // 地图像素/网格宽度
    pub height: u32,          // 地图像素/网格高度
    pub world_path: String,   // 所属世界
    pub created_at: String,
    pub updated_at: String,
    pub scale_km_per_unit: f32, // 每个单位代表多少公里

    // 地形数据（压缩存储）
    pub elevation: Option<Vec<f32>>,    // 展平后的高度图 [0.0, 1.0]
    pub biome_grid: Option<Vec<u8>>,    // 生物群落 ID 网格
    pub moisture: Option<Vec<f32>>,
    pub temperature: Option<Vec<f32>>,

    // 矢量特征
    pub regions: Vec<Region>,
    pub cities: Vec<City>,
    pub rivers: Vec<River>,
    pub roads: Vec<Road>,
    pub political_boundaries: Vec<PoliticalBoundary>,
    pub markers: Vec<MapMarker>,

    // 与 WorldForge 系统的集成
    pub generated_entry_ids: Vec<String>,  // 此地图生成的 entry ID 列表
    pub linked_entry_ids: Vec<String>,     // 关联到此地图的已有 entry ID
}

pub struct Region {
    pub id: String,
    pub name: String,
    pub biome: BiomeId,
    pub area_km2: f32,
    pub center: [f32; 2],          // 像素坐标
    pub polygon: Vec<[f32; 2]>,     // 边界多边形
    pub adjacent_region_ids: Vec<String>,  // 邻接区域
    pub city_ids: Vec<String>,      // 区域内的城市
    pub river_ids: Vec<String>,     // 穿过的河流
    pub elevation_avg: f32,
    pub elevation_min: f32,
    pub elevation_max: f32,
    pub entry_id: Option<String>,   // 关联的 WorldForge entry ID
}

pub struct City {
    pub id: String,
    pub name: String,
    pub position: [f32; 2],
    pub population: u64,
    pub city_type: CityType,        // Capital, Town, Village, Fortress, etc.
    pub region_id: String,
    pub entry_id: Option<String>,   // 关联的 WorldForge entry ID
}

pub struct River {
    pub id: String,
    pub name: Option<String>,
    pub source: [f32; 2],
    pub mouth: [f32; 2],
    pub width_class: RiverWidth,    // Stream, River, MajorRiver
    pub strahler_order: u32,
    pub waypoints: Vec<[f32; 2]>,
    pub length_km: f32,
    pub entry_id: Option<String>,
}

pub struct Road {
    pub id: String,
    pub name: Option<String>,
    pub from_city_id: String,
    pub to_city_id: String,
    pub road_type: RoadType,        // Highway, Local, Trail
    pub waypoints: Vec<[f32; 2]>,
    pub length_km: f32,
    pub entry_id: Option<String>,
}

pub struct PoliticalBoundary {
    pub id: String,
    pub name: Option<String>,
    pub state_ids: Vec<String>,     // 此边界分隔的区域
    pub polyline: Vec<[f32; 2]>,
    pub entry_id: Option<String>,
}

pub struct MapMarker {
    pub id: String,
    pub label: String,
    pub position: [f32; 2],
    pub marker_type: MarkerType,    // POI, Battle, Dungeon, Capital, etc.
    pub entry_id: Option<String>,
    pub created_by: String,         // "user" | "agent" | "generator"
}
```

### 2.2 预计算数据（precomputed.json）

这是 **agent 理解地图的关键** —— 所有空间查询不走 LLM 计算，全部预计算好：

```rust
pub struct PrecomputedMapData {
    // 城市间距离矩阵（公里）
    pub city_distance_km: HashMap<(String, String), f32>,

    // 区域间距离矩阵（中心点）
    pub region_distance_km: HashMap<(String, String), f32>,

    // 区域邻接表
    pub region_adjacency: HashMap<String, Vec<String>>,

    // 城市间路径地形描述
    pub city_path_terrain: HashMap<(String, String), PathTerrainSummary>,

    // 每个区域的面积（已算好）
    pub region_area_km2: HashMap<String, f32>,

    // 每个区域的地形统计
    pub region_terrain_stats: HashMap<String, TerrainStats>,
}

pub struct PathTerrainSummary {
    pub distance_km: f32,
    pub biomes_along_path: Vec<BiomeId>,
    pub elevation_min: f32,
    pub elevation_max: f32,
    pub rivers_crossed: Vec<String>,
    pub regions_traversed: Vec<String>,
}

pub struct TerrainStats {
    pub elevation_avg: f32,
    pub elevation_min: f32,
    pub elevation_max: f32,
    pub biome_breakdown: HashMap<BiomeId, f32>,  // biome -> percentage
    pub has_coastline: bool,
    pub has_river: bool,
}
```

### 2.3 生物群落枚举

```rust
pub enum BiomeId {
    Ocean = 0,
    Beach = 1,
    HotDesert = 2,
    ColdDesert = 3,
    Savanna = 4,
    Grassland = 5,
    Shrubland = 6,
    TemperateDeciduousForest = 7,
    TemperateRainforest = 8,
    TropicalSeasonalForest = 9,
    TropicalRainforest = 10,
    BorealForest = 11,
    Taiga = 12,
    Tundra = 13,
    Glacier = 14,
    Wetland = 15,
    Urban = 16,
}
```

### 2.4 文件存储结构

```
<world>/maps/
├── index.json              # 地图索引（列出所有可用地图）
├── <map_id>/
│   ├── map.json            # 完整地图数据（主文件）
│   ├── precomputed.json    # 预计算查询表
│   ├── heightmap.png       # 灰度高度图（前端渲染用）
│   ├── biome.png           # 生物群落彩色图（前端渲染用）
│   └── preview.png         # 缩略预览图
```

---

## 三、地图生成管线

### 3.1 完整管线（从种子到完整地图）

```
阶段 0: LLM 配置解析
  ── 读取用户描述 / 已有 entries
  ── 输出结构化 MapParams
  ↓

阶段 1: 高度图
  ── fBm Perlin noise → 大陆形状（octaves=4, persistence=0.5）
  ── RidgedMulti noise → 山脉（octaves=5）
  ── HybridMulti noise → 地形细节（octaves=6）
  ── 岛屿遮罩（径向衰减）
  ── CDF 重映射（避免全是草原）
  ── LLM 约束注入（在指定位置拉高/拉低）
  ↓

阶段 2: 生物群落
  ── 第 2 层 noise → 湿度图
  ── 纬度 + 高度 → 温度图
  ── Whittaker 分类（温度 × 湿度 → 15 种 biome）
  ↓

阶段 3: 河流
  ── D8 算法：每格流向最低邻居
  ── 流量累积
  ── Strahler 分级（小溪 / 河 / 大河）
  ── 折线提取
  ↓

阶段 4: 聚居点
  ── Poisson-disc 采样（候选位置）
  ── 宜居分数计算（水源、地形、港口、平原）
  ── LLM 指定城市位置注入
  ↓

阶段 5: 道路
  ── Delaunay 三角网连接城市
  ── A* 实际路径（代价 = 坡度 + 河流 + 生物群落）
  ── MST 剪枝 + 分类
  ↓

阶段 6: 政治边界
  ── 加权距离分配领土
  ── 河流/山脊作为自然边界
  ── 边界平滑（细胞自动机）
  ↓

阶段 7: 预计算
  ── 面积（鞋带公式）
  ── 距离矩阵（测地线 + 道路）
  ── 邻接表
  ── 路径地形描述
  ↓

阶段 8: Entry 同步
  ── 为城市/区域创建 location entry
  ── 在 entry 之间建立 relation（located_in, capital_of, borders）
  ── 可选：创建 founding event 写入 timeline
```

### 3.2 LLM 配置映射

这是核心创新点 —— LLM 从自然语言/entry 数据输出结构化地图参数：

```
用户说："我的世界有一个中央帝国，王都在大平原上，
          北面是龙脊山脉，越过山脉是蛮族冻原，
          南面靠海，东面是大河出海口"

agent 调用 EntrySearch + EntryRead 收集已有数据
  ↓
LLM 输出 MapParams JSON：
  → regions: [中央帝国, 龙脊山脉, 北部冻原, 南海]
  → 指定相对位置 + 气候倾向
  → 指定 key cities（王都）的位置 hint
  → 指定河流（大河）的走向 hint
  ↓
Rust 引擎以这些为约束生成地形：
  → 王都平原 → 拉低
  → 龙脊山脉 → 拉高
  → 大河 → 强制低海拔通道
  → 其余部分 → 噪声自动填充
```

### 3.3 需要添加的 Rust crate

| Crate | 版本 | 用途 |
|-------|------|------|
| `noise` | 0.9 | 噪声生成（Perlin, Fbm, RidgedMulti, HybridMulti） |
| `delaunator` | 1.0 | Delaunay 三角剖分（道路网络 + Voronoi） |
| `image` | 0.25 | PNG 导出（高度图、生物群落图） |
| `serde` / `serde_json` | 已有 | 序列化 |
| `rand` | 0.8 | 种子随机数 |
| `pathfinding` | 可选 | A* 寻路（道路生成） |

### 3.4 新增模块结构

```
src-tauri/src/
├── map/
│   ├── mod.rs                   # MapPlugin 注册, 公开 API
│   │
│   ├── data/
│   │   ├── mod.rs
│   │   ├── types.rs             # MapData, Region, City, River 等核心类型
│   │   ├── biome.rs             # BiomeId 枚举 + 颜色映射
│   │   └── precompute.rs        # 预计算逻辑（面积、距离、邻接）
│   │
│   ├── generation/
│   │   ├── mod.rs
│   │   ├── heightmap.rs         # 噪声管线 + 岛屿遮罩 + CDF 重映射
│   │   ├── hydrology.rs         # D8 流量累积 + 河流提取
│   │   ├── biomes.rs            # Whittaker 分类
│   │   ├── settlements.rs       # Poisson-disc + 宜居评分
│   │   ├── roads.rs             # Delaunay + A* 寻路
│   │   ├── boundaries.rs        # 领土分配 + 边界提取
│   │   └── params.rs            # MapParams（LLM 输出的配置结构）
│   │
│   ├── query/
│   │   ├── mod.rs
│   │   ├── spatial.rs           # 距离、面积、路径查询
│   │   └── terrain.rs           # 地形采样、视线分析
│   │
│   ├── integration/
│   │   ├── mod.rs
│   │   ├── entry_sync.rs        # 生成地图 → 创建 entry
│   │   └── relation_sync.rs     # 生成地图 → 创建 relation
│   │
│   ├── render/
│   │   ├── mod.rs
│   │   ├── colormap.rs          # 生物群落配色
│   │   └── export.rs            # PNG 导出
│   │
│   └── commands.rs              # Tauri IPC 命令
```

---

## 四、Agent 工具设计（6 个新工具）

### 4.1 MapGenerate（生成地图）

```typescript
{
  name: "MapGenerate",
  description: "根据用户描述或已有 location entries 生成一张架空地图。返回地图摘要",
  input_schema: {
    description: "对地图的自然语言描述，或留空让 AI 自动根据已有 entry 生成",
    constrain_to_entries: "可选，用已有 entry 的位置信息来约束地图生成",
    style: "地图风格：standard / parchment / minimal",
    seed: "可选，种子值（相同种子生成相同地图）"
  }
}
```

执行逻辑：
1. 如果传了 `description`，LLM 直接读描述出 `MapParams`
2. 如果传了 `constrain_to_entries`，LLM 读 entry 数据出 `MapParams`
3. 如果都没传，LLM 自动搜索所有 location entries 出 `MapParams`
4. Rust 引擎接收 `MapParams`，执行完整管线
5. 返回地图摘要（区域数、城市数、总面积等）

### 4.2 MapQuery（查询地图信息）

```typescript
{
  name: "MapQuery",
  description: "查询地图上的区域/城市/地形的详细信息",
  input_schema: {
    map_id: "地图 ID",
    query: "查询内容，如「龙脊山脉的面积」「王都的人口」「迷雾森林的生物群落」"
  }
}
```

执行逻辑：
1. 解析 query 意图 + 目标实体
2. 查 `precomputed.json` 或 `map.json`
3. 返回结构化结果

### 4.3 MapRoute（路径/距离查询）

```typescript
{
  name: "MapRoute",
  description: "查询两个地点之间的路径、距离和沿途地形",
  input_schema: {
    map_id: "地图 ID",
    from: "起点城市/区域名称或 ID",
    to: "终点城市/区域名称或 ID"
  }
}
```

### 4.4 MapTerrain（地形查询）

```typescript
{
  name: "MapTerrain",
  description: "查询某个位置周边的地形信息",
  input_schema: {
    map_id: "地图 ID",
    position: "坐标 [x, y] 或地点名称",
    radius_km: "查询半径（公里）",
    include_elevation: "是否包含高度剖面"
  }
}
```

### 4.5 MapMarker（添加标注）

```typescript
{
  name: "MapMarker",
  description: "在地图上添加标注点（事件发生地、兴趣点等）",
  input_schema: {
    map_id: "地图 ID",
    name: "标注名称",
    position: "坐标 [x, y] 或『在 A 城北面 30km 处』",
    marker_type: "事件发生地 | 兴趣点 | 战场 | 遗迹 | 自定义",
    entry_id: "可选，关联的 entry ID",
    description: "标注描述"
  }
}
```

### 4.6 MapRegion（划定区域）

```typescript
{
  name: "MapRegion",
  description: "根据文字描述在地图上划定一个新的区域",
  input_schema: {
    map_id: "地图 ID",
    name: "区域名称",
    description: "边界描述，如『从大河入海口到龙脊山脚，沿山脊到鹰喙峰，直线回入海口』"
  }
}
```

执行逻辑：
1. LLM 解析文字描述 → 坐标路径
2. Rust 引擎验证合法性 + 计算面积
3. 创建新 region，更新 precomputed.json
4. 可选：创建对应的 location entry

---

## 五、与现有系统的集成

### 5.1 Entry 集成

- 地图生成时，每个 region/city/river 自动创建一个对应的 `location` entry
- entry 的 `properties` 中包含 `map_id`、`map_feature_id`、`area_km2` 等
- entry 的 `body` 写入地图生成时的摘要描述
- entry 的 `tags` 自动添加 `["generated", "map"]`

### 5.2 Relation Graph 集成

生成的 relation edges：

| 关系 | 说明 |
|------|------|
| `located_in` | 城市 → 区域 |
| `capital_of` | 首都 → 区域 |
| `borders` | 区域 → 区域 |
| `connected_by` | 城市 → 城市（道路） |
| `flows_through` | 河流 → 区域 |

### 5.3 Timeline 集成

- 生成地图时可选择在 timeline 上创建"建城事件"
- 地图上的 marker 可以与 timeline event 关联

### 5.4 前端视图

- 地图列表页（所有已生成的地图）
- 地图查看器（缩放/平移/点击查看详情）
- 图层切换（地形/政治/道路/标注）
- 点击城市 → 打开对应的 entry 面板
- 标注编辑（添加/移动/删除 marker）
- 迷你地图（MiniMap）显示当前视口位置

---

## 六、前端技术选型

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **SVG（React 原生）** | 无依赖，事件集成好，适合矢量 | 大量元素时性能下降 | ★★★★★ 第一阶段 |
| **Leaflet + React-Leaflet** | 成熟稳定，缩放平移开箱即用 | 需要将地图坐标映射到经纬度 | ★★★★ 后续迭代 |
| **Canvas（PixiJS）** | 性能好，适合游戏风格 | 事件处理麻烦 | ★★★ 可选 |
| **D3.js** | 数据驱动，Azgaar 用的就是它 | 学习曲线陡 | ★★★ 参考 |

**第一阶段推荐**：直接 React + SVG。地图的 region/city/river 都是矢量，用 SVG 渲染最直接，事件绑定也简单。等地图变得复杂（大量 Voronoi 网格）后再考虑 Leaflet 或 Canvas。

---

## 七、分阶段实施计划

### Phase 1：基础数据模型 + 高度图生成（2-3 天）

文件：
- `src-tauri/src/map/data/types.rs` — MapData, Region, City 等核心类型
- `src-tauri/src/map/data/biome.rs` — BiomeId 枚举
- `src-tauri/src/map/generation/heightmap.rs` — 噪声管线
- `src-tauri/src/map/generation/params.rs` — MapParams 结构
- `src-tauri/src/map/commands.rs` — generate_map, load_map 命令

产出：
- ✅ 通过 `generate_map(seed)` 生成高度图
- ✅ 导出 heightmap.png
- ✅ 基本的地理特征（海洋/陆地分类）

### Phase 2：生物群落 + 河流（2 天）

文件：
- `src-tauri/src/map/generation/biomes.rs`
- `src-tauri/src/map/generation/hydrology.rs`
- `src-tauri/src/map/data/precompute.rs`

产出：
- ✅ 生物群落分类 + biome.png
- ✅ D8 河流生成
- ✅ 基础地形特征提取

### Phase 3：聚居点 + 道路 + 边界（2 天）

文件：
- `src-tauri/src/map/generation/settlements.rs`
- `src-tauri/src/map/generation/roads.rs`
- `src-tauri/src/map/generation/boundaries.rs`

产出：
- ✅ 城市/村庄生成
- ✅ 道路网络（Delaunay + A*）
- ✅ 政治边界

### Phase 4：预计算 + Entry 同步（1-2 天）

文件：
- `src-tauri/src/map/query/spatial.rs`
- `src-tauri/src/map/query/terrain.rs`
- `src-tauri/src/map/integration/entry_sync.rs`
- `src-tauri/src/map/integration/relation_sync.rs`

产出：
- ✅ precomputed.json（距离矩阵、邻接表、面积）
- ✅ 自动创建 location entries
- ✅ 自动创建 graph relations
- ✅ 可选 timeline 事件创建

### Phase 5：Agent 工具（1-2 天）

文件：
- `src/lib/agent-loop.ts` — 注册 MapGenerate, MapQuery, MapRoute, MapTerrain, MapMarker, MapRegion
- `src/lib/system-prompt.ts` — 添加地图相关指导

产出：
- ✅ LLM 可以通过工具调用生成地图
- ✅ LLM 可以查询地图信息
- ✅ LLM 可以在 map.json 理解地形数据
- ✅ LLM 可以通过预计算数据回答空间问题

### Phase 6：LLM 配置 + 前端显示（2-3 天）

文件：
- `src-tauri/src/map/generation/params.rs` — LLM MapParams 注入增强
- 前端：`src/components/map/` 整个目录

产出：
- ✅ LLM 从自然语言/entries 生成 MapParams
- ✅ 地图查看器（SVG 渲染 + 缩放平移）
- ✅ 图层切换
- ✅ 点击城市/区域跳转 entry
- ✅ 地图列表页
- ✅ 地图标注编辑

**总计：约 10-14 天/人**

---

## 八、验证方案

### 功能验证

1. **生成验证**：`generate_map(seed=42)` → 检查 heightmap.png 是否有合理的地形
2. **河流验证**：随机种子生成的地图，检查河流是否都流向海洋/湖泊
3. **一致性验证**：预计算的面积是否与多边形几何计算一致
4. **Agent 验证**：
   - `MapQuery({ query: "龙脊山脉的面积" })` → 返回正确的数值
   - `MapRoute({ from: "王都", to: "边境要塞" })` → 返回的路径合法
   - `MapGenerate({ description: "..." })` → 生成的地图符合描述约束

### 性能验证

- 1000×1000 网格生成时间 < 5 秒
- precomputed.json 加载时间 < 100ms
- SVG 渲染 100+ 个区域不卡顿

---

## 九、现有参考项目

| 项目 | 可借鉴内容 | 协议 |
|------|-----------|------|
| [Azgaar/Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator) | 完整的生成管线、Voronoi 网格、JSON 导出格式 | MIT |
| [redblobgames/mapgen2](https://github.com/redblobgames/mapgen2) | 双网格结构、河流算法、Whittaker 生物群落 | MIT |
| [redblobgames/mapgen4](https://github.com/redblobgames/mapgen4) | 100万+ 单元、CDF 重映射、UI 编辑 | MIT |
| [Veloren worldgen](https://gitlab.com/veloren/veloren) | 生产级 Rust 代码、多阶段噪声管线、CDF 重映射 | GPL |
| [Zero-shot 3D Map Generation with LLM Agents](https://arxiv.org/abs/2512.10501) | LLM 输出参数 → PCG 引擎的模式 | 论文 |

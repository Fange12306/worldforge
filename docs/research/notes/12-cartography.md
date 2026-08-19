# 笔记 12: 地图学与投影(cartography)

> 研究主题: 地图投影类型及其对世界地图的影响、比例尺与经纬网、绘制虚构世界地图时的地理一致性要点。

---

## 核心理论

1. **投影的本质与不可回避的变形**: 地图投影是把地球椭球(近似球面)映射到平面的数学变换。Gauss 曲面理论表明球面存在常正曲率、不可无变形展开成平面, 因此**任何投影必有变形, 制图只能取舍**。Tissot(1881)用指示线(Tissot's indicatrix)度量局部变形: 球面上每个无限小圆投影后变成椭圆, 长/短轴反映形状变形, 面积比反映面积变形。

2. **按变形性质分类(最重要)**:
   - ①等角投影(conformal): 保角度与局部形状, 如 Mercator、Lambert 等角圆锥、横轴墨卡托(UTM);
   - ②等积投影(equal-area): 保面积, 如 Albers 等积圆锥、Gall-Peters、Mollweide;
   - ③等距投影(equidistant): 仅沿某些方向保距离, 如等距方位投影;
   - ④折衷投影(compromise): 各种变形均摊, 无一项精确, 如 Robinson、Winkel Tripel、Natural Earth。
   - **等角与等积不可兼得**(数学上互斥), 折衷投影正是为世界图设计的妥协。

3. **按投影面分类**: 圆柱(cylindrical, 经纬网正交)、圆锥(conic, 纬线为同心圆弧)、方位(azimuthal, 以一点为中心)、伪圆柱(pseudocylindrical, 纬线平行而经线为曲线: Sinusoidal、Mollweide、Robinson)。再按投影面与地轴关系分正轴/横轴/斜轴, 按相切/相割分切投影与割投影(secant, 标准纬线/标准经线上变形为零)。

4. **比例尺与经纬网(graticule)**: 比例尺=图上距离/实地距离, 主比例尺(RF)仅对标准线成立, 局部比例尺处处随投影变形变化。经纬网是投影的骨架: 1° 纬度≈111 km(近常数), 1° 经度≈111.3 km×cos φ(随纬度缩短), 纬线周长正比于 cos φ——这是高纬"收缩"的几何根源, 也是检验虚构地图比例是否合理的硬尺度。

5. **投影对世界地图的实质影响**: 墨卡托把面积随纬度按 sec²φ 放大, 使格陵兰(约 216 万 km²)与非洲(约 3037 万 km²)在图上几乎等大, 高纬国家被系统性夸大, 直接塑造了公众的地缘感知(非洲联盟为此发起"Correct the Map"运动)。世界总图因此改用折衷/等积方案: National Geographic 1988 年起用 Robinson, 1998 年起改用 Winkel Tripel。

---

## 形成与分布机制(关键参数)

- **墨卡托的数学机制**: 正轴公式 x=Rλ, y=R·ln[tan(π/4+φ/2)], 局部比例因子 k=sec φ, 面积变形正比于 sec²φ(高纬无限放大, φ→90° 时发散)。等角性质使等角航线(rhumb line)画成直线, 故为航海标准; 代价是极区不可达、面积失真。UTM 用 6° 分带、中央经线比例因子 0.9996 削峰, 是"分区控变形"的工程化范例。
- **圆柱等积(Gall-Peters)机制**: y=2R·sin φ, 面积守恒但低纬形状严重拉长——"面积正确、形状荒谬"的典型对照。
- **标准纬线机制**: 割投影在两条标准纬线之间图形收缩、之外拉伸; 圆锥投影最适合中纬度大陆(标准纬线覆盖制图区即失真最小), 圆柱适合低纬与全球经线图, 方位投影适合极地与圆形区域, 伪圆柱适合全球统计分布图。
- **选择经验法则**: 中纬大陆→等积圆锥; 全球密度分布→伪圆柱; 航海导航→墨卡托; 大比例尺地形→横轴墨卡托。
- **Tissot 指示线定量变形**: 椭圆长短轴 a≥b, 角度变形 ω=2·arcsin[(a−b)/(a+b)], 面积变形=ab。等角投影中椭圆退化为圆(仅大小变化), 等积投影中椭圆面积处处相等——一张 Tissot 图就能看出投影的"性格"。
- **经纬网与行星参数的联动**: 纬度决定太阳高度角与气候带(赤道上升气流、30° 副热带高压、60° 极锋、极地下沉), 经度决定时区(15°/小时); 对虚构行星, 自转轴倾角决定季节强度, 自转周期与大气环流决定风带洋流——这些与经纬网共同构成可检验的物理骨架。

---

## 关键文献

- John P. Snyder, *Map Projections: A Working Manual*, USGS Professional Paper 1395(1987) — 投影公式与性质的权威技术手册; 另有 *Flattening the Earth: Two Thousand Years of Map Projections*(University of Chicago Press, 1993) — 投影两千年思想史。
- Arthur H. Robinson et al., *Elements of Cartography*(6th ed., Wiley, 1995) — 经典地图学教材, Robinson 投影的提出者。
- 胡毓钜等《地图投影》(测绘出版社)、祝国瑞《地图学》(武汉大学出版社) — 中文系统教材。
- N. A. Tissot, *Mémoire sur la représentation des surfaces et les projections des cartes géographiques*(1881) — 指示线理论原始文献。
- Mark Rosenfelder, *The Planet Construction Kit* — 面向虚构行星构建的实用手册。
- Map Effects 教程 *River Sins to Avoid on Your Fantasy Maps* — 虚构地图河流常见错误清单(社区经典)。

---

## 对虚构世界构建的启示

1. **先定投影与经纬网, 再画大陆**: 世界观总览图用 Winkel Tripel / Robinson / Mollweide 一类折衷或等积投影, 避免墨卡托的面积错觉(否则"极地帝国"会被潜意识放大); 大陆区域图用等积圆锥并标注标准纬线; 小区域详图用横轴墨卡托; 全图必须标注比例尺、投影名称、指北针与经纬网刻度。
2. **用纬度锁定气候带**: 让虚构大陆的植被带、沙漠、冰盖与纬度对齐: 赤道雨林、30° 副热带沙漠(撒哈拉式)、40-60° 西风带温带森林、极地冰原; 再叠加季风与洋流(大陆西岸寒/暖流)制造例外, 使世界"既有规律又有意外"。
3. **河流铁律: 汇流不分支、单向入海**: 河流由分水岭圈定的流域(basin)汇聚, 只能汇合、不可在陆地中段分叉(三角洲与干旱区冲积扇是仅有的例外, 且只发生在入海口/低坡); 每个流域通常一个入海口, 内陆盆地可汇入内流湖(里海/咸海式)。分水岭沿山脊线, 因此山脉走向直接决定河网格局。
4. **山脉沿构造线走**: 俯冲带→平行海岸的火山弧(安第斯式, 近海岸、多地震火山); 大陆碰撞→内陆高大山脉(喜马拉雅式); 裂谷→断块山与长湖(东非式)。山脉制造雨影: 迎风坡湿润、背风坡干旱, 沙漠应出现在背风侧或副热带高压下, 河流从分水岭两侧分流入海。
5. **海岸线由过程塑造而非随机**: 河流入海处给三角洲(泥沙丰)、峡湾对应冰川侵蚀(高纬)、珊瑚礁限于热带暖水、隆升/沉降海岸形态不同; 海湾与半岛应顺应山脉走向与断裂方向。避免"随手画的海岸"——让每段海岸线能追溯到一种地貌过程。
6. **一致性自检清单**: ①所有河流自高向低、只合不分; ②每个分水岭两侧各有入海或内流归宿; ③山脉、火山、地震带沿同一构造线分布; ④沙漠与雨影/副热带高压吻合; ⑤海岸形态与气候带、冰川史、泥沙供给匹配; ⑥全图比例尺、投影、经纬网、方向标注齐全, 不同比例尺子图投影体系一致。

---

## 来源链接
- https://zh.wikipedia.org/zh-hant/%e5%9c%b0%e5%9c%96%e6%8a%95%e5%bd%b1#2 — 投影变形原理与墨卡托推导。
- https://zh.wikipedia.org/zh-tw/%E5%9C%B0%E5%9B%BE%E6%8A%95%E5%BD%B1%E5%88%97%E8%A1%A8#1 — 投影分类总表。
- https://gsp.humboldt.edu/jimsprofessional/Resources/SelectingAProjection.html — 按用途选择投影的实操指南。
- https://www.fao.org/4/y4816e/y4816e0f.htm — 投影性质与变形取舍(FAO 教程)。
- https://en.wikipedia.org/wiki/Graticule — 经纬网与纬线收缩规律。
- https://www.mapeffects.co/tutorials/river-sins — 虚构地图河流错误清单。
- https://www.newarab.com/news/african-union-takes-fight-correct-mercator-map — 墨卡托面积失真与地缘认知。
- https://theprint.in/world/world-map-mercator-projection-africa/2726779/ — 非洲与格陵兰面积比失真量化。
- https://web.archive.org/web/20161206163048/https://en.wikipedia.org/wiki/John_P._Snyder — Snyder 著作信息。

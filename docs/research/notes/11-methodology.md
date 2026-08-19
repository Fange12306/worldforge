# 笔记 11: 世界构建方法论(methodology)

> 研究主题: 从 0 到 1 构建虚构地理世界的流程方法论——从世界法则→天文参数→板块→地貌→气候→生物群系→区域的推导链。

---

## 核心理论

- **自上而下的推导链**: 世界构建的主流方法是一条严格的因果链——世界法则 → 天文参数 → 行星物理 → 板块构造 → 地貌 → 气候 → 生物群系 → 区域。每一层都是下一层的输入与硬约束, 下层设定不得违反上层物理(即 "hard-science" 式构造)。Rosenfelder 称之为"让地球科学替你做设计": 你只需定少数几个初始参数, 其余全部由机制"自动生成"。
- **一致性优于密度**: Mark Rosenfelder(《The Planet Construction Kit》)的核心主张: 一个好世界只依赖一两条物理原理(如"本世界与地球物理相同, 唯 X 不同"), 其余细节均由推导得出; 设定不是素材堆砌, 而是一套可被内部检验、可证伪(self-consistent)的演绎系统。魔法/超自然法则也应先定"世界法则"(如能量来源与守恒), 再谈应用。
- **可居性筛选 (Habitability as filter)**: 生命、文明与区域分布并非随机, 而是被多重"可居性门槛"筛选: 恒星宜居带、行星质量与大气、板块构造与碳循环、磁场等(Langmuir & Broecker 的"可居行星"清单)。因此"哪里有人、哪里繁荣"可以从物理直接推出。
- **由果推因的反向校验**: 自底向上(先画地图再补设定)同样成立, 但必须做"反演校验"——Worldbuilding SE 经典问题("Creating a realistic world map"、"Mountain ranges and tectonic plates")演示了如何从已绘大陆反推板块边界并修正不合理处。两条路径应迭代收敛。
- **程序化世界观即方法论的"物理实现"**: Dwarf Fortress 的 worldgen 以 elevation、rainfall、drainage、temperature 等基础场合成地貌、气候、生物群系乃至数千年历史(Advanced world generation 参数), 证明该推导链可被完全计算化——这为人工构建提供了"检查清单"式的参照。

---

## 形成与分布机制(关键参数)

- **天文参数**: 恒星光谱型决定光度 L; 平衡温度 T_eq = [L(1−A)/(16πσd²)]^¼(A 为反照率、d 为轨道距离), 由此把行星放进宜居带; 轨道偏心率 e 放大季节极端; 自转周期决定昼夜温差与科里奥利力强度; 轴倾角(地球 23.5°)决定四季; 大卫星产生潮汐并稳定自转轴; 磁层由液态外核发电机效应产生, 保护大气。
- **行星物理**: 质量/半径 → 表面重力 g=GM/R² 与逃逸速度 → 决定大气保留(Jeans 逃逸)与板块活动强度; 内部放射性衰变与潮汐摩擦提供地质活动能源; 行星年龄决定地质地貌成熟度。
- **板块构造**: 岩石圈分板块, 三种边界——离散(洋中脊、裂谷)、汇聚(俯冲带→岛弧火山、陆陆碰撞→喜马拉雅型造山带)、转换(走滑断层)。绘制大陆前应先画板块边界: 山脉、火山链、地震带、裂谷位置全部由边界类型决定; 大陆形状必须与板块运动史兼容。
- **地貌**: 造山作用与侵蚀(河流、冰川)达成动态平衡; 河流单向汇海、支流合并不分叉、必走分水岭; 湖泊位于盆地; 海岸形态(峡湾、三角湾)反映海平面史; 地壳均衡(isostasy)使山脉有"山根"; 世界越古老, 地貌越平缓。
- **气候**: 纬度辐射梯度 + 三圈环流(Hadley/Ferrel/Polar)与科里奥利效应 → 信风带与西风带; 副热带高压带(约 30°N/S)形成行星沙漠带; ITCZ 季节摆动驱动季风; 洋流(副热带环流、西边界流、温盐环流)跨纬输热; 地形雨与雨影效应(迎风坡湿、背风坡旱); 温度随海拔递减率约 6.5°C/km; 内陆大陆性 vs 沿海海洋性气候。
- **生物群系**: 气候不直接等于植被, 需经"温度×降水"两轴映射——Whittaker 生物群系图与 Holdridge 生命地带(life zones)是标准工具; Köppen 气候分类(A 热带/B 干旱/C 温带/D 大陆/E 极地)是社区通用的从气候到生物群系桥梁(如 Af→热带雨林、BWh→沙漠、Csa→地中海、Dfb→针叶林、ET→苔原)。
- **区域(文化/政治地理)**: 文明沿河流、高产生物群系与海岸/贸易线聚集; 农业生产力决定人口上限; 山脉与海洋构成语言、文化扩散的阻隔; 资源(矿产、森林、渔场)与战略地形(隘口、海峡)塑造政治实体——即"地理决定历史"。

---

## 关键文献

- **《行星建造工具箱》**(Mark Rosenfelder, *The Planet Construction Kit*, Zompist Press, 2010): conworld 圣经级方法论, 按"宇宙中的行星 → 行星本身 → 季节与天气 → 地理 → 海洋 → 生态 → 文明"递进, 并给出完整工作例(如 Kemres)。
- **《如何构建可居行星: 从大爆炸到人类的地球故事》**(Charles H. Langmuir & Wally Broecker, *How to Build a Habitable Planet*, 修订版, Princeton University Press, 2012): 地球科学教科书, 系统讲恒星核合成、行星增生分异、大气演化、板块构造、碳酸盐-硅酸盐循环这一"行星恒温器"及生命-行星共演化。
- **《主序星宜居带》**(James F. Kasting, Daniel P. Whitmire, Ray T. Reynolds, "Habitable Zones around Main Sequence Stars", *Icarus* 101, 1993): 宜居带内外边界的奠基论文。
- **Poul Anderson《如何建造一颗行星》**(*How to Build a Planet*, Analog, 1971): 早期硬科幻世界构建随笔, 开创"从天文参数推生态"传统。
- **Patricia Drewry《行星建造者蓝图: 用真实科学创造可信外星世界》**(*The Planet Builder's Blueprint*, 2025): 较新的实操型教材。
- **《幻想地理与气候: 为什么你的地图不对(以及如何修正)》**(*Fantasy Geography & Climate: Why Your Map Doesn't Work (And How to Fix It)*): 聚焦地图常见谬误(河流分叉、山脉错位、气候与纬度不符)的纠错手册。
- **Whittaker《群落与生态系统》** 与 **Holdridge "Determination of World Plant Formations from Simple Climatic Data"(*Science* 105, 1947)**: 温度-降水-生物群系映射的经典框架。
- **社区方法论**: Artifexian 系列视频(板块/气候/生物群系逐层教学)、Worldbuilding Stack Exchange(可居行星规范问答)、Cartographers Guild 板块绘图教程、Zompist/Verduria 论坛的 Conworld Köppen 地图实践、Dwarf Fortress 世界生成文档。

---

## 对虚构世界构建的启示

1. **先立法则, 再定参数**: 一句话写死"世界法则"(本世界=类地物理; 或某一条超自然规则如"魔力源于恒星辐射"), 后续一切不得越界; 宁可设定少而自洽, 不要多而矛盾。
2. **先定恒星, 后定轨道**: 选恒星光谱型 → 由光度算宜居带 → 取轨道距离使平衡温度落在宜居区间; 设定轴倾角、偏心率、自转周期、卫星, 先得出"温度-季节基调"(如: 高倾角→极端四季, 慢自转→大昼夜温差)。
3. **画板块在画大陆之前**: 先画 6~10 块板块与运动方向, 再让大陆从板块拼合、裂解中"长出来"; 山脉/火山/裂谷/岛弧只出现在边界上, 并据此反推海岸形态。
4. **气候在地图之后、生物群系之前**: 用纬度 + 三圈环流 + 洋流 + 雨影手工推温度与降水两张"等值线图", 再叠成 Köppen 分区; 若嫌手工复杂, 参照 Dwarf Fortress 的 elevation/rainfall/temperature 字段做程序化预演。
5. **生物群系用双轴映射**: 温度×降水查 Whittaker/Holdridge 图, 勿凭直觉乱放; 注意海拔修正(山体垂直带)与土壤/排水对植被的二次约束。
6. **区域服从地理**: 城市、国家、语言区只允许出现在"推导得出的可居与可耕之地"——河流谷地、沿海平原、雨量充足处; 人口密度随生物群系生产力递减, 荒漠与苔原应几乎无人。
7. **做一致性清单自查**: 河流必入海且不反向分流; 背风坡必有干旱带; 高纬内陆冬季严寒; 磁层存在才谈复杂大气; 板块边界与地震火山带吻合。
8. **双向迭代**: 自上而下(法则→区域)定骨架, 自下而上(由某区域细节反推上层参数)查漏洞; 两者收敛即视为完成初稿, 并把全部初始参数记录成"世界圣经"以便日后任何新设定回查。

---

## 来源链接
- http://mail.freelancetraveller.com/features/reviews/othertoys/pck.html — The Planet Construction Kit 书评。
- https://mythcreants.com/blog/the-planet-construction-kit-gives-2-to-worldbuilding/ — 方法论价值评析。
- https://search.worldcat.org/zh-cn/title/775028281 — How to build a habitable planet 书目。
- https://play.google.com/store/books/details/Patricia_Drewry_The_Planet_Builder_s_Blueprint?id=ZWzwEQAAQBAJ — 行星建造者蓝图。
- https://www.amazon.com.au/Fantasy-Geography-Climate-Worldbuilding-Masterclass-ebook/dp/B0HBPLDKJ9 — 幻想地理与气候纠错手册。
- https://goteenwriters.com/2022/11/16/geography-for-world-building-part-two-climate-weather-and-biomes/ — 气候→生物群系映射教学。
- https://www.madelinejameswrites.com/blog/temperature-and-precipitation — 以降水量与温度分区推导气候。
- https://verduria.org/viewtopic.php?p=106948 — 社区用 Köppen 画架空世界气候图。
- https://www.cartographersguild.com/showthread.php?t=2238 — 先板块后大陆的经典绘图教程。
- https://www.cartographersguild.com/printthread.php?s=63fe2b92c4d938e372023488fce4ceeb&t=32998&pp=10&page=2 — 生物群系布局讨论。
- https://worldbuilding.stackexchange.com/posts/584/revisions — 由地貌反推大陆形成史。
- https://worldbuilding.stackexchange.com/questions/220646/ — 山脉与板块兼容性校验。
- https://worldbuilding.stackexchange.com/feeds/question/9944 — 可居行星参数链规范问答。
- https://dwarffortresswiki.org/index.php?title=Advanced_world_generation — 程序化世界生成参数。
- https://www.zhihu.com/question/35364898 — 中文社区绘制架空世界地图流程。
- https://gis-career-entry-guide.readthedocs.io/zh-cn/latest/learning/%E7%AE%80%E5%8C%96%E7%9A%84%E5%A5%87%E5%B9%BB%E5%9C%B0%E5%9B%BE%E8%AE%BE%E8%AE%A1%E6%8C%87%E5%8D%97.html — 中文奇幻地图构建步骤。

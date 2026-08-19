# 笔记 144: 生态位设计与生物多样性(species-niche)

> 研究主题: 生态位设计与生物多样性——生态位概念、竞争排斥、营养级金字塔、岛屿生物地理学、生物入侵与灭绝。

---

## 核心理论

**1. Hutchinson 生态位: n 维超体积 (The Niche as an n-Dimensional Hypervolume)**
- Grinnell(1917)把生态位定义为物种在环境中的"生境地位"(空间意义); Elton(1927)强调物种在群落中的"功能角色"(吃什么、被谁吃、在能量流中的位置)。
- Hutchinson(1957)将生态位数学化: 把影响物种存活的每个环境变量(温度、湿度、食物粒径、盐度、光照、竞争者……)视为一个维度, 物种的**基础生态位(fundamental niche)**是使种群净增长率 ≥0 的全部点的集合, 即一个 n 维超体积; 受竞争、捕食等生物作用压缩后, 物种实际占有的**实现生态位(realized niche)**是前者的子集。
- 意义: 生态位不再是抽象角色, 而是可作图、可比较、可建模的空间; 生物多样性可理解为"生态位空间被填充与分割的方式"。

**2. 竞争排斥原理 (Competitive Exclusion Principle)**
- 若两个物种在同一有限资源上竞争且生态位完全重叠, 则不能无限共存, 竞争力弱者被排斥(Gause, 1934; Hardin, 1960 命名)。
- Tilman(1982)给出机制化表述 R* 规则: 资源竞争中拥有最低资源平衡需求 R* 的物种最终取胜; 稳定共存要求物种在多种资源间存在权衡(trade-off)。
- 推论: 群落中每个物种必须占据不同的生态位维度——"生态位分化"是维持生物多样性的前提。

**3. 营养级金字塔与能量预算 (Trophic Pyramid / Energy Budget)**
- Elton(1927)提出数量金字塔; Lindeman(1942)的营养动力学确立林德曼定律: 能量每经一个营养级约损失 90%, 级间传递效率仅约 10%。
- 因此营养级数有限(通常 4~5 级), 顶级捕食者获得的总能量极小——个体大、数量少、所需领地极大, 形成"顶级捕食者必然稀少"的铁律。
- 密度-体型呈幂律: 哺乳动物种群密度约正比于 M^(-0.75)(Damuth, 1981; 能量等价规则)——体重×10, 密度约÷5.6。

**4. 生态位分化与同域共存 (Niche Differentiation / Sympatric Coexistence)**
- 经典案例: MacArthur(1958)发现五种林莺在同一针叶林中按不同取食高度与方式觅食, 即"资源分配(resource partitioning)"。
- Hutchinson(1959)提出共存物种体型比约 ≥1.3; 竞争可驱动**特征位移(character displacement)**(Brown & Wilson, 1956): 同域近缘种在形态上拉开差距。
- Chesson(2000)现代共存理论: 稳定化机制(stabilizing, 如资源分配、存储效应)与均等化机制(equalizing)共同决定共存; 波动环境、频率依赖捕食、相对非线性(relative nonlinearity)均可促成共存。Connell(1978)中间干扰假说: 中等频率/强度的干扰下多样性最高。

**5. 岛屿生物地理学 (Island Biogeography)**
- 物种-面积关系: S = cA^z(Arrhenius, 1921; Preston, 1962); 岛屿 z 约 0.15~0.35, 大陆内取样区 z 约 0.1~0.2。
- MacArthur & Wilson(1963, 1967)平衡理论: 岛屿物种数是**迁入速率**与**灭绝速率**的动态平衡点——面积↑→灭绝率↓; 距源区(大陆)越远→迁入率↓; 平衡物种数 S* 由两条曲线的交点决定。
- 推论: 面积与隔离度共同决定物种丰富度; 岛屿特有种比例高、物种更替率(turnover)高、对干扰更脆弱。

**6. 生物多样性与生态系统服务 (Biodiversity & Ecosystem Services)**
- Millennium Ecosystem Assessment(2005)把服务分四类: 供给(食物、淡水、木材)、调节(气候、洪水、传粉、病害)、支持(养分循环、初级生产)、文化(审美、精神)。
- 多样性-功能关系: Tilman 等(1996/1997)草地实验表明物种数↑→生产力与稳定性↑; 机制含互补效应与取样效应; **保险假说**(Yachi & Loreau, 1999): 多样性为波动环境提供"备份功能"; 功能冗余(functional redundancy)使系统在物种丧失后仍维持服务。

**7. 生物入侵与灭绝事件 (Biological Invasions & Extinctions)**
- Elton(1958)奠基入侵生态学: 人为连通使生物区系同质化。
- 岛屿与隔离系统因缺乏共同演化防线而脆弱: 进化史无捕食者→"天真"物种(naïve prey), 易被入侵者捕食或竞争排除, 特有种灭绝风险最高。
- 生物同质化(biotic homogenization, McKinney & Lockwood, 1999): 少数广布"赢家"取代大量特有"输家"; 入侵性融毁(invasional meltdown, Simberloff & Von Holle, 1999): 入侵种彼此促进。
- 灭绝背景: 五次大灭绝(奥陶纪、泥盆纪、二叠纪、三叠纪、白垩纪末); 现生人类驱动的第六次大灭绝已有多份证据(Barnosky et al., 2011; Ceballos et al., 2015)。

## 机制与案例

- **竞争排斥的动力学**: Lotka-Volterra 竞争模型的两条等倾线若不相交则一个物种必然灭绝; Gause(1934)以草履虫 Paramecium aurelia 与 P. caudatum 混养实验证实——混合培养中后者被排除, 单独培养则均存活。Tilman 用硅藻-硅酸盐竞争证明 R* 机制: 需求更低者取胜。
- **共存如何可能(机制清单)**: ①资源分配(不同食物粒径/取食高度/生境微区); ②时间隔离(昼夜、季节错峰); ③捕食者介导共存(频率依赖捕食偏爱优势种); ④存储效应(成体长寿+"种子库/卵库"跨越不利期); ⑤权衡(繁殖快 vs 竞争强); ⑥中间干扰。设计共存群落时可直接勾选这些机制。
- **能量预算的数学约束**: 设初级生产固定 100,000 kcal、每级传 10%, 则草食动物约 10,000、一级肉食者约 1,000、顶级捕食者仅约 100; 顶级捕食者维持 100 个个体所需的生态系统面积比草食动物大 2~3 个数量级——这是"顶端稀少"的硬数字。
- **营养级联与关键种**: Paine(1966)移除海星 Pisaster 后贻贝独占岩岸、物种多样性骤降, 提出关键种(keystone species)概念; "绿世界假说"(Hairston-Smith-Slobodkin, 1960)与海獭-海胆-海藻林级联(Estes & Palmisano, 1974)证明: 改变一个营养级会沿食物网向下传导。
- **岛屿平衡的实验验证**: Simberloff & Wilson(1969-70)清空佛罗里达红树林小岛全部节肢动物后观测再定居——物种数回升并围绕理论平衡点波动, 验证了迁入-灭绝平衡与面积、隔离度的预测; 该框架随后引发保护区设计的 SLOSS 争论(一个大保护区 vs 若干小保护区, Diamond, 1975)。
- **入侵与灭绝的经典案例**: 关岛棕树蛇(Boiga irregularis)1940s 入侵后致岛上十余种鸟类灭绝; 毛里求斯渡渡鸟因人类加引入猪、猴、鼠灭绝; 太平洋诸岛啮齿动物导致特有鸟类、蜗牛成批灭绝——"入侵者先行、特有种灭绝随后"是岛屿生态史的标准剧本。现生证据: 脊椎动物灭绝速率比背景速率高数十至上千倍(Ceballos et al., 2015)。

## 关键学者与著作

- **Joseph Grinnell**(1917): 生境/空间生态位, "The Niche-Relationships of the California Thrasher"。
- **Charles Elton**: 《Animal Ecology》(1927, 功能生态位+数量金字塔); 《The Ecology of Invasions by Animals and Plants》(1958, 入侵生态学奠基)。
- **G. E. Hutchinson**: "Concluding Remarks"(1957, Cold Spring Harbor Symposia 22: 415-427, n 维超体积); "Homage to Santa Rosalia"(1959, Am. Nat. 93: 145-159, 体型比 1.3 与"为何物种如此多")。
- **G. F. Gause**: 《The Struggle for Existence》(1934, 竞争排斥实验); **Garrett Hardin**(1960): "The Competitive Exclusion Principle"(Science 131, 命名该原理)。
- **David Tilman**: 《Resource Competition and Community Structure》(1982, R* 规则); 草地多样性-生产力实验(1996, Nature)。
- **Raymond Lindeman**: "The Trophic-Dynamic Aspect of Ecology"(1942, Ecology 23, 10% 能量传递); **Eugene Odum**: 《Fundamentals of Ecology》(1953, 能量流教科书)。
- **Robert MacArthur**: 林莺资源分配(1958); 与 **E. O. Wilson** 合著《The Theory of Island Biogeography》(1967)及 1963 年论文(岛屿平衡理论)。
- **Olof Arrhenius**(1921)、**F. W. Preston**(1962): 物种-面积关系 S=cA^z; **Daniel Simberloff & E. O. Wilson**(1969-70): 红树林岛去动物化实验; **Jared Diamond**(1975): SLOSS 与保护区设计。
- **Robert Paine**(1966): 关键种; **Joseph Connell**(1978): 中间干扰假说; **Peter Chesson**(2000): 现代共存理论(稳定化/均等化机制)。
- **Yachi & Loreau**(1999): 保险假说; **Robert May**(1973): 《Stability and Complexity in Model Ecosystems》, 复杂性-稳定性悖论。
- **McKinney & Lockwood**(1999): 生物同质化; **Simberloff & Von Holle**(1999): 入侵性融毁; **Barnosky et al.**(2011, Nature)、**Ceballos et al.**(2015, Sci. Adv.): 第六次大灭绝证据。
- **Millennium Ecosystem Assessment**(2005): 《Ecosystems and Human Well-being》; **IPBES**(2019): 《Global Assessment Report》。

## 对虚构世界构建的启示

1. **给每个物种/种族开"生态位维度清单"**: 列出 8~12 个维度(食物粒径、水分、温度、盐度、活动时段、繁殖场所、天敌、共生者), 分别标注基础位与实现位; 若两个种族在所有维度重叠, 按竞争排斥原理必须"写死一个或写分一个"——这本身就是现成的剧情资源。
2. **用能量预算硬约束"怪物密度"**: 设定世界初级生产力后, 按每级 ~10% 传递效率反推各营养级总生物量; 顶级捕食者(龙、巨兽)数量应稀少(参考 M^(-0.75) 定律), 给它们超大领地与极低繁殖率, 避免"遍地巨龙"破坏可信度。
3. **同域共存要有"分割轴"**: 让同一区域的物种/种族至少错开一个资源轴(昼伏夜出、不同取食层、不同猎物、错峰繁殖); 用体型比 ≥1.3 或特征位移写"竞争导致形态分化"的背景故事(两个近亲种族在接触带发展出不同獠牙/喙/食性)。
4. **用岛屿生物地理学设计地图**: 按 S=cA^z 规划物种数——大陆腹地物种多、竞争激烈; 小岛物种少但特有种比例高、易灭绝; 离大陆越远迁入越少, 区系越贫乏或越特化; 群岛=进化实验室与"脆弱文明"设定; 碎片化大陆可用 SLOSS 争论制造保护区政策冲突。
5. **把营养级联与关键种写成叙事引擎**: "猎杀最后一只关键种"必须引发可见的连锁崩塌(除狼→鹿泛滥→森林退化→河流改道); 作者可先画食物网箭头图, 预演任意物种移除后的级联, 使生态灾难剧情自洽。
6. **让文明依赖可见的生态系统服务**: 传粉生物、水源林、净化水体、防洪湿地成为文明的"基础设施", 其丧失直接导致饥荒、疫病、战争; 按保险假说, 单一作物/单一猎物的文明更易崩溃。
7. **设计入侵与灭绝事件**: 殖民、贸易或魔法传送引入外来种(鼠、蛇、杂草)→岛屿特有种灭绝→生物同质化; 用"入侵性融毁"制造多种入侵种互相促进的失控灾难; 背景灭绝+局部大灭绝(如二叠纪式事件)可作世界史的时间锚点与"上古遗种"设定。
8. **布置生物多样性梯度**: 低纬度、低海拔、高生产力区多样性最高(雨林、珊瑚礁), 高纬度、高山、沙漠、极地递减; 用梯度塑造文化差异——赤道"万族竞存"、北方"单一而坚韧"的生物区系, 让商路与迁徙路线沿梯度分布。

## 来源链接

- [IUPAC Gold Book: Hutchinsonian niche](https://goldbook.iupac.org/terms/view/14747) — 生态位作为 n 维超体积的正式定义。
- [PMC3720048: Vacated niches, competitive release 综述](http://staging.europepmc.org/backend/articlerender.fcgi?accid=PMC3720048) — Hutchinson(1957)概念在现代群落生态学(生态位空缺、竞争释放)中的应用。
- [ScienceDirect: Gause's Competitive Exclusion Principle](https://www.sciencedirect.com/science/article/abs/pii/B9780124095489008162) — 竞争排斥原理的综述(Gause 实验与后续发展)。
- [科普中国: 竞争排除原理](https://www.kepuchina.cn/article/articleinfo?ar_id=188126&business_type=100&classify=0) — 竞争排斥原理中文科普(共存条件、资源分化)。
- [LibreTexts: Island Biogeography (21.3)](https://bio.libretexts.org/Courses/CT_State_Northwestern/General_Ecology_Ecology/Chapter_21:_Landscape_Ecology_and_Island_Biogeography/21.3:_Island_Biogeography) — 物种-面积关系、z 值范围与平衡模型的生态学教材。
- [MDPI Land: Energy, Trophic Dynamics and Ecological Discounting](https://www.mdpi.com/2073-445X/12/10/1928) — Eltonian Pyramid 与营养级能量折扣(10% 效率)的现代论述。
- [科普中国: 林德曼定律](https://cloud.kepuchina.cn/newSearch/imgText?from=1&id=6973803399690276864&is_self=2) — 能量沿食物链每级约损失 90%、传递约 10% 的中文科普。
- [IPBES Glossary: Ecosystem Service](https://www.ipbes.net/glossary-tag/ecosystem-service) — 生态系统服务的官方定义(供给/调节/支持/文化)。
- [Millennium Ecosystem Assessment 框架报告(CSIR 引介)](https://www.infra.cbd.int/doc/meetings/nbsap/nbsapcbw-seafr-01/other/nbsapcbw-seafr-01-za-csir-intro-en.pdf) — MEA(2005)四类服务与人类福祉框架。
- [Cambridge Prisms: Extinction — Open border ecosystems](https://www.cambridge.org/core/journals/cambridge-prisms-extinction/article/open-border-ecosystems-against-globalised-laissezfaire-conservation/953DCBFC56C075E90EE856741D55A959) — 全球化背景下的入侵扩散、生态自组织与同质化争论。

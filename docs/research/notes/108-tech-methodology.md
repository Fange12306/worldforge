# 笔记 108: 技术构建方法论与一致性总检(tech-methodology)

> 研究主题: 技术构建方法论与一致性总检——技术档案清单、技术树构建流程、技术-社会配套、常见错误、总检清单。

---

## 核心理论

**1. 技术档案的完整清单与构建流程。** 世界构建视角下,每项技术应是一个"档案卡"而非一行字。完整字段:名称、原理(对应现象库中哪条自然/魔法/生物现象)、关键前置技术(节点)、产物与副产品、所需资源与能源、发明者与年代、扩散状态(到哪、为何)、社会配套(制度/组织/法律/观念/人才)、失败分支(曾尝试被放弃的路径)。操作流程呈四段流水线:①**现象库**——只列"世界允许发生的事"(物理定律、魔法规则、生物特性、材料属性),不列技术;②**组合**——现象×现象的合法拼接生成候选技术,禁止凭空发明;③**前置图**——依赖关系做成有向无环图(DAG),防环、防跳变;④**配套矩阵**——每项技术与社会、制度、经济、军事、文化逐项配对,缺配套者降级为"实验室技术"而非社会现实技术。

**2. 扩散理论(Diffusion of Innovations)。** Rogers 指出技术采用呈 **S 曲线**:创新者(2.5%)→早期采用者(13.5%)→早期多数(34%)→晚期多数(34%)→落后者(16%)。扩散速度由五属性决定:**相对优势、兼容性、可试验性、可观察性、复杂性**。五属性共同决定一条技术是"一夜普及"还是"千年小众"。

**3. 技术决定论 vs 社会建构论(SCOT)。** 技术不是自主动力。Pinch & Bijker 提出人工物的**解释柔性**(interpretive flexibility):同一技术在医生、工程师、患者眼里意义不同;经**闭合**(closure)与**稳定化**才定型。含义:技术树的"生长"是社会博弈的结果,不是自动解锁的关卡。

**4. 路径依赖与锁定。** Arthur(1989):报酬递增技术(网络外部性、学习效应、规模经济)会被锁定在历史偶然选择上,次优技术可能胜出——QWERTY 键盘即经典案例。David(1985)用"历史小事件+沉淀成本"解释锁定。锁定意味着:**过去的决定比今天的优劣更重要**。

**5. 技术动量(Technological Momentum)。** Hughes:大型技术系统(电力)由硬件+组织+制度+观念共同构成;越成熟动量越大、越难逆转。系统存在**反向凸角**(reverse salient,瓶颈部位),正是创新与危机的温床——电力的瓶颈催生了发电厂组织方式与监管制度。

**6. 停滞与转型的多层视角(MLP)。** Geels:微观**利基**(niche,创新孵化)、中观**制度**(regime,现有技术-社会秩序)、宏观**景观**(landscape,大环境压力)三层互动。停滞=regime 高度稳定;突破=利基蓄势+景观压力共振。这是"停滞必须有解释"的理论依据。

**7. 一致性法则(技术版 Sanderson)。** Sanderson 三法则(可理解、成本明确、局限明确)可平移给技术:读者能推理、技术有代价、技术有边界,世界才"可信"。Stewart Brand 的**佩斯层**(Pace Layers:自然/文化/治理/基础设施/商业/时尚,由慢到快)则提示:不同子系统变化速度不同——技术可以快,制度必须慢,错位即张力。

## 机制与案例

- **S 曲线实证**:Rogers 对农业技术采用的研究显示,早期采用者多为受教育高、社交广的"意见领袖",他们决定曲线斜率;DVD 取代录像带的扩散曲线即典型 S 形。
- **QWERTY 锁定**:19 世纪末打字机市场多布局竞争,Dvorak 更优,但先发者的学习沉淀与技能外溢使其胜出,后续即便证据不利也难翻盘;微软反垄断讨论中"网络外部性"同样解释 OS 锁定。
- **电力系统之战**(Hughes《权力网络》):爱迪生直流 vs 西屋交流之争并非单机竞赛,而是"系统"竞争——电网拓扑、标准、公司组织、监管法规共同演化,最终胜出的是系统而非灯泡。
- **Dune 的停滞模板**:巴特勒圣战以制度性禁令+宗教教义冻结万年科技,叠加香料资源垄断解释扩散限制;TV Tropes 的 **Space Age Stasis / Medieval Stasis** 汇总了停滞的常见解释:法令、宗教、资源枯竭、垄断组织——缺解释的停滞是"设定懒惰"。
- **游戏技术树(Civilization 系)**:前置图即 DAG;跳过铁器直出火药即"跳变",破坏一致性。蒸汽朋克常见败笔是"单点超前、整体滞后":差分机已现,但教育、金融、工厂制度仍是中世纪——技术没有社会配套。
- **同步扩散错误**:所有文明同时掌握同一技术,违反地理与知识壁垒;真实史是火药、印刷术、炼钢各自独立发明多次、扩散路线漫长。

## 关键学者与著作

- **Everett M. Rogers**《创新的扩散》(*Diffusion of Innovations*, 5th ed. 2003):S 曲线、五类采用者、五属性。
- **W. Brian Arthur**《竞争技术、报酬递增与历史事件锁定》(*Competing Technologies, Increasing Returns, and Lock-In by Historical Events*, Economic Journal, 1989):锁定理论奠基。
- **Paul A. David**《Clio 与 QWERTY 经济学》(*Clio and the Economics of QWERTY*, AER, 1985):路径依赖经典案例。
- **Thomas P. Hughes**《权力网络》(*Networks of Power*, 1983)及《大型技术系统的演化》(1987):技术动量、反向凸角、系统方法。
- **Trevor Pinch & Wiebe Bijker**《事实与人工物的社会建构》(*The Social Construction of Facts and Artifacts*, 1984):SCOT、解释柔性、闭合。
- **Frank Geels**:多层视角 MLP(2002),利基-制度-景观转型模型。
- **Brandon Sanderson**《Sanderson 的魔法三法则》(2007 起系列文章):设定可理解性/成本/局限,可平移至技术。
- **Stewart Brand**《时钟长河》(*The Clock of the Long Now*, 1999):佩斯层理论。
- 中文语境:中国知网博士论文《技术的创新与社会的协同演化》(2009)等,讨论技术-社会协同演化机制。

## 对虚构世界构建的启示

1. **先建现象库,再谈发明**。每条技术档案必须有"原理出处"字段,回溯到现象库中的具体现象;写不出出处的技术先砍掉或改写成"外来引进/考古遗物"。
2. **前置图用 DAG 并做"跳变检查"**。依赖关系禁止成环;技术等级差超过两个节点时,强制补写解释(逆向工程、外星遗物、禁忌重启),从机制上杜绝"没有铁器直接出火药"。
3. **配套矩阵强制填表**。每项技术配社会配套栏(制度/组织/法律/观念/人才/市场);空栏即标记为实验室技术,禁止直接当社会现实使用——这是"技术无社会配套"错误的制度化解药。
4. **用五属性写扩散评语**。为每条关键技术写一句:相对优势、兼容性、可试验性、可观察性、复杂性各打几分,据此决定它"一夜普及"还是"千年小众";"同步扩散"错误用地理隔离、贸易壁垒、知识垄断打破。
5. **停滞用"三件套"解释**。世界冻结万年必须同时给:(1)制度性禁令或垄断组织,(2)资源/能源瓶颈,(3)路径锁定沉淀成本;三者缺一,停滞即站不住。Dune 为范本。
6. **把技术写成剧情**。发明=解谜奖励(谁先组合出某现象);扩散=社会冲突(新旧制度斗争、垄断与盗版、观念抵抗);停滞=背景张力(主角要打破的墙)。每条档案补一个"剧情钩子"字段。
7. **建立一致性总检清单**,每卷自查一次:时间线无矛盾;人物知识边界(角色不知道的,作者不提前用);经济账(成本与产出对得上);能源账(动力源守恒);制度账(配套机构出现不早于技术本身);规模账(人口/产量/产能匹配)。
8. **保留失败分支**。记录"曾发明但被社会拒绝"的技术(如被禁令的机械、被宗教压制的印刷术),失败史是世界深度与续作伏笔的最佳来源,也天然解释为什么技术树有死胡同。

## 来源链接

- [How Do You Make Tech Tree?(Sufficient Velocity 论坛)](https://forums.sufficientvelocity.com/threads/how-do-you-make-tech-tree.46244/) — 技术树构建实操:前置条件、层级划分、游戏化思路
- [Tech Calculator(Marie Mullany)](https://www.mariemullany.com/tech-calculator) — 技术等级与前置需求计算工具
- [Rogers 扩散 S 曲线(SEI CMU 报告)](https://insights.sei.cmu.edu/documents/814/2009_005_001_15113.pdf) — S 曲线模型与五类采用者实证
- [技术采用理论与模型综述(Wiley)](https://onlinelibrary.wiley.com/doi/10.1155/2022/9258317) — 农业领域采用模型:创新者-早期采用者分类
- [技术与创新管理(Open University)](https://www.open.edu/openlearn/money-business/technology-innovation-and-management/content-section-8.9) — 五类采用者定义与意见领袖
- [Technology Dynamics: Concepts and Theories(TU Delft OCW)](https://ocw.tudelft.nl/wp-content/uploads/TDTM_L2_Technology_Dynamics_Concepts_and_Theories.pdf) — 技术决定论/SCOT/转型理论综述
- [Arthur 1989 锁定论文(SFI Press)](https://www.sfipress.org/67-arthur-1989) — 报酬递增与历史事件锁定
- [网络外部性与锁定(Stanford CS)](https://cs.stanford.edu/people/eroberts/cs201/projects/microsoft-vs-doj/economics/network.html) — 网络效应锁定机制
- [Technological Momentum(Wikipedia)](https://en.wikipedia.org/wiki/Technological_momentum) — Hughes 技术动量定义与来源
- [Space Age Stasis(TV Tropes)](https://tvtropes.org/pmwiki/pmwiki.php/Main/SpaceAgeStasis) — 停滞 trope 的常见解释清单
- [Medieval Stasis(TV Tropes)](https://tvtropes.org/pmwiki/pmwiki.php/MedievalStasis) — 中世纪停滞的叙事模板
- [Dune 技术停滞设定解析(Collider)](https://collider.com/dune-prophecy-movies-technology-explained/) — 巴特勒圣战与万年冻结的解释设计
- [Sanderson 三法则用于 GM 世界构建(LegendKeeper)](https://www.legendkeeper.com/sandersons-three-laws-of-magic/) — 设定可理解性法则
- [《技术的创新与社会的协同演化》博士论文(中国知网)](http://www.cnki.net/kcms/detail/detailall.aspx?dbcode=CDFD&dbname=CDFD2009&filename=2009110927.nh) — 中文语境的协同演化研究

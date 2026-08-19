# 笔记 99: 技术树设计与时代分期(tech-tree)

> 研究主题: 技术树设计与时代分期。

---

# 技术树设计与时代分期 —— 研究笔记

## 核心理论 (概念与原理)

1. **现象库→技术树构建法 (自底向上的组合进化)**。W. Brian Arthur 在《技术的本质》(*The Nature of Technology*, 2009) 中提出技术的**组合进化 (combinatorial evolution)**: 一切新技术都是已有技术的组合, 技术是"捕获现象 (phenomena) 并加以利用"的手段。由此可得构建法: 先为世界建立"现象库"(该世界的物理/化学/生物/社会现象清单, 如 燃烧、电解、音速、光合、货币信任), 再通过组合操作生成技术节点——`技术 = 现象 + 已有技术的组合`。这保证技术树"自底向上"生成且内部一致, 而非从效果倒推导致的凭空节点。

2. **能量-信息-组织三维分期**。时代分期可用三个正交维度刻画, 每一维都有可辨识的"载体跃迁": **能量** (人力/畜力→蒸汽/机械→电力→核能)、**信息** (语言/口传→文字/印刷→电报电话→计算机/互联网)、**组织** (部落→帝国→民族国家/科层公司→跨国公司/网络协同)。托夫勒 (Alvin Toffler) 的"三次浪潮"(农业文明/工业文明/信息文明) 与丹尼尔·贝尔 (Daniel Bell) 的"后工业社会"提供宏观分期骨架; 卡萝塔·佩蕾丝 (Carlota Perez) 在《技术革命与金融资本》(*Technological Revolutions and Financial Capital*, 2002) 中列出五次技术革命 (工业革命、蒸汽与铁路、钢铁电力、石油汽车、信息), 每次都由"通用技术+基础设施+组织范式"整体换代——这正对应"能量-信息-组织"三维同步跃迁的门槛时刻。康德拉季耶夫长波 (Kondratiev waves, 50-60 年) 与熊彼特 (Schumpeter) 的创新集群/创造性破坏 (creative destruction) 提供周期机制。

3. **通用技术 (General Purpose Technologies, GPT) 即"时代门槛"**。Bresnahan & Trajtenberg (1995) 定义 GPT: 应用面广、可持续改进、催生互补创新 (如 蒸汽机、电力、ICT)。时代门槛 = GPT 完成扩散并改写基础设施与组织形态的时刻, 而非发明瞬间。

4. **路径依赖与技术锁定 (path dependence & lock-in)**。Paul David (1985, QWERTY 键盘) 与 Brian Arthur (1989, 报酬递增/竞争技术) 证明: 小历史事件 + 递增报酬 → 次优技术被锁定。锁定来源: 沉没成本、网络外部性、学习效应、制度适配。这解释了"领先文明为何死守旧范式"与"死胡同技术为何迟迟不淘汰"。

5. **后发跳越 (leapfrogging)**。Brezis, Krugman & Tsiddon (1993, *Leapfrogging in International Competition*, AER) 的蛙跳模型: 新技术出现时, 领先者因旧技术生产率高、沉没成本大而拒绝换代, 后发者因工资低、无旧包袱而直接采用新技术, 实现领导权更替。佩蕾丝与苏特 (Perez & Soete, 1988) 称范式转换期为后发者的"机会窗口 (window of opportunity)"——后发跳越不是奇迹, 而是发生在技术-经济范式更替的特定窗口期。

## 机制与案例

- **科技树的图论机制**: 科技树是 DAG (有向无环图)。节点=技术, 边=前置依赖 (prerequisite)。设计要点: 拓扑排序保证无环、层数=时代数、关键路径决定"时代最短通关时间"。学术论文 *Technology Trees and Tools: Constructing Development Graphs for Digital Games* 系统研究了从开发图到科技树的构造算法。

- **《文明》系列实例**: 文明5 科技树 (~74 科技) 严格分层: 远古→古典→中古→启蒙→工业→现代→信息→未来, 每时代约 10-12 节点; 典型前置链如 "采矿→轮子→骑术→马术"。文明6 引入**双轨**: 科技树 (科学与生产) + **市政树** (civic tree, 制度与组织——对应"组织"维度!), 如 "法典→国家劳动力→军工传统"; 再引入**尤里卡/鼓舞 (Eureka/Inspiration)** 机制: 完成特定行为 (如"用投石车摧毁单位") 可半价加速研究。机核分析指出这是**目标导向学习 (goal-directed learning)** 的行为经济学设计: 玩家因现实行为获得科研加速, 使"研究什么"与"做了什么"互相引导, 每局路线因此不同。文明7 时代系统 (Antiquity/Exploration/Modern) 更激进: 时代结束时重置军队、基础科技免费、旧时代加成失效——模拟"范式更替"的强制机制。

- **真实史中的瓶颈节点与时代门槛**: 蒸汽机 (纽科门→瓦特分离冷凝器→高压蒸汽, 效率提升才跨越经济门槛); 炼钢 (坩埚→贝塞麦转炉→平炉→电炉, 多路径收敛); 精密钟表 (哈里森经线仪解决经度测量→远洋贸易门槛); 发电机/电动机+电网 (爱迪生直流 vs 特斯拉交流, "电流战争"= 标准之争/锁定之争); 晶体管 (贝尔实验室→硅谷, 取代真空管——一次范式替换而非路径延伸)。

- **真实史中的死胡同与冗余路径**: 死胡同——机械式电视 (贝尔德) 被电子扫描电视取代; 飞艇 (齐柏林) 被飞机取代; Betamax 录像带败于 VHS (锁定效应); 水冷计算机、铋-铅"工艺"无后继。冗余路径——铁路 vs 运河、内燃机 vs 蒸汽汽车、坩埚钢 vs 贝塞麦钢并存, 最终收敛于局部最优。**杰文斯悖论** (Jevons, 1865): 燃煤效率提升反而增加总煤耗——提示"瓶颈技术突破未必缓解资源压力"。

- **后发跳越案例**: 中国移动支付跳过信用卡阶段 (蛙跳模型当代实例, WEF 称发展中国家可借第四次工业革命窗口跳越); 非洲跳过固定电话直达移动电话; 日本明治维新直接引入西方全套工业技术。但跳越失败案例同样存在——若新范式基础设施不成熟或领先者及时换挡, 后发者会卡在"半新不旧"的中间态。

## 关键学者与著作

- **W. Brian Arthur (布莱恩·阿瑟)**: 《技术的本质》*The Nature of Technology* (2009)——组合进化、现象捕获、技术自创生; 《报酬递增与经济中的路径依赖》*Increasing Returns and Path Dependence in the Economy* (1994)。
- **Paul A. David**: "Clio and the Economics of QWERTY" (1985)——路径依赖经典论文。
- **Brezis, Krugman & Tsiddon**: "Leapfrogging in International Competition" (AER, 1993)——蛙跳模型 (克鲁格曼即 Paul Krugman)。
- **Carlota Perez (卡萝塔·佩蕾丝)**: 《技术革命与金融资本》*Technological Revolutions and Financial Capital* (2002)——五次技术革命、导入/展开两期四阶段、"安装期-转折点-部署期"。
- **Alvin Toffler (托夫勒)**: 《第三次浪潮》*The Third Wave* (1980)——三次浪潮分期。
- **Daniel Bell (丹尼尔·贝尔)**: 《后工业社会的来临》*The Coming of Post-Industrial Society* (1973)。
- **Bresnahan & Trajtenberg**: "General Purpose Technologies: Engines of Growth?" (1995)——GPT 理论。
- **Alfred Chandler (钱德勒)**: 《看得见的手》*The Visible Hand* (1977)——现代企业科层组织与交通/通讯技术的关系 ("组织"维度)。
- **Joseph Schumpeter (熊彼特)**: 《经济发展理论》(1911)——创新、创造性破坏、长波。
- **Sid Meier (席德·梅尔) 及 Firaxis**: 《文明》系列 (1991 至今)——科技树/市政树的工业级实现。

## 对虚构世界构建的启示

1. **先建现象库, 再组合生成技术树**: 写下该世界的"现象清单"(物理法则、魔法规则、物种特性、社会制度), 每个技术节点必须标注"由哪些现象+哪些既有技术组合而来"。任何无法回溯到现象库的节点都要删掉或补设定——这是世界自洽性的硬校验。
2. **用三维门槛划时代**: 每个时代用三个标志节点定义——能量 (如 驯化挽畜/蒸汽机/聚变堆)、信息 (如 文字/印刷/量子通讯)、组织 (如 城邦法典/科层官僚/跨国行会)。时代更替必须三维联动或至少有合理解释: "只有能量突破而信息组织未跟上"的时代是可行的, 但要写成张力而非漏洞。
3. **给关键节点设瓶颈, 给末端节点设死胡同**: 时代门槛技术应有"多重前置+稀缺资源+组织条件" (如 印刷术=造纸+活字+油墨+识字市场); 同时安排 2-3 个"死胡同"技术 (看似强大但无后续, 如 齐柏林飞艇、Betamax), 让世界有真实历史那种"浪费与错路", 增加考据感。
4. **保证冗余路径, 避免单一最优线**: 每个重要能力 (炼钢、远航、远程通讯) 至少给两条可到达路径, 使不同文明/种族走不同分支; 用"环境适配性"制造差异 (沙漠文明走水利分支, 海洋文明走造船分支)。游戏设计中这同时防止玩家/作者陷入"唯一解"。
5. **设计锁定与跳越的戏剧机制**: 为领先文明写"沉没成本+制度惯性" (路径依赖), 为后发文明写"范式窗口期" (新技术刚出现、旧技术未锁定的一两代人之内)。两个文明的故事张力=领先者守旧 vs 后发者跳越, 或后发者跳越失败陷入中间态。可用文明6式"时代更替重置"作为叙事节拍: 旧王朝的技术优势在范式转换时清零。
6. **技术与制度双树并置**: 参照文明6 市政树, 为世界同时绘制"技术树"与"制度树" (组织维度), 制度树节点 (如 有限责任、专利法、标准时区) 往往比技术节点更深刻地改变世界——电报改变商业, 但让电报发挥威力的是"标准时间+公司组织"。
7. **校验前置链的一致性**: 检查每个节点的前置是否覆盖物理+社会两个层面——"有电报但无电池/绝缘/标准化"、"有火枪但无冶金/火药配比/军制改革"都是常见硬伤; 拓扑排序式检查 (每个节点有完整入边) 是最廉价的自洽性审计。
8. **用"杰文斯悖论"类反直觉设计增加深度**: 突破瓶颈技术后, 世界未必更轻松——效率提升反而扩大资源消耗或引发新瓶颈 (石油时代解决煤炭瓶颈, 却创造石油地缘政治), 让时代推进带上代价与冲突。

## 来源链接

- [科技 (文明5) - 文明百科 wiki](https://civilization.fandom.com/zh/wiki/%E7%A7%91%E6%8A%80_(%E6%96%87%E6%98%8E5)) —— 文明5 科技树分层、前置依赖、时代结构的完整数据
- [文明6如何让每局科技路线都不同: 尤里卡系统与双轨科技树的行为经济学 (机核)](https://www.gcores.com/articles/215342) —— 尤里卡/市政树机制与目标导向学习分析
- [文明6科技树解锁攻略 (知乎)](https://zhuanlan.zhihu.com/p/655644882) —— 文明6 科技/市政双树逐时代节点实例
- [纸上谈兵: 拓扑排序强攻"科技树" (CSDN)](https://blog.csdn.net/dyllove98/article/details/9736391) —— 科技树 DAG/拓扑排序实现视角
- [Technology Trees and Tools: Constructing Development Graphs for Digital Games](https://gamedev.stackexchange.com/revisions/48f95e75-887f-4d22-9cc5-c1c32ea50867/view-source) —— 从开发图构造科技树的算法研究 (检索所得论文条目)
- [蛙跳模型 (百度百科)](https://baike.baidu.com/item/%E8%9B%99%E8%B7%B3%E6%A8%A1%E5%9E%8B) —— Brezis-Krugman 蛙跳模型机制概述
- [The second choice is the stage-skipping strategy (Oxford Academic)](https://academic.oup.com/book/39050/chapter/338337708) —— 后发企业追赶的三种策略与阶段跳越
- [How emerging economies can take advantage of the Fourth Industrial Revolution (WEF)](https://www.weforum.org/stories/technological-innovation/the-4th-industrial-revolution-is-a-window-of-opportunity-for-emerging-economies-to-advance-by-leapfrogging/) —— 后发经济体借4IR窗口跳越的现实案例 (移动支付等)
- [第三波 (書) - 维基百科](https://zh.wikipedia.org/zh-tw/%E7%AC%AC%E4%B8%89%E6%B3%A2_(%E6%9B%B8)) —— 托夫勒三次浪潮理论框架
- [New Wave Tofflers Explain Their Theory of Economic Evolution (Library of Congress)](https://loc.gov/loc/lcib/9509/tofflers.html) —— 托夫勒理论官方简介
- [第三次浪潮还是第五次长波 (知网)](https://wap.cnki.net/touch/web/Journal/Article/SHDS198901002.html) —— 托夫勒分期与康德拉季耶夫长波的关系辨析
- [Path Dependence and QWERTY's Lock-In: Toward a Veblenian Interpretation (PDX)](http://pdx.edu/sites/www.pdx.edu.econ/files/JEI-JUNE-2011-pp-457-464%20.pdf) —— QWERTY 锁定的学术综述与拓展
- [Path Dependency 概念溯源 (CBS Research)](https://research.cbs.dk/files/58442707/jacob_lennheden.pdf) —— 路径依赖概念的 1980s 起源与 David/Arthur 贡献
- [给独立游戏制作人的进阶建议 (GameRes)](https://www.gameres.com/905557.html) —— 独立游戏科技树/技能树设计经验谈

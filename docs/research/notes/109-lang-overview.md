# 笔记 109: 语言总流程与接口(lang-overview)

> 研究主题: 语言总流程与接口。

---

## 核心理论 (概念与原理)

1. **语言是分层系统, 不是单词表**。一门语言由音系(phonology: 音位清单、音位配列 phonotactics、音节结构、重音)、形态/构词(morphology)、句法(syntax)、词汇-语义层构成。造语言必须自底向上(音系→构词→句法→词汇), 任何一层缺失都会在命名与文本中露馅。世界构建中的语言按目标分三类: 命名语言(naming language)、完整艺术语言(artlang)、实验/逻辑语言(engelang)——工作量相差一到两个数量级, 须先定角色再动手。

2. **语言的"有机性"原则**。David J. Peterson 的核心主张: 不存在完全规则的自然语言——真实语言充满不规则、空缺、借用与冗余; 语言是活的, 随使用者、时间、接触而变。因此"过度规则"本身就是错误信号, 规则与例外要成对出现。

3. **音系先行原则**。音位清单决定语言"长什么样", 且是其他一切模块的约束源: 人名、地名、咒语、借词、文字都要在音系内自洽。Peterson 在《The Art of Language Invention》中反复强调: 先定语音审美(如多罗色克语的多喉音、多拉克语的 r 音), 再谈其他。

4. **语法类型学作为快速定骨工具**。用 Sapir 的形态类型(孤立/黏着/屈折/多式综合)与 Greenberg 的语序共性(SOV 与后置词相关、VSO 与前置词相关等)可在几分钟内定出语言骨架, 使语言彼此区分且自洽。

5. **语言史 = 历史语言学**。谱系树模型(Stammbaum, Schleicher)解释"祖语→女儿语"的裂变; 波浪模型(Wave Theory, Schmidt)解释方言连续体扩散; 青年语法学派(Neogrammarians, 1870s)主张"音变规律无例外", 是设定历史音变的理论根基; Swadesh 核心词表与词汇统计学(glottochronology, 每千年约 14% 核心词替换)给出估算分化时间深度的工具。

6. **地理 = 方言连续体与语言地图**。地理语言学(geolinguistics)研究语言分布与地形、迁徙、政体的关系: 山脉/海洋阻隔产生分化, 平原与商路产生趋同; 等语线(isogloss)画出特征边界; 语言地图(linguistic cartography)是世界构建"地理语言地图"模块的理论原型。

7. **文字是独立于语音的平行系统**。文字类型(语素文字/音节文字/abjad/abugida/字母文字, 见 Daniels & Bright 分类)与正字法深度(浅: 音形一致; 深: 如英语)决定"拼写与发音脱节"这一真实世界常见现象的成因——这为"古文字/神圣文字"提供了现成机制。

8. **语言即社会分层**。社会语言学概念: 双言制(diglossia, Ferguson 1959)中高变体(宗教/文学/官方)与低变体(日常口语)并存——这正是"魔法语言 vs 日常语言"、"祭司古语 vs 民众土语"的学术原型。

## 机制与案例

- **命名语言机制 (Naming Language)**。Peterson 的做法: 为一族文化只做"迷你语言"——一套音系 + 少量构词规则 + 约 150–300 核心词, 用于生成人名、地名、器物名与咒语; 代表作是《权力的游戏》系列(Dothraki 为完整语言, 而瓦雷利亚语族的众多变体为命名级)。Sarah Higley 的博客《Conlanging for Beginners: Building a Naming Language》给出小说作者的最小可行流程。

- **语言家族派生机制 (Family Tree)**。流程: 设计祖语 → 声明若干条音变规则(仿 Grimm 定律式链式音变)→ 对祖语词表施加规则 → 得到女儿语, 再让两支各自变化 → 得到兄弟语言。conlang.stackexchange 的 "how can one make a conlang family tree?" 与油管 Biblaridion 的 "Conlang Case Study" 系列是标准示范。托尔金是此机制的鼻祖: 《语言录》(The Lhammas, 发表于 The Lost Road)是一份虚构的社会语言学文献, 记载精灵语谱系与变迁, 直接服务于中土地理与历史。

- **真名魔法机制 (True-Name Magic)**。理论基础是言语行为理论(Austin《How to Do Things with Words》1962: 以言行事/performative)——咒语本质是"以言改变世界"。经典案例: Le Guin《地海巫师》(Earthsea)万物皆有其真名、掌握真名即掌握权力; Rothfuss《风之名》的命名术; TV Tropes "Language of Magic" 归纳的常见子类型(神圣古语、真名、禁忌语、语言即真实)。设计要点: 魔法语言须与日常语有明确接口(古语层/借词层/禁忌语), 而非随机咒语。

- **语言档案机制 (Documentation)**。参考 MIT OCW 24.917《ConLangs: How to Construct a Language》期末项目与 FrathWiki "Conlang Documentation"、Fiat Lingua(虚构语言学术期刊)的论文结构: 音系表(IPA)、构词与句法纲要、核心词汇表、文字系统、两段带 Leipzig 标注的样例文本, 外加谱系树与语言地图。这是"语言档案应包含什么"的直接答案。

- **文字滞后案例**。英语拼写在大元音转移(Great Vowel Shift)后冻结, 造成拼读脱节; 汉语文言/官话的双言制对应"神圣书面语 vs 口语"。世界构建可照此解释: 帝国古文字不变、口语已漂移, 祭司念古语、民众说土语——一举解决"魔法语言哪里来"的合理性。

## 关键学者与著作

- **J.R.R. Tolkien** (托尔金): *A Secret Vice* (1931 讲座, 论人造语言); 《语言录》Lhammas; 名言"故事从语言中生长出来"——语言是世界构建的引擎而非装饰。
- **Mark Rosenfelder**: *The Language Construction Kit* (1995/2016)、*Advanced Language Construction*、zompist.com——最系统的自助教程, 含音系、构词、历史演变的实操模板。
- **David J. Peterson**: *The Art of Language Invention* (Penguin, 2015)——Dothraki/Valyrian 作者, 主张语言有机性、命名语言工作法、以文化反推语言。
- **Suzette Haden Elgin**: Láadan(1982 创立的女性主义语言)与 *Native Tongue* 系列——语言作为政治与世界观载体的范例。
- **Ursula K. Le Guin**: *A Wizard of Earthsea* (1968)、*The Language of the Night*——真名魔法的文学范本。
- **Arika Okrent**: *In the Land of Invented Languages* (2009)——人造语言史的学术综述。
- **Jeffrey Punske**: *How to Create a Language* (Cambridge University Press, 2020)——把语言构造写进语言学教学大纲的教材。
- **历史语言学**: August Schleicher(谱系树)、Johannes Schmidt(波浪模型)、青年语法学派(音变无例外)、Morris Swadesh(核心词表/词汇统计学)。
- **地理语言学**: Roland Breton《Geolinguistics: Language Dynamics and Ethnolinguistic Geography》(1991); American Society of Geolinguistics(1965, Mario Pei 创办)。
- **文字**: Peter T. Daniels & William Bright, *The World's Writing Systems* (1996)。
- **语言接触**: Thomason & Kaufman, *Language Contact, Creolization, and Genetic Linguistics* (1988)——借用 vs 继承的区分, 供设定"征服者的语言残留"。

## 对虚构世界构建的启示

1. **开工前先写"语言角色清单"**: 列出世界需要的每门语言及其级别(命名级/完整级/仅词汇级)、使用者、功能(日常/官方/宗教/魔法)。这直接控制总工作量, 防止"每族都做完整语言"。
2. **音系先行, 其余皆受其约束**: 为每个文化建一张音位表+配列规则; 人名、地名、咒语、借词一律从表内生成; 可用词汇生成器批量产出并人工筛选。
3. **词汇按"Swadesh 100 核心词→文化域词汇→专有词"三层扩展**, 文化域(农业/战争/航海/宗教)词汇必须与文明设定对齐; 敬语、禁忌语、咒语词单独建域。
4. **建立谱系树与语言史时间轴**: 祖语→音变→女儿语; 用词汇统计学粗定分化年代; 每支语言标注"诞生时代、主要音变、借用来源"——历史模块直接由它供给。
5. **命名规则独立成档(onomastics)**: 人名、地名、称号各一条生成规则, 且只用本语言音系; 明确禁止跨语言混用(同一文明不得混入另一语系的词汇)——这是最常见的返工源。
6. **为魔法/神圣语言设"双言制"接口**: 用"古语高变体 vs 口语低变体"解释咒语、真名、仪式的来源; 若真名魔法存在, 让"名字"在语言史中有据可查(如名字随音变漂移, 真名保留古音)。
7. **语言地图与地理联动**: 语族分布须与山脉、海、迁徙路线、征服史一致; 平原上画方言连续体, 山区画碎裂语言带。
8. **建立检查点清单**: ①每语言有音系文档 ②命名只用本语言音系 ③谱系可追溯 ④地图与迁徙一致 ⑤每语言至少一段带标注文本 ⑥魔法语与日常语接口明确 ⑦无跨语言串味。每完成一个模块跑一次清单。

## 来源链接

- [The Art of Language Invention (Peterson, 2015) — 出版信息与书评](https://publishersweekly.com/9780143126461) — 核心论点: 语言有机性、世界构建背后的词汇
- [MIT OCW 24.917: ConLangs: How to Construct a Language — 期末项目要求](https://ocw.mit.edu/courses/24-917-conlangs-how-to-construct-a-language-fall-2018/pages/assignments/final-project/) — 语言档案/语法纲要的标准结构
- [FrathWiki: Conlang Documentation](https://www.frathwiki.com/index.php?title=Conlang_Documentation&oldid=173442) — 社区公认的 conlang 文档化模板
- [Conlanging for Beginners: Building a Naming Language (Termite Speaker 博客)](http://termitespeaker.blogspot.com/2012/11/conlanging-for-beginners-building.html) — 命名语言最小可行流程
- [How can one make a conlang family tree? (conlang.stackexchange)](https://conlang.stackexchange.com/questions/2330/how-can-one-make-a-conlang-family-tree) — 谱系树与历史音变操作问答
- [Lhammas (Wikipedia, 托尔金虚构社会语言学著作)](https://en.m.wikipedia.org/wiki/Osanwe-kenta) — 语言谱系作为世界构建文献的范本
- [Geolinguistics (Wikipedia)](https://en.wikipedia.org/?curid=4675457) — 地理语言学: 语言分布、方言与地图理论
- [Words on a Map: The Cartography of Language (美国国会图书馆博客)](https://blogs.loc.gov/maps/2022/02/words-on-a-map-the-cartography-of-language/) — 语言地图的制图实践
- [Language of Magic (TV Tropes)](https://tvtropes.org/pmwiki/pmwiki.php/Main/LanguageOfMagic) — 真名/神圣语言/魔法语符码的常见子类型归纳
- [A Common Conlanging Pitfall (makealang.blogspot.com)](http://makealang.blogspot.com/2007/11/common-conlanging-pitfall.html) — 过度规则化陷阱的典型讨论
- [Fiat Lingua: 虚构语言学术期刊 (PDF 论文)](https://fiatlingua.org/wp-content/uploads/2024/12/fl-000101-00.pdf) — 完整 conlang 论文的分析框架
- [How to Create a Language (Cambridge University Press, Punske)](https://www.cambridge.org/highereducation/books/how-to-create-a-language/6C38A17D8FDA78DA91D122DC83B7FBF2) — 把 conlang 构造作为语言学课程的教材

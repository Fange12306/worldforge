# 笔记 113: 词汇与语法设计(lang-lexicon)

> 研究主题: 词汇与语法设计。

---

# 主题块 5 研究报告:词汇与语法设计

## 核心理论 (概念与原理, 分点)

**1. Swadesh 核心词表:基本词汇的稳定性与筛选功能**
- Morris Swadesh 于 1952 年发表 200 词表、1955 年定稿 100 词表;100 词表剔除了易被借词替换的文化词(如"雪""盐"), 保留代词、身体部位、亲属等泛文化词项, 因此更稳定。
- 理论基础是"词汇统计年代学"(glottochronology):假设核心词替换率近似恒定(约 14%/千年), 用同源词保留率反推语言分化年代。
- 现代共识:替换率受文化、环境、接触影响而波动(Dixon 的批评), 词表现在只作为"基本词汇采样器", 不用于精确断代。
- 稳定性梯度:人称代词、身体部位、亲属、数字 1-2、日月水火最稳; 文化器物与低频词最易替换。Trask 的 207 词表(已收入 Concepticon)在 100 词基础上增补环境、动作、状态词。

**2. 语义场与词汇扩展**
- 词汇按语义场(亲属、色彩、身体、情感、技术等)组织;Berlin & Kay 的色彩词等级序列(黑/白→红→黄/绿/蓝→……)说明场内词项按"演化阶梯"逐级增加, 不是随机堆叠。
- 扩展机制:隐喻(身体部位→空间/抽象, 如"头"→顶端、首领)、转喻(容器→内容、工具→职业)、语义漂移(变宽/变窄)、词义攀升(委婉化)。

**3. 派生、屈折与词汇家族**
- 派生(derivation)创造新词位并可改变词类;屈折(inflection)表达时/格/数等语法范畴而不造新词;二者是连续统(如英语 -ing)。
- 词汇家族:一个词根加一组派生词缀构成网络(如 scrib-:describe/script/scribble), 构词手册应逐条记录派生路径与语义变迁。
- 词缀分层:能产词缀(可自由造新词)与化石词缀(残存于少数词, 如 warmth 的 -th)并存, 这是自然语言常态。

**4. 借词分层与音系适配**
- 借词按历史接触期分层(英语的拉丁/希腊→北欧→法语→全球各层), 每层对应不同语义域与音系特征, 是"地层学"式的语言史证据。
- 音系适配(nativization):借词被强制改写以符合借入语音系——音段替换、增音(日语外来词插入元音)、删音、重音规则化;也可故意保留"外来层"发音作社会/文体标记。
- 借词语义常收窄或移位;高频核心词几乎不被替换, 这是判断"哪些是借词"的关键线索。

**5. 语法特色:作格、名词类、证据性、自由语序**
- 作格(ergative-absolutive):不及物主语 S 与及物宾语 P 同格(绝对格), 及物施事 A 用作格;见于巴斯克语、Dyirbal、玛雅诸语。分裂作格(Dixon 1994)按人称/有生层级(一、二人称更倾向主宾格;Silverstein 施事层级)、时体(过去时易作格)或从句类型分裂。
- 名词类/性:名词划入互斥类别并触发一致关系;语义核心(性别、有生性、形状、功能)配形式规则;斯瓦希里语有十余类(ki-/vi-), 规则从语义主导到形式主导连续变化(Corbett 1991;Aikhenvald & Mihas 2022)。
- 证据性(evidentiality):语法化的信息来源范畴, 五大类——视觉直接、非视觉感官、推断、假定、传闻;Tariana 等语言每句必标, 多数语言用词汇/语篇策略(土耳其语 -miş 兼表传闻与推断)。
- 自由语序:语序自由度与格标记丰富度负相关;真正"自由"的语序服务于话题、焦点、已知信息等语用功能, 绝非随机排列。

**6. 语序与格系统联动**
- Greenberg 普遍性(1963):SOV 谐和后置词与"属格-名词"序(U-3/4/5), SVO 谐和前置词;Dryer(1992)以全球大样本证实"分支方向谐和":OV 语言修饰语前置, VO 语言修饰语后置。
- 格系统谱系:主宾格、作通格、三分制(施事/受事/不及物各一)、施受格(active-stative, 如格鲁吉亚语、Guarani);格弱化常与语序固定化同步(英语史)。
- 标记位置:依附标记 vs 从属标记(head-marking, Nichols 1986);美洲语言多从属标记, 决定格/一致形态落在哪一端。

**7. 自然 vs 人工的平衡**
- 自然语言的不规则是同音、语义漂移与声音演变的"历史残留"(Bybee:高频词更易磨损、更易保留不规则);人造语言天然过度规则。
- 自然主义 conlang 的做法:先设原始形式, 再施加历史音变与形态合并, 让不规则"有来源";同音词按需制造, 但歧义密度须可控。

## 机制与案例 (机制细节, 经典案例)

- **Swadesh 词表机制**:100 词表从 200 词表筛掉易借文化词, 保留代词/身体/亲属;Long Now 罗塞塔项目用 207 词表存档全球语言, 是词表作"活语言采样器"的现代案例。
- **作格机制**:Dyirbal 是"句法作格"——不仅格位作格化, 关系从句也按 S/P 合并运作;巴斯克语名词短语有格变化而动词保持主宾一致, 形成"形态作格+句法主宾格"的混合。格鲁吉亚语按时体分裂作格(现在时主宾格、过去时作格), 是虚构语言"部分作格"的现成模板。
- **名词类机制**:斯瓦希里语 m-/wa- 类管人类、ki-/vi- 类管工具与语言, 类前缀同时标记单复数, 使"类"与"数"纠缠;日语"类义量词"(本/枚/匹)是从语义场生成分类系统的当代实例。
- **证据性机制**:Tariana 语(Tucanoan 语系, Aikhenvald 田野材料)每句动词必须标注信息来源;保加利亚语把"见证过去时"语法化。设定"崇尚实证"的文明, 可让视觉直接证据成为强制范畴。
- **语序谐和案例**:日语/土耳其语(SOV+后置词+属格前置于名词)与汉语(SVO+前置词)各自谐和;WALS 大样本统计显示 SOV 语言约半数使用格标记, SVO 语言更依赖语序本身区分角色。
- **构词案例**:德语无界复合(Handschuh "手套"), 英语向心复合(blackbird)与离心复合(redhead);拉丁词根 scrib- 在英语中的词族反映历时借词的多层沉积。
- **conlang 案例**:Dothraki(Peterson)用动词形态层与不规则复数制造"活语言感";Klingon(Okrand)以 OVS 语序+作格标记制造外星异质感;Na'vi(Frommer)结合名词类前缀与证据性策略——三者是"特色语法"不同程度的极端示范。

## 关键学者与著作 (人名/书名/观点, 中文+英文)

- **Morris Swadesh** —《Lexico-statistic Dating of Prehistoric Ethnic Contacts》(1952) 提出 200 词表与词汇统计断代法。
- **Robert M. W. Dixon** —《Ergativity》(1994) 作格与分裂作格研究权威;《The Rise and Fall of Languages》(1997) 批评恒定替换率假设, 提出"punctual equilibrium"式语言演变观。
- **Alexandra Y. Aikhenvald** —《Evidentiality》(2004) 证据性类型学圣经;与 Dixon 合编《The Grammar of Knowledge: A Cross-Linguistic Typology》(2014);与 Elena Mihas 合编《Noun Class and Gender Systems》(2022)。
- **Joseph H. Greenberg** —《Some Universals of Grammar with Particular Reference to the Order of Meaningful Elements》(1963) 语序普遍性奠基之作。
- **Matthew S. Dryer** —《The Greenbergian Word Order Correlations》(1992);《WALS》(与 Martin Haspelmath 主编, 2013) 语序与特征数据。
- **Greville G. Corbett** —《Gender》(1991)、《Number》(2000) 名词类与一致系统理论。
- **Johanna Nichols** —《Head-Marking and Dependent-Marking Grammar》(Language, 1986) 标记位置类型学。
- **Joan L. Bybee** —《Morphology》(1985)、《Language Change》(2015) 以频次效应与语言演变解释不规则形态。
- **Michael Silverstein** — 施事层级 Hierarchy of Animacy(1976), 解释分裂作格的分布。
- **虚构语言实践者** — David J. Peterson《The Art of Language Invention》(2015, Dothraki);Marc Okrand《The Klingon Dictionary》(1985);Paul Frommer(Na'vi);Mark Rosenfelder《The Language Construction Kit》(1999)。
- **参考数据库** — WALS(语法特征跨语言库)、Concepticon(clld 词表概念库)可作词汇与特征选型依据。

## 对虚构世界构建的启示 (具体指导)

1. **先定"语法签名"**:从作格、名词类、证据性、自由语序中选 1-2 项深度做(如"作格+证据性"组合), 写成完整规则页;其余语法采用典型类型, 防止特征堆砌导致不自然。
2. **词汇库三层建设**:①100-207 核心词全自创、形态尽量简单、高频词允许不规则;②从 20-30 个词根辐射出词汇家族, 定 10-15 个能产词缀并配派生规则;③借词按文明接触史分层, 每层配一套音系适配规则(如"精灵语借词保留长元音, 人类语借词增音填音节")。
3. **用"演变脚本"生成不规则**:写 3-5 条历史音变规则(元音链移、词尾辅音脱落等), 手工套用到高频词, 得到有词源依据的不规则动词/复数/属格, 而非随机乱造。
4. **语序与格联动设计**:选定主序后按谐和原则推副序(SOV→后置词+属格前置);若做自由语序, 必须配套话题/焦点标记与语用规则, 并说明格系统如何分担语义角色。
5. **语义场扩展清单化**:按色彩等级阶梯、亲属系统(可做 Dravidian 式二分亲属)、身体→空间隐喻等路径逐场扩展, 每新增一词记录"词源+构词路径", 汇成词源词典。
6. **借词层写入世界史**:每层借词对应一个文明接触期, 借词方向即权力/文化关系;区分征服层、宗教层、科技层的借词域(参照中世纪英语的法语层)。
7. **控制同音歧义密度**:每百词制造 1-3 个同音/多义词增强自然感, 但保证语序、助词、话题标记等语境消歧手段存在;可让"神名/禁忌词"触发同音回避(taboo avoidance)作叙事钩子。
8. **产出三份配套文档**:音系规则手册、构词/词缀手册、词源与借词词典, 保证后续创作中词汇与语法高度一致。

## 来源链接

- [斯瓦迪士核心词列表(中文维基)](https://zh.wikipedia.org/zh-sg/%E6%96%AF%E7%93%A6%E8%BF%AA%E5%A3%AB%E6%A0%B8%E5%BF%83%E8%A9%9E%E5%88%97%E8%A1%A8):Swadesh 词表发展史、100 与 200 词表差异及词项举例。
- [ComparaLex: Swadesh 200 词表(1952)](http://www.comparalex.org/index.php?page=stdlist&id=14):1952 年 200 词表的标准化词项清单。
- [SIL: Swadesh 100/200 词表在苏语语料上的应用](https://www.sil.org/system/files/reapdata/16/54/72/165472610083229010708881180686758760171/Martens_1989_Swadesh_100_and_200_wordlists_on_the_SUW_CONFORMING_COPY.pdf):词表实用化与比较方法示例。
- [Christian Lehmann: Basic Vocabulary](https://christianlehmann.eu/ling/ling_meth/ling_description/lexicography/basic_vocabulary.html):基本词汇的选取原则与稳定性讨论。
- [Concepticon: Trask-1996-207 词表](https://concepticon.clld.org/values/Trask-1996-207-194):207 词表在现代词表库中的概念条目。
- [Long Now: Rosetta 项目重启用 Swadesh 数据](https://longnow.org/ideas/swadesh-list-data-now-re-enabled-in-rosetta-internet-archive-collection/):词表用于全球语言存档的实践案例。
- [EPFL 知识图谱: Ergative-absolutive alignment](https://graphsearch.epfl.ch/en/concept/604771):作格-绝对格对齐的概念定义与相关条目。
- [MITWPL: On the Nature of Ergativity](http://mitwpl.mit.edu/catalog/levi01/):作格性质的生成语言学讨论。
- [OUP: Ergativity and Its Typological Variation](https://preview.academic.oup.com/book/48089/chapter-abstract/421261466):作格类型学变异的学术章节。
- [Aikhenvald《Evidentiality》出版说明(LOC)](https://catdir.loc.gov/catdir/enhancements/fy0627/2005295896-d.html)与 [OUP 章节页](https://academic.oup.com/book/51161/chapter-abstract/):证据性类型学框架与五大类划分。
- [Aikhenvald & Dixon《The Grammar of Knowledge: A Cross-Linguistic Typology》](https://books.google.com.sg/books?id=J9PYAgAAQBAJ):知识来源语法化的跨语言类型学。
- [OUP: Noun Class and Gender Systems 章节](https://academic.oup.com/book/48233/chapter-abstract/421308633):名词类与性别系统类型学。
- [Oxford Research Encyclopedia: Gender](https://oxfordre.com/linguistics/display/10.1093/acrefore/9780199384655.001.0001/acrefore-9780199384655-e-43):性的一致属性与典型特征。
- [Zenodo: 基于 WALS 数据的格标记与语序关系分析](https://zenodo.org/records/7976256):大样本统计 SOV/SVO 与格标记的相关性。
- [Christian Bentz: Does SOV-order favor case marking?](http://www.christianbentz.de/TypoSS2017/Project10_WordOrderCase.pdf):SOV 语言倾向格标记的假设与检验。
- [Conlang StackExchange: How to "Naturalize" a Conlang](https://conlang.stackexchange.com/posts/471/revisions):自然主义 conlang 的实操技巧(历史演变、不规则来源)。
- [Conlang StackExchange: What verbs should be irregular in a naturalistic conlang](https://conlang.stackexchange.com/feeds/question/866):高频动词不规则现象及其成因。
- [All Things Linguistic: David Peterson 谈 Dothraki 与 conlang 设计](https://allthingslinguistic.com/tagged/dedalvs):Dothraki 形态设计的创作者视角。
- [Fiat Lingua: 有计划语言的规划过程分析](https://fiatlingua.org/wp-content/uploads/2024/12/fl-000101-00.pdf):多种人工语言规划策略的比较研究。"
  },
  "failed": []
}

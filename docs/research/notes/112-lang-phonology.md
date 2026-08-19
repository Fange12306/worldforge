# 笔记 112: 音系与书写系统设计(lang-phonology)

> 研究主题: 音系与书写系统设计。

---

## 核心理论

**1. 音位清单:自然范围、"对称+空洞"与标记性**
- 人类语言音位总数约 11–141,常见中位数约 25–35 (UPSID 数据库,Maddieson 1984)。"辅音 20–40 + 元音 5–10"恰好落在自然范围,可直接采用,不必刻意求怪。
- 元音系统类型学倾向极强:三元音 /i a u/ (阿拉伯语、因纽特语) 与五元音 /i e a o u/ (西班牙语、日语、夏威夷语) 最普遍,七元音以上即属复杂;元音与辅音数量存在弱的负相关。
- 标记性 (markedness,Trubetzkoy 布拉格学派):无标记音 (p t k、m n、i a u) 跨语言最常见;有标记音 (挤喉音、边擦音 ɬ、咔哒音、咝音浊对) 少见、习得晚、易在历史中失落。虚构语言中的"奇音"应少而精,并配备"孤儿音"解释其来源。
- 音系经济性 (symmetry):真实清单是"发音部位×发音方法"的对称矩阵,但允许空洞 (gap),如英语无 /p/ 的对应送气对、日语缺 /l/ 与 /f/。空洞是历史音变的化石,是给世界造史的天然抓手。

**2. 音位配列与音节结构**
- 所有语言都有 CV 音节 (最基础结构),复杂度从纯 CV (波利尼西亚语、日语) 到重辅音丛 (英语 CCCVCCCC、格鲁吉亚语六连辅音)。响度序列原则 (Sonority Sequencing Principle,Clements 1990) 约束音节内排列:响度向音节核递增。
- 配列约束本质是"位置性"的:哪些辅音可作首/尾、哪些可相邻 (英语禁 /tl/ 起首、禁同部位塞音相邻)、同化规则 (鼻音同化:/n/ 在 /k/ 前→/ŋ/)。设定两三组"允许/禁止"即可获得系统感。
- 音节重量与韵律:长元音与闭音节为"重",与重音/声调位置联动;日语是"拍" (mora) 语言而非音节语言。设计"轻重如何影响重音或调位"是一个高性价比参数。

**3. 声调语言设计 (2–6 调)**
- 声调类型学 (Yip 2002):平调系统 (2–3 平调,如西非与拉达克语) 对曲折调系统 (泰语 5 调、粤语 6 调、苗语 8 调);调值用赵元任五度制记写。设定 2–6 调均自然,关键是调型分布要有"几何感"(高低相间、曲折调不扎堆)。
- 发声态叠加:越南语、吴语、苗语以气声/嘎裂声叠加于声调;语音学普遍倾向是"低调伴嘎裂声"。这是给"低沉威严"文明加戏的现成机制。
- 变调 (tone sandhi):语境触发调值变化,经典如普通话 T3+T3→T2+T3、闽南语"除末音节全变"的连锁变调。方向性 (左向/右向扩散) 是可设定的参数。
- 声调发生 (tonogenesis,Matisoff 1973):声调可"从无到有"——① 声母清浊对立丢失→高低调分裂 (藏语、汉语"平分阴阳");② 韵尾 -ʔ 丢失→升调、-h 丢失→降调 (Haudricourt 1954 的越南语三阶段经典);③ 前缀丢失。研究还显示声调语言倾向较简单的音节结构 (少复辅音)。

**4. 书写系统六类型 (Daniels & Bright 1996) 与各自气质**
- 字母 (alphabet):辅元音均为独立字符 (希腊、拉丁、西里尔)——气质:平民化、识字门槛低,与印刷革命、宗教改革、民主传播绑定。
- abjad 辅音音素文字:只写辅音,元音靠推断 (阿拉伯、希伯来)——气质:辅音骨架承载词根,书法神圣化 (伊斯兰书法美学)。
- abugida 元音附标:基础字符=辅音+固有元音,其他元音用附标 (天城文、泰文、吉兹文)——气质:随佛教东传而扩散,宗教传抄性强。
- 音节文字 (syllabary):一字一音节 (日文假名、切罗基文)——气质:门槛低、贴近口语,适合记录民歌、私信与物语。
- 语素文字 (logographic):一字一语素/词 (汉字、楔形、圣书体)——气质:识字成本高→精英垄断、跨方言统一、经典权威。
- 特征文字 (featural):字形编码语音特征 (谚文:塞音字母象形发音器官)——气质:"理性王权为民造字"的启蒙叙事。

**5. 文字演化路径**
- Gelb (1952) 的"图画→音节→字母"单线论已被否定 (辅音文字先于字母即反例),但"象形→表音"的总趋势成立:象形 → 假借 (rebus:同音符号表音) → 形声 (声符+义符/限定符) → 楷化 (笔划规范简省)。
- 楔形、圣书体、汉字独立走过同一条路:苏美尔以图画符表同音音节并加限定符消歧;汉字经六书 (象形/指事/会意/形声/假借/转注) 定型,现代常用字 80% 以上为形声字。
- 字母"单次起源、多次传播":腓尼基 22 个 abjad 字母 → 希腊人加元音 → 拉丁/西里尔。谚文 (1443,世宗《训民正音》) 与切罗基文 (Sequoyah,1820s) 是文献可考的"个人创制",是虚构世界造字英雄叙事的模板。
- 一般原则:字符数趋向经济 (数千语素字→五十假名→二十余字母)、持续表音化、模糊性 (歧义) 驱动改革 (Fortuny 2019)。

## 机制与案例

- 音系极端案例:夏威夷语 8 辅音+5 元音 (长短对立、纯 CV);Rotokas 11 音位 (6 辅音);高加索 Ubykh 语 78–84 辅音、元音仅 2–3;!Xóõ 110+ 辅音 (大量咔哒音)。"冰川蛮族用密集挤喉音+清塞音"可仿美洲西北海岸语言,"海上贸易族用简单 CV+多元音"可仿波利尼西亚。
- 变调案例:普通话 T3 变调 (可教、可感知);闽南语全词除末尾外一律变调;天津话复杂到出现"循环变调"。虚构语言定 1–2 条规则即可,不必全系统。
- 声调发生案例:越南语 (塞尾 -ʔ 丢→升调、-h 丢→降调、浊声母→低域);汉语 (平分阴阳、浊上变去、入派三声);藏语 (浊声母清化→高低调)。每个调都能写"出生证明"。
- 书写分层案例:日语汉字+平假名+片假名三系统并用 (假名分别源自汉字草书与部件);埃及圣书体分神职体/僧侣体/世俗体;楔形文字为 600+ 字符的"语素+音节"混合。虚构世界可设"神圣古体 vs 世俗简体"双轨。
- 假借→形声案例:汉字"其"(簸箕象形→假借为代词)、"来"(麦子→动词"来");圣书体的单辅音符号实为字母雏形——"最古老文字里藏着最现代文字的种子",是极好的世界细节。

## 关键学者与著作

- Peter T. Daniels & William Bright (eds.), *The World's Writing Systems* (1996):六类型分类与 abjad/abugida 术语的奠基之作。
- Ignace Gelb, *A Study of Writing* (1952):文字演化单线论,开创学科后被修正。
- Geoffrey Sampson, *Writing Systems* (1985);Henry Rogers, *Writing Systems: A Linguistic Approach* (2005);Amalia Gnanadesikan, *The Writing Revolution* (2009):类型学教科书。
- 裘锡圭《文字学概要》(Qiu Xigui, *Chinese Writing*):汉字六书与演化;许慎《说文解字》;《训民正音》(1446)。
- Ian Maddieson, *Patterns of Sounds* (1984):UPSID 音位数据库;Ladefoged & Maddieson, *The Sounds of the World's Languages* (1996)。
- N.S. Trubetzkoy, *Grundzüge der Phonologie* (1939):音系对立与标记性。
- Moira Yip, *Tone* (2002):声调类型学标准教材;Larry Hyman:声调类型学与"声调非必需"论证;Zhiming Bao, *The Structure of Tone* (1999):调型内部结构。
- André-Georges Haudricourt, "De l'origine des tons en vietnamien" (1954):声调发生奠基;James Matisoff, "Tonogenesis in Southeast Asia" (1973):提出 tonogenesis 一词。
- 高本汉 (Bernhard Karlgren) 中古音构拟;王力《汉语音韵学》。

## 对虚构世界构建的启示

1. **气质决定音系参数**:先定义文明的"听觉气质"再填表——飘渺精灵:纯 CV、五元音、无清浊对立、几乎无辅音丛;重权矮人:大辅音库 (挤喉音、清浊满格)、闭音节为主、低调多嘎裂声;航海商族:音节简单、元音对立丰富 (便于远距离喊话)。用"对称矩阵+1–2 空洞"落成表格,空洞即传说("古语 /g/ 已亡,借词仍带 /g/")。
2. **让音节结构派生文字类型**:纯 CV→音节文字或 abugida;重辅音丛→字母文字;辅音词根型→abjad;单音节孤立语→语素文字。先定音系,文字顺理成章,避免"CV 语言配 abjad"的违和。
3. **给每个声调写"出生证明"**:设计声调发生史 (如"第 4 调来自古 -ʔ 尾脱落""第 2 调来自浊声母清化"),再定 1–2 条变调规则 (如"低调遇低调变高调"),让对话中的声调变化可被读者感知,语言瞬间"活"起来。
4. **按"假借→形声→楷化"写文字编年史**:四阶段各配一个历史事件——图画记事时代 → 同音假借引发的歧义危机 → 限定符/形声字正字 → 某王统一文字时楷化简省。每阶段都在世界上留下物质遗迹 (碑铭用古体、法典用新体)。
5. **用文字分层塑造社会结构**:设"神圣古体+世俗简体"双轨 (仿埃及三体、日语三系统):祭司/贵族垄断语素古体 (神秘、排他),民间流行简化音节字 (开放、通俗)。这直接决定识字率、书籍形态、教育与权力分配。
6. **媒介决定形态**:泥板 (楔形、笔画刚硬)、竹简 (直排)、纸莎草 (草书化)、石碑 (庄严正体)——让书写方向与字体演变绑定材料;碑铭用古正体,私信用连笔草体,一页设定兼得真实感与美学。
7. **允许"不完美"**:真实文字满是同音字、多音字、历史遗留不规则 (英语拼写、汉字音读训读)。给虚构文字留 5% 的历史残留与一场"正字法改革之争",是廉价而高质的真实感来源。

## 来源链接

- [Daniels & Bright《The World's Writing Systems》全文 (Internet Archive)](https://archive.org/details/worldswritingsys0000unse_v1k3) — 六类型分类与 abjad/abugida 术语来源。
- [Graphic complexity in writing systems (Cognition, 2021)](https://www.sciencedirect.com/science/article/pii/S0010027721001906) — 六类型定义与复杂度比较,引用 Daniels & Bright。
- [Language Typology (ScienceDirect)](https://www.sciencedirect.com/topics/social-sciences/language-typology) — Gelb"语素→音节→字母"单线演化论及其修正。
- [Fortuny, "Ambiguity and the creation and evolution of writing systems"](http://faculty-sgs.tama.ac.jp/terry/awll/WS/15/D2S7O17A.pdf) — 歧义压力驱动文字演化的建模。
- [Hongyuan Dong, *A History of the Chinese Language* 汉字章 (Taylor & Francis)](https://www.taylorfrancis.com/chapters/mono/10.4324/9780429264665-11/chinese-writing-system-hongyuan-dong) — 六书、形声字比例、汉字演化路径。
- [Logogram/Lexigraphy (Wikipedia)](https://en.m.wikipedia.org/wiki/Lexigraphy) — 语素文字与"语素-音节混合文字" (logosyllabic) 概述。
- [Oxford Bibliographies: Tone (Bert Remijsen)](https://www.oxfordbibliographies.com/display/document/obo-9780199772810/obo-9780199772810-0175.xml) — 声调研究综述书目与类型学要点。
- [*The Languages of Mainland Southeast Asia* 音系系统章 (Cambridge)](https://www.cambridge.org/core/books/abs/languages-of-mainland-southeast-asia/phonological-systems/7DAF19C432231BB60880C5F1347D4792) — 东南亚语言声调与音节结构概况。
- [Bao Zhiming, *The Structure of Tone* (UPenn 馆藏)](https://franklin.library.upenn.edu/catalog/FRANKLIN_9925490103503681) — 调型内部结构理论 (调层/调域)。
- [Properties of Constructed Language Phonological Inventories (UW 论文)](https://digital.lib.washington.edu/researchworks/items/8564e9aa-c15a-4bb0-9402-3095ba7dbb4d/full) — 人造语言音位清单与自然语言统计对比。
- [Conlang StackExchange: 现实音系的关键 (realistic inventories)](https://conlang.stackexchange.com/questions/205/what-is-the-key-to-realistic-inventories?answertab=votes#tab-top) — 实操经验:对称性、空洞、自然范围。
- [Scale in Language (Cognitive Science, 2022)](https://onlinelibrary.wiley.com/doi/10.1111/cogs.13341) — 音位库规模跨语言差异数据。
- [CV 作为基本音节结构 (ANU Open Research)](https://openresearch-repository.anu.edu.au/server/api/core/bitstreams/47ae04e2-393a-409e-9f0f-2ac1a08a47b3/content) — 音节结构普遍性与复杂度层级。
- [Theories of the Syllable (De Gruyter)](https://www.degruyterbrill.com/document/doi/10.1515/9783110806793.13/html) — 音节理论综述 (响度、重量、节律)。
- [Phlowyd Linguistics 造字指南 (GitHub 开源书)](https://github.com/fazzaan/gitbook-phlowydlinguistics/blob/main/conlangs/how-to-make-a-conscript/start-here.md) — 自创文字实操步骤。
- [LingoXpress 自创语言书写课程](https://www.lingoxpress.com/conlangs/course/writing-and-documentation) — 文字与音系匹配的实操建议。

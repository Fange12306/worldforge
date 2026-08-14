/**
 * SimulationPanel — 历史推演控制台（§九）。
 *
 * 功能（对应 SIMULATION_DESIGN.md §九）：
 * - 全景初始化（推演入口）：世界法则全集 + 空间全景 + 初始实体卡片集合。
 * - 播放控制：开始 / 暂停 / 步进 / 重置。
 * - 参数面板：randomness / surprise / rigor 滑杆 + 粒度 + 时间片基准 + 时代跳跃开关。
 * - 事件流：每 tick 全局事件日志（可展开叙事、追踪因果链）。
 * - 实体面板：当前活跃实体列表（数量、名称、活跃档位），点击查看卡片。
 * - 干预注入（Decree）：面向未来/过去，提交后进入判定，结果回填显示。
 * - 预算监控：本 tick 已用 token / 总预算。
 *
 * 默认用 mock LLM（无真实 API 也能运行推演）；传入 llm 绑定可接真实 single_chat。
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  EARTH_LAWS, MAGIC_LAWS, QI_LAWS,
  developmentLevel, adminCapacityFor, populationCapacity, deriveTechPotential,
} from "@/lib/simulation/physics";
import {
  createSession, runTicks, timeLabel,
} from "@/lib/simulation/engine";
import { buildEntityKnowledge, classifyAttention, computeActiveScore } from "@/lib/simulation/context";
import { createRng } from "@/lib/simulation/random";
import { parseUserDescription, detectInitialConflicts, completeInitialState, initialStateToSession, type InitTraceEntry } from "@/lib/simulation/init-customizer";
import { forkSession, restoreFromFork, compareBranches, type BranchSnapshot } from "@/lib/simulation/branch";
import { buildBridgePayload, submitBridgePayload } from "@/lib/simulation/bridge";
import { buildLawsFromEntries } from "@/lib/simulation/import-entries";
import { createDiskPersistence, createMemoryPersistence } from "@/lib/simulation/persistence";
import { createMockLLM, type LLMBindings } from "@/lib/simulation/llm";
import type {
  SimulationConfig, SimulationSession, WorldLaws, Decree, EntityCard, SimulationEvent,
} from "@/lib/simulation/types";

type Props = {
  worldPath: string;
  onClose: () => void;
  sidebarOpen: boolean;
  rightOpen: boolean;
  /** 真实 LLM 绑定（可选, 默认 mock） */
  llm?: LLMBindings;
};

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const LAW_OPTIONS: { id: string; label: string; laws: WorldLaws }[] = [
  { id: "auto", label: "由 LLM 推构", laws: EARTH_LAWS },
  { id: "earth", label: "真实世界", laws: EARTH_LAWS },
  { id: "magic", label: "魔法世界", laws: MAGIC_LAWS },
  { id: "qi", label: "真气世界", laws: QI_LAWS },
];

export function SimulationPanel({ worldPath, onClose, sidebarOpen, rightOpen, llm }: Props) {
  const activeModel = useStore((s) => s.activeModel);
  const llmProvider = useStore((s) => s.llmProvider);
  const activeProviderId = useStore((s) => s.activeProviderId);
  // 真实模型已接通（AppShell 传入 llm）→ 显示当前模型; 否则 mock
  const modelLabel = llm?.real
    ? `${activeProviderId || llmProvider} / ${activeModel}`
    : "未配置模型（模拟推演, 事件不会真实变化）";
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [running, setRunning] = useState(false);
  /** 法则来源: auto=LLM 按世界描述推构(默认) | earth/magic/qi=预设模板 */
  const [lawId, setLawId] = useState("auto");
  /** 自定义法则文本（可选, 并入 LLM 解析; 也可在"世界种子"里写, 这里是为单独写法则准备的入口） */
  const [customLaws, setCustomLaws] = useState("");
  /** 初始实体清单（§3.1: 种族 × 政权形态正交, 自由文本, 可多实体并存, 可选） */
  const [initEntities, setInitEntities] = useState([
    { name: "", species: "", politicalForm: "", regionId: "" },
  ]);
  /** 初始定制文本（§: 用户自由指定任意要素） */
  const [initText, setInitText] = useState("");
  const [initStatus, setInitStatus] = useState("");
  const [config, setConfig] = useState<SimulationConfig>(() => createSessionDefaults());
  const [decreeInput, setDecreeInput] = useState("");
  const [decreeDir, setDecreeDir] = useState<"future" | "past">("future");
  const [decreeResult, setDecreeResult] = useState<string>("");
  // 反事实分叉（§九 Phase 2）
  const [forkBase, setForkBase] = useState<BranchSnapshot | null>(null);
  const [forkSessionState, setForkSessionState] = useState<SimulationSession | null>(null);
  const [forkDiff, setForkDiff] = useState<string>("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  /** 事件流类型过滤（空数组 = 全部; 含自由类型, 由 LLM 现场生成, 不预设枚举） */
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  // 因果链回链高亮: 点击"前因"跳转到目标事件并高亮
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  /** 最近一次推演步的 LLM 成本估算（§3.4 预算监控: 真实用量, 非代理） */
  const [tickCost, setTickCost] = useState<{ inputTokens: number; outputTokens: number; calls: number } | null>(null);
  const eventScrollRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const handleStepRef = useRef<(n: number) => Promise<void>>(async () => {});
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  // 自动保存防抖（C3: 防 WebView 重载/崩溃丢推演）——连续步进时合并为一次落盘
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSave = useCallback((s: SimulationSession, wp: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await createDiskPersistence().save(s, wp);
      } catch {
        try { await createMemoryPersistence().save(s, wp); } catch { /* 无 Tauri 也无内存兜底则放弃 */ }
      }
    }, 1500);
  }, []);
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // 默认选中第一个活跃实体(右侧常驻侧栏显示)
  useEffect(() => {
    if (!session) return;
    const active = Object.values(session.entities).filter((e) => e.status === "active");
    if (!selectedEntityId && active.length > 0) {
      setSelectedEntityId(active[0].id);
    } else if (selectedEntityId && !session.entities[selectedEntityId]) {
      setSelectedEntityId(active[0]?.id ?? null);
    }
  }, [session, selectedEntityId]);

  // 连续播放（§9: 开始/暂停）——每 400ms 自动步进 1 tick（handleStep 通过 ref 引用, 避免声明顺序问题）
  useEffect(() => {
    if (!autoPlay) return;
    const interval = setInterval(async () => {
      if (runningRef.current) return;
      await handleStepRef.current(1);
    }, 400);
    return () => clearInterval(interval);
  }, [autoPlay]);

  // 预算监控：事件数为展示用; 真实 token 用量来自最近一步的 res.cost（§3.4）
  const eventCount = session?.events.length ?? 0;

  // 创建初始会话（全景初始化）——LLM 按用户种子文本推构完整世界（§4.0: 初始粗但全面, 由 LLM 补全）
  const handleInit = useCallback(async () => {
    try {
    // 用 app 已配置的真实模型（§5.2 single_chat）; 未配置时降级 mock（顶部条会提示"模拟推演"）
    const agentLLM = llm?.real ? llm : createMockLLM((prompt) => JSON.stringify({
      laws: { rules: [], narrative: [], ontology: [] },
      regions: [{ id: "east", name: "东域", biome: "forest", neighbors: ["west"] }, { id: "west", name: "西域", biome: "steppe", neighbors: ["east"] }],
      entities: [{ name: "东境之国", species: "人类", regionId: "east", politicalForm: "kingdom" }, { name: "西境部落", species: "人类", regionId: "west", politicalForm: "tribe" }],
    }));
    // 法则底座: auto=用最小物理底座（LLM 推构完整法则）, 模板=用该模板
    const baseLaws = lawId === "auto" ? EARTH_LAWS : (LAW_OPTIONS.find((l) => l.id === lawId)?.laws ?? EARTH_LAWS);

    // 1. 用户种子 = 自由文本 + 自定义法则 + 模板法则 + 实体清单
    //    （实体清单作为"用户明确指定"的增强, 其余交 LLM 补全, §4.0）
    let seedText = initText.trim();
    if (customLaws.trim()) {
      seedText = seedText ? `${seedText}\n\n（我的世界法则）\n${customLaws.trim()}` : `（我的世界法则）\n${customLaws.trim()}`;
    }
    // 选了模板（非 auto）但没写文本 → 把模板法则作为种子, 让 LLM 按该法则推构完整世界
    const selectedTemplate = LAW_OPTIONS.find((l) => l.id === lawId);
    if (lawId !== "auto" && selectedTemplate && !seedText) {
      seedText = `这个世界的法则如下:\n${[...selectedTemplate.laws.ontology, ...selectedTemplate.laws.rules].join("\n")}\n\n请基于这套法则推构一个完整的架空世界（大陆、种族、文明、发展轴）。`;
    }
    // 只有填了内容（名称/种族/政体/区域任一）的才算"明确指定的实体"; 全空行忽略
    const specifiedEntities = initEntities.filter((e) =>
      e.name.trim() || e.species.trim() || e.politicalForm.trim() || e.regionId.trim(),
    );
    const entityDesc = (e: typeof initEntities[number]) => [
      e.name.trim() || "(未命名)",
      e.species.trim() ? `种族=${e.species.trim()}` : "",
      e.politicalForm.trim() ? `政体=${e.politicalForm.trim()}` : "",
      e.regionId.trim() ? `位于 ${e.regionId.trim()}` : "",
    ].filter(Boolean).join(", ");
    if (specifiedEntities.length > 0 && !seedText) {
      seedText = specifiedEntities.map((e) => `初始实体: ${entityDesc(e)}`).join("。");
    } else if (specifiedEntities.length > 0) {
      seedText += "\n\n（我明确指定的初始实体）\n" + specifiedEntities
        .map((e) => `- ${entityDesc(e)}`)
        .join("\n");
    }

    // 2. 解析（LLM）→ 冲突检测 → 补全（LLM 填充世界其余部分, §4.0）
    // 初始化链路全程写盘 init-trace.jsonl + console, 供排查"区域平铺/实体挤一区/多出物种"问题
    const traceFile = "init-trace.jsonl";
    const appendTrace = async (entry: InitTraceEntry) => {
      const line = JSON.stringify(entry);
      // 浏览器环境(无 Tauri) → console 兜底
      try {
        const { invoke } = await import("@/lib/api");
        await invoke("simulation_append_file", { worldPath, relPath: traceFile, line });
      } catch {
        // eslint-disable-next-line no-console
        console.log("[init-trace]", line);
      }
    };
    setInitStatus(seedText ? "正在解析你的设定..." : "正在生成完整世界（LLM 按合理性与随机性推构）...");
    // 捕获最近一次 parse 的错误与响应片段, 失败时显示真实原因(而非误导的 ping 结果)
    let lastParseErr = "";
    let lastParseResp = "";
    const parsed = seedText
      ? await parseUserDescription(seedText, agentLLM, (e) => {
          if (e.step === "parse" && !e.ok) { lastParseErr = e.error ?? ""; lastParseResp = e.responseExcerpt ?? ""; }
          void appendTrace(e);
        })
      : { laws: { rules: [], narrative: [], ontology: [] }, regions: [], entities: [], measurement: { lengthUnit: "公里", worldWidth: 2000, worldHeight: 1600 } };
    if (parsed) {
      const conflicts = detectInitialConflicts(parsed);
      if (conflicts.some((c) => c.severity === "hard")) {
        setInitStatus(`检测到设定冲突:\n${conflicts.filter((c) => c.severity === "hard").map((c) => `- ${c.description}`).join("\n")}`);
        return; // 硬冲突不生成, 让用户调整
      }
      setInitStatus("正在补全世界（区域/文明/法则串行推构）...");
      // seedText = 用户完整原文, 作为唯一权威输入传给 complete——整个世界从种子推导
      setInitStatus("正在生成世界（4 步分层）...");
      void appendTrace({ step: "ui-complete-start", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: "before completeInitialState", responseExcerpt: "" });
      const completed = await completeInitialState(parsed, agentLLM, seedText, (stage) => setInitStatus(stage), (e) => { void appendTrace(e); });
      void appendTrace({ step: "ui-complete-done", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: `after complete: regions=${completed.regions?.length}, entities=${completed.entities?.length}`, responseExcerpt: "" });
      setInitStatus("世界已生成, 正在转会话...");
      const rng = createRng(config.seed);
      const result = initialStateToSession(completed, rng, baseLaws);
      void appendTrace({ step: "ui-tosession-done", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: `after toSession: entities=${result.entities.length}, regions=${Object.keys(result.regions).length}`, responseExcerpt: "" });
      setInitStatus("会话构建中...");
      // 用户指定要素进背景规则库（细化即锁定, §4.0）
      const s = createSession({ laws: result.laws, regions: result.regions, entities: result.entities, config, languages: result.languages, cultures: result.cultures });
      void appendTrace({ step: "ui-createsession-done", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: `after createSession: entities=${Object.keys(s.entities).length}, regions=${Object.keys(s.regions).length}`, responseExcerpt: "" });
      for (const u of result.userSpecified) {
        s.lore.facts.push({
          id: `user-specified-${s.lore.facts.length}`, axis: "space", layer: 0,
          scope: u.scope, content: u.content, source: "initial", locked_tick: 0,
          notes: "用户初始化指定",
          entityScope: u.entityScope, // 让实体级事实能被按实体 id 回读
        });
      }
      setSession(s);
      setRunning(false);
      setInitStatus("世界已生成, 正在保存...");
      void appendTrace({ step: "ui-before-save", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: "about to save", responseExcerpt: "" });
      // 立即落盘: 初始化完就持久化, 避免"内存正确但磁盘还是旧数据"导致重启/加载回退到旧世界
      try {
        await createDiskPersistence().save(s, worldPath);
      } catch (e) {
        console.error("[simulation] disk save failed, fallback memory:", e);
        try { await createMemoryPersistence().save(s, worldPath); } catch (e2) { console.error("[simulation] memory save failed:", e2); }
      }
      void appendTrace({ step: "ui-after-save", time: new Date().toISOString(), ok: true, calledLLM: false, inputExcerpt: "save done", responseExcerpt: "" });
      setInitStatus("世界已生成（LLM 按你的种子推构完整）");
      return;
    }
    // 解析失败——显示真实的 LLM 输出与解析错误(而非误导的 ping 结果)
    setInitStatus(
      `解析你的设定失败(模型返回不是合法 JSON)。\n解析错误: ${lastParseErr || "未知"}\nLLM 原始输出片段:\n${(lastParseResp || "(无)").slice(0, 500)}`,
    );
  } catch (e: unknown) {
    // 顶层兜底: 任何初始化错误都显示, 不静默卡在中间状态
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[simulation] handleInit error:", e);
    setInitStatus(`初始化出错: ${msg}`);
  }
  }, [lawId, customLaws, config, initEntities, initText, llm]);

  // 播放控制：单步 / 加速（多 tick 批量, §5.2）
  const handleStep = useCallback(async (multi: number = 1) => {
    if (!session || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const s = session;
      // 真实模型已配置 → 用真实模型; 未配置 → 降级 mock（顶部条提示"模拟推演"）。
      // mock 输出随 tick 变化, 体现物理层/维度推进（而不是固定空话）。
      const agentLLM = llm?.real ? llm : createMockLLM((prompt) => {
        const tick = s.current_tick;
        const activity = tick % 3 === 0
          ? { decisions: [], events: [{ type: "other", description: `第 ${tick} tick, 各邦平静推进。` }], metric_delta: {} }
          : { decisions: [], events: [{ type: "other", description: `第 ${tick} tick, 王国延续。` }], metric_delta: {} };
        return JSON.stringify(activity);
      });
      // runTicks 内置: 多 agent 并行推演(§5.2) + 物理层 + 仲裁(§5.3) + 动态池(§5.4) + 干预(§5.5)
      const res = await runTicks(s, multi, {
        agentConfig: { llm: agentLLM, maxTokens: Math.round(config.budget.perEntity) },
        llm: agentLLM,
      });
      setSession({ ...s });
      // §3.4 预算监控: 显示真实估算 token 用量（含熔断降级说明）
      if (res.cost) setTickCost(res.cost);
      // C3 自动保存（防 WebView 重载/崩溃丢推演）: 每步后落盘, 连续步进时 1.5s 防抖合并
      scheduleAutoSave(s, worldPath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDecreeResult(`推演出错（实体可能部分更新, 但事件未记录）: ${msg}`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [session, llm, config.budget.perEntity]);
  // 供 autoplay 引用（声明顺序: effect 在前, 用 ref 通信）
  handleStepRef.current = handleStep;

  // 重置
  const handleReset = useCallback(() => {
    setSession(null);
    setRunning(false);
    setDecreeResult("");
    setForkBase(null);
    setForkSessionState(null);
    setForkDiff("");
  }, []);

  // 反事实分叉（§九 Phase 2）：存档当前状态
  const handleFork = useCallback(() => {
    if (!session) return;
    const snapshot = forkSession(session, `分叉于 tick ${session.current_tick}`, `fork-${Date.now()}`);
    setForkBase(snapshot);
    // 另起分支（改随机性 seed, 走不同演化）
    const fork = restoreFromFork(snapshot, { seed: (session.config.seed ?? 42) + 1, randomness: Math.min(1, (session.config.randomness ?? 0.3) + 0.3) });
    setForkSessionState(fork);
    setForkDiff("分叉已创建。继续推演主分支, 然后点击「对比分支」查看差异。");
  }, [session]);

  // 对比两条历史
  const handleCompare = useCallback(async () => {
    if (!session || !forkBase) return;
    const fork = forkSessionState!;
    const agentLLM = llm?.real ? llm : createMockLLM(() => JSON.stringify({ decisions: [], events: [], metric_delta: {} }));
    // 分叉会话也推进同样的 tick 数
    const ticks = session.current_tick - forkBase.baseTick;
    if (ticks > 0 && fork.current_tick === forkBase.baseTick) {
      await runTicks(fork, ticks, { agentConfig: { llm: agentLLM }, llm: agentLLM });
      setForkSessionState({ ...fork });
    }
    const diff = compareBranches(session, fork);
    setForkDiff(diff.summary);
  }, [session, forkBase, forkSessionState, llm]);

  // 持久化（§二: 存到 <world>/simulation/）——用磁盘适配器, 失败降级内存
  const handleSave = useCallback(async () => {
    if (!session) return;
    const disk = createDiskPersistence();
    try {
      await disk.save(session, worldPath);
    } catch {
      // 无 Tauri 环境 → 内存 fallback
      await createMemoryPersistence().save(session, worldPath);
    }
    setDecreeResult("已保存到 <world>/simulation/");
  }, [session, worldPath]);

  const handleLoad = useCallback(async () => {
    const disk = createDiskPersistence();
    let loaded = null;
    try {
      loaded = await disk.load(worldPath);
    } catch {
      loaded = null;
    }
    if (!loaded) {
      loaded = await createMemoryPersistence().load(worldPath);
    }
    if (loaded) {
      setSession(loaded);
      setDecreeResult("已加载保存的推演");
    } else {
      setDecreeResult("无已保存的推演");
    }
  }, [worldPath]);

  // 提交到正式世界（§十, 默认关、用户手动触发）
  const handleBridge = useCallback(async () => {
    if (!session) return;
    const payload = buildBridgePayload(session, session.events, { includeEntities: true });
    const result = await submitBridgePayload(worldPath, payload);
    setDecreeResult(`已提交 ${result.createdEvents} 个事件 + ${result.createdEntries} 个词条到正式世界（自动触发关系图/时间线更新）`);
  }, [session, worldPath]);

  // 从现有词条导入世界法则（§4 法则来源 2）——应用到当前 session
  const handleImport = useCallback(async () => {
    if (!session) {
      setDecreeResult("请先创建世界再导入词条法则");
      return null;
    }
    try {
      const imported = await buildLawsFromEntries(worldPath);
      // 应用到 session: 合并导入的规则/叙事/作用域规则到当前世界法则
      const merged = {
        ...session.laws,
        rules: [...session.laws.rules, ...imported.rules],
        timeline_rules: [...(session.laws.timeline_rules ?? []), ...(imported.timeline_rules ?? [])],
        narrative: [...session.laws.narrative, ...imported.narrative],
      };
      session.laws = merged;
      setSession({ ...session });
      setDecreeResult(`已从词条导入 ${imported.rules.length} 条硬约束 + ${imported.narrative.length} 条软约束并应用到当前世界`);
      return imported;
    } catch {
      setDecreeResult("导入词条约束失败（需要真实世界）");
      return null;
    }
  }, [session, worldPath]);

  // 干预注入
  const handleDecree = useCallback(async () => {
    if (!session || !decreeInput.trim()) return;
    const decree: Decree = {
      id: `decree-${Date.now()}`,
      direction: decreeDir,
      target_tick: session.current_tick,
      target: { type: "global" },
      intent: decreeInput.trim(),
      strength: "command",
    };
    // 推入未判定的指令, 由引擎在下一个 tick 判定（§5.5: 判定走引擎管线, 含写库/事件）
    session.decrees.push(decree);
    setDecreeResult(`指令已提交待判定（tick ${session.current_tick} 生效判定）: ${decreeInput.trim()}`);
    setDecreeInput("");
    setSession({ ...session });
  }, [session, decreeInput, decreeDir]);

  // ── 渲染 ──

  if (!session) {
    // 初始状态配置（全景初始化）
    return (
      <div className="flex flex-col flex-1 min-h-0" style={{ paddingLeft: !sidebarOpen ? 48 : 0 }}>
        <div className="flex items-center gap-2 px-3 border-b border-surface-700 flex-shrink-0" style={{ height: 40 }}>
          <button onClick={onClose} className="text-[0.688rem] text-ink-muted hover:text-ink h-full flex items-center">← 返回</button>
          <span className="text-[0.625rem] text-ink-muted/50">历史推演</span>
          <span className="text-[0.688rem] text-ink-secondary">全景初始化</span>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <h2 className="text-lg font-bold mb-4">全景初始化（推演入口）</h2>
          <p className="text-sm text-ink-secondary mb-6">定义世界法则 + 初始实体，作为恒定底座。推演在这套完整底座上运行。</p>

          <div className={`mb-5 px-3 py-2 rounded-lg text-[0.625rem] border ${llm?.real ? "bg-surface-800 border-edge text-ink-secondary" : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}>
            {llm?.real ? `✓ 已接入真实模型: ${modelLabel}` : `⚠ ${modelLabel} —— 请在设置中配置模型后重进, 否则推演只会循环输出空话。`}
          </div>

          <div className="space-y-6 max-w-xl">
            <div>
              <label className="text-sm font-medium block mb-2">世界种子（描述你想要的世界, 可自由写任意要素）</label>
              <textarea
                value={initText}
                onChange={(e) => setInitText(e.target.value)}
                placeholder="描述你想要的世界要素，如: 这片大陆叫艾瑟拉，东部有片大森林住着精灵，他们信仰月神，与北方的兽人常年战争。海边有人类城邦联盟。没有魔法。大陆宽约2000公里。\n\n也可以只写一个方向，比如: 一个修行者崛起的东方大陆，灵气稀薄但出现了一位天选者。剩下的世界（大陆地理、其他种族、宗教、力量体系）由 LLM 按合理性与随机性补全。"
                className="w-full h-32 text-xs bg-surface-800 border border-edge rounded p-2 resize-none"
              />
              {initStatus && <div className="mt-2 text-[0.625rem] whitespace-pre-wrap text-ink-secondary">{initStatus}</div>}
              <div className="text-[0.625rem] text-ink-muted mt-1">留空则 LLM 按所选法则模板推构完整世界。填了则 LLM 解析你的设定 → 补全其余空白 → 完整世界（你指定的要素锁定不可改, §4.0 细化即锁定）。</div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">世界法则（决定"有哪些发展轴"；默认由 LLM 从世界种子推构, 也可选模板或自定义）</label>
              <div className="flex gap-2">
                {LAW_OPTIONS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLawId(l.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${lawId === l.id ? "bg-brand-600 text-white border-brand-500" : "bg-surface-800 text-ink-secondary border-edge hover:bg-surface-700"}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <textarea
                value={customLaws}
                onChange={(e) => setCustomLaws(e.target.value)}
                placeholder="自定义世界法则（可选）: 如 灵气源于星辰潮汐, 修仙者以气海境界区分实力; 任何法术消耗等价能量; 大陆被雾海包围, 无人越过。\n留空则: 选「由 LLM 推构」= LLM 从世界种子推导法则; 选模板 = 用该模板作法则底座。"
                className="w-full h-20 text-xs bg-surface-800 border border-edge rounded p-2 resize-none mt-2"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">明确指定的初始实体（可选; 不填则 LLM 从文本/合理性推构, §3.1 实体数由涌现决定）</label>
              <div className="space-y-2">
                {initEntities.map((ent, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      value={ent.name}
                      onChange={(e) => setInitEntities((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      placeholder="实体名"
                      className="w-28 text-xs bg-surface-800 border border-edge rounded px-2 py-1.5"
                    />
                    <input
                      value={ent.species}
                      onChange={(e) => setInitEntities((arr) => arr.map((x, i) => i === idx ? { ...x, species: e.target.value } : x))}
                      placeholder="种族（如 精灵/树精/半机械）"
                      className="flex-1 text-xs bg-surface-800 border border-edge rounded px-2 py-1.5"
                    />
                    <input
                      value={ent.politicalForm}
                      onChange={(e) => setInitEntities((arr) => arr.map((x, i) => i === idx ? { ...x, politicalForm: e.target.value } : x))}
                      placeholder="政体（如 王国/议会/游牧联盟）"
                      className="w-40 text-xs bg-surface-800 border border-edge rounded px-2 py-1.5"
                    />
                    {initEntities.length > 1 && (
                      <button
                        onClick={() => setInitEntities((arr) => arr.filter((_, i) => i !== idx))}
                        className="text-xs text-ink-muted hover:text-error px-1"
                        title="移除该实体"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setInitEntities((arr) => [...arr, { name: "", species: "", politicalForm: "", regionId: "" }])}
                className="mt-2 text-xs text-brand-300 hover:text-brand-200"
              >+ 添加实体</button>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">推演参数</label>
              <div className="grid grid-cols-3 gap-4">
                <ParamSlider label="随机性" value={config.randomness} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, randomness: v }))} />
                <ParamSlider label="意外" value={config.surprise} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, surprise: v }))} />
                <ParamSlider label="严肃性" value={config.rigor} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, rigor: v }))} />
              </div>
            </div>

            <Button variant="primary" size="lg" onClick={handleInit}>
              创建世界并开始推演
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 推演中：控制台
  const activeEntities = Object.values(session.entities).filter((e) => e.status === "active");
  const lastEvents = session.events.slice(-20);
  // 全事件 id 索引（causals 可能指向超出最近 20 条的更早事件）
  const eventById = new Map(session.events.map((e) => [e.id, e]));
  const scrollToEvent = (id: string) => {
    document.getElementById(`evt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedEventId(id);
    window.setTimeout(() => setHighlightedEventId((cur) => cur === id ? null : cur), 1600);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ paddingLeft: !sidebarOpen ? 48 : 0 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 border-b border-surface-700 flex-shrink-0" style={{ height: 40 }}>
        <button onClick={onClose} className="text-[0.688rem] text-ink-muted hover:text-ink h-full flex items-center">← 返回</button>
        <span className="text-[0.625rem] text-ink-muted/50">历史推演</span>
        <span className="text-[0.688rem] text-ink-secondary truncate">{session.laws.name} · {timeLabel(session, session.current_tick)}</span>
        <div className="flex-1" />
        {/* 预算监控（§九: 本 tick 已用 token / 总预算, 含成本警告）——基于真实 agent token 预算 */}
        {(() => {
          // 每 tick token 消耗估计 = 活跃实体数 × perEntity × 平均档位倍率
          const active = Object.values(session.entities).filter((e) => e.status === "active");
          let estTokens = 0;
          for (const e of active) {
            const score = computeActiveScore(e, session);
            const att = classifyAttention(score);
            const mult = att.level === "hotspot" ? (config.budget.hotspotMultiplier ?? 4) : att.tokenMultiplier;
            estTokens += config.budget.perEntity * mult;
          }
          const perTickGlobal = config.budget.perTickGlobal;
          const budgetPct = perTickGlobal > 0 ? estTokens / perTickGlobal : 0;
          const overBudget = budgetPct > 1;
          return (
            <span className={`text-[0.625rem] ${overBudget ? "text-error font-medium" : "text-ink-muted"}`}>
              Token ~{estTokens.toLocaleString()}/{perTickGlobal.toLocaleString()}{overBudget ? " ⚠超限" : ""}
            </span>
          );
        })()}
        <span className="text-[0.625rem] text-ink-muted">事件 {eventCount} · 实体 {activeEntities.length}</span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 左侧：控制 + 实体（实体面板独占剩余空间, 可滚动查看所有实体） */}
        <div className="w-72 border-r border-surface-700 flex flex-col min-h-0">
          {/* 播放控制（§九: 开始/暂停/步进/加速/重置） */}
          <div className="p-3 border-b border-surface-700">
            <div className="flex gap-2 flex-wrap">
              <Button variant="primary" size="sm" onClick={() => setAutoPlay(!autoPlay)} disabled={!session}>
                {autoPlay ? "暂停" : "开始"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleStep(1)} disabled={running || autoPlay}>
                {running ? "推演中..." : "步进"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleStep(5)} disabled={running || autoPlay}>
                加速 ×5
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleStep(10)} disabled={running || autoPlay}>
                加速 ×10
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setAutoPlay(false); handleReset(); }}>重置</Button>
            </div>
            <div className="flex gap-2 flex-wrap mt-2">
              <Button variant="ghost" size="sm" onClick={handleFork}>分叉存档</Button>
              <Button variant="ghost" size="sm" onClick={handleCompare} disabled={!forkBase}>对比分支</Button>
              <Button variant="ghost" size="sm" onClick={handleSave}>保存</Button>
              <Button variant="ghost" size="sm" onClick={handleLoad}>加载</Button>
              <Button variant="ghost" size="sm" onClick={handleBridge}>提交正式世界</Button>
              <Button variant="ghost" size="sm" onClick={handleImport}>导入词条法则</Button>
            </div>
            <div className="mt-2 text-xs text-ink-muted">tick {session.current_tick} / 上限 {config.maxTicks}</div>
            {/* §3.4 预算监控: 真实估算 token（来自 res.cost）+ 预算; 超限提示自动降级 */}
            {(() => {
              const global = config.budget?.perTickGlobal ?? 0;
              const used = tickCost ? tickCost.inputTokens + tickCost.outputTokens : null;
              const pct = used != null && global > 0 ? used / global : 0;
              return (
                <div className={'mt-1 text-[0.625rem] ' + (pct > 1 ? 'text-amber-400' : 'text-ink-muted')}>
                  {used != null
                    ? <span>最近一步 LLM 估算 {used.toLocaleString()} / {global.toLocaleString()} token（{tickCost?.calls ?? 0} 次调用）{pct > 1 ? '· 超预算, 已自动跳过可省略的语义层' : ''}</span>
                    : '预算: 每 tick ' + global.toLocaleString() + ' token（步进后显示真实用量）'}
                </div>
              );
            })()}
            {forkDiff && <div className="mt-2 text-[0.625rem] whitespace-pre-wrap text-ink-secondary">{forkDiff}</div>}
          </div>

          {/* 档位预设（§7: 传奇/平衡/史学） */}
          <div className="p-3 border-b border-surface-700">
            <div className="text-xs font-medium text-ink-secondary mb-2">档位预设</div>
            <div className="flex gap-1.5 flex-wrap">
              <PresetButton label="传奇" randomness={0.8} surprise={0.7} rigor={0.2} current={config} onChange={setConfig} />
              <PresetButton label="平衡" randomness={0.4} surprise={0.4} rigor={0.6} current={config} onChange={setConfig} />
              <PresetButton label="史学" randomness={0.15} surprise={0.15} rigor={0.9} current={config} onChange={setConfig} />
            </div>
          </div>

          {/* 参数面板（§3.4） */}
          <div className="p-3 border-b border-surface-700">
            <div className="text-xs font-medium text-ink-secondary mb-2">参数</div>
            <div className="space-y-2">
              <ParamSlider label="随机性" value={config.randomness} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, randomness: v }))} />
              <ParamSlider label="意外" value={config.surprise} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, surprise: v }))} />
              <ParamSlider label="严肃性" value={config.rigor} min={0} max={1} step={0.05} onChange={(v) => setConfig((c) => ({ ...c, rigor: v }))} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-ink-secondary mb-1">粒度</div>
                  <select value={config.granularity} onChange={(e) => setConfig((c) => ({ ...c, granularity: e.target.value as any }))}
                    className="w-full text-xs bg-surface-800 border border-edge rounded p-1">
                    <option value="macro">宏观</option>
                    <option value="standard">常规</option>
                    <option value="micro">微观</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-ink-secondary mb-1">每 tick 年数</div>
                  <input
                    type="number" min={1} step={1}
                    value={config.yearsPerTick}
                    onChange={(e) => setConfig((c) => ({ ...c, yearsPerTick: Math.max(1, Number(e.target.value) || 1) }))}
                    className="w-full text-xs bg-surface-800 border border-edge rounded p-1"
                  />
                  <div className="flex gap-1 mt-1">
                    {[{ v: 1, l: "年" }, { v: 10, l: "十年" }, { v: 100, l: "百年" }, { v: 1000, l: "纪元" }].map((o) => (
                      <button key={o.v} onClick={() => setConfig((c) => ({ ...c, yearsPerTick: o.v }))}
                        className={`px-1.5 py-0.5 text-[0.625rem] rounded ${config.yearsPerTick === o.v ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary hover:bg-surface-700"}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-secondary">
                <input type="checkbox" checked={config.autoJump}
                  onChange={(e) => setConfig((c) => ({ ...c, autoJump: e.target.checked }))} />
                时代跳跃（平顺期批量推进）
              </label>
            </div>
          </div>

          {/* 干预注入 */}
          <div className="p-3 border-b border-surface-700">
            <div className="text-xs font-medium text-ink-secondary mb-2">干预注入 (Decree)</div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setDecreeDir("future")} className={`px-2 py-1 text-xs rounded ${decreeDir === "future" ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary"}`}>面向未来</button>
              <button onClick={() => setDecreeDir("past")} className={`px-2 py-1 text-xs rounded ${decreeDir === "past" ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary"}`}>细化过去</button>
            </div>
            <textarea
              value={decreeInput}
              onChange={(e) => setDecreeInput(e.target.value)}
              placeholder={decreeDir === "future" ? "指定之后的某件事/走向，如: 一个沿海王国将在数代之内统一其周边地区" : "在已发生的时代细化，如: 某个较早的纪元曾有一位影响深远的贤者"}
              className="w-full h-16 text-xs bg-surface-800 border border-edge rounded p-2 resize-none"
            />
            <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={handleDecree}>提交判定</Button>
            {decreeResult && <div className="mt-2 text-[0.625rem] whitespace-pre-wrap text-ink-secondary">{decreeResult}</div>}
          </div>

        </div>

        {/* 右侧：事件流（全宽, 不被实体卡片挤压; 按 tick 分组 + 类型过滤） */}
        <div ref={eventScrollRef} className="flex-1 overflow-auto p-4 min-w-0">
          <div className="text-xs font-medium text-ink-secondary mb-2">事件流（{timeLabel(session, Math.max(1, session.current_tick - 20))} - {timeLabel(session, session.current_tick)}）</div>
          {/* 类型过滤 chips: 含自由类型(LLM 现场生成), 最多显示 12 个 */}
          {(() => {
            const allTypes = [...new Set(session.events.map((e) => e.type))].sort();
            const shown = allTypes.slice(0, 12);
            const hasMore = allTypes.length > shown.length;
            return (
              <div className="flex flex-wrap gap-1 mb-2">
                <button
                  onClick={() => setTypeFilter([])}
                  className={`px-2 py-0.5 text-[0.625rem] rounded ${typeFilter.length === 0 ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary hover:bg-surface-700"}`}
                >全部</button>
                {shown.map((t) => {
                  const active = typeFilter.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter((cur) => active ? cur.filter((x) => x !== t) : [...cur, t])}
                      className={`px-2 py-0.5 text-[0.625rem] rounded ${active ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary hover:bg-surface-700"}`}
                    >{t}</button>
                  );
                })}
                {hasMore && <span className="px-1 py-0.5 text-[0.625rem] text-ink-muted">+{allTypes.length - shown.length}</span>}
              </div>
            );
          })()}
          <div className="space-y-2.5">
            {(() => {
              const filtered = typeFilter.length ? lastEvents.filter((e) => typeFilter.includes(e.type)) : lastEvents;
              // 按 tick 分组
              const grouped: { tick: number; events: typeof lastEvents }[] = [];
              for (const ev of filtered) {
                const g = grouped[grouped.length - 1];
                if (g && g.tick === ev.tick) g.events.push(ev);
                else grouped.push({ tick: ev.tick, events: [ev] });
              }
              return grouped.map((g) => (
                <div key={g.tick}>
                  <div className="text-[0.625rem] text-ink-muted/60 mb-1 flex items-center gap-2">
                    <span>t{g.tick}</span>
                    <span>{timeLabel(session, g.tick)}</span>
                    <span className="flex-1 h-px bg-surface-700/50" />
                    <span>{g.events.length} 件</span>
                  </div>
                  <div className="space-y-1">
                    {g.events.map((ev) => (
                      <EventRow
                        key={ev.id}
                        ev={ev}
                        eventById={eventById}
                        highlighted={highlightedEventId === ev.id}
                        onCausalClick={scrollToEvent}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}
            {lastEvents.length === 0 && <div className="text-sm text-ink-muted">尚无事件，点击"步进"开始推演</div>}
          </div>
        </div>

        {/* 右侧常驻实体侧栏（§9: 点击实体切换显示, 始终可见完整信息） */}
        {(() => {
          const sel = session.entities[selectedEntityId ?? ""] ?? Object.values(session.entities).find((e) => e.status === "active");
          if (!sel) return null;
          const relNames = new Map(Object.values(session.entities).map((x) => [x.id, x.name]));
          const ownEvents = session.events.filter((ev) => ev.participants.includes(sel.id)).slice(-8);
          // 领土区划名(命名主观性) + 完整层级路径(次大陆 / 恒河平原 / 中游)
          const territory = sel.territory ?? [sel.geography.region];
          const unitName = (uid: string) => {
            const u = session.geography?.[uid];
            if (u) return u.namesByEntity?.[sel.id] ?? u.name;
            const r = session.regions?.[uid];
            return r?.name ?? uid;
          };
          const unitParent = (uid: string) => {
            const u = session.geography?.[uid] ?? (session.regions?.[uid] as any);
            return u?.parent;
          };
          const territoryNames = territory.map((tid) => {
            const path = [tid];
            let p = unitParent(tid);
            const guard = new Set<string>();
            while (p && session.geography?.[p] && !guard.has(p)) {
              guard.add(p);
              path.unshift(p);
              p = unitParent(p);
            }
            return path.map(unitName).join(" / ");
          });
          return (
            <div className="w-96 border-l border-surface-700 flex flex-col bg-surface-900 min-h-0">
              {/* 活跃实体列表(常驻侧栏顶部, 点击切换) */}
              <div className="max-h-48 flex flex-col flex-shrink-0 min-h-0 border-b border-surface-700">
                <div className="px-3 py-2 border-b border-surface-700 flex-shrink-0">
                  <span className="text-xs font-medium text-ink-secondary">活跃实体 ({activeEntities.length})</span>
                </div>
                <div className="flex-1 overflow-auto px-1 py-1">
                  {activeEntities.map((e) => {
                    const score = computeActiveScore(e, session);
                    const att = classifyAttention(score);
                    return (
                      <div
                        key={e.id}
                        onClick={() => setSelectedEntityId(e.id)}
                        className={`py-1.5 border-b border-surface-700/50 last:border-0 cursor-pointer rounded px-1 transition-colors ${selectedEntityId === e.id ? "bg-surface-800" : "hover:bg-surface-800/50"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-ink">{e.name}</span>
                          <span className={`text-[0.625rem] px-1.5 py-0.5 rounded ${att.level === "hotspot" ? "bg-error/20 text-error" : att.level === "regular" ? "bg-brand/20 text-brand" : "bg-surface-700 text-ink-muted"}`}>
                            {att.level}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[0.625rem] text-ink-muted mt-0.5">
                          <span>发展 {developmentLevel(e)}</span>
                          <span>·</span>
                          <span>人口 {e.metrics.population.toLocaleString()}</span>
                          <span>·</span>
                          <span className={popPressureColor(popPressureOf(e, session))}>{popPressureOf(e, session) >= 1 ? "超载" : ""}</span>
                        </div>
                        <div className="mt-1">
                          <PressureBar entity={e} session={session} />
                        </div>
                        <div className="text-[0.625rem] text-ink-muted mt-0.5">
                          治理 {(e.territory ?? [e.geography.region]).length}/{adminCapacityFor(e)} 区 · {(e.territory ?? [e.geography.region]).map((tid) => session.geography?.[tid]?.name ?? session.regions?.[tid]?.name ?? tid).join("、").slice(0, 22)}
                        </div>
                      </div>
                    );
                  })}
                  {activeEntities.length === 0 && <div className="text-xs text-ink-muted p-2">无活跃实体</div>}
                </div>
              </div>
              {/* 选中实体详情 */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 flex-shrink-0">
                <span className="text-sm font-medium text-ink">{sel.name}</span>
                <span className="text-[0.625rem] text-ink-muted">领土 {territory.length} 区</span>
              </div>
              <div className="flex-1 overflow-auto p-3 space-y-3 text-[0.625rem] text-ink-secondary">
                {/* 身份 */}
                <Section label="身份">
                  <div>种族: {sel.identity.species}</div>
                  <div>政权形态: {sel.identity.political_form}</div>
                  <div>文化: {sel.identity.culture}</div>
                  <div>意识形态: {sel.identity.ideology ?? "无"}</div>
                  {sel.identity.religion && <div>信仰: {sel.identity.religion}</div>}
                  {sel.identity.origin_story && <div>起源: {sel.identity.origin_story}</div>}
                </Section>
                {/* 发展概况（软状态: 发展水平/人口压力/治理负载） */}
                <Section label="发展概况">
                  <HBar label="发展水平" value={developmentLevel(sel)} max={100}
                    color={devColor(developmentLevel(sel))} sub={`${developmentLevel(sel)}/100`} />
                  <div className="mt-2">
                    <HBar label="人口承载压力" value={popPressureOf(sel, session)} max={1}
                      color={popPressureColor(popPressureOf(sel, session))}
                      sub={`${Math.round(popPressureOf(sel, session) * 100)}%`} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[0.625rem]">
                    <span className="text-ink-secondary">治理负载</span>
                    <span className={(sel.territory ?? [sel.geography.region]).length >= adminCapacityFor(sel) ? "text-error" : "text-ink-muted"}>
                      {(sel.territory ?? [sel.geography.region]).length}/{adminCapacityFor(sel)} 区
                    </span>
                  </div>
                </Section>
                {/* 核心指标（分组; 粮食不再作标题指标, 折叠为一行小字, 弱化"食物聚焦"） */}
                <Section label="核心指标">
                  <MetricRow label="人口" value={sel.metrics.population.toLocaleString()} />
                  <MetricRow label="经济" value={String(Math.round(sel.metrics.economy ?? 0))} />
                  <MetricRow label="军力" value={sel.metrics.military.toLocaleString()} />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <MetricRow label="稳定" value={String(Math.round(sel.metrics.stability))} />
                    <MetricRow label="合法" value={String(Math.round(sel.metrics.legitimacy))} />
                    <MetricRow label="组织复杂度" value={String(Math.round(sel.regime?.organizational_complexity ?? 0))} />
                    <MetricRow label="集权度" value={String(Math.round(sel.regime?.centralization ?? 0))} />
                  </div>
                  <div className="text-[0.625rem] text-ink-muted mt-1">粮 {sel.metrics.food >= 0 ? "盈余" : "赤字"}（{Math.round(sel.metrics.food ?? 0)}）</div>
                </Section>
                {/* 技术维度: 排序条 + 潜力, 满潜力打勾 */}
                <Section label="技术维度">
                  {(() => {
                    const pot = deriveTechPotential(session.regions[sel.geography.region]?.resources, session.laws);
                    const bars = Object.entries(sel.tech)
                      .sort((a, b) => b[1] - a[1])
                      .map(([d, v]) => {
                        const p = pot[d] ?? 100;
                        const full = v >= p - 0.5;
                        return (
                          <div key={d} className="mb-1">
                            <HBar label={d} value={v} max={p}
                              color={full ? "bg-emerald-500" : "bg-brand-500"}
                              sub={`${Math.round(v)}/${Math.round(p)}${full ? " ✓" : ""}`} />
                          </div>
                        );
                      });
                    return bars.length ? bars : <div>无</div>;
                  })()}
                </Section>
                <Section label="理念维度">
                  {Object.entries(sel.values).length ? Object.entries(sel.values).map(([d, v]) => <div key={d}>{d}: {Math.round(v * 10) / 10}</div>) : <div>无</div>}
                </Section>
                {/* 空间 */}
                <Section label="领土">
                  <div className="mb-1"><span className="text-ink">控制的区划:</span></div>
                  <div className="mb-1">{territoryNames.join("、") || "无"}</div>
                  <div>核心区域: {sel.geography.region}</div>
                  <div>首都: {sel.geography.capital ?? "无"}</div>
                  <div>相邻实体: {sel.geography.neighbors.map((n) => {
                    const conn = session.geography?.[sel.geography.region]?.connections?.[n];
                    return `${relNames.get(n) ?? n}${conn?.direction ? `(${conn.direction}侧${conn.via ? `, ${conn.via}` : ""})` : ""}`;
                  }).join("、") || "无"}</div>
                </Section>
                {/* 对外关系 */}
                <Section label="对外关系">
                  {sel.relations.length ? sel.relations.map((r, i) => (
                    <div key={i} className="mb-1">
                      <span className={relationColor(r.hostility)}>{relNames.get(r.target) ?? r.target}</span>
                      <span className="text-ink-muted"> → {r.stance}</span>
                      {typeof r.hostility === "number" && <span className="text-[0.625rem] text-ink-muted"> 敌意{Math.round(r.hostility * 100)}%</span>}
                      {r.note && <div className="text-ink-muted mt-0.5">{r.note}</div>}
                    </div>
                  )) : <div>无</div>}
                </Section>
                {/* 内部状态 */}
                <Section label="最近事件">
                  {sel.internal.recent_events.length ? sel.internal.recent_events.map((r, i) => <div key={i} className="mb-0.5">· {r}</div>) : <div>无</div>}
                </Section>
                <Section label="未决议题">
                  {sel.internal.active_issues.length ? sel.internal.active_issues.map((a, i) => <div key={i} className="mb-0.5">· {a}</div>) : <div>无</div>}
                </Section>
                {/* 该实体的历史事件 */}
                {ownEvents.length > 0 && (
                  <Section label="参与的历史事件">
                    {ownEvents.map((ev) => (
                      <div key={ev.id} className="mb-1">
                        <span className="text-ink-muted">t{ev.tick} [{ev.type}]</span>
                        <div className="text-ink">{ev.description}</div>
                      </div>
                    ))}
                  </Section>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── 辅助组件 ──────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink mb-1 border-b border-surface-700/50 pb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ParamSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-ink-secondary">{label}</span>
        <span className="text-ink-muted">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

/** 档位预设按钮（§7: 传奇/平衡/史学） */
function PresetButton({ label, randomness, surprise, rigor, current, onChange }: {
  label: string; randomness: number; surprise: number; rigor: number;
  current: SimulationConfig; onChange: (c: SimulationConfig) => void;
}) {
  const active = Math.abs(current.randomness - randomness) < 0.01
    && Math.abs(current.surprise - surprise) < 0.01
    && Math.abs(current.rigor - rigor) < 0.01;
  return (
    <button
      onClick={() => onChange({ ...current, randomness, surprise, rigor })}
      className={`px-2 py-1 text-xs rounded ${active ? "bg-brand-600 text-white" : "bg-surface-800 text-ink-secondary hover:bg-surface-700"}`}
    >
      {label}
    </button>
  );
}

function EventRow({ ev, eventById, highlighted, onCausalClick }: {
  ev: SimulationEvent;
  eventById: Map<string, SimulationEvent>;
  highlighted: boolean;
  onCausalClick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const typeColor: Record<string, string> = {
    war: "text-error", conquest: "text-error", collapse: "text-error",
    founding: "text-brand", tech: "text-amber-500", diplomacy: "text-blue-500",
    disaster: "text-error", cultural: "text-purple-500", other: "text-ink-secondary",
    migration: "text-cyan-600", religion: "text-emerald-500", reform: "text-yellow-600",
  };
  // 自由类型(LLM 现场生成的独特类别, 不预设) → 用中性色, 不压成"other"
  const isKnown = ev.type in typeColor;
  const color = isKnown ? typeColor[ev.type] : "text-ink-secondary";
  const hasDetail = (ev.changes?.length ?? 0) > 0 || (ev.causals?.length ?? 0) > 0;
  return (
    <div id={`evt-${ev.id}`} className={`py-1 border-b border-surface-700/40 ${highlighted ? "bg-brand-600/10 ring-1 ring-brand-500/50 rounded" : ""}`}>
      <div className="flex gap-2 text-sm cursor-pointer" onClick={() => hasDetail && setOpen(!open)}>
        <span className="text-[0.625rem] text-ink-muted mt-0.5 flex-shrink-0">t{ev.tick}</span>
        <span className={`text-[0.625rem] mt-0.5 w-24 flex-shrink-0 truncate ${color}`} title={ev.type}>{ev.type}</span>
        <span className="text-ink text-xs leading-relaxed flex-1">{ev.description}</span>
        {ev.source === "decree" && <span className="text-[0.625rem] text-amber-500 flex-shrink-0">天意</span>}
        {hasDetail && <span className="text-[0.625rem] text-ink-muted flex-shrink-0">{open ? "▾" : "▸"}</span>}
      </div>
      {open && (
        <div className="ml-6 mt-1 space-y-0.5 text-[0.625rem] text-ink-muted">
          {ev.causals?.length ? (
            <div className="flex flex-wrap gap-1 items-center">前因:
              {ev.causals.map((cid) => {
                const target = eventById.get(cid);
                if (!target) return <span key={cid} className="text-ink-muted/60">{cid}</span>;
                return (
                  <button
                    key={cid}
                    onClick={(e) => { e.stopPropagation(); onCausalClick(cid); }}
                    title={`${target.description.slice(0, 60)}`}
                    className="text-ink-secondary hover:text-brand-400 underline decoration-dotted underline-offset-2"
                  >{target.type} (t{target.tick})</button>
                );
              })}
            </div>
          ) : null}
          {ev.changes?.map((c, i) => (
            <div key={i}>后果: {c.entity} {c.metrics ? `指标 ${JSON.stringify(c.metrics)}` : c.tech ? `维度 ${JSON.stringify(c.tech)}` : c.stance ? `关系 → ${c.stance}` : ""}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function createSessionDefaults(): SimulationConfig {
  return {
    randomness: 0.3, surprise: 0.3, rigor: 0.7,
    granularity: "macro", yearsPerTick: 10, autoJump: true,
    maxTicks: 100,
    budget: { perTickGlobal: 100_000, perEntity: 4_000, hotspotMultiplier: 4 },
    infoDelay: 2, maxEntities: null, seed: 42,
  };
}

// ── 发展/压力/治理展示辅助 ─────────────────────────────

/** 人口承载压力: 人口 / 复合承载(随发展水平上升, 高 dev 与食物脱钩) */
function popPressureOf(entity: EntityCard, session: SimulationSession): number {
  const region = session.regions?.[entity.geography.region];
  if (!region) return 0;
  const cap = populationCapacity(region.resources, developmentLevel(entity));
  return cap > 0 ? entity.metrics.population / cap : 0;
}

function popPressureColor(pressure: number): string {
  if (pressure >= 1) return "text-error";
  if (pressure >= 0.7) return "text-amber-500";
  return "text-ink-muted";
}

function devColor(dev: number): string {
  if (dev >= 75) return "bg-emerald-500";   // 高度发达
  if (dev >= 50) return "bg-brand-500";     // 成熟(金)
  if (dev >= 25) return "bg-sky-500";       // 早期发展(蓝)
  return "bg-surface-600";                  // 未开化(灰)
}

/** 关系敌意配色（hostility 0-1, LLM 判定, 不靠 stance 枚举） */
function relationColor(hostility?: number): string {
  const h = hostility ?? 0.3;
  if (h >= 0.7) return "text-error";
  if (h >= 0.4) return "text-amber-500";
  if (h >= 0.15) return "text-ink";
  return "text-brand";
}

/** 横向进度条（Tailwind, 无第三方依赖） */
function HBar({ label, value, max, color, sub }: {
  label?: string; value: number; max: number; color?: string; sub?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      {(label || sub) && (
        <div className="flex justify-between text-[0.625rem] mb-0.5">
          {label ? <span className="text-ink-secondary">{label}</span> : <span />}
          {sub ? <span className="text-ink-muted">{sub}</span> : null}
        </div>
      )}
      <div className="h-1.5 bg-surface-700 rounded overflow-hidden">
        <div className={`h-full ${color ?? "bg-brand-500"} rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[0.625rem]">
      <span className="text-ink-secondary">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

/** 实体列表行的紧凑压力条 */
function PressureBar({ entity, session }: { entity: EntityCard; session: SimulationSession }) {
  const pressure = popPressureOf(entity, session);
  const color = pressure >= 1 ? "bg-error" : pressure >= 0.7 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div className="h-1 bg-surface-700 rounded overflow-hidden">
      <div className={`h-full ${color} rounded`} style={{ width: `${Math.min(100, pressure * 100)}%` }} />
    </div>
  );
}

import { useState, useEffect } from "react";
import { useStore, type ModelConfig } from "@/lib/store";
import { invoke } from "@/lib/api";
import { X, Eye, EyeOff, SlidersHorizontal, Palette, Bot, UserRound, ArrowLeft } from "lucide-react";

type Props = { onClose: () => void };
type SettingsSection = "general" | "appearance" | "model" | "personalization";

const sections: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof SlidersHorizontal;
}> = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "model", label: "模型", icon: Bot },
  { id: "personalization", label: "个性化", icon: UserRound },
];

const DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
};

function inferProviderFromBaseUrl(url: string): string {
  const value = url.toLowerCase();
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("deepseek")) return "deepseek";
  return "openai";
}

function sanitizeModelName(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d{1,3};?)*m\]/g, "")
    .trim();
}

function normalizeModels(models: ModelConfig[]): ModelConfig[] {
  return models
    .map((model) => ({ ...model, name: sanitizeModelName(model.name) }))
    .filter((model) => model.name.length > 0);
}

export function SettingsPanel({ onClose }: Props) {
  const llmProvider = useStore((s) => s.llmProvider);
  const llmModels = useStore((s) => s.llmModels);
  const activeModel = useStore((s) => s.activeModel);
  const setLlmProvider = useStore((s) => s.setLlmProvider);
  const setLlmModels = useStore((s) => s.setLlmModels);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [models, setModels] = useState(llmModels);
  const [newModelName, setNewModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS[llmProvider] || DEFAULT_BASE_URLS.deepseek);

  // Sync with store
  useEffect(() => { setModels(normalizeModels(llmModels)); }, [llmModels]);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // If no provider set (first launch), default to first option
  useEffect(() => {
    if (!llmProvider) setLlmProvider("deepseek");
  }, []);

  useEffect(() => {
    invoke<{ baseUrl?: string }>("load_config")
      .then((cfg) => {
        if (cfg.baseUrl) setBaseUrl(cfg.baseUrl);
      })
      .catch(() => {});
  }, []);

  // Load API key for the current provider
  useEffect(() => {
    if (!llmProvider) return;
    invoke<string>("get_api_key", { provider: llmProvider })
      .then((key) => { if (key) setApiKey(key); })
      .catch(() => { setApiKey(""); });
  }, [llmProvider]);

  const handleSave = async () => {
    if (!apiKey) return;
    const provider = inferProviderFromBaseUrl(baseUrl);
    const cleanedModels = normalizeModels(models);
    const cleanedActiveModel = sanitizeModelName(useStore.getState().activeModel);
    try {
      await invoke("save_config", { provider, models: cleanedModels, key: apiKey, baseUrl });
      setLlmProvider(provider);
      setModels(cleanedModels);
      setLlmModels(cleanedModels);
      if (cleanedModels.length > 0) {
        setActiveModel(cleanedModels.some((m) => m.name === cleanedActiveModel) ? cleanedActiveModel : cleanedModels[0].name);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex gap-3 bg-surface-950 p-3">
      <nav className="w-60 flex-shrink-0 rounded-2xl border border-edge bg-surface-900/40 p-2">
        <div className="flex h-full flex-col">
          <button
            onClick={onClose}
            className="w-full h-9 px-2.5 rounded-md flex items-center gap-2 text-sm text-ink-muted hover:text-ink hover:bg-surface-800/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回应用</span>
          </button>

          <div className="my-2 h-px bg-edge" />

          <div className="space-y-1">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full h-9 px-2.5 rounded-md flex items-center gap-2 text-sm transition-colors ${
                    active
                      ? "bg-surface-800 text-ink"
                      : "text-ink-muted hover:text-ink hover:bg-surface-800/70"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="max-w-3xl px-4 py-2">
            {activeSection !== "model" ? (
              <section className="pt-5">
                <h2 className="text-xl font-semibold text-ink">
                  {sections.find((section) => section.id === activeSection)?.label}
                </h2>
              </section>
            ) : (
              <section className="pt-5">
                <h2 className="text-xl font-semibold text-ink mb-7">模型</h2>

                <div className="space-y-7">
                  <div>
                    <h3 className="text-sm font-medium text-ink mb-3">连接</h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">Base URL</label>
                        <input
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1/chat/completions"
                          className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                        />
                      </div>

                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">API Key</label>
                        <div className="relative w-96">
                          <input
                            type={showKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="输入 API Key..."
                            className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 pr-9 outline-none focus:border-brand-500/30 transition-colors font-mono"
                          />
                          <button
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                            title={showKey ? "隐藏 API Key" : "显示 API Key"}
                          >
                            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pl-[136px]">
                        <button
                          onClick={async () => {
                            setTesting(true);
                            setTestResult(null);
                            if (!apiKey) {
                              setTestResult({ ok: false, msg: "请先输入 API Key" });
                              setTesting(false);
                              return;
                            }
                            try {
                              const cleanedModels = normalizeModels(models);
                              const selectedModel = sanitizeModelName(activeModel);
                              const testModel = cleanedModels.some((m) => m.name === selectedModel)
                                ? selectedModel
                                : cleanedModels[0]?.name || "";
                              const result = await invoke<string>("test_connection", {
                                provider: inferProviderFromBaseUrl(baseUrl),
                                apiKey: apiKey,
                                model: testModel,
                                baseUrl,
                              });
                              setTestResult({ ok: true, msg: result });
                            } catch (e: any) {
                              setTestResult({ ok: false, msg: String(e) });
                            }
                            setTesting(false);
                          }}
                          disabled={testing}
                          className="px-3 h-8 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors disabled:opacity-50"
                        >
                          {testing ? "测试中..." : "测试连接"}
                        </button>
                        {testResult && (
                          <span className={`text-xs ${testResult.ok ? "text-success" : "text-error"}`}>
                            {testResult.msg}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-ink mb-3">模型</h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">默认模型</label>
                        <select
                          value={activeModel}
                          onChange={(e) => setActiveModel(e.target.value)}
                          className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2.5 outline-none focus:border-brand-500/30 transition-colors"
                        >
                          {models.length === 0 && <option value="">未配置模型</option>}
                          {models.map((m) => (
                            <option key={m.name} value={m.name}>{m.alias || m.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-start gap-6">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">可用模型</label>
                        <div className="w-[680px] space-y-1.5">
                          <div className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_32px] gap-2 px-0.5 text-[10px] text-ink-muted">
                            <span>模型 ID</span>
                            <span>展示名</span>
                            <span>推理强度</span>
                            <span>上下文窗口</span>
                            <span />
                          </div>
                          {models.map((m, i) => (
                            <div key={`${m.name}-${i}`} className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_32px] gap-2">
                              <input
                                value={m.name}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  next[i] = { ...next[i], name: sanitizeModelName(e.target.value) };
                                  setModels(next);
                                }}
                                placeholder="模型 ID"
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                              />
                              <input
                                value={m.alias || ""}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  next[i] = { ...next[i], alias: e.target.value };
                                  setModels(next);
                                }}
                                placeholder="展示名"
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                              />
                              <select
                                value={m.reasoningEffort || "default"}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  next[i] = { ...next[i], reasoningEffort: e.target.value as ModelConfig["reasoningEffort"] };
                                  setModels(next);
                                }}
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                              >
                                <option value="default">默认</option>
                                <option value="low">低</option>
                                <option value="medium">中</option>
                                <option value="high">高</option>
                              </select>
                              <input
                                value={m.contextWindow || ""}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  next[i] = { ...next[i], contextWindow: v && !isNaN(v) ? v : undefined };
                                  setModels(next);
                                }}
                                placeholder="128000"
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                              />
                              <button
                                onClick={() => setModels(models.filter((_, j) => j !== i))}
                                className="h-8 w-8 flex items-center justify-center rounded-md text-ink-muted hover:text-error hover:bg-surface-900 transition-colors"
                                title="删除模型"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <input
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && newModelName.trim()) {
                                  setModels([...models, { name: sanitizeModelName(newModelName), reasoningEffort: "default" }]);
                                  setNewModelName("");
                                }
                              }}
                              placeholder="添加模型 ID..."
                              className="w-72 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                            />
                            <button
                              onClick={() => {
                                if (newModelName.trim()) {
                                  setModels([...models, { name: sanitizeModelName(newModelName), reasoningEffort: "default" }]);
                                  setNewModelName("");
                                }
                              }}
                              className="w-14 h-8 text-xs text-ink-muted hover:text-ink bg-surface-900 border border-edge rounded-md transition-colors"
                            >
                              添加
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pl-[136px]">
                    <button
                      onClick={handleSave}
                      className="px-4 h-8 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors"
                    >
                      {saved ? "已保存 ✓" : "保存"}
                    </button>
                  </div>
                  <p className="pl-[136px] text-[10px] text-ink-muted">
                    API Key 存储在 ~/.worldforge/credentials.json（仅限本机访问）。
                  </p>
                </div>
              </section>
            )}
        </div>
      </main>
    </div>
  );
}

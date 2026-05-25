import { useState, useEffect } from "react";
import { useStore, type ModelConfig } from "@/lib/store";
import { invoke } from "@/lib/api";
import { X, Eye, EyeOff, SlidersHorizontal, Palette, Bot, UserRound, ArrowLeft } from "lucide-react";
import { MemoryManager } from "./MemoryManager";
import { useT } from "@/lib/i18n";

type Props = { onClose: () => void };
type SettingsSection = "general" | "appearance" | "model" | "personalization";

const sectionDefs: Array<{
  id: SettingsSection;
  icon: typeof SlidersHorizontal;
}> = [
  { id: "general", icon: SlidersHorizontal },
  { id: "appearance", icon: Palette },
  { id: "model", icon: Bot },
  { id: "personalization", icon: UserRound },
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
  const { t } = useT();
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

  useEffect(() => { setModels(normalizeModels(llmModels)); }, [llmModels]);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!llmProvider) setLlmProvider("deepseek");
  }, []);

  useEffect(() => {
    invoke<{ baseUrl?: string; activeModel?: string }>("load_config")
      .then((cfg) => {
        if (cfg.baseUrl) setBaseUrl(cfg.baseUrl);
        if (cfg.activeModel) setActiveModel(cfg.activeModel);
      })
      .catch(() => {});
  }, []);

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
      await invoke("save_config", { provider, models: cleanedModels, key: apiKey, baseUrl, activeModel: useStore.getState().activeModel });
      setLlmProvider(provider);
      setModels(cleanedModels);
      setLlmModels(cleanedModels);
      if (cleanedModels.length > 0) {
        setActiveModel(cleanedModels.some((m) => m.name === cleanedActiveModel) ? cleanedActiveModel : cleanedModels[0].name);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`${t.model.save}: ${e}`);
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
            <span>{t.settingsNav.back}</span>
          </button>

          <div className="my-2 h-px bg-edge" />

          <div className="space-y-1">
            {sectionDefs.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              const label = t.settingsNav[section.id] || section.id;
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
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="max-w-3xl px-4 py-2">
            {activeSection === "general" && (
              <GeneralSection />
            )}
            {activeSection === "appearance" && (
              <section className="pt-5">
                <h2 className="text-xl font-semibold text-ink mb-2">{t.appearance.title}</h2>
                <p className="text-xs text-ink-muted">{t.appearance.comingSoon}</p>
              </section>
            )}
            {activeSection === "personalization" && (
              <PersonalizationSection />
            )}
            {activeSection === "model" && (
              <section className="pt-5">
                <h2 className="text-xl font-semibold text-ink mb-7">{t.model.title}</h2>

                <div className="space-y-7">
                  <div>
                    <h3 className="text-sm font-medium text-ink mb-3">{t.model.connection}</h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.baseUrl}</label>
                        <input
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1/chat/completions"
                          className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                        />
                      </div>

                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.apiKey}</label>
                        <div className="relative w-96">
                          <input
                            type={showKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={t.model.enterApiKey}
                            className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 pr-9 outline-none focus:border-brand-500/30 transition-colors font-mono"
                          />
                          <button
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                            title={showKey ? t.model.hideKey : t.model.showKey}
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
                              setTestResult({ ok: false, msg: t.model.enterApiKeyFirst });
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
                          {testing ? t.model.testing : t.model.testConnection}
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
                    <h3 className="text-sm font-medium text-ink mb-3">{t.model.models}</h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-6 min-h-9">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.defaultModel}</label>
                        <select
                          value={activeModel}
                          onChange={(e) => setActiveModel(e.target.value)}
                          className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2.5 outline-none focus:border-brand-500/30 transition-colors"
                        >
                          {models.length === 0 && <option value="">{t.model.noModels}</option>}
                          {models.map((m) => (
                            <option key={m.name} value={m.name}>{m.alias || m.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-start gap-6">
                        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.availableModels}</label>
                        <div className="w-[680px] space-y-1.5">
                          <div className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_68px_32px] gap-2 px-0.5 text-[10px] text-ink-muted">
                            <span>{t.model.modelId}</span>
                            <span>{t.model.displayName}</span>
                            <span>{t.model.reasoningEffort}</span>
                            <span>{t.model.contextWindow}</span>
                            <span>{t.model.maxOutput}</span>
                            <span />
                          </div>
                          {models.map((m, i) => (
                            <div key={`${m.name}-${i}`} className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_68px_32px] gap-2">
                              <input
                                value={m.name}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  next[i] = { ...next[i], name: sanitizeModelName(e.target.value) };
                                  setModels(next);
                                }}
                                placeholder={t.model.modelId}
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                              />
                              <input
                                value={m.alias || ""}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  next[i] = { ...next[i], alias: e.target.value };
                                  setModels(next);
                                }}
                                placeholder={t.model.displayName}
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
                                <option value="default">{t.model.reasoningDefault}</option>
                                <option value="low">{t.model.reasoningLow}</option>
                                <option value="medium">{t.model.reasoningMedium}</option>
                                <option value="high">{t.model.reasoningHigh}</option>
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
                              <input
                                value={m.maxTokens || ""}
                                onChange={(e) => {
                                  const next: ModelConfig[] = [...models];
                                  const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  next[i] = { ...next[i], maxTokens: v && !isNaN(v) ? v : undefined };
                                  setModels(next);
                                }}
                                placeholder="64000"
                                className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                              />
                              <button
                                onClick={() => setModels(models.filter((_, j) => j !== i))}
                                className="h-8 w-8 flex items-center justify-center rounded-md text-ink-muted hover:text-error hover:bg-surface-900 transition-colors"
                                title={t.model.deleteModel}
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
                              placeholder={t.model.addModelPlaceholder}
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
                              {t.model.add}
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
                      {saved ? t.model.saved : t.model.save}
                    </button>
                  </div>
                  <p className="pl-[136px] text-[10px] text-ink-muted">
                    {t.model.apiKeyStorageNote}
                  </p>
                </div>
              </section>
            )}
        </div>
      </main>
    </div>
  );
}

function GeneralSection() {
  const { t } = useT();
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  const handleChangeLanguage = async (lang: "zh" | "en") => {
    setLanguage(lang);
    try { await invoke("save_language", { language: lang }); } catch {}
  };

  return (
    <section className="pt-5">
      <h2 className="text-xl font-semibold text-ink mb-7">{t.general.title}</h2>
      <div className="space-y-7">
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.general.language}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.general.language}</label>
            <div className="w-96 space-y-2">
              <select
                value={language}
                onChange={(e) => handleChangeLanguage(e.target.value as "zh" | "en")}
                className="w-40 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2.5 outline-none focus:border-brand-500/30 transition-colors"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
              <p className="text-[10px] text-ink-muted">{t.general.languageDesc}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonalizationSection() {
  const { t } = useT();
  const [customPrompt, setCustomPrompt] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<string>("load_custom_prompt")
      .then((p) => { if (p) setCustomPrompt(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      await invoke("save_custom_prompt", { customPrompt });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`${t.personalization.saveFailed}: ${e}`);
    }
  };

  return (
    <section className="pt-5">
      <h2 className="text-xl font-semibold text-ink mb-7">{t.personalization.title}</h2>

      <div className="space-y-7">
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.personalization.customInstructions}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.personalization.instructionsLabel}</label>
            <div className="w-96 space-y-2">
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={loading ? t.personalization.loading : t.personalization.instructionsPlaceholder}
                className="w-full h-40 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 py-1.5 outline-none focus:border-brand-500/30 transition-colors resize-y"
              />
              <p className="text-[10px] text-ink-muted">
                {t.personalization.instructionsHint}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 pl-[136px]">
            <button
              onClick={handleSave}
              className="px-4 h-8 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors"
            >
              {saved ? t.personalization.saved : t.personalization.save}
            </button>
          </div>
        </div>

        <MemoryManager />
      </div>
    </section>
  );
}

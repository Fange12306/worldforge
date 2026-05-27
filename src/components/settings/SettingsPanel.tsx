import { useState, useEffect } from "react";
import { useStore, type ModelConfig } from "@/lib/store";
import { invoke } from "@/lib/api";
import { X, Eye, EyeOff, SlidersHorizontal, Palette, Bot, UserRound, ArrowLeft, Pencil, Sun, Moon } from "lucide-react";
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

function clampCompressionThreshold(value: number): number {
  return Math.min(0.9, Math.max(0.5, value));
}

export function SettingsPanel({ onClose }: Props) {
  const { t } = useT();
  const llmProvider = useStore((s) => s.llmProvider);
  const llmModels = useStore((s) => s.llmModels);
  const activeModel = useStore((s) => s.activeModel);
  const setLlmProvider = useStore((s) => s.setLlmProvider);
  const setLlmModels = useStore((s) => s.setLlmModels);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const setCompressionThreshold = useStore((s) => s.setCompressionThreshold);
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [models, setModels] = useState(llmModels);
  const [newModelName, setNewModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS[llmProvider] || DEFAULT_BASE_URLS.deepseek);
  const [compressionThresholdDraft, setCompressionThresholdDraft] = useState(useStore.getState().compressionThreshold);

  useEffect(() => { setModels(normalizeModels(llmModels)); }, [llmModels]);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [bingApiKey, setBingApiKey] = useState("");
  const [showBingKey, setShowBingKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!llmProvider) setLlmProvider("deepseek");
  }, []);

  useEffect(() => {
    invoke<{ baseUrl?: string; activeModel?: string; compressionThreshold?: number }>("load_config")
      .then((cfg) => {
        if (cfg.baseUrl) setBaseUrl(cfg.baseUrl);
        if (cfg.activeModel) setActiveModel(cfg.activeModel);
        if (cfg.compressionThreshold != null) {
          const threshold = clampCompressionThreshold(cfg.compressionThreshold);
          setCompressionThreshold(threshold);
          setCompressionThresholdDraft(threshold);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!llmProvider) return;
    invoke<string>("get_api_key", { provider: llmProvider })
      .then((key) => { if (key) setApiKey(key); })
      .catch(() => { setApiKey(""); });
  }, [llmProvider]);

  useEffect(() => {
    invoke<string>("get_api_key", { provider: "bing_search" })
      .then((key) => { if (key) setBingApiKey(key); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!apiKey) return;
    const provider = inferProviderFromBaseUrl(baseUrl);
    const cleanedModels = normalizeModels(models);
    const cleanedActiveModel = sanitizeModelName(useStore.getState().activeModel);
    const compressionThreshold = clampCompressionThreshold(compressionThresholdDraft);
    try {
      await invoke("save_config", { provider, models: cleanedModels, key: apiKey, baseUrl, activeModel: useStore.getState().activeModel, compressionThreshold });
      if (bingApiKey) {
        await invoke("save_api_key", { provider: "bing_search", key: bingApiKey });
      }
      setLlmProvider(provider);
      setModels(cleanedModels);
      setLlmModels(cleanedModels);
      setCompressionThreshold(compressionThreshold);
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
              <AppearanceSection />
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

                  <div className="pt-4">
                    <h3 className="text-sm font-medium text-ink mb-3">搜索</h3>
                    <div className="flex items-start gap-6 min-h-9">
                      <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">Bing Search API Key</label>
                      <div className="relative w-96">
                        <input
                          type={showBingKey ? "text" : "password"}
                          value={bingApiKey}
                          onChange={(e) => setBingApiKey(e.target.value)}
                          placeholder="免费层 1000次/月，portal.azure.com 创建 Bing Search 资源获取"
                          className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 pr-9 outline-none focus:border-brand-500/30 transition-colors font-mono"
                        />
                        <button
                          onClick={() => setShowBingKey(!showBingKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                        >
                          {showBingKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <p className="pl-[136px] text-[0.625rem] text-ink-muted mt-1">Bing Web Search API v7，免费层每月 1000 次调用。不填则使用内置搜索。</p>
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
                          <div className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_68px_32px] gap-2 px-0.5 text-[0.625rem] text-ink-muted">
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

                  <CompressionThresholdSetting
                    value={compressionThresholdDraft}
                    onChange={setCompressionThresholdDraft}
                  />

                  <div className="flex items-center gap-2 pl-[136px]">
                    <button
                      onClick={handleSave}
                      className="px-4 h-8 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors"
                    >
                      {saved ? t.model.saved : t.model.save}
                    </button>
                  </div>
                  <p className="pl-[136px] text-[0.625rem] text-ink-muted">
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
  const [appVersion, setAppVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  const handleChangeLanguage = async (lang: "zh" | "en") => {
    setLanguage(lang);
    try { await invoke("save_language", { language: lang }); } catch {}
  };

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => setAppVersion("0.0.0"));
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckError("");
    try {
      const resp = await fetch("https://api.github.com/repos/fange12306/worldforge/releases/latest");
      if (!resp.ok) {
        if (resp.status === 403) throw new Error("rate_limit");
        throw new Error("fetch_failed");
      }
      const data = await resp.json();
      const tag = (data.tag_name || "").replace(/^v/, "");
      setLatestVersion(tag);
      setReleaseUrl(data.html_url || "https://github.com/fange12306/worldforge/releases");
    } catch (e: any) {
      setCheckError(e.message === "rate_limit" ? t.general.checkRateLimit : t.general.checkFailed);
    }
    setChecking(false);
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
              <p className="text-[0.625rem] text-ink-muted">{t.general.languageDesc}</p>
            </div>
          </div>
        </div>

        {/* Update Check */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.general.updates}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.general.currentVersion}</label>
            <div className="w-96 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink font-mono">v{appVersion || "..."}</span>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checking}
                  className="px-3 h-7 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors disabled:opacity-50"
                >
                  {checking ? t.general.checking : t.general.checkUpdate}
                </button>
              </div>
              {latestVersion && (
                <div className="flex items-center gap-2">
                  {latestVersion === appVersion ? (
                    <span className="text-xs text-success">{t.general.upToDate}</span>
                  ) : (
                    <>
                      <span className="text-xs text-amber-500">{t.general.newVersionFound(latestVersion)}</span>
                      <a
                        href={releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-500 hover:text-brand-400 underline transition-colors"
                      >
                        {t.general.downloadOnGitHub}
                      </a>
                    </>
                  )}
                </div>
              )}
              {checkError && (
                <p className="text-xs text-error">{checkError} <a href="https://github.com/fange12306/worldforge/releases" target="_blank" rel="noreferrer" className="underline">{t.general.releasesPage}</a></p>
              )}
              <p className="text-[0.625rem] text-ink-muted">
                {t.general.releasesPage}: github.com/fange12306/worldforge/releases
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonalizationSection() {
  const { t } = useT();
  const worlds = useStore((s) => s.worlds);
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
              <p className="text-[0.625rem] text-ink-muted">
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

        <WorldGuidanceSection />

        <MemoryManager />
      </div>
    </section>
  );
}

function WorldGuidanceSection() {
  const { t } = useT();
  // Discover ALL worlds from disk, not from the ephemeral store.
  // This ensures guidance from all worlds (including ones not currently open) is visible.
  const [diskWorlds, setDiskWorlds] = useState<{ name: string; path: string }[]>([]);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rootDir = await invoke<string>("get_worlds_dir");
        const listings = await invoke<{ name: string; path: string }[]>("list_worlds", { rootDir });
        if (cancelled) return;
        setDiskWorlds(listings);

        const result: Record<string, string> = {};
        await Promise.all(
          listings.map(async (w) => {
            try {
              const p = await invoke<string>("load_world_prompt", { worldPath: w.path });
              result[w.path] = p || "";
            } catch {
              result[w.path] = "";
            }
          })
        );
        if (!cancelled) {
          setPrompts(result);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleEdit = (worldPath: string) => {
    setEditing(worldPath);
    setEditContent(prompts[worldPath] || "");
  };

  const handleSave = async (worldPath: string) => {
    setSaving(true);
    try {
      await invoke("save_world_prompt", { worldPath, worldPrompt: editContent });
      setPrompts((prev) => ({ ...prev, [worldPath]: editContent }));
      setSaved((prev) => ({ ...prev, [worldPath]: true }));
      setTimeout(() => setSaved((prev) => ({ ...prev, [worldPath]: false })), 2000);
      setEditing(null);
    } catch (e) {
      alert(`${t.personalization.saveFailed}: ${e}`);
    }
    setSaving(false);
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">{t.personalization.worldInstructions}</h3>

      {loading ? (
        <p className="text-xs text-ink-muted italic">{t.personalization.loading}</p>
      ) : diskWorlds.length === 0 ? (
        <p className="text-xs text-ink-muted italic">{t.personalization.worldHintNoWorld}</p>
      ) : (
        <div className="space-y-0 max-w-[680px]">
          {diskWorlds.map((w) => {
            const isEditing = editing === w.path;
            const isSaved = saved[w.path];
            return (
              <div key={w.path}>
                <div className="flex items-center gap-3 py-2 border-b border-edge/30 last:border-0">
                  <span className="text-xs text-ink bg-surface-800 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[160px] truncate">
                    {w.name}
                  </span>
                  <span className="text-xs text-ink-muted truncate flex-1 min-w-0">
                    {prompts[w.path]
                      ? prompts[w.path].slice(0, 80) + (prompts[w.path].length > 80 ? "..." : "")
                      : t.personalization.worldPlaceholder}
                  </span>
                  <button
                    onClick={() => handleEdit(w.path)}
                    className="h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors flex-shrink-0"
                    title={t.memory.edit}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
                {isEditing && (
                  <div className="py-3 px-1 space-y-2 border-b border-edge/30">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full h-40 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 py-1.5 outline-none focus:border-brand-500/30 transition-colors resize-y"
                      placeholder={t.personalization.worldPlaceholder}
                    />
                    <p className="text-[0.625rem] text-ink-muted">
                      {t.personalization.worldHint(w.name)}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSave(w.path)}
                        disabled={saving}
                        className="px-3 h-7 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-500 transition-colors disabled:opacity-50"
                      >
                        {isSaved ? t.personalization.saved : t.personalization.save}
                      </button>
                      <button
                        onClick={() => { setEditing(null); setEditContent(""); }}
                        className="px-3 h-7 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors"
                      >
                        {t.memory.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompressionThresholdSetting({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useT();

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">{t.model.advanced}</h3>
      <div className="flex items-start gap-6 min-h-9">
        <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.compressionThreshold}</label>
        <div className="w-96 space-y-1.5">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="50"
              max="90"
              step="5"
              value={Math.round(value * 100)}
              onChange={(e) => onChange(parseInt(e.target.value) / 100)}
              className="flex-1 h-1.5 rounded-full appearance-none bg-surface-800 accent-brand-500 cursor-pointer"
            />
            <span className="w-10 text-right text-xs text-ink font-mono">
              {Math.round(value * 100)}%
            </span>
          </div>
          <p className="text-[0.625rem] text-ink-muted">
            {t.model.compressionThresholdDesc}
          </p>
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t } = useT();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const fontSize = useStore((s) => s.fontSize);
  const setFontSize = useStore((s) => s.setFontSize);

  const fontSizeOptions: Array<{ key: "sm" | "md" | "lg"; label: string }> = [
    { key: "sm", label: t.appearance.fontSizeSm },
    { key: "md", label: t.appearance.fontSizeMd },
    { key: "lg", label: t.appearance.fontSizeLg },
  ];

  return (
    <section className="pt-5">
      <h2 className="text-xl font-semibold text-ink mb-7">{t.appearance.title}</h2>
      <div className="space-y-7">
        {/* Theme */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.appearance.theme}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.appearance.theme}</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => { if (theme !== "dark") toggleTheme(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  theme === "dark" ? "bg-surface-800 border-brand-500/30 text-ink" : "border-edge text-ink-muted hover:text-ink hover:bg-surface-800"
                }`}
              >
                <Moon className="w-3.5 h-3.5" />{t.appearance.themeDark}
              </button>
              <button
                onClick={() => { if (theme !== "light") toggleTheme(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  theme === "light" ? "bg-surface-800 border-brand-500/30 text-ink" : "border-edge text-ink-muted hover:text-ink hover:bg-surface-800"
                }`}
              >
                <Sun className="w-3.5 h-3.5" />{t.appearance.themeLight}
              </button>
            </div>
          </div>
        </div>

        {/* Font Size */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.appearance.fontSize}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.appearance.fontSize}</label>
            <div className="flex gap-1.5">
              {fontSizeOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setFontSize(opt.key)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    fontSize === opt.key
                      ? "bg-surface-800 border-brand-500/30 text-ink"
                      : "border-edge text-ink-muted hover:text-ink hover:bg-surface-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useState, useEffect, useRef } from "react";
import { useStore, type ModelConfig, type ProviderConfig } from "@/lib/store";
import { invoke } from "@/lib/api";
import { X, Eye, EyeOff, SlidersHorizontal, Palette, Bot, UserRound, ArrowLeft, Pencil, Sun, Moon, Plus } from "lucide-react";
import { MemoryManager } from "./MemoryManager";
import { useT } from "@/lib/i18n";
import { WorldForgeLogo } from "@/components/brand/WorldForgeLogo";

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

const PRESET_PROVIDERS: ProviderConfig[] = [
  { id: "", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1/chat/completions", thinkingStyle: "deepseek" },
  { id: "", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1/messages", thinkingStyle: "anthropic" },
  { id: "", name: "OpenAI", baseUrl: "https://api.openai.com/v1/chat/completions", thinkingStyle: "none" },
];

function newProviderId(): string {
  return crypto.randomUUID();
}

function sanitizeModelName(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d{1,3};?)*m\]/g, "")
    .trim();
}

function normalizeModels(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>();
  return models
    .map((model) => ({ ...model, name: sanitizeModelName(model.name) }))
    .filter((model) => {
      if (model.name.length === 0) return false;
      if (!model.providerId) return false; // drop orphaned old-format models
      const key = `${model.providerId}::${model.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function clampCompressionThreshold(value: number): number {
  return Math.min(0.9, Math.max(0.5, value));
}

export function SettingsPanel({ onClose }: Props) {
  const { t } = useT();
  const activeSection = useStore((s) => useState<SettingsSection>("general")[0]);
  const [section, setSection] = useState<SettingsSection>("general");

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
            {sectionDefs.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              const label = t.settingsNav[s.id] || s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
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
            {section === "general" && <GeneralSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "personalization" && <PersonalizationSection />}
            {section === "model" && <ModelSection />}
        </div>
      </main>
    </div>
  );
}

// ── Model Section ────────────────────────────────────

function ModelSection() {
  const { t } = useT();
  const storeProviders = useStore((s) => s.providers);
  const setStoreProviders = useStore((s) => s.setProviders);
  const activeProviderId = useStore((s) => s.activeProviderId);
  const setActiveProviderId = useStore((s) => s.setActiveProviderId);
  const llmModels = useStore((s) => s.llmModels);
  const setLlmModels = useStore((s) => s.setLlmModels);
  const activeModel = useStore((s) => s.activeModel);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const setCompressionThreshold = useStore((s) => s.setCompressionThreshold);

  // Local copies for editing
  const [providers, setProviders] = useState<ProviderConfig[]>(storeProviders);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelConfig[]>(llmModels);
  const [compressionThresholdDraft, setCompressionThresholdDraft] = useState(useStore.getState().compressionThreshold);

  // Currently editing provider (defaults to active, or first)
  const [editingProviderId, setEditingProviderId] = useState<string>(
    activeProviderId || storeProviders[0]?.id || ""
  );

  // Sync from store on mount
  useEffect(() => {
    if (storeProviders.length > 0) setProviders(storeProviders);
  }, [storeProviders]);
  useEffect(() => { setModels(normalizeModels(llmModels)); }, [llmModels]);

  // Load persisted config
  useEffect(() => {
    invoke<{ providers?: string; models?: Array<ModelConfig>; activeProviderId?: string; activeModel?: string; compressionThreshold?: number }>("load_config")
      .then((cfg) => {
        if (cfg.providers) {
          try {
            const parsed: ProviderConfig[] = JSON.parse(cfg.providers);
            if (parsed.length > 0) {
              setProviders(parsed);
              setStoreProviders(parsed);
              if (!editingProviderId || !parsed.find((p) => p.id === editingProviderId)) {
                const target = parsed.find((p) => p.id === cfg.activeProviderId) || parsed[0];
                setEditingProviderId(target.id);
                setActiveProviderId(target.id);
              }
            }
          } catch {}
        }
        if (cfg.models && Array.isArray(cfg.models)) {
          const normalized = normalizeModels(cfg.models);
          setModels(normalized);
          setLlmModels(normalized);
        }
        if (cfg.activeModel) setActiveModel(cfg.activeModel);
        if (cfg.compressionThreshold != null) {
          const threshold = clampCompressionThreshold(cfg.compressionThreshold);
          setCompressionThreshold(threshold);
          setCompressionThresholdDraft(threshold);
        }
      })
      .catch(() => {});
  }, []);

  // Load API keys for all providers
  useEffect(() => {
    for (const p of providers) {
      if (!p.id) continue;
      invoke<string>("get_api_key", { provider: p.id })
        .then((key) => setApiKeys((prev) => ({ ...prev, [p.id]: key })))
        .catch(() => {});
    }
  }, [providers]);

  // Bing search key
  const [bingApiKey, setBingApiKey] = useState("");
  const [showBingKey, setShowBingKey] = useState(false);
  useEffect(() => {
    invoke<string>("get_api_key", { provider: "bing_search" })
      .then((key) => { if (key) setBingApiKey(key); })
      .catch(() => {});
  }, []);

  // Show/hide key toggles
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const currentProvider = providers.find((p) => p.id === editingProviderId);
  const currentModels = models.filter((m) => m.providerId === editingProviderId);
  const currentApiKey = apiKeys[editingProviderId] || "";

  // New model input
  const [newModelName, setNewModelName] = useState("");

  // Fetch models state
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ count: number } | null>(null);
  const [fetchError, setFetchError] = useState("");

  // Test connection
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Saved indicator
  const [saved, setSaved] = useState(false);

  // Add provider form
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProviderForm, setNewProviderForm] = useState<{
    name: string;
    baseUrl: string;
    thinkingStyle: ProviderConfig["thinkingStyle"];
  }>({ name: "", baseUrl: "", thinkingStyle: "none" });

  // ── Actions ──

  const handleSelectPreset = (presetIdx: number) => {
    const preset = PRESET_PROVIDERS[presetIdx];
    const id = newProviderId();
    const newProvider: ProviderConfig = { ...preset, id };
    const updated = [...providers, newProvider];
    setProviders(updated);
    setEditingProviderId(id);
    setAddingProvider(false);
  };

  const handleAddCustomProvider = () => {
    if (!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()) return;
    const newProvider: ProviderConfig = {
      id: newProviderId(),
      name: newProviderForm.name.trim(),
      baseUrl: newProviderForm.baseUrl.trim(),
      thinkingStyle: newProviderForm.thinkingStyle,
    };
    const updated = [...providers, newProvider];
    setProviders(updated);
    setEditingProviderId(newProvider.id);
    setAddingProvider(false);
    setNewProviderForm({ name: "", baseUrl: "", thinkingStyle: "none" });
  };

  const handleRemoveProvider = (id: string) => {
    if (providers.length <= 1) return;
    const updated = providers.filter((p) => p.id !== id);
    setProviders(updated);
    // Remove models belonging to this provider
    setModels((prev) => prev.filter((m) => m.providerId !== id));
    if (editingProviderId === id) {
      setEditingProviderId(updated[0]?.id || "");
    }
  };

  const handleUpdateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleFetchModels = async () => {
    if (!currentProvider) return;
    setFetching(true);
    setFetchResult(null);
    setFetchError("");
    try {
      const key = apiKeys[currentProvider.id] || "";
      const fetched: string[] = await invoke("fetch_models", {
        baseUrl: currentProvider.baseUrl,
        apiKey: key,
      });
      // Deduplicate against ALL models (across providers), not just current
      const existingNames = new Set(models.map((m) => m.name));
      const newOnes = fetched
        .filter((name) => !existingNames.has(name))
        .map((name) => ({
          name: sanitizeModelName(name),
          providerId: currentProvider.id,
          reasoningEffort: "disabled" as const,
        }));
      setModels((prev) => [...prev, ...newOnes]);
      setFetchResult({ count: fetched.length });
    } catch (e: any) {
      setFetchError(String(e));
    }
    setFetching(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    if (!currentApiKey) {
      setTestResult({ ok: false, msg: t.model.enterApiKeyFirst });
      setTesting(false);
      return;
    }
    try {
      const cleanedModels = normalizeModels(currentModels);
      const testModel = cleanedModels[0]?.name || currentProvider?.name || "";
      const result = await invoke<string>("test_connection", {
        provider: currentProvider?.thinkingStyle === "anthropic" ? "anthropic" : "openai",
        apiKey: currentApiKey,
        model: testModel,
        baseUrl: currentProvider?.baseUrl,
      });
      setTestResult({ ok: true, msg: result });
    } catch (e: any) {
      setTestResult({ ok: false, msg: String(e) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    // Persist API keys per provider
    for (const [providerId, key] of Object.entries(apiKeys)) {
      if (key) {
        try { await invoke("save_api_key", { provider: providerId, key }); } catch {}
      }
    }
    if (bingApiKey) {
      try { await invoke("save_api_key", { provider: "bing_search", key: bingApiKey }); } catch {}
    }

    const cleanedModels = normalizeModels(models);
    const cleanedActiveModel = sanitizeModelName(activeModel);
    const compressionThreshold = clampCompressionThreshold(compressionThresholdDraft);
    const activePid = editingProviderId || providers[0]?.id || "";

    try {
      await invoke("save_config", {
        providers: JSON.stringify(providers),
        models: cleanedModels,
        providerId: activePid,
        key: apiKeys[activePid] || "",
        baseUrl: currentProvider?.baseUrl || null,
        activeModel: cleanedActiveModel,
        compressionThreshold,
      });

      // Sync to store
      setStoreProviders(providers);
      setLlmModels(cleanedModels);
      setActiveProviderId(activePid);
      setCompressionThreshold(compressionThreshold);
      if (cleanedModels.length > 0) {
        const currentProviderModels = cleanedModels.filter((m) => m.providerId === activePid);
        setActiveModel(
          currentProviderModels.some((m) => m.name === cleanedActiveModel)
            ? cleanedActiveModel
            : currentProviderModels[0]?.name || cleanedModels[0].name
        );
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`${t.model.save}: ${e}`);
    }
  };

  return (
    <section className="pt-5">
      <h2 className="text-xl font-semibold text-ink mb-7">{t.model.title}</h2>

      <div className="space-y-7">
        {/* Provider Selection */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.model.providers}</h3>

          <div className="flex items-start gap-6 min-h-9">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.provider}</label>
            <div className="w-96 space-y-3">
              <div className="flex items-center gap-2">
                <select
                  value={editingProviderId}
                  onChange={(e) => setEditingProviderId(e.target.value)}
                  className="flex-1 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2.5 outline-none focus:border-brand-500/30 transition-colors"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setAddingProvider(true)}
                  className="h-8 w-8 flex items-center justify-center rounded-md border border-edge text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                  title={t.model.addProvider}
                >
                  <Plus className="w-4 h-4" />
                </button>
                {providers.length > 1 && (
                  <button
                    onClick={() => handleRemoveProvider(editingProviderId)}
                    className="h-8 w-8 flex items-center justify-center rounded-md border border-edge text-ink-muted hover:text-error hover:bg-surface-900 transition-colors"
                    title={t.model.deleteModel}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Add Provider Panel */}
              {addingProvider && (
                <div className="rounded-lg border border-edge bg-surface-900/50 p-3 space-y-2">
                  <p className="text-xs font-medium text-ink">{t.model.addProvider}</p>
                  {/* Presets */}
                  <div className="flex gap-2">
                    {PRESET_PROVIDERS.map((preset, idx) => (
                      <button
                        key={preset.name}
                        onClick={() => handleSelectPreset(idx)}
                        className="px-3 py-1.5 text-xs rounded-md border border-edge text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors"
                      >
                        {preset.name}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setAddingProvider(false);
                        setNewProviderForm({ name: "", baseUrl: "", thinkingStyle: "none" });
                      }}
                      className="px-3 py-1.5 text-xs rounded-md text-ink-muted hover:text-ink transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Custom provider form */}
                  <div className="space-y-2 pt-1">
                    <input
                      value={newProviderForm.name}
                      onChange={(e) => setNewProviderForm((f) => ({ ...f, name: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomProvider(); }}
                      placeholder={t.model.providerName}
                      className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                    />
                    <input
                      value={newProviderForm.baseUrl}
                      onChange={(e) => setNewProviderForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomProvider(); }}
                      placeholder={t.model.providerUrl}
                      className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                    />
                    <select
                      value={newProviderForm.thinkingStyle}
                      onChange={(e) => setNewProviderForm((f) => ({ ...f, thinkingStyle: e.target.value as ProviderConfig["thinkingStyle"] }))}
                      className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                    >
                      <option value="none">{t.model.customProvider}</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <button
                      onClick={handleAddCustomProvider}
                      disabled={!newProviderForm.name.trim() || !newProviderForm.baseUrl.trim()}
                      className="px-3 py-1.5 h-8 text-xs rounded-md bg-brand-600 text-white font-medium hover:bg-brand-500 transition-colors disabled:opacity-50"
                    >
                      {t.model.add}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Provider Config */}
        {currentProvider && (
          <>
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">{t.model.connection}</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-6 min-h-9">
                  <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.providerName}</label>
                  <input
                    value={currentProvider.name}
                    onChange={(e) => handleUpdateProvider(currentProvider.id, { name: e.target.value })}
                    className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                  />
                </div>

                <div className="flex items-start gap-6 min-h-9">
                  <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.baseUrl}</label>
                  <input
                    value={currentProvider.baseUrl}
                    onChange={(e) => handleUpdateProvider(currentProvider.id, { baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1/chat/completions"
                    className="w-96 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                  />
                </div>

                <div className="flex items-start gap-6 min-h-9">
                  <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.thinkingStyle}</label>
                  <div className="w-96 space-y-1.5">
                    <select
                      value={currentProvider.thinkingStyle}
                      onChange={(e) => handleUpdateProvider(currentProvider.id, { thinkingStyle: e.target.value as ProviderConfig["thinkingStyle"] })}
                      className="w-40 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2.5 outline-none focus:border-brand-500/30 transition-colors"
                    >
                      <option value="none">{t.model.customProvider}</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <p className="text-[0.625rem] text-ink-muted">{t.model.thinkingStyleHint}</p>
                  </div>
                </div>

                <div className="flex items-start gap-6 min-h-9">
                  <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.apiKey}</label>
                  <div className="relative w-96">
                    <input
                      type={showKeys[currentProvider.id] ? "text" : "password"}
                      value={currentApiKey}
                      onChange={(e) => setApiKeys((prev) => ({ ...prev, [currentProvider.id]: e.target.value }))}
                      placeholder={t.model.enterApiKey}
                      className="w-full h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 pr-9 outline-none focus:border-brand-500/30 transition-colors font-mono"
                    />
                    <button
                      onClick={() => setShowKeys((prev) => ({ ...prev, [currentProvider.id]: !prev[currentProvider.id] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"
                    >
                      {showKeys[currentProvider.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pl-[136px]">
                  <button
                    onClick={handleFetchModels}
                    disabled={fetching}
                    className="px-3 h-8 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors disabled:opacity-50"
                  >
                    {fetching ? t.model.fetchingModels : t.model.fetchModels}
                  </button>
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-3 h-8 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors disabled:opacity-50"
                  >
                    {testing ? t.model.testing : t.model.testConnection}
                  </button>
                  {fetchResult && (
                    <span className="text-xs text-success">{t.model.fetchSuccess.replace("{n}", String(fetchResult.count))}</span>
                  )}
                  {fetchError && (
                    <span className="text-xs text-error">{t.model.fetchFailed}: {fetchError}</span>
                  )}
                  {testResult && (
                    <span className={`text-xs ${testResult.ok ? "text-success" : "text-error"}`}>
                      {testResult.msg}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Models */}
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
                    {currentModels.length === 0 && <option value="">{t.model.noModels}</option>}
                    {currentModels.map((m) => (
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
                    {currentModels.map((m, i) => {
                      const globalIdx = models.findIndex((gm) => gm.name === m.name && gm.providerId === m.providerId);
                      const thinkingEnabled = currentProvider.thinkingStyle !== "none";
                      return (
                        <div key={`${m.name}-${i}`} className="grid grid-cols-[minmax(0,1fr)_120px_104px_100px_68px_32px] gap-2">
                          <input
                            value={m.name}
                            onChange={(e) => {
                              const next = [...models];
                              next[globalIdx] = { ...next[globalIdx], name: sanitizeModelName(e.target.value) };
                              setModels(next);
                            }}
                            placeholder={t.model.modelId}
                            className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                          />
                          <input
                            value={m.alias || ""}
                            onChange={(e) => {
                              const next = [...models];
                              next[globalIdx] = { ...next[globalIdx], alias: e.target.value };
                              setModels(next);
                            }}
                            placeholder={t.model.displayName}
                            className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                          />
                          <select
                            value={thinkingEnabled ? (m.reasoningEffort || "disabled") : "disabled"}
                            disabled={!thinkingEnabled}
                            onChange={(e) => {
                              const next = [...models];
                              next[globalIdx] = { ...next[globalIdx], reasoningEffort: e.target.value as ModelConfig["reasoningEffort"] };
                              setModels(next);
                            }}
                            className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors disabled:opacity-40"
                          >
                            <option value="disabled">{t.model.reasoningOff}</option>
                            {thinkingEnabled && (
                              <>
                                <option value="low">{t.model.reasoningLow}</option>
                                <option value="medium">{t.model.reasoningMedium}</option>
                                <option value="high">{t.model.reasoningHigh}</option>
                                <option value="max">{t.model.reasoningMax}</option>
                              </>
                            )}
                          </select>
                          <input
                            value={m.contextWindow || ""}
                            onChange={(e) => {
                              const next = [...models];
                              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              next[globalIdx] = { ...next[globalIdx], contextWindow: v && !isNaN(v) ? v : undefined };
                              setModels(next);
                            }}
                            placeholder="128000"
                            className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                          />
                          <input
                            value={m.maxTokens || ""}
                            onChange={(e) => {
                              const next = [...models];
                              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              next[globalIdx] = { ...next[globalIdx], maxTokens: v && !isNaN(v) ? v : undefined };
                              setModels(next);
                            }}
                            placeholder="64000"
                            className="h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                          />
                          <button
                            onClick={() => setModels(models.filter((_, j) => j !== globalIdx))}
                            className="h-8 w-8 flex items-center justify-center rounded-md text-ink-muted hover:text-error hover:bg-surface-900 transition-colors"
                            title={t.model.deleteModel}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <input
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newModelName.trim() && currentProvider) {
                            setModels([...models, { name: sanitizeModelName(newModelName), providerId: currentProvider.id, reasoningEffort: "disabled" }]);
                            setNewModelName("");
                          }
                        }}
                        placeholder={t.model.addModelPlaceholder}
                        className="w-72 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                      />
                      <button
                        onClick={() => {
                          if (newModelName.trim() && currentProvider) {
                            setModels([...models, { name: sanitizeModelName(newModelName), providerId: currentProvider.id, reasoningEffort: "disabled" }]);
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
          </>
        )}

        {/* Bing Search Key (independent of provider) */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.model.searchTitle}</h3>
          <div className="flex items-start gap-6 min-h-9">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.model.searchApiKeyLabel}</label>
            <div className="relative w-96">
              <input
                type={showBingKey ? "text" : "password"}
                value={bingApiKey}
                onChange={(e) => setBingApiKey(e.target.value)}
                placeholder={t.model.searchApiKeyPlaceholder}
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
          <p className="pl-[136px] text-[0.625rem] text-ink-muted mt-1">{t.model.searchApiKeyHint}</p>
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
  );
}

// ── General Section ──────────────────────────────────

function GeneralSection() {
  const { t } = useT();
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);
  const setStoreAvatar = useStore((s) => s.setAvatar);
  const setStoreUsername = useStore((s) => s.setUsername);
  const [appVersion, setAppVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  const [avatar, setAvatar] = useState("");
  const [username, setUsername] = useState("");
  const [usernameSaved, setUsernameSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<string>("load_avatar").then(setAvatar).catch(() => {});
    invoke<string>("load_username").then((u) => { if (u) setUsername(u); }).catch(() => {});
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const resized = await resizeImage(dataUrl, 128);
      setAvatar(resized);
      setStoreAvatar(resized);
      try { await invoke("save_avatar", { avatarDataUrl: resized }); } catch {}
    };
    reader.readAsDataURL(file);
  };

  const handleSaveUsername = async () => {
    try {
      await invoke("save_username", { username });
      setStoreUsername(username);
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 2000);
    } catch {}
  };

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
          <h3 className="text-sm font-medium text-ink mb-3">{t.general.profile}</h3>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.general.avatar}</label>
            <div className="w-96 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative w-14 h-14 rounded-full overflow-hidden border-2 border-edge hover:border-brand-500/40 transition-colors flex-shrink-0 bg-surface-800"
                >
                  {avatar ? (
                    <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-muted">
                      <UserRound className="w-6 h-6" />
                    </div>
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <span className="text-[0.625rem] text-ink-muted">{t.general.avatarHint}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-start gap-6">
            <label className="w-28 pt-2 text-xs text-ink-secondary flex-shrink-0">{t.general.username}</label>
            <div className="w-96 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveUsername(); }}
                  placeholder={t.general.usernamePlaceholder}
                  className="w-48 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors"
                />
                <button
                  onClick={handleSaveUsername}
                  className="px-3 h-7 rounded-md border border-edge text-xs text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors"
                >
                  {usernameSaved ? t.personalization.saved : t.personalization.save}
                </button>
              </div>
            </div>
          </div>
        </div>

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

        <div>
          <h3 className="text-sm font-medium text-ink mb-3">{t.general.about}</h3>
          <div className="bg-surface-800/50 border border-surface-700/50 rounded-xl p-5 max-w-md">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-shrink-0">
                <WorldForgeLogo className="w-14 h-14" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-ink">WorldForge</h4>
                <p className="text-[0.688rem] text-ink-muted font-mono">v{appVersion || "..."}</p>
              </div>
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed mb-4">
              {t.general.aboutDesc}
            </p>
            <div className="flex items-center gap-4 text-[0.688rem] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-success" />
                MIT License
              </span>
              <a
                href="https://github.com/fange12306/worldforge"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand-500 hover:text-brand-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                {t.general.sourceCode}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Personalization Section ──────────────────────────

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

// ── Compression Threshold ────────────────────────────

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

// ── Appearance Section ───────────────────────────────

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

/** Resize an image data URL to a square of the given size. */
function resizeImage(dataUrl: string, size: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

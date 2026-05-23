import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { invoke } from "@/lib/api";
import { X, Eye, EyeOff } from "lucide-react";

type Props = { onClose: () => void };

export function SettingsPanel({ onClose }: Props) {
  const llmProvider = useStore((s) => s.llmProvider);
  const llmModels = useStore((s) => s.llmModels);
  const setLlmProvider = useStore((s) => s.setLlmProvider);
  const setLlmModels = useStore((s) => s.setLlmModels);
  const [models, setModels] = useState(llmModels);
  const [newModelName, setNewModelName] = useState("");

  // Sync with store
  useEffect(() => { setModels(llmModels); }, [llmModels]);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // If no provider set (first launch), default to first option
  useEffect(() => {
    if (!llmProvider) setLlmProvider("deepseek");
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
    try {
      await invoke("save_config", { provider: llmProvider, models, key: apiKey });
      setLlmModels(models);
      if (models.length > 0 && !useStore.getState().activeModel) {
        useStore.getState().setActiveModel(models[0].name);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-950">
        <div className="h-12 flex items-center justify-between px-3 flex-shrink-0">
          <span className="text-sm font-semibold text-ink">设置</span>
          <button onClick={onClose} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="mx-4 h-px bg-surface-700" />

        <div className="overflow-auto p-4 space-y-6">
        {/* API Key section */}
        <section>
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
            LLM API 配置
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-ink-secondary block mb-1">Provider</label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                className="w-full h-9 rounded-lg bg-surface-900 border border-edge text-sm text-ink px-3 outline-none focus:border-brand-500/30 transition-colors"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-ink-secondary block mb-1">Models</label>
              <div className="space-y-1.5">
                {models.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-2">
                    <input
                      value={m.name}
                      onChange={(e) => {
                        const next = [...models];
                        next[i] = { name: e.target.value };
                        setModels(next);
                      }}
                      className="flex-1 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                    />
                    <button
                      onClick={() => setModels(models.filter((_, j) => j !== i))}
                      className="text-[10px] text-ink-muted hover:text-error transition-colors"
                    >✕</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newModelName.trim()) {
                        setModels([...models, { name: newModelName.trim() }]);
                        setNewModelName("");
                      }
                    }}
                    placeholder="添加模型名..."
                    className="flex-1 h-8 rounded-md bg-surface-900 border border-edge text-xs text-ink px-2 outline-none focus:border-brand-500/30 transition-colors font-mono"
                  />
                  <button
                    onClick={() => {
                      if (newModelName.trim()) {
                        setModels([...models, { name: newModelName.trim() }]);
                        setNewModelName("");
                      }
                    }}
                    className="px-2 h-8 text-[10px] text-ink-muted hover:text-ink bg-surface-900 border border-edge rounded-md"
                  >添加</button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-ink-secondary block mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入 API Key..."
                  className="w-full h-9 rounded-lg bg-surface-900 border border-edge text-sm text-ink px-3 pr-9 outline-none focus:border-brand-500/30 transition-colors font-mono"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
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
                    const result = await invoke<string>("test_connection", {
                      provider: llmProvider,
                      apiKey: apiKey,
                      model: models[0]?.name || "",
                    });
                    setTestResult({ ok: true, msg: result });
                  } catch (e: any) {
                    setTestResult({ ok: false, msg: String(e) });
                  }
                  setTesting(false);
                }}
                disabled={testing}
                className="px-3 h-9 rounded-lg border border-edge text-sm text-ink-secondary hover:text-ink hover:bg-surface-800 transition-colors disabled:opacity-50"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button
                onClick={handleSave}
                className="flex-1 h-9 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 transition-colors"
              >
                {saved ? "已保存 ✓" : "保存"}
              </button>
            </div>
            {testResult && (
              <p className={`text-xs ${testResult.ok ? "text-success" : "text-error"}`}>
                {testResult.msg}
              </p>
            )}
            <p className="text-[10px] text-ink-muted">
              API Key 存储在 ~/.worldforge/credentials.json（仅限本机访问）。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

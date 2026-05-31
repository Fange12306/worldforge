import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { APP_NAME } from "@/lib/constants";
import { invoke } from "@/lib/api";
import { getVersion } from "@tauri-apps/api/app";
import { FolderOpen } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Message } from "@/lib/store";

function countVisibleMessages(messages: Message[]): number {
  let count = 0;
  let previousRole: "user" | "assistant" | null = null;
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant" && previousRole === "assistant") {
      continue;
    }
    count += 1;
    previousRole = message.role;
  }
  return count;
}

export function StatusBar() {
  const { t } = useT();
  const [appVersion, setAppVersion] = useState("...");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => setAppVersion("?.?.?")); }, []);
  const worlds = useStore((s) => s.worlds);
  const activeWorldId = useStore((s) => s.activeWorldId);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const isStreaming = useStore((s) => s.isStreaming);
  const streamingConvId = useStore((s) => s.streamingConversationId);
  const streamingHere = isStreaming && streamingConvId === activeConversationId;

  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const activeStory = activeWorld?.stories.find((s) =>
    s.conversations.some((c) => c.id === activeConversationId),
  );
  const activeConv = activeStory?.conversations.find(
    (c) => c.id === activeConversationId,
  );
  const msgCount = activeConv ? countVisibleMessages(activeConv.messages) : 0;
  const totalTokens = activeConv?.totalTokens ?? 0;
  const cacheHitTokens = activeConv?.cacheHitTokens ?? 0;
  const cacheMissTokens = activeConv?.cacheMissTokens ?? 0;
  const totalCacheTokens = cacheHitTokens + cacheMissTokens;
  const cacheHitPct = totalCacheTokens > 0
    ? ((cacheHitTokens / totalCacheTokens) * 100).toFixed(0)
    : null;

  const fmtTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const handleReveal = async () => {
    if (!activeWorld) return;
    try {
      await invoke("reveal_world_folder", { path: activeWorld.path });
    } catch (e) {
      console.error("reveal failed:", e);
    }
  };

  return (
    <footer className="h-7 flex items-center justify-between px-3 text-[0.688rem] text-ink-muted flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span>{streamingHere ? t.chat.streaming : t.chat.ready}</span>
        {activeConv && <span>{msgCount} {t.chat.messages}</span>}
        {totalTokens > 0 && <span>{fmtTokens(totalTokens)} tokens</span>}
        {totalCacheTokens > 0 && cacheHitPct && (
          <span title={`Hit: ${fmtTokens(cacheHitTokens)}, Miss: ${fmtTokens(cacheMissTokens)}`}>
            {t.chat.cacheHitRate(`${cacheHitPct}%`)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {activeWorld && (
          <button onClick={handleReveal} className="flex items-center gap-1 hover:text-ink-secondary transition-colors" title={t.chat.revealWorld}>
            <FolderOpen className="w-3 h-3" />
            {activeWorld.name}
          </button>
        )}
        <span>{APP_NAME} v{appVersion}</span>
      </div>
    </footer>
  );
}

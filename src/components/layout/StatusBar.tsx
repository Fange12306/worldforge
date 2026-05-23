import { useStore } from "@/lib/store";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { invoke } from "@/lib/api";
import { FolderOpen } from "lucide-react";

export function StatusBar() {
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
  const msgCount = activeConv?.messages.length ?? 0;
  const totalTokens = activeConv?.totalTokens ?? 0;

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
    <footer className="h-7 flex items-center justify-between px-3 text-[11px] text-ink-muted flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span>{streamingHere ? "生成中..." : "就绪"}</span>
        {activeConv && <span>{msgCount} 条消息</span>}
        {totalTokens > 0 && <span>{fmtTokens(totalTokens)} tokens</span>}
      </div>
      <div className="flex items-center gap-3">
        {activeWorld && (
          <button onClick={handleReveal} className="flex items-center gap-1 hover:text-ink-secondary transition-colors" title="在 Finder 中打开世界文件夹">
            <FolderOpen className="w-3 h-3" />
            {activeWorld.name}
          </button>
        )}
        <span>{APP_NAME} v{APP_VERSION}</span>
      </div>
    </footer>
  );
}

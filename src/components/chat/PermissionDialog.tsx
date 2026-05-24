import type { PermissionChoice } from "@/lib/agent-loop";

type Props = {
  toolName: string;
  details: string;
  isDangerous?: boolean;
  onChoose: (choice: PermissionChoice) => void;
  onDismiss: () => void;
};

export function InlinePermission({ toolName, details, isDangerous, onChoose, onDismiss }: Props) {
  return (
    <div className="animate-fade-in px-4 mb-2">
      <div className={`max-w-3xl mx-auto bg-surface-800 rounded-2xl border px-4 py-2.5 ${isDangerous ? "border-red-700/50" : "border-surface-700"}`}>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-secondary">
            {isDangerous && <span className="text-red-400 mr-1">⚠️</span>}
            Agent 想执行 <span className={`font-mono ${isDangerous ? "text-red-400" : "text-brand-400"}`}>{toolName}</span>
            {details ? <span className="text-ink-muted"> — {details}</span> : ""}
          </span>
          <div className="flex-1" />
          <div className="flex gap-1">
            {!isDangerous && (
              <button onClick={() => onChoose("session")} className="px-3 py-1 text-[11px] rounded-lg bg-brand-600 text-white hover:bg-brand-500 transition-colors">
                始终允许
              </button>
            )}
            <button onClick={() => onChoose("once")} className="px-3 py-1 text-[11px] rounded-lg bg-surface-700 text-ink hover:bg-surface-600 transition-colors">
              允许一次
            </button>
            <button onClick={() => onChoose("deny")} className="px-2 py-1 text-[11px] text-ink-muted hover:text-ink transition-colors">
              拒绝
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

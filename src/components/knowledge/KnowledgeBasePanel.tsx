/**
 * KnowledgeBasePanel — 知识库只读浏览面板。
 *
 * 知识库 = app 级内置的 markdown 指导文档合集（随应用打包, 所有世界共享, 只读）。
 * - 索引: public/knowledge-base/index.json（分类 → 文档列表）
 * - 文档: public/knowledge-base/<category>/<doc>.md
 * - 本面板只渲染, 无任何编辑/写入入口。
 */

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { X, BookOpen, FileText, ChevronDown, ChevronRight } from "lucide-react";

const INDEX_URL = "knowledge-base/index.json";

type KbDoc = {
  id: string;
  title: string;
  titleEn?: string;
  path: string;
};

type KbCategory = {
  id: string;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  docs: KbDoc[];
};

type KbIndex = {
  name?: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  categories: KbCategory[];
};

/** 按当前语言取标题（无对应语言字段时 fallback 另一种） */
function pickLabel(zh?: string, en?: string, language?: string): string {
  if (language === "en") return en || zh || "";
  return zh || en || "";
}

export function KnowledgeBasePanel({ onClose }: { onClose: () => void }) {
  const { t, language } = useT();
  const theme = useStore((s) => s.theme);

  const [index, setIndex] = useState<KbIndex | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  // 加载索引
  useEffect(() => {
    let cancelled = false;
    fetch(INDEX_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: KbIndex) => {
        if (cancelled) return;
        setIndex(data);
        setLoadFailed(false);
        // 默认展开第一个有文档的分类
        const first = data.categories?.find((c) => (c.docs?.length ?? 0) > 0);
        if (first) setActiveCategory(first.id);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  const loadDoc = useCallback(async (category: KbCategory, doc: KbDoc) => {
    setActiveDoc(doc.id);
    setDocContent(null);
    setDocLoading(true);
    try {
      const r = await fetch(`knowledge-base/${doc.path}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setDocContent(text);
    } catch {
      setDocContent(null);
    } finally {
      setDocLoading(false);
    }
  }, []);

  const proseClass = `prose prose-sm max-w-none ${theme === "dark" ? "prose-invert" : ""}`;
  const activeCategoryObj = index?.categories.find((c) => c.id === activeCategory) ?? null;
  const activeDocObj = activeCategoryObj?.docs.find((d) => d.id === activeDoc) ?? null;

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-brand-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-ink flex-shrink-0">{t.knowledge.title}</span>
          <span className="text-[0.625rem] text-ink-muted truncate">
            {pickLabel(index?.description, index?.descriptionEn, language)}
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-800 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mx-4 h-px bg-surface-700" />

      {/* Body: category nav (left) + doc view (right) */}
      <div className="flex-1 min-h-0 flex">
        {/* ── 分类 + 文档导航 ── */}
        <div className="w-52 flex-shrink-0 border-r border-surface-700 min-h-0 flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadFailed && (
                <p className="text-xs text-ink-muted px-2 py-3">{t.knowledge.loadFailed}</p>
              )}
              {!loadFailed && !index && (
                <p className="text-xs text-ink-muted px-2 py-3">{t.knowledge.loading}</p>
              )}
              {index?.categories.map((cat) => {
                const expanded = cat.id === activeCategory;
                const hasDocs = (cat.docs?.length ?? 0) > 0;
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => {
                        setActiveCategory(expanded ? null : cat.id);
                        setActiveDoc(null);
                        setDocContent(null);
                      }}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors text-left text-xs",
                        expanded
                          ? "bg-surface-800 text-ink"
                          : "text-ink-secondary hover:text-ink hover:bg-surface-850",
                      )}
                    >
                      {hasDocs ? (
                        expanded
                          ? <ChevronDown className="w-3 h-3 text-ink-muted flex-shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-ink-muted flex-shrink-0" />
                      ) : (
                        <span className="w-3 h-3 flex-shrink-0" />
                      )}
                      <span className="font-medium truncate flex-1">
                        {pickLabel(cat.title, cat.titleEn, language)}
                      </span>
                    </button>
                    {expanded && (
                      <div className="ml-4 space-y-0.5 mt-0.5">
                        {cat.docs.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => loadDoc(cat, doc)}
                            className={cn(
                              "w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-left text-[0.688rem]",
                              doc.id === activeDoc
                                ? "bg-surface-800 text-ink"
                                : "text-ink-muted hover:text-ink hover:bg-surface-850",
                            )}
                          >
                            <FileText className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate flex-1">{pickLabel(doc.title, doc.titleEn, language)}</span>
                          </button>
                        ))}
                        {!hasDocs && (
                          <p className="text-[0.625rem] text-ink-muted/60 px-2 py-1">{t.knowledge.noDocs}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* ── 文档内容（只读） ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-auto">
            {docLoading && (
              <div className="h-full flex items-center justify-center text-xs text-ink-muted">{t.knowledge.loading}</div>
            )}
            {!docLoading && activeDocObj && docContent !== null && (
              <div className={`p-4 ${proseClass}`}>
                <h1 className="text-lg font-bold text-ink mb-1">{pickLabel(activeDocObj.title, activeDocObj.titleEn, language)}</h1>
                <div className="text-[0.625rem] text-ink-muted/50 mb-4">{t.knowledge.readonly}</div>
                <MarkdownContent content={docContent} />
              </div>
            )}
            {!docLoading && !activeDocObj && (
              <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
                <BookOpen className="w-10 h-10 text-ink-muted opacity-30" />
                {activeCategoryObj ? (
                  <>
                    <p className="text-sm font-medium text-ink">
                      {pickLabel(activeCategoryObj.title, activeCategoryObj.titleEn, language)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {pickLabel(activeCategoryObj.description, activeCategoryObj.descriptionEn, language)}
                    </p>
                    <p className="text-xs text-ink-muted/60">{t.knowledge.emptyHint}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-ink">{t.knowledge.title}</p>
                    <p className="text-xs text-ink-muted">{pickLabel(index?.description, index?.descriptionEn, language)}</p>
                  </>
                )}
              </div>
            )}
            {!docLoading && activeDocObj && docContent === null && (
              <div className="h-full flex items-center justify-center text-xs text-ink-muted">{t.knowledge.loadFailed}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

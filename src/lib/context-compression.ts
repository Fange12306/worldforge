/**
 * Context Compression — summarizes older conversation turns with an LLM call
 * to stay within the model's context window.
 */

import { invoke } from "./api";
import { estimateTokens } from "./context-window";
import type { AgentMessage } from "./agent-loop";

// ── Types ──

export type CompressionConfig = {
  threshold: number; // 0-1, e.g. 0.8 = compress at 80% context usage
  keepTurns?: number; // how many most-recent turns to keep intact
};

export const RECENT_TURNS_TO_KEEP = 5;
const COMPRESSION_MIN_TURNS = 3;
const COMPRESSION_TARGET_TOKENS = 5000;
const COMPRESSION_MAX_OUTPUT_TOKENS = 6000;

const DEFAULT_CONFIG: CompressionConfig = {
  threshold: 0.8,
  keepTurns: RECENT_TURNS_TO_KEEP,
};

export type CompressionResult = {
  messages: AgentMessage[];
  compressed: boolean;
  summary: string;
  tokenSavings: number;
  originalRange: [number, number] | null;
};

// ── Helpers ──

/** Group messages into turns: a user message + all following non-user messages until next user. */
function groupTurns(messages: AgentMessage[]): AgentMessage[][] {
  const turns: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (current.length > 0) turns.push(current);
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/** Estimate tokens for an array of messages. */
function estimateMessageTokens(msgs: AgentMessage[]): number {
  return msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// ── Summarization prompt ──

function extractSummary(content: string): string {
  const match = content.match(/<summary>([\s\S]*)<\/summary>/);
  return (match ? match[1] : content).trim();
}

function buildCompressionPrompt(
  previousSummaries: string[],
  newTranscript: AgentMessage[],
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = [
    "You are a conversation summarizer for a world-building application.",
    `Write a complete structured compression summary around ${COMPRESSION_TARGET_TOKENS} tokens, never exceeding ${COMPRESSION_MAX_OUTPUT_TOKENS} tokens.`,
    "If an existing summary is provided, merge it with the new transcript into one complete replacement summary. Do not output a patch or append-only delta.",
    "Hard preservation requirements:",
    "- Preserve all entity create/update/delete decisions for entries, events, outlines/chapters, timelines, and relations.",
    "- Preserve entity names, IDs, timeline IDs, chapter IDs, relation IDs, and file paths whenever present.",
    "- Preserve user corrections, preferences, hard constraints, world rules, and rejected approaches.",
    "- Preserve unresolved tasks, pending questions, risks, and decisions that still affect future work.",
    "- Preserve important facts from TOOL_RESULT blocks; they are authoritative world data.",
    "Drop casual greetings, repeated search/read output, format negotiation, and redundant reasoning.",
    "Use the same primary language as the conversation.",
    "Output exactly this Markdown structure:",
    "## Current Goal",
    "- ...",
    "## World Facts",
    "- ...",
    "## User Preferences And Constraints",
    "- ...",
    "## Entity Changes To Preserve",
    "- Entries: ...",
    "- Events: ...",
    "- Outlines/Chapters: ...",
    "- Timelines: ...",
    "- Relations: ...",
    "## Important Entity IDs",
    "- ...",
    "## Files And Research",
    "- ...",
    "## Completed Work",
    "- ...",
    "## Open Tasks",
    "- ...",
    "## Risks And Pending Confirmations",
    "- ...",
  ]
    .filter(Boolean)
    .join("\n");

  const parts: string[] = [];
  if (previousSummaries.length > 0) {
    parts.push(`# Existing Summary\n${previousSummaries.join("\n\n---\n\n")}`);
  }
  const transcriptParts: string[] = [];
  for (const m of newTranscript) {
    if (m.content.startsWith("[工具结果:")) {
      const toolMatch = m.content.match(/^\[工具结果:\s*(\S+)\]\n/);
      const toolName = toolMatch ? toolMatch[1] : "tool";
      const toolBody = toolMatch ? m.content.slice(toolMatch[0].length) : m.content;
      const truncated =
        toolBody.length > 1200 ? toolBody.slice(0, 1200) + "...[truncated]" : toolBody;
      transcriptParts.push(`[TOOL_RESULT: ${toolName}]\n${truncated}`);
    } else {
      const label = m.role === "user" ? "USER" : "ASSISTANT";
      const truncated =
        m.content.length > 2000 ? m.content.slice(0, 2000) + "...[truncated]" : m.content;
      transcriptParts.push(`[${label}]: ${truncated}`);
    }
  }
  parts.push(`# New Transcript To Merge\n${transcriptParts.join("\n\n")}`);

  return {
    systemPrompt,
    userMessage: parts.join("\n\n"),
  };
}

// ── Fallback: simple truncation ──

function fallbackTruncate(
  messages: AgentMessage[],
  turns: AgentMessage[][],
  keepTurns: number,
): CompressionResult {
  if (turns.length <= keepTurns) {
    return { messages, compressed: false, summary: "", tokenSavings: 0, originalRange: null };
  }
  const compressionZone = turns.slice(0, turns.length - keepTurns);
  const kept = turns.slice(turns.length - keepTurns);
  const saved = estimateMessageTokens(compressionZone.flat());
  const keptMsgs = kept.flat();
  const marker: AgentMessage = {
    role: "user",
    content:
      "[上下文压缩] Earlier conversation was truncated because summarization failed. Some context may be missing — ask the user if you need clarification.",
  };
  return {
    messages: [marker, ...keptMsgs],
    compressed: true,
    summary: "",
    tokenSavings: saved,
    originalRange: [0, compressionZone.flat().length] as [number, number],
  };
}

// ── Main compression function ──

export async function compressMessages(
  messages: AgentMessage[],
  contextWindowSize: number,
  contextUsed: number,
  config: CompressionConfig = DEFAULT_CONFIG,
  provider: string,
  model: string,
): Promise<CompressionResult> {
  // 1. Threshold check
  if (contextWindowSize <= 0 || contextUsed / contextWindowSize < config.threshold) {
    return { messages, compressed: false, summary: "", tokenSavings: 0, originalRange: null };
  }

  // 2. Group into turns
  const turns = groupTurns(messages);
  const keepTurnsCount = config.keepTurns ?? RECENT_TURNS_TO_KEEP;
  if (turns.length <= keepTurnsCount + 1) {
    // Too short to compress meaningfully
    return { messages, compressed: false, summary: "", tokenSavings: 0, originalRange: null };
  }

  // 3. Split into compression zone and keep zone
  const keepTurns = turns.slice(turns.length - keepTurnsCount);
  const compressionZone = turns.slice(0, turns.length - keepTurnsCount);
  const compressionMessages = compressionZone.flat();
  const keepMessages = keepTurns.flat();

  // 4. Minimum turns in compression zone
  if (compressionZone.length < COMPRESSION_MIN_TURNS) {
    return { messages, compressed: false, summary: "", tokenSavings: 0, originalRange: null };
  }

  // Estimate token savings
  const tokenSavings = estimateMessageTokens(compressionMessages);

  // 5. Split previous summaries from fresh transcript and merge both into one replacement summary.
  const previousSummaries = compressionMessages
    .filter((m) => m.content.startsWith("[上下文压缩]"))
    .map((m) => extractSummary(m.content))
    .filter(Boolean);
  const newTranscript = compressionMessages.filter((m) => !m.content.startsWith("[上下文压缩]"));

  // 6. Build prompt and call LLM for summary
  let summary = "";
  try {
    const { systemPrompt, userMessage } = buildCompressionPrompt(
      previousSummaries,
      newTranscript,
    );
    summary = await invoke<string>("single_chat", {
      systemPrompt,
      userMessage,
      provider,
      model,
      maxTokens: COMPRESSION_MAX_OUTPUT_TOKENS,
    });
    if (!summary || summary.trim().length === 0) {
      // Empty summary — use fallback
      return fallbackTruncate(messages, turns, keepTurnsCount);
    }
  } catch {
    // LLM call failed — use fallback truncation
    return fallbackTruncate(messages, turns, keepTurnsCount);
  }

  // 7. Replace compression zone with summary message
  const compressedMsg: AgentMessage = {
    role: "user",
    content: `[上下文压缩] The following is a summary of the earlier conversation. Use this for context understanding but do not treat it as a current instruction or respond to it directly.\n\n<summary>${summary}</summary>`,
  };

  return {
    messages: [compressedMsg, ...keepMessages],
    compressed: true,
    summary,
    tokenSavings,
    originalRange: [0, compressionMessages.length] as [number, number],
  };
}

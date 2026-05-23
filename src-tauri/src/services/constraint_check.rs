/// Static constraint checking engine (Phase 4)
///
/// Performs lightweight keyword-based matching between a text passage
/// and a set of constraints. This is NOT a semantic check — it flags
/// passages that mention entities/terms constrained by rules, leaving
/// semantic judgment to the LLM-based ConsistencyCheck tool (Task 4.4).
///
/// The engine:
///   1. Extracts significant keywords from each constraint rule
///   (filters single-char tokens, English stop words)
///   2. Searches for those keywords in the passage
///   3. Returns a `ConsistencyViolation` for each rule whose keywords
///   appear in the passage, with excerpt context

use crate::models::constraint::{Constraint, ConstraintSeverity};

/// A potential consistency violation flagged by keyword matching.
/// The LLM will make the final semantic judgment.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConsistencyViolation {
    pub level: String,
    pub rule: String,
    pub passage: String,
    pub suggestion: String,
}

pub struct ConstraintEngine;

impl ConstraintEngine {
    /// Check `passage` against `constraints` using keyword matching.
    ///
    /// Returns violations for any constraint whose keywords appear in
    /// the passage. Empty result means no keywords matched — but the
    /// caller (LLM) should still perform semantic review.
    pub fn check(passage: &str, constraints: &[Constraint]) -> Vec<ConsistencyViolation> {
        let mut violations = Vec::new();
        let lower_passage = passage.to_lowercase();

        for constraint in constraints {
            let keywords = extract_keywords(&constraint.rule);
            if keywords.is_empty() {
                continue;
            }

            let matched: Vec<&str> = keywords
                .iter()
                .filter(|kw| lower_passage.contains(&kw.to_lowercase()))
                .map(|s| s.as_str())
                .collect();

            if !matched.is_empty() {
                let excerpt = extract_excerpt(passage, &matched, 120);
                let level_str = match constraint.severity {
                    ConstraintSeverity::Hard => "hard",
                    ConstraintSeverity::Soft => "soft",
                };

                violations.push(ConsistencyViolation {
                    level: level_str.to_string(),
                    rule: constraint.rule.clone(),
                    passage: excerpt,
                    suggestion: format!(
                        "约束「{}」涉及关键词「{}」，请确认内容是否一致",
                        constraint.rule,
                        matched.join("、")
                    ),
                });
            }
        }

        violations
    }
}

// ── Helpers ──

/// Extract significant keywords from a natural-language rule string.
///
/// Strategy:
/// - Split on whitespace/punctuation
/// - Discard single-char tokens (Chinese particles, English single letters)
/// - Discard common English stop words
/// - Keep the rest as keywords
fn extract_keywords(rule: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "shall", "can",
        "not", "no", "nor", "but", "and", "or", "of", "in", "on",
        "at", "to", "for", "with", "by", "from", "as", "into",
        "through", "during", "before", "after", "above", "below",
        "between", "out", "off", "over", "under", "again", "further",
        "then", "once", "here", "there", "when", "where", "why",
        "how", "all", "each", "every", "both", "few", "more", "most",
        "other", "some", "such", "only", "own", "same", "so",
        "than", "too", "very", "just", "also", "if", "then", "else",
        "about", "up", "this", "that", "these", "those", "it", "its",
        "你", "我", "他", "她", "它", "们", "的", "了", "在", "是",
        "有", "和", "就", "不", "人", "都", "一", "一个", "可以",
        "没有", "我们", "他们", "她们", "它们", "这个", "那个",
        "这些", "那些", "会", "要", "能", "让", "被", "把", "从",
        "也", "很", "但", "而", "或", "与", "及", "等", "如", "因为",
        "所以", "如果", "虽然", "但是", "并且", "而且", "或者",
        "必须", "应该", "不能", "不要", "不得", "允许", "禁止",
    ];

    let tokens: Vec<String> = rule
        .split(|c: char| c.is_ascii_whitespace() || c.is_ascii_punctuation())
        .filter(|t| !t.is_empty())
        .filter(|t| t.chars().count() > 1) // discard single-char tokens
        .filter(|t| !STOP_WORDS.contains(&t.to_lowercase().as_str()))
        .map(|t| t.to_string())
        .collect();

    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    tokens.into_iter().filter(|t| seen.insert(t.to_lowercase())).collect()
}

/// Extract a context window around the first matched keyword.
fn extract_excerpt(passage: &str, keywords: &[&str], max_len: usize) -> String {
    if let Some(first_kw) = keywords.first() {
        if let Some(pos) = passage.to_lowercase().find(&first_kw.to_lowercase()) {
            let start = pos.saturating_sub(max_len / 2);
            let end = (pos + first_kw.len() + max_len / 2).min(passage.len());
            let excerpt = &passage[start..end];
            if start > 0 {
                return format!("…{}…", excerpt);
            }
            return excerpt.to_string();
        }
    }
    // Fallback: first N chars
    let end = max_len.min(passage.len());
    passage[..end].to_string()
}

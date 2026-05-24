/// Consistency check commands — IPC endpoints for constraint checking.
///
/// Two commands:
/// - `check_consistency` — keyword-only coarse filter (existing, kept for backward compat)
/// - `check_consistency_semantic` — two-stage: coarse filter → independent LLM judgment

use crate::commands::api_proxy::single_chat;
use crate::commands::api_key::load_config;
use crate::models::constraint::Constraint;
use crate::services::constraint_check::{ViolationCandidate, ConstraintEngine};

/// Confirmed violation after LLM semantic judgment.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConfirmedViolation {
    pub level: String,
    pub rule: String,
    pub reason: String,
}

/// Legacy keyword-only check. Returns candidates as violations.
#[tauri::command]
pub fn check_consistency(
    passage: String,
    constraints: Vec<Constraint>,
    timeline_id: Option<String>,
) -> Vec<ViolationCandidate> {
    let filtered = filter_by_timeline(constraints, &timeline_id);
    ConstraintEngine::check(&passage, &filtered)
}

/// Two-stage semantic consistency check.
///
/// Stage 1: Rust coarse filter (keyword matching) → candidates
/// Stage 2: Independent LLM call judges each candidate → confirmed violations
///
/// Returns only confirmed violations. Returns empty vec if no keywords match
/// or LLM clears all candidates.
#[tauri::command]
pub async fn check_consistency_semantic(
    passage: String,
    constraints: Vec<Constraint>,
    timeline_id: Option<String>,
) -> Result<Vec<ConfirmedViolation>, String> {
    // Filter constraints by timeline scope
    let filtered = filter_by_timeline(constraints, &timeline_id);

    // Stage 1: coarse filter
    let candidates = ConstraintEngine::check(&passage, &filtered);
    if candidates.is_empty() {
        return Ok(vec![]);
    }

    // Load config for provider/model
    let config = load_config()?;
    let provider = config["provider"].as_str().unwrap_or("deepseek").to_string();
    let models: Vec<serde_json::Value> = config["models"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Pick a small/cheap model for the judge role
    let judge_model = pick_judge_model(&provider, &models);

    // Build system prompt for the independent judge
    let system_prompt = r#"你是事实核查员。你的任务是检查一段文本是否违反了给定的约束规则。

对于每条候选约束，你只判断一次：文本是否确实违反了它。不要修改文本，不要提出修改建议。

输出格式：一个 JSON 数组，每个元素包含三个字段：
- "index": 候选约束的索引（整数，对应输入顺序，从0开始）
- "violated": 布尔值（true 表示确实违反，false 表示未违反）
- "reason": 简短的中文理由（一句话）

只输出 JSON 数组，不要输出任何其他内容。不要用 markdown 代码块包裹。"#;

    // Build user message listing candidates
    let mut user_message = format!("文本段落:\n```\n{}\n```\n\n候选约束:\n", passage);
    for (i, c) in candidates.iter().enumerate() {
        user_message.push_str(&format!(
            "[{}] 规则: {}\n    严重程度: {}\n    匹配关键词: {}\n\n",
            i,
            c.rule,
            c.severity,
            c.matched_keywords.join(", ")
        ));
    }

    // Stage 2: LLM judgment
    let response_text = single_chat(
        system_prompt.to_string(),
        user_message,
        provider,
        judge_model,
        1024,
    )
    .await
    .map_err(|e| format!("语义检查 LLM 调用失败: {}", e))?;

    // Parse JSON response
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&response_text)
        .map_err(|e| format!("解析 LLM 响应失败: {} — 原始响应: {}", e, response_text))?;

    let mut confirmed = Vec::new();
    for item in &parsed {
        if item["violated"].as_bool() == Some(true) {
            let idx = item["index"].as_u64().unwrap_or(999) as usize;
            if let Some(candidate) = candidates.get(idx) {
                confirmed.push(ConfirmedViolation {
                    level: candidate.severity.clone(),
                    rule: candidate.rule.clone(),
                    reason: item["reason"].as_str().unwrap_or("").to_string(),
                });
            }
        }
    }

    Ok(confirmed)
}

/// Filter constraints by timeline scope.
/// - `None` timeline_id → keep universal constraints only (timeline_id is None)
/// - `Some(tlid)` → keep universal + matching timeline_id
fn filter_by_timeline(constraints: Vec<Constraint>, timeline_id: &Option<String>) -> Vec<Constraint> {
    constraints
        .into_iter()
        .filter(|c| {
            c.timeline_id.is_none() // universal — always applies
                || timeline_id.as_ref().is_some_and(|tlid| c.timeline_id.as_ref() == Some(tlid))
        })
        .collect()
}

/// Pick the cheapest reliable model for the consistency judge.
/// Uses haiku for Anthropic, deepseek-chat for DeepSeek, gpt-4o-mini for OpenAI.
fn pick_judge_model(provider: &str, models: &[serde_json::Value]) -> String {
    let model_ids: Vec<&str> = models
        .iter()
        .filter_map(|m| m["id"].as_str())
        .collect();

    // Preferred cheap models in order
    let cheap_candidates: &[&str] = match provider {
        "anthropic" => &["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
        "deepseek" => &["deepseek-chat"],
        "openai" => &["gpt-4o-mini"],
        _ => return "deepseek-chat".to_string(),
    };

    // Find first matching cheap model from user's configured models
    for cheap in cheap_candidates {
        for m in &model_ids {
            if m.contains(cheap) {
                return m.to_string();
            }
        }
    }

    // Fallback: first configured model, or a sensible default
    model_ids
        .first()
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            match provider {
                "anthropic" => "claude-haiku-4-5-20251001".to_string(),
                "deepseek" => "deepseek-chat".to_string(),
                _ => "gpt-4o-mini".to_string(),
            }
        })
}

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

static CANCEL_MAP: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();

/// Diagnostic log for the streaming tool-call path. Writes to both stderr
/// (visible in `npm run tauri dev` terminal) and a file under the OS temp dir
/// so it can be inspected even when the dev terminal is unavailable.
fn log_stream(msg: &str) {
    eprintln!("[api_proxy] {}", msg);
    if let Some(dir) = std::env::temp_dir().to_str().map(String::from) {
        let path = std::path::Path::new(&dir).join("worldforge_stream.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "{} {}", chrono::Local::now().format("%H:%M:%S%.3f"), msg);
        }
    }
}

/// Dump the full outgoing request body to a separate file so we can inspect
/// exactly what the model receives. Writes to `worldforge_request_<conv>.log`
/// in the OS temp dir. The conversation id is included so multiple parallel
/// requests don't trample each other.
fn log_outgoing_body(body: &serde_json::Value, conversation_id: &Option<String>) {
    let conv = conversation_id.clone().unwrap_or_else(|| "no_conv".to_string());
    let safe_conv: String = conv.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("worldforge_request_{}.log", safe_conv));
    let serialized = match serde_json::to_string(body) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::write(&path, format!("[serialize error: {}]", e));
            return;
        }
    };
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let summary = format!(
        "=== outgoing request @ {} ({} bytes, conv={}) ===\nmodel={}\nmsg_count={}\ntool_count={}\nmax_tokens={}\ntool_choice={:?}\nparallel_tool_calls={:?}\nthinking={:?}\nreasoning_effort={:?}\n",
        ts,
        serialized.len(),
        safe_conv,
        body.get("model").map(|v| v.to_string()).unwrap_or_default(),
        body.get("messages").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        body.get("tools").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        body.get("max_tokens").map(|v| v.to_string()).unwrap_or_default(),
        body.get("tool_choice").cloned().unwrap_or(serde_json::Value::Null),
        body.get("parallel_tool_calls").cloned().unwrap_or(serde_json::Value::Null),
        body.get("thinking").cloned().unwrap_or(serde_json::Value::Null),
        body.get("reasoning_effort").cloned().unwrap_or(serde_json::Value::Null),
    );
    // Per-message preview: (index, role, content_len, has_tool_calls, tool_call_id)
    let mut msg_preview = String::new();
    if let Some(arr) = body.get("messages").and_then(|v| v.as_array()) {
        for (i, m) in arr.iter().enumerate() {
            let role = m.get("role").map(|v| v.to_string()).unwrap_or_default();
            let content = m.get("content");
            let content_str = match content {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Array(_)) => "<array content>".to_string(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            let content_len = content_str.len();
            let tcs = m.get("tool_calls").map(|v| v.as_array().map(|a| a.len()).unwrap_or(0)).unwrap_or(0);
            let tcid = m.get("tool_call_id").map(|v| v.to_string()).unwrap_or_default();
            // Safe char-boundary truncation: slice by chars, not bytes (Chinese is 3 bytes/char).
            // Previously used `&content_str[..200]` which panicked at UTF-8 boundaries.
            let preview: String = content_str.chars().take(200).collect();
            let preview = if content_str.chars().count() > 200 { format!("{}…(+{} chars)", preview, content_str.chars().count() - 200) } else { preview };
            let oneline = preview.replace('\n', "\\n");
            msg_preview.push_str(&format!(
                "  [{}] role={} content_len={} tool_calls={} tool_call_id={} content={:?}\n",
                i, role, content_len, tcs, tcid, oneline,
            ));
        }
    }
    // Full body is too large for stream.log; write to dedicated file
    let full = format!("{}{}\n--- message list (preview) ---\n{}--- full body (JSON) ---\n{}\n\n",
        summary, "", msg_preview, serialized);
    let _ = std::fs::write(&path, full);
    eprintln!("[api_proxy] dumped outgoing body ({} bytes) to {}", serialized.len(), path.display());
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallMsg>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCallMsg {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    #[serde(rename = "input_schema")]
    pub input_schema: Value,
}

/// Streaming event payloads emitted to frontend
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "text_delta")]
    TextDelta { text: String, conversation_id: Option<String> },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { text: String, conversation_id: Option<String> },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String, input: Value, conversation_id: Option<String> },
    #[serde(rename = "stream_end")]
    StreamEnd { stop_reason: String, conversation_id: Option<String> },
    #[serde(rename = "usage")]
    Usage { input_tokens: u64, output_tokens: u64, cache_hit_tokens: Option<u64>, cache_miss_tokens: Option<u64>, conversation_id: Option<String> },
}

/// 跨 chunk 的 <think>...</think> 内联标签解析器。
///
/// 国产模型（MiniMax / Qwen / DeepSeek V3 / GLM 等）经常把思维链直接以
/// `<think>...</think>` 字符串塞进 `content` 流里，而不是用 DeepSeek 那样的
/// `reasoning_content` 独立字段。SSE 按 chunk 到达，标签可能正好被切在边界
/// 上（chunk N 以 "<think>" 结尾、chunk N+1 以 "..." 开头），所以必须做
/// 状态化的逐字符扫描。
///
/// 用法：每个流会话持有一个解析器，content 到达时调 `feed`，最后调 `flush`。
/// 解析器会把 thinking 段和可见文段分别回调出去。
struct ThinkTagParser {
    /// 当前是否在 <think> 块内
    in_think: bool,
    /// 暂存"看起来像标签开头但还没攒够字"的字符，最长 7（`<think>`）或 8（`</think>`）
    pending: String,
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

impl ThinkTagParser {
    fn new() -> Self {
        Self { in_think: false, pending: String::new() }
    }

    /// 是否是 `<think>` 或 `</think>` 的前缀
    fn is_tag_prefix(s: &str) -> bool {
        THINK_OPEN.starts_with(s) || THINK_CLOSE.starts_with(s)
    }

    /// 把一个完整 token 喂进解析器。`on_think` 接收 think 块内文本，`on_text`
    /// 接收可见文本。两者都可能拿到空串，调用方需自行忽略。
    fn feed(
        &mut self,
        text: &str,
        on_think: &mut dyn FnMut(&str),
        on_text: &mut dyn FnMut(&str),
    ) {
        for c in text.chars() {
            if self.pending.is_empty() {
                if c == '<' {
                    self.pending.push(c);
                } else if self.in_think {
                    on_think(&c.to_string());
                } else {
                    on_text(&c.to_string());
                }
            } else {
                self.pending.push(c);
                if self.pending == THINK_OPEN {
                    self.pending.clear();
                    self.in_think = true;
                } else if self.pending == THINK_CLOSE {
                    self.pending.clear();
                    self.in_think = false;
                } else if !Self::is_tag_prefix(&self.pending) {
                    // 不是任何 think 标签的前缀 → 把 pending 当成普通字符吐出去
                    if self.in_think {
                        on_think(&self.pending);
                    } else {
                        on_text(&self.pending);
                    }
                    self.pending.clear();
                }
                // is_tag_prefix 仍然为 true → 继续等下一个字符，不做任何事
            }
        }
    }

    /// 流结束时调用，把还没攒够标签字符的残余 pending 当作普通字符吐出去。
    fn flush(
        &mut self,
        on_think: &mut dyn FnMut(&str),
        on_text: &mut dyn FnMut(&str),
    ) {
        if !self.pending.is_empty() {
            if self.in_think {
                on_think(&self.pending);
            } else {
                on_text(&self.pending);
            }
            self.pending.clear();
        }
    }
}

/// Cancel an in-flight streaming request. The HTTP connection is dropped immediately.
#[tauri::command]
pub fn cancel_stream(conversation_id: String) -> Result<(), String> {
    if let Some(tx) = CANCEL_MAP.get_or_init(|| Mutex::new(HashMap::new()))
        .lock().unwrap().remove(&conversation_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

/// Quick connectivity test — sends a single message, returns "ok" or error
#[tauri::command]
pub async fn test_connection(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let default_api_url = match provider.as_str() {
        "openai" => "https://api.openai.com/v1/chat/completions",
        "deepseek" => "https://api.deepseek.com/v1/chat/completions",
        _ => "https://api.deepseek.com/v1/chat/completions", // sensible default for custom providers
    };
    let api_url = base_url.as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(String::from)
        .unwrap_or_else(|| default_api_url.to_string());

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 10,
    });
    let resp = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let status = resp.status();
    if status.is_success() {
        Ok(format!("✓ 连接成功 ({}, {})", provider, model))
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("API 返回 {}: {}", status, text))
    }
}

/// Non-streaming LLM call — sends one request, waits for full response, returns text.
/// Used for independent LLM judgment (e.g. consistency check, context compression) where the caller
/// doesn't need streaming deltas.
#[tauri::command]
pub async fn single_chat(
    system_prompt: String,
    user_message: String,
    provider: String,
    model: String,
    max_tokens: u32,
    json: Option<bool>,
) -> Result<String, String> {
    // json 可选: 旧调用方(主聊天 context-compression 等)未传此参数, 默认 false——避免 Tauri 参数缺失报错
    let json = json.unwrap_or(false);
    let api_key = crate::commands::api_key::get_api_key(provider.clone())
        .map_err(|e| format!("未配置 API Key: {}", e))?;

    let client = reqwest::Client::builder()
        .no_proxy()
        // 防止 DeepSeek/慢模型挂起导致前端无限等待（"半天不返回"的根因）——60s 超时降级
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    // provider 只用来取 API Key; 请求地址从配置读（任意 provider id 都可配 base_url）,
    // 无配置时 fallback 到 DeepSeek 默认。仅支持 OpenAI-compatible 协议。
    let configured_api_url = crate::commands::api_key::get_api_base_url(provider.clone());
    let api_url = configured_api_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(String::from)
        .unwrap_or_else(|| "https://api.deepseek.com/v1/chat/completions".to_string());

    {
        let msgs = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_message}),
        ];
        let mut body = serde_json::json!({
            "model": model,
            "messages": msgs,
            "max_tokens": max_tokens,
            "stream": false,
        });
        // DeepSeek V4 (thinking 模型): 默认 thinking 模式下 content 可能为空、推理全在 reasoning_content。
        // 严格 JSON 输出场景直接关掉 thinking, 让 content 承载最终答案。
        if model.to_lowercase().starts_with("deepseek") && model.to_lowercase().contains("v4") {
            body["thinking"] = serde_json::json!({"type": "disabled"});
        }
        // json mode: OpenAI 兼容端点(含 DeepSeek)加 response_format, 让 LLM 直接输出合法 JSON。
        if json {
            body["response_format"] = serde_json::json!({"type": "json_object"});
        }
        let resp = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API 错误 {}: {}", status, text));
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
        let msg = &json["choices"][0]["message"];
        // 优先 content; thinking 模型 content 可能为空 → 回退 reasoning_content
        let content = msg["content"].as_str().map(String::from);
        match content {
            Some(c) if !c.trim().is_empty() => Ok(c),
            _ => msg["reasoning_content"]
                .as_str()
                .map(String::from)
                .filter(|c| !c.trim().is_empty())
                .ok_or_else(|| format!("无法提取响应文本: {}", json)),
        }
    }
}

/// Call LLM API with streaming — retry wrapper.
#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    model: String,
    tools: Vec<ToolDef>,
    provider: String,
    max_tokens: u32,
    reasoning_effort: Option<String>,
    conversation_id: Option<String>,
    thinking_style: Option<String>,
    // Wire value for `thinking.type` when the model has thinking ON:
    //   - DeepSeek uses "enabled"
    //   - MiniMax uses "adaptive"  (per official docs; the API rejects "enabled"
    //     with `bad_request_error: invalid params, invalid thinking.type:
    //     "enabled" (allowed: adaptive, disabled)`).
    // Defaults to "enabled" when not provided (back-compat for old callers).
    thinking_on_value: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    const MAX_RETRIES: u32 = 3;
    let mut last_error = String::new();
    for attempt in 0..MAX_RETRIES {
        match stream_chat_inner(app.clone(), messages.clone(), system_prompt.clone(), model.clone(), tools.clone(), provider.clone(), max_tokens, reasoning_effort.clone(), conversation_id.clone(), thinking_style.clone(), thinking_on_value.clone(), base_url.clone()).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_error = e.clone();
                if attempt < MAX_RETRIES - 1 && (e.contains("timeout") || e.contains("timed out") || e.contains("发送请求") || e.contains("429") || e.contains("503") || e.contains("502") || e.contains("connection")) {
                    tokio::time::sleep(std::time::Duration::from_millis(2u64.pow(attempt) * 1000)).await;
                    let _ = app.emit("stream-event", StreamEvent::TextDelta {
                        text: format!("\n(重试 {}/{})...\n", attempt + 2, MAX_RETRIES),
                        conversation_id: conversation_id.clone(),
                    });
                } else { break; }
            }
        }
    }
    Err(last_error)
}

async fn stream_chat_inner(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    model: String,
    tools: Vec<ToolDef>,
    provider: String,
    max_tokens: u32,
    reasoning_effort: Option<String>,
    conversation_id: Option<String>,
    thinking_style: Option<String>,
    thinking_on_value: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let api_key = crate::commands::api_key::get_api_key(provider.clone())
        .map_err(|e| format!("未配置 API Key: {}", e))?;

    // Only OpenAI-compatible protocol is supported. `thinking_style` only
    // toggles the "deepseek" thinking-extension payload; "none" sends nothing.
    let api_url = base_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(String::from)
        .unwrap_or_else(|| "https://api.deepseek.com/v1/chat/completions".to_string());
    let style = thinking_style.unwrap_or_else(|| "none".to_string());
    let on_value = thinking_on_value.unwrap_or_else(|| "enabled".to_string());
    stream_openai_compatible(app, messages, system_prompt, model, tools, api_key, &api_url, style, on_value, max_tokens, reasoning_effort, conversation_id).await
}

async fn stream_openai_compatible(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    model: String,
    tools: Vec<ToolDef>,
    api_key: String,
    api_url: &str,
    thinking_style: String,
    thinking_on_value: String,
    _max_tokens: u32,  // OpenAI-compatible: included in body when tool config doesn't provide it
    reasoning_effort: Option<String>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut msgs = Vec::new();
    if !system_prompt.is_empty() {
        msgs.push(serde_json::json!({"role": "system", "content": system_prompt}));
    }
    for m in &messages {
        if let Some(ref id) = m.tool_call_id {
            // Strip the legacy `[工具结果: Name]\n` prefix ONLY when present.
            // In-memory messages from the agent loop carry this prefix; messages
            // reconstructed from the store by buildModelMessages (model-context.ts)
            // use the raw tool result without prefix. Unconditional splitting was
            // dropping the first line of multi-line JSON / file bodies and
            // corrupting what the model saw in long sessions.
            let content = if m.content.starts_with("[工具结果:") {
                m.content.splitn(2, '\n').nth(1).unwrap_or(&m.content)
            } else {
                m.content.as_str()
            };
            msgs.push(serde_json::json!({
                "role": "tool",
                "content": content,
                "tool_call_id": id,
            }));
        } else if let Some(ref tcs) = m.tool_calls {
            let mut msg = serde_json::json!({"role": m.role, "content": m.content});
            msg["tool_calls"] = serde_json::to_value(tcs).unwrap_or_default();
            msgs.push(msg);
        } else {
            msgs.push(serde_json::json!({"role": m.role, "content": m.content}));
        }
    }

    let oai_tools: Vec<Value> = tools.iter().map(|t| serde_json::json!({
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description,
            "parameters": t.input_schema,
        }
    })).collect();

    // OpenAI-compatible: max_tokens is optional. Omit it and let the provider
    // decide its own limit. Recovery in agent-loop.ts handles truncation regardless.
    // Build body with tools BEFORE messages so that the static tools prefix
    // is independently cacheable across conversations by DeepSeek/OpenAI auto-caching.
    let mut body = serde_json::json!({
        "model": model,
        "stream": true,
        "stream_options": {
            "include_usage": true,
        },
    });
    if !oai_tools.is_empty() {
        body["tools"] = serde_json::Value::Array(oai_tools);
    }
    body["messages"] = serde_json::json!(msgs);
    if _max_tokens > 0 {
        body["max_tokens"] = serde_json::json!(_max_tokens);
    }
    // Apply thinking parameters. The two independent switches are:
    //   - `thinking_style` (per provider, auto-detected from baseUrl): one of
    //     3 wire-protocol variants. The user does not pick this — the URL
    //     decides. (See `detectThinkingStyle` in TS.)
    //   - `reasoning_effort` + force-disable flag (per model)
    //
    // Wire behaviour per style:
    //   - "openai":           `reasoning_effort: <effort>` only. Standard OpenAI
    //                        field; default for unknown URLs.
    //   - "thinking-type":    `thinking: {type: ...}` + `reasoning_effort`.
    //                        Both DeepSeek V4 and MiniMax use the `thinking`
    //                        object, but the "on" value differs:
    //                          - DeepSeek wants "enabled"
    //                          - MiniMax wants "adaptive"  (per official docs:
    //                            "(allowed: adaptive, disabled)")
    //                        The "off" value is "disabled" for both. We pick
    //                        the "on" value from the frontend-supplied
    //                        `thinking_on_value` (auto-detected from baseUrl).
    //   - "enable-thinking":  `enable_thinking: true|false` (DashScope /
    //                        Aliyun Bailian). Used by Qwen, GLM, Kimi, and
    //                        MiniMax when accessed through DashScope.
    let thinking_on_value = thinking_on_value.as_str();
    match thinking_style.as_str() {
        "thinking-type" => {
            if let Some(effort) = reasoning_effort.as_deref() {
                match effort {
                    "disabled" | "default" => {
                        // Both DeepSeek and MiniMax accept "disabled" to turn thinking off.
                        body["thinking"] = serde_json::json!({"type": "disabled"});
                    }
                    _ => {
                        // Use the provider-specific "on" value (default "enabled" for
                        // DeepSeek; "adaptive" for MiniMax — the frontend detects this
                        // from the baseUrl and passes it via `thinking_on_value`).
                        body["thinking"] = serde_json::json!({"type": thinking_on_value});
                        // DeepSeek V4 only supports "high" and "max"; low/medium → high
                        // for the Pro tier. The Flash tier and MiniMax accept low natively;
                        // the model-side mapping at the API gateway handles that for us.
                        let mapped = match effort {
                            "low" | "medium" => "high",
                            other => other,
                        };
                        body["reasoning_effort"] = serde_json::json!(mapped);
                    }
                }
            }
        }
        "openai" => {
            if let Some(effort) = reasoning_effort.as_deref() {
                if effort != "disabled" && effort != "default" {
                    body["reasoning_effort"] = serde_json::json!(effort);
                }
            }
        }
        "enable-thinking" => {
            // DashScope protocol. The key is `enable_thinking: true|false`. We don't
            // send `thinking_budget` from here — that's a per-model tuning knob that
            // belongs in the model config if we ever need it.
            if let Some(effort) = reasoning_effort.as_deref() {
                match effort {
                    "disabled" | "default" => {
                        body["enable_thinking"] = serde_json::json!(false);
                    }
                    _ => {
                        body["enable_thinking"] = serde_json::json!(true);
                    }
                }
            }
        }
        _ => {
            // Unknown / future variants — fall back to OpenAI standard.
            if let Some(effort) = reasoning_effort.as_deref() {
                if effort != "disabled" && effort != "default" {
                    body["reasoning_effort"] = serde_json::json!(effort);
                }
            }
        }
    }

    let key_trimmed = api_key.trim().to_string();
    let mut req = client
        .post(api_url)
        .header("Content-Type", "application/json");
    if !key_trimmed.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", key_trimmed));
    }
    // Dump full outgoing body to a per-conversation file so we can inspect
    // exactly what the model receives (tool_choice, tools, messages, etc).
    log_outgoing_body(&body, &conversation_id);
    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API 错误 {}: {}", status, text));
    }

    let mut stream = response.bytes_stream();
    // 字节缓冲：SSE 流按 TCP chunk 到达，多字节 UTF-8 字符可能被切在 chunk 边界。
    // 必须按 \n 切出完整行后再解码，否则 from_utf8_lossy 会把切半的字符替换
    // 成 U+FFFD（乱码），且后续字节到达后也无法恢复。
    let mut buffer: Vec<u8> = Vec::new();
    let mut tool_call_buffers: std::collections::HashMap<u64, (String, String, String)> = std::collections::HashMap::new();
    let mut stream_end_reason: Option<String> = None;
    let mut has_usage = false;
    let mut usage_input_tokens: u64 = 0;
    let mut usage_output_tokens: u64 = 0;
    let mut usage_cache_hit: Option<u64> = None;
    let mut usage_cache_miss: Option<u64> = None;
    // 跨 chunk 的 <think>...</think> 标签解析器（国产模型常用内联标签）
    let mut think_parser = ThinkTagParser::new();

    // Register cancellation channel
    let cid_key = conversation_id.clone().unwrap_or_default();
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    CANCEL_MAP.get_or_init(|| Mutex::new(HashMap::new()))
        .lock().unwrap()
        .insert(cid_key.clone(), cancel_tx);

    'stream_loop: loop {
        let chunk = tokio::select! {
            result = stream.next() => match result {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    CANCEL_MAP.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().remove(&cid_key);
                    return Err(format!("流读取错误: {}", e));
                }
                None => break 'stream_loop,
            },
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow_and_update() { break 'stream_loop; }
                continue;
            }
        };
        buffer.extend_from_slice(&chunk);

        while let Some(line_end) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=line_end).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if line.is_empty() { continue; }

            if let Some(data) = line.strip_prefix("data: ") {
                // [DONE] — end of stream. Flush any pending tool buffers now
                // (finish_reason may not always precede [DONE], and buffers must
                // not be silently dropped when they do).
                if data == "[DONE]" {
                    log_stream(&format!("stream reached [DONE], stream_end_reason={:?}", stream_end_reason));
                    flush_tool_buffers(&mut tool_call_buffers, &app, conversation_id.clone());
                    if stream_end_reason.is_none() {
                        stream_end_reason = Some("stop".to_string());
                    }
                    break 'stream_loop;
                }
                if let Ok(event) = serde_json::from_str::<Value>(data) {
                    // Extract usage if present (final chunk with stream_options.include_usage)
                    // Some servers (LM Studio) send usage in a separate chunk after finish_reason
                    if let Some(usage) = event["usage"].as_object() {
                        has_usage = true;
                        usage_input_tokens = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        usage_output_tokens = usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let cache_hit = usage.get("prompt_cache_hit_tokens").and_then(|v| v.as_u64());
                        let cache_miss = usage.get("prompt_cache_miss_tokens").and_then(|v| v.as_u64());
                        usage_cache_hit = cache_hit;
                        usage_cache_miss = cache_miss;
                        // cache_hit/cache_miss remain Option<u64> — only DeepSeek
                        // populates them; OpenAI / LM Studio leave them None.
                    }
                    if let Some(choices) = event["choices"].as_array() {
                        for choice in choices {
                            // Thinking — check multiple field names in priority order.
                            // Different OpenAI-compatible providers emit thinking in
                            // different fields. We probe them all and emit the first
                            // non-empty one. Logged so the next round of debugging
                            // can tell us exactly which field the model picked.
                            //
                            //   reasoning_content   — DeepSeek reasoner
                            //   reasoning           — OpenAI o1/o3 style / most OpenAI-compat
                            //   reasoning_text      — some Chinese providers
                            //   thinking            — Anthropic-on-OpenAI-router, others
                            const THINKING_FIELDS: &[&str] = &[
                                "reasoning_content",
                                "reasoning",
                                "reasoning_text",
                                "thinking",
                            ];
                            for field in THINKING_FIELDS {
                                if let Some(text) = choice["delta"].get(field).and_then(|v| v.as_str()) {
                                    if !text.is_empty() {
                                        log_stream(&format!("thinking field hit: {field} (len={})", text.len()));
                                        let _ = app.emit("stream-event", StreamEvent::ThinkingDelta {
                                            text: text.to_string(),
                                            conversation_id: conversation_id.clone(),
                                        });
                                        break; // first non-empty wins
                                    }
                                }
                            }
                            if let Some(delta) = choice["delta"].get("content") {
                                if let Some(text) = delta.as_str() {
                                    // 用 <think>...</think> 解析器分流: 标签内进 ThinkingDelta, 标签外进 TextDelta
                                    let cid = conversation_id.clone();
                                    let app_ref = &app;
                                    let mut emit_think = |s: &str| {
                                        if !s.is_empty() {
                                            let _ = app_ref.emit("stream-event", StreamEvent::ThinkingDelta { text: s.to_string(), conversation_id: cid.clone() });
                                        }
                                    };
                                    let mut emit_text = |s: &str| {
                                        if !s.is_empty() {
                                            let _ = app_ref.emit("stream-event", StreamEvent::TextDelta { text: s.to_string(), conversation_id: cid.clone() });
                                        }
                                    };
                                    think_parser.feed(text, &mut emit_think, &mut emit_text);
                                }
                            }
                            // Tool calls (OpenAI format) — use per-index buffers to support parallel calls
                            if let Some(tool_calls) = choice["delta"].get("tool_calls") {
                                log_stream(&format!("stream: got tool_calls delta, count={}", tool_calls.as_array().map(|a| a.len()).unwrap_or(0)));
                                for tc in tool_calls.as_array().unwrap_or(&vec![]) {
                                    let idx = tc["index"].as_u64().unwrap_or(0);
                                    if let Some(id) = tc["id"].as_str() {
                                        tool_call_buffers.insert(idx, (id.to_string(), String::new(), String::new()));
                                    }
                                    if let Some(buf) = tool_call_buffers.get_mut(&idx) {
                                        if let Some(name) = tc["function"]["name"].as_str() { buf.1 = name.to_string(); }
                                        if let Some(args) = tc["function"]["arguments"].as_str() { buf.2.push_str(args); }
                                    }
                                }
                            }
                            if let Some(finish) = choice["finish_reason"].as_str() {
                                // Store finish reason, flush tools, but DON'T break yet —
                                // LM Studio may send usage in a separate chunk after this.
                                // StreamEnd is emitted after the loop when [DONE] arrives or TCP closes.
                                stream_end_reason = Some(finish.to_string());
                                log_stream(&format!("finish_reason={finish}, flushing tool buffers"));
                                flush_tool_buffers(&mut tool_call_buffers, &app, conversation_id.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // Clean up cancellation channel
    CANCEL_MAP.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().remove(&cid_key);

    // Flush any tool call buffers that were never flushed (stream ended via
    // TCP close / cancel without finish_reason or [DONE] arriving). Without
    // this, a partially-received tool call is silently dropped and the agent
    // appears to "want to call a tool" but never does.
    log_stream(&format!("stream loop ended, stream_end_reason={:?}, final flush", stream_end_reason));
    flush_tool_buffers(&mut tool_call_buffers, &app, conversation_id.clone());
    // 流末尾 flush 残余标签字符（边界可能恰好留半个 `<`）
    {
        let cid = conversation_id.clone();
        let app_ref = &app;
        let mut emit_think = |s: &str| {
            if !s.is_empty() {
                let _ = app_ref.emit("stream-event", StreamEvent::ThinkingDelta { text: s.to_string(), conversation_id: cid.clone() });
            }
        };
        let mut emit_text = |s: &str| {
            if !s.is_empty() {
                let _ = app_ref.emit("stream-event", StreamEvent::TextDelta { text: s.to_string(), conversation_id: cid.clone() });
            }
        };
        think_parser.flush(&mut emit_think, &mut emit_text);
    }

    // Emit pending usage then StreamEnd after the loop exits.
    // This catches usage from servers (LM Studio) that send usage in a
    // separate chunk after finish_reason, while preserving backward
    // compatibility with OpenAI/DeepSeek that include it in the same chunk.
    let reason = stream_end_reason.unwrap_or_else(|| "stop".to_string());
    if has_usage {
        let _ = app.emit("stream-event", StreamEvent::Usage { input_tokens: usage_input_tokens, output_tokens: usage_output_tokens, cache_hit_tokens: usage_cache_hit, cache_miss_tokens: usage_cache_miss, conversation_id: conversation_id.clone() });
    }
    let _ = app.emit("stream-event", StreamEvent::StreamEnd { stop_reason: reason, conversation_id: conversation_id.clone() });
    Ok(())
}

/// Emit any accumulated tool call buffers as ToolUse events, then clear them.
/// Sorted by index so parallel tool calls come out in deterministic order.
fn flush_tool_buffers(
    buffers: &mut std::collections::HashMap<u64, (String, String, String)>,
    app: &AppHandle,
    conversation_id: Option<String>,
) {
    log_stream(&format!("flush_tool_buffers: {} buffered tool call(s)", buffers.len()));
    let mut indices: Vec<u64> = buffers.keys().copied().collect();
    indices.sort();
    for idx in indices {
        if let Some((id, name, args)) = buffers.remove(&idx) {
            log_stream(&format!("flushing tool idx={idx} name={name} id={id} args_len={}", args.len()));
            match serde_json::from_str::<Value>(&args) {
                Ok(input) => {
                    let _ = app.emit("stream-event", StreamEvent::ToolUse { id, name, input, conversation_id: conversation_id.clone() });
                }
                Err(e) => {
                    log_stream(&format!("failed to parse tool args for {name} (id {id}): {e}"));
                    // Surface the failure in the visible stream so the user knows a
                    // tool was dropped — silent drops caused the "I'll edit X:"
                    // stalls in long sessions because the loop saw zero tool_use.
                    let _ = app.emit("stream-event", StreamEvent::TextDelta {
                        text: format!("\n[工具 {name} 参数解析失败,已忽略 — {}]\n", e),
                        conversation_id: conversation_id.clone(),
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ThinkTagParser;

    /// 回归：SSE 流 chunk 边界切在多字节 UTF-8 字符中间时，不能产生乱码。
    /// 旧的 from_utf8_lossy(每 chunk) 实现会输出 U+FFFD；字节缓冲按 \n 切行则安全。
    /// 回归：国产模型（M2 / Qwen / GLM / DeepSeek V3）把思维链以 `<think>...</think>`
    /// 字符串内联在 content 流里。解析器必须把标签内文字分流到 ThinkingDelta，
    /// 标签外文字保留为 TextDelta。覆盖几种 chunk 边界 case。
    fn run_parser(input: &str) -> (String, String) {
        let mut p = ThinkTagParser::new();
        let mut think = String::new();
        let mut text = String::new();
        let mut t = |s: &str| think.push_str(s);
        let mut v = |s: &str| text.push_str(s);
        p.feed(input, &mut t, &mut v);
        p.flush(&mut t, &mut v);
        (think, text)
    }

    #[test]
    fn think_tag_basic_split() {
        let (think, text) = run_parser("<think>我是思考</think>我是回答");
        assert_eq!(think, "我是思考");
        assert_eq!(text, "我是回答");
    }

    #[test]
    fn think_tag_with_newlines() {
        let (think, text) = run_parser("<think>先分析\n再总结</think>\n好的，这是答案。");
        assert_eq!(think, "先分析\n再总结");
        assert_eq!(text, "\n好的，这是答案。");
    }

    #[test]
    fn think_tag_split_across_chunks() {
        // 模拟 SSE 边界正好把 <think> 和 </think> 切开
        let mut p = ThinkTagParser::new();
        let mut think = String::new();
        let mut text = String::new();
        let mut t = |s: &str| think.push_str(s);
        let mut v = |s: &str| text.push_str(s);
        for chunk in ["abc<thi", "nk>def</think>a", "nswer"] {
            p.feed(chunk, &mut t, &mut v);
        }
        p.flush(&mut t, &mut v);
        assert_eq!(text, "abcanswer", "<think> 前的 'abc' + </think> 后的 'answer' 都应保留为可见文本");
        assert_eq!(think, "def", "标签内文字应进入 thinking");
    }

    #[test]
    fn no_think_tag_passes_through() {
        let (think, text) = run_parser("hello world, no tags here");
        assert_eq!(think, "");
        assert_eq!(text, "hello world, no tags here");
    }

    #[test]
    fn stray_lt_character_is_kept() {
        // 模型输出数学表达式 "1 < 2"，< 不应触发 think 状态
        let (think, text) = run_parser("1 < 2 是对的");
        assert_eq!(think, "");
        assert_eq!(text, "1 < 2 是对的");
    }

    #[test]
    fn sse_line_parsing_survives_utf8_boundary_split() {
        let full = "data: {\"delta\":{\"content\":\"核心要点\"}}\n"
            .as_bytes()
            .to_vec();
        // "核心要点" = 核(27-29) 心(30-32) 要(33-35) 点(36-38)
        // 在"心"的字节中间切断：第一个 chunk 只含 E5，后两个字节在第二个 chunk
        let split_at = 31;

        let mut buffer: Vec<u8> = Vec::new();
        let mut lines = Vec::new();
        for chunk in [&full[..split_at], &full[split_at..]] {
            buffer.extend_from_slice(chunk);
            while let Some(line_end) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=line_end).collect();
                let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                lines.push(line);
            }
        }

        assert_eq!(lines.len(), 1);
        assert!(
            lines[0].contains("核心要点"),
            "chunk 边界切分后不应有乱码: {:?}",
            lines[0]
        );
        assert!(
            !lines[0].contains('\u{FFFD}'),
            "不应出现 U+FFFD 替换字符: {:?}",
            lines[0]
        );

        // 对比：旧实现（每 chunk 单独 from_utf8_lossy）确实会产生乱码，证明修复是必要的
        let part1 = String::from_utf8_lossy(&full[..split_at]).to_string();
        let part2 = String::from_utf8_lossy(&full[split_at..]).to_string();
        let joined = format!("{}{}", part1, part2);
        assert!(
            joined.contains('\u{FFFD}'),
            "旧实现应产生乱码（证明此 bug 存在）: {:?}",
            joined
        );
    }
}

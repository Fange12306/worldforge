use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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
    TextDelta { text: String },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { text: String },
    #[serde(rename = "thinking_done")]
    ThinkingDone,
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String, input: Value },
    #[serde(rename = "stream_end")]
    StreamEnd { stop_reason: String },
    #[serde(rename = "usage")]
    Usage { input_tokens: u64, output_tokens: u64 },
    #[serde(rename = "error")]
    Error { message: String },
}

/// Quick connectivity test — sends a single message, returns "ok" or error
#[tauri::command]
pub async fn test_connection(
    provider: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    let api_url = match provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/messages",
        "openai" => "https://api.openai.com/v1/chat/completions",
        "deepseek" => "https://api.deepseek.com/v1/chat/completions",
        _ => return Err(format!("未知 Provider: {}", provider)),
    };

    let client = reqwest::Client::new();

    if provider == "anthropic" {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Hi"}],
        });
        let resp = client
            .post(api_url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("连接失败: {}", e))?;

        let status = resp.status();
        if status.is_success() {
            Ok(format!("✓ 连接成功 (Anthropic, {})", model))
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(format!("API 返回 {}: {}", status, text))
        }
    } else {
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Hi"}],
            "max_tokens": 10,
        });
        let resp = client
            .post(api_url)
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
) -> Result<(), String> {
    const MAX_RETRIES: u32 = 3;
    let mut last_error = String::new();
    for attempt in 0..MAX_RETRIES {
        match stream_chat_inner(app.clone(), messages.clone(), system_prompt.clone(), model.clone(), tools.clone(), provider.clone(), max_tokens).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_error = e.clone();
                if attempt < MAX_RETRIES - 1 && (e.contains("timeout") || e.contains("timed out") || e.contains("发送请求") || e.contains("429") || e.contains("503") || e.contains("502") || e.contains("connection")) {
                    tokio::time::sleep(std::time::Duration::from_millis(2u64.pow(attempt) * 1000)).await;
                    let _ = app.emit("stream-event", StreamEvent::TextDelta {
                        text: format!("\n(重试 {}/{})...\n", attempt + 2, MAX_RETRIES),
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
) -> Result<(), String> {
    // Get API key (api_key.rs already prefixes with "api_key_")
    let api_key = crate::commands::api_key::get_api_key(provider.clone())
        .map_err(|e| format!("未配置 API Key: {}", e))?;

    let api_url = match provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/messages",
        "openai" => "https://api.openai.com/v1/chat/completions",
        "deepseek" => "https://api.deepseek.com/v1/chat/completions",
        _ => return Err(format!("未知 Provider: {}", provider)),
    };

    if provider == "anthropic" {
        stream_anthropic(app, messages, system_prompt, model, tools, api_key, api_url, max_tokens).await
    } else {
        stream_openai_compatible(app, messages, system_prompt, model, tools, api_key, api_url, provider, max_tokens).await
    }
}

async fn stream_anthropic(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    model: String,
    tools: Vec<ToolDef>,
    api_key: String,
    api_url: &str,
    max_tokens: u32,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    // Convert tools to Anthropic format
    let anthropic_tools: Vec<Value> = tools
        .iter()
        .map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema,
        }))
        .collect();

    // Convert messages
    let anthropic_msgs: Vec<Value> = messages
        .iter()
        .map(|m| serde_json::json!({
            "role": m.role,
            "content": m.content,
        }))
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": anthropic_msgs,
        "stream": true,
        "thinking": {
            "type": "adaptive"
        },
    });

    if !system_prompt.is_empty() {
        body["system"] = serde_json::json!(system_prompt);
    }
    if !anthropic_tools.is_empty() {
        body["tools"] = serde_json::Value::Array(anthropic_tools);
    }

    let response = client
        .post(api_url)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
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
    let mut buffer = String::new();
    let mut current_tool_id: Option<String> = None;
    let mut current_tool_name = String::new();
    let mut current_tool_input = String::new();
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("流读取错误: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process SSE events
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(event) = serde_json::from_str::<Value>(data) {
                    match event["type"].as_str() {
                        Some("message_start") => {
                            if let Some(usage) = event["message"]["usage"].as_object() {
                                input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            }
                        }
                        Some("content_block_delta") => {
                            let delta_type = event["delta"]["type"].as_str();
                            if delta_type == Some("thinking_delta") {
                                if let Some(thinking) = event["delta"]["thinking"].as_str() {
                                    let _ = app.emit("stream-event", StreamEvent::ThinkingDelta {
                                        text: thinking.to_string(),
                                    });
                                }
                            } else if delta_type == Some("text_delta") {
                                if let Some(text) = event["delta"]["text"].as_str() {
                                    let _ = app.emit("stream-event", StreamEvent::TextDelta {
                                        text: text.to_string(),
                                    });
                                }
                            } else if delta_type == Some("input_json_delta") {
                                if let Some(json) = event["delta"]["partial_json"].as_str() {
                                    current_tool_input.push_str(json);
                                }
                            }
                        }
                        Some("content_block_start") => {
                            if event["content_block"]["type"] == "tool_use" {
                                current_tool_id = event["content_block"]["id"].as_str().map(String::from);
                                current_tool_name = event["content_block"]["name"].as_str().unwrap_or("").to_string();
                                current_tool_input = String::new();
                            }
                        }
                        Some("content_block_stop") => {
                            // Flush pending tool use
                            if let Some(ref id) = current_tool_id {
                                if let Ok(input) = serde_json::from_str::<Value>(&current_tool_input) {
                                    let _ = app.emit("stream-event", StreamEvent::ToolUse {
                                        id: id.clone(),
                                        name: current_tool_name.clone(),
                                        input,
                                    });
                                }
                                current_tool_id = None;
                                current_tool_name.clear();
                                current_tool_input.clear();
                            }
                        }
                        Some("message_delta") => {
                            if let Some(usage) = event["usage"].get("output_tokens") {
                                output_tokens = usage.as_u64().unwrap_or(0);
                            }
                            let stop_reason = event["delta"]["stop_reason"].as_str().unwrap_or("end_turn");
                            let _ = app.emit("stream-event", StreamEvent::StreamEnd {
                                stop_reason: stop_reason.to_string(),
                            });
                            let _ = app.emit("stream-event", StreamEvent::Usage {
                                input_tokens,
                                output_tokens,
                            });
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(())
}

async fn stream_openai_compatible(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    model: String,
    tools: Vec<ToolDef>,
    api_key: String,
    api_url: &str,
    provider: String,
    _max_tokens: u32,  // OpenAI-compatible: max_tokens is optional, not sent to API
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut msgs = Vec::new();
    if !system_prompt.is_empty() {
        msgs.push(serde_json::json!({"role": "system", "content": system_prompt}));
    }
    for m in &messages {
        msgs.push(serde_json::json!({"role": m.role, "content": m.content}));
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
    let mut body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": true,
        "stream_options": {
            "include_usage": true,
        },
    });
    if !oai_tools.is_empty() {
        body["tools"] = serde_json::Value::Array(oai_tools);
    }

    let response = client
        .post(api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
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
    let mut buffer = String::new();
    let mut tool_call_buffer: Option<(String, String, String)> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("流读取错误: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
            if line.is_empty() { continue; }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { continue; }
                if let Ok(event) = serde_json::from_str::<Value>(data) {
                    // Extract usage if present (final chunk with stream_options.include_usage)
                    if let Some(usage) = event["usage"].as_object() {
                        let input_tokens = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let output_tokens = usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        let _ = app.emit("stream-event", StreamEvent::Usage { input_tokens, output_tokens });
                    }
                    if let Some(choices) = event["choices"].as_array() {
                        for choice in choices {
                            // Thinking (DeepSeek reasoner)
                            if let Some(reasoning) = choice["delta"].get("reasoning_content") {
                                if let Some(text) = reasoning.as_str() {
                                    let _ = app.emit("stream-event", StreamEvent::ThinkingDelta { text: text.to_string() });
                                }
                            }
                            if let Some(delta) = choice["delta"].get("content") {
                                if let Some(text) = delta.as_str() {
                                    let _ = app.emit("stream-event", StreamEvent::TextDelta { text: text.to_string() });
                                }
                            }
                            // Tool calls (OpenAI format)
                            if let Some(tool_calls) = choice["delta"].get("tool_calls") {
                                for tc in tool_calls.as_array().unwrap_or(&vec![]) {
                                    let idx = tc["index"].as_u64().unwrap_or(0);
                                    if let Some(id) = tc["id"].as_str() {
                                        tool_call_buffer = Some((id.to_string(), String::new(), String::new()));
                                    }
                                    if let Some(ref mut buf) = tool_call_buffer {
                                        if let Some(name) = tc["function"]["name"].as_str() { buf.1 = name.to_string(); }
                                        if let Some(args) = tc["function"]["arguments"].as_str() { buf.2.push_str(args); }
                                    }
                                }
                            }
                            if let Some(finish) = choice["finish_reason"].as_str() {
                                // Flush tool call buffer
                                if let Some((id, name, args)) = tool_call_buffer.take() {
                                    if let Ok(input) = serde_json::from_str::<Value>(&args) {
                                        let _ = app.emit("stream-event", StreamEvent::ToolUse { id, name, input });
                                    }
                                }
                                let _ = app.emit("stream-event", StreamEvent::StreamEnd { stop_reason: finish.to_string() });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

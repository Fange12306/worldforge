use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static SESSION_IO_LOCK: Mutex<()> = Mutex::new(());

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

/// A single message in the JSONL session log
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum SessionMessage {
    #[serde(rename = "user")]
    User { content: String, timestamp: String },
    #[serde(rename = "assistant")]
    Assistant { content: String, thinking: Option<String>, timestamp: String },
    #[serde(rename = "system")]
    System { content: String, timestamp: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        tool: String,
        input: serde_json::Value,
        timestamp: String,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool: String,
        output: String,
        timestamp: String,
    },
}

/// Session index entry
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub story_id: String,
    pub title: String,
    pub created_at: String,
    pub message_count: usize,
}

/// Append a message to a session JSONL file
#[tauri::command]
pub fn append_session_message(
    world_path: String,
    session_id: String,
    message: SessionMessage,
) -> Result<(), String> {
    let _guard = SESSION_IO_LOCK
        .lock()
        .map_err(|_| "session 写入锁已损坏".to_string())?;
    let sessions_dir = expand(&world_path).join("sessions");
    fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("创建 sessions/ 失败: {}", e))?;

    let filepath = sessions_dir.join(format!("{}.jsonl", session_id));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&filepath)
        .map_err(|e| format!("打开 session 文件失败: {}", e))?;

    let line = serde_json::to_string(&message)
        .map_err(|e| format!("序列化失败: {}", e))?;
    writeln!(file, "{}", line)
        .map_err(|e| format!("写入失败: {}", e))?;

    Ok(())
}

/// Rewrite a session JSONL file with the supplied messages.
#[tauri::command]
pub fn rewrite_session_messages(
    world_path: String,
    session_id: String,
    messages: Vec<SessionMessage>,
) -> Result<(), String> {
    let _guard = SESSION_IO_LOCK
        .lock()
        .map_err(|_| "session 写入锁已损坏".to_string())?;
    let sessions_dir = expand(&world_path).join("sessions");
    fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("创建 sessions/ 失败: {}", e))?;

    let filepath = sessions_dir.join(format!("{}.jsonl", session_id));
    let mut lines = Vec::with_capacity(messages.len());
    for message in messages {
        lines.push(serde_json::to_string(&message)
            .map_err(|e| format!("序列化失败: {}", e))?);
    }
    let content = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    fs::write(&filepath, content)
        .map_err(|e| format!("写入 session 失败: {}", e))?;

    Ok(())
}

/// Load all messages from a session JSONL file
#[tauri::command]
pub fn load_session(
    world_path: String,
    session_id: String,
) -> Result<Vec<SessionMessage>, String> {
    let filepath = PathBuf::from(&world_path)
        .join("sessions")
        .join(format!("{}.jsonl", session_id));

    if !filepath.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&filepath)
        .map_err(|e| format!("读取 session 失败: {}", e))?;

    let mut messages = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Ok(msg) = serde_json::from_str::<SessionMessage>(trimmed) {
            messages.push(msg);
        }
    }
    Ok(messages)
}

/// List all saved sessions
#[tauri::command]
pub fn list_sessions(world_path: String) -> Result<Vec<SessionInfo>, String> {
    let sessions_dir = expand(&world_path).join("sessions");
    if !sessions_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".jsonl") { continue; }
            let id = fname.trim_end_matches(".jsonl").to_string();

            let message_count = if let Ok(content) = fs::read_to_string(entry.path()) {
                content.lines().count()
            } else {
                0
            };

            let metadata = entry.metadata().ok();
            let created_at = metadata
                .and_then(|m| m.created().ok())
                .map(|t| {
                    chrono::DateTime::<Utc>::from(t)
                        .to_rfc3339()
                })
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            sessions.push(SessionInfo {
                id: id.clone(),
                story_id: String::new(),
                title: id.clone(),
                created_at,
                message_count,
            });
        }
    }
    Ok(sessions)
}

/// Delete a session file (also cleans up .tokens)
#[tauri::command]
pub fn delete_session(world_path: String, session_id: String) -> Result<(), String> {
    let _guard = SESSION_IO_LOCK
        .lock()
        .map_err(|_| "session 写入锁已损坏".to_string())?;
    let dir = PathBuf::from(&world_path).join("sessions");
    for ext in &["jsonl", "tokens"] {
        let filepath = dir.join(format!("{}.{}", session_id, ext));
        if filepath.exists() {
            fs::remove_file(&filepath)
                .map_err(|e| format!("删除 {} 失败: {}", ext, e))?;
        }
    }
    Ok(())
}

/// Persist total token count for a conversation (survives restarts)
#[tauri::command]
pub fn save_session_tokens(world_path: String, session_id: String, total_tokens: u64) -> Result<(), String> {
    let filepath = PathBuf::from(&world_path)
        .join("sessions")
        .join(format!("{}.tokens", session_id));
    fs::write(&filepath, total_tokens.to_string())
        .map_err(|e| format!("写入 tokens 失败: {}", e))
}

/// Load persisted token count for a conversation
#[tauri::command]
pub fn load_session_tokens(world_path: String, session_id: String) -> Result<u64, String> {
    let filepath = PathBuf::from(&world_path)
        .join("sessions")
        .join(format!("{}.tokens", session_id));
    if !filepath.exists() {
        return Ok(0);
    }
    let s = fs::read_to_string(&filepath)
        .map_err(|e| format!("读取 tokens 失败: {}", e))?;
    s.trim().parse().map_err(|e| format!("解析 tokens 失败: {}", e))
}

/// Persist context window state for a conversation (survives restarts)
#[tauri::command]
pub fn save_session_state(world_path: String, session_id: String, state_json: String) -> Result<(), String> {
    let filepath = PathBuf::from(&world_path)
        .join("sessions")
        .join(format!("{}.state.json", session_id));
    fs::write(&filepath, &state_json)
        .map_err(|e| format!("写入状态失败: {}", e))
}

/// Load persisted context window state for a conversation
#[tauri::command]
pub fn load_session_state(world_path: String, session_id: String) -> Result<String, String> {
    let filepath = PathBuf::from(&world_path)
        .join("sessions")
        .join(format!("{}.state.json", session_id));
    if !filepath.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&filepath)
        .map_err(|e| format!("读取状态失败: {}", e))
}

/// Store and retrieve API keys using Tauri's store plugin.
/// Avoids macOS Keychain authorization prompts in Tauri dev mode.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

fn store_path() -> PathBuf {
    let dir = crate::utils::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".worldforge");
    let _ = fs::create_dir_all(&dir);
    dir.join("credentials.json")
}

fn legacy_store_path() -> PathBuf {
    PathBuf::from(".").join(".worldforge").join("credentials.json")
}

fn load_store() -> HashMap<String, String> {
    let path = store_path();
    for candidate in [&path, &legacy_store_path()] {
        if candidate.exists() {
            if let Ok(data) = fs::read_to_string(candidate) {
            if let Ok(map) = serde_json::from_str(&data) {
                return map;
            }
        }
        }
    }
    HashMap::new()
}

fn save_store(map: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(map).map_err(|e| format!("序列化失败: {}", e))?;
    let path = store_path();
    fs::write(&path, json).map_err(|e| format!("写入失败: {}", e))?;
    // Restrict permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn save_config(providers: String, models: Vec<serde_json::Value>, provider_id: String, key: String, base_url: Option<String>, active_model: Option<String>, compression_threshold: Option<f64>) -> Result<(), String> {
    let mut map = load_store();
    map.insert("providers".to_string(), providers);
    map.insert("models".to_string(), serde_json::to_string(&models).unwrap_or_default());
    map.insert("active_provider_id".to_string(), provider_id.clone());
    // API Key stored by provider ID
    if !key.is_empty() {
        map.insert(provider_id.clone(), key);
    }
    // Backward compat: also store under old provider key
    map.insert("provider".to_string(), provider_id.clone());
    if let Some(url) = base_url {
        map.insert(format!("{}_base_url", provider_id), url);
    }
    if let Some(am) = active_model {
        map.insert("active_model".to_string(), am);
    }
    if let Some(ct) = compression_threshold {
        map.insert("compression_threshold".to_string(), ct.to_string());
    }
    save_store(&map)
}

#[tauri::command]
pub fn load_config() -> Result<serde_json::Value, String> {
    let map = load_store();
    let providers_str = map.get("providers").cloned().unwrap_or_default();
    let models_str = map.get("models").cloned().unwrap_or_default();
    let models: Vec<serde_json::Value> = serde_json::from_str(&models_str).unwrap_or_default();
    let active_provider_id = map.get("active_provider_id").cloned().unwrap_or_default();
    // Backward compat: fall back to old "provider" key
    let provider = if active_provider_id.is_empty() {
        map.get("provider").cloned().unwrap_or_default()
    } else {
        active_provider_id.clone()
    };
    let base_url = if provider.is_empty() {
        String::new()
    } else {
        map.get(&format!("{}_base_url", provider)).cloned().unwrap_or_default()
    };
    let active_model = map.get("active_model").cloned().unwrap_or_default();
    let compression_threshold = map
        .get("compression_threshold")
        .and_then(|v| v.parse::<f64>().ok());
    Ok(serde_json::json!({
        "providers": providers_str,
        "provider": provider,
        "activeProviderId": active_provider_id,
        "models": models,
        "baseUrl": base_url,
        "activeModel": active_model,
        "compressionThreshold": compression_threshold,
    }))
}

#[tauri::command]
pub fn save_active_model(active_model: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert("active_model".to_string(), active_model);
    save_store(&map)
}

/// Proxy GET {base_url}/models through Rust to avoid CORS issues.
/// Strips /chat/completions suffix and appends /models.
#[tauri::command]
pub async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    // Strip trailing path segments like /chat/completions or /v1/chat/completions
    let base = base_url
        .trim_end_matches('/')
        .replace("/chat/completions", "")
        .replace("/messages", "");  // Anthropic format
    let models_url = format!("{}/models", base);

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let mut req = client.get(&models_url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;

    // OpenAI-compatible format: { "object": "list", "data": [{ "id": "model-name", ... }, ...] }
    let models: Vec<String> = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if models.is_empty() {
        return Err("未发现模型 — 响应格式可能不兼容".into());
    }
    Ok(models)
}

#[tauri::command]
pub fn save_api_key(provider: String, key: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert(provider, key);
    save_store(&map)
}

#[tauri::command]
pub fn get_api_key(provider: String) -> Result<String, String> {
    let map = load_store();
    map.get(&provider)
        .cloned()
        .ok_or_else(|| format!("未找到 {} 的 API Key", provider))
}

pub fn get_api_base_url(provider: String) -> Option<String> {
    let map = load_store();
    map.get(&format!("{}_base_url", provider)).cloned().filter(|s| !s.trim().is_empty())
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    let mut map = load_store();
    map.remove(&provider);
    save_store(&map)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LastSession {
    pub world_path: String,
    pub story_id: String,
    pub conversation_id: String,
}

#[tauri::command]
pub fn save_last_session(world_path: String, story_id: String, conversation_id: String) -> Result<(), String> {
    let mut map = load_store();
    let session = serde_json::to_string(&LastSession { world_path, story_id, conversation_id })
        .map_err(|e| format!("序列化失败: {}", e))?;
    map.insert("last_session".to_string(), session);
    save_store(&map)
}

#[tauri::command]
pub fn load_last_session() -> Result<Option<LastSession>, String> {
    let map = load_store();
    let session_str = match map.get("last_session") {
        Some(s) => s.clone(),
        None => return Ok(None),
    };
    serde_json::from_str(&session_str)
        .map(Some)
        .map_err(|e| format!("解析失败: {}", e))
}

#[tauri::command]
pub fn save_custom_prompt(custom_prompt: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert("custom_prompt".to_string(), custom_prompt);
    save_store(&map)
}

#[tauri::command]
pub fn load_custom_prompt() -> Result<String, String> {
    let map = load_store();
    Ok(map.get("custom_prompt").cloned().unwrap_or_default())
}

#[tauri::command]
pub fn save_language(language: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert("language".to_string(), language);
    save_store(&map)
}

#[tauri::command]
pub fn load_language() -> Result<String, String> {
    let map = load_store();
    Ok(map.get("language").cloned().unwrap_or_default())
}

#[tauri::command]
pub fn save_username(username: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert("username".to_string(), username);
    save_store(&map)
}

#[tauri::command]
pub fn load_username() -> Result<String, String> {
    let map = load_store();
    Ok(map.get("username").cloned().unwrap_or_default())
}

#[tauri::command]
pub fn save_avatar(avatar_data_url: String) -> Result<(), String> {
    let mut map = load_store();
    map.insert("avatar".to_string(), avatar_data_url);
    save_store(&map)
}

#[tauri::command]
pub fn load_avatar() -> Result<String, String> {
    let map = load_store();
    Ok(map.get("avatar").cloned().unwrap_or_default())
}

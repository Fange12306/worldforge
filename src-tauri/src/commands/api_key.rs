/// Store and retrieve API keys using Tauri's store plugin.
/// Avoids macOS Keychain authorization prompts in Tauri dev mode.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

static STORE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn store_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(&home).join(".worldforge");
    let _ = fs::create_dir_all(&dir);
    dir.join("credentials.json")
}

fn load_store() -> HashMap<String, String> {
    let path = store_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str(&data) {
                return map;
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
pub fn save_config(provider: String, models: Vec<serde_json::Value>, key: String, base_url: Option<String>) -> Result<(), String> {
    let mut map = load_store();
    let prov = provider.clone();
    map.insert("provider".to_string(), provider);
    map.insert("models".to_string(), serde_json::to_string(&models).unwrap_or_default());
    map.insert(prov.clone(), key);
    if let Some(url) = base_url {
        map.insert(format!("{}_base_url", prov), url);
    }
    save_store(&map)
}

#[tauri::command]
pub fn load_config() -> Result<serde_json::Value, String> {
    let map = load_store();
    let models_str = map.get("models").cloned().unwrap_or_default();
    let models: Vec<serde_json::Value> = serde_json::from_str(&models_str).unwrap_or_default();
    let provider = map.get("provider").cloned().unwrap_or_default();
    let base_url = if provider.is_empty() {
        String::new()
    } else {
        map.get(&format!("{}_base_url", provider)).cloned().unwrap_or_default()
    };
    Ok(serde_json::json!({
        "provider": provider,
        "models": models,
        "baseUrl": base_url,
    }))
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

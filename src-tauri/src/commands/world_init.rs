use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// Calendar epoch definition for the world's timeline system.
/// Reserved for Phase 6 — stored but not interpreted yet.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct CalendarConfig {
    pub epochs: Vec<CalendarEpoch>,
    pub era: String,
    pub description: String,
}

impl Default for CalendarConfig {
    fn default() -> Self {
        Self {
            epochs: Vec::new(),
            era: String::new(),
            description: String::new(),
        }
    }
}

/// A named epoch with an absolute offset.
/// Phase 6 will use these offsets to sort events across different epochs.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEpoch {
    pub name: String,
    pub offset: i64,
}

/// World metadata stored in world.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorldMeta {
    #[serde(default)]
    pub id: String,              // UUID — immutable identity
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub default_timeline: String,
    pub created_at: String,
    #[serde(default)]
    pub language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<CalendarConfig>,
}

/// Expand ~ in a path to the user's home directory
fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs_next() {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}

fn dirs_next() -> Option<String> {
    std::env::var("HOME").ok()
}

/// Initialize a new world directory.
/// Creates: world.json, entries/ subdirs, INDEX.md
#[tauri::command]
pub fn init_world(path: String, name: String) -> Result<WorldMeta, String> {
    let root = expand_tilde(&path);

    // Create directory if needed
    fs::create_dir_all(&root).map_err(|e| format!("无法创建目录: {}", e))?;

    // Create entries/ subdirectories
    let entry_types = [
        "characters", "locations", "organizations", "events",
        "systems", "artifacts", "eras", "concepts",
    ];
    let entries_dir = root.join("entries");
    fs::create_dir_all(&entries_dir).map_err(|e| format!("无法创建 entries/: {}", e))?;
    for t in &entry_types {
        fs::create_dir_all(entries_dir.join(t))
            .map_err(|e| format!("无法创建 entries/{}: {}", t, e))?;
    }

    // Create stories/, sessions/, memory/, exports/ dirs
    for d in &["stories", "sessions", "memory", "exports", "uploads"] {
        fs::create_dir_all(root.join(d))
            .map_err(|e| format!("无法创建 {}: {}", d, e))?;
    }

    // Create world.json
    let now = chrono::Utc::now().to_rfc3339();
    let meta = WorldMeta {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        description: String::new(),
        default_timeline: String::new(),
        created_at: now,
        language: "zh-CN".to_string(),
        calendar: None,
    };
    let json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(root.join("world.json"), &json)
        .map_err(|e| format!("写入 world.json 失败: {}", e))?;

    // Create empty INDEX.md
    fs::write(
        root.join("INDEX.md"),
        "# 词条索引\n\n",
    ).map_err(|e| format!("写入 INDEX.md 失败: {}", e))?;

    Ok(meta)
}

/// Open a world: read world.json and return its metadata
#[tauri::command]
pub fn open_world(path: String) -> Result<WorldMeta, String> {
    let root = expand_tilde(&path);
    let json = fs::read_to_string(root.join("world.json"))
        .map_err(|e| format!("无法读取 world.json: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("解析 world.json 失败: {}", e))
}

/// Scan a directory for valid world directories (containing world.json).
#[derive(Debug, Serialize, Clone)]
pub struct WorldListing {
    pub name: String,
    pub path: String,
    pub description: String,
}

#[tauri::command]
pub fn list_worlds(root_dir: String) -> Result<Vec<WorldListing>, String> {
    let root = expand_tilde(&root_dir);
    let mut worlds = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("无法读取目录: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let world_json = path.join("world.json");
            if world_json.exists() {
                if let Ok(json) = fs::read_to_string(&world_json) {
                    if let Ok(meta) = serde_json::from_str::<WorldMeta>(&json) {
                        worlds.push(WorldListing {
                            name: meta.name,
                            path: path.to_string_lossy().to_string(),
                            description: meta.description,
                        });
                    }
                }
            }
        }
    }
    Ok(worlds)
}

/// Rename a world (update world.json name field)
#[tauri::command]
pub fn rename_world(world_path: String, new_name: String) -> Result<(), String> {
    let root = expand_tilde(&world_path);
    let world_json_path = root.join("world.json");
    let json = fs::read_to_string(&world_json_path)
        .map_err(|e| format!("读取 world.json 失败: {}", e))?;
    let mut meta: WorldMeta = serde_json::from_str(&json)
        .map_err(|e| format!("解析 world.json 失败: {}", e))?;
    meta.name = new_name;
    let new_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&world_json_path, &new_json)
        .map_err(|e| format!("写入 world.json 失败: {}", e))
}

/// Get the worlds directory path (app data dir)
#[tauri::command]
pub fn get_worlds_dir(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| format!("{}", e))?
        .join("worlds");
    Ok(path.to_string_lossy().to_string())
}

/// Get the world path from the app state
#[tauri::command]
pub fn get_world_path(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| format!("{}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete a world directory and all its contents. Irreversible.
#[tauri::command]
pub fn delete_world(path: String) -> Result<(), String> {
    let root = expand_tilde(&path);
    if !root.exists() {
        return Err(format!("目录不存在: {}", root.display()));
    }
    fs::remove_dir_all(&root)
        .map_err(|e| format!("删除世界失败: {}", e))
}

/// Open world folder in the system file manager (Finder on macOS)
#[tauri::command]
pub fn reveal_world_folder(path: String) -> Result<(), String> {
    let root = expand_tilde(&path);
    if !root.exists() {
        return Err(format!("目录不存在: {}", root.display()));
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&root)
        .spawn()
        .map_err(|e| format!("无法打开文件夹: {}", e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&root)
        .spawn()
        .map_err(|e| format!("无法打开文件夹: {}", e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&root)
        .spawn()
        .map_err(|e| format!("无法打开文件夹: {}", e))?;
    Ok(())
}

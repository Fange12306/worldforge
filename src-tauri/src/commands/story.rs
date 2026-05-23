use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn expand(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoryMeta {
    pub id: String,
    pub title: String,
    pub status: String,
    pub conversations: Vec<ConversationMeta>,
    pub created_at: String,
}

fn stories_dir(root: &PathBuf) -> PathBuf {
    root.join("stories")
}

#[tauri::command]
pub fn save_story_meta(world_path: String, story: StoryMeta) -> Result<(), String> {
    let dir = stories_dir(&expand(&world_path));
    fs::create_dir_all(&dir).map_err(|e| format!("创建 stories/ 失败: {}", e))?;
    let json = serde_json::to_string_pretty(&story).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(dir.join(format!("{}.json", story.id)), &json)
        .map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn load_stories(world_path: String) -> Result<Vec<StoryMeta>, String> {
    let dir = stories_dir(&expand(&world_path));
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut stories = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(json) = fs::read_to_string(&path) {
                    if let Ok(meta) = serde_json::from_str::<StoryMeta>(&json) {
                        stories.push(meta);
                    }
                }
            }
        }
    }
    Ok(stories)
}

#[tauri::command]
pub fn delete_story_meta(world_path: String, story_id: String) -> Result<(), String> {
    let file = stories_dir(&expand(&world_path)).join(format!("{}.json", story_id));
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("删除失败: {}", e))?;
    }
    Ok(())
}

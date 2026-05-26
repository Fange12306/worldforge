use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

fn memory_dir(root: &PathBuf) -> PathBuf {
    root.join("memory")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryEntry {
    pub name: String,
    pub path: String,
    pub description: String,
}

/// MEMORY.md 索引格式：`- [name](file.md) — description`
#[tauri::command]
pub fn list_memories(world_path: String) -> Result<Vec<MemoryEntry>, String> {
    let dir = memory_dir(&expand(&world_path));
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let index_path = dir.join("MEMORY.md");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(&index_path).map_err(|e| format!("读取 MEMORY.md 失败: {}", e))?;
    let mut entries = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("- [") {
            continue;
        }
        // Parse: - [name](file.md) — description
        if let Some(name_start) = trimmed.find('[') {
            if let Some(name_end) = trimmed[name_start..].find(']') {
                let name = &trimmed[name_start + 1..name_start + name_end];
                if let Some(path_start) = trimmed[name_start + name_end..].find('(') {
                    if let Some(path_end) = trimmed[name_start + name_end + path_start..].find(')')
                    {
                        let path = &trimmed[name_start + name_end + path_start + 1
                            ..name_start + name_end + path_start + path_end];
                        let desc_start = name_start + name_end + path_start + path_end + 1;
                        let desc = trimmed[desc_start..]
                            .trim_start_matches('—')
                            .trim_start()
                            .to_string();
                        entries.push(MemoryEntry {
                            name: name.to_string(),
                            path: path.to_string(),
                            description: desc,
                        });
                    }
                }
            }
        }
    }
    Ok(entries)
}

/// Read a single memory file.
#[tauri::command]
pub fn read_memory(world_path: String, file_name: String) -> Result<String, String> {
    let path = memory_dir(&expand(&world_path)).join(&file_name);
    fs::read_to_string(&path).map_err(|e| format!("读取记忆文件失败: {}", e))
}

/// Write (create or update) a memory file and update MEMORY.md index.
#[tauri::command]
pub fn write_memory(
    world_path: String,
    file_name: String,
    content: String,
    description: Option<String>,
) -> Result<(), String> {
    let dir = memory_dir(&expand(&world_path));
    fs::create_dir_all(&dir).map_err(|e| format!("创建 memory/ 失败: {}", e))?;

    // Write the memory file
    fs::write(dir.join(&file_name), &content)
        .map_err(|e| format!("写入记忆文件失败: {}", e))?;

    // Update MEMORY.md index
    let index_path = dir.join("MEMORY.md");
    let mut index = String::new();
    if index_path.exists() {
        index = fs::read_to_string(&index_path).unwrap_or_default();
    }

    let desc = description.as_deref().unwrap_or("");
    let sep_desc = if desc.is_empty() { String::new() } else { format!(" — {}", desc) };
    let entry_line = format!(
        "- [{}]({}){}",
        file_name.trim_end_matches(".md"),
        file_name,
        sep_desc,
    );

    // Replace existing entry or append
    let mut lines: Vec<&str> = index.lines().collect();
    let mut found = false;
    for i in 0..lines.len() {
        if lines[i].contains(&format!("({})", file_name)) {
            lines[i] = &entry_line;
            found = true;
            break;
        }
    }
    let new_index = if found {
        lines.join("\n")
    } else {
        if !index.is_empty() && !index.ends_with('\n') {
            index.push('\n');
        }
        index + &entry_line + "\n"
    };

    fs::write(&index_path, new_index).map_err(|e| format!("更新 MEMORY.md 失败: {}", e))?;
    Ok(())
}

/// Delete a memory file and remove its entry from MEMORY.md.
#[tauri::command]
pub fn delete_memory(world_path: String, file_name: String) -> Result<(), String> {
    let dir = memory_dir(&expand(&world_path));
    let path = dir.join(&file_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除记忆文件失败: {}", e))?;
    }
    // Update index
    let index_path = dir.join("MEMORY.md");
    if index_path.exists() {
        let content = fs::read_to_string(&index_path).unwrap_or_default();
        let filtered: String = content
            .lines()
            .filter(|l| !l.contains(&format!("({})", file_name)))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&index_path, if filtered.trim().is_empty() {
            String::new()
        } else {
            filtered + "\n"
        })
        .map_err(|e| format!("更新 MEMORY.md 失败: {}", e))?;
    }
    Ok(())
}

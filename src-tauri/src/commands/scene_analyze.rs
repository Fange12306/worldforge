use crate::models::entry::{EntryType, IndexEntry};
use std::fs;
use std::path::PathBuf;

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

/// Parse YAML frontmatter from markdown content.
fn parse_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let rest = &trimmed[3..];
    let end = rest.find("---")?;
    let fm_text = &rest[..end].trim();
    for line in fm_text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim() == field {
                return Some(value.trim().trim_matches('"').trim_matches('\'').to_string());
            }
        }
    }
    None
}

/// Load all index entries from the entries directory.
fn load_index_entries(root: &PathBuf) -> Vec<IndexEntry> {
    let entries_root = root.join("entries");
    let mut result = Vec::new();
    let type_dirs: &[(&str, EntryType)] = &[
        ("characters", EntryType::Character),
        ("locations", EntryType::Location),
        ("organizations", EntryType::Organization),
        ("systems", EntryType::System),
        ("artifacts", EntryType::Artifact),
        ("eras", EntryType::Era),
        ("concepts", EntryType::Concept),
    ];
    for (dir_name, entry_type) in type_dirs {
        let dir = entries_root.join(dir_name);
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let id = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string();
                        let name = parse_frontmatter_field(&content, "name").unwrap_or_default();
                        let rel_path = path
                            .strip_prefix(root)
                            .ok()
                            .and_then(|p| p.to_str())
                            .unwrap_or("")
                            .to_string();
                        result.push(IndexEntry {
                            id,
                            name,
                            entry_type: (*entry_type).clone(),
                            path: rel_path,
                            tags: Vec::new(),
                        });
                    }
                }
            }
        }
    }
    result
}

#[derive(serde::Serialize)]
pub struct SceneAnalysis {
    word_count: usize,
    paragraph_count: usize,
    estimated_reading_minutes: f64,
    dialogue_ratio: f64,
    referenced_entries: Vec<String>,
    structure_hints: Vec<String>,
}

#[tauri::command]
pub fn scene_analyze(world_path: String, scene_text: String, aspect: Option<String>) -> Result<SceneAnalysis, String> {
    let root = expand(&world_path);
    let aspect = aspect.unwrap_or_else(|| "all".to_string());

    // Basic text stats
    let word_count = scene_text.chars().count();
    let paragraphs: Vec<&str> = scene_text.lines().filter(|l| !l.trim().is_empty()).collect();
    let paragraph_count = paragraphs.len();
    let estimated_reading_minutes = (word_count as f64 / 500.0).max(0.1);

    // Dialogue ratio: lines starting with quotes or Chinese quotation marks
    let dialogue_lines = paragraphs
        .iter()
        .filter(|l| {
            let t = l.trim();
            t.starts_with('"')
                || t.starts_with('「')
                || t.starts_with('」')
                || t.starts_with('\'')
                || t.starts_with('\u{201C}')
                || t.starts_with('\u{201D}')
        })
        .count();
    let dialogue_ratio = if paragraph_count > 0 {
        (dialogue_lines as f64 / paragraph_count as f64).min(1.0)
    } else {
        0.0
    };

    // Cross-reference with entries
    let entries = if aspect == "all" || aspect == "characters" || aspect == "structure" {
        load_index_entries(&root)
    } else {
        Vec::new()
    };
    let mut referenced_entries: Vec<String> = Vec::new();
    for entry in &entries {
        if !entry.name.is_empty() && scene_text.contains(&entry.name) {
            let type_label = match entry.entry_type {
                EntryType::Character => "角色",
                EntryType::Location => "地点",
                EntryType::Organization => "组织",
                EntryType::System => "系统",
                EntryType::Artifact => "物品",
                EntryType::Era => "时代",
                EntryType::Concept => "概念",
            };
            referenced_entries.push(format!("{} [{}]", entry.name, type_label));
        }
    }

    // Structure hints — filtered by aspect
    let mut structure_hints: Vec<String> = Vec::new();
    let show_structure = aspect == "all" || aspect == "structure";
    let show_characters = aspect == "all" || aspect == "characters";
    let show_pacing = aspect == "all" || aspect == "pacing";

    if show_structure && word_count < 200 {
        structure_hints.push("场景较短，可能需要扩展描写".into());
    }
    if show_pacing && dialogue_ratio > 0.7 {
        structure_hints.push("对话比例较高，考虑增加叙述和描写".into());
    } else if show_pacing && dialogue_ratio < 0.1 && word_count > 500 {
        structure_hints.push("对话比例很低，纯叙述可能让读者感到疏离".into());
    }
    if show_structure && paragraph_count > 0 && (word_count / paragraph_count) > 300 {
        structure_hints.push("段落较长，考虑拆分以提升可读性".into());
    }
    if show_characters && referenced_entries.is_empty() && word_count > 100 {
        structure_hints.push("未检测到已有词条的引用，确认场景是否充分利用了设定".into());
    }

    Ok(SceneAnalysis {
        word_count,
        paragraph_count,
        estimated_reading_minutes: (estimated_reading_minutes * 10.0).round() / 10.0,
        dialogue_ratio: (dialogue_ratio * 100.0).round() / 100.0,
        referenced_entries,
        structure_hints,
    })
}

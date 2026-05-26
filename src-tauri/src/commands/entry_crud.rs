use crate::models::constraint::Constraint;
use crate::models::entry::{Entry, EntryType, IndexEntry, TimelinePeriod};
use crate::models::relationship::Relationship;
use chrono::Utc;
use serde_json;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use uuid::Uuid;

fn expand_path(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    PathBuf::from(path)
}

fn type_dir(entries_root: &PathBuf, t: &EntryType) -> String {
    entries_root.join(entry_type_dir_name(t)).to_string_lossy().to_string()
}

fn entry_type_from_str(s: &str) -> EntryType {
    match s {
        "character" => EntryType::Character,
        "location" => EntryType::Location,
        "organization" => EntryType::Organization,
        "event" => return EntryType::Concept, // deprecated — redirect to Concept
        "system" => EntryType::System,
        "artifact" => EntryType::Artifact,
        "era" => EntryType::Era,
        _ => EntryType::Concept,
    }
}

fn entry_type_dir_name(t: &EntryType) -> &str {
    match t {
        EntryType::Character => "characters",
        EntryType::Location => "locations",
        EntryType::Organization => "organizations",
        EntryType::System => "systems",
        EntryType::Artifact => "artifacts",
        EntryType::Era => "eras",
        EntryType::Concept => "concepts",
    }
}

fn entry_type_str(t: &EntryType) -> &str {
    match t {
        EntryType::Character => "character",
        EntryType::Location => "location",
        EntryType::Organization => "organization",
        EntryType::System => "system",
        EntryType::Artifact => "artifact",
        EntryType::Era => "era",
        EntryType::Concept => "concept",
    }
}

fn all_entry_types() -> Vec<EntryType> {
    vec![
        EntryType::Character, EntryType::Location, EntryType::Organization,
        EntryType::System, EntryType::Artifact,
        EntryType::Era, EntryType::Concept,
    ]
}

fn format_constraints(constraints: &[Constraint]) -> String {
    if constraints.is_empty() {
        return String::new();
    }
    let mut out = String::from("constraints:\n");
    for c in constraints {
        let severity = match c.severity {
            crate::models::constraint::ConstraintSeverity::Hard => "hard",
            crate::models::constraint::ConstraintSeverity::Soft => "soft",
        };
        out.push_str(&format!("  - rule: \"{}\"\n    severity: {}\n", c.rule, severity));
        if let Some(ref tl) = c.timeline_id {
            out.push_str(&format!("    timeline_id: \"{}\"\n", tl));
        }
    }
    out
}

// ── Parse a .md file ──

fn extract_frontmatter(raw: &str) -> Result<(serde_json::Value, String), String> {
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first() != Some(&"---") {
        return Err("缺少 frontmatter (文件必须以 --- 开头)".to_string());
    }
    let end = lines[1..].iter()
        .position(|&l| l == "---")
        .ok_or_else(|| "frontmatter 未闭合".to_string())?;

    let yaml_str = lines[1..end + 1].join("\n");
    let body = if end + 2 < lines.len() {
        lines[end + 2..].join("\n")
    } else {
        String::new()
    };

    let value: serde_json::Value = serde_yaml::from_str(&yaml_str)
        .map_err(|e| format!("YAML 解析失败: {}", e))?;

    Ok((value, body))
}

fn parse_entry_file(filepath: &PathBuf) -> Result<Entry, String> {
    let raw = fs::read_to_string(filepath)
        .map_err(|e| format!("读取失败: {}", e))?;
    let (data, body) = extract_frontmatter(&raw)?;

    // UUID is the canonical internal ID. If missing (legacy entry), generate and persist one.
    let id = data["id"].as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| {
            let new_id = Uuid::new_v4().to_string();
            // Migrate: write the UUID back to the file
            let migrated = migrate_add_uuid(&raw, &new_id);
            if let Ok(content) = migrated {
                let _ = fs::write(filepath, &content);
            }
            new_id
        });

    let name = data["name"].as_str().unwrap_or("未命名").to_string();
    let entry_type = data["type"].as_str()
        .map(entry_type_from_str)
        .unwrap_or(EntryType::Concept);

    let relationships: Vec<Relationship> =
        data["relationships"].as_array()
            .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
            .unwrap_or_default();

    let constraints: Vec<Constraint> =
        data["constraints"].as_array()
            .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
            .unwrap_or_default();

    let tags: Vec<String> = data["tags"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let created_at = data["created_at"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let updated_at = data["updated_at"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let timeline_summary: Vec<TimelinePeriod> =
        data["timeline_summary"].as_array()
            .map(|arr| arr.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
            .unwrap_or_default();

    Ok(Entry {
        id, name, entry_type,
        properties: data.get("properties").cloned().unwrap_or(serde_json::Value::Object(Default::default())),
        relationships, constraints, tags, created_at, updated_at, body,
        timeline_summary,
    })
}

/// Inject a UUID into the frontmatter of an existing entry that lacks one.
fn migrate_add_uuid(raw: &str, uuid: &str) -> Result<String, String> {
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first() != Some(&"---") {
        return Err("缺少 frontmatter".to_string());
    }
    let _end = lines[1..].iter()
        .position(|&l| l == "---")
        .ok_or_else(|| "frontmatter 未闭合".to_string())?;
    // Insert id after the first --- line
    let mut result: Vec<String> = vec!["---".to_string()];
    result.push(format!("id: \"{}\"", uuid));
    for (i, line) in lines.iter().enumerate() {
        if i == 0 { continue; } // skip first ---
        result.push(line.to_string());
    }
    Ok(result.join("\n"))
}

/// Find an entry file whose frontmatter `id` matches the given UUID.
fn find_entry_by_uuid(entries_root: &PathBuf, uuid: &str) -> Option<PathBuf> {
    for t in &all_entry_types() {
        let dir = PathBuf::from(type_dir(entries_root, t));
        if !dir.exists() { continue; }
        if let Ok(read) = fs::read_dir(&dir) {
            for e in read.flatten() {
                let path = e.path();
                if path.extension().and_then(|s| s.to_str()) != Some("md") { continue; }
                // Quick frontmatter parse
                if let Ok(raw) = fs::read_to_string(&path) {
                    if let Ok((data, _)) = extract_frontmatter(&raw) {
                        if data["id"].as_str() == Some(uuid) {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }
    None
}

// ── Commands ──

/// Search by UUID (frontmatter `id`), not filename.
#[tauri::command]
pub fn read_entry(world_path: String, entry_id: String) -> Result<Entry, String> {
    let entries_root = expand_path(&world_path).join("entries");
    if !entries_root.exists() {
        return Err("词条目录尚未初始化".to_string());
    }
    // First try UUID lookup
    if let Some(fp) = find_entry_by_uuid(&entries_root, &entry_id) {
        return parse_entry_file(&fp);
    }
    // Fallback: legacy filename-based lookup (for entries without UUID migration)
    for t in &all_entry_types() {
        let fp = PathBuf::from(type_dir(&entries_root, t)).join(format!("{}.md", entry_id));
        if fp.exists() { return parse_entry_file(&fp); }
    }
    Err(format!("词条 '{}' 未找到", entry_id))
}

#[tauri::command]
pub fn create_entry(world_path: String, name: String, entry_type: String, body: Option<String>, constraints: Option<Vec<Constraint>>) -> Result<Entry, String> {
    let id = Uuid::new_v4().to_string();
    let t = entry_type_from_str(&entry_type);
    let entries_root = expand_path(&world_path).join("entries");
    let dir = type_dir(&entries_root, &t);
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let fp = PathBuf::from(&dir).join(format!("{}.md", id));

    let now = Utc::now().to_rfc3339();
    let body_text = body.unwrap_or_else(|| format!("# {}", name));
    let constraints_yaml = format_constraints(&constraints.unwrap_or_default());
    let content = format!(
        "---\nid: {}\nname: {}\ntype: {}\ncreated_at: {}\nupdated_at: {}\ntags: []\n{}---\n\n{}\n",
        id, name, entry_type_str(&t), now, now, constraints_yaml, body_text
    );
    fs::write(&fp, &content).map_err(|e| format!("写入失败: {}", e))?;
    update_index(&world_path)?;
    parse_entry_file(&fp)
}

#[tauri::command]
pub fn update_entry(
    world_path: String,
    entry_id: String,
    name: String,
    body: String,
    entry_type: Option<String>,
    constraints: Option<Vec<Constraint>>,
) -> Result<Entry, String> {
    let entries_root = expand_path(&world_path).join("entries");
    // Find by UUID first, then fallback to filename
    let fp = find_entry_by_uuid(&entries_root, &entry_id)
        .or_else(|| {
            for t in &all_entry_types() {
                let candidate = PathBuf::from(type_dir(&entries_root, t)).join(format!("{}.md", entry_id));
                if candidate.exists() { return Some(candidate); }
            }
            None
        })
        .ok_or_else(|| format!("词条 '{}' 不存在", entry_id))?;

    // Read existing entry to preserve UUID and metadata
    let existing = parse_entry_file(&fp)?;

    // Determine new type: provided param wins, otherwise keep existing
    let new_type = match entry_type {
        Some(ref t) => entry_type_from_str(t),
        None => existing.entry_type.clone(),
    };
    let type_changed = new_type != existing.entry_type;

    // Use provided constraints, or keep existing ones
    let final_constraints = constraints.unwrap_or(existing.constraints);
    let constraints_yaml = format_constraints(&final_constraints);

    // Build new frontmatter
    let fm = format!(
        "id: {}\nname: {}\ntype: {}\ncreated_at: {}\nupdated_at: {}\ntags: [{}]\n{}",
        existing.id, name, entry_type_str(&new_type),
        existing.created_at.to_rfc3339(), Utc::now().to_rfc3339(),
        existing.tags.join(", "),
        constraints_yaml
    );
    let body_content = if body.is_empty() { format!("# {}", name) } else { body };
    let new_content = format!("---\n{}---\n\n{}", fm, body_content);

    if type_changed {
        // Write to new type directory, then remove old file
        let new_dir = type_dir(&entries_root, &new_type);
        fs::create_dir_all(&new_dir).map_err(|e| format!("创建目录失败: {}", e))?;
        let new_path = PathBuf::from(&new_dir).join(format!("{}.md", existing.id));
        fs::write(&new_path, &new_content).map_err(|e| format!("写入失败: {}", e))?;
        let _ = fs::remove_file(&fp);
    } else {
        fs::write(&fp, &new_content).map_err(|e| format!("写入失败: {}", e))?;
    }

    update_index(&world_path)?;
    // Parse from new location if type changed
    if type_changed {
        let new_path = PathBuf::from(type_dir(&entries_root, &new_type)).join(format!("{}.md", existing.id));
        parse_entry_file(&new_path)
    } else {
        parse_entry_file(&fp)
    }
}

#[tauri::command]
pub fn delete_entry(world_path: String, entry_id: String) -> Result<(), String> {
    let entries_root = expand_path(&world_path).join("entries");
    // Find by UUID first, then filename fallback
    if let Some(fp) = find_entry_by_uuid(&entries_root, &entry_id) {
        fs::remove_file(&fp).map_err(|e| format!("删除失败: {}", e))?;
        update_index(&world_path)?;
        return Ok(());
    }
    // Legacy fallback
    for t in &all_entry_types() {
        let fp = PathBuf::from(type_dir(&entries_root, t)).join(format!("{}.md", entry_id));
        if fp.exists() {
            fs::remove_file(&fp).map_err(|e| format!("删除失败: {}", e))?;
            update_index(&world_path)?;
            return Ok(());
        }
    }
    Err(format!("词条 '{}' 未找到", entry_id))
}

/// List entries by scanning filesystem and parsing frontmatter for UUID + name.
#[tauri::command]
pub fn list_entries(world_path: String) -> Result<Vec<IndexEntry>, String> {
    let entries_root = expand_path(&world_path).join("entries");
    if !entries_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for t in &all_entry_types() {
        let dir = PathBuf::from(type_dir(&entries_root, t));
        if !dir.exists() { continue; }
        if let Ok(read) = fs::read_dir(&dir) {
            for e in read.flatten() {
                let fname = e.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".md") { continue; }
                let path = e.path();
                // Parse frontmatter for UUID and display name
                let (id, name, tags) = if let Ok(raw) = fs::read_to_string(&path) {
                    if let Ok((data, _)) = extract_frontmatter(&raw) {
                        let uuid = data["id"].as_str().unwrap_or("").to_string();
                        let display = data["name"].as_str().unwrap_or("未命名").to_string();
                        let t = data["tags"].as_array()
                            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                            .unwrap_or_default();
                        if uuid.is_empty() {
                            // Legacy: no UUID yet, use filename as id until migration
                            let fallback_id = fname.trim_end_matches(".md").to_string();
                            (fallback_id, display, t)
                        } else {
                            (uuid, display, t)
                        }
                    } else {
                        let fallback_id = fname.trim_end_matches(".md").to_string();
                        (fallback_id.clone(), fallback_id.replace('-', " "), Vec::new())
                    }
                } else {
                    let fallback_id = fname.trim_end_matches(".md").to_string();
                    (fallback_id.clone(), fallback_id.replace('-', " "), Vec::new())
                };
                entries.push(IndexEntry {
                    id,
                    name,
                    entry_type: t.clone(),
                    path: format!("./entries/{}/{}", entry_type_dir_name(t), fname),
                    tags,
                });
            }
        }
    }
    Ok(entries)
}

/// Write an uploaded file to the world directory.
/// conversation_id: scopes uploads per-conversation (uploads/<convId>/file_name).
/// Without it, falls back to uploads/file_name (legacy).
#[tauri::command]
pub fn write_file(world_path: String, file_name: String, content: String, conversation_id: Option<String>) -> Result<(), String> {
    let root = expand_path(&world_path);
    let uploads = if let Some(cid) = conversation_id {
        root.join("uploads").join(&cid)
    } else {
        root.join("uploads")
    };
    fs::create_dir_all(&uploads).map_err(|e| format!("创建目录失败: {}", e))?;
    fs::write(uploads.join(&file_name), &content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// Delete a subdirectory under the world path (e.g. uploads/<convId>)
#[tauri::command]
pub fn delete_directory(world_path: String, dir_name: String) -> Result<(), String> {
    let full = expand_path(&world_path).join(&dir_name);
    if full.exists() {
        fs::remove_dir_all(&full)
            .map_err(|e| format!("删除目录失败: {}", e))?;
    }
    Ok(())
}

/// Read a file from the world directory (for FileRead tool).
/// Extract text from PDF bytes using pdf-extract
fn pdf_bytes_to_text(data: &[u8]) -> Result<String, String> {
    let mut cursor = std::io::Cursor::new(data);
    let mut buf = Vec::new();
    cursor.read_to_end(&mut buf).map_err(|e| format!("读取 PDF 数据失败: {}", e))?;
    // pdf_extract needs a second cursor
    let doc = pdf_extract::extract_text_from_mem(&buf)
        .map_err(|e| format!("PDF 解析失败: {}", e))?;
    if doc.trim().is_empty() {
        return Err("PDF 中未提取到文本（可能是扫描图片或加密文件）".to_string());
    }
    Ok(doc)
}

/// Extract text from uploaded PDF bytes (called from frontend on file pick)
#[tauri::command]
pub fn pdf_to_text(bytes: Vec<u8>) -> Result<String, String> {
    pdf_bytes_to_text(&bytes)
}

fn slice_text(content: &str, offset: usize, limit: usize) -> serde_json::Value {
    let total_chars = content.chars().count();
    let start = offset.min(total_chars);
    let end = (start + limit).min(total_chars);
    let text: String = content.chars().skip(start).take(end - start).collect();
    serde_json::json!({
        "content": text,
        "offset": start,
        "next_offset": if end < total_chars { Some(end) } else { None },
        "total_chars": total_chars,
        "truncated": end < total_chars,
    })
}

/// Searches: exact path, uploads/*/ (per-conversation), uploads/ (legacy), and bare filename in uploads/*/.
#[tauri::command]
pub fn read_file(world_path: String, file_path: String, offset: Option<usize>, limit: Option<usize>) -> Result<String, String> {
    let root = expand_path(&world_path);
    // Build candidate list dynamically: exact path first, then uploads subdirs, then legacy
    let mut candidates = vec![root.join(&file_path)];

    // uploads/<any_subdir>/<file_path> — per-conversation
    let uploads_dir = root.join("uploads");
    if let Ok(entries) = fs::read_dir(&uploads_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                candidates.push(entry.path().join(&file_path));
                // Also try just the filename in this subdir
                let bare = file_path.split('/').last().unwrap_or(&file_path);
                candidates.push(entry.path().join(bare));
            }
        }
    }
    // Legacy flat uploads/ path
    candidates.push(uploads_dir.join(&file_path));
    candidates.push(uploads_dir.join(file_path.trim_start_matches("uploads/")));

    for full in candidates {
        if let Ok(canonical) = full.canonicalize() {
            let root_canonical = root.canonicalize().unwrap_or(root.clone());
            if canonical.starts_with(&root_canonical) {
                // PDF files need special handling
                let content = if canonical.extension().map(|e| e == "pdf").unwrap_or(false) {
                    let data = fs::read(&canonical)
                        .map_err(|e| format!("读取 PDF 文件失败: {}", e))?;
                    pdf_bytes_to_text(&data)?
                } else {
                    fs::read_to_string(&canonical)
                        .map_err(|e| format!("读取失败: {}", e))?
                };
                if offset.is_some() || limit.is_some() {
                    let page = slice_text(&content, offset.unwrap_or(0), limit.unwrap_or(20_000));
                    return serde_json::to_string_pretty(&page)
                        .map_err(|e| format!("序列化分页结果失败: {}", e));
                }
                return Ok(content);
            }
        }
    }
    Err(format!("未找到: {} (文件不存在，不要重试同一路径)", file_path))
}

/// Link two entries — add a relationship to both entries' frontmatter
#[tauri::command]
pub fn link_entries(world_path: String, from_id: String, to_id: String, relation: String) -> Result<String, String> {
    let root = expand_path(&world_path).join("entries");
    // Read and update the 'from' entry
    let from_path = find_entry_file(&root, &from_id).ok_or_else(|| format!("词条 '{}' 未找到", from_id))?;
    let to_path = find_entry_file(&root, &to_id).ok_or_else(|| format!("词条 '{}' 未找到", to_id))?;

    add_relationship_to_file(&from_path, &to_id, &relation)?;
    add_relationship_to_file(&to_path, &from_id, &format!("反向_{}", relation))?;
    update_index(&world_path)?;
    Ok(format!("已建立关联: {} → {} ({})", from_id, to_id, relation))
}

fn find_entry_file(root: &std::path::PathBuf, id: &str) -> Option<std::path::PathBuf> {
    // Try UUID lookup first
    if let Some(fp) = find_entry_by_uuid(root, id) {
        return Some(fp);
    }
    // Legacy filename fallback
    for t in &all_entry_types() {
        let fp = std::path::PathBuf::from(type_dir(root, t)).join(format!("{}.md", id));
        if fp.exists() { return Some(fp); }
    }
    None
}

fn add_relationship_to_file(path: &std::path::PathBuf, target_id: &str, relation: &str) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("读取失败: {}", e))?;
    let (mut data, body) = extract_frontmatter(&raw)?;

    let relationships = data.get_mut("relationships")
        .and_then(|v| v.as_array_mut());

    let new_rel = serde_json::json!({ "target_id": target_id, "relation": relation });

    if let Some(arr) = relationships {
        // Check if already exists
        let exists = arr.iter().any(|r| r["target_id"] == target_id && r["relation"] == relation);
        if !exists { arr.push(new_rel); }
    } else {
        data["relationships"] = serde_json::json!([new_rel]);
    }

    let yaml = serde_yaml::to_string(&data).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, format!("---\n{}---\n\n{}", yaml, body)).map_err(|e| format!("写入失败: {}", e))
}

/// List all files in the world directory (excluding entries/ — use EntrySearch for entries)
/// Recursively list files and directories under a path, with depth limit.
/// Results cached for 5 seconds — repeated calls within that window return same data.
/// Directories end with "/", files are shown with their relative path from subdir root.
/// Skips `entries/` (huge, not useful for file listing) and hidden files.
#[tauri::command]
pub fn list_files(world_path: String, subdir: Option<String>) -> Result<Vec<String>, String> {
    use std::sync::Mutex;
    use std::collections::HashMap;
    static CACHE: Mutex<Option<HashMap<String, (Vec<String>, std::time::Instant)>>> = Mutex::new(None);

    // Normalize: null, "", and "." all mean root
    let subdir = subdir.filter(|s| !s.is_empty() && s != ".");
    let cache_key = format!("{}:{}", world_path, subdir.as_deref().unwrap_or("."));
    {
        let cache = CACHE.lock().unwrap();
        if let Some(ref map) = *cache {
            if let Some((files, timestamp)) = map.get(&cache_key) {
                if timestamp.elapsed().as_secs() < 5 {
                    return Ok(files.clone());
                }
            }
        }
    }

    let root = expand_path(&world_path);
    let dir = match &subdir {
        Some(s) => root.join(s),
        None => root.clone(),
    };
    if !dir.exists() {
        let mut cache = CACHE.lock().unwrap();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(cache_key, (Vec::new(), std::time::Instant::now()));
        return Ok(Vec::new());
    }

    let mut files: Vec<String> = Vec::new();
    let max_depth = 3;
    collect_files(&dir, &dir, "", 0, max_depth, &mut files);
    files.sort();

    // Truncate if too many entries
    if files.len() > 200 {
        files.truncate(200);
        files.push("...(已截断，共 200+ 项)".to_string());
    }

    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(HashMap::new);
    map.insert(cache_key, (files.clone(), std::time::Instant::now()));
    Ok(files)
}

fn collect_files(
    root: &std::path::Path,
    current: &std::path::Path,
    prefix: &str,
    depth: u32,
    max_depth: u32,
    out: &mut Vec<String>,
) {
    if depth > max_depth { return; }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if depth == 0 && name == "entries" { continue; } // skip huge entries/ dir at root
        let ft = match entry.file_type() { Ok(t) => t, Err(_) => continue, };
        let rel = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
        if ft.is_dir() {
            out.push(format!("{}/", rel));
            // Recurse into subdirectories (but limit depth)
            if depth < max_depth {
                collect_files(root, &entry.path(), &rel, depth + 1, max_depth, out);
            }
        } else {
            out.push(rel);
        }
    }
}

/// Grep entries — search full text of all .md entry files
#[tauri::command]
pub fn grep_entries(world_path: String, pattern: String, max_results: Option<usize>) -> Result<Vec<serde_json::Value>, String> {
    let root = expand_path(&world_path).join("entries");
    let max = max_results.unwrap_or(20).min(50);
    let mut results: Vec<serde_json::Value> = Vec::new();

    for dir_entry in walkdir::WalkDir::new(&root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if results.len() >= max { break; }
        if !dir_entry.file_type().is_file() { continue; }
        let path = dir_entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") { continue; }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !content.to_lowercase().contains(&pattern.to_lowercase()) { continue; }

        // Find matching lines
        let lines: Vec<String> = content.lines()
            .enumerate()
            .filter(|(_, l)| l.to_lowercase().contains(&pattern.to_lowercase()))
            .take(15)
            .map(|(i, l)| format!("{}: {}", i + 1, l.trim()))
            .collect();

        let rel_path = path.strip_prefix(&root).unwrap_or(path).to_string_lossy();
        results.push(serde_json::json!({
            "path": rel_path,
            "matches": lines,
        }));
    }
    Ok(results)
}

/// Rebuild INDEX.md from filesystem
pub fn update_index(world_path: &str) -> Result<(), String> {
    let root = expand_path(world_path);
    let entries_root = root.join("entries");
    if !entries_root.exists() {
        fs::create_dir_all(&entries_root).map_err(|e| format!("创建 entries/ 失败: {}", e))?;
    }

    let mut lines = vec!["# 词条索引\n".to_string()];
    let types = vec![
        ("characters", "Character", EntryType::Character),
        ("locations", "Location", EntryType::Location),
        ("organizations", "Organization", EntryType::Organization),
        ("systems", "System", EntryType::System),
        ("artifacts", "Artifact", EntryType::Artifact),
        ("eras", "Era", EntryType::Era),
        ("concepts", "Concept", EntryType::Concept),
    ];

    for (dir_name, label, _t) in &types {
        let dir_path = entries_root.join(dir_name);
        if !dir_path.exists() { continue; }
        lines.push(format!("\n## {}\n", label));
        if let Ok(read) = fs::read_dir(&dir_path) {
            for entry in read.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".md") { continue; }
                // Read display name from frontmatter, fallback to filename
                let name = if let Ok(raw) = fs::read_to_string(entry.path()) {
                    if let Ok((data, _)) = extract_frontmatter(&raw) {
                        data["name"].as_str().unwrap_or("未命名").to_string()
                    } else { "未命名".to_string() }
                } else { "未命名".to_string() };
                lines.push(format!(
                    "- [{}](./entries/{}/{}) — type: {}",
                    name, dir_name, fname, label
                ));
            }
        }
    }

    fs::write(root.join("INDEX.md"), lines.join("\n") + "\n")
        .map_err(|e| format!("写入 INDEX.md 失败: {}", e))
}

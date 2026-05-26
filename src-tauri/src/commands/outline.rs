use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

fn outline_dir(root: &PathBuf, story_id: &str) -> PathBuf {
    root.join("outline").join(story_id)
}

fn old_outline_file(root: &PathBuf, story_id: &str) -> PathBuf {
    root.join("outline").join(format!("{}.md", story_id))
}

/// Each chapter lives as its own .md file under outline/<storyId>/
#[derive(serde::Serialize, Clone, Debug)]
pub struct ChapterInfo {
    #[serde(default)]
    id: String,                            // UUID — immutable identity
    order: i32,
    title: String,
    status: String,
    summary: String,
    has_body: bool,
    word_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time_period: Option<Vec<i64>>,       // deprecated — use linked_events
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    involved_entries: Vec<String>,        // derived from linked_events
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    linked_events: Vec<String>,           // 🆕 Phase 5: "timeline_id:event_id"
}

/// Parse frontmatter from chapter .md content. Returns (fields, body).
fn parse_chapter_file(content: &str) -> (std::collections::HashMap<String, String>, String) {
    let mut fields = std::collections::HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (fields, trimmed.to_string());
    }
    let rest = &trimmed[3..];
    let body = match rest.find("---") {
        Some(end) => {
            let fm_text = &rest[..end].trim();
            for line in fm_text.lines() {
                if let Some((key, value)) = line.split_once(':') {
                    fields.insert(
                        key.trim().to_string(),
                        value.trim().trim_matches('"').trim_matches('\'').to_string(),
                    );
                }
            }
            rest[end + 3..].trim().to_string()
        }
        None => rest.to_string(),
    };
    (fields, body)
}

/// Strip frontmatter from body text (in case LLM includes it in the body field).
fn strip_body_frontmatter(body: &str) -> &str {
    let trimmed = body.trim_start();
    if trimmed.starts_with("---") {
        if let Some(end) = trimmed[3..].find("---") {
            let after = &trimmed[3 + end + 3..];
            return after.trim();
        }
    }
    body
}

fn build_chapter_md(
    id: &str,
    title: &str,
    order: i32,
    status: &str,
    summary: &str,
    body: &str,
    linked_events: &[String],
) -> String {
    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("id: \"{}\"\n", id));
    md.push_str(&format!("title: \"{}\"\n", title));
    md.push_str(&format!("order: {}\n", order));
    md.push_str(&format!("status: {}\n", status));
    md.push_str(&format!("summary: \"{}\"\n", summary));
    if !linked_events.is_empty() {
        md.push_str(&format!("linked_events: [{}]\n", linked_events.iter()
            .map(|e| format!("\"{}\"", e))
            .collect::<Vec<_>>()
            .join(", ")));
    }
    md.push_str("---\n");
    let clean_body = strip_body_frontmatter(body);
    if !clean_body.is_empty() {
        md.push('\n');
        md.push_str(clean_body);
        if !clean_body.ends_with('\n') { md.push('\n'); }
    }
    md
}

/// Scan outline/<storyId>/ for chapter files, return ordered list.
fn scan_chapters(dir: &PathBuf) -> Result<Vec<ChapterInfo>, String> {
    let mut chapters: Vec<ChapterInfo> = Vec::new();
    if !dir.exists() {
        return Ok(chapters);
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("读取大纲目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let (fields, body) = parse_chapter_file(&content);
                let id = fields.get("id").cloned().unwrap_or_default();
                let order: i32 = fields.get("order").and_then(|v| v.parse().ok()).unwrap_or(0);
                let title = fields.get("title").cloned().unwrap_or_default();
                let status = fields.get("status").cloned().unwrap_or_else(|| "outline".into());
                let summary = fields.get("summary").cloned().unwrap_or_default();
                let has_body = !body.trim().is_empty();
                let word_count = body.chars().count();
                let time_period = fields.get("time_period").and_then(|v| {
                    let parts: Vec<i64> = v.trim_matches('"').trim_matches('[').trim_matches(']')
                        .split(',').filter_map(|s| s.trim().parse().ok()).collect();
                    if parts.len() == 2 { Some(parts) } else { None }
                }).map(|v| vec![v[0], v[1]]);
                let involved_entries = fields.get("involved_entries").map(|v| {
                    v.trim_matches('"').trim_matches('[').trim_matches(']')
                        .split(',')
                        .map(|s| s.trim().trim_matches('"').to_string())
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                }).unwrap_or_default();
                let linked_events = fields.get("linked_events").map(|v| {
                    v.trim_matches('"').trim_matches('[').trim_matches(']')
                        .split(',')
                        .map(|s| s.trim().trim_matches('"').to_string())
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                }).unwrap_or_default();
                chapters.push(ChapterInfo { id, order, title, status, summary, has_body, word_count, time_period, involved_entries, linked_events });
            }
        }
    }
    chapters.sort_by_key(|c| c.order);
    Ok(chapters)
}

/// Find chapter file by immutable frontmatter id.
fn find_chapter_file_by_id(dir: &PathBuf, chapter_id: &str) -> Option<PathBuf> {
    if !dir.exists() { return None; }
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let path = e.path();
        if !path.extension().map_or(false, |ext| ext == "md") {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        let (fields, _) = parse_chapter_file(&content);
        if fields.get("id").map(|id| id == chapter_id).unwrap_or(false) {
            Some(path)
        } else {
            None
        }
    })
}

/// Auto-migrate: if old single-file outline exists, split it into chapter files.
fn migrate_old_outline(root: &PathBuf, story_id: &str) -> Result<(), String> {
    let old = old_outline_file(root, story_id);
    if !old.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&old).map_err(|e| format!("读取旧大纲失败: {}", e))?;
    let dir = outline_dir(root, story_id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建大纲目录失败: {}", e))?;

    // Parse ## headings as chapters
    let mut order = 0;
    let mut current_title = String::new();
    let mut current_body = String::new();

    for line in content.lines() {
        if line.starts_with("## ") {
            // Flush previous chapter
            if !current_title.is_empty() {
                order += 1;
                let md = build_chapter_md(&Uuid::new_v4().to_string(), &current_title, order, "outline", "", &current_body, &[]);
                let filename = sanitize_filename(&current_title);
                let _ = fs::write(dir.join(format!("{:02}-{}.md", order, filename)), &md);
            }
            current_title = line[3..].trim().to_string();
            current_body = String::new();
        } else {
            if !current_body.is_empty() { current_body.push('\n'); }
            current_body.push_str(line);
        }
    }
    // Flush last chapter
    if !current_title.is_empty() {
        order += 1;
        let md = build_chapter_md(&Uuid::new_v4().to_string(), &current_title, order, "outline", "", &current_body, &[]);
        let filename = sanitize_filename(&current_title);
        let _ = fs::write(dir.join(format!("{:02}-{}.md", order, filename)), &md);
    }
    // Delete old file after successful migration
    let _ = fs::remove_file(&old);
    Ok(())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// ── Commands ────────────────────────────────────────

#[tauri::command]
pub fn read_outline(world_path: String, story_id: String) -> Result<Vec<ChapterInfo>, String> {
    let root = expand(&world_path);
    // Auto-migrate old single-file outline
    migrate_old_outline(&root, &story_id)?;
    let dir = outline_dir(&root, &story_id);
    scan_chapters(&dir)
}

#[tauri::command]
pub fn read_chapter(world_path: String, story_id: String, chapter_id: String) -> Result<String, String> {
    let root = expand(&world_path);
    let dir = outline_dir(&root, &story_id);
    let file = find_chapter_file_by_id(&dir, &chapter_id)
        .ok_or_else(|| format!("章节 {} 不存在", chapter_id))?;
    fs::read_to_string(&file).map_err(|e| format!("读取失败: {}", e))
}

/// Parse linked_events from JSON array.
/// Format: [{"timeline_id":"...","event_id":"..."},...]
fn parse_linked_events(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !trimmed.starts_with('[') {
        return Vec::new();
    }
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
        return arr
            .iter()
            .filter_map(|v| {
                let tl = v.get("timeline_id")?.as_str()?;
                let ev = v.get("event_id")?.as_str()?;
                Some(format!("{}:{}", tl, ev))
            })
            .collect();
    }
    Vec::new()
}

#[tauri::command]
pub fn write_outline(
    world_path: String,
    story_id: String,
    chapter_id: Option<String>,
    order: Option<i32>,
    title: Option<String>,
    status: Option<String>,
    summary: Option<String>,
    body: Option<String>,
    linked_events: Option<String>,  // JSON array: [{"timeline_id":"...","event_id":"..."},...] or legacy "tl:evt,tl:evt"
) -> Result<ChapterInfo, String> {
    let root = expand(&world_path);
    // Auto-migrate
    migrate_old_outline(&root, &story_id)?;
    let dir = outline_dir(&root, &story_id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建大纲目录失败: {}", e))?;

    let linked_events_provided = linked_events.is_some();
    let linked_evts: Vec<String> = parse_linked_events(linked_events.as_deref().unwrap_or_default());

    if let Some(chapter_id) = chapter_id {
        let existing = find_chapter_file_by_id(&dir, &chapter_id)
            .ok_or_else(|| format!("章节 {} 不存在", chapter_id))?;
        // Update existing chapter — merge fields
        let content = fs::read_to_string(&existing).map_err(|e| format!("读取章节失败: {}", e))?;
        let (mut fields, old_body) = parse_chapter_file(&content);
        let old_title = fields.get("title").cloned().unwrap_or_default();
        let next_title = title.unwrap_or_else(|| old_title.clone());
        let next_order = order.unwrap_or_else(|| fields.get("order").and_then(|v| v.parse().ok()).unwrap_or(0));
        fields.insert("id".into(), chapter_id.clone());
        fields.insert("title".into(), next_title.clone());
        fields.insert("order".into(), next_order.to_string());
        if let Some(s) = status { fields.insert("status".into(), s); }
        if let Some(s) = summary { fields.insert("summary".into(), s); }
        let next_linked_evts = if linked_events_provided {
            fields.insert("linked_events".into(), linked_evts.iter()
                .map(|e| format!("\"{}\"", e))
                .collect::<Vec<_>>()
                .join(", "));
            linked_evts.clone()
        } else {
            fields.get("linked_events").map(|v| {
                v.trim_matches('"').trim_matches('[').trim_matches(']')
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            }).unwrap_or_default()
        };
        let new_body = body.unwrap_or(old_body);
        let new_md = build_chapter_md(
            &chapter_id,
            &next_title,
            next_order,
            &fields.get("status").cloned().unwrap_or_else(|| "outline".into()),
            &fields.get("summary").cloned().unwrap_or_default(),
            &new_body,
            &next_linked_evts,
        );
        // Rename file if title changed
        let new_filename = format!("{:02}-{}.md", next_order, sanitize_filename(&next_title));
        let new_path = existing.parent().unwrap_or(&dir).join(&new_filename);
        if new_path != existing {
        fs::write(&new_path, &new_md).map_err(|e| format!("写入失败: {}", e))?;
            if existing != new_path { let _ = fs::remove_file(&existing); }
        } else {
            fs::write(&existing, &new_md).map_err(|e| format!("写入失败: {}", e))?;
        }

        // 🆕 Phase 5: Sync linked events — backfill event.linked_chapters
        sync_outline_event_links(&world_path, &story_id, next_order, &chapter_id, &next_linked_evts)?;
        Ok(ChapterInfo {
            id: chapter_id,
            order: next_order,
            title: next_title,
            status: fields.get("status").cloned().unwrap_or_else(|| "outline".into()),
            summary: fields.get("summary").cloned().unwrap_or_default(),
            has_body: !new_body.trim().is_empty(),
            word_count: new_body.chars().count(),
            time_period: None,
            involved_entries: Vec::new(),
            linked_events: next_linked_evts,
        })
    } else {
        // Create new chapter file
        let title = title.ok_or_else(|| "创建章节需要 title".to_string())?;
        let chapter_order = order.ok_or_else(|| "创建章节需要 order".to_string())?;
        let filename = sanitize_filename(&title);
        let st = status.unwrap_or_else(|| "outline".into());
        let sm = summary.unwrap_or_default();
        let bd = body.unwrap_or_default();
        let chapter_id = Uuid::new_v4().to_string();
        let md = build_chapter_md(&chapter_id, &title, chapter_order, &st, &sm, &bd, &linked_evts);
        let path = dir.join(format!("{:02}-{}.md", chapter_order, filename));
        fs::write(&path, &md).map_err(|e| format!("写入失败: {}", e))?;

        // 🆕 Phase 5: Sync linked events
        sync_outline_event_links(&world_path, &story_id, chapter_order, &chapter_id, &linked_evts)?;
        Ok(ChapterInfo {
            id: chapter_id,
            order: chapter_order,
            title,
            status: st,
            summary: sm,
            has_body: !bd.trim().is_empty(),
            word_count: bd.chars().count(),
            time_period: None,
            involved_entries: Vec::new(),
            linked_events: linked_evts,
        })
    }
}

/// Phase 5: Back-sync chapter's linked_events → event's linked_chapters.
/// Replaces the old add_chapter_entry_relations which created Entry↔Outline direct edges.
fn sync_outline_event_links(
    world_path: &str,
    story_id: &str,
    chapter_order: i32,
    chapter_id: &str,
    linked_events: &[String],
) -> Result<(), String> {
    use crate::models::graph::{EntityRef, EntityType, RelationEdge};
    use crate::models::timeline::{EventList, LinkedChapter};
    use crate::services::graph_storage;

    let root = expand(world_path);
    let timelines_dir = root.join("timelines");

    for evt_ref in linked_events {
        let parts: Vec<&str> = evt_ref.split(':').collect();
        if parts.len() < 2 { continue; }
        let timeline_id = parts[0];
        let event_id = parts[1];

        // Load the event
        let events_file = timelines_dir.join(timeline_id).join("events.json");
        if !events_file.exists() { continue; }

        let raw = match std::fs::read_to_string(&events_file) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let mut event_list: EventList = match serde_json::from_str(&raw) {
            Ok(el) => el,
            Err(_) => continue,
        };

        if let Some(event) = event_list.events.iter_mut().find(|e| e.id == event_id) {
            // Add linked_chapter if not already present
            let ch = LinkedChapter {
                story_id: story_id.to_string(),
                chapter_order,
            };
            if !event.linked_chapters.iter().any(|c| c.story_id == ch.story_id && c.chapter_order == ch.chapter_order) {
                event.linked_chapters.push(ch);
            }

            // Update belongs_to_stories
            if !event.belongs_to_stories.contains(&story_id.to_string()) {
                event.belongs_to_stories.push(story_id.to_string());
                event.belongs_to_stories.sort();
                event.belongs_to_stories.dedup();
            }

            event.updated_at = chrono::Utc::now();
        }

        // Save back
        let json = serde_json::to_string_pretty(&event_list)
            .map_err(|e| format!("序列化事件失败: {}", e))?;
        std::fs::write(&events_file, &json)
            .map_err(|e| format!("写入事件失败: {}", e))?;

        // Create Outline↔Event graph edge
        let from = EntityRef { name: None, 
            entity_type: EntityType::Outline,
            id: chapter_id.to_string(),
        };
        let to = EntityRef { name: None, 
            entity_type: EntityType::Event,
            id: event_id.to_string(),
        };
        let edge = RelationEdge {
            id: Uuid::new_v4().to_string(),
            from,
            to,
            description: "章节描绘".into(),
            timeline_id: None,
            start_event_id: None,
            end_event_id: None,
        };
        graph_storage::with_graph(world_path, |g| {
            if !g.edges.iter().any(|e|
                e.from == edge.from && e.to == edge.to && e.description == edge.description
            ) {
                g.add_edge(edge);
            }
            Ok(())
        })?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_chapter(world_path: String, story_id: String, chapter_id: String) -> Result<(), String> {
    let root = expand(&world_path);
    let dir = outline_dir(&root, &story_id);
    let file = find_chapter_file_by_id(&dir, &chapter_id)
        .ok_or_else(|| format!("章节 {} 不存在", chapter_id))?;
    fs::remove_file(&file).map_err(|e| format!("删除失败: {}", e))
}

use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use serde::{Deserialize, Serialize};

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

fn outline_dir(root: &PathBuf, story_id: &str) -> PathBuf {
    root.join("outline").join(story_id)
}

fn old_outline_file(root: &PathBuf, story_id: &str) -> PathBuf {
    root.join("outline").join(format!("{}.md", story_id))
}

// ── Chapter frontmatter (serde_yaml) ─────────────────

/// Serialized as YAML frontmatter between `---` markers in chapter .md files.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ChapterFrontmatter {
    #[serde(default)]
    id: String,
    #[serde(default)]
    order: i32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    summary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    linked_events: Vec<String>,
}

/// ChapterInfo returned to frontend — flattened from frontmatter + body.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ChapterInfo {
    #[serde(default)]
    id: String,
    order: i32,
    title: String,
    status: String,
    summary: String,
    has_body: bool,
    word_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time_period: Option<Vec<i64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    involved_entries: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    linked_events: Vec<String>,
}

// ── Parse / Build ────────────────────────────────────

/// Parse frontmatter from chapter .md content via serde_yaml.
fn parse_chapter_file(content: &str) -> (ChapterFrontmatter, String) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (ChapterFrontmatter::default(), trimmed.to_string());
    }
    let rest = &trimmed[3..];
    match rest.find("---") {
        Some(end) => {
            let fm_text = &rest[..end].trim();
            let body = rest[end + 3..].trim().to_string();
            let fm = serde_yaml::from_str::<ChapterFrontmatter>(fm_text)
                .unwrap_or_default();
            (fm, body)
        }
        None => (ChapterFrontmatter::default(), rest.to_string()),
    }
}

fn build_chapter_md(fm: &ChapterFrontmatter, body: &str) -> String {
    let mut md = String::from("---\n");
    md.push_str(&format!("id: \"{}\"\n", fm.id));
    md.push_str(&format!("order: {}\n", fm.order));
    md.push_str(&format!("title: \"{}\"\n", fm.title));
    md.push_str(&format!("status: \"{}\"\n", fm.status));
    md.push_str(&format!("summary: \"{}\"\n", fm.summary));
    if !fm.linked_events.is_empty() {
        md.push_str(&format!("linked_events: [{}]\n", fm.linked_events.iter()
            .map(|e| format!("\"{}\"", e))
            .collect::<Vec<_>>()
            .join(", ")));
    }
    md.push_str("---\n");
    let clean_body = strip_body_frontmatter(body);
    if !clean_body.is_empty() {
        md.push('\n');
        md.push_str(clean_body);
        if !clean_body.ends_with('\n') {
            md.push('\n');
        }
    }
    md
}

fn strip_body_frontmatter(body: &str) -> &str {
    let trimmed = body.trim_start();
    if trimmed.starts_with("---") {
        if let Some(end) = trimmed[3..].find("---") {
            return trimmed[3 + end + 3..].trim();
        }
    }
    body
}

// ── Scan / Find ───────────────────────────────────────

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
                let (fm, body) = parse_chapter_file(&content);
                let has_body = !body.trim().is_empty();
                let word_count = body.chars().count();
                chapters.push(ChapterInfo {
                    id: fm.id.clone(),
                    order: fm.order,
                    title: fm.title.clone(),
                    status: if fm.status.is_empty() { "outline".into() } else { fm.status.clone() },
                    summary: fm.summary.clone(),
                    has_body,
                    word_count,
                    time_period: None,
                    involved_entries: Vec::new(),
                    linked_events: fm.linked_events.clone(),
                });
            }
        }
    }
    chapters.sort_by_key(|c| c.order);
    Ok(chapters)
}

fn find_chapter_file_by_id(dir: &PathBuf, chapter_id: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let path = e.path();
        if !path.extension().map_or(false, |ext| ext == "md") {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        let (fm, _) = parse_chapter_file(&content);
        if fm.id == chapter_id { Some(path) } else { None }
    })
}

// ── Migration ─────────────────────────────────────────

fn migrate_old_outline(root: &PathBuf, story_id: &str) -> Result<(), String> {
    let old = old_outline_file(root, story_id);
    if !old.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&old).map_err(|e| format!("读取旧大纲失败: {}", e))?;
    let dir = outline_dir(root, story_id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建大纲目录失败: {}", e))?;

    let mut order = 0;
    let mut current_title = String::new();
    let mut current_body = String::new();

    for line in content.lines() {
        if line.starts_with("## ") {
            if !current_title.is_empty() {
                order += 1;
                let fm = ChapterFrontmatter {
                    id: Uuid::new_v4().to_string(),
                    order,
                    title: current_title.clone(),
                    status: "outline".into(),
                    summary: String::new(),
                    linked_events: Vec::new(),
                };
                let md = build_chapter_md(&fm, &current_body);
                let filename = sanitize_filename(&current_title);
                let _ = fs::write(dir.join(format!("{:02}-{}.md", order, filename)), &md);
            }
            current_title = line[3..].trim().to_string();
            current_body = String::new();
        } else {
            if !current_body.is_empty() {
                current_body.push('\n');
            }
            current_body.push_str(line);
        }
    }
    if !current_title.is_empty() {
        order += 1;
        let fm = ChapterFrontmatter {
            id: Uuid::new_v4().to_string(),
            order,
            title: current_title,
            status: "outline".into(),
            summary: String::new(),
            linked_events: Vec::new(),
        };
        let md = build_chapter_md(&fm, &current_body);
        let filename = sanitize_filename(&fm.title);
        let _ = fs::write(dir.join(format!("{:02}-{}.md", order, filename)), &md);
    }
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

// ── Commands ──────────────────────────────────────────

#[tauri::command]
pub fn read_outline(world_path: String, story_id: String) -> Result<Vec<ChapterInfo>, String> {
    let root = expand(&world_path);
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
    linked_events: Option<String>,
) -> Result<ChapterInfo, String> {
    let root = expand(&world_path);
    migrate_old_outline(&root, &story_id)?;
    let dir = outline_dir(&root, &story_id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建大纲目录失败: {}", e))?;

    let linked_events_provided = linked_events.is_some();
    let parsed_linked: Vec<String> = parse_linked_events(linked_events.as_deref().unwrap_or_default());

    if let Some(ref cid) = chapter_id {
        // Update existing chapter
        let existing = find_chapter_file_by_id(&dir, cid)
            .ok_or_else(|| format!("章节 {} 不存在", cid))?;
        let content = fs::read_to_string(&existing).map_err(|e| format!("读取章节失败: {}", e))?;
        let (mut fm, old_body) = parse_chapter_file(&content);
        let next_body = body.unwrap_or(old_body);

        // Merge fields
        if let Some(t) = title { fm.title = t; }
        if let Some(o) = order { fm.order = o; }
        if let Some(s) = status { fm.status = s; }
        if let Some(s) = summary { fm.summary = s; }
        if linked_events_provided { fm.linked_events = parsed_linked.clone(); }
        fm.id = cid.clone();

        let new_md = build_chapter_md(&fm, &next_body);
        let new_filename = format!("{:02}-{}.md", fm.order, sanitize_filename(&fm.title));
        let new_path = existing.parent().unwrap_or(&dir).join(&new_filename);
        if new_path != existing {
            fs::write(&new_path, &new_md).map_err(|e| format!("写入失败: {}", e))?;
            let _ = fs::remove_file(&existing);
        } else {
            fs::write(&existing, &new_md).map_err(|e| format!("写入失败: {}", e))?;
        }

        let linked_evts = fm.linked_events.clone();
        sync_outline_event_links(&world_path, &story_id, fm.order, cid, &linked_evts)?;
        Ok(ChapterInfo {
            id: cid.clone(),
            order: fm.order,
            title: fm.title.clone(),
            status: fm.status.clone(),
            summary: fm.summary.clone(),
            has_body: !next_body.trim().is_empty(),
            word_count: next_body.chars().count(),
            time_period: None,
            involved_entries: Vec::new(),
            linked_events: linked_evts,
        })
    } else {
        // Create new chapter
        let title = title.ok_or_else(|| "创建章节需要 title".to_string())?;
        let chapter_order = order.ok_or_else(|| "创建章节需要 order".to_string())?;
        let st = status.unwrap_or_else(|| "outline".into());
        let sm = summary.unwrap_or_default();
        let bd = body.unwrap_or_default();
        let cid = Uuid::new_v4().to_string();

        let fm = ChapterFrontmatter {
            id: cid.clone(),
            order: chapter_order,
            title: title.clone(),
            status: st.clone(),
            summary: sm.clone(),
            linked_events: parsed_linked.clone(),
        };
        let md = build_chapter_md(&fm, &bd);
        let filename = format!("{:02}-{}.md", chapter_order, sanitize_filename(&title));
        let path = dir.join(&filename);
        fs::write(&path, &md).map_err(|e| format!("写入失败: {}", e))?;

        sync_outline_event_links(&world_path, &story_id, chapter_order, &cid, &parsed_linked)?;
        Ok(ChapterInfo {
            id: cid,
            order: chapter_order,
            title,
            status: st,
            summary: sm,
            has_body: !bd.trim().is_empty(),
            word_count: bd.chars().count(),
            time_period: None,
            involved_entries: Vec::new(),
            linked_events: parsed_linked,
        })
    }
}

// ── Event sync ─────────────────────────────────────────

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
            let ch = LinkedChapter {
                story_id: story_id.to_string(),
                chapter_order,
            };
            if !event.linked_chapters.iter().any(|c| c.story_id == ch.story_id && c.chapter_order == ch.chapter_order) {
                event.linked_chapters.push(ch);
            }

            if !event.belongs_to_stories.contains(&story_id.to_string()) {
                event.belongs_to_stories.push(story_id.to_string());
                event.belongs_to_stories.sort();
                event.belongs_to_stories.dedup();
            }

            event.updated_at = chrono::Utc::now();
        }

        let json = serde_json::to_string_pretty(&event_list)
            .map_err(|e| format!("序列化事件失败: {}", e))?;
        std::fs::write(&events_file, &json)
            .map_err(|e| format!("写入事件失败: {}", e))?;

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
            reverse_description: None,
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

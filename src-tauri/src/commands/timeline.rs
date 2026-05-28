/// Timeline & Event CRUD commands — IPC endpoints for the Phase 5 timeline module.
///
/// Timelines are stored in <world>/timelines/index.json
/// Events are stored in <world>/timelines/<timeline_id>/events.json

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::models::timeline::{
    Event, EventList, LinkedChapter, LinkedEntry, RelationChange, RelationChangeType,
    Timeline, TimelineIndex, TimeFormat, TimeUnit,
};
use crate::services::event_cascade;

// ── Path helpers ──────────────────────────────────

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

fn timelines_dir(world_path: &str) -> PathBuf {
    expand(world_path).join("timelines")
}

fn index_path(world_path: &str) -> PathBuf {
    timelines_dir(world_path).join("index.json")
}

fn events_path(world_path: &str, timeline_id: &str) -> PathBuf {
    timelines_dir(world_path).join(timeline_id).join("events.json")
}

fn load_index(world_path: &str) -> Result<TimelineIndex, String> {
    let p = index_path(world_path);
    if !p.exists() {
        return Ok(TimelineIndex::default());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("读取时间轴索引失败: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析时间轴索引失败: {}", e))
}

fn save_index(world_path: &str, index: &TimelineIndex) -> Result<(), String> {
    let p = index_path(world_path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 timelines 目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&p, &json).map_err(|e| format!("写入失败: {}", e))
}

fn load_events(world_path: &str, timeline_id: &str) -> Result<EventList, String> {
    // Validate the timeline exists
    let index = load_index(world_path)?;
    if !index.timelines.iter().any(|t| t.id == timeline_id) {
        return Err(format!("时间轴 {} 不存在，请先 ListTimelines 获取有效 ID", timeline_id));
    }
    let p = events_path(world_path, timeline_id);
    if !p.exists() {
        return Ok(EventList::default());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("读取事件列表失败: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析事件列表失败: {}", e))
}

fn save_events(world_path: &str, timeline_id: &str, events: &EventList) -> Result<(), String> {
    let p = events_path(world_path, timeline_id);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建事件目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(events).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&p, &json).map_err(|e| format!("写入失败: {}", e))
}

// ── Default time format ───────────────────────────

/// Default time format for worlds that don't customize their timeline.
/// 8 segments: reserved(3) + era(1) + year(6) + month(2) + day(2) + hour(2) + minute(2) + second(2)
fn default_time_format() -> TimeFormat {
    TimeFormat {
        units: vec![
            TimeUnit { key: "era".into(), name: "纪元".into(), max: Some(9), display_order: 0, digits: 1 },
            TimeUnit { key: "year".into(), name: "年".into(), max: None, display_order: 1, digits: 6 },
            TimeUnit { key: "month".into(), name: "月".into(), max: Some(12), display_order: 2, digits: 2 },
            TimeUnit { key: "day".into(), name: "日".into(), max: Some(30), display_order: 3, digits: 2 },
            TimeUnit { key: "hour".into(), name: "时".into(), max: Some(24), display_order: 4, digits: 2 },
            TimeUnit { key: "minute".into(), name: "分".into(), max: Some(60), display_order: 5, digits: 2 },
            TimeUnit { key: "second".into(), name: "秒".into(), max: Some(60), display_order: 6, digits: 2 },
        ],
    }
}

// ── Validation ──────────────────────────────────────

const MAX_SUMMARY_CHARS: usize = 1000;
const MAX_PERSPECTIVE_CHARS: usize = 400;

fn validate_summary(summary: &str) -> Result<(), String> {
    let n = summary.chars().count();
    if n > MAX_SUMMARY_CHARS {
        return Err(format!("事件描述不能超过 {} 字，当前 {} 字。请精简到 2-3 句话。", MAX_SUMMARY_CHARS, n));
    }
    Ok(())
}

fn validate_perspective(p: &str) -> Result<(), String> {
    let n = p.chars().count();
    if n > MAX_PERSPECTIVE_CHARS {
        return Err(format!("词条视角简述不能超过 {} 字，当前 {} 字", MAX_PERSPECTIVE_CHARS, n));
    }
    Ok(())
}

// ── Commands ──────────────────────────────────────

/// Create a new timeline. The first timeline in a world is auto-marked as default.
/// `time_format_json` is optional; if omitted, the standard medieval fantasy format is used.
#[tauri::command]
pub fn create_timeline(
    world_path: String,
    name: String,
    description: Option<String>,
    time_format_json: Option<String>,
) -> Result<Timeline, String> {
    let time_format = if let Some(json) = time_format_json {
        serde_json::from_str::<TimeFormat>(&json)
            .map_err(|e| format!("解析时间格式失败: {}", e))?
    } else {
        default_time_format()
    };

    let mut index = load_index(&world_path)?;
    let is_default = index.timelines.is_empty();

    let timeline = Timeline {
        id: Uuid::new_v4().to_string(),
        name,
        description,
        is_default,
        world_id: "default".into(),
        time_format,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    // Create empty events file
    let el = EventList::default();
    save_events(&world_path, &timeline.id, &el)?;

    index.timelines.push(timeline.clone());
    save_index(&world_path, &index)?;

    Ok(timeline)
}

#[tauri::command]
pub fn update_timeline(
    world_path: String,
    timeline_id: String,
    name: Option<String>,
    description: Option<String>,
    is_default: Option<bool>,
    time_format_json: Option<String>,
) -> Result<Timeline, String> {
    let mut index = load_index(&world_path)?;
    let pos = index.timelines.iter()
        .position(|t| t.id == timeline_id)
        .ok_or_else(|| format!("时间轴 {} 不存在", timeline_id))?;

    if let Some(d) = is_default {
        // Clear defaults on all timelines
        if d {
            for other in index.timelines.iter_mut() {
                other.is_default = false;
            }
        }
    }

    let t = &mut index.timelines[pos];
    if let Some(n) = name { t.name = n; }
    if let Some(d) = description { t.description = Some(d); }
    if let Some(d) = is_default { t.is_default = d; }
    if let Some(ref json) = time_format_json {
        let new_tf: TimeFormat = serde_json::from_str(json)
            .map_err(|e| format!("解析时间格式失败: {}", e))?;
        if new_tf.units.len() != t.time_format.units.len() {
            return Err(format!(
                "不能增删时间单位（当前 {} 个，传入 {} 个）。只能修改名称和最大值。",
                t.time_format.units.len(), new_tf.units.len()
            ));
        }
        t.time_format = new_tf;
    }
    t.updated_at = Utc::now();

    let result = t.clone();
    save_index(&world_path, &index)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_timeline(
    world_path: String,
    timeline_id: String,
) -> Result<(), String> {
    let mut index = load_index(&world_path)?;
    if index.timelines.len() <= 1 {
        return Err("至少保留一条时间轴".into());
    }
    index.timelines.retain(|t| t.id != timeline_id);
    // If deleted the default, make first remaining default
    if !index.timelines.iter().any(|t| t.is_default) {
        if let Some(first) = index.timelines.first_mut() {
            first.is_default = true;
        }
    }
    save_index(&world_path, &index)?;

    // Remove events directory
    let dir = timelines_dir(&world_path).join(&timeline_id);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[tauri::command]
pub fn list_timelines(
    world_path: String,
) -> Result<Vec<Timeline>, String> {
    let index = load_index(&world_path)?;
    Ok(index.timelines)
}

// ── Event commands ────────────────────────────────

/// Parse comma-separated linked entries string from Agent tool input.
fn parse_linked_entries(input: Option<&str>) -> Vec<LinkedEntry> {
    let raw = input.unwrap_or("").trim();
    if raw.is_empty() { return Vec::new(); }
    // JSON array: [{"entry_id":"...","perspective_summary":"..."}]
    if raw.starts_with('[') {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(raw) {
            return arr.iter().filter_map(|v| {
                let id = v.get("entry_id")?.as_str()?;
                let summary = v.get("perspective_summary").and_then(|s| s.as_str()).map(|s| s.to_string());
                Some(LinkedEntry { entry_id: id.to_string(), perspective_summary: summary })
            }).collect();
        }
    }
    Vec::new()
}

/// Parse linked chapters from JSON array or legacy comma-separated format.
/// JSON: [{"story_id":"...","chapter_order":1},...]
fn parse_linked_chapters(input: Option<&str>) -> Vec<LinkedChapter> {
    let raw = input.unwrap_or("").trim();
    if raw.is_empty() { return Vec::new(); }
    if raw.starts_with('[') {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(raw) {
            return arr.iter().filter_map(|v| {
                let sid = v.get("story_id")?.as_str()?;
                let order = v.get("chapter_order")?.as_i64().unwrap_or(0) as i32;
                Some(LinkedChapter { story_id: sid.to_string(), chapter_order: order })
            }).collect();
        }
    }
    Vec::new()
}

fn parse_relation_changes(input: Option<&str>) -> Vec<RelationChange> {
    input.unwrap_or("").split('\n')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| {
            // Format: "entry_a|entry_b|change_type|relation|description"
            let parts: Vec<&str> = s.split('|').collect();
            if parts.len() >= 4 {
                Some(RelationChange {
                    entry_a: parts[0].trim().to_string(),
                    entry_b: parts[1].trim().to_string(),
                    change_type: match parts[2].trim() {
                        "add" | "update" => RelationChangeType::Add, // "update" accepted for backward compat
                        "delete" => RelationChangeType::Delete,
                        _ => return None,
                    },
                    relation: parts[3].trim().to_string(),
                    description: parts.get(4).map(|s| s.trim().to_string()),
                })
            } else { None }
        })
        .collect()
}

#[tauri::command]
pub fn create_event(
    world_path: String,
    timeline_id: String,
    time_point: String,
    summary: String,
    name: Option<String>,                    // human-readable slug, auto-generated from summary if omitted
    precision: Option<usize>,
    linked_entries: Option<String>,
    linked_chapters: Option<String>,
    relationship_changes: Option<String>,
) -> Result<Event, String> {
    // Generate name from summary if not provided
    let event_display_name = name.unwrap_or_else(|| {
        // Simple slug: take first 30 chars of summary, replace problematic chars
        let s = summary.chars().take(30).collect::<String>();
        s.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    });
    // Verify timeline exists
    let index = load_index(&world_path)?;
    let timeline = index.timelines.iter()
        .find(|t| t.id == timeline_id)
        .ok_or_else(|| format!("时间轴 {} 不存在", timeline_id))?;

    // Validate time_point format
    let fmt = &timeline.time_format;
    let expected = fmt.segment_count();
    let actual = time_point.split('-').count();
    if actual != expected {
        return Err(format!("时间格式错误: 期望 {} 段, 实际 {} 段", expected, actual));
    }

    // Validate summary length
    validate_summary(&summary)?;
    if let Some(ref entries_str) = linked_entries {
        for entry in parse_linked_entries(Some(entries_str)) {
            if let Some(ref p) = entry.perspective_summary {
                validate_perspective(p)?;
            }
        }
    }

    let mut event_list = load_events(&world_path, &timeline_id)?;
    let parsed_entries = parse_linked_entries(linked_entries.as_deref());
    let parsed_chapters = parse_linked_chapters(linked_chapters.as_deref());
    let parsed_rel_changes = parse_relation_changes(relationship_changes.as_deref());

    // Derive belongs_to_stories from linked_chapters
    let mut story_ids: Vec<String> = parsed_chapters.iter()
        .map(|c| c.story_id.clone())
        .collect();
    story_ids.sort();
    story_ids.dedup();

    let event = Event {
        id: Uuid::new_v4().to_string(),
        name: event_display_name,
        timeline_id: timeline_id.clone(),
        time_point,
        precision: precision.map(|p| if p > 0 { Some(p) } else { None }).flatten(),
        summary,
        linked_entries: parsed_entries,
        linked_chapters: parsed_chapters,
        relationship_changes: parsed_rel_changes,
        belongs_to_stories: story_ids,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    event_list.events.push(event.clone());
    // Sort by time_point to maintain order
    event_list.events.sort_by(|a, b| a.time_point.cmp(&b.time_point));
    save_events(&world_path, &timeline_id, &event_list)?;

    // Cascade: update entries and outline chapters
    event_cascade::on_event_created(&world_path, &event)?;

    Ok(event)
}

#[tauri::command]
pub fn update_event(
    world_path: String,
    timeline_id: String,
    event_id: Option<String>,
    time_point: Option<String>,
    summary: Option<String>,
    name_update: Option<String>,   // rename the event
    precision: Option<usize>,
    linked_entries: Option<String>,
    linked_chapters: Option<String>,
    relationship_changes: Option<String>,
) -> Result<Event, String> {
    let mut event_list = load_events(&world_path, &timeline_id)?;
    let event_id = event_id.ok_or_else(|| "必须提供 event_id".to_string())?;
    let pos = {
        event_list.events.iter()
            .position(|e| e.id == event_id)
            .ok_or_else(|| format!("事件 {} 不存在", event_id))?
    };

    // Save old state for cascade diff
    let old_event = event_list.events[pos].clone();

    // Validate time_point
    if let Some(ref tp) = time_point {
        let index = load_index(&world_path)?;
        let timeline = index.timelines.iter()
            .find(|t| t.id == timeline_id)
            .ok_or("时间轴不存在")?;
        let expected = timeline.time_format.segment_count();
        if tp.split('-').count() != expected {
            return Err(format!("时间格式错误: 期望 {} 段", expected));
        }
    }

    // Validate summary and perspective lengths
    if let Some(ref s) = summary { validate_summary(s)?; }
    if let Some(ref entries_str) = linked_entries {
        for entry in parse_linked_entries(Some(entries_str)) {
            if let Some(ref p) = entry.perspective_summary {
                validate_perspective(p)?;
            }
        }
    }

    // Apply mutations via index
    {
        let event = &mut event_list.events[pos];
        if let Some(tp) = time_point { event.time_point = tp; }
        if let Some(ref n) = name_update { event.name = n.clone(); }
        if let Some(s) = summary { event.summary = s; }
        if precision.is_some() { event.precision = precision; }
        if linked_entries.is_some() {
            event.linked_entries = parse_linked_entries(linked_entries.as_deref());
        }
        if linked_chapters.is_some() {
            event.linked_chapters = parse_linked_chapters(linked_chapters.as_deref());
            let mut story_ids: Vec<String> = event.linked_chapters.iter()
                .map(|c| c.story_id.clone())
                .collect();
            story_ids.sort();
            story_ids.dedup();
            event.belongs_to_stories = story_ids;
        }
        if relationship_changes.is_some() {
            event.relationship_changes = parse_relation_changes(relationship_changes.as_deref());
        }
        event.updated_at = Utc::now();
    }

    // Re-sort after time_point change
    event_list.events.sort_by(|a, b| a.time_point.cmp(&b.time_point));
    save_events(&world_path, &timeline_id, &event_list)?;

    let updated_event = event_list.events.iter()
        .find(|e| e.id == event_id)
        .cloned()
        .ok_or_else(|| "更新后的事件不存在".to_string())?;

    // Cascade: remove old relations, apply new ones
    event_cascade::on_event_updated(&world_path, &old_event, &updated_event)?;

    Ok(updated_event)
}

#[tauri::command]
pub fn delete_event(
    world_path: String,
    timeline_id: String,
    event_id: Option<String>,
) -> Result<(), String> {
    let mut event_list = load_events(&world_path, &timeline_id)?;
    let event_id = event_id.ok_or_else(|| "必须提供 event_id".to_string())?;
    let event = {
        event_list.events.iter()
            .find(|e| e.id == event_id)
            .cloned()
    }
        .ok_or_else(|| format!("事件不存在 (id: {})", event_id))?;

    let event_id_to_remove = &event.id;
    event_list.events.retain(|e| e.id != *event_id_to_remove);
    save_events(&world_path, &timeline_id, &event_list)?;

    event_cascade::on_event_deleted(&world_path, &event)?;

    Ok(())
}

#[tauri::command]
pub fn list_events(
    world_path: String,
    timeline_id: String,
    story_id: Option<String>,    // filter by belongs_to_stories
    entry_id: Option<String>,    // filter by linked_entries
    chapter_ref: Option<String>, // filter by linked_chapters: "story_id:order"
) -> Result<Vec<Event>, String> {
    let event_list = load_events(&world_path, &timeline_id)?;

    let filtered: Vec<Event> = event_list.events.into_iter()
        .filter(|e| {
            if let Some(ref sid) = story_id {
                if !e.belongs_to_stories.contains(sid) { return false; }
            }
            if let Some(ref eid) = entry_id {
                if !e.linked_entries.iter().any(|le| le.entry_id == *eid) { return false; }
            }
            if let Some(ref ch) = chapter_ref {
                let parts: Vec<&str> = ch.split(':').collect();
                if parts.len() >= 2 {
                    let sid = parts[0].trim();
                    let order: i32 = parts[1].trim().parse().unwrap_or(-1);
                    if !e.linked_chapters.iter().any(|c| c.story_id == sid && c.chapter_order == order) {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    Ok(filtered)
}

#[tauri::command]
pub fn move_event(
    world_path: String,
    timeline_id: String,
    event_id: Option<String>,
    new_time_point: String,
) -> Result<Event, String> {
    let mut event_list = load_events(&world_path, &timeline_id)?;
    let event_id = event_id.ok_or_else(|| "必须提供 event_id".to_string())?;
    let event = {
        event_list.events.iter_mut()
            .find(|e| e.id == event_id)
            .ok_or_else(|| format!("事件 {} 不存在", event_id))?
    };

    event.time_point = new_time_point;
    event.updated_at = Utc::now();

    let updated = event.clone();
    event_list.events.sort_by(|a, b| a.time_point.cmp(&b.time_point));
    save_events(&world_path, &timeline_id, &event_list)?;

    // Trigger cascade to update timeline_summary caches
    event_cascade::on_event_moved(&world_path, &updated)?;

    Ok(updated)
}

/// Event cascade engine — syncs state across Entry / Outline / Relations
/// whenever an Event is created, updated, deleted, or moved.
///
/// Cascading operations:
///   1. Update relations/index.json (Entry↔Event, Outline↔Event, Entry↔Entry edges)
///   2. Recalc timeline_summary[] cache on affected Entry frontmatter
///   3. Sync linked_events on affected Outline chapters

use std::collections::HashSet;
use std::fs;

use uuid::Uuid;
use crate::models::graph::{EntityRef, EntityType, RelationEdge};
use crate::models::timeline::{Event, RelationChangeType};
use crate::services::graph_storage;

// ── Helpers ────────────────────────────────────────

fn expand(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(path.replacen("~", &home, 1));
        }
    }
    std::path::PathBuf::from(path)
}

fn entries_root(world_path: &str) -> std::path::PathBuf {
    expand(world_path).join("entries")
}

fn outline_dir(world_path: &str, story_id: &str) -> std::path::PathBuf {
    expand(world_path).join("outline").join(story_id)
}

// ── Relation graph updates ─────────────────────────

/// Ensure Entry↔Event graph edges exist for all linked_entries.
fn sync_entry_event_edges(world_path: &str, event: &Event) -> Result<(), String> {
    let event_ref = EntityRef { name: None, 
        entity_type: EntityType::Event,
        id: event.id.clone(),
    };

    // Collect current edges for this event to detect stale ones
    let graph = graph_storage::load_graph(world_path)?;
    let existing_entry_ids: HashSet<String> = graph.edges.iter()
        .filter(|e| {
            (e.from == event_ref || e.to == event_ref)
            && (e.from.entity_type == EntityType::Entry || e.to.entity_type == EntityType::Entry)
        })
        .map(|e| {
            if e.from.entity_type == EntityType::Entry { e.from.id.clone() }
            else { e.to.id.clone() }
        })
        .collect();

    let desired_ids: HashSet<String> = event.linked_entries.iter()
        .map(|le| le.entry_id.clone())
        .collect();

    // Add missing edges
    for entry_id in desired_ids.difference(&existing_entry_ids) {
        let from = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: entry_id.clone(),
        };
        let edge = RelationEdge {
            id: Uuid::new_v4().to_string(),
            from,
            to: event_ref.clone(),
            description: "参与事件".into(),
            timeline_id: Some(event.timeline_id.clone()),
            active_period: None,
        };
        graph_storage::with_graph(world_path, |g| {
            g.add_edge(edge);
            Ok(())
        })?;
    }

    // Remove stale edges
    for entry_id in existing_entry_ids.difference(&desired_ids) {
        let from = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: entry_id.clone(),
        };
        graph_storage::with_graph(world_path, |g| {
            g.remove_edge(&from, &event_ref, "参与事件");
            Ok(())
        })?;
    }

    Ok(())
}

/// Look up a chapter's UUID by reading its frontmatter from the chapter file.
fn find_chapter_id(world_path: &str, story_id: &str, order: i32) -> Option<String> {
    let dir = outline_dir(world_path, story_id);
    if !dir.exists() { return None; }
    let prefix = format!("{:02}-", order);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".md") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    let trimmed = content.trim_start();
                    if trimmed.starts_with("---") {
                        let rest = &trimmed[3..];
                        if let Some(end) = rest.find("---") {
                            let fm_text = &rest[..end].trim();
                            for line in fm_text.lines() {
                                if let Some((key, value)) = line.split_once(':') {
                                    if key.trim() == "id" {
                                        let v = value.trim().trim_matches('"');
                                        if !v.is_empty() { return Some(v.to_string()); }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Ensure Outline↔Event graph edges exist for all linked_chapters.
fn sync_outline_event_edges(world_path: &str, event: &Event) -> Result<(), String> {
    let event_ref = EntityRef { name: None, 
        entity_type: EntityType::Event,
        id: event.id.clone(),
    };

    // Add missing: create edges for each linked_chapter that doesn't have one
    for ch in &event.linked_chapters {
        let chapter_id = match find_chapter_id(world_path, &ch.story_id, ch.chapter_order) {
            Some(id) => id,
            None => continue, // chapter doesn't exist yet, skip
        };

        let to = EntityRef { name: None, 
            entity_type: EntityType::Outline,
            id: chapter_id,
        };
        let edge = RelationEdge {
            id: Uuid::new_v4().to_string(),
            from: event_ref.clone(),
            to,
            description: "章节描绘".into(),
            timeline_id: Some(event.timeline_id.clone()),
            active_period: None,
        };
        graph_storage::with_graph(world_path, |g| {
            // Check by (from, to, description) to avoid duplicates
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

/// Apply relationship_changes as Entry↔Entry edges in relations/index.json.
fn apply_entry_entry_edges(world_path: &str, event: &Event) -> Result<(), String> {
    for rc in &event.relationship_changes {
        let from = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: rc.entry_a.clone(),
        };
        let to = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: rc.entry_b.clone(),
        };
        let desc = rc.description.as_deref().unwrap_or(&rc.relation);

        match rc.change_type {
            RelationChangeType::Add | RelationChangeType::Update => {
                // For add/update, ensure the edge exists. Remove old then add new.
                graph_storage::with_graph(world_path, |g| {
                    // Try to remove any existing edge between these two entries
                    g.edges.retain(|e| {
                        !(e.from == from && e.to == to && e.description == desc)
                    });
                    g.add_edge(RelationEdge {
                        id: Uuid::new_v4().to_string(),
                        from,
                        to,
                        description: rc.relation.clone(),
                        timeline_id: Some(event.timeline_id.clone()),
                        active_period: None,
                    });
                    Ok(())
                })?;
            }
            RelationChangeType::Delete => {
                graph_storage::with_graph(world_path, |g| {
                    g.remove_edge_scoped(&from, &to, desc, Some(&event.timeline_id));
                    Ok(())
                })?;
            }
        }
    }
    Ok(())
}

/// Remove all Entry↔Event and Outline↔Event edges for a deleted event.
fn remove_event_edges(world_path: &str, event: &Event) -> Result<(), String> {
    let event_ref = EntityRef { name: None, 
        entity_type: EntityType::Event,
        id: event.id.clone(),
    };
    graph_storage::with_graph(world_path, |g| {
        g.edges.retain(|e| {
            e.from != event_ref && e.to != event_ref
        });
        Ok(())
    })?;
    Ok(())
}

/// Remove Entry↔Entry edges created from this event's relationship_changes.
fn remove_relationship_change_edges(world_path: &str, event: &Event) -> Result<(), String> {
    for rc in &event.relationship_changes {
        let from = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: rc.entry_a.clone(),
        };
        let to = EntityRef { name: None, 
            entity_type: EntityType::Entry,
            id: rc.entry_b.clone(),
        };
        let desc = rc.description.as_deref().unwrap_or(&rc.relation);
        graph_storage::with_graph(world_path, |g| {
            g.remove_edge_scoped(&from, &to, desc, Some(&event.timeline_id));
            Ok(())
        })?;
    }
    Ok(())
}

// ── Entry timeline_summary recalculation ───────────

/// Recalculate the timeline_summary[] cache for a single entry.
/// Reads all events linked to the entry via relations/index.json,
/// sorts by time_point ascending, and writes the result to the entry's frontmatter.
fn recalc_entry_timeline_summary(world_path: &str, entry_id: &str) -> Result<(), String> {
    // Find the entry file across type directories
    let root = entries_root(world_path);
    let type_dirs = [
        "characters", "locations", "organizations",
        "systems", "artifacts", "eras", "concepts",
    ];

    let entry_path = type_dirs.iter().find_map(|d| {
        let p = root.join(d).join(format!("{}.md", entry_id));
        if p.exists() { Some(p) } else { None }
    });

    let fp = match entry_path {
        Some(p) => p,
        None => return Ok(()), // Entry doesn't exist (yet) — skip
    };

    let raw = fs::read_to_string(&fp)
        .map_err(|e| format!("读取词条 {} 失败: {}", entry_id, e))?;
    let (mut front, body) = parse_entry_frontmatter(&raw)?;

    // Collect all linked events via relations/index.json
    let entity = EntityRef { name: None, 
        entity_type: EntityType::Entry,
        id: entry_id.to_string(),
    };
    let graph = graph_storage::load_graph(world_path)?;
    let linked_edges: Vec<_> = graph.edges.iter()
        .filter(|e| {
            (e.from == entity || e.to == entity)
            && (e.from.entity_type == EntityType::Event || e.to.entity_type == EntityType::Event)
        })
        .cloned()
        .collect();

    // Parse event data for each linked event
    let mut periods: Vec<serde_json::Value> = Vec::new();
    for edge in &linked_edges {
        let event_id = if edge.from.entity_type == EntityType::Event {
            &edge.from.id
        } else {
            &edge.to.id
        };

        // Load event from disk. Try all timelines.
        let timelines_dir = expand(world_path).join("timelines");
        if let Ok(entries) = fs::read_dir(&timelines_dir) {
            for timeline_entry in entries.flatten() {
                let events_file = timeline_entry.path().join("events.json");
                if events_file.exists() {
                    if let Ok(raw) = fs::read_to_string(&events_file) {
                        if let Ok(event_list) = serde_json::from_str::<crate::models::timeline::EventList>(&raw) {
                            if let Some(event) = event_list.events.iter().find(|ev| ev.id == *event_id) {
                                let linked_entry = event.linked_entries.iter()
                                    .find(|le| le.entry_id == entry_id);

                                periods.push(serde_json::json!({
                                    "period": [event.time_point.clone(), null],
                                    "state": linked_entry.and_then(|le| le.perspective_summary.clone())
                                        .unwrap_or_else(|| event.summary.clone()),
                                    "summary": event.summary,
                                    "relationships": event.relationship_changes.iter()
                                        .filter(|rc| rc.entry_a == *entry_id || rc.entry_b == *entry_id)
                                        .map(|rc| {
                                            let target = if rc.entry_a == *entry_id { &rc.entry_b } else { &rc.entry_a };
                                            serde_json::json!({
                                                "target": target,
                                                "description": rc.description.as_deref().unwrap_or(&rc.relation),
                                            })
                                        })
                                        .collect::<Vec<_>>(),
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    front["timeline_summary"] = serde_json::Value::Array(periods);
    front["updated_at"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    if let Ok(yaml_str) = serde_yaml::to_string(&front) {
        let new_content = format!("---\n{}---\n\n{}", yaml_str, body);
        let _ = fs::write(&fp, &new_content);
    }

    Ok(())
}

// ── Outline chapter sync ───────────────────────────

/// Back-sync: ensure all linked_chapters have this event in their linked_events.
fn sync_chapter_linked_events(world_path: &str, event: &Event) -> Result<(), String> {
    for ch in &event.linked_chapters {
        let dir = outline_dir(world_path, &ch.story_id);
        if !dir.exists() { continue; }

        // Find chapter file by order prefix
        let prefix = format!("{:02}-", ch.chapter_order);
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.ends_with(".md") {
                    let path = entry.path();
                    if let Ok(content) = fs::read_to_string(&path) {
                        let (mut fields, body) = parse_chapter_frontmatter(&content)?;

                        // Parse existing linked_events
                        let existing: Vec<String> = fields.get("linked_events")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .split(',')
                            .map(|s| s.trim().trim_matches('"').to_string())
                            .filter(|s| !s.is_empty())
                            .collect();

                        let event_ref = format!("{}:{}", event.timeline_id, event.id);
                        if !existing.contains(&event_ref) {
                            let mut new_list = existing;
                            new_list.push(event_ref);
                            let val = new_list.iter()
                                .map(|s| format!("\"{}\"", s))
                                .collect::<Vec<_>>()
                                .join(", ");
                            fields.insert("linked_events".into(), serde_json::json!(val));
                        }

                        // Update involved_entries derived from linked events
                        // (simple version: collect all entries from this event + any existing)
                        let mut all_entries: Vec<String> = event.linked_entries.iter()
                            .map(|le| le.entry_id.clone())
                            .collect();
                        // Also keep existing involved_entries that aren't from events
                        if let Some(existing) = fields.get("involved_entries") {
                            if let Some(arr) = existing.as_array() {
                                for v in arr {
                                    if let Some(s) = v.as_str() {
                                        if !all_entries.contains(&s.to_string()) {
                                            all_entries.push(s.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        fields.insert("involved_entries".into(),
                            serde_json::json!(all_entries));

                        // Write back
                        if let Ok(yaml_str) = serde_yaml::to_string(&fields) {
                            let new_content = format!("---\n{}---\n\n{}", yaml_str, body);
                            let _ = fs::write(&path, &new_content);
                        }
                    }
                    break;
                }
            }
        }
    }
    Ok(())
}

/// Remove this event from all linked chapters' linked_events.
fn remove_chapter_linked_events(world_path: &str, event: &Event) -> Result<(), String> {
    for ch in &event.linked_chapters {
        let dir = outline_dir(world_path, &ch.story_id);
        if !dir.exists() { continue; }

        let prefix = format!("{:02}-", ch.chapter_order);
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.ends_with(".md") {
                    let path = entry.path();
                    if let Ok(content) = fs::read_to_string(&path) {
                        let (mut fields, body) = parse_chapter_frontmatter(&content)?;

                        let event_ref = format!("{}:{}", event.timeline_id, event.id);
                        let existing: Vec<String> = fields.get("linked_events")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .split(',')
                            .map(|s| s.trim().trim_matches('"').to_string())
                            .filter(|s| !s.is_empty() && s != &event_ref)
                            .collect();

                        let val = existing.iter()
                            .map(|s| format!("\"{}\"", s))
                            .collect::<Vec<_>>()
                            .join(", ");
                        fields.insert("linked_events".into(), serde_json::json!(val));

                        // Also remove entries from involved_entries that only came from this event
                        let event_entry_ids: HashSet<String> = event.linked_entries.iter()
                            .map(|le| le.entry_id.clone())
                            .collect();
                        if let Some(arr) = fields.get_mut("involved_entries").and_then(|v| v.as_array_mut()) {
                            arr.retain(|v| {
                                if let Some(s) = v.as_str() {
                                    !event_entry_ids.contains(s)
                                } else { true }
                            });
                        }

                        if let Ok(yaml_str) = serde_yaml::to_string(&fields) {
                            let new_content = format!("---\n{}---\n\n{}", yaml_str, body);
                            let _ = fs::write(&path, &new_content);
                        }
                    }
                    break;
                }
            }
        }
    }
    Ok(())
}

// ── Public API ─────────────────────────────────────

/// Called after Event creation. Syncs all cascading side effects.
pub fn on_event_created(world_path: &str, event: &Event) -> Result<(), String> {
    sync_entry_event_edges(world_path, event)?;
    sync_outline_event_edges(world_path, event)?;
    apply_entry_entry_edges(world_path, event)?;
    for le in &event.linked_entries {
        let _ = recalc_entry_timeline_summary(world_path, &le.entry_id);
    }
    sync_chapter_linked_events(world_path, event)?;
    Ok(())
}

/// Called after Event update. Removes old edges and applies new ones.
pub fn on_event_updated(world_path: &str, old: &Event, new: &Event) -> Result<(), String> {
    // For simplicity, rebuild: remove old event's edges, add new ones.
    remove_relationship_change_edges(world_path, old)?;
    remove_event_edges(world_path, old)?;

    // Recalc for both old and new linked_entries (some may have been removed)
    let all_entries: HashSet<&str> = old.linked_entries.iter()
        .chain(new.linked_entries.iter())
        .map(|le| le.entry_id.as_str())
        .collect();
    for eid in &all_entries {
        let _ = recalc_entry_timeline_summary(world_path, eid);
    }

    // Update chapters: remove old, add new
    remove_chapter_linked_events(world_path, old)?;

    on_event_created(world_path, new)?;
    Ok(())
}

/// Called after Event deletion.
pub fn on_event_deleted(world_path: &str, event: &Event) -> Result<(), String> {
    remove_relationship_change_edges(world_path, event)?;
    remove_event_edges(world_path, event)?;
    remove_chapter_linked_events(world_path, event)?;
    for le in &event.linked_entries {
        let _ = recalc_entry_timeline_summary(world_path, &le.entry_id);
    }
    Ok(())
}

/// Called after Event time_point changes.
pub fn on_event_moved(world_path: &str, event: &Event) -> Result<(), String> {
    for le in &event.linked_entries {
        let _ = recalc_entry_timeline_summary(world_path, &le.entry_id);
    }
    Ok(())
}

// ── Frontmatter parsers ────────────────────────────

fn parse_entry_frontmatter(raw: &str) -> Result<(serde_json::Value, String), String> {
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first() != Some(&"---") {
        return Ok((serde_json::json!({}), raw.to_string()));
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

fn parse_chapter_frontmatter(content: &str) -> Result<(serde_json::Map<String, serde_json::Value>, String), String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Ok((serde_json::Map::new(), trimmed.to_string()));
    }
    let rest = &trimmed[3..];
    match rest.find("---") {
        Some(end) => {
            let fm_text = &rest[..end].trim();
            let mut map = serde_json::Map::new();
            for line in fm_text.lines() {
                if let Some((key, value)) = line.split_once(':') {
                    map.insert(
                        key.trim().to_string(),
                        serde_json::Value::String(value.trim().trim_matches('"').to_string()),
                    );
                }
            }
            let body = rest[end + 3..].trim().to_string();
            Ok((map, body))
        }
        None => Ok((serde_json::Map::new(), rest.to_string())),
    }
}

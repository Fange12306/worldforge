/// Relation graph commands — IPC endpoints for the unified relation system.
///
/// These commands read/write the relations/index.json file via GraphStorage.
/// The frontend or Agent invokes them to manage cross-entity relations.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use uuid::Uuid;
use crate::models::graph::{EntityRef, EntityType, RelationEdge, RelationGraph};
use crate::services::graph_storage;
use crate::services::graph_traverse::GraphIndex;

/// Resolve display names for entity refs by reading world data from disk.
/// Populates the `name` field on each EntityRef.
fn resolve_names(world_path: &str, refs: &mut [&mut EntityRef]) {
    if refs.is_empty() { return; }

    let root = crate::utils::expand_tilde(world_path);

    // Collect IDs by type
    let mut entry_ids: HashSet<String> = HashSet::new();
    let mut timeline_ids: HashSet<String> = HashSet::new();
    let mut event_ids: HashSet<String> = HashSet::new();
    let mut outline_ids: HashSet<String> = HashSet::new();

    for r in refs.iter() {
        match r.entity_type {
            EntityType::Entry => { entry_ids.insert(r.id.clone()); }
            EntityType::Timeline => { timeline_ids.insert(r.id.clone()); }
            EntityType::Event => { event_ids.insert(r.id.clone()); }
            EntityType::Outline => { outline_ids.insert(r.id.clone()); }
            EntityType::Other => { /* skip name resolution for unknown types */ }
        }
    }

    // Resolve entry names: scan entries/ directories, parse frontmatter
    if !entry_ids.is_empty() {
        let entries_dir = root.join("entries");
        let type_dirs = ["characters", "locations", "organizations", "systems", "artifacts", "eras", "concepts"];
        for td in &type_dirs {
            let dir = entries_dir.join(td);
            if !dir.exists() { continue; }
            if let Ok(read) = fs::read_dir(&dir) {
                for e in read.flatten() {
                    let fname = e.file_name().to_string_lossy().to_string();
                    if !fname.ends_with(".md") { continue; }
                    // Try to extract UUID prefix from filename: "{uuid}--{name}.md"
                    let file_id = fname.split("--").next().unwrap_or("").to_string();
                    if file_id.is_empty() || !entry_ids.contains(&file_id) { continue; }
                    if let Ok(raw) = fs::read_to_string(e.path()) {
                        let name = parse_frontmatter_field(&raw, "name").unwrap_or_else(|| "未命名".to_string());
                        // Set name on all matching refs
                        for r in refs.iter_mut() {
                            if r.entity_type == EntityType::Entry && r.id == file_id {
                                r.name = Some(name.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // Resolve timeline names from timelines/index.json
    if !timeline_ids.is_empty() {
        let index_path = root.join("timelines").join("index.json");
        if let Ok(raw) = fs::read_to_string(&index_path) {
            if let Ok(index) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(timelines) = index["timelines"].as_array() {
                    for tl in timelines {
                        let tl_id = tl["id"].as_str().unwrap_or("");
                        if !timeline_ids.contains(tl_id) { continue; }
                        let tl_name = tl["name"].as_str().unwrap_or("未命名").to_string();
                        for r in refs.iter_mut() {
                            if r.entity_type == EntityType::Timeline && r.id == tl_id {
                                r.name = Some(tl_name.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // Resolve event names from timelines/*/events.json
    if !event_ids.is_empty() {
        let tls_dir = root.join("timelines");
        if tls_dir.exists() {
            if let Ok(read) = fs::read_dir(&tls_dir) {
                for tl_entry in read.flatten() {
                    let events_path = tl_entry.path().join("events.json");
                    if !events_path.exists() { continue; }
                    if let Ok(raw) = fs::read_to_string(&events_path) {
                        if let Ok(el) = serde_json::from_str::<serde_json::Value>(&raw) {
                            if let Some(events) = el["events"].as_array() {
                                for evt in events {
                                    let evt_id = evt["id"].as_str().unwrap_or("");
                                    if !event_ids.contains(evt_id) { continue; }
                                    let evt_name = evt["name"].as_str().unwrap_or_else(|| evt["summary"].as_str().unwrap_or("未命名")).to_string();
                                    for r in refs.iter_mut() {
                                        if r.entity_type == EntityType::Event && r.id == evt_id {
                                            r.name = Some(evt_name.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Resolve outline chapter names from outline/*/*.md
    if !outline_ids.is_empty() {
        let outline_dir = root.join("outline");
        if outline_dir.exists() {
            if let Ok(stories) = fs::read_dir(&outline_dir) {
                for story_entry in stories.flatten() {
                    let story_dir = story_entry.path();
                    if !story_dir.is_dir() { continue; }
                    if let Ok(chapters) = fs::read_dir(&story_dir) {
                        for ch_entry in chapters.flatten() {
                            let ch_path = ch_entry.path();
                            if !ch_path.extension().map_or(false, |e| e == "md") { continue; }
                            if let Ok(raw) = fs::read_to_string(&ch_path) {
                                let ch_id = parse_frontmatter_field(&raw, "id").unwrap_or_default();
                                if ch_id.is_empty() || !outline_ids.contains(&ch_id) { continue; }
                                let ch_name = parse_frontmatter_field(&raw, "title").unwrap_or_else(|| "未命名".to_string());
                                for r in refs.iter_mut() {
                                    if r.entity_type == EntityType::Outline && r.id == ch_id {
                                        r.name = Some(ch_name.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Parse a single field from YAML frontmatter without full serde deserialization.
fn parse_frontmatter_field(raw: &str, key: &str) -> Option<String> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") { return None; }
    let rest = &trimmed[3..];
    let end = rest.find("---")?;
    let fm = &rest[..end];
    let prefix_colon = format!("{}:", key);
    let prefix_space = format!("{}: ", key);
    for line in fm.lines() {
        let ln = line.trim();
        if ln.starts_with(&prefix_space) {
            return Some(ln[prefix_space.len()..].trim().trim_matches('"').trim_matches('\'').to_string());
        }
        if ln == &prefix_colon {
            return Some(String::new());
        }
        if ln.starts_with(&prefix_colon) {
            let v = ln[prefix_colon.len()..].trim();
            if !v.is_empty() {
                return Some(v.trim_matches('"').trim_matches('\'').to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn add_relation(
    world_path: String,
    from_type: String,
    from_id: String,
    to_type: String,
    to_id: String,
    description: String,
    reverse_description: Option<String>,
    timeline_id: Option<String>,
) -> Result<RelationGraph, String> {
    let from = EntityRef { name: None,
        entity_type: parse_entity_type(&from_type)?,
        id: from_id,
    };
    let to = EntityRef { name: None,
        entity_type: parse_entity_type(&to_type)?,
        id: to_id,
    };
    let edge = RelationEdge {
        id: Uuid::new_v4().to_string(),
        from,
        to,
        description,
        reverse_description,
        timeline_id,
        start_event_id: None,
        end_event_id: None,
    };
    graph_storage::with_graph(&world_path, |g| {
        g.add_edge(edge);
        Ok(())
    })
}

#[tauri::command]
pub fn remove_relation(
    world_path: String,
    relation_id: String,
) -> Result<RelationGraph, String> {
    graph_storage::with_graph(&world_path, |g| {
        let before = g.edges.len();
        g.edges.retain(|e| e.id != relation_id);
        if g.edges.len() == before {
            return Err(format!("关系 {} 不存在", relation_id));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn update_relation(
    world_path: String,
    relation_id: String,
    from_type: Option<String>,
    from_id: Option<String>,
    to_type: Option<String>,
    to_id: Option<String>,
    description: Option<String>,
    reverse_description: Option<String>,
    timeline_id: Option<String>,
) -> Result<RelationGraph, String> {
    graph_storage::with_graph(&world_path, |g| {
        let edge = g.edges.iter_mut()
            .find(|e| e.id == relation_id)
            .ok_or_else(|| format!("关系 {} 不存在", relation_id))?;

        if from_type.is_some() || from_id.is_some() {
            let entity_type = match from_type {
                Some(ref t) => parse_entity_type(t)?,
                None => edge.from.entity_type.clone(),
            };
            let id = from_id.unwrap_or_else(|| edge.from.id.clone());
            edge.from = EntityRef { name: None, entity_type, id };
        }

        if to_type.is_some() || to_id.is_some() {
            let entity_type = match to_type {
                Some(ref t) => parse_entity_type(t)?,
                None => edge.to.entity_type.clone(),
            };
            let id = to_id.unwrap_or_else(|| edge.to.id.clone());
            edge.to = EntityRef { name: None, entity_type, id };
        }

        if let Some(desc) = description {
            edge.description = desc;
        }
        if reverse_description.is_some() {
            edge.reverse_description = reverse_description;
        }
        if timeline_id.is_some() {
            edge.timeline_id = timeline_id;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn query_relations(
    world_path: String,
    entity_type: String,
    entity_id: String,
    timeline_id: Option<String>,
) -> Result<Vec<RelationEdge>, String> {
    let entity = EntityRef { name: None, 
        entity_type: parse_entity_type(&entity_type)?,
        id: entity_id,
    };
    let graph = graph_storage::load_graph(&world_path)?;
    let mut edges: Vec<RelationEdge> = graph
        .query_entity(&entity, timeline_id.as_deref())
        .into_iter()
        .cloned()
        .collect();
    // Enrich with display names
    let mut refs: Vec<&mut EntityRef> = Vec::new();
    for e in &mut edges {
        refs.push(&mut e.from);
        refs.push(&mut e.to);
    }
    resolve_names(&world_path, &mut refs);
    Ok(edges)
}

#[tauri::command]
pub fn get_all_relations(
    world_path: String,
) -> Result<RelationGraph, String> {
    graph_storage::load_graph(&world_path)
}

#[tauri::command]
pub fn traverse_graph(
    world_path: String,
    entity_type: String,
    entity_id: String,
    max_depth: u32,
    timeline_id: Option<String>,
) -> Result<Vec<crate::services::graph_traverse::TraversalResult>, String> {
    let et = parse_entity_type(&entity_type)?;
    let graph = graph_storage::load_graph(&world_path)?;
    eprintln!("[traverse_graph] world={world_path}, entity_type={entity_type}, entity_id={entity_id}, max_depth={max_depth}, timeline_id={timeline_id:?}");
    eprintln!("[traverse_graph] loaded {} edges from relations/index.json", graph.edges.len());
    // Filter edges by timeline scope before building the index
    let filtered: Vec<&RelationEdge> = graph.edges.iter()
        .filter(|e| RelationGraph::match_timeline_static(e, timeline_id.as_deref()))
        .collect();
    eprintln!("[traverse_graph] after timeline filter: {} edges", filtered.len());
    let index = GraphIndex::build(&filtered);
    let mut results = index.bfs(&et, &entity_id, max_depth);
    eprintln!("[traverse_graph] BFS returned {} results", results.len());
    for r in &results {
        eprintln!("[traverse_graph]   result: type={:?} id={} name={:?} dist={} via={}", r.entity.entity_type, r.entity.id, r.entity.name, r.distance, r.via_description);
    }
    // Enrich with display names
    let mut refs: Vec<&mut EntityRef> = Vec::new();
    let mut event_ids: HashSet<String> = HashSet::new();
    for r in &mut results {
        refs.push(&mut r.entity);
        refs.push(&mut r.via_entity);
        if let Some(ref id) = r.start_event_id { event_ids.insert(id.clone()); }
        if let Some(ref id) = r.end_event_id { event_ids.insert(id.clone()); }
    }
    resolve_names(&world_path, &mut refs);

    // Resolve event names for start/end event IDs
    if !event_ids.is_empty() {
        let mut event_names: HashMap<String, String> = HashMap::new();
        let tls_dir = PathBuf::from(&world_path).join("timelines");
        if tls_dir.exists() {
            if let Ok(read) = fs::read_dir(&tls_dir) {
                for tl_entry in read.flatten() {
                    let events_path = tl_entry.path().join("events.json");
                    if !events_path.exists() { continue; }
                    if let Ok(raw) = fs::read_to_string(&events_path) {
                        if let Ok(el) = serde_json::from_str::<serde_json::Value>(&raw) {
                            if let Some(events) = el["events"].as_array() {
                                for evt in events {
                                    let id = evt["id"].as_str().unwrap_or("");
                                    if event_ids.contains(id) {
                                        let name = evt["name"].as_str().unwrap_or_else(|| evt["summary"].as_str().unwrap_or("未命名")).to_string();
                                        event_names.insert(id.to_string(), name);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        for r in &mut results {
            if let Some(ref id) = r.start_event_id {
                if let Some(name) = event_names.get(id) {
                    r.start_event_id = Some(format!("{} ({})", name, id));
                }
            }
            if let Some(ref id) = r.end_event_id {
                if let Some(name) = event_names.get(id) {
                    r.end_event_id = Some(format!("{} ({})", name, id));
                }
            }
        }
    }
    Ok(results)
}

fn parse_entity_type(s: &str) -> Result<EntityType, String> {
    match s {
        "entry" => Ok(EntityType::Entry),
        "outline" => Ok(EntityType::Outline),
        "timeline" => Ok(EntityType::Timeline),
        "event" => Ok(EntityType::Event),
        _ => Err(format!("Unknown entity type: {}", s)),
    }
}

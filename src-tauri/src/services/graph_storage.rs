/// GraphStorage trait + JsonFileStorage — load/save the relation graph
///
/// Phase 4 MVP: JSON file-backed storage.
/// Abstracted behind a trait so we can swap in SqliteGraphStorage later
/// without touching any caller code.

use std::fs;
use std::path::PathBuf;

use crate::models::graph::RelationGraph;

fn expand_path(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

/// File path for the relation graph within a world directory
fn relations_path(world_path: &str) -> PathBuf {
    expand_path(world_path).join("relations").join("index.json")
}

/// Abstraction over graph persistence backends
pub trait GraphStorage {
    fn load(&self, world_path: &str) -> Result<RelationGraph, String>;
    fn save(&self, world_path: &str, graph: &RelationGraph) -> Result<(), String>;
}

/// JSON file-based storage (Phase 4 default)
pub struct JsonFileStorage;

impl GraphStorage for JsonFileStorage {
    fn load(&self, world_path: &str) -> Result<RelationGraph, String> {
        let path = relations_path(world_path);
        if !path.exists() {
            return Ok(RelationGraph::default());
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read relations: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse relations: {}", e))
    }

    fn save(&self, world_path: &str, graph: &RelationGraph) -> Result<(), String> {
        let path = relations_path(world_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create relations dir: {}", e))?;
        }
        let content = serde_json::to_string_pretty(graph)
            .map_err(|e| format!("Failed to serialize relations: {}", e))?;
        fs::write(&path, content)
            .map_err(|e| format!("Failed to write relations: {}", e))
    }
}

// ── Convenience helpers used by the command layer ──

/// Load, mutate, and save in one operation
pub fn with_graph<F>(world_path: &str, f: F) -> Result<RelationGraph, String>
where
    F: FnOnce(&mut RelationGraph) -> Result<(), String>,
{
    let storage = JsonFileStorage;
    let mut graph = storage.load(world_path)?;
    f(&mut graph)?;
    storage.save(world_path, &graph)?;
    Ok(graph)
}

pub fn load_graph(world_path: &str) -> Result<RelationGraph, String> {
    JsonFileStorage.load(world_path)
}

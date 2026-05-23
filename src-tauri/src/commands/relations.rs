/// Relation graph commands — IPC endpoints for the unified relation system.
///
/// These commands read/write the relations/index.json file via GraphStorage.
/// The frontend or Agent invokes them to manage cross-entity relations.

use crate::models::graph::{EntityRef, EntityType, RelationEdge, RelationGraph};
use crate::services::graph_storage;
use crate::services::graph_traverse::GraphIndex;

#[tauri::command]
pub fn add_relation(
    world_path: String,
    from_type: String,
    from_id: String,
    to_type: String,
    to_id: String,
    description: String,
) -> Result<RelationGraph, String> {
    let from = EntityRef {
        entity_type: parse_entity_type(&from_type)?,
        id: from_id,
    };
    let to = EntityRef {
        entity_type: parse_entity_type(&to_type)?,
        id: to_id,
    };
    let edge = RelationEdge {
        from,
        to,
        description,
        active_period: None,
    };
    graph_storage::with_graph(&world_path, |g| {
        g.add_edge(edge);
        Ok(())
    })
}

#[tauri::command]
pub fn remove_relation(
    world_path: String,
    from_type: String,
    from_id: String,
    to_type: String,
    to_id: String,
    description: String,
) -> Result<RelationGraph, String> {
    let from = EntityRef {
        entity_type: parse_entity_type(&from_type)?,
        id: from_id,
    };
    let to = EntityRef {
        entity_type: parse_entity_type(&to_type)?,
        id: to_id,
    };
    graph_storage::with_graph(&world_path, |g| {
        g.remove_edge(&from, &to, &description);
        Ok(())
    })
}

#[tauri::command]
pub fn query_relations(
    world_path: String,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<RelationEdge>, String> {
    let entity = EntityRef {
        entity_type: parse_entity_type(&entity_type)?,
        id: entity_id,
    };
    let graph = graph_storage::load_graph(&world_path)?;
    Ok(graph
        .query_entity(&entity)
        .into_iter()
        .cloned()
        .collect())
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
) -> Result<Vec<crate::services::graph_traverse::TraversalResult>, String> {
    let et = parse_entity_type(&entity_type)?;
    let graph = graph_storage::load_graph(&world_path)?;
    let index = GraphIndex::build(&graph.edges);
    Ok(index.bfs(&et, &entity_id, max_depth))
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

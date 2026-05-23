/// Unified graph model for cross-entity relations (Phase 4)
///
/// Replaces entry-only relationships with a general-purpose relation graph
/// that connects entries, outline chapters, and timeline events.

use serde::{Deserialize, Serialize};

/// The four entity types that can participate in relations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Entry,
    Outline,
    Timeline,
    Event,
}

/// A reference to any entity in the world
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct EntityRef {
    #[serde(rename = "type")]
    pub entity_type: EntityType,
    pub id: String,
}

/// A single directed edge in the unified relation graph.
///
/// active_period is reserved for Phase 6 timeline-aware consistency.
/// Leave as None until then — all edges are treated as "always active".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelationEdge {
    pub from: EntityRef,
    pub to: EntityRef,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_period: Option<[Option<i64>; 2]>,
}

/// The top-level structure stored in relations/index.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationGraph {
    pub edges: Vec<RelationEdge>,
}

impl Default for RelationGraph {
    fn default() -> Self {
        Self { edges: Vec::new() }
    }
}

impl RelationGraph {
    pub fn add_edge(&mut self, edge: RelationEdge) {
        self.edges.push(edge);
    }

    pub fn remove_edge(
        &mut self,
        from: &EntityRef,
        to: &EntityRef,
        description: &str,
    ) {
        self.edges.retain(|e| {
            !(e.from == *from && e.to == *to && e.description == description)
        });
    }

    /// Return all edges connected to the given entity (either direction)
    pub fn query_entity(&self, entity: &EntityRef) -> Vec<&RelationEdge> {
        self.edges
            .iter()
            .filter(|e| e.from == *entity || e.to == *entity)
            .collect()
    }
}

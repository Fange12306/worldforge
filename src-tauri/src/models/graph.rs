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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A single directed edge in the unified relation graph.
///
/// `timeline_id`: None = cross-timeline static relation (from RelationAdd).
/// Some(id) = scoped to events on this timeline (from relationship_changes).
/// `active_period` is reserved for Phase 6 timeline-aware consistency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelationEdge {
    #[serde(default)]
    pub id: String,           // UUID — immutable identity
    pub from: EntityRef,
    pub to: EntityRef,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_id: Option<String>,
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

    /// Return all edges connected to the given entity (either direction).
    /// Optionally filter by timeline: None = all edges; Some(tlid) = edges with
    /// timeline_id None (cross-timeline) OR matching the given timeline.
    pub fn query_entity(&self, entity: &EntityRef, timeline_id: Option<&str>) -> Vec<&RelationEdge> {
        self.edges
            .iter()
            .filter(|e| {
                (e.from == *entity || e.to == *entity)
                && Self::match_timeline(e, timeline_id)
            })
            .collect()
    }

    fn match_timeline(e: &RelationEdge, filter: Option<&str>) -> bool {
        match filter {
            None => true,
            Some(tlid) => e.timeline_id.as_deref().map_or(true, |tid| tid == tlid),
        }
    }

    /// Public static version for external callers (e.g., traverse_graph pre-filter).
    pub fn match_timeline_static(e: &RelationEdge, filter: Option<&str>) -> bool {
        Self::match_timeline(e, filter)
    }

    /// Remove edges matching from, to, description, and optionally timeline_id.
    pub fn remove_edge_scoped(
        &mut self,
        from: &EntityRef,
        to: &EntityRef,
        description: &str,
        timeline_id: Option<&str>,
    ) {
        self.edges.retain(|e| {
            !(e.from == *from && e.to == *to && e.description == description
                && timeline_id == e.timeline_id.as_deref())
        });
    }
}

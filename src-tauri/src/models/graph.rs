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
/// Static edges (from Relation tool) have both start_event_id and end_event_id = None.
/// Event-driven edges (from EventWrite relationship_changes) have start_event_id and/or
/// end_event_id pointing to the events that triggered the add/delete.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelationEdge {
    #[serde(default)]
    pub id: String,           // UUID — immutable identity
    pub from: EntityRef,
    pub to: EntityRef,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_event_id: Option<String>,
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

    /// Upsert an edge: if an edge with the same (from, to, description) exists,
    /// update start_event_id / end_event_id; otherwise insert a new edge.
    pub fn upsert_edge(&mut self, edge: RelationEdge) {
        for existing in &mut self.edges {
            if existing.from == edge.from
                && existing.to == edge.to
                && existing.description == edge.description
            {
                if edge.start_event_id.is_some() {
                    existing.start_event_id = edge.start_event_id;
                }
                if edge.end_event_id.is_some() {
                    existing.end_event_id = edge.end_event_id;
                }
                return;
            }
        }
        self.edges.push(edge);
    }
}

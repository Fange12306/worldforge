/// BFS graph traversal across the unified relation graph.
///
/// Builds an in-memory adjacency list from relations/index.json,
/// then supports BFS queries: given an entity, find all connected
/// entities up to N hops away.
///
/// Node types: entry / outline / timeline / event — treated uniformly.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::models::graph::{EntityRef, EntityType};

/// A neighbor found during traversal
#[derive(Debug, Clone, serde::Serialize)]
pub struct TraversalResult {
    pub entity: EntityRef,
    pub distance: u32,
    pub via_description: String,
    pub via_entity: EntityRef,  // the intermediate entity that connects
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_event_id: Option<String>,
}

/// Check whether a relation edge is active at the given filter time_point.
/// Static edges (no start_event/end_event) are always active.
/// Event-driven edges are active when filter_time >= start_event time
/// and filter_time < end_event time (if end_event exists).
fn edge_active_at(
    start_event_id: Option<&str>,
    end_event_id: Option<&str>,
    filter_time_point: &str,
    event_time_map: &HashMap<String, String>,
) -> bool {
    // Static edge: no time bounds → always active
    if start_event_id.is_none() && end_event_id.is_none() {
        return true;
    }
    // Has start_event: filter must be >= start time
    if let Some(eid) = start_event_id {
        if let Some(start_time) = event_time_map.get(eid) {
            if filter_time_point < start_time.as_str() {
                return false;
            }
        }
    }
    // Has end_event: filter must be < end time
    if let Some(eid) = end_event_id {
        if let Some(end_time) = event_time_map.get(eid) {
            if filter_time_point >= end_time.as_str() {
                return false;
            }
        }
    }
    true
}

/// An adjacency list built from the relation graph
#[derive(Debug)]
pub struct GraphIndex {
    /// adjacency[entity_key] = Vec<(neighbor_key, description, start_event_id, end_event_id)>
    adjacency: HashMap<String, Vec<(String, String, Option<String>, Option<String>)>>,
    /// Reverse lookup: entity_key -> (type, id)
    node_map: HashMap<String, EntityRef>,
    /// Pre-loaded event time map for time filtering
    event_time_map: HashMap<String, String>,
}

fn entity_key(entity_type: &EntityType, id: &str) -> String {
    format!(
        "{}:{}",
        match entity_type {
            EntityType::Entry => "entry",
            EntityType::Outline => "outline",
            EntityType::Timeline => "timeline",
            EntityType::Event => "event",
            EntityType::Other => "other",
        },
        id
    )
}

impl GraphIndex {
    /// Build a GraphIndex from the full list of edges.
    /// Optionally provide an event_time_map for time-filtered traversal.
    pub fn build(
        edges: &[&crate::models::graph::RelationEdge],
        event_time_map: HashMap<String, String>,
    ) -> Self {
        let mut adjacency: HashMap<String, Vec<(String, String, Option<String>, Option<String>)>> = HashMap::new();
        let mut node_map: HashMap<String, EntityRef> = HashMap::new();

        for edge in edges {
            let from_key = entity_key(&edge.from.entity_type, &edge.from.id);
            let to_key = entity_key(&edge.to.entity_type, &edge.to.id);
            let se = edge.start_event_id.clone();
            let ee = edge.end_event_id.clone();

            node_map.entry(from_key.clone())
                .or_insert_with(|| edge.from.clone());
            node_map.entry(to_key.clone())
                .or_insert_with(|| edge.to.clone());

            let fwd_desc = edge.description.clone();
            let rev_desc = edge.reverse_description.clone()
                .unwrap_or_else(|| edge.description.clone());

            adjacency.entry(from_key.clone())
                .or_default()
                .push((to_key.clone(), fwd_desc, se.clone(), ee.clone()));
            if from_key != to_key {
                adjacency.entry(to_key)
                    .or_default()
                    .push((from_key, rev_desc, se, ee));
            }
        }

        Self { adjacency, node_map, event_time_map }
    }

    /// BFS from a starting entity, optionally filtering by time_point.
    /// When filter_time_point is None, returns all edges (current behavior).
    pub fn bfs(
        &self,
        entity_type: &EntityType,
        entity_id: &str,
        max_depth: u32,
        filter_time_point: Option<&str>,
    ) -> Vec<TraversalResult> {
        let start_key = entity_key(entity_type, entity_id);
        let start_key_id = start_key.clone();
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<(String, u32)> = VecDeque::new();
        let mut results: Vec<TraversalResult> = Vec::new();

        visited.insert(start_key.clone());
        queue.push_back((start_key, 0));

        while let Some((current_key, distance)) = queue.pop_front() {
            if distance >= max_depth {
                continue;
            }

            if let Some(neighbors) = self.adjacency.get(&current_key) {
                for (neighbor_key, rel, se, ee) in neighbors {
                    // Time filter: skip edges inactive at the given time point
                    if let Some(ftp) = filter_time_point {
                        if !edge_active_at(se.as_deref(), ee.as_deref(), ftp, &self.event_time_map) {
                            continue;
                        }
                    }
                    if *neighbor_key == start_key_id {
                        // Self-relation (state): output directly, don't enqueue
                        let neighbor = self.node_map.get(neighbor_key);
                        let current = self.node_map.get(&current_key);
                        if let (Some(n), Some(c)) = (neighbor, current) {
                            results.push(TraversalResult {
                                entity: n.clone(),
                                distance: distance + 1,
                                via_description: rel.clone(),
                                via_entity: c.clone(),
                                start_event_id: se.clone(),
                                end_event_id: ee.clone(),
                            });
                        }
                        continue;
                    }
                    if visited.insert(neighbor_key.clone()) {
                        let neighbor = self.node_map.get(neighbor_key);
                        let current = self.node_map.get(&current_key);
                        if let (Some(n), Some(c)) = (neighbor, current) {
                            results.push(TraversalResult {
                                entity: n.clone(),
                                distance: distance + 1,
                                via_description: rel.clone(),
                                via_entity: c.clone(),
                                start_event_id: se.clone(),
                                end_event_id: ee.clone(),
                            });
                        }
                        queue.push_back((neighbor_key.clone(), distance + 1));
                    }
                }
            }
        }

        results
    }

}

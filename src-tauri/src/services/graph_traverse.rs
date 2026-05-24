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
}

/// An adjacency list built from the relation graph
#[derive(Debug)]
pub struct GraphIndex {
    /// adjacency[entity_key] = Vec<(neighbor_key, description)>
    adjacency: HashMap<String, Vec<(String, String)>>,
    /// Reverse lookup: entity_key -> (type, id)
    node_map: HashMap<String, EntityRef>,
}

fn entity_key(entity_type: &EntityType, id: &str) -> String {
    format!(
        "{}:{}",
        match entity_type {
            EntityType::Entry => "entry",
            EntityType::Outline => "outline",
            EntityType::Timeline => "timeline",
            EntityType::Event => "event",
        },
        id
    )
}

impl GraphIndex {
    /// Build a GraphIndex from the full list of edges.
    /// Edges are treated as undirected for traversal purposes.
    pub fn build(edges: &[&crate::models::graph::RelationEdge]) -> Self {
        let mut adjacency: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut node_map: HashMap<String, EntityRef> = HashMap::new();

        for edge in edges {
            let from_key = entity_key(&edge.from.entity_type, &edge.from.id);
            let to_key = entity_key(&edge.to.entity_type, &edge.to.id);
            let rel = edge.description.clone();

            // Store node lookups
            node_map.entry(from_key.clone())
                .or_insert_with(|| edge.from.clone());
            node_map.entry(to_key.clone())
                .or_insert_with(|| edge.to.clone());

            // Undirected: add both directions
            adjacency.entry(from_key.clone())
                .or_default()
                .push((to_key.clone(), rel.clone()));
            adjacency.entry(to_key)
                .or_default()
                .push((from_key, rel));
        }

        Self { adjacency, node_map }
    }

    /// BFS from a starting entity.
    /// Returns all entities reachable within `max_depth` hops.
    pub fn bfs(
        &self,
        entity_type: &EntityType,
        entity_id: &str,
        max_depth: u32,
    ) -> Vec<TraversalResult> {
        let start_key = entity_key(entity_type, entity_id);
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
                for (neighbor_key, rel) in neighbors {
                    if visited.insert(neighbor_key.clone()) {
                        let neighbor = self.node_map.get(neighbor_key);
                        let current = self.node_map.get(&current_key);
                        if let (Some(n), Some(c)) = (neighbor, current) {
                            results.push(TraversalResult {
                                entity: n.clone(),
                                distance: distance + 1,
                                via_description: rel.clone(),
                                via_entity: c.clone(),
                            });
                        }
                        queue.push_back((neighbor_key.clone(), distance + 1));
                    }
                }
            }
        }

        results
    }

    /// Check if a specific relation exists between two entities
    pub fn has_relation(
        &self,
        from_type: &EntityType,
        from_id: &str,
        to_type: &EntityType,
        to_id: &str,
    ) -> bool {
        let from_key = entity_key(from_type, from_id);
        let to_key = entity_key(to_type, to_id);
        self.adjacency
            .get(&from_key)
            .map_or(false, |neighbors| {
                neighbors.iter().any(|(n, _)| n == &to_key)
            })
    }
}

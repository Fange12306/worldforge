use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use super::constraint::Constraint;
use super::relationship::Relationship;

/// Universal entry types — applicable to any world, any genre
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Character,
    Location,
    Organization,
    System,
    Artifact,
    Era,
    Concept,
}

/// A period in an entity's timeline — state + location + relationship changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelinePeriod {
    pub period: [Option<i64>; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<TimelineRelationChange>,
}

/// A relationship change at a specific period
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineRelationChange {
    pub target: String,
    #[serde(default)]
    pub description: String,
}

/// The core setting entry — loaded from a .md file with frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub properties: serde_json::Value,
    #[serde(default)]
    pub relationships: Vec<Relationship>,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub timeline_summary: Vec<TimelinePeriod>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub body: String,
}

/// Index entry — a lightweight reference stored in INDEX.md
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub path: String,
    pub tags: Vec<String>,
}

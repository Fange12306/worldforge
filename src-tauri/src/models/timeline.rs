/// Timeline module — standalone time-axis + event system (Phase 5)
///
/// Each timeline represents a parallel world. Events are the basic unit,
/// anchored at a single time point on a timeline. Events bridge entries
/// and outline chapters.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Time format ─────────────────────────────────────

/// A single time unit definition within a world's time system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeUnit {
    /// Key used in code: "era", "year", "month", etc.
    pub key: String,
    /// Display name in the world's language: "纪元", "年", "月"
    pub name: String,
    /// Maximum value (null = no upper bound, e.g. year)
    pub max: Option<i64>,
    /// Display ordering (0 = coarsest, shown leftmost)
    pub display_order: u32,
    /// Number of digits for zero-padded storage (derived from max)
    pub digits: u32,
}

/// The time format configuration for a timeline.
/// Must be defined before a timeline is created.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeFormat {
    /// Ordered time units (coarsest → finest)
    pub units: Vec<TimeUnit>,
}

impl TimeFormat {
    /// Total number of segments in the time_point string.
    /// Segment 0 is always the reserved placeholder.
    pub fn segment_count(&self) -> usize {
        1 + self.units.len() // +1 for the reserved leading segment
    }
}

// ── Timeline ────────────────────────────────────────

/// A timeline represents one parallel world within a WorldForge project.
/// Most worlds have exactly one (default) timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timeline {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    pub world_id: String,
    pub time_format: TimeFormat,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight index of all timelines in a world.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineIndex {
    pub timelines: Vec<Timeline>,
}

impl Default for TimelineIndex {
    fn default() -> Self {
        Self { timelines: Vec::new() }
    }
}

// ── Event ───────────────────────────────────────────

/// A word entry linked to an event, with an optional perspective summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedEntry {
    pub entry_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective_summary: Option<String>,
}

/// A chapter linked to an event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedChapter {
    pub story_id: String,
    pub chapter_order: i32,
}

/// A relationship change that occurs at this event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationChange {
    pub entry_a: String,
    pub entry_b: String,
    pub change_type: RelationChangeType,
    pub relation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RelationChangeType {
    Add,
    Delete,
}

/// An event is the basic unit on a timeline — a single moment in the world's history.
/// It bridges entries (who participated) and outline chapters (which stories depict it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    /// Human-readable slug unique within this timeline (e.g. "着陆失败-黎明号").
    /// Used as the primary identifier by LLM tools. Auto-generated from summary if omitted.
    pub name: String,
    pub timeline_id: String,

    /// 8-segment zero-padded time string, e.g. "000-3-000225-05-15-00-00-00"
    pub time_point: String,

    /// User-specified precision index into time_format.units (0 = era, 1 = year, ...).
    /// Display truncates at this unit; null/absent = show full precision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub precision: Option<usize>,

    /// Required: human-readable summary of the event
    pub summary: String,

    /// Optional: entries linked to this event
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_entries: Vec<LinkedEntry>,

    /// Derived: chapters that reference this event
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_chapters: Vec<LinkedChapter>,

    /// Optional: relationship changes triggered at this event
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationship_changes: Vec<RelationChange>,

    /// Derived: which stories this event belongs to
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub belongs_to_stories: Vec<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// The full event list stored in timelines/<timeline_id>/events.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventList {
    pub events: Vec<Event>,
}

impl Default for EventList {
    fn default() -> Self {
        Self { events: Vec::new() }
    }
}

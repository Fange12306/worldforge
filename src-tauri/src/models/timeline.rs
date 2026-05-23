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

    /// Build a zero-padded string for initial / unknown time.
    pub fn zero_point(&self) -> String {
        let mut parts = vec!["000".to_string()]; // reserved segment
        for unit in &self.units {
            parts.push("0".repeat(unit.digits as usize));
        }
        parts.join("-")
    }

    /// Pad a user-supplied segment value to the correct width.
    pub fn pad_segment(&self, unit_index: usize, value: i64) -> String {
        let digits = self.units[unit_index].digits as usize;
        format!("{:0>width$}", value, width = digits)
    }

    /// Build a time_point string from an array of segment values.
    /// `values` length must match `units` length; segments after the
    /// last non-zero value are auto-filled to zero.
    /// The first (reserved) segment is always "000".
    pub fn build_time_point(&self, values: &[i64]) -> Result<String, String> {
        if values.len() != self.units.len() {
            return Err(format!(
                "Expected {} segment values, got {}",
                self.units.len(),
                values.len()
            ));
        }
        let mut parts = vec!["000".to_string()];
        for (i, v) in values.iter().enumerate() {
            if *v < 0 {
                return Err(format!("Segment value must be >= 0, got {}", v));
            }
            if let Some(max) = self.units[i].max {
                if *v > max {
                    return Err(format!(
                        "{} value {} exceeds max {}",
                        self.units[i].name, v, max
                    ));
                }
            }
            parts.push(self.pad_segment(i, *v));
        }
        Ok(parts.join("-"))
    }

    /// Parse a time_point string back into segments and produce display text.
    /// Trailing zero segments are truncated.
    pub fn format_time_point(&self, time_point: &str) -> String {
        let segments: Vec<&str> = time_point.split('-').collect();
        // Build display strings: (index, display_text) pairs
        let mut pairs: Vec<(usize, String)> = Vec::new();
        for (i, s) in segments.iter().enumerate().skip(1) {
            // i=1 maps to units[0], i=2 → units[1], etc.
            let unit_idx = i - 1;
            let val: i64 = s.parse().unwrap_or(0);
            if val == 0 {
                pairs.push((unit_idx, String::new()));
            } else if unit_idx < self.units.len() {
                pairs.push((unit_idx, format!("{}{}", val, self.units[unit_idx].name)));
            }
        }

        // Find last non-zero segment
        let mut last_nonzero = 0;
        let mut all_empty = true;
        for (idx, ref text) in &pairs {
            if !text.is_empty() {
                last_nonzero = *idx;
                all_empty = false;
            }
        }

        if all_empty {
            return "(时间未设定)".to_string();
        }

        pairs
            .into_iter()
            .filter(|(_, s)| !s.is_empty())
            .map(|(_, s)| s)
            .collect::<Vec<String>>()
            .join(" ")
    }

    /// Extract a single segment value from a time_point string.
    pub fn get_segment(&self, time_point: &str, unit_index: usize) -> i64 {
        let segments: Vec<&str> = time_point.split('-').collect();
        // +1 to skip reserved segment
        segments
            .get(unit_index + 1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
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
    Update,
    Delete,
}

/// An event is the basic unit on a timeline — a single moment in the world's history.
/// It bridges entries (who participated) and outline chapters (which stories depict it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
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

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintSeverity {
    Hard,
    Soft,
}

/// A rule that must (hard) or should (soft) be respected.
///
/// `timeline_id`: `None` = cross-timeline (universal), `Some(tlid)` = scoped to a specific timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub rule: String,
    pub severity: ConstraintSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_id: Option<String>,
}

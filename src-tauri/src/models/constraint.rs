use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintSeverity {
    Hard,
    Soft,
}

/// A rule that must (hard) or should (soft) be respected
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub rule: String,
    pub severity: ConstraintSeverity,
}

/// Consistency check commands — IPC endpoints for constraint checking.
///
/// These commands accept a text passage and a set of constraints,
/// run keyword-based matching, and return potential violations.
/// The real semantic check is done by the LLM in the ConsistencyCheck
/// Agent tool (Task 4.4). This Rust layer provides structured I/O
/// and lightweight pre-filtering.

use crate::models::constraint::Constraint;
use crate::services::constraint_check::{ConsistencyViolation, ConstraintEngine};

#[tauri::command]
pub fn check_consistency(
    passage: String,
    constraints: Vec<Constraint>,
) -> Vec<ConsistencyViolation> {
    ConstraintEngine::check(&passage, &constraints)
}

//! Source-exact ESM app-sampling gates from Lukoff et al. (2018).
//!
//! The caller owns foreground-app detection and elapsed-time measurement. The
//! stochastic during-use draw is supplied as the exact zero-based outcome of
//! the released app's `nextInt(106)` call, so this module never invents a seed.

use std::fmt;

pub const DURING_DELAY_MIN_SECONDS: u16 = 15;
pub const DURING_DELAY_MAX_SECONDS: u16 = 120;
pub const DURING_DELAY_OUTCOME_COUNT: u16 = DURING_DELAY_MAX_SECONDS - DURING_DELAY_MIN_SECONDS + 1;
pub const END_PROMPT_MINIMUM_USE_MS: u64 = 15_000;
pub const GLOBAL_PROMPT_COOLDOWN_MS: u64 = 1_800_000;
pub const SAME_APP_LOCKOUT_HISTORY_LENGTH: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CooldownSourceVariant {
    /// Paper prose: "at least 30 minutes" after sending a prompt.
    PaperAtLeastThirtyMinutes,
    /// Released Android source: elapsed milliseconds must be strictly `> 1800000`.
    ReleasedCodeStrictlyAfterThirtyMinutes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EsmAppSamplingError {
    InvalidDuringDelayDrawIndex { draw_index: u16 },
    EmptyPackageId,
    EmptyRecentPackageId { index: usize },
    TooManyRecentSuccessfulSamples { count: usize },
    AppStillLockedOut { package_id: String },
}

impl fmt::Display for EsmAppSamplingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDuringDelayDrawIndex { draw_index } => write!(
                formatter,
                "during-use draw index {draw_index} is outside the released app's 0..106 range"
            ),
            Self::EmptyPackageId => formatter.write_str("candidate package ID is empty"),
            Self::EmptyRecentPackageId { index } => {
                write!(formatter, "recent sampled package ID {index} is empty")
            }
            Self::TooManyRecentSuccessfulSamples { count } => write!(
                formatter,
                "recent successful sample history has {count} entries; at most 3 are source-valid"
            ),
            Self::AppStillLockedOut { package_id } => {
                write!(
                    formatter,
                    "package {package_id} is still in the three-sample lockout"
                )
            }
        }
    }
}

impl std::error::Error for EsmAppSamplingError {}

/// Convert the released app's discrete-uniform `nextInt(106)` outcome to its
/// inclusive 15..120-second delay.
pub fn during_use_delay_ms(draw_index: u16) -> Result<u64, EsmAppSamplingError> {
    if draw_index >= DURING_DELAY_OUTCOME_COUNT {
        return Err(EsmAppSamplingError::InvalidDuringDelayDrawIndex { draw_index });
    }
    Ok(u64::from(draw_index + DURING_DELAY_MIN_SECONDS) * 1_000)
}

/// Paper-level end-sample threshold over a caller-measured contiguous episode.
pub fn end_prompt_is_eligible(contiguous_use_duration_ms: u64) -> bool {
    contiguous_use_duration_ms >= END_PROMPT_MINIMUM_USE_MS
}

/// Apply one explicitly selected source variant of the 30-minute gate.
///
/// `None` denotes no prior prompt in the caller's current state scope. The
/// caller, not this function, decides whether that scope is a process lifetime
/// (as in the released app) or a persisted study state.
pub fn cooldown_is_eligible(
    elapsed_since_last_prompt_ms: Option<u64>,
    variant: CooldownSourceVariant,
) -> bool {
    let Some(elapsed_ms) = elapsed_since_last_prompt_ms else {
        return true;
    };
    match variant {
        CooldownSourceVariant::PaperAtLeastThirtyMinutes => elapsed_ms >= GLOBAL_PROMPT_COOLDOWN_MS,
        CooldownSourceVariant::ReleasedCodeStrictlyAfterThirtyMinutes => {
            elapsed_ms > GLOBAL_PROMPT_COOLDOWN_MS
        }
    }
}

fn validate_recent_history(
    candidate_package_id: &str,
    recent_successfully_sampled_package_ids: &[String],
) -> Result<(), EsmAppSamplingError> {
    if candidate_package_id.is_empty() {
        return Err(EsmAppSamplingError::EmptyPackageId);
    }
    if recent_successfully_sampled_package_ids.len() > SAME_APP_LOCKOUT_HISTORY_LENGTH {
        return Err(EsmAppSamplingError::TooManyRecentSuccessfulSamples {
            count: recent_successfully_sampled_package_ids.len(),
        });
    }
    if let Some(index) = recent_successfully_sampled_package_ids
        .iter()
        .position(|package_id| package_id.is_empty())
    {
        return Err(EsmAppSamplingError::EmptyRecentPackageId { index });
    }
    Ok(())
}

/// Whether the candidate is absent from the last three successful app samples.
pub fn same_app_is_eligible(
    candidate_package_id: &str,
    recent_successfully_sampled_package_ids: &[String],
) -> Result<bool, EsmAppSamplingError> {
    validate_recent_history(
        candidate_package_id,
        recent_successfully_sampled_package_ids,
    )?;
    Ok(!recent_successfully_sampled_package_ids
        .iter()
        .any(|package_id| package_id == candidate_package_id))
}

/// Record a successful prompt and retain exactly the latest three package IDs.
pub fn record_successful_app_sample(
    sampled_package_id: &str,
    recent_successfully_sampled_package_ids: &[String],
) -> Result<Vec<String>, EsmAppSamplingError> {
    if !same_app_is_eligible(sampled_package_id, recent_successfully_sampled_package_ids)? {
        return Err(EsmAppSamplingError::AppStillLockedOut {
            package_id: sampled_package_id.to_owned(),
        });
    }
    let mut updated = recent_successfully_sampled_package_ids.to_vec();
    updated.push(sampled_package_id.to_owned());
    if updated.len() > SAME_APP_LOCKOUT_HISTORY_LENGTH {
        updated.remove(0);
    }
    Ok(updated)
}

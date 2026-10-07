//! `delivery:B06` — the maximum-duration policy axis.
//!
//! Chronicle has always had exactly one maximum-duration behaviour and it was
//! invisible: the fused matcher rejects an observed close whose implied
//! duration exceeds `long_duration_threshold_hours` and the episode surfaces
//! as `End of Usage Missing`. This module makes that choice explicit and adds
//! a project-owned generic rule that is applied *after* reconstruction, over
//! already-bounded episodes, at the same pre-concurrency checkpoint as the
//! B03/B04 decisions (`episode_materialized_pre_concurrency`).
//!
//! Everything here is pure configuration and arithmetic. Row mutation lives in
//! `pipeline_v2_incremental::apply_maximum_duration`, next to the B04 code it
//! mirrors, so the field-use scan sees one owner per row field.
//!
//! Decision record: `docs/paper/b06-maximum-duration-research-decision.md`.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::pipeline_v2::EpisodeReconstructionStrategy;

pub const B06_PROTOCOL_VERSION: &str = "chronicle-maximum-duration/v1";
pub const B06_RECEIPT_PROTOCOL_VERSION: &str = "chronicle-maximum-duration-receipt/v1";
pub const B06_CHECKPOINT: &str = "episode_materialized_pre_concurrency";
/// Activated by every explicit selection: every reachable timestamp
/// difference on the explicit-B06 path is evaluated in `i128` first.
pub const B06_CHECKED_I128_PREFLIGHT: &str = "chronicle_explicit_b06_checked_i128_preflight_v1";
pub const LEGACY_HOURS_TO_NS: i128 = 3_600_000_000_000;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// `MaximumDurationPolicyId`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationPolicy {
    /// Delegate to whatever the selected reconstruction strategy already does.
    #[default]
    StrategyNative,
    /// Name today's fused rule explicitly (fused matcher only).
    ChronicleObservedCloseRejectionV1,
    /// Project-owned strict `>` rule over already-bounded episodes.
    PostReconstructionStrictMaxV1,
}

impl MaximumDurationPolicy {
    pub const ALL: [Self; 3] = [
        Self::StrategyNative,
        Self::ChronicleObservedCloseRejectionV1,
        Self::PostReconstructionStrictMaxV1,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::StrategyNative => "strategy_native",
            Self::ChronicleObservedCloseRejectionV1 => "chronicle_observed_close_rejection_v1",
            Self::PostReconstructionStrictMaxV1 => "post_reconstruction_strict_max_v1",
        }
    }

    pub fn from_canonical_id_strict(value: &str) -> Result<Self, MaximumDurationRefusalReason> {
        Self::ALL
            .into_iter()
            .find(|candidate| candidate.canonical_id() == value)
            .ok_or(MaximumDurationRefusalReason::RequestShapeInvalid)
    }
}

/// `MaximumDurationConfiguredDispositionId`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationDisposition {
    #[default]
    NotApplicable,
    FlagAndRetain,
    RetainButExclude,
    TruncateToThreshold,
    DropRow,
}

impl MaximumDurationDisposition {
    pub const ALL: [Self; 5] = [
        Self::NotApplicable,
        Self::FlagAndRetain,
        Self::RetainButExclude,
        Self::TruncateToThreshold,
        Self::DropRow,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::FlagAndRetain => "flag_and_retain",
            Self::RetainButExclude => "retain_but_exclude",
            Self::TruncateToThreshold => "truncate_to_threshold",
            Self::DropRow => "drop_row",
        }
    }

    pub fn from_canonical_id_strict(value: &str) -> Result<Self, MaximumDurationRefusalReason> {
        Self::ALL
            .into_iter()
            .find(|candidate| candidate.canonical_id() == value)
            .ok_or(MaximumDurationRefusalReason::RequestShapeInvalid)
    }

    pub fn is_active(self) -> bool {
        self != Self::NotApplicable
    }
}

/// `MaximumDurationThresholdSourceId`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationThresholdSource {
    #[default]
    StrategyNative,
    ChronicleLegacyConfig,
    FixedParameter,
    B12AdaptiveParticipant,
}

impl MaximumDurationThresholdSource {
    pub const ALL: [Self; 4] = [
        Self::StrategyNative,
        Self::ChronicleLegacyConfig,
        Self::FixedParameter,
        Self::B12AdaptiveParticipant,
    ];

    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::StrategyNative => "strategy_native",
            Self::ChronicleLegacyConfig => "chronicle_legacy_config",
            Self::FixedParameter => "fixed_parameter",
            Self::B12AdaptiveParticipant => "b12_adaptive_participant",
        }
    }

    pub fn from_canonical_id_strict(value: &str) -> Result<Self, MaximumDurationRefusalReason> {
        Self::ALL
            .into_iter()
            .find(|candidate| candidate.canonical_id() == value)
            .ok_or(MaximumDurationRefusalReason::RequestShapeInvalid)
    }
}

/// `MaximumDurationEffectiveEndpointReasonId`. Non-null only on a published,
/// truncated row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationEffectiveEndpointReason {
    MaximumDurationTruncationBoundary,
}

impl MaximumDurationEffectiveEndpointReason {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::MaximumDurationTruncationBoundary => "maximum_duration_truncation_boundary",
        }
    }
}

/// Closed row-outcome vocabulary reported by the receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationRowOutcome {
    /// Bounded row whose duration did not exceed the threshold.
    BoundedNotQualified,
    FlaggedRetained,
    RetainedExcluded,
    Truncated,
    Dropped,
    /// Unbounded / right-censored: no duration exists, no action is taken.
    UnboundedNoAction,
    /// The strategy's own maximum owns this row (native or Chronicle arms).
    NativePolicyOwned,
}

impl MaximumDurationRowOutcome {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::BoundedNotQualified => "bounded_not_qualified",
            Self::FlaggedRetained => "flagged_retained",
            Self::RetainedExcluded => "retained_excluded",
            Self::Truncated => "truncated",
            Self::Dropped => "dropped",
            Self::UnboundedNoAction => "unbounded_no_action",
            Self::NativePolicyOwned => "native_policy_owned",
        }
    }
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationRefusalReason {
    /// The four selection keys do not form one of the five legal shapes, or a
    /// value is outside its closed vocabulary.
    RequestShapeInvalid,
    /// `maximum_duration_threshold_ns` is not canonical `[1-9][0-9]{0,18}`
    /// within `i64`.
    ThresholdMalformed,
    PolicyIncompatibleWithReconstructionStrategy,
    AdaptiveMaximumThresholdProviderUnavailable,
    LegacyThresholdNonpositive,
    LegacyThresholdNotIntegerNs,
    LegacyThresholdOverflow,
    LegacyThresholdBinary64MappingMismatch,
    LegacyThresholdCanonicalizationMismatch,
    RawDurationUnrepresentable,
    EffectiveEndpointUnrepresentable,
    DuplicateTimestampAdjustmentUnrepresentable,
}

impl MaximumDurationRefusalReason {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::RequestShapeInvalid => "maximum_duration_request_shape_invalid",
            Self::ThresholdMalformed => "maximum_duration_threshold_malformed",
            Self::PolicyIncompatibleWithReconstructionStrategy => {
                "maximum_duration_policy_incompatible_with_reconstruction_strategy"
            }
            Self::AdaptiveMaximumThresholdProviderUnavailable => {
                "adaptive_maximum_threshold_provider_unavailable"
            }
            Self::LegacyThresholdNonpositive => "maximum_duration_legacy_threshold_nonpositive",
            Self::LegacyThresholdNotIntegerNs => "maximum_duration_legacy_threshold_not_integer_ns",
            Self::LegacyThresholdOverflow => "maximum_duration_legacy_threshold_overflow",
            Self::LegacyThresholdBinary64MappingMismatch => {
                "maximum_duration_legacy_threshold_binary64_mapping_mismatch"
            }
            Self::LegacyThresholdCanonicalizationMismatch => {
                "maximum_duration_legacy_threshold_canonicalization_mismatch"
            }
            Self::RawDurationUnrepresentable => "maximum_duration_raw_duration_unrepresentable",
            Self::EffectiveEndpointUnrepresentable => {
                "maximum_duration_effective_endpoint_unrepresentable"
            }
            Self::DuplicateTimestampAdjustmentUnrepresentable => {
                "maximum_duration_duplicate_timestamp_adjustment_unrepresentable"
            }
        }
    }

    /// The whole-request error token every execution surface reports.
    pub fn error_token(self) -> String {
        format!("b06={}", self.canonical_id())
    }

    /// True for the reasons that refuse a *legal* vector because of the
    /// selected reconstruction strategy or threshold provider, as opposed to a
    /// malformed request (shape, threshold grammar, legacy companions) or an
    /// execution-time unrepresentable value. These are the reasons a
    /// configuration-only preflight for another axis leaves to the B06
    /// preflight (`pipeline_v2::MaximumDurationValidation::MalformedOnly`).
    pub fn is_applicability_refusal(self) -> bool {
        matches!(
            self,
            Self::PolicyIncompatibleWithReconstructionStrategy
                | Self::AdaptiveMaximumThresholdProviderUnavailable
        )
    }

    /// The execution-time refusal string: a refusal raised by a query or the
    /// row stage rather than by option validation.
    pub fn execution_error(self) -> String {
        format!("pipeline_refused:{}", self.error_token())
    }
}

impl fmt::Display for MaximumDurationRefusalReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.canonical_id())
    }
}

// ---------------------------------------------------------------------------
// Request vector
// ---------------------------------------------------------------------------

/// The five B06 wire keys exactly as they arrived, plus the legacy
/// canonicalization companions. Presence is own-property membership on the
/// wire; nothing here fills in a missing sibling.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationRequest {
    pub policy: Option<String>,
    pub disposition: Option<String>,
    pub threshold_source: Option<String>,
    pub threshold_ns: Option<String>,
    pub long_duration_threshold_explicit: bool,
    pub legacy_threshold_hours_canonical: Option<String>,
    pub legacy_threshold_ns_canonical: Option<String>,
}

impl MaximumDurationRequest {
    /// True when any of the four selection keys is present.
    pub fn is_explicit(&self) -> bool {
        self.policy.is_some()
            || self.disposition.is_some()
            || self.threshold_source.is_some()
            || self.threshold_ns.is_some()
    }
}

/// One of the five legal presence shapes, resolved to typed values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationSelectionShape {
    OmittedLegacy,
    ExplicitStrategyNative,
    ExplicitChronicleRejection,
    ExplicitGenericFixed,
    ExplicitGenericAdaptive,
}

impl MaximumDurationSelectionShape {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::OmittedLegacy => "omitted_legacy",
            Self::ExplicitStrategyNative => "explicit_strategy_native",
            Self::ExplicitChronicleRejection => "explicit_chronicle_rejection",
            Self::ExplicitGenericFixed => "explicit_generic_fixed",
            Self::ExplicitGenericAdaptive => "explicit_generic_adaptive",
        }
    }
}

/// Fully validated configuration consumed by the row stage and the receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationConfig {
    pub shape: MaximumDurationSelectionShape,
    pub explicit: bool,
    pub policy: MaximumDurationPolicy,
    pub disposition: MaximumDurationDisposition,
    pub threshold_source: MaximumDurationThresholdSource,
    /// Present only for `fixed_parameter`.
    pub threshold_ns: Option<i64>,
    pub long_duration_threshold_explicit: bool,
    /// Present for every explicit selection (both companions agree with the
    /// reparse and with `long_duration_threshold_ns`).
    pub legacy_threshold_hours_canonical: Option<String>,
    pub legacy_threshold_ns_canonical: Option<String>,
}

impl MaximumDurationConfig {
    pub fn omitted() -> Self {
        Self {
            shape: MaximumDurationSelectionShape::OmittedLegacy,
            explicit: false,
            policy: MaximumDurationPolicy::StrategyNative,
            disposition: MaximumDurationDisposition::NotApplicable,
            threshold_source: MaximumDurationThresholdSource::StrategyNative,
            threshold_ns: None,
            long_duration_threshold_explicit: false,
            legacy_threshold_hours_canonical: None,
            legacy_threshold_ns_canonical: None,
        }
    }

    /// The generic post-reconstruction stage runs only for this shape.
    pub fn generic_stage_active(&self) -> bool {
        self.policy == MaximumDurationPolicy::PostReconstructionStrictMaxV1
            && self.threshold_ns.is_some()
    }

    /// Whether the explicit-B06 checked-`i128` prerequisite is active.
    pub fn checked_i128_active(&self) -> bool {
        self.explicit
    }
}

// ---------------------------------------------------------------------------
// Threshold grammar
// ---------------------------------------------------------------------------

/// Parse the canonical wire threshold: ASCII `[1-9][0-9]{0,18}`, numerically
/// `<= i64::MAX`. No sign, no whitespace, no exponent, no leading zero.
pub fn parse_threshold_ns(text: &str) -> Result<i64, MaximumDurationRefusalReason> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() > 19 {
        return Err(MaximumDurationRefusalReason::ThresholdMalformed);
    }
    if !(b'1'..=b'9').contains(&bytes[0]) || !bytes.iter().all(u8::is_ascii_digit) {
        return Err(MaximumDurationRefusalReason::ThresholdMalformed);
    }
    text.parse::<i64>()
        .map_err(|_| MaximumDurationRefusalReason::ThresholdMalformed)
}

// ---------------------------------------------------------------------------
// Legacy hours canonicalization (`canonical_legacy_hours_from_binary64_v1`)
// ---------------------------------------------------------------------------

/// ECMAScript `Number::toString` base 10 with any exponent expanded to a
/// plain decimal: no `+`, no exponent, no redundant leading zero, no trailing
/// fractional zero, no point when integral, `-0` → `0`.
///
/// Rust's `Display` for `f64` already prints the shortest round-trip digits
/// without an exponent, which is exactly the expanded ECMAScript spelling;
/// only the negative-zero rule needs restating.
pub fn canonical_legacy_hours_from_binary64_v1(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    if value == 0.0 {
        return Some("0".to_string());
    }
    Some(format!("{value}"))
}

/// Exact `N = C * 3_600_000_000_000 / 10^k` from a canonical decimal spelling,
/// evaluated on the digit string so a 309-digit `Number.MAX_VALUE` and a
/// 326-byte `Number.MIN_VALUE` are decided without arbitrary-width crates.
///
/// Returns the signed nanosecond count as an `i128` that is guaranteed to fit
/// `i64` (the overflow refusal fires first).
pub fn exact_legacy_hours_to_ns(
    canonical_hours: &str,
) -> Result<i64, MaximumDurationRefusalReason> {
    let (negative, unsigned) = match canonical_hours.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, canonical_hours),
    };
    let (integer_digits, fraction_digits) = match unsigned.split_once('.') {
        Some((integer, fraction)) => (integer, fraction),
        None => (unsigned, ""),
    };
    let well_formed = !integer_digits.is_empty()
        && integer_digits.bytes().all(|byte| byte.is_ascii_digit())
        && fraction_digits.bytes().all(|byte| byte.is_ascii_digit())
        && (integer_digits == "0" || !integer_digits.starts_with('0'))
        && !fraction_digits.ends_with('0')
        && !(unsigned.contains('.') && fraction_digits.is_empty());
    if !well_formed {
        return Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch);
    }
    // C is the concatenated digit string, k the fraction length.
    let coefficient: Vec<u8> = integer_digits
        .bytes()
        .chain(fraction_digits.bytes())
        .map(|byte| byte - b'0')
        .collect();
    let scale = fraction_digits.len();
    // 3_600_000_000_000 = 36 * 10^11.
    let product = multiply_digits(&coefficient, 36);
    let mantissa_digits: Vec<u8> = if scale > 11 {
        // Divide by 10^(k-11): integral iff that many trailing zeros exist.
        let drop = scale - 11;
        let trailing_zeros = product
            .iter()
            .rev()
            .take_while(|digit| **digit == 0)
            .count();
        if trailing_zeros < drop {
            return Err(MaximumDurationRefusalReason::LegacyThresholdNotIntegerNs);
        }
        product[..product.len() - drop].to_vec()
    } else {
        let mut extended = product;
        extended.extend(std::iter::repeat_n(0, 11 - scale));
        extended
    };
    let mantissa_digits = strip_leading_zeros(&mantissa_digits);
    if mantissa_digits.len() > 19 {
        return Err(MaximumDurationRefusalReason::LegacyThresholdOverflow);
    }
    let mut magnitude: i128 = 0;
    for digit in mantissa_digits {
        magnitude = magnitude * 10 + i128::from(*digit);
    }
    let signed = if negative { -magnitude } else { magnitude };
    i64::try_from(signed).map_err(|_| MaximumDurationRefusalReason::LegacyThresholdOverflow)
}

fn multiply_digits(digits: &[u8], factor: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(digits.len() + 3);
    let mut carry: u32 = 0;
    for digit in digits.iter().rev() {
        let value = u32::from(*digit) * factor + carry;
        out.push((value % 10) as u8);
        carry = value / 10;
    }
    while carry > 0 {
        out.push((carry % 10) as u8);
        carry /= 10;
    }
    out.reverse();
    strip_leading_zeros(&out).to_vec()
}

fn strip_leading_zeros(digits: &[u8]) -> &[u8] {
    let first = digits.iter().position(|digit| *digit != 0);
    match first {
        Some(index) => &digits[index..],
        None => &digits[digits.len().saturating_sub(1)..],
    }
}

/// The frozen, total canonicalization order (§4 of the decision record).
///
/// `legacy_bound` is true when the fused matcher (or the Chronicle arm) reads
/// the legacy hours; only then does step 1 (nonpositive) apply. Steps 2–6 run
/// for every explicit selection. `long_duration_threshold_ns` is the wire
/// value the browser derived with binary64 arithmetic (`M`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyCanonicalization {
    pub hours_canonical: String,
    pub ns_canonical: String,
    pub ns: i64,
}

pub fn canonicalize_legacy_threshold(
    request: &MaximumDurationRequest,
    long_duration_threshold_ns: i64,
    legacy_bound: bool,
) -> Result<LegacyCanonicalization, MaximumDurationRefusalReason> {
    let hours_canonical = request
        .legacy_threshold_hours_canonical
        .as_deref()
        .ok_or(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)?;
    let ns_canonical = request
        .legacy_threshold_ns_canonical
        .as_deref()
        .ok_or(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)?;
    // Step 1 — nonpositive when the legacy hours are bound.
    let hours_value: f64 = hours_canonical
        .parse()
        .map_err(|_| MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)?;
    if legacy_bound && (hours_value <= 0.0 || hours_canonical.starts_with('-')) {
        return Err(MaximumDurationRefusalReason::LegacyThresholdNonpositive);
    }
    // Step 2 — the supplied spelling must be the canonical spelling of the
    // binary64 it parses to (rejects `1.2500000000000001`).
    let reparsed = canonical_legacy_hours_from_binary64_v1(hours_value)
        .ok_or(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)?;
    if reparsed != hours_canonical {
        return Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch);
    }
    // Steps 3–4 — exact rational to integer nanoseconds inside i64.
    let ns = exact_legacy_hours_to_ns(hours_canonical)?;
    // Step 4 (continued) — the legacy binary64 product must be finite,
    // integral, and equal to N.
    let product = hours_value * (LEGACY_HOURS_TO_NS as f64);
    if !product.is_finite() || product.fract() != 0.0 || product.abs() >= 2f64.powi(127) {
        return Err(MaximumDurationRefusalReason::LegacyThresholdBinary64MappingMismatch);
    }
    if product as i128 != i128::from(ns) {
        return Err(MaximumDurationRefusalReason::LegacyThresholdBinary64MappingMismatch);
    }
    // Step 5/6 — the companions must agree with the reparse and with the
    // wire `long_duration_threshold_ns`.
    if ns_canonical != ns.to_string() || long_duration_threshold_ns != ns {
        return Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch);
    }
    Ok(LegacyCanonicalization {
        hours_canonical: hours_canonical.to_string(),
        ns_canonical: ns_canonical.to_string(),
        ns,
    })
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaximumDurationRelation {
    BaselineNative,
    BaselineEquivalent,
    ControlledDerivative,
    Refused,
}

impl MaximumDurationRelation {
    pub fn canonical_id(self) -> &'static str {
        match self {
            Self::BaselineNative => "baseline_native",
            Self::BaselineEquivalent => "baseline_equivalent",
            Self::ControlledDerivative => "controlled_derivative",
            Self::Refused => "refused",
        }
    }
}

/// Which stage owns the maximum for the selected strategy: independent from
/// the B06 effective stage so a generic post-reconstruction comparator is
/// never projected onto a native timeout.
pub fn reconstruction_native_stage(strategy: EpisodeReconstructionStrategy) -> &'static str {
    use EpisodeReconstructionStrategy as S;
    match strategy {
        S::FusedMatcher => "fused_candidate_close_admissibility",
        S::GesisStartStopRepair => "gesis_fallback_timeout_600s",
        S::EyesComplement => "eyes_device_state_blocks",
        S::DraxlerInterruptionAware => "draxler_inactivity_closer_600s",
        S::ParryTothForwardPairing
        | S::ForegroundBackgroundPairing
        | S::MorrisonLockTolerant
        | S::Schoedel2026AppWithinScreenProseV1 => "none",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationApplicability {
    pub protocol_version: String,
    pub shape: MaximumDurationSelectionShape,
    pub requested_policy: MaximumDurationPolicy,
    pub effective_policy: Option<MaximumDurationPolicy>,
    pub disposition: MaximumDurationDisposition,
    pub threshold_source: MaximumDurationThresholdSource,
    /// Canonical decimal string of the fixed threshold. A string, never a
    /// JSON number: the full `i64` range is legal and anything above 2^53
    /// cannot cross the browser boundary as a number.
    pub threshold_ns: Option<String>,
    pub relation: MaximumDurationRelation,
    pub refusal_reason: Option<MaximumDurationRefusalReason>,
    pub b06_effective_stage: String,
    pub reconstruction_native_stage: String,
    pub checked_i128_preflight: Option<String>,
    pub legacy_threshold_hours_canonical: Option<String>,
    pub legacy_threshold_ns_canonical: Option<String>,
    pub legacy_origin: String,
}

impl MaximumDurationApplicability {
    pub fn is_executable(&self) -> bool {
        self.relation != MaximumDurationRelation::Refused
    }
}

/// Resolve the request against the strategy and the wire legacy threshold.
/// Every refusal is typed and happens before any reconstruction can run.
///
/// A malformed vector has no legal shape, so it can only be reported as an
/// error. A legal shape this build cannot run — the two applicability refusals
/// named by [`MaximumDurationRefusalReason::is_applicability_refusal`] — does
/// have a shape, and its resolved applicability is returned as `Ok` with no
/// config, so the configuration-only entry point reports the shape the
/// researcher actually selected instead of reconstructing a lossy one.
fn resolve_maximum_duration_parts(
    request: &MaximumDurationRequest,
    strategy: EpisodeReconstructionStrategy,
    long_duration_threshold_ns: i64,
) -> Result<
    (Option<MaximumDurationConfig>, MaximumDurationApplicability),
    MaximumDurationRefusalReason,
> {
    let native_stage = reconstruction_native_stage(strategy).to_string();
    let legacy_origin = if request.long_duration_threshold_explicit {
        "chronicle_legacy_explicit_v1"
    } else {
        "chronicle_legacy_default_v1"
    }
    .to_string();
    if !request.is_explicit() {
        let config = MaximumDurationConfig::omitted();
        let applicability = MaximumDurationApplicability {
            protocol_version: B06_PROTOCOL_VERSION.into(),
            shape: MaximumDurationSelectionShape::OmittedLegacy,
            requested_policy: MaximumDurationPolicy::StrategyNative,
            effective_policy: Some(MaximumDurationPolicy::StrategyNative),
            disposition: MaximumDurationDisposition::NotApplicable,
            threshold_source: MaximumDurationThresholdSource::StrategyNative,
            threshold_ns: None,
            relation: MaximumDurationRelation::BaselineNative,
            refusal_reason: None,
            b06_effective_stage: "none".into(),
            reconstruction_native_stage: native_stage,
            checked_i128_preflight: None,
            legacy_threshold_hours_canonical: None,
            legacy_threshold_ns_canonical: None,
            legacy_origin,
        };
        return Ok((Some(config), applicability));
    }
    // Every explicit selection carries the three selection keys.
    let (Some(policy), Some(disposition), Some(source)) = (
        request.policy.as_deref(),
        request.disposition.as_deref(),
        request.threshold_source.as_deref(),
    ) else {
        return Err(MaximumDurationRefusalReason::RequestShapeInvalid);
    };
    let policy = MaximumDurationPolicy::from_canonical_id_strict(policy)?;
    let disposition = MaximumDurationDisposition::from_canonical_id_strict(disposition)?;
    let source = MaximumDurationThresholdSource::from_canonical_id_strict(source)?;
    let (shape, threshold_ns) =
        select_shape(policy, disposition, source, request.threshold_ns.as_deref())?;
    // Legacy canonicalization runs for every explicit selection; the
    // nonpositive step applies only when the legacy hours are bound.
    let legacy_bound = strategy == EpisodeReconstructionStrategy::FusedMatcher
        || shape == MaximumDurationSelectionShape::ExplicitChronicleRejection;
    let legacy = canonicalize_legacy_threshold(request, long_duration_threshold_ns, legacy_bound)?;
    let (relation, refusal, effective_stage) = match shape {
        MaximumDurationSelectionShape::ExplicitStrategyNative => {
            (MaximumDurationRelation::BaselineEquivalent, None, "none")
        }
        MaximumDurationSelectionShape::ExplicitChronicleRejection => {
            if strategy == EpisodeReconstructionStrategy::FusedMatcher {
                (
                    MaximumDurationRelation::BaselineEquivalent,
                    None,
                    "native_candidate_admissibility",
                )
            } else {
                (
                    MaximumDurationRelation::Refused,
                    Some(
                        MaximumDurationRefusalReason::PolicyIncompatibleWithReconstructionStrategy,
                    ),
                    "none",
                )
            }
        }
        MaximumDurationSelectionShape::ExplicitGenericFixed => (
            MaximumDurationRelation::ControlledDerivative,
            None,
            "post_reconstruction_pre_concurrency",
        ),
        MaximumDurationSelectionShape::ExplicitGenericAdaptive => (
            MaximumDurationRelation::Refused,
            Some(MaximumDurationRefusalReason::AdaptiveMaximumThresholdProviderUnavailable),
            "none",
        ),
        MaximumDurationSelectionShape::OmittedLegacy => unreachable!("handled above"),
    };
    let applicability = MaximumDurationApplicability {
        protocol_version: B06_PROTOCOL_VERSION.into(),
        shape,
        requested_policy: policy,
        effective_policy: refusal.is_none().then_some(policy),
        disposition,
        threshold_source: source,
        threshold_ns: threshold_ns.map(|ns| ns.to_string()),
        relation,
        refusal_reason: refusal,
        b06_effective_stage: effective_stage.into(),
        reconstruction_native_stage: native_stage,
        checked_i128_preflight: Some(B06_CHECKED_I128_PREFLIGHT.into()),
        legacy_threshold_hours_canonical: Some(legacy.hours_canonical.clone()),
        legacy_threshold_ns_canonical: Some(legacy.ns_canonical.clone()),
        legacy_origin,
    };
    if refusal.is_some() {
        // The shape is legal; only this build cannot run it. Keep the resolved
        // applicability so the preflight reports the selected shape.
        return Ok((None, applicability));
    }
    let config = MaximumDurationConfig {
        shape,
        explicit: true,
        policy,
        disposition,
        threshold_source: source,
        threshold_ns,
        long_duration_threshold_explicit: request.long_duration_threshold_explicit,
        legacy_threshold_hours_canonical: Some(legacy.hours_canonical),
        legacy_threshold_ns_canonical: Some(legacy.ns_canonical),
    };
    Ok((Some(config), applicability))
}

/// Execution entry point: a refusal of any class is an error here, so no
/// caller can run a request this build refuses.
pub fn resolve_maximum_duration(
    request: &MaximumDurationRequest,
    strategy: EpisodeReconstructionStrategy,
    long_duration_threshold_ns: i64,
) -> Result<(MaximumDurationConfig, MaximumDurationApplicability), MaximumDurationRefusalReason> {
    let (config, applicability) =
        resolve_maximum_duration_parts(request, strategy, long_duration_threshold_ns)?;
    match config {
        Some(config) => Ok((config, applicability)),
        None => Err(applicability
            .refusal_reason
            .expect("a refused applicability carries its reason")),
    }
}

/// The five legal presence shapes, decided from the four selection keys.
fn select_shape(
    policy: MaximumDurationPolicy,
    disposition: MaximumDurationDisposition,
    source: MaximumDurationThresholdSource,
    threshold_text: Option<&str>,
) -> Result<(MaximumDurationSelectionShape, Option<i64>), MaximumDurationRefusalReason> {
    use MaximumDurationDisposition as D;
    use MaximumDurationPolicy as P;
    use MaximumDurationThresholdSource as T;
    Ok(match (policy, disposition, source, threshold_text) {
        (P::StrategyNative, D::NotApplicable, T::StrategyNative, None) => {
            (MaximumDurationSelectionShape::ExplicitStrategyNative, None)
        }
        (
            P::ChronicleObservedCloseRejectionV1,
            D::NotApplicable,
            T::ChronicleLegacyConfig,
            None,
        ) => (
            MaximumDurationSelectionShape::ExplicitChronicleRejection,
            None,
        ),
        (P::PostReconstructionStrictMaxV1, active, T::FixedParameter, Some(text))
            if active.is_active() =>
        {
            (
                MaximumDurationSelectionShape::ExplicitGenericFixed,
                Some(parse_threshold_ns(text)?),
            )
        }
        (P::PostReconstructionStrictMaxV1, active, T::B12AdaptiveParticipant, None)
            if active.is_active() =>
        {
            (MaximumDurationSelectionShape::ExplicitGenericAdaptive, None)
        }
        _ => return Err(MaximumDurationRefusalReason::RequestShapeInvalid),
    })
}

/// The row-affecting subset of a B06 selection: what the classification
/// stage reads. It is decided by the four selection keys alone, so an edit
/// to the presence marker or the legacy companions changes receipt identity
/// without recomputing rows — the same split B04 makes between its
/// `_explicit` facts and its computational fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationRowStage {
    /// True for every explicit selection: the checked-`i128` prerequisite.
    pub explicit: bool,
    /// Present only when the generic post-reconstruction stage runs.
    pub threshold_ns: Option<i64>,
    pub disposition: MaximumDurationDisposition,
}

impl MaximumDurationRowStage {
    pub fn omitted() -> Self {
        Self {
            explicit: false,
            threshold_ns: None,
            disposition: MaximumDurationDisposition::NotApplicable,
        }
    }

    pub fn generic_stage_active(&self) -> bool {
        self.threshold_ns.is_some()
    }

    pub fn checked_i128_active(&self) -> bool {
        self.explicit
    }
}

impl MaximumDurationConfig {
    pub fn row_stage(&self) -> MaximumDurationRowStage {
        MaximumDurationRowStage {
            explicit: self.explicit,
            threshold_ns: self
                .generic_stage_active()
                .then_some(self.threshold_ns)
                .flatten(),
            disposition: self.disposition,
        }
    }
}

/// Resolve the row stage from the four selection keys. Refusals that depend
/// on the strategy or the legacy companions are not visible here; they are
/// raised by `resolve_maximum_duration` before any row is touched.
pub fn resolve_row_stage(
    policy: Option<&str>,
    disposition: Option<&str>,
    threshold_source: Option<&str>,
    threshold_ns: Option<&str>,
) -> Result<MaximumDurationRowStage, MaximumDurationRefusalReason> {
    let (Some(policy), Some(disposition), Some(source)) = (policy, disposition, threshold_source)
    else {
        if policy.is_none()
            && disposition.is_none()
            && threshold_source.is_none()
            && threshold_ns.is_none()
        {
            return Ok(MaximumDurationRowStage::omitted());
        }
        return Err(MaximumDurationRefusalReason::RequestShapeInvalid);
    };
    let policy = MaximumDurationPolicy::from_canonical_id_strict(policy)?;
    let disposition = MaximumDurationDisposition::from_canonical_id_strict(disposition)?;
    let source = MaximumDurationThresholdSource::from_canonical_id_strict(source)?;
    let (shape, threshold) = select_shape(policy, disposition, source, threshold_ns)?;
    Ok(MaximumDurationRowStage {
        explicit: true,
        threshold_ns: (shape == MaximumDurationSelectionShape::ExplicitGenericFixed)
            .then_some(threshold)
            .flatten(),
        disposition,
    })
}

/// Configuration-only entry point for native and WASM callers: the same
/// resolution as execution, reported as data instead of an error.
///
/// An applicability refusal keeps the shape the researcher selected. Only a
/// malformed vector falls through to the reconstruction below, because a
/// malformed vector never resolved to a shape at all.
pub fn maximum_duration_applicability(
    request: &MaximumDurationRequest,
    strategy: EpisodeReconstructionStrategy,
    long_duration_threshold_ns: i64,
) -> MaximumDurationApplicability {
    match resolve_maximum_duration_parts(request, strategy, long_duration_threshold_ns) {
        Ok((_, applicability)) => applicability,
        Err(reason) => MaximumDurationApplicability {
            protocol_version: B06_PROTOCOL_VERSION.into(),
            shape: MaximumDurationSelectionShape::OmittedLegacy,
            requested_policy: request
                .policy
                .as_deref()
                .and_then(|value| MaximumDurationPolicy::from_canonical_id_strict(value).ok())
                .unwrap_or_default(),
            effective_policy: None,
            disposition: request
                .disposition
                .as_deref()
                .and_then(|value| MaximumDurationDisposition::from_canonical_id_strict(value).ok())
                .unwrap_or_default(),
            threshold_source: request
                .threshold_source
                .as_deref()
                .and_then(|value| {
                    MaximumDurationThresholdSource::from_canonical_id_strict(value).ok()
                })
                .unwrap_or_default(),
            threshold_ns: None,
            relation: MaximumDurationRelation::Refused,
            refusal_reason: Some(reason),
            b06_effective_stage: "none".into(),
            reconstruction_native_stage: reconstruction_native_stage(strategy).into(),
            checked_i128_preflight: Some(B06_CHECKED_I128_PREFLIGHT.into()),
            legacy_threshold_hours_canonical: request.legacy_threshold_hours_canonical.clone(),
            legacy_threshold_ns_canonical: request.legacy_threshold_ns_canonical.clone(),
            legacy_origin: if request.long_duration_threshold_explicit {
                "chronicle_legacy_explicit_v1"
            } else {
                "chronicle_legacy_default_v1"
            }
            .into(),
        },
    }
}

// ---------------------------------------------------------------------------
// Qualification and truncation arithmetic
// ---------------------------------------------------------------------------

/// `qualifies = d > T` — strict; equality is retained.
pub fn qualifies(raw_duration_ns: i64, threshold_ns: i64) -> bool {
    raw_duration_ns > threshold_ns
}

/// Exact raw duration from i64 endpoints under the checked-`i128` rule.
/// `Ok(None)` is a negative span (an ordering failure B06 never repairs).
pub fn checked_raw_duration_ns(
    start_ns: i64,
    stop_ns: i64,
) -> Result<Option<i64>, MaximumDurationRefusalReason> {
    let delta = i128::from(stop_ns) - i128::from(start_ns);
    if delta < 0 {
        return Ok(None);
    }
    i64::try_from(delta)
        .map(Some)
        .map_err(|_| MaximumDurationRefusalReason::RawDurationUnrepresentable)
}

/// The published truncation endpoint. For a qualifying row `s + T < e <= MAX`
/// holds, so the check can only fire on corrupt internal state — and then the
/// whole run refuses instead of saturating.
pub fn truncated_stop_ns(
    start_ns: i64,
    threshold_ns: i64,
) -> Result<i64, MaximumDurationRefusalReason> {
    start_ns
        .checked_add(threshold_ns)
        .ok_or(MaximumDurationRefusalReason::EffectiveEndpointUnrepresentable)
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

/// Excluded-lineage record for `retain_but_exclude`, `truncate_to_threshold`
/// and `drop_row`: the raw bounds a later reader needs to reverse or audit
/// the action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationExcludedEpisode {
    pub participant_id: String,
    pub app_package_name: String,
    pub source_data_row_ranges: Vec<crate::pipeline_v2::SourceDataRowRange>,
    pub raw_start_timestamp_ns: i64,
    pub raw_stop_timestamp_ns: i64,
    pub raw_duration_ns: i64,
    pub effective_stop_timestamp_ns: Option<i64>,
    pub effective_duration_ns: Option<i64>,
    pub trimmed_ns: i64,
    pub outcome: MaximumDurationRowOutcome,
    pub disposition: MaximumDurationDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationReceipt {
    pub protocol_version: String,
    pub applicability: MaximumDurationApplicability,
    pub checkpoint: String,
    pub bounded_episode_count: u32,
    pub unbounded_episode_count: u32,
    pub qualifying_count: u32,
    pub outcome_counts: std::collections::BTreeMap<String, u32>,
    /// Canonical decimal `i128` strings: sums may exceed `i64`.
    pub raw_duration_total_ns: String,
    pub effective_duration_total_ns: String,
    pub trimmed_total_ns: String,
    pub dropped_raw_total_ns: String,
    pub headline_credited_total_ns: String,
    pub excluded_lineage_digest: String,
}

/// One pre-concurrency episode as the receipt builder sees it: the immutable
/// raw bounds recorded at `episode_materialized_pre_concurrency`. Both the
/// live stage and the persisted-base validator feed the same projection, so
/// the receipt is a pure function of (census, configuration).
#[derive(Debug, Clone)]
pub struct MaximumDurationEpisodeInput<'a> {
    pub participant_id: &'a str,
    pub app_package_name: &'a str,
    pub source_data_row_ranges: &'a [crate::pipeline_v2::SourceDataRowRange],
    pub raw_start_timestamp_ns: i64,
    pub raw_stop_timestamp_ns: Option<i64>,
    pub raw_duration_ns: Option<i64>,
}

/// Receipt plus the excluded-lineage table it digests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximumDurationEvidence {
    pub receipt: MaximumDurationReceipt,
    pub excluded_episodes: Vec<MaximumDurationExcludedEpisode>,
}

fn canonicalize_excluded_episodes(excluded: &mut [MaximumDurationExcludedEpisode]) {
    excluded.sort_by(|left, right| {
        left.participant_id
            .cmp(&right.participant_id)
            .then(
                left.raw_start_timestamp_ns
                    .cmp(&right.raw_start_timestamp_ns),
            )
            .then(left.raw_stop_timestamp_ns.cmp(&right.raw_stop_timestamp_ns))
            .then(left.app_package_name.cmp(&right.app_package_name))
            .then_with(|| {
                left.source_data_row_ranges
                    .iter()
                    .map(|range| (range.first, range.last))
                    .cmp(
                        right
                            .source_data_row_ranges
                            .iter()
                            .map(|range| (range.first, range.last)),
                    )
            })
    });
}

/// Digest of the canonical excluded-lineage table (`sha256:<hex>` over its
/// canonical JSON encoding), also recomputed by validators.
pub fn excluded_lineage_digest(
    excluded: &[MaximumDurationExcludedEpisode],
) -> Result<String, String> {
    use sha2::Digest as _;
    let bytes = serde_json::to_vec(excluded)
        .map_err(|error| format!("serialize B06 excluded lineage: {error}"))?;
    Ok(format!(
        "sha256:{}",
        hex::encode(sha2::Sha256::digest(bytes))
    ))
}

/// Build the receipt for an explicit selection. Returns `None` for the
/// omitted shape: no receipt exists, and the manifest byte stream is exactly
/// the pre-B06 stream.
pub fn build_evidence<'a>(
    episodes: impl IntoIterator<Item = MaximumDurationEpisodeInput<'a>>,
    config: &MaximumDurationConfig,
    applicability: &MaximumDurationApplicability,
) -> Result<Option<MaximumDurationEvidence>, String> {
    if !config.explicit {
        return Ok(None);
    }
    let generic = config.generic_stage_active().then(|| {
        (
            config.threshold_ns.expect("generic threshold"),
            config.disposition,
        )
    });
    let mut bounded_episode_count = 0_u32;
    let mut unbounded_episode_count = 0_u32;
    let mut qualifying_count = 0_u32;
    let mut outcome_counts = std::collections::BTreeMap::<String, u32>::new();
    let mut raw_total: i128 = 0;
    let mut effective_total: i128 = 0;
    let mut trimmed_total: i128 = 0;
    let mut dropped_raw_total: i128 = 0;
    let mut headline_total: i128 = 0;
    let mut excluded = Vec::new();
    let mut count = |outcome: MaximumDurationRowOutcome| {
        *outcome_counts
            .entry(outcome.canonical_id().to_string())
            .or_default() += 1;
    };
    for episode in episodes {
        let (Some(raw_stop), Some(raw_duration)) =
            (episode.raw_stop_timestamp_ns, episode.raw_duration_ns)
        else {
            unbounded_episode_count += 1;
            count(MaximumDurationRowOutcome::UnboundedNoAction);
            continue;
        };
        bounded_episode_count += 1;
        raw_total += i128::from(raw_duration);
        let Some((threshold_ns, disposition)) = generic else {
            effective_total += i128::from(raw_duration);
            headline_total += i128::from(raw_duration);
            count(MaximumDurationRowOutcome::NativePolicyOwned);
            continue;
        };
        if !qualifies(raw_duration, threshold_ns) {
            effective_total += i128::from(raw_duration);
            headline_total += i128::from(raw_duration);
            count(MaximumDurationRowOutcome::BoundedNotQualified);
            continue;
        }
        qualifying_count += 1;
        let (outcome, effective_stop, effective_duration, trimmed_ns, records_lineage) =
            match disposition {
                MaximumDurationDisposition::NotApplicable
                | MaximumDurationDisposition::FlagAndRetain => (
                    MaximumDurationRowOutcome::FlaggedRetained,
                    Some(raw_stop),
                    Some(raw_duration),
                    0_i64,
                    false,
                ),
                MaximumDurationDisposition::RetainButExclude => (
                    MaximumDurationRowOutcome::RetainedExcluded,
                    Some(raw_stop),
                    Some(raw_duration),
                    0,
                    true,
                ),
                MaximumDurationDisposition::TruncateToThreshold => {
                    let stop = truncated_stop_ns(episode.raw_start_timestamp_ns, threshold_ns)
                        .map_err(b06_execution_error)?;
                    (
                        MaximumDurationRowOutcome::Truncated,
                        Some(stop),
                        Some(threshold_ns),
                        raw_duration - threshold_ns,
                        true,
                    )
                }
                MaximumDurationDisposition::DropRow => (
                    MaximumDurationRowOutcome::Dropped,
                    None,
                    None,
                    raw_duration,
                    true,
                ),
            };
        count(outcome);
        let effective = effective_duration.unwrap_or(0);
        effective_total += i128::from(effective);
        trimmed_total += match outcome {
            MaximumDurationRowOutcome::Truncated => i128::from(trimmed_ns),
            _ => 0,
        };
        if outcome == MaximumDurationRowOutcome::Dropped {
            dropped_raw_total += i128::from(raw_duration);
        }
        if matches!(
            outcome,
            MaximumDurationRowOutcome::FlaggedRetained | MaximumDurationRowOutcome::Truncated
        ) {
            headline_total += i128::from(effective);
        }
        if records_lineage {
            excluded.push(MaximumDurationExcludedEpisode {
                participant_id: episode.participant_id.to_string(),
                app_package_name: episode.app_package_name.to_string(),
                source_data_row_ranges: episode.source_data_row_ranges.to_vec(),
                raw_start_timestamp_ns: episode.raw_start_timestamp_ns,
                raw_stop_timestamp_ns: raw_stop,
                raw_duration_ns: raw_duration,
                effective_stop_timestamp_ns: effective_stop,
                effective_duration_ns: effective_duration,
                trimmed_ns,
                outcome,
                disposition,
            });
        }
    }
    canonicalize_excluded_episodes(&mut excluded);
    let receipt = MaximumDurationReceipt {
        protocol_version: B06_RECEIPT_PROTOCOL_VERSION.to_string(),
        applicability: applicability.clone(),
        checkpoint: B06_CHECKPOINT.to_string(),
        bounded_episode_count,
        unbounded_episode_count,
        qualifying_count,
        outcome_counts,
        raw_duration_total_ns: raw_total.to_string(),
        effective_duration_total_ns: effective_total.to_string(),
        trimmed_total_ns: trimmed_total.to_string(),
        dropped_raw_total_ns: dropped_raw_total.to_string(),
        headline_credited_total_ns: headline_total.to_string(),
        excluded_lineage_digest: excluded_lineage_digest(&excluded)?,
    };
    Ok(Some(MaximumDurationEvidence {
        receipt,
        excluded_episodes: excluded,
    }))
}

/// Structural validation a consumer can run without the census: the digest
/// matches the table, the table is canonical, and the counts are consistent.
pub fn validate_evidence(evidence: &MaximumDurationEvidence) -> Result<(), String> {
    let mut canonical = evidence.excluded_episodes.clone();
    canonicalize_excluded_episodes(&mut canonical);
    if canonical != evidence.excluded_episodes {
        return Err("maximum_duration_noncanonical_lineage_order".into());
    }
    if excluded_lineage_digest(&evidence.excluded_episodes)?
        != evidence.receipt.excluded_lineage_digest
    {
        return Err("maximum_duration_lineage_digest_mismatch".into());
    }
    let receipt = &evidence.receipt;
    if receipt.protocol_version != B06_RECEIPT_PROTOCOL_VERSION
        || receipt.checkpoint != B06_CHECKPOINT
    {
        return Err("maximum_duration_receipt_protocol_mismatch".into());
    }
    let counted: u64 = receipt
        .outcome_counts
        .values()
        .map(|value| u64::from(*value))
        .sum();
    if counted
        != u64::from(receipt.bounded_episode_count) + u64::from(receipt.unbounded_episode_count)
    {
        return Err("maximum_duration_outcome_count_mismatch".into());
    }
    let lineage_outcomes = receipt
        .outcome_counts
        .iter()
        .filter(|(id, _)| matches!(id.as_str(), "retained_excluded" | "truncated" | "dropped"))
        .map(|(_, value)| u64::from(*value))
        .sum::<u64>();
    if lineage_outcomes != evidence.excluded_episodes.len() as u64 {
        return Err("maximum_duration_lineage_count_mismatch".into());
    }
    if receipt.applicability.refusal_reason.is_some() {
        return Err("maximum_duration_refused_receipt_published".into());
    }
    Ok(())
}

fn b06_execution_error(reason: MaximumDurationRefusalReason) -> String {
    reason.execution_error()
}

#[cfg(test)]
mod tests {
    //! Tier-1 rows of `docs/paper/b06-maximum-duration-proof-matrix.md` that
    //! are pure configuration and arithmetic. Row-level and warm/cold rows
    //! live beside the B02/B04 tests in `pipeline_v2_incremental.rs`.
    use super::*;
    use crate::pipeline_v2::SourceDataRowRange;

    const HOUR_NS: i64 = 3_600_000_000_000;

    fn explicit_request(
        policy: &str,
        disposition: &str,
        source: &str,
        threshold: Option<&str>,
    ) -> MaximumDurationRequest {
        MaximumDurationRequest {
            policy: Some(policy.into()),
            disposition: Some(disposition.into()),
            threshold_source: Some(source.into()),
            threshold_ns: threshold.map(str::to_string),
            long_duration_threshold_explicit: false,
            legacy_threshold_hours_canonical: Some("12".into()),
            legacy_threshold_ns_canonical: Some("43200000000000".into()),
        }
    }

    fn generic_request(disposition: &str, threshold: &str) -> MaximumDurationRequest {
        explicit_request(
            "post_reconstruction_strict_max_v1",
            disposition,
            "fixed_parameter",
            Some(threshold),
        )
    }

    // b06_threshold_wire_exactness / b06_i64_max_threshold ---------------------

    #[test]
    fn threshold_grammar_is_exact_base10_within_i64() {
        assert_eq!(parse_threshold_ns("1"), Ok(1));
        assert_eq!(parse_threshold_ns("43200000000000"), Ok(12 * HOUR_NS));
        assert_eq!(parse_threshold_ns("9223372036854775807"), Ok(i64::MAX));
        for malformed in [
            "",
            "0",
            "01",
            "-1",
            "+1",
            " 1",
            "1 ",
            "1.0",
            "1e3",
            "1_000",
            "٣",
            "9223372036854775808",
            "18446744073709551615",
            "10000000000000000000",
        ] {
            assert_eq!(
                parse_threshold_ns(malformed),
                Err(MaximumDurationRefusalReason::ThresholdMalformed),
                "{malformed:?} must be refused"
            );
        }
    }

    #[test]
    fn i64_max_threshold_never_qualifies_and_truncation_never_saturates() {
        assert!(!qualifies(i64::MAX, i64::MAX));
        assert!(!qualifies(0, i64::MAX));
        // A qualifying row satisfies s + T < e <= MAX, so the checked add can
        // only fail on corrupt state — and then it refuses, never wraps.
        assert_eq!(truncated_stop_ns(0, i64::MAX), Ok(i64::MAX));
        assert_eq!(
            truncated_stop_ns(1, i64::MAX),
            Err(MaximumDurationRefusalReason::EffectiveEndpointUnrepresentable)
        );
        assert_eq!(
            truncated_stop_ns(i64::MAX, 1),
            Err(MaximumDurationRefusalReason::EffectiveEndpointUnrepresentable)
        );
        // b06_t_plus_one_domains: a representable d = T+1 (T = MAX−1,
        // s = MIN, e = −1 → d = MAX) qualifies and truncates to s + T = −2; an
        // unrepresentable span (s = MIN, e = 0) refuses before qualification;
        // and an over-range threshold text is a grammar refusal, not a value.
        assert_eq!(checked_raw_duration_ns(i64::MIN, -1), Ok(Some(i64::MAX)));
        assert!(qualifies(i64::MAX, i64::MAX - 1));
        assert_eq!(truncated_stop_ns(i64::MIN, i64::MAX - 1), Ok(-2));
        assert_eq!(
            checked_raw_duration_ns(i64::MIN, 0),
            Err(MaximumDurationRefusalReason::RawDurationUnrepresentable)
        );
        assert_eq!(
            parse_threshold_ns("9223372036854775808"),
            Err(MaximumDurationRefusalReason::ThresholdMalformed)
        );
    }

    // b06_generic_boundary ----------------------------------------------------

    #[test]
    fn qualification_is_strictly_greater_than_the_threshold() {
        let threshold = 60_000_000_000;
        assert!(!qualifies(threshold - 1, threshold));
        assert!(!qualifies(threshold, threshold), "equality is retained");
        assert!(qualifies(threshold + 1, threshold));
        assert!(!qualifies(0, threshold));
        assert!(
            !qualifies(-1, threshold),
            "a negative span never exceeds a positive threshold"
        );
    }

    // b06_endpoint_subtraction_extremes ---------------------------------------

    #[test]
    fn raw_span_is_evaluated_in_i128_and_refuses_when_it_does_not_fit_i64() {
        assert_eq!(checked_raw_duration_ns(0, 0), Ok(Some(0)));
        assert_eq!(
            checked_raw_duration_ns(10, 3),
            Ok(None),
            "negative span is reported, not repaired"
        );
        assert_eq!(checked_raw_duration_ns(i64::MIN, -1), Ok(Some(i64::MAX)));
        assert_eq!(
            checked_raw_duration_ns(i64::MIN, 0),
            Err(MaximumDurationRefusalReason::RawDurationUnrepresentable)
        );
        assert_eq!(
            checked_raw_duration_ns(i64::MIN, i64::MAX),
            Err(MaximumDurationRefusalReason::RawDurationUnrepresentable)
        );
        assert_eq!(checked_raw_duration_ns(i64::MAX, i64::MIN), Ok(None));
    }

    // b06_legacy_exact_canonicalization ---------------------------------------

    #[test]
    fn legacy_hours_map_to_nanoseconds_exactly_on_the_digit_string() {
        assert_eq!(exact_legacy_hours_to_ns("12"), Ok(12 * HOUR_NS));
        assert_eq!(exact_legacy_hours_to_ns("1.25"), Ok(4_500_000_000_000));
        assert_eq!(exact_legacy_hours_to_ns("0.5"), Ok(1_800_000_000_000));
        assert_eq!(exact_legacy_hours_to_ns("48"), Ok(48 * HOUR_NS));
        assert_eq!(exact_legacy_hours_to_ns("0"), Ok(0));
        // 1.1 h = 3.96e12 ns exactly, but 1.1 is not a binary64 value with a
        // 3.96e12 product; the exact-rational path accepts it while the
        // binary64 mapping check (below) refuses it.
        assert_eq!(exact_legacy_hours_to_ns("1.1"), Ok(3_960_000_000_000));
        assert_eq!(
            exact_legacy_hours_to_ns("0.0000000000001"),
            Err(MaximumDurationRefusalReason::LegacyThresholdNotIntegerNs)
        );
        // i64::MAX / 3.6e12 = 2562047.788… h.
        assert_eq!(
            exact_legacy_hours_to_ns("2562047"),
            Ok(2_562_047 * HOUR_NS),
            "just inside i64"
        );
        assert_eq!(
            exact_legacy_hours_to_ns("2562048"),
            Err(MaximumDurationRefusalReason::LegacyThresholdOverflow)
        );
        for malformed in ["", ".5", "1.", "01", "1.50", "+1", "1e3", "abc"] {
            assert_eq!(
                exact_legacy_hours_to_ns(malformed),
                Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch),
                "{malformed:?}"
            );
        }
    }

    #[test]
    fn legacy_canonicalization_accepts_exact_spellings_and_refuses_each_drift() {
        let request = |hours: &str, ns: &str| MaximumDurationRequest {
            legacy_threshold_hours_canonical: Some(hours.into()),
            legacy_threshold_ns_canonical: Some(ns.into()),
            ..explicit_request("strategy_native", "not_applicable", "strategy_native", None)
        };
        let ok = canonicalize_legacy_threshold(
            &request("1.25", "4500000000000"),
            4_500_000_000_000,
            true,
        )
        .expect("1.25 h is exact");
        assert_eq!(
            (ok.hours_canonical.as_str(), ok.ns_canonical.as_str(), ok.ns),
            ("1.25", "4500000000000", 4_500_000_000_000)
        );

        // 1.1 h: the exact rational is integral but the browser's binary64
        // multiply is not the same integer, so the mapping check refuses.
        assert_eq!(
            canonicalize_legacy_threshold(
                &request("1.1", "3960000000000"),
                3_960_000_000_000,
                true
            ),
            Err(MaximumDurationRefusalReason::LegacyThresholdBinary64MappingMismatch)
        );
        // Non-canonical spelling of the same binary64.
        assert_eq!(
            canonicalize_legacy_threshold(
                &request("1.2500000000000001", "4500000000000"),
                4_500_000_000_000,
                true
            ),
            Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)
        );
        // Companion disagrees with the reparse.
        assert_eq!(
            canonicalize_legacy_threshold(&request("12", "43200000000001"), 12 * HOUR_NS, true),
            Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)
        );
        // Wire `long_duration_threshold_ns` disagrees with the companions.
        assert_eq!(
            canonicalize_legacy_threshold(&request("12", "43200000000000"), 12 * HOUR_NS + 1, true),
            Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)
        );
        // Nonpositive only when the legacy hours are bound.
        assert_eq!(
            canonicalize_legacy_threshold(&request("0", "0"), 0, true),
            Err(MaximumDurationRefusalReason::LegacyThresholdNonpositive)
        );
        assert!(canonicalize_legacy_threshold(&request("0", "0"), 0, false).is_ok());
        assert_eq!(
            canonicalize_legacy_threshold(&request("-1", "-3600000000000"), -HOUR_NS, true),
            Err(MaximumDurationRefusalReason::LegacyThresholdNonpositive)
        );
        // Missing companions.
        let mut missing = request("12", "43200000000000");
        missing.legacy_threshold_ns_canonical = None;
        assert_eq!(
            canonicalize_legacy_threshold(&missing, 12 * HOUR_NS, true),
            Err(MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch)
        );
    }

    #[test]
    fn binary64_canonical_spelling_matches_ecmascript_number_to_string() {
        assert_eq!(
            canonical_legacy_hours_from_binary64_v1(12.0).as_deref(),
            Some("12")
        );
        assert_eq!(
            canonical_legacy_hours_from_binary64_v1(1.25).as_deref(),
            Some("1.25")
        );
        assert_eq!(
            canonical_legacy_hours_from_binary64_v1(0.5).as_deref(),
            Some("0.5")
        );
        assert_eq!(
            canonical_legacy_hours_from_binary64_v1(-0.0).as_deref(),
            Some("0")
        );
        assert_eq!(
            canonical_legacy_hours_from_binary64_v1(0.1 + 0.2).as_deref(),
            Some("0.30000000000000004")
        );
        assert_eq!(canonical_legacy_hours_from_binary64_v1(f64::NAN), None);
        assert_eq!(canonical_legacy_hours_from_binary64_v1(f64::INFINITY), None);
        // Huge but finite: spelled out fully, then refused as overflow.
        let huge = canonical_legacy_hours_from_binary64_v1(1e300).unwrap();
        assert!(!huge.contains('e') && huge.len() == 301);
        assert_eq!(
            exact_legacy_hours_to_ns(&huge),
            Err(MaximumDurationRefusalReason::LegacyThresholdOverflow)
        );
    }

    // b06_presence_default / b06_browser_native_key_mapping shapes ------------

    #[test]
    fn omitted_request_is_the_legacy_baseline_with_no_receipt() {
        let request = MaximumDurationRequest::default();
        assert!(!request.is_explicit());
        let (config, applicability) = resolve_maximum_duration(
            &request,
            EpisodeReconstructionStrategy::FusedMatcher,
            12 * HOUR_NS,
        )
        .unwrap();
        assert_eq!(config, MaximumDurationConfig::omitted());
        assert_eq!(
            applicability.shape,
            MaximumDurationSelectionShape::OmittedLegacy
        );
        assert_eq!(
            applicability.relation,
            MaximumDurationRelation::BaselineNative
        );
        assert_eq!(applicability.legacy_origin, "chronicle_legacy_default_v1");
        assert!(applicability.checked_i128_preflight.is_none());
        assert_eq!(
            build_evidence(std::iter::empty(), &config, &applicability),
            Ok(None)
        );
        assert_eq!(config.row_stage(), MaximumDurationRowStage::omitted());

        // The presence marker alone is still the omitted shape, but the
        // origin is recorded as explicit.
        let marker_only = MaximumDurationRequest {
            long_duration_threshold_explicit: true,
            ..MaximumDurationRequest::default()
        };
        let (config, applicability) = resolve_maximum_duration(
            &marker_only,
            EpisodeReconstructionStrategy::FusedMatcher,
            12 * HOUR_NS,
        )
        .unwrap();
        assert!(!config.explicit);
        assert_eq!(applicability.legacy_origin, "chronicle_legacy_explicit_v1");
    }

    #[test]
    fn exactly_five_selection_shapes_are_legal_and_partial_vectors_are_refused() {
        use EpisodeReconstructionStrategy as S;
        let long = 12 * HOUR_NS;
        let native = explicit_request("strategy_native", "not_applicable", "strategy_native", None);
        let chronicle = explicit_request(
            "chronicle_observed_close_rejection_v1",
            "not_applicable",
            "chronicle_legacy_config",
            None,
        );
        let generic_fixed = generic_request("flag_and_retain", "3600000000000");
        let generic_adaptive = explicit_request(
            "post_reconstruction_strict_max_v1",
            "drop_row",
            "b12_adaptive_participant",
            None,
        );

        let (config, app) =
            resolve_maximum_duration(&native, S::GesisStartStopRepair, long).unwrap();
        assert_eq!(
            app.shape,
            MaximumDurationSelectionShape::ExplicitStrategyNative
        );
        assert_eq!(app.relation, MaximumDurationRelation::BaselineEquivalent);
        assert!(config.explicit && !config.generic_stage_active());
        assert_eq!(app.b06_effective_stage, "none");
        assert_eq!(
            app.reconstruction_native_stage,
            "gesis_fallback_timeout_600s"
        );
        assert_eq!(
            app.checked_i128_preflight.as_deref(),
            Some(B06_CHECKED_I128_PREFLIGHT)
        );

        let (_, app) = resolve_maximum_duration(&chronicle, S::FusedMatcher, long).unwrap();
        assert_eq!(
            app.shape,
            MaximumDurationSelectionShape::ExplicitChronicleRejection
        );
        assert_eq!(app.b06_effective_stage, "native_candidate_admissibility");
        for strategy in S::ALL
            .iter()
            .filter(|&&strategy| strategy != S::FusedMatcher)
        {
            assert_eq!(
                resolve_maximum_duration(&chronicle, *strategy, long).unwrap_err(),
                MaximumDurationRefusalReason::PolicyIncompatibleWithReconstructionStrategy,
                "{}",
                strategy.canonical_id()
            );
            let reported = maximum_duration_applicability(&chronicle, *strategy, long);
            assert!(!reported.is_executable());
            assert_eq!(
                reported.requested_policy,
                MaximumDurationPolicy::ChronicleObservedCloseRejectionV1
            );
        }

        let (config, app) =
            resolve_maximum_duration(&generic_fixed, S::FusedMatcher, long).unwrap();
        assert_eq!(
            app.shape,
            MaximumDurationSelectionShape::ExplicitGenericFixed
        );
        assert_eq!(app.relation, MaximumDurationRelation::ControlledDerivative);
        assert_eq!(
            app.threshold_ns.as_deref(),
            Some(HOUR_NS.to_string().as_str())
        );
        assert!(config.generic_stage_active());
        assert_eq!(config.row_stage().threshold_ns, Some(HOUR_NS));
        assert_eq!(
            app.b06_effective_stage,
            "post_reconstruction_pre_concurrency"
        );

        for strategy in S::ALL {
            assert_eq!(
                resolve_maximum_duration(&generic_adaptive, *strategy, long).unwrap_err(),
                MaximumDurationRefusalReason::AdaptiveMaximumThresholdProviderUnavailable
            );
        }

        // Every other combination of the four keys is refused as a shape (or a
        // malformed threshold when the shape is generic-fixed).
        let policies = [
            None,
            Some("strategy_native"),
            Some("chronicle_observed_close_rejection_v1"),
            Some("post_reconstruction_strict_max_v1"),
            Some("bogus"),
        ];
        let dispositions = [
            None,
            Some("not_applicable"),
            Some("flag_and_retain"),
            Some("retain_but_exclude"),
            Some("truncate_to_threshold"),
            Some("drop_row"),
            Some("bogus"),
        ];
        let sources = [
            None,
            Some("strategy_native"),
            Some("chronicle_legacy_config"),
            Some("fixed_parameter"),
            Some("b12_adaptive_participant"),
            Some("bogus"),
        ];
        let thresholds = [None, Some("3600000000000"), Some("0")];
        let mut legal = 0;
        let mut checked = 0;
        for policy in policies {
            for disposition in dispositions {
                for source in sources {
                    for threshold in thresholds {
                        checked += 1;
                        let outcome = resolve_row_stage(policy, disposition, source, threshold);
                        let explicit = policy.is_some()
                            || disposition.is_some()
                            || source.is_some()
                            || threshold.is_some();
                        if !explicit {
                            assert_eq!(outcome, Ok(MaximumDurationRowStage::omitted()));
                            continue;
                        }
                        let expected_legal = matches!(
                            (policy, disposition, source, threshold),
                            (
                                Some("strategy_native"),
                                Some("not_applicable"),
                                Some("strategy_native"),
                                None
                            ) | (
                                Some("chronicle_observed_close_rejection_v1"),
                                Some("not_applicable"),
                                Some("chronicle_legacy_config"),
                                None
                            ) | (
                                Some("post_reconstruction_strict_max_v1"),
                                Some(
                                    "flag_and_retain"
                                        | "retain_but_exclude"
                                        | "truncate_to_threshold"
                                        | "drop_row"
                                ),
                                Some("fixed_parameter"),
                                Some("3600000000000")
                            ) | (
                                Some("post_reconstruction_strict_max_v1"),
                                Some(
                                    "flag_and_retain"
                                        | "retain_but_exclude"
                                        | "truncate_to_threshold"
                                        | "drop_row"
                                ),
                                Some("b12_adaptive_participant"),
                                None
                            )
                        );
                        match outcome {
                            Ok(stage) => {
                                assert!(expected_legal, "{policy:?}/{disposition:?}/{source:?}/{threshold:?} must be refused");
                                assert!(stage.explicit);
                                legal += 1;
                            }
                            Err(reason) => {
                                assert!(!expected_legal, "{policy:?}/{disposition:?}/{source:?}/{threshold:?} must be legal, got {reason:?}");
                                assert!(
                                    matches!(
                                        reason,
                                        MaximumDurationRefusalReason::RequestShapeInvalid
                                            | MaximumDurationRefusalReason::ThresholdMalformed
                                    ),
                                    "{reason:?}"
                                );
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(checked, 5 * 7 * 6 * 3);
        // 1 native + 1 chronicle + 4 dispositions × (fixed "3600000000000" + adaptive)
        assert_eq!(legal, 2 + 4 * 2);
    }

    /// An applicability refusal reports the shape the researcher selected.
    ///
    /// Reporting `omitted_legacy` for an explicit selection is not a cosmetic
    /// slip: the browser rejects that combination outright
    /// (`rustPipelineRuntime.ts`, "explicit request resolved to the omitted
    /// shape"), so a refusal that erased its shape surfaced as a contract
    /// violation instead of the typed refusal the researcher must see. Only a
    /// malformed vector — which never resolved to a shape — reports the
    /// omitted one.
    #[test]
    fn applicability_refusals_report_the_selected_shape_not_the_omitted_one() {
        use EpisodeReconstructionStrategy as S;
        let long = 12 * HOUR_NS;
        let chronicle = explicit_request(
            "chronicle_observed_close_rejection_v1",
            "not_applicable",
            "chronicle_legacy_config",
            None,
        );
        for strategy in S::ALL
            .iter()
            .filter(|&&strategy| strategy != S::FusedMatcher)
        {
            let reported = maximum_duration_applicability(&chronicle, *strategy, long);
            assert_eq!(
                reported.shape,
                MaximumDurationSelectionShape::ExplicitChronicleRejection,
                "{}",
                strategy.canonical_id()
            );
            assert_eq!(
                reported.refusal_reason,
                Some(MaximumDurationRefusalReason::PolicyIncompatibleWithReconstructionStrategy)
            );
            assert_eq!(reported.relation, MaximumDurationRelation::Refused);
            assert!(reported.effective_policy.is_none());
        }

        let adaptive = explicit_request(
            "post_reconstruction_strict_max_v1",
            "truncate_to_threshold",
            "b12_adaptive_participant",
            None,
        );
        for strategy in S::ALL {
            let reported = maximum_duration_applicability(&adaptive, *strategy, long);
            assert_eq!(
                reported.shape,
                MaximumDurationSelectionShape::ExplicitGenericAdaptive,
                "{}",
                strategy.canonical_id()
            );
            assert_eq!(
                reported.refusal_reason,
                Some(MaximumDurationRefusalReason::AdaptiveMaximumThresholdProviderUnavailable)
            );
            assert_eq!(
                reported.disposition,
                MaximumDurationDisposition::TruncateToThreshold
            );
            assert_eq!(
                reported.threshold_source,
                MaximumDurationThresholdSource::B12AdaptiveParticipant
            );
            // Adaptive binds no threshold, so none is fabricated.
            assert!(reported.threshold_ns.is_none());
        }

        // A malformed vector never resolved to a shape, so it keeps reporting
        // the omitted one, and execution still refuses it as an error.
        let malformed = explicit_request(
            "post_reconstruction_strict_max_v1",
            "not_applicable",
            "fixed_parameter",
            None,
        );
        let reported = maximum_duration_applicability(&malformed, S::FusedMatcher, long);
        assert_eq!(reported.shape, MaximumDurationSelectionShape::OmittedLegacy);
        assert_eq!(
            reported.refusal_reason,
            Some(MaximumDurationRefusalReason::RequestShapeInvalid)
        );
        assert_eq!(
            resolve_maximum_duration(&malformed, S::FusedMatcher, long).unwrap_err(),
            MaximumDurationRefusalReason::RequestShapeInvalid
        );
    }

    #[test]
    fn refusal_ids_are_the_prefixed_canonical_ids_the_browser_decodes() {
        for reason in [
            MaximumDurationRefusalReason::RequestShapeInvalid,
            MaximumDurationRefusalReason::ThresholdMalformed,
            MaximumDurationRefusalReason::PolicyIncompatibleWithReconstructionStrategy,
            MaximumDurationRefusalReason::LegacyThresholdNonpositive,
            MaximumDurationRefusalReason::LegacyThresholdNotIntegerNs,
            MaximumDurationRefusalReason::LegacyThresholdOverflow,
            MaximumDurationRefusalReason::LegacyThresholdBinary64MappingMismatch,
            MaximumDurationRefusalReason::LegacyThresholdCanonicalizationMismatch,
            MaximumDurationRefusalReason::RawDurationUnrepresentable,
            MaximumDurationRefusalReason::EffectiveEndpointUnrepresentable,
            MaximumDurationRefusalReason::DuplicateTimestampAdjustmentUnrepresentable,
        ] {
            let serde_id = serde_json::to_value(reason).unwrap();
            let serde_id = serde_id.as_str().unwrap();
            assert_eq!(
                reason.canonical_id(),
                format!("maximum_duration_{serde_id}")
            );
            assert_eq!(
                reason.execution_error(),
                format!("pipeline_refused:b06={}", reason.canonical_id())
            );
        }
        // The one id shared with the B12 joint contract keeps its own name.
        assert_eq!(
            MaximumDurationRefusalReason::AdaptiveMaximumThresholdProviderUnavailable
                .canonical_id(),
            "adaptive_maximum_threshold_provider_unavailable"
        );
    }

    // b06_generic_disposition_fanout / b06_conservation / b06_drop_lineage -----

    fn episode<'a>(
        start_ns: i64,
        stop_ns: Option<i64>,
        ranges: &'a [SourceDataRowRange],
    ) -> MaximumDurationEpisodeInput<'a> {
        MaximumDurationEpisodeInput {
            participant_id: "P01",
            app_package_name: "com.example.chat",
            source_data_row_ranges: ranges,
            raw_start_timestamp_ns: start_ns,
            raw_stop_timestamp_ns: stop_ns,
            raw_duration_ns: stop_ns.map(|stop| stop - start_ns),
        }
    }

    fn evidence_for(disposition: &str, threshold_ns: i64) -> MaximumDurationEvidence {
        let request = generic_request(disposition, &threshold_ns.to_string());
        let (config, applicability) = resolve_maximum_duration(
            &request,
            EpisodeReconstructionStrategy::FusedMatcher,
            12 * HOUR_NS,
        )
        .unwrap();
        let ranges = [SourceDataRowRange { first: 1, last: 2 }];
        // T-1, T, T+1, 2T+7 (two qualifying), one unbounded.
        let episodes = [
            episode(0, Some(threshold_ns - 1), &ranges),
            episode(1_000, Some(1_000 + threshold_ns), &ranges),
            episode(2_000, Some(2_000 + threshold_ns + 1), &ranges),
            episode(3_000, Some(3_000 + 2 * threshold_ns + 7), &ranges),
            episode(4_000, None, &ranges),
        ];
        let evidence = build_evidence(episodes, &config, &applicability)
            .unwrap()
            .expect("explicit selections publish a receipt");
        validate_evidence(&evidence).expect("freshly built evidence validates");
        evidence
    }

    #[test]
    fn every_generic_disposition_conserves_raw_duration_and_records_lineage_exactly() {
        let threshold_ns = 60_000_000_000;
        let raw_total: i128 = (threshold_ns - 1) as i128
            + threshold_ns as i128
            + (threshold_ns + 1) as i128
            + (2 * threshold_ns + 7) as i128;
        let not_qualified: i128 = (threshold_ns - 1) as i128 + threshold_ns as i128;
        let qualifying: i128 = (threshold_ns + 1) as i128 + (2 * threshold_ns + 7) as i128;
        let parse = |value: &str| value.parse::<i128>().unwrap();
        let mut receipts = Vec::new();
        for disposition in [
            "flag_and_retain",
            "retain_but_exclude",
            "truncate_to_threshold",
            "drop_row",
        ] {
            let evidence = evidence_for(disposition, threshold_ns);
            let receipt = &evidence.receipt;
            assert_eq!(receipt.bounded_episode_count, 4, "{disposition}");
            assert_eq!(receipt.unbounded_episode_count, 1, "{disposition}");
            assert_eq!(
                receipt.qualifying_count, 2,
                "{disposition}: strict > qualifies T+1 but not T"
            );
            assert_eq!(
                receipt.outcome_counts.get("bounded_not_qualified"),
                Some(&2)
            );
            assert_eq!(receipt.outcome_counts.get("unbounded_no_action"), Some(&1));
            assert_eq!(
                parse(&receipt.raw_duration_total_ns),
                raw_total,
                "{disposition}"
            );
            let effective = parse(&receipt.effective_duration_total_ns);
            let trimmed = parse(&receipt.trimmed_total_ns);
            let dropped = parse(&receipt.dropped_raw_total_ns);
            let headline = parse(&receipt.headline_credited_total_ns);
            assert_eq!(
                effective + trimmed + dropped,
                raw_total,
                "{disposition}: conservation"
            );
            match disposition {
                "flag_and_retain" => {
                    assert_eq!(receipt.outcome_counts.get("flagged_retained"), Some(&2));
                    assert_eq!(
                        (effective, trimmed, dropped, headline),
                        (raw_total, 0, 0, raw_total)
                    );
                    assert!(
                        evidence.excluded_episodes.is_empty(),
                        "flagging records no lineage"
                    );
                }
                "retain_but_exclude" => {
                    assert_eq!(receipt.outcome_counts.get("retained_excluded"), Some(&2));
                    assert_eq!(
                        (effective, trimmed, dropped, headline),
                        (raw_total, 0, 0, not_qualified)
                    );
                    assert_eq!(evidence.excluded_episodes.len(), 2);
                    assert!(evidence
                        .excluded_episodes
                        .iter()
                        .all(|row| row.trimmed_ns == 0
                            && row.effective_duration_ns == Some(row.raw_duration_ns)));
                }
                "truncate_to_threshold" => {
                    assert_eq!(receipt.outcome_counts.get("truncated"), Some(&2));
                    let expected_trim = qualifying - 2 * threshold_ns as i128;
                    assert_eq!(
                        (effective, trimmed, dropped),
                        (raw_total - expected_trim, expected_trim, 0)
                    );
                    assert_eq!(headline, effective);
                    assert_eq!(evidence.excluded_episodes.len(), 2);
                    for row in &evidence.excluded_episodes {
                        assert_eq!(
                            row.effective_stop_timestamp_ns,
                            Some(row.raw_start_timestamp_ns + threshold_ns)
                        );
                        assert_eq!(row.effective_duration_ns, Some(threshold_ns));
                        assert_eq!(row.trimmed_ns, row.raw_duration_ns - threshold_ns);
                        assert_eq!(row.outcome, MaximumDurationRowOutcome::Truncated);
                    }
                }
                "drop_row" => {
                    assert_eq!(receipt.outcome_counts.get("dropped"), Some(&2));
                    assert_eq!(
                        (effective, trimmed, dropped, headline),
                        (not_qualified, 0, qualifying, not_qualified)
                    );
                    assert_eq!(evidence.excluded_episodes.len(), 2);
                    assert!(evidence.excluded_episodes.iter().all(|row| row
                        .effective_stop_timestamp_ns
                        .is_none()
                        && row.effective_duration_ns.is_none()
                        && row.trimmed_ns == row.raw_duration_ns));
                }
                _ => unreachable!(),
            }
            // Lineage rows are sorted canonically and carry the raw bounds.
            let starts: Vec<i64> = evidence
                .excluded_episodes
                .iter()
                .map(|row| row.raw_start_timestamp_ns)
                .collect();
            let mut sorted = starts.clone();
            sorted.sort_unstable();
            assert_eq!(starts, sorted);
            receipts.push(receipt.clone());
        }
        // The four dispositions are distinguishable by receipt alone.
        let digests: std::collections::BTreeSet<String> = receipts
            .iter()
            .map(|receipt| serde_json::to_string(receipt).unwrap())
            .collect();
        assert_eq!(digests.len(), 4);
    }

    #[test]
    fn evidence_validation_rejects_reordered_lineage_and_a_stale_digest() {
        let evidence = evidence_for("truncate_to_threshold", 60_000_000_000);
        let mut reordered = evidence.clone();
        reordered.excluded_episodes.reverse();
        assert_eq!(
            validate_evidence(&reordered),
            Err("maximum_duration_noncanonical_lineage_order".into())
        );
        let mut tampered = evidence.clone();
        tampered.excluded_episodes[0].trimmed_ns += 1;
        assert_eq!(
            validate_evidence(&tampered),
            Err("maximum_duration_lineage_digest_mismatch".into())
        );
        let mut miscounted = evidence.clone();
        miscounted.receipt.qualifying_count += 1;
        // Counts that do not touch the outcome table still validate
        // structurally; a census-bearing validator catches them.
        assert!(validate_evidence(&miscounted).is_ok());
        let mut missing_outcome = evidence;
        missing_outcome.receipt.outcome_counts.remove("truncated");
        assert_eq!(
            validate_evidence(&missing_outcome),
            Err("maximum_duration_outcome_count_mismatch".into())
        );
    }

    #[test]
    fn native_shapes_publish_a_receipt_that_owns_no_row() {
        let request =
            explicit_request("strategy_native", "not_applicable", "strategy_native", None);
        let (config, applicability) = resolve_maximum_duration(
            &request,
            EpisodeReconstructionStrategy::GesisStartStopRepair,
            12 * HOUR_NS,
        )
        .unwrap();
        let ranges = [SourceDataRowRange { first: 1, last: 1 }];
        let episodes = [
            episode(0, Some(13 * HOUR_NS), &ranges),
            episode(1, None, &ranges),
        ];
        let evidence = build_evidence(episodes, &config, &applicability)
            .unwrap()
            .unwrap();
        validate_evidence(&evidence).unwrap();
        assert_eq!(
            evidence.receipt.outcome_counts.get("native_policy_owned"),
            Some(&1)
        );
        assert_eq!(
            evidence.receipt.outcome_counts.get("unbounded_no_action"),
            Some(&1)
        );
        assert_eq!(
            evidence.receipt.qualifying_count, 0,
            "a 13 h episode is not B06's to qualify"
        );
        assert_eq!(
            evidence.receipt.headline_credited_total_ns,
            (13 * HOUR_NS).to_string()
        );
        assert!(evidence.excluded_episodes.is_empty());
    }
}

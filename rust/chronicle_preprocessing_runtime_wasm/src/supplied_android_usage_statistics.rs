//! Five source-located reductions of explicitly supplied Android memberships.
//! No event/window/category reconstruction, annotation, resampling or model runs.
//! Primary passages: Caught text231:342–368; Regret text225:696–718;
//! S3 sensors-21-03765-layout:692–697; MapOnTap zingaro:2524–2537;
//! Bjerre official rendered supplement pp0–1:20–30 (locator receipt, not PDF bytes).

use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::grouped_distinct_count::count_distinct_members_by_group;
use crate::grouped_scalar_sum_projection::{
    grouped_scalar_sum_then_project_unique, GroupedScalarInput, RCompatibleScalar,
    SequentialDivisionConfiguration,
};
use crate::grouped_unique_mode::unique_mode_by_group;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

pub struct SuppliedUsageCsv {
    pub csv_bytes: Vec<u8>,
    pub row_count: usize,
}

pub const CAUGHT_FIELDS: &[&str] = &[
    "participant_id",
    "device_id",
    "window_id",
    "previous_completed_response_id",
    "next_completed_response_id",
    "clock_id",
    "feature_stream",
    "input_unit",
    "exposure_hours",
    "membership_qualification",
    "inventory_complete",
    "members_json",
];
pub const REGRET_FIELDS: &[&str] = &[
    "participant_id",
    "device_id",
    "app_session_id",
    "app_id",
    "label_inventory_id",
    "membership_qualification",
    "inventory_complete",
    "screenshots_json",
];
pub const S3_FIELDS: &[&str] = &[
    "participant_id",
    "device_id",
    "window_id",
    "clock_id",
    "window_kind",
    "statistic",
    "membership_qualification",
    "inventory_complete",
    "app_occurrences_json",
];
pub const MAPONTAP_FIELDS: &[&str] = &[
    "participant_id",
    "device_id",
    "app_session_id",
    "series_id",
    "clock_id",
    "input_unit",
    "membership_qualification",
    "inventory_complete",
    "timestamps_json",
];
pub const BJERRE_FIELDS: &[&str] = &[
    "participant_id",
    "device_id",
    "class_inventory_id",
    "clock_id",
    "membership_qualification",
    "inventory_complete",
    "courses_json",
];

// This is only CSV transport validation for these five existing component routes.
// Original columns and lexical identifiers are retained, including extra context.
fn input_rows(
    input: &[u8],
    required: &[&str],
    outputs: &[&str],
) -> Result<(csv::StringRecord, Vec<csv::StringRecord>), String> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(input);
    let headers = reader
        .headers()
        .map_err(|e| format!("supplied usage header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
        || outputs
            .iter()
            .any(|field| headers.iter().any(|h| h == *field))
    {
        return Err("supplied usage refuses duplicate or reserved output columns".into());
    }
    for field in required {
        if !headers.iter().any(|h| h == *field) {
            return Err(format!("supplied usage requires {field}"));
        }
    }
    let rows = reader
        .records()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("supplied usage row: {e}"))?;
    if rows.is_empty() {
        return Err("supplied usage requires an explicit inventory row".into());
    }
    Ok((headers, rows))
}

fn field<'a>(headers: &csv::StringRecord, row: &'a csv::StringRecord, name: &str) -> &'a str {
    &row[headers
        .iter()
        .position(|h| h == name)
        .expect("required header checked")]
}

fn nonblank(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("supplied usage requires nonblank {name}"))
    } else {
        Ok(())
    }
}

fn qualify(
    headers: &csv::StringRecord,
    row: &csv::StringRecord,
    identities: &[&str],
    qualification: &str,
) -> Result<(), String> {
    for name in identities {
        nonblank(field(headers, row, name), name)?;
    }
    if field(headers, row, "inventory_complete") != "true"
        || field(headers, row, "membership_qualification") != qualification
    {
        return Err(format!(
            "supplied usage requires complete {qualification}; no membership is inferred"
        ));
    }
    Ok(())
}

fn json_members<T: DeserializeOwned>(text: &str, name: &str) -> Result<T, String> {
    serde_json::from_str(text).map_err(|e| format!("invalid {name}: {e}"))
}

fn scalar(text: &str, name: &str, positive: bool) -> Result<f64, String> {
    let value = text
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && if positive { *v > 0.0 } else { *v >= 0.0 });
    value.ok_or_else(|| {
        format!(
            "{name} requires finite {} value",
            if positive { "positive" } else { "nonnegative" }
        )
    })
}

fn writer(headers: &csv::StringRecord, outputs: &[&str]) -> Result<csv::Writer<Vec<u8>>, String> {
    let mut headers = headers.clone();
    for output in outputs {
        headers.push_field(output);
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(&headers)
        .map_err(|e| format!("supplied usage output header: {e}"))?;
    Ok(writer)
}

fn finish(writer: csv::Writer<Vec<u8>>, row_count: usize) -> Result<SuppliedUsageCsv, String> {
    Ok(SuppliedUsageCsv {
        csv_bytes: writer
            .into_inner()
            .map_err(|e| format!("supplied usage output: {e}"))?,
        row_count,
    })
}

fn emit(
    writer: &mut csv::Writer<Vec<u8>>,
    mut row: csv::StringRecord,
    values: &[String],
) -> Result<(), String> {
    for value in values {
        row.push_field(value);
    }
    writer
        .write_record(&row)
        .map_err(|e| format!("supplied usage output row: {e}"))
}

// Complete finite inputs qualify the R-compatible shared sum; NA/Inf conventions
// of other callers are not borrowed. A real supplied empty inventory has sum0.
fn sum_divide(values: &[f64], divisor: f64) -> Result<(Option<f64>, Option<f64>), String> {
    let rows = values
        .iter()
        .copied()
        .chain(values.is_empty().then_some(0.0))
        .map(|value| GroupedScalarInput {
            entity: (),
            raw_partition: (),
            passthrough: (),
            value: RCompatibleScalar::Finite(value),
        })
        .collect::<Vec<_>>();
    let reduced = grouped_scalar_sum_then_project_unique(
        &rows,
        SequentialDivisionConfiguration {
            first_divisor: divisor,
            second_divisor: 1.0,
        },
        |_| Some(()),
    )
    .map_err(|e| format!("supplied usage sum/division: {e}"))?;
    let finite = |value| match value {
        RCompatibleScalar::Finite(v) => Some(v),
        _ => None,
    };
    let sum = finite(reduced[0].sum);
    let scaled = finite(reduced[0].first_scaled_value)
        .filter(|v| !(*v == 0.0 && sum.is_some_and(|sum| sum != 0.0)));
    Ok((sum, scaled))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DurationMember {
    occurrence_id: String,
    duration: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationMember {
    occurrence_id: String,
}

pub fn execute_caught_csv(
    input: &[u8],
    selected_streams: &BTreeSet<&str>,
    normalize: bool,
) -> Result<SuppliedUsageCsv, String> {
    let outputs = [
        "usage_numerator",
        "numerator_status",
        "per_hour_value",
        "normalization_status",
        "computation_reason",
        "output_unit_relation",
    ];
    let (headers, rows) = input_rows(input, CAUGHT_FIELDS, &outputs)?;
    let count = rows.len();
    let mut output = writer(&headers, &outputs)?;
    let mut seen = BTreeSet::new();
    let mut windows = BTreeMap::new();
    for row in rows {
        let get = |name| field(&headers, &row, name);
        qualify(
            &headers,
            &row,
            &[
                "participant_id",
                "device_id",
                "window_id",
                "previous_completed_response_id",
                "next_completed_response_id",
                "clock_id",
                "input_unit",
            ],
            "source_qualified_completed_response_window",
        )?;
        if get("previous_completed_response_id") == get("next_completed_response_id") {
            return Err(
                "completed-response window requires distinct previous/next response identities"
                    .into(),
            );
        }
        let hours = scalar(get("exposure_hours"), "exposure_hours", true)?;
        let stream = get("feature_stream");
        if !matches!(
            stream,
            "total"
                | "social_media"
                | "messengers"
                | "video_streaming"
                | "browsers"
                | "games"
                | "notifications"
        ) || !selected_streams.contains(stream)
        {
            return Err("Caught supplied usage requires an exactly bound duration/notification feature_stream".into());
        }
        let owner = (
            get("participant_id").to_owned(),
            get("device_id").to_owned(),
            get("window_id").to_owned(),
        );
        let window = (
            get("previous_completed_response_id").to_owned(),
            get("next_completed_response_id").to_owned(),
            get("clock_id").to_owned(),
            hours,
        );
        if windows.get(&owner).is_some_and(|prior| prior != &window) {
            return Err(
                "Caught window identities require consistent response pair, clock and exposure"
                    .into(),
            );
        }
        windows.insert(owner.clone(), window);
        if !seen.insert((owner, stream.to_owned())) {
            return Err("Caught supplied usage refuses duplicate participant/device/window/feature inventory".into());
        }
        let mut ids = BTreeSet::new();
        let numerator = if stream == "notifications" {
            if get("input_unit") != "count" {
                return Err("notifications require count input_unit".into());
            }
            let members: Vec<NotificationMember> =
                json_members(get("members_json"), "members_json")?;
            for member in &members {
                nonblank(&member.occurrence_id, "occurrence_id")?;
                if !ids.insert(&member.occurrence_id) {
                    return Err("duplicate notification occurrence_id".into());
                }
            }
            let counts = count_categories_by_group(members.iter().map(|_| ((), ())));
            counts
                .first()
                .map_or(0.0, |count| count.observation_count as f64)
        } else {
            let members: Vec<DurationMember> = json_members(get("members_json"), "members_json")?;
            for member in &members {
                nonblank(&member.occurrence_id, "occurrence_id")?;
                if !ids.insert(&member.occurrence_id) {
                    return Err(
                        "duplicate application occurrence_id within supplied feature inventory"
                            .into(),
                    );
                }
                if !member.duration.is_finite() || member.duration < 0.0 {
                    return Err(
                        "application duration requires finite nonnegative supplied scalar".into(),
                    );
                }
            }
            let values = members.iter().map(|m| m.duration).collect::<Vec<_>>();
            sum_divide(&values, 1.0)?.0.unwrap_or(f64::INFINITY)
        };
        let numerator_finite = numerator.is_finite();
        let normalized = if normalize && numerator_finite {
            sum_divide(&[numerator], hours)?.1
        } else {
            None
        };
        let status = if !normalize {
            "not_selected"
        } else if normalized.is_some() {
            "computed"
        } else {
            "arithmetic_unavailable"
        };
        let reason = if !numerator_finite {
            "nonfinite_sum"
        } else if normalize && normalized.is_none() {
            "nonfinite_or_underflow_division"
        } else {
            ""
        };
        let values = [
            if numerator_finite {
                numerator.to_string()
            } else {
                String::new()
            },
            if numerator_finite {
                "computed"
            } else {
                "arithmetic_unavailable"
            }
            .into(),
            normalized.map(|v| v.to_string()).unwrap_or_default(),
            status.into(),
            reason.into(),
            if normalize {
                "input_unit_per_hour"
            } else {
                "input_unit"
            }
            .into(),
        ];
        emit(&mut output, row, &values)?;
    }
    finish(output, count)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScreenshotLabel {
    screenshot_id: String,
    activity: String,
}

pub fn execute_regret_csv(input: &[u8]) -> Result<SuppliedUsageCsv, String> {
    let outputs = [
        "session_activity",
        "activity_frequency",
        "screenshot_count",
        "computation_status",
        "computation_reason",
    ];
    let (headers, rows) = input_rows(input, REGRET_FIELDS, &outputs)?;
    let count = rows.len();
    let mut output = writer(&headers, &outputs)?;
    let mut seen = BTreeSet::new();
    for row in rows {
        let get = |name| field(&headers, &row, name);
        qualify(
            &headers,
            &row,
            &[
                "participant_id",
                "device_id",
                "app_session_id",
                "app_id",
                "label_inventory_id",
            ],
            "source_qualified_screenshot_activity_membership",
        )?;
        if !seen.insert((
            get("participant_id").to_owned(),
            get("device_id").to_owned(),
            get("app_session_id").to_owned(),
        )) {
            return Err("Regret refuses duplicate supplied app-session inventories".into());
        }
        let members: Vec<ScreenshotLabel> =
            json_members(get("screenshots_json"), "screenshots_json")?;
        let mut ids = BTreeSet::new();
        for member in &members {
            nonblank(&member.screenshot_id, "screenshot_id")?;
            if !ids.insert(&member.screenshot_id) {
                return Err("duplicate screenshot_id within supplied app session".into());
            }
            if !matches!(
                member.activity.as_str(),
                "Communication"
                    | "Search"
                    | "View_Recommendation"
                    | "View_Subscription"
                    | "View_Shared"
                    | "View_Comments"
                    | "Other"
            ) {
                return Err(
                    "Regret requires one of the seven supplied source activity labels".into(),
                );
            }
        }
        let mode = unique_mode_by_group(members.iter().map(|m| ((), m.activity.as_str())));
        let (activity, frequency, status, reason) = match mode {
            Ok(modes) if !modes.is_empty() => (
                modes[0].category.to_owned(),
                modes[0].frequency.to_string(),
                "computed",
                "",
            ),
            Ok(_) => (
                String::new(),
                String::new(),
                "source_undefined",
                "empty_activity_membership",
            ),
            Err(_) => (
                String::new(),
                String::new(),
                "source_undefined",
                "tied_most_prevalent_activity",
            ),
        };
        let values = [
            activity,
            frequency,
            members.len().to_string(),
            status.into(),
            reason.into(),
        ];
        emit(&mut output, row, &values)?;
    }
    finish(output, count)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppOccurrence {
    occurrence_id: String,
    app_id: String,
}

pub fn execute_s3_csv(input: &[u8], selected: &BTreeSet<&str>) -> Result<SuppliedUsageCsv, String> {
    let outputs = [
        "app_statistic_value",
        "most_common_app_id",
        "computation_status",
        "computation_reason",
        "output_unit_relation",
    ];
    let (headers, rows) = input_rows(input, S3_FIELDS, &outputs)?;
    let count = rows.len();
    let mut output = writer(&headers, &outputs)?;
    let mut seen = BTreeSet::new();
    let mut inventories = BTreeMap::new();
    for row in rows {
        let get = |name| field(&headers, &row, name);
        qualify(
            &headers,
            &row,
            &["participant_id", "device_id", "window_id", "clock_id"],
            "source_qualified_foreground_app_window",
        )?;
        let statistic = get("statistic");
        if !matches!(
            statistic,
            "statistics.total_apps_minute"
                | "statistics.distinct_apps_minute"
                | "statistics.common_app_minute"
                | "statistics.common_app_minute_count"
                | "statistics.total_apps_day"
                | "statistics.distinct_apps_day"
                | "statistics.common_app_day"
                | "statistics.common_app_day_count"
        ) || !selected.contains(statistic)
        {
            return Err("S3 statistic requires its exact selected source binding".into());
        }
        let minute = statistic.contains("minute");
        if get("window_kind") != if minute { "last_minute" } else { "last_day" } {
            return Err(
                "S3 statistic requires the corresponding supplied minute/day membership".into(),
            );
        }
        let owner = (
            get("participant_id").to_owned(),
            get("device_id").to_owned(),
            get("window_id").to_owned(),
            get("window_kind").to_owned(),
        );
        if !seen.insert((owner.clone(), statistic.to_owned())) {
            return Err("S3 refuses duplicate supplied window/statistic inventory".into());
        }
        let members: Vec<AppOccurrence> =
            json_members(get("app_occurrences_json"), "app_occurrences_json")?;
        let mut ids = BTreeSet::new();
        for member in &members {
            nonblank(&member.occurrence_id, "occurrence_id")?;
            nonblank(&member.app_id, "app_id")?;
            if !ids.insert(&member.occurrence_id) {
                return Err("duplicate app occurrence_id within supplied window".into());
            }
        }
        let inventory = (
            get("clock_id").to_owned(),
            members
                .iter()
                .map(|m| (m.occurrence_id.clone(), m.app_id.clone()))
                .collect::<BTreeSet<_>>(),
        );
        if inventories
            .get(&owner)
            .is_some_and(|prior| prior != &inventory)
        {
            return Err(
                "S3 requires one consistent occurrence inventory and clock per supplied window"
                    .into(),
            );
        }
        inventories.insert(owner, inventory);
        let (number, app, status, reason) = if statistic.starts_with("statistics.total_apps_") {
            let counts = count_categories_by_group(members.iter().map(|_| ((), ())));
            (
                counts
                    .first()
                    .map_or(0, |c| c.observation_count)
                    .to_string(),
                String::new(),
                "computed",
                "",
            )
        } else if statistic.starts_with("statistics.distinct_apps_") {
            let counts =
                count_distinct_members_by_group(members.iter().map(|m| ((), m.app_id.as_str())));
            (
                counts
                    .first()
                    .map_or(0, |c| c.distinct_member_count)
                    .to_string(),
                String::new(),
                "computed",
                "",
            )
        } else {
            match unique_mode_by_group(members.iter().map(|m| ((), m.app_id.as_str()))) {
                Ok(modes) if !modes.is_empty() => (
                    if statistic.ends_with("_count") {
                        modes[0].frequency.to_string()
                    } else {
                        String::new()
                    },
                    modes[0].category.to_owned(),
                    "computed",
                    "",
                ),
                Ok(_) => (
                    String::new(),
                    String::new(),
                    "source_undefined",
                    "empty_app_membership",
                ),
                Err(_) => (
                    String::new(),
                    String::new(),
                    "source_undefined",
                    "tied_most_common_app",
                ),
            }
        };
        let values = [
            number,
            app,
            status.into(),
            reason.into(),
            "count_or_app_identity".into(),
        ];
        emit(&mut output, row, &values)?;
    }
    finish(output, count)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimestampSample {
    sample_id: String,
    timestamp: f64,
}

pub fn execute_mapontap_csv(input: &[u8]) -> Result<SuppliedUsageCsv, String> {
    let outputs = [
        "normalized_timestamps_json",
        "computation_status",
        "computation_reason",
        "output_unit_relation",
    ];
    let (headers, rows) = input_rows(input, MAPONTAP_FIELDS, &outputs)?;
    let count = rows.len();
    let mut output = writer(&headers, &outputs)?;
    let mut seen = BTreeSet::new();
    for row in rows {
        let get = |name| field(&headers, &row, name);
        qualify(
            &headers,
            &row,
            &[
                "participant_id",
                "device_id",
                "app_session_id",
                "series_id",
                "clock_id",
                "input_unit",
            ],
            "source_qualified_timestamp_series",
        )?;
        if !seen.insert((
            get("participant_id").to_owned(),
            get("device_id").to_owned(),
            get("app_session_id").to_owned(),
            get("series_id").to_owned(),
        )) {
            return Err("MapOnTap refuses duplicate supplied series inventories".into());
        }
        let samples: Vec<TimestampSample> =
            json_members(get("timestamps_json"), "timestamps_json")?;
        if samples.is_empty() {
            return Err(
                "MapOnTap timestamp normalization requires nonempty supplied series".into(),
            );
        }
        let mut ids = BTreeSet::new();
        for sample in &samples {
            nonblank(&sample.sample_id, "sample_id")?;
            if !ids.insert(&sample.sample_id) {
                return Err("duplicate timestamp sample_id within supplied series".into());
            }
            if !sample.timestamp.is_finite() {
                return Err("MapOnTap requires finite supplied timestamps".into());
            }
        }
        // Same finite min/max formula, without AUToSen source identity, five-second
        // membership, sensor dimensions or input-unit conversion.
        let normalized = crate::prepared_sensor_window::normalize_autosen_dimension(
            &samples.iter().map(|s| s.timestamp).collect::<Vec<_>>(),
        )?;
        let values = samples.iter().zip(&normalized).map(|(sample, result)| json!({
            "sample_id":sample.sample_id,"value":result.value,"status":result.status,"reason":result.reason,
        })).collect::<Vec<_>>();
        let all_computed = normalized.iter().all(|n| n.status == "computed");
        let fields = [
            serde_json::to_string(&values).map_err(|e| e.to_string())?,
            if all_computed {
                "computed"
            } else {
                "contains_unavailable_samples"
            }
            .into(),
            if all_computed {
                ""
            } else {
                "see_per_sample_status"
            }
            .into(),
            "dimensionless".into(),
        ];
        emit(&mut output, row, &fields)?;
    }
    finish(output, count)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassOverlap {
    session_id: String,
    overlap_id: String,
    original_duration_seconds: f64,
    overlap_seconds: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CourseInventory {
    course_id: String,
    class_exposure_seconds: f64,
    overlaps: Vec<ClassOverlap>,
}

pub fn execute_bjerre_csv(input: &[u8], aggregate: bool) -> Result<SuppliedUsageCsv, String> {
    let outputs = [
        "long_session_eligibility_json",
        "course_percentages_json",
        "mean_course_percent",
        "computation_status",
        "computation_reason",
        "output_unit_relation",
    ];
    let (headers, rows) = input_rows(input, BJERRE_FIELDS, &outputs)?;
    let count = rows.len();
    let mut output = writer(&headers, &outputs)?;
    let mut seen = BTreeSet::new();
    for row in rows {
        let get = |name| field(&headers, &row, name);
        qualify(
            &headers,
            &row,
            &[
                "participant_id",
                "device_id",
                "class_inventory_id",
                "clock_id",
            ],
            "source_qualified_disjoint_class_overlap_inventory",
        )?;
        if !seen.insert((
            get("participant_id").to_owned(),
            get("device_id").to_owned(),
        )) {
            return Err("Bjerre refuses duplicate participant/device course inventories".into());
        }
        let courses: Vec<CourseInventory> = json_members(get("courses_json"), "courses_json")?;
        if courses.is_empty() {
            return Err("Bjerre requires nonempty supplied course membership".into());
        }
        let mut course_ids = BTreeSet::new();
        let mut session_durations = BTreeMap::new();
        let mut eligibility = Vec::new();
        let mut percentages = Vec::new();
        let mut complete_percentages = Vec::new();
        for course in &courses {
            nonblank(&course.course_id, "course_id")?;
            if !course_ids.insert(&course.course_id) {
                return Err("duplicate supplied course_id".into());
            }
            if !course.class_exposure_seconds.is_finite() || course.class_exposure_seconds <= 0.0 {
                return Err("class_exposure_seconds requires positive finite supplied class-time denominator".into());
            }
            let mut overlap_ids = BTreeSet::new();
            let mut terms = Vec::new();
            let mut all_overlap_terms = Vec::new();
            for overlap in &course.overlaps {
                nonblank(&overlap.session_id, "session_id")?;
                nonblank(&overlap.overlap_id, "overlap_id")?;
                if !overlap_ids.insert(&overlap.overlap_id) {
                    return Err("duplicate overlap_id within supplied course".into());
                }
                if !overlap.original_duration_seconds.is_finite()
                    || overlap.original_duration_seconds < 0.0
                    || !overlap.overlap_seconds.is_finite()
                    || overlap.overlap_seconds < 0.0
                    || overlap.overlap_seconds > overlap.original_duration_seconds
                {
                    return Err("Bjerre overlap requires finite nonnegative overlap no longer than original session".into());
                }
                if session_durations
                    .get(&overlap.session_id)
                    .is_some_and(|prior| *prior != overlap.original_duration_seconds)
                {
                    return Err("Bjerre session_id requires consistent original duration across supplied courses".into());
                }
                session_durations.insert(
                    overlap.session_id.clone(),
                    overlap.original_duration_seconds,
                );
                let eligible = overlap.original_duration_seconds >= 35.0;
                eligibility.push(
                    json!({"course_id":course.course_id,"overlap_id":overlap.overlap_id,
                    "session_id":overlap.session_id,"eligible":eligible}),
                );
                all_overlap_terms.push(overlap.overlap_seconds);
                if eligible {
                    terms.push(overlap.overlap_seconds);
                }
            }
            let total_overlap = sum_divide(&all_overlap_terms, 1.0)?.0;
            // All terms are finite and nonnegative: an overflowing total also
            // necessarily exceeds the finite supplied class-time denominator.
            if total_overlap.is_none_or(|total| total > course.class_exposure_seconds) {
                return Err("Bjerre supplied disjoint class overlaps exceed class exposure".into());
            }
            if aggregate {
                let (numerator, ratio) = sum_divide(&terms, course.class_exposure_seconds)?;
                let percentage = ratio.map(|r| r * 100.0).filter(|p| p.is_finite());
                percentages.push(json!({"course_id":course.course_id,"long_overlap_seconds":numerator,
                    "percent":percentage,"status":if percentage.is_some() {"computed"} else {"arithmetic_unavailable"}}));
                if let Some(percent) = percentage {
                    complete_percentages.push(percent);
                }
            }
        }
        // No NA-removal policy is imported: missing/unavailable course results
        // prohibit this mean rather than dropping a course or weighting exposure.
        let mean = if aggregate && complete_percentages.len() == courses.len() {
            let rows = complete_percentages
                .iter()
                .map(|p| GroupedNumericRow {
                    group: Some("supplied_courses".into()),
                    values: vec![Some(*p)],
                })
                .collect::<Vec<_>>();
            let mean = summarize_columns_by_first_seen_group(&rows)
                .map_err(|e| format!("Bjerre supplied course mean: {e:?}"))?[0]
                .means[0];
            if mean.is_finite() && !(mean == 0.0 && complete_percentages.iter().any(|p| *p != 0.0))
            {
                Some(mean)
            } else {
                None
            }
        } else {
            None
        };
        let status = if !aggregate {
            "eligibility_computed_aggregation_not_selected"
        } else if mean.is_some() {
            "computed"
        } else {
            "arithmetic_unavailable"
        };
        let values = [
            serde_json::to_string(&eligibility).map_err(|e| e.to_string())?,
            if aggregate {
                serde_json::to_string(&percentages).map_err(|e| e.to_string())?
            } else {
                String::new()
            },
            mean.map(|m| m.to_string()).unwrap_or_default(),
            status.into(),
            if aggregate && mean.is_none() {
                "unavailable_course_or_mean_arithmetic"
            } else {
                ""
            }
            .into(),
            "percent_not_screen_day_share".into(),
        ];
        emit(&mut output, row, &values)?;
    }
    finish(output, count)
}

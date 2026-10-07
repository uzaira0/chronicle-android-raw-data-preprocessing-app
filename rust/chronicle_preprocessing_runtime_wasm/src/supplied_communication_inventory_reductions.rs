//! Source-qualified communication, app-inventory and observed-day reductions.
//!
//! MoodMiner DOI10.1109/bsn.2012.3: text105:189–215,332–344.
//! MobileSens DOI10.7717/peerj.2197: rank136:183–265.
//! APISENSE DOI10.4000/questionsdecommunication.9851: text260:243–250,616–652.
//! Shin DOI10.1145/2493432.2493443: primary pp338–339, lines295–320.
//! Bluetooth DOI10.2196/13209: text59-loneliness:354–363.
//! Every identity, day/session membership, origin and occurrence qualification
//! is supplied. No callback classification, sessionization, calendar, tracking
//! availability, cohort statistic, Z normalization or clustering is inferred.

use super::{format_python_float, required_header};
use crate::count_ratio::{construct_named_count_ratios, CountRatioRequest};
use crate::daily_contact_count::{
    count_contacts_on_day_spine, AbsentDailyCountPolicy, DatedContact, ParticipantDay,
};
use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::grouped_distinct_count::count_distinct_members_by_group;
use std::collections::{BTreeMap, BTreeSet};

type Owner = (String, String, String);
type Day = (Owner, String);
type Session = (Day, String);

pub(super) struct ReductionCsv {
    pub bytes: Vec<u8>,
    pub source_rows: usize,
    pub emitted_rows: usize,
}

struct Table {
    fields: BTreeMap<&'static str, usize>,
    rows: Vec<csv::StringRecord>,
}

impl Table {
    fn read(input: &[u8], names: &[&'static str], adapter: &str) -> Result<Self, String> {
        let mut reader = csv::Reader::from_reader(input);
        let headers = reader
            .headers()
            .map_err(|e| format!("{adapter} header: {e}"))?
            .clone();
        if headers.len() != names.len()
            || headers.iter().collect::<BTreeSet<_>>().len() != names.len()
        {
            return Err(format!(
                "{adapter} requires exactly {} unique carrier columns",
                names.len()
            ));
        }
        let fields = names
            .iter()
            .map(|name| required_header(&headers, name, adapter).map(|column| (*name, column)))
            .collect::<Result<_, _>>()?;
        let rows = reader
            .records()
            .enumerate()
            .map(|(index, row)| row.map_err(|e| format!("{adapter} row {}: {e}", index + 1)))
            .collect::<Result<_, _>>()?;
        Ok(Self { fields, rows })
    }

    fn value<'a>(&self, row: &'a csv::StringRecord, name: &str) -> &'a str {
        row.get(self.fields[name]).unwrap_or("")
    }

    fn identity(
        &self,
        row: &csv::StringRecord,
        name: &str,
        adapter: &str,
    ) -> Result<String, String> {
        let value = self.value(row, name);
        if value.trim().is_empty() {
            return Err(format!("{adapter} requires nonblank {name}"));
        }
        // Validation is not normalization: opaque identities retain all bytes.
        Ok(value.to_owned())
    }

    fn owner(&self, row: &csv::StringRecord, scope: &str, adapter: &str) -> Result<Owner, String> {
        self.identity(row, "source_row_id", adapter)?;
        Ok((
            self.identity(row, "participant_id", adapter)?,
            self.identity(row, "device_id", adapter)?,
            self.identity(row, scope, adapter)?,
        ))
    }

    fn day(&self, row: &csv::StringRecord, adapter: &str) -> Result<Day, String> {
        Ok((
            self.owner(row, "source_window_id", adapter)?,
            self.identity(row, "source_day_id", adapter)?,
        ))
    }

    fn empty(&self, row: &csv::StringRecord, fields: &[&str], adapter: &str) -> Result<(), String> {
        if fields.iter().any(|name| !self.value(row, name).is_empty()) {
            return Err(format!(
                "{adapter} inventory marker requires empty {}",
                fields.join(",")
            ));
        }
        Ok(())
    }
}

fn owner_fields(owner: &Owner) -> Vec<String> {
    vec![owner.0.clone(), owner.1.clone(), owner.2.clone()]
}

fn writer(headers: &[&str], adapter: &str) -> Result<csv::Writer<Vec<u8>>, String> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(headers)
        .map_err(|e| format!("{adapter} output header: {e}"))?;
    Ok(writer)
}

fn finish(
    writer: csv::Writer<Vec<u8>>,
    source_rows: usize,
    emitted_rows: usize,
    adapter: &str,
) -> Result<ReductionCsv, String> {
    Ok(ReductionCsv {
        bytes: writer
            .into_inner()
            .map_err(|e| format!("{adapter} output: {e}"))?,
        source_rows,
        emitted_rows,
    })
}

fn count_u64(value: usize, adapter: &str) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("{adapter} count overflow"))
}

fn ratio(
    name: &str,
    numerator: u64,
    denominator_terms: Vec<u64>,
    adapter: &str,
) -> Result<f64, String> {
    let result = construct_named_count_ratios([CountRatioRequest {
        name,
        numerator,
        denominator_terms,
    }])
    .map_err(|e| format!("{adapter} {name}: {e}; source zero/overflow policy is undisclosed"))?;
    Ok(result[0].ratio.value())
}

/// Each admitted day is a caller-qualified complete communication inventory,
/// including a declared known-zero day. Each occurrence is one already-admitted
/// communication, not one Android callback or multipart SMS segment.
pub(super) fn moodminer_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "occurrence_id",
            "communication_kind",
        ],
        adapter,
    )?;
    let mut days = BTreeSet::<Day>::new();
    let mut occurrences = Vec::new();
    let mut unique = BTreeSet::new();
    for row in &table.rows {
        let day = table.day(row, adapter)?;
        match table.value(row, "record_type") {
            "admitted_day" => {
                table.empty(row, &["occurrence_id", "communication_kind"], adapter)?;
                if !days.insert(day) {
                    return Err(format!("{adapter} duplicate admitted day"));
                }
            }
            "communication" => {
                let occurrence = table.identity(row, "occurrence_id", adapter)?;
                if !unique.insert((day.0.clone(), occurrence)) {
                    return Err(format!(
                        "{adapter} occurrence_id must be unique within participant/device/window"
                    ));
                }
                let kind = table.value(row, "communication_kind");
                if !matches!(kind, "call" | "text_message") {
                    return Err(format!("{adapter} requires qualified call or text_message"));
                }
                occurrences.push((day, kind.to_owned()));
            }
            _ => {
                return Err(format!(
                    "{adapter} requires admitted_day or communication record_type"
                ))
            }
        }
    }
    if days.is_empty() || occurrences.iter().any(|(day, _)| !days.contains(day)) {
        return Err(format!(
            "{adapter} requires an explicit admitted-day inventory for every occurrence"
        ));
    }
    // Reuse the existing integer day-spine counter, not its old study's
    // placeholder-row policy. Tuple JSON is an injective internal group key;
    // the original owner fields are exported separately without modification.
    let owner_key = |owner: &Owner| serde_json::to_string(owner).expect("string tuple serializes");
    let spine = days
        .iter()
        .map(|(owner, day)| ParticipantDay {
            participant_id: owner_key(owner),
            date: day.clone(),
        })
        .collect::<Vec<_>>();
    let contacts = occurrences
        .iter()
        .map(|((owner, day), _)| DatedContact {
            participant_id: owner_key(owner),
            date: day.clone(),
        })
        .collect::<Vec<_>>();
    let total_counts = count_contacts_on_day_spine(
        &spine,
        &contacts,
        AbsentDailyCountPolicy::CountMatchesAndZeroFill,
    )
    .map_err(|e| format!("{adapter}: {e}"))?
    .into_iter()
    .map(|row| ((row.participant_id, row.date), row.contact_count))
    .collect::<BTreeMap<_, _>>();
    let kind_counts = count_categories_by_group(occurrences)
        .into_iter()
        .map(|row| ((row.group, row.category), row.observation_count))
        .collect::<BTreeMap<_, _>>();
    let mut output = writer(
        &[
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "call_count",
            "text_message_count",
            "communication_count",
        ],
        adapter,
    )?;
    for day in &days {
        let mut fields = owner_fields(&day.0);
        fields.push(day.1.clone());
        for kind in ["call", "text_message"] {
            fields.push(
                kind_counts
                    .get(&(day.clone(), kind.to_owned()))
                    .copied()
                    .unwrap_or(0)
                    .to_string(),
            );
        }
        fields.push(total_counts[&(owner_key(&day.0), day.1.clone())].to_string());
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    finish(output, table.rows.len(), days.len(), adapter)
}

/// Counts are already admitted and aggregated within one supplied source day.
/// The source prints sent/outgoing percentages; the exact integer numerator and
/// denominator plus fraction are also retained to make the projection explicit.
pub(super) fn mobilesens_ratios_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let count_fields = [
        "sms_sent_count",
        "sms_received_count",
        "call_outgoing_count",
        "call_incoming_count",
    ];
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "sms_sent_count",
            "sms_received_count",
            "call_outgoing_count",
            "call_incoming_count",
        ],
        adapter,
    )?;
    let mut days = BTreeSet::new();
    let mut output = writer(
        &[
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "ratio_id",
            "numerator",
            "denominator",
            "ratio",
            "percent",
        ],
        adapter,
    )?;
    for row in &table.rows {
        let day = table.day(row, adapter)?;
        if !days.insert(day.clone()) {
            return Err(format!("{adapter} duplicate supplied day counts"));
        }
        let counts = count_fields
            .iter()
            .map(|field| {
                table
                    .value(row, field)
                    .trim()
                    .parse::<u64>()
                    .map_err(|_| format!("{adapter} requires uint64 {field}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut ratios = construct_named_count_ratios([
            CountRatioRequest {
                name: "sent_sms_proportion",
                numerator: counts[0],
                denominator_terms: vec![counts[0], counts[1]],
            },
            CountRatioRequest {
                name: "outgoing_call_proportion",
                numerator: counts[2],
                denominator_terms: vec![counts[2], counts[3]],
            },
        ])
        .map_err(|e| format!("{adapter}: {e}; source zero/overflow policy is undisclosed"))?;
        // The shared ratio owner has already summed and checked both totals.
        // Reuse those exact integer denominators for the SMS-to-call numerator
        // and denominator instead of implementing another summation body.
        let contrast = construct_named_count_ratios([CountRatioRequest {
            name: "sms_to_call_ratio",
            numerator: ratios[0].ratio.denominator,
            denominator_terms: vec![ratios[1].ratio.denominator],
        }])
        .map_err(|e| format!("{adapter}: {e}; source zero/overflow policy is undisclosed"))?;
        ratios.extend(contrast);
        for ratio in ratios {
            let mut fields = owner_fields(&day.0);
            fields.extend([
                day.1.clone(),
                ratio.name.to_owned(),
                ratio.ratio.numerator.to_string(),
                ratio.ratio.denominator.to_string(),
                format_python_float(ratio.ratio.value()),
                if ratio.name == "sms_to_call_ratio" {
                    String::new()
                } else {
                    format_python_float(100.0 * ratio.ratio.value())
                },
            ]);
            output
                .write_record(fields)
                .map_err(|e| format!("{adapter} output: {e}"))?;
        }
    }
    if days.is_empty() {
        return Err(format!(
            "{adapter} requires supplied daily counts, not an absent inventory"
        ));
    }
    finish(output, table.rows.len(), days.len() * 3, adapter)
}

/// The caller supplies exactly one known daily value per retained day and
/// feature. A missing day/value is not dropped or changed to zero. The mean
/// preserves input value order and uses the existing shared mean primitive.
pub(super) fn mobilesens_mean_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "feature_id",
            "daily_value",
            "value_unit",
        ],
        adapter,
    )?;
    let mut days = BTreeMap::<Owner, BTreeSet<String>>::new();
    let mut values = Vec::new();
    let mut value_days = BTreeMap::<(Owner, String), BTreeSet<String>>::new();
    let mut units = BTreeMap::<(Owner, String), String>::new();
    for row in &table.rows {
        let (owner, day) = table.day(row, adapter)?;
        match table.value(row, "record_type") {
            "admitted_day" => {
                table.empty(row, &["feature_id", "daily_value", "value_unit"], adapter)?;
                if !days.entry(owner).or_default().insert(day) {
                    return Err(format!("{adapter} duplicate admitted day"));
                }
            }
            "daily_value" => {
                let feature = table.identity(row, "feature_id", adapter)?;
                let unit = table.identity(row, "value_unit", adapter)?;
                let value = table
                    .value(row, "daily_value")
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| format!("{adapter} requires a finite nonnegative daily_value"))?;
                if !value.is_finite() || value < 0.0 {
                    return Err(format!(
                        "{adapter} requires a finite nonnegative daily_value"
                    ));
                }
                // Exponent digits do not make an explicitly zero mantissa
                // nonzero. Parsed nonzero decimals must not become known zero.
                if value == 0.0
                    && table
                        .value(row, "daily_value")
                        .split(['e', 'E'])
                        .next()
                        .is_some_and(|mantissa| {
                            mantissa.bytes().any(|digit| matches!(digit, b'1'..=b'9'))
                        })
                {
                    return Err(format!(
                        "{adapter} daily_value parse underflow is unavailable"
                    ));
                }
                let group = (owner, feature);
                if !value_days.entry(group.clone()).or_default().insert(day) {
                    return Err(format!(
                        "{adapter} duplicate daily value within owner/feature/day"
                    ));
                }
                if units
                    .insert(group.clone(), unit.clone())
                    .is_some_and(|old| old != unit)
                {
                    return Err(format!(
                        "{adapter} value_unit must be consistent within owner/feature"
                    ));
                }
                values.push((group, value));
            }
            _ => {
                return Err(format!(
                    "{adapter} requires admitted_day or daily_value record_type"
                ))
            }
        }
    }
    if days.is_empty()
        || values.is_empty()
        || days
            .keys()
            .any(|owner| !value_days.keys().any(|group| &group.0 == owner))
        || value_days
            .iter()
            .any(|((owner, _), inventory)| days.get(owner) != Some(inventory))
    {
        return Err(format!("{adapter} every supplied feature requires exactly one known daily value on every explicit admitted day"));
    }
    let group_key =
        |group: &(Owner, String)| serde_json::to_string(group).expect("string tuple serializes");
    let rows = values
        .iter()
        .map(|(group, value)| GroupedNumericRow {
            group: Some(group_key(group)),
            values: vec![Some(*value)],
        })
        .collect::<Vec<_>>();
    // All cells were validated present and finite above; this caller does not
    // import the helper's other callers' NA/NaN removal convention.
    let summaries = summarize_columns_by_first_seen_group(&rows)
        .map_err(|e| format!("{adapter} daily mean: {e:?}"))?;
    let mut output = writer(
        &[
            "participant_id",
            "device_id",
            "source_window_id",
            "feature_id",
            "observed_day_count",
            "mean_daily_value",
            "value_unit",
        ],
        adapter,
    )?;
    for summary in &summaries {
        let group: (Owner, String) =
            serde_json::from_str(summary.group.as_deref().expect("all groups are present"))
                .map_err(|e| format!("{adapter} internal group: {e}"))?;
        let mean = summary.means[0];
        if !mean.is_finite() {
            return Err(format!("{adapter} daily mean arithmetic is nonfinite"));
        }
        if mean == 0.0
            && values
                .iter()
                .any(|(key, value)| key == &group && *value > 0.0)
        {
            return Err(format!(
                "{adapter} daily mean arithmetic underflow is unavailable"
            ));
        }
        let mut fields = owner_fields(&group.0);
        fields.extend([
            group.1.clone(),
            value_days[&group].len().to_string(),
            format_python_float(mean),
            units[&group].clone(),
        ]);
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    finish(output, table.rows.len(), summaries.len(), adapter)
}

/// An already-qualified installed-package inventory, with explicit source
/// origin labels. This is not Android flag classification or a reproduction of
/// the paper's reported 84-app mean or 54-percent five-person statistic.
pub(super) fn apisense_inventory_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "participant_id",
            "device_id",
            "inventory_id",
            "package_identity",
            "origin",
        ],
        adapter,
    )?;
    let mut packages = Vec::new();
    let mut origins = Vec::new();
    let mut unique = BTreeSet::new();
    for row in &table.rows {
        let owner = table.owner(row, "inventory_id", adapter)?;
        let package = table.identity(row, "package_identity", adapter)?;
        if !unique.insert((owner.clone(), package.clone())) {
            return Err(format!(
                "{adapter} requires a unique supplied package inventory"
            ));
        }
        let origin = table.value(row, "origin");
        if !matches!(origin, "native" | "user") {
            return Err(format!("{adapter} requires supplied native or user origin"));
        }
        packages.push((owner.clone(), package.clone()));
        origins.push(((owner, origin.to_owned()), package));
    }
    if packages.is_empty() {
        return Err(format!(
            "{adapter} empty inventory proportions are source-unavailable"
        ));
    }
    let counts = count_distinct_members_by_group(packages);
    let origin_counts = count_distinct_members_by_group(origins)
        .into_iter()
        .map(|row| (row.group, row.distinct_member_count))
        .collect::<BTreeMap<_, _>>();
    let mut output = writer(
        &[
            "participant_id",
            "device_id",
            "inventory_id",
            "total_package_count",
            "native_package_count",
            "user_package_count",
            "native_proportion",
            "user_proportion",
            "native_percent",
            "user_percent",
        ],
        adapter,
    )?;
    for row in &counts {
        let total = count_u64(row.distinct_member_count, adapter)?;
        let native = count_u64(
            origin_counts
                .get(&(row.group.clone(), "native".into()))
                .copied()
                .unwrap_or(0),
            adapter,
        )?;
        let user = count_u64(
            origin_counts
                .get(&(row.group.clone(), "user".into()))
                .copied()
                .unwrap_or(0),
            adapter,
        )?;
        let native_share = ratio("native_proportion", native, vec![total], adapter)?;
        let user_share = ratio("user_proportion", user, vec![total], adapter)?;
        let mut fields = owner_fields(&row.group);
        fields.extend([
            total.to_string(),
            native.to_string(),
            user.to_string(),
            format_python_float(native_share),
            format_python_float(user_share),
            format_python_float(100.0 * native_share),
            format_python_float(100.0 * user_share),
        ]);
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    finish(output, table.rows.len(), counts.len(), adapter)
}

/// Cardinality within each supplied screen session, followed by a daily sum.
/// Counting distinct (session, app) pairs within a day is the exact integer
/// identity sum_s |apps(s)|. It reuses the same distinct-count primitive and
/// cannot turn this into a global distinct-package-per-day calculation.
pub(super) fn shin_app_uses_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "session_id",
            "app_identity",
        ],
        adapter,
    )?;
    let mut days = BTreeSet::<Day>::new();
    let mut sessions = BTreeSet::<Session>::new();
    let mut session_days = BTreeMap::new();
    let mut apps = Vec::new();
    for row in &table.rows {
        let day = table.day(row, adapter)?;
        match table.value(row, "record_type") {
            "admitted_day" => {
                table.empty(row, &["session_id", "app_identity"], adapter)?;
                if !days.insert(day) {
                    return Err(format!("{adapter} duplicate admitted day"));
                }
            }
            "session" => {
                table.empty(row, &["app_identity"], adapter)?;
                let session = table.identity(row, "session_id", adapter)?;
                if session_days
                    .insert((day.0.clone(), session.clone()), day.1.clone())
                    .is_some()
                    || !sessions.insert((day, session))
                {
                    return Err(format!("{adapter} session_id requires exactly one supplied day within participant/device/window"));
                }
            }
            "app" => {
                let session = table.identity(row, "session_id", adapter)?;
                let app = table.identity(row, "app_identity", adapter)?;
                apps.push(((day, session), app));
            }
            _ => {
                return Err(format!(
                    "{adapter} requires admitted_day, session or app record_type"
                ))
            }
        }
    }
    if days.is_empty()
        || sessions.iter().any(|(day, _)| !days.contains(day))
        || apps.iter().any(|(session, _)| !sessions.contains(session))
    {
        return Err(format!(
            "{adapter} every app/session requires its explicitly supplied session/day inventory"
        ));
    }
    let session_counts = count_distinct_members_by_group(apps.iter().cloned())
        .into_iter()
        .map(|row| (row.group, row.distinct_member_count))
        .collect::<BTreeMap<_, _>>();
    let daily_sums = count_distinct_members_by_group(
        apps.iter()
            .map(|((day, session), app)| (day.clone(), (session.clone(), app.clone()))),
    )
    .into_iter()
    .map(|row| (row.group, row.distinct_member_count))
    .collect::<BTreeMap<_, _>>();
    let mut output = writer(
        &[
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "session_id",
            "app_use_count",
        ],
        adapter,
    )?;
    for session in &sessions {
        let mut fields = vec!["session_count".to_owned()];
        fields.extend(owner_fields(&session.0 .0));
        fields.extend([
            session.0 .1.clone(),
            session.1.clone(),
            session_counts
                .get(session)
                .copied()
                .unwrap_or(0)
                .to_string(),
        ]);
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    for day in &days {
        let mut fields = vec!["daily_sum".to_owned()];
        fields.extend(owner_fields(&day.0));
        fields.extend([
            day.1.clone(),
            String::new(),
            daily_sums.get(day).copied().unwrap_or(0).to_string(),
        ]);
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    finish(
        output,
        table.rows.len(),
        sessions.len() + days.len(),
        adapter,
    )
}

/// The explicit day inventory denotes days that THIS address was observed,
/// not general collection/availability days. It must exactly match scan days.
pub(super) fn bluetooth_csv(input: &[u8], adapter: &str) -> Result<ReductionCsv, String> {
    let table = Table::read(
        input,
        &[
            "source_row_id",
            "record_type",
            "participant_id",
            "device_id",
            "source_window_id",
            "source_day_id",
            "address_identity",
            "scan_id",
        ],
        adapter,
    )?;
    let mut seen_days = BTreeSet::new();
    let mut scans = Vec::new();
    let mut unique_scans = BTreeSet::new();
    for row in &table.rows {
        let day = table.day(row, adapter)?;
        let address = table.identity(row, "address_identity", adapter)?;
        match table.value(row, "record_type") {
            "address_seen_day" => {
                table.empty(row, &["scan_id"], adapter)?;
                if !seen_days.insert((day, address)) {
                    return Err(format!("{adapter} duplicate address_seen_day"));
                }
            }
            "scan" => {
                let scan = table.identity(row, "scan_id", adapter)?;
                if !unique_scans.insert((day.0.clone(), address.clone(), scan)) {
                    return Err(format!(
                        "{adapter} scan_id must be unique within owner/address"
                    ));
                }
                scans.push((day, address));
            }
            _ => {
                return Err(format!(
                    "{adapter} requires address_seen_day or scan record_type"
                ))
            }
        }
    }
    let actual_days = scans.iter().cloned().collect::<BTreeSet<_>>();
    if seen_days.is_empty() || seen_days != actual_days {
        return Err(format!("{adapter} explicit address-seen days must exactly match days with at least one supplied scan"));
    }
    let day_counts = count_distinct_members_by_group(
        seen_days
            .iter()
            .map(|((owner, day), address)| ((owner.clone(), address.clone()), day.clone())),
    )
    .into_iter()
    .map(|row| (row.group, row.distinct_member_count))
    .collect::<BTreeMap<_, _>>();
    let scan_counts = count_categories_by_group(
        scans
            .iter()
            .map(|((owner, _), address)| ((owner.clone(), address.clone()), ())),
    );
    let mut output = writer(
        &[
            "participant_id",
            "device_id",
            "source_window_id",
            "address_identity",
            "number_of_days_seen",
            "total_scan_count",
            "average_scans_per_seen_day",
        ],
        adapter,
    )?;
    for row in &scan_counts {
        let count = count_u64(row.observation_count, adapter)?;
        let days = count_u64(day_counts[&row.group], adapter)?;
        let mut fields = owner_fields(&row.group.0);
        fields.extend([
            row.group.1.clone(),
            days.to_string(),
            count.to_string(),
            format_python_float(ratio(
                "average_scans_per_seen_day",
                count,
                vec![days],
                adapter,
            )?),
        ]);
        output
            .write_record(fields)
            .map_err(|e| format!("{adapter} output: {e}"))?;
    }
    finish(output, table.rows.len(), scan_counts.len(), adapter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supplied_communication_inventory_source_read_hand_cases() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/supplied_communication_inventory_reductions.json"
        ))
        .unwrap();
        assert_eq!(
            fixture["oracle_status"],
            "source_read_independent_hand_cases_not_author_execution"
        );
        let mut tested = 0;
        for case in fixture["cases"].as_array().unwrap() {
            let input = case["input_csv"].as_str().unwrap().as_bytes();
            let adapter = case["adapter_id"].as_str().unwrap();
            let result = match adapter {
                "chronicle.moodminer-communication-frequency/v1" => moodminer_csv(input, adapter),
                "chronicle.mobilesens-communication-ratios/v1" => {
                    mobilesens_ratios_csv(input, adapter)
                }
                "chronicle.mobilesens-explicit-day-mean/v1" => mobilesens_mean_csv(input, adapter),
                "chronicle.apisense-package-inventory/v1" => apisense_inventory_csv(input, adapter),
                "chronicle.shin-session-app-uses/v1" => shin_app_uses_csv(input, adapter),
                "chronicle.bluetooth-address-day-frequency/v1" => bluetooth_csv(input, adapter),
                _ => panic!("unregistered fixture adapter"),
            };
            if let Some(expected) = case["expected_csv"].as_str() {
                let result = result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
                assert_eq!(
                    String::from_utf8(result.bytes).unwrap(),
                    expected,
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    result.source_rows as u64,
                    case["source_rows"].as_u64().unwrap()
                );
                assert_eq!(
                    result.emitted_rows as u64,
                    case["emitted_rows"].as_u64().unwrap()
                );
            } else {
                assert!(
                    result
                        .err()
                        .expect("source-unavailable typed input must refuse")
                        .contains(case["expected_error_contains"].as_str().unwrap()),
                    "{}",
                    case["id"]
                );
            }
            tested += 1;
        }
        assert_eq!(tested, fixture["case_count"].as_u64().unwrap() as usize);
    }
}

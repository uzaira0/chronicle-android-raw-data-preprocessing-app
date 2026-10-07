//! Lin2017 daily epochs/supplied monthly features and e2014 StudentLife combined
//! demanding-period lock/unlock counts. Day/window/period membership is supplied.
use super::{phonestudy_median, required_header};
use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const LIN_DAILY: &str = "chronicle.lin-supplied-daily-epoch-features";
pub(super) const LIN_MONTHLY: &str = "chronicle.lin-supplied-monthly-feature-means";
pub(super) const STUDENTLIFE: &str = "chronicle.studentlife-demanding-period-lock-unlock-mean";
const BASE: [&str; 9] = [
    "source_row_id",
    "participant_id",
    "device_id",
    "source_stream_id",
    "clock_id",
    "source_window_id",
    "source_day_id",
    "input_stage",
    "record_type",
];
type Owner = [String; 5];
type Day = (Owner, String);

struct Table {
    fields: BTreeMap<String, usize>,
    headers: csv::StringRecord,
    rows: Vec<csv::StringRecord>,
}
impl Table {
    fn read(raw: &[u8], extra: &[&str], adapter: &str, stage: &str) -> Result<Self, String> {
        let mut reader = csv::Reader::from_reader(raw);
        let headers = reader
            .headers()
            .map_err(|e| format!("{adapter} header: {e}"))?
            .clone();
        if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
            return Err(format!("{adapter} refuses duplicate column identities"));
        }
        let fields = BASE
            .into_iter()
            .chain(extra.iter().copied())
            .map(|name| required_header(&headers, name, adapter).map(|i| (name.to_owned(), i)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let rows = reader
            .records()
            .map(|r| r.map_err(|e| format!("{adapter} row: {e}")))
            .collect::<Result<Vec<_>, _>>()?;
        let table = Self {
            fields,
            headers,
            rows,
        };
        let mut ids = BTreeSet::new();
        for row in &table.rows {
            for name in BASE.into_iter().take(7) {
                if table.v(row, name).trim().is_empty() {
                    return Err(format!("{adapter} requires {name}"));
                }
            }
            if table.v(row, "input_stage") != stage {
                return Err(format!(
                    "{adapter} requires complete caller-qualified source membership"
                ));
            }
            if !ids.insert((table.owner(row), table.v(row, "source_row_id").to_owned())) {
                return Err(format!("{adapter} refuses ambiguous source row identities"));
            }
        }
        Ok(table)
    }
    fn v<'a>(&self, row: &'a csv::StringRecord, name: &str) -> &'a str {
        &row[self.fields[name]]
    }
    fn owner(&self, row: &csv::StringRecord) -> Owner {
        [
            "participant_id",
            "device_id",
            "source_stream_id",
            "clock_id",
            "source_window_id",
        ]
        .map(|n| self.v(row, n).to_owned())
    }
    fn day(&self, row: &csv::StringRecord) -> Day {
        (self.owner(row), self.v(row, "source_day_id").to_owned())
    }
    fn provenance(&self, owner: &Owner, day: Option<&str>) -> String {
        serde_json::json!({"original_header":self.headers.iter().collect::<Vec<_>>(),
            "original_rows":self.rows.iter().filter(|r| self.owner(r)==*owner && day.is_none_or(|d| self.v(r,"source_day_id")==d))
                .map(|r|r.iter().collect::<Vec<_>>()).collect::<Vec<_>>()}).to_string()
    }
}
fn finite_nonnegative(value: &str, adapter: &str) -> Result<f64, String> {
    let parsed = value
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .ok_or_else(|| format!("{adapter} requires present finite nonnegative values"))?;
    if parsed == 0.0
        && value
            .split(['e', 'E'])
            .next()
            .is_some_and(|v| v.bytes().any(|b| matches!(b, b'1'..=b'9')))
    {
        return Err(format!(
            "{adapter} nonzero input parse underflow is unavailable"
        ));
    }
    Ok(parsed)
}
fn write_header(names: &[&str]) -> Result<csv::Writer<Vec<u8>>, String> {
    let mut w = csv::Writer::from_writer(Vec::new());
    w.write_record(names).map_err(|e| e.to_string())?;
    Ok(w)
}
fn finish(
    w: csv::Writer<Vec<u8>>,
    source: usize,
    output: usize,
) -> Result<(Vec<u8>, usize, usize), String> {
    Ok((w.into_inner().map_err(|e| e.to_string())?, source, output))
}

pub(super) fn daily_epochs(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let table = Table::read(
        raw,
        &["epoch_id", "duration_seconds"],
        LIN_DAILY,
        "caller-complete-lin-qualified-epoch-day-inventory",
    )?;
    let mut days = Vec::<Day>::new();
    let mut declared = BTreeSet::new();
    let mut values = BTreeMap::<Day, Vec<f64>>::new();
    let mut observations = Vec::new();
    let mut epoch_ids = BTreeSet::new();
    for row in &table.rows {
        let day = table.day(row);
        match table.v(row, "record_type") {
            "admitted_day" => {
                if !table.v(row, "epoch_id").is_empty()
                    || !table.v(row, "duration_seconds").is_empty()
                    || !declared.insert(day.clone())
                {
                    return Err(format!(
                        "{LIN_DAILY} requires one payload-free complete admitted day declaration"
                    ));
                }
                days.push(day);
            }
            "epoch" => {
                let id = table.v(row, "epoch_id");
                if id.trim().is_empty() || !epoch_ids.insert((day.0.clone(), id.to_owned())) {
                    return Err(format!(
                        "{LIN_DAILY} requires unambiguous supplied epoch occurrences"
                    ));
                }
                values
                    .entry(day.clone())
                    .or_default()
                    .push(finite_nonnegative(
                        table.v(row, "duration_seconds"),
                        LIN_DAILY,
                    )?);
                observations.push((day, "epoch"));
            }
            _ => return Err(format!("{LIN_DAILY} requires admitted_day or epoch")),
        }
    }
    if values.keys().any(|day| !declared.contains(day)) {
        return Err(format!("{LIN_DAILY} epoch day is not declared complete"));
    }
    let counts = count_categories_by_group(observations)
        .into_iter()
        .map(|c| (c.group, c.observation_count))
        .collect::<BTreeMap<_, _>>();
    let mut w = write_header(&[
        "participant_id",
        "device_id",
        "source_stream_id",
        "clock_id",
        "source_window_id",
        "source_day_id",
        "daily_epoch_count",
        "daily_total_duration_seconds",
        "daily_median_duration_seconds",
        "median_status",
        "original_day_inventory_json",
    ])?;
    for day in &days {
        let durations = values.get(day).cloned().unwrap_or_default();
        let sum = durations.iter().fold(0.0, |sum, duration| sum + duration);
        if !sum.is_finite() {
            return Err(format!("{LIN_DAILY} sum arithmetic is nonfinite"));
        }
        let median = if durations.is_empty() {
            String::new()
        } else {
            phonestudy_median(durations).to_string()
        };
        let mut row = day.0.to_vec();
        row.extend([
            day.1.clone(),
            counts.get(day).copied().unwrap_or(0).to_string(),
            sum.to_string(),
            median,
            if counts.contains_key(day) {
                "available"
            } else {
                "unavailable_complete_empty_day"
            }
            .into(),
            table.provenance(&day.0, Some(&day.1)),
        ]);
        w.write_record(row).map_err(|e| e.to_string())?;
    }
    finish(w, table.rows.len(), days.len())
}

pub(super) fn monthly_features(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let table = Table::read(
        raw,
        &["feature_id", "daily_value", "value_unit"],
        LIN_MONTHLY,
        "caller-complete-lin-three-feature-retained-day-inventory",
    )?;
    let features = [
        "daily_epoch_count",
        "daily_epoch_length",
        "daily_median_epoch_duration",
    ];
    let mut days = BTreeMap::<Owner, BTreeSet<String>>::new();
    let mut values = BTreeMap::<(Owner, String), [Option<f64>; 3]>::new();
    let mut owner_order = Vec::new();
    for row in &table.rows {
        let (owner, day) = table.day(row);
        if !owner_order.contains(&owner) {
            owner_order.push(owner.clone());
        }
        match table.v(row, "record_type") {
            "admitted_day" => {
                if ["feature_id", "daily_value", "value_unit"]
                    .iter()
                    .any(|n| !table.v(row, n).is_empty())
                    || !days.entry(owner).or_default().insert(day)
                {
                    return Err(format!(
                        "{LIN_MONTHLY} requires one payload-free retained-day declaration"
                    ));
                }
            }
            "daily_value" => {
                let column = features
                    .iter()
                    .position(|f| *f == table.v(row, "feature_id"))
                    .ok_or_else(|| {
                        format!("{LIN_MONTHLY} requires the three named source features")
                    })?;
                if table.v(row, "value_unit") != if column == 0 { "count" } else { "seconds" } {
                    return Err(format!("{LIN_MONTHLY} requires count/seconds source units"));
                }
                let value = finite_nonnegative(table.v(row, "daily_value"), LIN_MONTHLY)?;
                if column == 0 && value.fract() != 0.0 {
                    return Err(format!("{LIN_MONTHLY} daily epoch count must be integral"));
                }
                if values.entry((owner, day)).or_insert([None; 3])[column]
                    .replace(value)
                    .is_some()
                {
                    return Err(format!(
                        "{LIN_MONTHLY} refuses duplicate day/feature values"
                    ));
                }
            }
            _ => {
                return Err(format!(
                    "{LIN_MONTHLY} requires admitted_day or daily_value"
                ))
            }
        }
    }
    if values.iter().any(|((o, d), v)| {
        !days.get(o).is_some_and(|days| days.contains(d)) || v.iter().any(Option::is_none)
    }) || days.iter().any(|(o, ds)| {
        ds.iter()
            .any(|d| !values.contains_key(&(o.clone(), d.clone())))
    }) {
        return Err(format!("{LIN_MONTHLY} requires every retained day and all three known daily features; no missing-day/median imputation"));
    }
    let rows = table
        .rows
        .iter()
        .filter(|r| table.v(r, "record_type") == "admitted_day")
        .map(|r| {
            let day = table.day(r);
            GroupedNumericRow {
                group: Some(serde_json::to_string(&day.0).unwrap()),
                values: values[&day].to_vec(),
            }
        })
        .collect::<Vec<_>>();
    let summaries = if rows.is_empty() {
        Vec::new()
    } else {
        summarize_columns_by_first_seen_group(&rows).map_err(|e| format!("{LIN_MONTHLY}: {e:?}"))?
    };
    let mut w = write_header(&[
        "participant_id",
        "device_id",
        "source_stream_id",
        "clock_id",
        "source_window_id",
        "retained_day_count",
        "mean_daily_epoch_count",
        "mean_daily_epoch_length_seconds",
        "mean_daily_median_epoch_duration_seconds",
        "original_window_inventory_json",
    ])?;
    for owner in &owner_order {
        let key = serde_json::to_string(owner).unwrap();
        let summary = summaries
            .iter()
            .find(|s| s.group.as_deref() == Some(&key))
            .ok_or_else(|| format!("{LIN_MONTHLY} requires retained days"))?;
        if summary.means.iter().any(|m| !m.is_finite()) {
            return Err(format!("{LIN_MONTHLY} mean arithmetic is nonfinite"));
        }
        let mut row = owner.to_vec();
        row.push(days[owner].len().to_string());
        row.extend(summary.means.iter().map(ToString::to_string));
        row.push(table.provenance(owner, None));
        w.write_record(row).map_err(|e| e.to_string())?;
    }
    finish(w, table.rows.len(), owner_order.len())
}

pub(super) fn studentlife_mean(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let table = Table::read(
        raw,
        &["event_id", "action", "demanding_period_id"],
        STUDENTLIFE,
        "caller-complete-studentlife-demanding-period-day-inventory",
    )?;
    let mut days = Vec::<Day>::new();
    let mut declared = BTreeSet::new();
    let mut events = BTreeSet::new();
    let mut observations = Vec::new();
    for row in &table.rows {
        let day = table.day(row);
        match table.v(row, "record_type") {
            "admitted_day" => {
                if ["event_id", "action", "demanding_period_id"]
                    .iter()
                    .any(|n| !table.v(row, n).is_empty())
                    || !declared.insert(day.clone())
                {
                    return Err(format!(
                        "{STUDENTLIFE} requires one payload-free complete admitted day"
                    ));
                }
                days.push(day);
            }
            "event" => {
                if !matches!(table.v(row, "action"), "lock" | "unlock")
                    || table.v(row, "event_id").trim().is_empty()
                    || table.v(row, "demanding_period_id").trim().is_empty()
                    || !events.insert((day.0.clone(), table.v(row, "event_id").to_owned()))
                {
                    return Err(format!("{STUDENTLIFE} requires unambiguous supplied demanding-period lock/unlock occurrences"));
                }
                observations.push((day, "combined_lock_unlock"));
            }
            _ => return Err(format!("{STUDENTLIFE} requires admitted_day or event")),
        }
    }
    if observations.iter().any(|(d, _)| !declared.contains(d)) {
        return Err(format!("{STUDENTLIFE} event day is not declared complete"));
    }
    let counts = count_categories_by_group(observations)
        .into_iter()
        .map(|c| (c.group, c.observation_count))
        .collect::<BTreeMap<_, _>>();
    let rows = days
        .iter()
        .map(|day| GroupedNumericRow {
            group: Some(serde_json::to_string(&day.0).unwrap()),
            values: vec![Some(counts.get(day).copied().unwrap_or(0) as f64)],
        })
        .collect::<Vec<_>>();
    let summaries = if rows.is_empty() {
        Vec::new()
    } else {
        summarize_columns_by_first_seen_group(&rows).map_err(|e| format!("{STUDENTLIFE}: {e:?}"))?
    };
    let mut w = write_header(&[
        "participant_id",
        "device_id",
        "source_stream_id",
        "clock_id",
        "source_window_id",
        "source_day_id",
        "daily_combined_lock_unlock_count",
        "complete_day_count",
        "mean_daily_combined_lock_unlock_count",
        "original_day_inventory_json",
    ])?;
    for day in &days {
        let key = serde_json::to_string(&day.0).unwrap();
        let mean = summaries
            .iter()
            .find(|s| s.group.as_deref() == Some(&key))
            .unwrap()
            .means[0];
        if !mean.is_finite() {
            return Err(format!("{STUDENTLIFE} mean arithmetic is nonfinite"));
        }
        let mut row = day.0.to_vec();
        row.extend([
            day.1.clone(),
            counts.get(day).copied().unwrap_or(0).to_string(),
            days.iter().filter(|d| d.0 == day.0).count().to_string(),
            mean.to_string(),
            table.provenance(&day.0, Some(&day.1)),
        ]);
        w.write_record(row).map_err(|e| e.to_string())?;
    }
    finish(w, table.rows.len(), days.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(extra: &[&str], stage: &str, rows: &[(&str, &str, Vec<&str>)]) -> Vec<u8> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(BASE.into_iter().chain(extra.iter().copied()))
            .unwrap();
        for (i, (day, kind, extra)) in rows.iter().enumerate() {
            let mut row = vec![
                format!("r{i}"),
                "P".into(),
                "D".into(),
                "stream".into(),
                "clock".into(),
                "window".into(),
                (*day).into(),
                stage.into(),
                (*kind).into(),
            ];
            row.extend(extra.iter().map(|v| (*v).into()));
            w.write_record(row).unwrap();
        }
        w.into_inner().unwrap()
    }
    fn rows(out: &[u8]) -> Vec<csv::StringRecord> {
        csv::Reader::from_reader(out)
            .records()
            .map(Result::unwrap)
            .collect()
    }
    #[test]
    fn final_prepared_lin_complete_days_count_sum_odd_even_median_and_empty_unavailable() {
        let raw = input(
            &["epoch_id", "duration_seconds"],
            "caller-complete-lin-qualified-epoch-day-inventory",
            &[
                ("d1", "admitted_day", vec!["", ""]),
                ("d2", "admitted_day", vec!["", ""]),
                ("d3", "admitted_day", vec!["", ""]),
                ("d1", "epoch", vec!["e1", "1"]),
                ("d1", "epoch", vec!["e2", "3"]),
                ("d2", "epoch", vec!["e3", "4"]),
            ],
        );
        let (out, source, emitted) = daily_epochs(&raw).unwrap();
        assert_eq!((source, emitted), (6, 3));
        let r = rows(&out);
        assert_eq!((&r[0][6], &r[0][7], &r[0][8]), ("2", "4", "2"));
        assert_eq!(&r[1][8], "4");
        assert_eq!(
            (&r[2][6], &r[2][7], &r[2][8], &r[2][9]),
            ("0", "0", "", "unavailable_complete_empty_day")
        );
        assert!(daily_epochs(&input(
            &["epoch_id", "duration_seconds"],
            "caller-complete-lin-qualified-epoch-day-inventory",
            &[("unknown", "epoch", vec!["e", "1"])]
        ))
        .is_err());
    }
    #[test]
    fn final_prepared_lin_monthly_means_all_three_supplied_features_without_fixed_calendar() {
        let raw = input(
            &["feature_id", "daily_value", "value_unit"],
            "caller-complete-lin-three-feature-retained-day-inventory",
            &[
                ("opaque1", "admitted_day", vec!["", "", ""]),
                ("opaque9", "admitted_day", vec!["", "", ""]),
                (
                    "opaque1",
                    "daily_value",
                    vec!["daily_epoch_count", "2", "count"],
                ),
                (
                    "opaque1",
                    "daily_value",
                    vec!["daily_epoch_length", "100", "seconds"],
                ),
                (
                    "opaque1",
                    "daily_value",
                    vec!["daily_median_epoch_duration", "1", "seconds"],
                ),
                (
                    "opaque9",
                    "daily_value",
                    vec!["daily_epoch_count", "4", "count"],
                ),
                (
                    "opaque9",
                    "daily_value",
                    vec!["daily_epoch_length", "200", "seconds"],
                ),
                (
                    "opaque9",
                    "daily_value",
                    vec!["daily_median_epoch_duration", "3", "seconds"],
                ),
            ],
        );
        let (out, _, n) = monthly_features(&raw).unwrap();
        assert_eq!(n, 1);
        let r = rows(&out);
        assert_eq!(
            (&r[0][5], &r[0][6], &r[0][7], &r[0][8]),
            ("2", "3", "150", "2")
        );
        let incomplete = input(
            &["feature_id", "daily_value", "value_unit"],
            "caller-complete-lin-three-feature-retained-day-inventory",
            &[("d", "admitted_day", vec!["", "", ""])],
        );
        assert!(monthly_features(&incomplete).is_err());
    }
    #[test]
    fn final_prepared_studentlife_combines_locks_unlocks_with_explicit_complete_zero_day() {
        let raw = input(
            &["event_id", "action", "demanding_period_id"],
            "caller-complete-studentlife-demanding-period-day-inventory",
            &[
                ("d1", "admitted_day", vec!["", "", ""]),
                ("d2", "admitted_day", vec!["", "", ""]),
                ("d1", "event", vec!["e1", "lock", "lecture"]),
                ("d1", "event", vec!["e2", "lock", "lecture"]),
                ("d1", "event", vec!["e3", "unlock", "study"]),
            ],
        );
        let (out, _, n) = studentlife_mean(&raw).unwrap();
        assert_eq!(n, 2);
        let r = rows(&out);
        assert_eq!((&r[0][6], &r[0][7], &r[0][8]), ("3", "2", "1.5"));
        assert_eq!((&r[1][6], &r[1][8]), ("0", "1.5"));
        assert!(studentlife_mean(&input(
            &["event_id", "action", "demanding_period_id"],
            "caller-complete-studentlife-demanding-period-day-inventory",
            &[("d", "event", vec!["e", "unlock", "lecture"])]
        ))
        .is_err());
    }
}

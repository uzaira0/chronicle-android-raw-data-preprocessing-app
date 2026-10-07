//! RAPIDS 1.9.4 app_episodes.R:7–25 (also byte-identical in retained1.10.1).
//! Supplied typed participant-wide inventories; no raw episode/clock construction.
use super::required_header;
use std::collections::{BTreeMap, BTreeSet};

pub(super) const ADAPTER: &str = "chronicle.rapids-released-app-episodes";
pub(super) const KIND: &str = "literature-rapids-released-app-episodes-csv";
pub(super) const FIELDS: [&str; 15] = [
    "source_row_id",
    "participant_id",
    "inventory_pair_id",
    "clock_id",
    "clock_unit",
    "input_stage",
    "record_kind",
    "timestamp_ms",
    "device_id",
    "package_name",
    "application_name",
    "application_name_is_missing",
    "is_system_app",
    "genre",
    "screen_end_timestamp_ms",
];
#[derive(Clone, PartialEq)]
struct App {
    time: f64,
    payload: [String; 5],
    missing: bool,
    source_index: usize,
}
fn finite(value: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("{ADAPTER} requires finite typed millisecond coordinates"))
}
pub(super) fn csv(raw: &[u8]) -> Result<(Vec<u8>, usize, usize), String> {
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader
        .headers()
        .map_err(|e| format!("{ADAPTER} header: {e}"))?
        .clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(format!("{ADAPTER} refuses duplicate column identities"));
    }
    let fields = FIELDS
        .iter()
        .map(|name| required_header(&headers, name, ADAPTER).map(|i| (*name, i)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut apps = Vec::<App>::new();
    let mut screens = Vec::new();
    let mut owner = None;
    let mut ids = BTreeSet::new();
    let mut source_rows = 0;
    for row in reader.records() {
        let row = row.map_err(|e| format!("{ADAPTER} row: {e}"))?;
        let v = |name: &str| &row[fields[name]];
        for name in [
            "source_row_id",
            "participant_id",
            "inventory_pair_id",
            "clock_id",
        ] {
            if v(name).trim().is_empty() {
                return Err(format!("{ADAPTER} requires {name}"));
            }
        }
        let this_owner =
            [v("participant_id"), v("inventory_pair_id"), v("clock_id")].map(str::to_owned);
        if owner.as_ref().is_some_and(|o| *o != this_owner) {
            return Err(format!(
                "{ADAPTER} requires one qualified participant/common-clock inventory pair"
            ));
        }
        owner = Some(this_owner);
        if !ids.insert(v("source_row_id").to_owned()) {
            return Err(format!(
                "{ADAPTER} requires distinct supplied occurrence identities"
            ));
        }
        if v("clock_unit") != "ms"
            || v("input_stage") != "caller-complete-v194-typed-app-screen-inventories"
        {
            return Err(format!(
                "{ADAPTER} requires complete typed inventories on an explicit common ms clock"
            ));
        }
        match v("record_kind") {
            "app" => {
                let missing = match v("application_name_is_missing") {
                    "true" if v("application_name").is_empty() => true,
                    "false" => false,
                    _ => {
                        return Err(format!(
                            "{ADAPTER} requires unambiguous nullable app-name state"
                        ))
                    }
                };
                if v("device_id").trim().is_empty() {
                    return Err(format!("{ADAPTER} requires supplied app device identity"));
                }
                let system = v("is_system_app").parse::<i32>().map_err(|_| {
                    format!("{ADAPTER} requires nonmissing typed signed32 is_system_app")
                })?;
                apps.push(App {
                    time: finite(v("timestamp_ms"))?,
                    missing,
                    source_index: source_rows + 1,
                    payload: [
                        v("device_id").to_owned(),
                        v("package_name").to_owned(),
                        v("application_name").to_owned(),
                        system.to_string(),
                        v("genre").to_owned(),
                    ],
                });
            }
            "screen" => screens.push((finite(v("screen_end_timestamp_ms"))?, source_rows + 1)),
            _ => return Err(format!("{ADAPTER} requires app or screen record_kind")),
        }
        source_rows += 1;
    }
    // dplyr1.0.5 full_join is app-major/right-input-order, followed by unmatched
    // screen rows. R4.0/4.2 numeric order is stable; no lexical secondary key.
    let mut joined = Vec::<(f64, Option<&App>, Option<usize>)>::new();
    if !apps.is_empty() && !screens.is_empty() {
        // Key equality must match numeric equality, including signed zero. The
        // lookup never determines row order: its members retain screen input order.
        let time_key = |time: f64| if time == 0.0 { 0 } else { time.to_bits() };
        let mut screens_by_time = BTreeMap::<u64, Vec<usize>>::new();
        for (end, index) in &screens {
            screens_by_time
                .entry(time_key(*end))
                .or_default()
                .push(*index);
        }
        let app_times = apps
            .iter()
            .map(|app| time_key(app.time))
            .collect::<BTreeSet<_>>();
        for app in &apps {
            if let Some(matches) = screens_by_time.get(&time_key(app.time)) {
                joined.extend(
                    matches
                        .iter()
                        .map(|index| (app.time, Some(app), Some(*index))),
                );
            } else {
                joined.push((app.time, Some(app), None));
            }
        }
        for (end, index) in &screens {
            if !app_times.contains(&time_key(*end)) {
                joined.push((*end, None, Some(*index)));
            }
        }
        // Finite coordinates were validated; +0 and -0 compare equal.
        joined.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite coordinates"));
    }
    let mut selected = joined
        .iter()
        .enumerate()
        .filter_map(|(i, (start, app, screen))| {
            app.filter(|app| !app.missing)
                .map(|app| (*start, joined.get(i + 1).map(|v| v.0), app, *screen))
        })
        .collect::<Vec<_>>();
    // This is head(-1) AFTER filter, not removal of only an unknown endpoint.
    selected.pop();
    let mut output = csv::Writer::from_writer(Vec::new());
    output
        .write_record([
            "device_id",
            "package_name",
            "application_name",
            "is_system_app",
            "genre",
            "start_timestamp",
            "end_timestamp",
            "duration",
            "original_app_source_row_index",
            "matched_screen_source_row_index",
        ])
        .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    for (start, end, app, screen) in &selected {
        let end = end.ok_or_else(|| format!("{ADAPTER} retained endpoint is missing"))?;
        let duration = (end - start) / 60_000.0;
        if !duration.is_finite() {
            return Err(format!("{ADAPTER} duration arithmetic is nonfinite"));
        }
        let mut row = app.payload.to_vec();
        row.extend([
            start.to_string(),
            end.to_string(),
            duration.to_string(),
            app.source_index.to_string(),
            screen.map(|i| i.to_string()).unwrap_or_default(),
        ]);
        output
            .write_record(row)
            .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    }
    let bytes = output
        .into_inner()
        .map_err(|e| format!("{ADAPTER} output: {e}"))?;
    Ok((bytes, source_rows, selected.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(apps: &[(&str, &str, bool, &str)], screens: &[&str]) -> Vec<u8> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(FIELDS).unwrap();
        for (i, (name, time, missing, device)) in apps.iter().enumerate() {
            w.write_record([
                format!("a{i}"),
                "P".into(),
                "pair".into(),
                "clock".into(),
                "ms".into(),
                "caller-complete-v194-typed-app-screen-inventories".into(),
                "app".into(),
                (*time).into(),
                (*device).into(),
                "pkg".into(),
                (*name).into(),
                missing.to_string(),
                "0".into(),
                "genre".into(),
                String::new(),
            ])
            .unwrap();
        }
        for (i, time) in screens.iter().enumerate() {
            w.write_record([
                format!("s{i}"),
                "P".into(),
                "pair".into(),
                "clock".into(),
                "ms".into(),
                "caller-complete-v194-typed-app-screen-inventories".into(),
                "screen".into(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                (*time).into(),
            ])
            .unwrap();
        }
        w.into_inner().unwrap()
    }
    fn projection(raw: &[u8]) -> Vec<(String, String, String, String)> {
        let (out, _, _) = csv(raw).unwrap();
        csv::Reader::from_reader(out.as_slice())
            .records()
            .map(|r| {
                let r = r.unwrap();
                (r[2].into(), r[5].into(), r[6].into(), r[7].into())
            })
            .collect()
    }
    #[test]
    fn final_prepared_rapids_source_join_lead_filter_then_last_app_drop() {
        assert_eq!(
            projection(&input(
                &[
                    ("A", "0", false, "D"),
                    ("B", "60000", false, "D"),
                    ("C", "120000", false, "D")
                ],
                &["90000", "180000"]
            )),
            vec![
                ("A".into(), "0".into(), "60000".into(), "1".into()),
                ("B".into(), "60000".into(), "90000".into(), "0.5".into())
            ]
        );
        assert!(projection(&input(&[("A", "0", false, "D")], &["60000"])).is_empty());
        assert!(projection(&input(&[("A", "0", false, "D")], &[])).is_empty());
        assert!(projection(&input(&[], &["0"])).is_empty());
        assert_eq!(
            projection(&input(
                &[
                    ("A", "0", false, "D"),
                    ("", "30000", true, "D"),
                    ("B", "60000", false, "D"),
                    ("C", "120000", false, "D")
                ],
                &["180000"]
            ))[0]
                .3,
            "0.5"
        );
        assert_eq!(
            projection(&input(
                &[("", "0", false, "D"), ("C", "60000", false, "D")],
                &["180000"]
            ))[0]
                .0,
            ""
        );
        let (out, source, count) = csv(&input(
            &[
                ("A", "0", false, "D"),
                ("B", "60000", false, "D"),
                ("C", "120000", false, "D"),
            ],
            &["0", "180000"],
        ))
        .unwrap();
        let mut reader = csv::Reader::from_reader(out.as_slice());
        assert_eq!(reader.headers().unwrap().len(), 10);
        assert_eq!((source, count), (5, 2));
        let rows = reader.records().map(Result::unwrap).collect::<Vec<_>>();
        assert_eq!(
            (&rows[0][8], &rows[0][9], &rows[1][8], &rows[1][9]),
            ("1", "4", "2", "")
        );
        assert!(!String::from_utf8(out)
            .unwrap()
            .contains("original_inventory_json"));
    }
    #[test]
    fn final_prepared_rapids_distinct_ties_cartesian_multiplicity_and_signed_zero_are_stable() {
        let apps = [
            ("Z", "-0", false, "D1"),
            ("A", "0", false, "D2"),
            ("B", "60000", false, "D2"),
            ("C", "120000", false, "D1"),
        ];
        let out = projection(&input(&apps, &["0", "0", "90000", "180000"]));
        assert_eq!(
            out.iter()
                .map(|r| (r.0.as_str(), r.3.as_str()))
                .collect::<Vec<_>>(),
            vec![("Z", "0"), ("Z", "0"), ("A", "0"), ("A", "1"), ("B", "0.5")]
        );
        let reversed = [apps[1], apps[0], apps[2], apps[3]];
        let out = projection(&input(&reversed, &["0", "0", "90000", "180000"]));
        assert_eq!(
            out.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
            vec!["A", "A", "Z", "Z", "B"]
        );
        assert_eq!(out[3].3, "1");
        assert_eq!(
            projection(&input(
                &[
                    ("A", "0", false, "D"),
                    ("A", "0", false, "D"),
                    ("B", "60000", false, "D"),
                    ("C", "120000", false, "D")
                ],
                &["0", "0", "180000"]
            ))
            .len(),
            5
        );
        assert!(csv(&input(&[("A", "NaN", false, "D")], &["0"])).is_err());
    }
}

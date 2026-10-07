//! Source-qualified supplied reductions, not raw collectors or window makers.
//! Ruegger state.py SHA74de549e3b9c068339d4a68d94dae623b63e2a8120f06886427ce491a1175532:
//! Battery v5:624-625; Bluetooth v3:243-292. StudentLife rank280-primary.txt
//! SHA377f08b265cbf3da8b6200fc478ae3f0c335a3924f7aa52900510ad196d85276:374-381.

use super::*;

pub(super) const ADAPTERS: [&str; 19] = [
    "chronicle.ruegger-supplied-battery-state-means",
    "chronicle.ruegger-supplied-bluetooth-distinct",
    "chronicle.ruegger-supplied-bluetooth-selected-means",
    "chronicle.studentlife-supplied-inference-fraction",
    "chronicle.studentlife-supplied-active-period-sum",
    "chronicle.appcapacity-supplied-app-space-changes",
    "chronicle.appcapacity-supplied-discovery-prefix",
    "chronicle.unicity-supplied-random-rescaling",
    "chronicle.unicity-supplied-popularity-rescaling",
    "chronicle.appcapacity-supplied-adoption-ratio",
    "chronicle.appcapacity-supplied-conservation-ratio",
    "chronicle.tkaczyk-supplied-digital-trace-mean",
    "chronicle.class-supplied-normalized-value-sum",
    "chronicle.montjoye-supplied-text-replies",
    "chronicle.class-supplied-session-reductions",
    "chronicle.unicity-supplied-monthly-membership-or",
    "chronicle.oulas-supplied-session-app-reductions",
    "chronicle.demonic-supplied-communication-reductions",
    "chronicle.demonic-supplied-magnitude-summary",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatteryObservation { observation_id: String, plugged: f64, level: f64 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BluetoothScan {
    scan_id: String,
    addresses: Vec<String>,
    source_daytime: Option<bool>,
    source_evening: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ActivityInference { inference_id: String, is_nonstationary: bool }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ActivePeriod { period_id: String, is_active: bool }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DiscoveryDay { day_id: String, apps: Vec<Value> }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DailyValue { day_id: String, value: f64 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NormalizedParticipantValue { participant_id: String, value: f64 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SmsObservation { message_id: String, peer_id: String, timestamp_ns: String, direction: String }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassSession { session_id: String, start_ns: String, end_ns: String }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthlyMembership { month_id: String, app: Value, membership: u8 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppOccurrence { occurrence_id: String, app: Value, duration_seconds: f64 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommunicationOccurrence { occurrence_id: String, kind: String, duration: Option<f64> }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MagnitudeSample { sample_id: String, magnitude: f64 }

pub(super) fn adapt(
    adapter: &str, raw_csv: &[u8], original_input_digest: &str,
    bindings: &[MethodProfileInputBindingReceipt],
) -> Result<AdaptedLiteratureInput, String> {
    match adapter {
        "chronicle.ruegger-supplied-battery-state-means" => battery(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.ruegger-supplied-bluetooth-distinct" => bluetooth(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.ruegger-supplied-bluetooth-selected-means" => bluetooth(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.studentlife-supplied-inference-fraction" => inferences(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.studentlife-supplied-active-period-sum" => active_periods(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.appcapacity-supplied-app-space-changes" => app_spaces(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.appcapacity-supplied-discovery-prefix" => discovery_prefix(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.unicity-supplied-random-rescaling" | "chronicle.unicity-supplied-popularity-rescaling" =>
            unicity_rescaling(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.appcapacity-supplied-adoption-ratio" | "chronicle.appcapacity-supplied-conservation-ratio" =>
            app_ratio(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.tkaczyk-supplied-digital-trace-mean" => digital_trace_mean(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.class-supplied-normalized-value-sum" => normalized_value_sum(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.montjoye-supplied-text-replies" => text_replies(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.class-supplied-session-reductions" => class_sessions(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.unicity-supplied-monthly-membership-or" => monthly_or(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.oulas-supplied-session-app-reductions" => session_apps(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.demonic-supplied-communication-reductions" => communication(adapter, raw_csv, original_input_digest, bindings),
        "chronicle.demonic-supplied-magnitude-summary" => magnitude_summary(adapter, raw_csv, original_input_digest, bindings),
        _ => Err(format!("{adapter} is not a supplied residual reduction")),
    }
}

// Source means are on finite supplied level observations, not percentages.
// The empty selected group remains undefined (NaN); no missing cell is imputed.
fn battery(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "state_window_id", "clock_id",
        "level_unit", "complete_window_inventory", "original_plugged_column_present", "battery_observations_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "state_window_id", "clock_id", "level_unit",
        "connected_observation_count", "Stachl_mean_charge_connected", "disconnected_observation_count", "Stachl_mean_charge_disconnected"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[6] != "true" || v[7] != "true" {
            return Err(format!("{adapter} requires complete supplied inventory, present plugged column and explicit lexical identities/units"));
        }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate state-window owner")); }
        let observations: Vec<BatteryObservation> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed battery inventory: {e}"))?;
        let mut selected = [Vec::new(), Vec::new()];
        for observation in observations {
            if observation.observation_id.is_empty() || !observation.plugged.is_finite() || !observation.level.is_finite() {
                return Err(format!("{adapter} requires finite plugged/level observations and actual observation identities"));
            }
            // A negative plugged value is neither source-defined group.
            let group = if observation.plugged > 0.0 { Some(0) } else if observation.plugged == 0.0 { Some(1) } else { None };
            if let Some(group) = group {
                selected[group].push(GroupedNumericRow { group: Some("selected".into()), values: vec![Some(observation.level)] });
            }
        }
        let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        for selected in selected {
            let mean = if selected.is_empty() { f64::NAN } else {
                let mean = summarize_columns_by_first_seen_group(&selected).map_err(|e| format!("{adapter}: {e:?}"))?[0].means[0];
                if !mean.is_finite() { return Err(format!("{adapter} mean exceeds finite prepared arithmetic domain")); }
                mean
            };
            output.extend([selected.len().to_string(), format_python_float(mean)]);
        }
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit state-window inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-ruegger-supplied-battery-state-means-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn bluetooth(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "state_window_id", "clock_id", "complete_window_inventory", "scans_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    let selected_means = adapter == "chronicle.ruegger-supplied-bluetooth-selected-means";
    let mut output_fields = fields[..5].to_vec();
    output_fields.extend(if selected_means {
        vec!["daytime_device_observations", "daytime_scan_count", "11_bt_devices_in_the_environment_if_daytime",
            "evening_device_observations", "evening_scan_count", "12_bt_devices_in_the_environment_if_evening"]
    } else { vec!["Stachl_number_of_unique_devices"] });
    writer.write_record(output_fields)
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "true" { return Err(format!("{adapter} requires complete supplied scan inventory and lexical identities")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate state-window owner")); }
        let scans: Vec<BluetoothScan> = serde_json::from_str(v[6]).map_err(|e| format!("{adapter} typed scan inventory: {e}"))?;
        let mut addresses = Vec::new();
        let mut selected_scans = [0u64; 2];
        let mut selected_observations = [0u64; 2];
        for scan in scans {
            if scan.scan_id.is_empty() || scan.addresses.iter().any(|address| address.is_empty()) {
                return Err(format!("{adapter} requires actual nonempty scan/address identities"));
            }
            if selected_means {
                for (index, membership) in [scan.source_daytime, scan.source_evening].into_iter().enumerate() {
                    let selected = membership.ok_or_else(|| format!("{adapter} requires explicit source-qualified daytime/evening memberships, not null"))?;
                    if selected {
                        selected_scans[index] = selected_scans[index].checked_add(1).ok_or_else(|| format!("{adapter} scan count overflow"))?;
                        let count = u64::try_from(scan.addresses.len()).map_err(|_| format!("{adapter} device count overflow"))?;
                        selected_observations[index] = selected_observations[index].checked_add(count).ok_or_else(|| format!("{adapter} device count overflow"))?;
                    }
                }
            } else {
                addresses.extend(scan.addresses.into_iter().map(|address| ((), address)));
            }
        }
        // No absent window is synthesized. Zero applies only to an explicit
        // complete inventory with no addresses, as len(source empty set)==0.
        let mut output = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        if selected_means {
            for index in 0..2 {
                let mean = if selected_scans[index] == 0 { f64::NAN } else {
                    construct_named_count_ratios([CountRatioRequest { name: (), numerator: selected_observations[index],
                        denominator_terms: vec![selected_scans[index]] }]).map_err(|e| format!("{adapter}: {e:?}"))?[0].ratio.value()
                };
                output.extend([selected_observations[index].to_string(), selected_scans[index].to_string(), format_python_float(mean)]);
            }
        } else {
            let count = count_distinct_members_by_group(addresses).first().map_or(0, |v| v.distinct_member_count);
            output.push(count.to_string());
        }
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit state-window inventory")); }
    complete_standalone_component_adaptation(adapter, if selected_means { "literature-ruegger-supplied-bluetooth-selected-means-csv" }
        else { "literature-ruegger-supplied-bluetooth-distinct-csv" }, digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn inferences(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "inference_stream_id", "period_id", "clock_id",
        "complete_inference_inventory", "inferences_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "inference_stream_id", "period_id", "clock_id",
        "nonstationary_inference_count", "inference_count", "nonstationary_fraction"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[6] != "true" { return Err(format!("{adapter} requires complete supplied inference inventory and lexical identities")); }
        if !owners.insert([v[1], v[2], v[3], v[4]].map(str::to_owned)) { return Err(format!("{adapter} duplicate period owner")); }
        let inferences: Vec<ActivityInference> = serde_json::from_str(v[7]).map_err(|e| format!("{adapter} typed inference inventory: {e}"))?;
        if inferences.iter().any(|i| i.inference_id.is_empty()) { return Err(format!("{adapter} requires actual inference identities")); }
        // Source occurrences remain observations, including repeated tokens.
        let total = u64::try_from(inferences.len()).map_err(|_| format!("{adapter} count overflow"))?;
        let count = count_categories_by_group(inferences.into_iter().map(|i| ((), i.is_nonstationary)))
            .into_iter().find(|c| c.category).map_or(0, |c| c.observation_count);
        let count = u64::try_from(count).map_err(|_| format!("{adapter} count overflow"))?;
        let fraction = construct_named_count_ratios([CountRatioRequest { name: (), numerator: count, denominator_terms: vec![total] }])
            .map_err(|e| format!("{adapter} undefined zero-denominator inference fraction: {e:?}"))?[0].ratio.value();
        let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([count.to_string(), total.to_string(), fraction.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit inference inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-studentlife-supplied-inference-fraction-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn active_periods(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "inference_stream_id", "day_scope_id", "clock_id",
        "complete_day_period_inventory", "period_duration_minutes", "periods_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "inference_stream_id", "day_scope_id", "clock_id",
        "active_period_count", "daily_activity_duration_minutes"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[6] != "true" || parse_source_bound_scalar(v[7], "finite", adapter, rows + 1, fields[7])? != 10.0 {
            return Err(format!("{adapter} requires complete supplied day inventory of qualified ten-minute periods and lexical identities"));
        }
        if !owners.insert([v[1], v[2], v[3], v[4]].map(str::to_owned)) { return Err(format!("{adapter} duplicate day-scope owner")); }
        let periods: Vec<ActivePeriod> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed period inventory: {e}"))?;
        let mut period_ids = BTreeSet::new();
        let mut terms = Vec::new();
        let mut active_count = 0;
        for period in periods {
            if period.period_id.is_empty() || !period_ids.insert(period.period_id) { return Err(format!("{adapter} requires unique actual period identities within its supplied day")); }
            if period.is_active { active_count += 1; }
            terms.push(GroupedScalarInput { entity: (), raw_partition: (), passthrough: (),
                value: RCompatibleScalar::Finite(if period.is_active { 10.0 } else { 0.0 }) });
        }
        let projected = grouped_scalar_sum_then_project_unique(&terms,
            SequentialDivisionConfiguration { first_divisor: 1.0, second_divisor: 1.0 }, |_| Some(()))
            .map_err(|e| format!("{adapter}: {e}"))?;
        let duration = match projected.first().map(|p| p.sum) {
            Some(RCompatibleScalar::Finite(v)) => v,
            None => 0.0, // Explicit complete empty inventory, never absent data.
            _ => return Err(format!("{adapter} duration exceeds finite prepared arithmetic domain")),
        };
        let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([active_count.to_string(), duration.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit day-scope inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-studentlife-supplied-active-period-sum-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Appcapacity primary rank11:147-158: already-qualified AppS sets only.
// Existing typed app-set parser and stdlib differences are reused literally.
fn app_spaces(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "comparison_scope_id", "clock_id",
        "prior_window_id", "current_window_id", "complete_app_space_inventory", "prior_apps_json", "current_apps_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "comparison_scope_id", "clock_id", "prior_window_id",
        "current_window_id", "prior_apps_json", "current_apps_json", "current_app_capacity", "added_apps_json", "dropped_apps_json",
        "added_app_count", "dropped_app_count", "signed_app_gain"]).map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[7] != "true" || v[5] == v[6] {
            return Err(format!("{adapter} requires complete qualified app-space sets and distinct explicit preceding/current windows"));
        }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate comparison owner")); }
        let prior = supplied_unicity_app_set(v[8], false)?;
        let current = supplied_unicity_app_set(v[9], false)?;
        let added = current.difference(&prior).cloned().collect::<BTreeSet<_>>();
        let dropped = prior.difference(&current).cloned().collect::<BTreeSet<_>>();
        let capacity = count_distinct_members_by_group(current.iter().cloned().map(|app| ((), app))).first().map_or(0, |c| c.distinct_member_count);
        let gain = i128::try_from(added.len()).map_err(|_| format!("{adapter} count overflow"))?
            - i128::try_from(dropped.len()).map_err(|_| format!("{adapter} count overflow"))?;
        let mut output = v[..7].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([supplied_unicity_apps_json(&prior), supplied_unicity_apps_json(&current), capacity.to_string(),
            supplied_unicity_apps_json(&added), supplied_unicity_apps_json(&dropped), added.len().to_string(), dropped.len().to_string(), gain.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit comparison inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-appcapacity-supplied-app-space-changes-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn discovery_prefix(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "prefix_scope_id", "clock_id",
        "complete_day_prefix_inventory", "ordered_days_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "prefix_scope_id", "clock_id", "day_id", "prefix_day_count",
        "cumulative_discovered_apps_json", "cumulative_distinct_app_count"]).map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut rows = 0;
    let mut outputs = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "true" { return Err(format!("{adapter} requires complete explicitly ordered day-prefix inventory and lexical identities")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate prefix owner")); }
        let days: Vec<DiscoveryDay> = serde_json::from_str(v[6]).map_err(|e| format!("{adapter} typed day-prefix: {e}"))?;
        if days.is_empty() { return Err(format!("{adapter} requires an explicit nonempty day prefix; no absent prefix is zero-filled")); }
        let mut day_ids = BTreeSet::new();
        let mut union = BTreeSet::new();
        for (index, day) in days.into_iter().enumerate() {
            if day.day_id.is_empty() || !day_ids.insert(day.day_id.clone()) { return Err(format!("{adapter} requires unique actual day identities in supplied order")); }
            union.extend(supplied_unicity_app_set(&Value::Array(day.apps).to_string(), false)?);
            let count = count_distinct_members_by_group(union.iter().cloned().map(|app| ((), app))).first().map_or(0, |c| c.distinct_member_count);
            let mut output = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
            output.extend([day.day_id, (index + 1).to_string(), supplied_unicity_apps_json(&union), count.to_string()]);
            writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
            outputs += 1;
        }
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit prefix inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-appcapacity-supplied-discovery-prefix-csv", digest, bindings,
        rows, outputs, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Retained Unicity supplement:234-242 FigureS5. This is scaling supplied
// fractions and scope factors, not random/popularity attacks or probability estimation.
fn unicity_rescaling(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let random = adapter == "chronicle.unicity-supplied-random-rescaling";
    let fields = ["source_row_id", "population_id", "participant_scope_id", "observation_scope_id", "clock_id",
        "month_id", "reference_month_id", "reference_month_label", "factor_unit", "unicity_fraction", "month_factor", "reference_factor"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut output_fields = fields.to_vec(); output_fields.push("rescaled_unicity");
    writer.write_record(output_fields).map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new();
    let mut references = BTreeMap::new();
    let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[7] != "February 2016" || v[8] != if random { "app_count" } else { "probability_app_at_most_100_users" } {
            return Err(format!("{adapter} requires actual scoped identities, coherent source factors and explicit February2016 reference"));
        }
        if !owners.insert([v[1], v[2], v[3], v[5]].map(str::to_owned)) { return Err(format!("{adapter} duplicate month owner")); }
        let unicity = parse_source_bound_scalar(v[9], "finite_nonnegative", adapter, rows + 1, fields[9])?;
        let factor = parse_source_bound_scalar(v[10], "finite_nonnegative", adapter, rows + 1, fields[10])?;
        let baseline = parse_source_bound_scalar(v[11], "finite_nonnegative", adapter, rows + 1, fields[11])?;
        if unicity > 1.0 || baseline <= 0.0 || (!random && (factor > 1.0 || baseline > 1.0))
            || (random && (factor.fract() != 0.0 || baseline.fract() != 0.0)) {
            return Err(format!("{adapter} requires a fraction, positive reference factor and source-qualified count/probability operands"));
        }
        let reference_owner = [v[1], v[2], v[3]].map(str::to_owned);
        let reference = (v[4].to_owned(), v[6].to_owned(), baseline);
        if references.insert(reference_owner, reference.clone()).is_some_and(|old| old != reference) {
            return Err(format!("{adapter} contradictory reference ownership, clock or factor"));
        }
        if v[5] == v[6] && factor != baseline { return Err(format!("{adapter} same current/reference month requires matching factor")); }
        let product = unicity * factor;
        if !product.is_finite() { return Err(format!("{adapter} product exceeds finite prepared binary64 arithmetic domain")); }
        let scalar_projection = grouped_scalar_sum_then_project_unique(&[GroupedScalarInput { entity: (), raw_partition: (), passthrough: (),
            value: RCompatibleScalar::Finite(product) }], SequentialDivisionConfiguration { first_divisor: baseline, second_divisor: 1.0 }, |_| Some(()))
            .map_err(|e| format!("{adapter}: {e}"))?;
        let RCompatibleScalar::Finite(scaled) = scalar_projection[0].first_scaled_value else { return Err(format!("{adapter} scaled value exceeds finite prepared domain")); };
        let mut output = v.iter().map(|v| v.to_string()).collect::<Vec<_>>(); output.push(scaled.to_string());
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?;
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires supplied scope operands")); }
    complete_standalone_component_adaptation(adapter, if random { "literature-unicity-supplied-random-rescaling-csv" }
        else { "literature-unicity-supplied-popularity-rescaling-csv" }, digest, bindings, rows, rows,
        writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Printed primary appcapacity equations: p3 abs(mean(G))/SD, not mean(abs(G));
// p4 mean adopted app count/mean capacity, not integer total adoption count.
fn app_ratio(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let conservation = adapter == "chronicle.appcapacity-supplied-conservation-ratio";
    let (numerator_field, denominator_field) = if conservation { ("signed_mean_app_gain", "app_gain_standard_deviation") }
        else { ("mean_newly_adopted_app_count", "mean_app_capacity") };
    let fields = ["source_row_id", "participant_id", "device_id", "observation_scope_id", "clock_id", "moment_unit", numerator_field, denominator_field];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    let mut output_fields = fields.to_vec(); output_fields.push("ratio");
    writer.write_record(output_fields).map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "app_count" { return Err(format!("{adapter} requires supplied corresponding app-only moments, coherent count unit and lexical identities")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate observation-scope owner")); }
        let numerator = parse_source_bound_scalar(v[6], if conservation { "finite" } else { "finite_nonnegative" }, adapter, rows + 1, fields[6])?;
        let denominator = parse_source_bound_scalar(v[7], "finite_nonnegative", adapter, rows + 1, fields[7])?;
        if denominator <= 0.0 { return Err(format!("{adapter} requires positive supplied mean capacity/standard deviation")); }
        let numerator = if conservation { numerator.abs() } else { numerator };
        let scalar_projection = grouped_scalar_sum_then_project_unique(&[GroupedScalarInput { entity: (), raw_partition: (), passthrough: (), value: RCompatibleScalar::Finite(numerator) }],
            SequentialDivisionConfiguration { first_divisor: denominator, second_divisor: 1.0 }, |_| Some(())).map_err(|e| format!("{adapter}: {e}"))?;
        let RCompatibleScalar::Finite(ratio) = scalar_projection[0].first_scaled_value else { return Err(format!("{adapter} ratio exceeds finite prepared domain")); };
        let mut output = v.iter().map(|v| v.to_string()).collect::<Vec<_>>(); output.push(ratio.to_string());
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicitly supplied moments")); }
    complete_standalone_component_adaptation(adapter, if conservation { "literature-appcapacity-supplied-conservation-ratio-csv" }
        else { "literature-appcapacity-supplied-adoption-ratio-csv" }, digest, bindings, rows, rows,
        writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Tkaczyk Table1/footnote: named supplied Android digital-trace days only.
// No daily report instrument, 4am/end-of-day or 14-day inventory construction.
fn digital_trace_mean(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "observation_scope_id", "clock_id", "measure_id",
        "value_unit", "complete_day_inventory", "daily_values_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "observation_scope_id", "clock_id", "measure_id", "value_unit", "observed_day_count", "person_mean_daily_value"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[7] != "true" || !matches!((v[5], v[6]), ("digital_trace_screen_time", "minutes") | ("digital_trace_phone_checking", "count")) {
            return Err(format!("{adapter} requires source-qualified raw digital-trace screen minutes or phone-checking count and complete actual day inventory"));
        }
        if !owners.insert([v[1], v[2], v[3], v[5]].map(str::to_owned)) { return Err(format!("{adapter} duplicate measure-scope owner")); }
        let days: Vec<DailyValue> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed day values: {e}"))?;
        if days.is_empty() { return Err(format!("{adapter} mean requires nonempty explicit observed-day inventory")); }
        let mut day_ids = BTreeSet::new(); let mut values = Vec::new();
        for day in days {
            if day.day_id.is_empty() || !day_ids.insert(day.day_id) || !day.value.is_finite() || day.value < 0.0 || (v[6] == "count" && day.value.fract() != 0.0) {
                return Err(format!("{adapter} requires unique named days and complete finite source-qualified daily values"));
            }
            values.push(GroupedNumericRow { group: Some("days".into()), values: vec![Some(day.value)] });
        }
        let mean = summarize_columns_by_first_seen_group(&values).map_err(|e| format!("{adapter}: {e:?}"))?[0].means[0];
        if !mean.is_finite() { return Err(format!("{adapter} mean exceeds finite prepared domain")); }
        let mut output = v[..7].iter().map(|v| v.to_string()).collect::<Vec<_>>(); output.extend([values.len().to_string(), mean.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires supplied observed-day inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-tkaczyk-supplied-digital-trace-mean-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn normalized_value_sum(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "dataset_id", "observation_scope_id", "app_identity_json", "metric_id", "normalization_definition_id",
        "complete_participant_inventory", "normalized_values_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "dataset_id", "observation_scope_id", "app_identity_json", "metric_id", "normalization_definition_id", "participant_count", "normalized_value_sum"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[6] != "true" || !matches!(v[4], "frequency" | "duration") {
            return Err(format!("{adapter} requires complete supplied participant values and explicit source app/metric/normalization ownership"));
        }
        let app = supplied_unicity_app_set(&format!("[{}]", v[3]), true)?;
        if !owners.insert((v[1].to_owned(), v[2].to_owned(), app, v[4].to_owned())) { return Err(format!("{adapter} duplicate app/metric/scope owner")); }
        let participants: Vec<NormalizedParticipantValue> = serde_json::from_str(v[7]).map_err(|e| format!("{adapter} typed participant values: {e}"))?;
        let mut participant_ids = BTreeSet::new(); let mut terms = Vec::new();
        for participant in participants {
            if participant.participant_id.is_empty() || !participant_ids.insert(participant.participant_id) || !participant.value.is_finite() {
                return Err(format!("{adapter} requires one finite normalized value per unique actual participant"));
            }
            terms.push(GroupedScalarInput { entity: (), raw_partition: (), passthrough: (), value: RCompatibleScalar::Finite(participant.value) });
        }
        let projected = grouped_scalar_sum_then_project_unique(&terms,
            SequentialDivisionConfiguration { first_divisor: 1.0, second_divisor: 1.0 }, |_| Some(())).map_err(|e| format!("{adapter}: {e}"))?;
        let sum = match projected.first().map(|p| p.sum) {
            Some(RCompatibleScalar::Finite(value)) => value,
            None => 0.0, // Only an explicit complete empty inventory.
            _ => return Err(format!("{adapter} sum exceeds finite prepared domain")),
        };
        let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>(); output.extend([terms.len().to_string(), sum.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires supplied participant inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-class-supplied-normalized-value-sum-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Montjoye author primary:220-227. Match each outgoing text to the last
// received text from the SAME peer, within inclusive one hour. Every received
// text contributes once to the response-rate denominator; multiple responses
// to it count once in the numerator but remain individual response latencies.
fn text_replies(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "exchange_scope_id", "clock_id", "timestamp_unit", "complete_sms_inventory", "messages_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "exchange_scope_id", "clock_id", "row_kind", "message_id", "peer_id", "direction",
        "source_timestamp_ns", "response_to_message_id", "response_latency_ns", "received_count", "responded_received_count", "response_rate_percent",
        "matched_response_count", "median_response_latency_ns", "median_response_latency_seconds"]).map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0; let mut output_count = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "nanoseconds" || v[6] != "true" { return Err(format!("{adapter} requires complete supplied directional SMS exchange on one explicit common nanosecond clock")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate exchange-scope owner")); }
        let messages: Vec<SmsObservation> = serde_json::from_str(v[7]).map_err(|e| format!("{adapter} typed SMS inventory: {e}"))?;
        let mut ids = BTreeSet::new(); let mut timed = Vec::new();
        for (index, message) in messages.iter().enumerate() {
            if message.message_id.is_empty() || message.peer_id.is_empty() || !ids.insert(message.message_id.clone()) || !matches!(message.direction.as_str(), "sent" | "received") {
                return Err(format!("{adapter} requires unique actual message identities, same-peer identities and explicit sent/received direction"));
            }
            let timestamp = message.timestamp_ns.parse::<i64>().map_err(|_| format!("{adapter} requires exact supplied signed64 nanosecond coordinates, not inferred timestamp parsing"))?;
            timed.push((message.peer_id.clone(), timestamp, index));
        }
        timed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let mut last_time = BTreeMap::new(); let mut last_received = BTreeMap::new();
        let mut matched = BTreeMap::new(); let mut answered = BTreeSet::new(); let mut latencies = Vec::new();
        let received = count_categories_by_group(messages.iter().map(|m| ((), m.direction.as_str())))
            .into_iter().find(|c| c.category == "received").map_or(0, |c| c.observation_count);
        for (peer, time, index) in timed {
            if last_time.insert(peer.clone(), time) == Some(time) { return Err(format!("{adapter} source does not settle same-peer timestamp ties; no tie policy is invented")); }
            let message = &messages[index];
            if message.direction == "received" { last_received.insert(peer, (time, message.message_id.clone())); continue; }
            let Some((received_time, received_id)) = last_received.get(&peer) else { continue; };
            let elapsed = supplied_anchor_elapsed_nanoseconds(*received_time, time);
            if elapsed > 3_600_000_000_000 { continue; }
            // Exact integer clock arithmetic precedes any display conversion.
            matched.insert(message.message_id.clone(), (received_id.clone(), elapsed));
            answered.insert(received_id.clone()); latencies.push(elapsed as f64);
        }
        for message in &messages {
            let mut output = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
            let response = matched.get(&message.message_id);
            output.extend(["message".to_string(), message.message_id.clone(), message.peer_id.clone(), message.direction.clone(), message.timestamp_ns.clone(),
                response.map_or_else(String::new, |r| r.0.clone()), response.map_or_else(String::new, |r| r.1.to_string())]);
            output.extend(std::iter::repeat_n(String::new(), 6));
            writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; output_count += 1;
        }
        let rate = if received == 0 { f64::NAN } else {
            construct_named_count_ratios([CountRatioRequest { name: (), numerator: answered.len() as u64, denominator_terms: vec![received as u64] }])
                .map_err(|e| format!("{adapter}: {e:?}"))?[0].ratio.value() * 100.0
        };
        let median_ns = if latencies.is_empty() { f64::NAN } else { phonestudy_median(latencies) };
        let median_seconds = if median_ns.is_nan() { f64::NAN } else {
            let scalar_projection = grouped_scalar_sum_then_project_unique(&[GroupedScalarInput { entity: (), raw_partition: (), passthrough: (), value: RCompatibleScalar::Finite(median_ns) }],
                SequentialDivisionConfiguration { first_divisor: 1_000_000_000.0, second_divisor: 1.0 }, |_| Some(())).map_err(|e| format!("{adapter}: {e}"))?;
            let RCompatibleScalar::Finite(value) = scalar_projection[0].first_scaled_value else { return Err(format!("{adapter} median outside finite domain")); }; value
        };
        let mut summary = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        summary.push("scope".into()); summary.extend(std::iter::repeat_n(String::new(), 6));
        summary.extend([received.to_string(), answered.len().to_string(), format_python_float(rate), matched.len().to_string(), format_python_float(median_ns), format_python_float(median_seconds)]);
        writer.write_record(summary).map_err(|e| format!("{adapter}: {e}"))?; output_count += 1; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit complete exchange inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-montjoye-supplied-text-replies-csv", digest, bindings,
        rows, output_count, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn class_sessions(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "observation_scope_id", "scope_level", "clock_id", "timestamp_unit", "complete_session_inventory", "sessions_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "observation_scope_id", "scope_level", "clock_id", "row_kind", "session_id", "source_start_ns", "source_end_ns", "session_duration_ns", "session_duration_seconds", "session_count", "use_duration_seconds"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0; let mut outputs = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || !matches!(v[4], "day" | "class") || v[6] != "nanoseconds" || v[7] != "true" {
            return Err(format!("{adapter} requires complete supplied paired sessions on one explicit nanosecond clock and day/class scope"));
        }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate session-scope owner")); }
        let sessions: Vec<ClassSession> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed session inventory: {e}"))?;
        let mut ids = BTreeSet::new(); let mut durations = Vec::new();
        for session in &sessions {
            if session.session_id.is_empty() || !ids.insert(session.session_id.clone()) { return Err(format!("{adapter} requires unique actual paired-session identities")); }
            let start = session.start_ns.parse::<i64>().map_err(|_| format!("{adapter} requires exact signed64 start coordinate"))?;
            let end = session.end_ns.parse::<i64>().map_err(|_| format!("{adapter} requires exact signed64 end coordinate"))?;
            let elapsed = supplied_anchor_elapsed_nanoseconds(start, end);
            if elapsed < 0 { return Err(format!("{adapter} contradictory paired session endpoints")); }
            let elapsed_i64 = i64::try_from(elapsed).map_err(|_| format!("{adapter} elapsed duration exceeds the current exact formatter's signed64 input domain"))?;
            let seconds = format_duration_seconds_from_ns(elapsed_i64);
            durations.push(seconds.parse::<f64>().map_err(|_| format!("{adapter} duration conversion failed"))?);
            let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
            output.extend(["session".into(), session.session_id.clone(), session.start_ns.clone(), session.end_ns.clone(), elapsed.to_string(), seconds, String::new(), String::new()]);
            writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; outputs += 1;
        }
        let count = count_categories_by_group(sessions.iter().map(|_| ((), ()))).first().map_or(0, |c| c.observation_count);
        let duration = supplied_finite_duration_sum(&durations).map_err(|e| format!("{adapter}: {e}"))?;
        let mut summary = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        summary.push("scope".into()); summary.extend(std::iter::repeat_n(String::new(), 5));
        summary.extend([count.to_string(), duration.to_string()]);
        writer.write_record(summary).map_err(|e| format!("{adapter}: {e}"))?; outputs += 1; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit complete session inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-class-supplied-session-reductions-csv", digest, bindings,
        rows, outputs, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Unicity Fig1: complete supplied binary month/app grid, not sparse missing=0
// or inferred calendar/year construction. Reuse the typed app identities.
fn monthly_or(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "population_id", "individual_id", "observation_scope_id", "clock_id", "complete_month_app_inventory",
        "month_ids_json", "apps_json", "memberships_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "population_id", "individual_id", "observation_scope_id", "clock_id", "supplied_month_count", "retained_apps_json", "retained_app_count"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "true" { return Err(format!("{adapter} requires complete explicit month/app membership inventory and lexical ownership")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate individual/scope owner")); }
        let month_list: Vec<String> = serde_json::from_str(v[6]).map_err(|e| format!("{adapter} typed month inventory: {e}"))?;
        let months = month_list.iter().cloned().collect::<BTreeSet<_>>();
        if months.is_empty() || months.len() != month_list.len() || months.contains("") { return Err(format!("{adapter} requires nonempty unique actual supplied month identities")); }
        let apps = supplied_unicity_app_set(v[7], false)?;
        let entries: Vec<MonthlyMembership> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed binary entries: {e}"))?;
        let mut pairs = BTreeSet::new(); let mut retained = BTreeSet::new();
        for entry in entries {
            let app = supplied_unicity_app_set(&format!("[{}]", entry.app), true)?.into_iter().next().unwrap();
            if !months.contains(&entry.month_id) || !apps.contains(&app) || entry.membership > 1 || !pairs.insert((entry.month_id, app.clone())) {
                return Err(format!("{adapter} requires exactly one binary entry owned by each supplied month/app pair"));
            }
            if entry.membership == 1 { retained.insert(app); }
        }
        let expected = months.len().checked_mul(apps.len()).ok_or_else(|| format!("{adapter} grid cardinality overflow"))?;
        if pairs.len() != expected { return Err(format!("{adapter} missing month/app entry is not zero")); }
        let count = count_distinct_members_by_group(retained.iter().cloned().map(|app| ((), app))).first().map_or(0, |c| c.distinct_member_count);
        let mut output = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([months.len().to_string(), supplied_unicity_apps_json(&retained), count.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit individual/scope inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-unicity-supplied-monthly-membership-or-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// Oulasvirta pp106-107 supplied session properties. Count occurrences, not
// distinct launches; no 3-second sampling/standby or session construction.
fn session_apps(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "session_id", "clock_id", "duration_unit", "complete_occurrence_inventory", "app_occurrences_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "session_id", "clock_id", "app_identity_json", "app_occurrence_count", "mean_app_duration_seconds"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0; let mut output_count = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[5] != "seconds" || v[6] != "true" { return Err(format!("{adapter} requires complete ordered source-qualified session occurrences and duration seconds")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate session owner")); }
        let occurrences: Vec<AppOccurrence> = serde_json::from_str(v[7]).map_err(|e| format!("{adapter} typed app occurrences: {e}"))?;
        let mut by_app = BTreeMap::<TypedDistinctMemberIdentity, Vec<f64>>::new();
        for occurrence in occurrences {
            if occurrence.occurrence_id.is_empty() || !occurrence.duration_seconds.is_finite() || occurrence.duration_seconds < 0.0 { return Err(format!("{adapter} requires actual occurrence identities and complete finite nonnegative durations")); }
            let app = supplied_unicity_app_set(&format!("[{}]", occurrence.app), true)?.into_iter().next().unwrap();
            by_app.entry(app).or_default().push(occurrence.duration_seconds);
        }
        for (app, durations) in by_app {
            let count = count_categories_by_group(durations.iter().map(|_| ((), ())))[0].observation_count;
            let samples = durations.iter().map(|value| GroupedNumericRow { group: Some("app".into()), values: vec![Some(*value)] }).collect::<Vec<_>>();
            let mean = summarize_columns_by_first_seen_group(&samples).map_err(|e| format!("{adapter}: {e:?}"))?[0].means[0];
            if !mean.is_finite() { return Err(format!("{adapter} mean exceeds finite prepared binary64 domain")); }
            let app_json = supplied_unicity_apps_json(&BTreeSet::from([app]));
            let mut output = v[..5].iter().map(|v| v.to_string()).collect::<Vec<_>>();
            output.extend([app_json[1..app_json.len()-1].to_string(), count.to_string(), mean.to_string()]);
            writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; output_count += 1;
        }
        rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit session inventory")); }
    // A complete empty session emits no observed-app row or imputed mean.
    complete_standalone_component_adaptation(adapter, "literature-oulas-supplied-session-app-reductions-csv", digest, bindings,
        rows, output_count, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

// DemonicSalmon: historical conference rendering notes, not immutable target
// article/runtime parity. The pinned CODEBOOK is a companion, not formula code.
fn communication(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "observation_scope_id", "clock_id", "duration_unit", "complete_communication_inventory", "occurrences_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "observation_scope_id", "clock_id", "duration_unit", "call_count", "sms_count", "call_duration_sum"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[6] != "true" { return Err(format!("{adapter} requires complete qualified occurrences with declared common duration unit and lexical ownership")); }
        if !owners.insert([v[1], v[2], v[3]].map(str::to_owned)) { return Err(format!("{adapter} duplicate communication scope")); }
        let occurrences: Vec<CommunicationOccurrence> = serde_json::from_str(v[7]).map_err(|e| format!("{adapter} typed communications: {e}"))?;
        let mut categories = Vec::new(); let mut durations = Vec::new();
        for occurrence in occurrences {
            if occurrence.occurrence_id.is_empty() { return Err(format!("{adapter} requires actual occurrence identities")); }
            match (occurrence.kind.as_str(), occurrence.duration) {
                ("call", Some(duration)) if duration.is_finite() && duration >= 0.0 => durations.push(duration),
                ("sms", None) => (),
                _ => return Err(format!("{adapter} requires finite nonnegative call duration and null SMS non-applicable duration, not missing call=zero")),
            }
            categories.push(((), occurrence.kind));
        }
        let counts = count_categories_by_group(categories);
        let call_count = counts.iter().find(|c| c.category == "call").map_or(0, |c| c.observation_count);
        let sms_count = counts.iter().find(|c| c.category == "sms").map_or(0, |c| c.observation_count);
        let sum = supplied_finite_duration_sum(&durations)?;
        let mut output = v[..6].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([call_count.to_string(), sms_count.to_string(), sum.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit communication inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-demonic-supplied-communication-reductions-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

fn magnitude_summary(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt])
    -> Result<AdaptedLiteratureInput, String>
{
    let fields = ["source_row_id", "participant_id", "device_id", "sensor_stream_id", "window_id", "clock_id", "magnitude_unit", "complete_magnitude_inventory", "magnitudes_json"];
    let mut reader = csv::Reader::from_reader(raw);
    let headers = reader.headers().map_err(|e| format!("{adapter}: {e}"))?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() { return Err(format!("{adapter} duplicate columns")); }
    let columns = fields.iter().map(|f| required_header(&headers, f, adapter)).collect::<Result<Vec<_>, _>>()?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(["source_row_id", "participant_id", "device_id", "sensor_stream_id", "window_id", "clock_id", "magnitude_unit", "sample_count", "magnitude_mean", "magnitude_minimum", "magnitude_maximum", "magnitude_median"])
        .map_err(|e| format!("{adapter}: {e}"))?;
    let mut owners = BTreeSet::new(); let mut rows = 0;
    for record in reader.records() {
        let record = record.map_err(|e| format!("{adapter}: {e}"))?;
        let v = columns.iter().map(|i| record.get(*i).unwrap_or_default()).collect::<Vec<_>>();
        if v.iter().any(|v| v.is_empty()) || v[7] != "true" { return Err(format!("{adapter} requires complete supplied qualified magnitude inventory and common declared unit/clock/stream/window")); }
        if !owners.insert([v[1], v[2], v[3], v[4]].map(str::to_owned)) { return Err(format!("{adapter} duplicate magnitude-window owner")); }
        let samples: Vec<MagnitudeSample> = serde_json::from_str(v[8]).map_err(|e| format!("{adapter} typed magnitudes: {e}"))?;
        if samples.is_empty() || samples.iter().any(|s| s.sample_id.is_empty() || !s.magnitude.is_finite() || s.magnitude < 0.0) {
            return Err(format!("{adapter} requires nonempty actual supplied sample occurrences and finite nonnegative magnitudes"));
        }
        let values = samples.iter().map(|s| s.magnitude).collect::<Vec<_>>();
        let numeric = values.iter().map(|value| GroupedNumericRow { group: Some("window".into()), values: vec![Some(*value)] }).collect::<Vec<_>>();
        let mean = summarize_columns_by_first_seen_group(&numeric).map_err(|e| format!("{adapter}: {e:?}"))?[0].means[0];
        let extrema = finite_scalar_extrema_by_group(values.iter().map(|value| ((), *value))).map_err(|e| format!("{adapter}: {e:?}"))?;
        // Explicit Chronicle conventional even midpoint, not recovered author
        // evaluation; the existing median body is reused unchanged.
        let median = phonestudy_median(values);
        if !mean.is_finite() || !median.is_finite() { return Err(format!("{adapter} summary exceeds finite prepared binary64 domain")); }
        let mut output = v[..7].iter().map(|v| v.to_string()).collect::<Vec<_>>();
        output.extend([samples.len().to_string(), mean.to_string(), extrema[0].minimum.to_string(), extrema[0].maximum.to_string(), median.to_string()]);
        writer.write_record(output).map_err(|e| format!("{adapter}: {e}"))?; rows += 1;
    }
    if rows == 0 { return Err(format!("{adapter} requires explicit supplied magnitude inventory")); }
    complete_standalone_component_adaptation(adapter, "literature-demonic-supplied-magnitude-summary-csv", digest, bindings,
        rows, rows, writer.into_inner().map_err(|e| format!("{adapter}: {e}"))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cases() -> Vec<(String, Value)> {
        let manifest: Value = serde_json::from_str(crate::packed_json::ADAPTER_CONFORMANCE.text().unwrap()).unwrap();
        manifest["groups"].as_array().unwrap().iter().filter_map(|group| {
            let component = group["adapterId"].as_str().unwrap();
            ADAPTERS.iter().any(|a| component == format!("{a}/v1"))
                .then(|| (component.to_string(), group["cases"][0].clone()))
        }).collect()
    }

    fn raw(case: &Value) -> Vec<u8> {
        (case["rawCsvLines"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n") + "\n").into_bytes()
    }

    fn execute(component: &str, input: &[u8]) -> Result<AdaptedLiteratureInput, String> {
        let (_, bindings) = literature_component_execution_unit(component)?;
        adapt_literature_inputs(input, &sha256(input), &bindings, |_| &[])?
            .ok_or_else(|| "supplied residual component did not execute".into())
    }

    fn change(input: &[u8], field: &str, value: &str) -> Vec<u8> {
        let mut reader = csv::Reader::from_reader(input);
        let headers = reader.headers().unwrap().clone();
        let index = headers.iter().position(|v| v == field).unwrap();
        let mut records = reader.records().map(|r| r.unwrap().iter().map(str::to_owned).collect::<Vec<_>>()).collect::<Vec<_>>();
        records[0][index] = value.to_string();
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.write_record(headers.iter()).unwrap();
        for record in records { writer.write_record(record).unwrap(); }
        writer.into_inner().unwrap()
    }

    #[test]
    fn residual_supplied_registered_csv_receipts_and_reproducible_hand_preimages() {
        #[derive(serde::Serialize)]
        struct Preimage<'a> {
            #[serde(rename = "rawCsvLines")] raw: &'a Value,
            #[serde(rename = "expectedCsvLines")] expected: &'a Value,
        }
        let cases = cases();
        assert_eq!(cases.len(), ADAPTERS.len());
        for (component, case) in cases {
            let input = raw(&case);
            let expected = case["expected"]["outputContains"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n") + "\n";
            let result = execute(&component, &input).unwrap();
            assert_eq!(result.csv_bytes, expected.as_bytes(), "{component}");
            assert_eq!(result.receipt.source_row_count as usize, input.split(|b| *b == b'\n').count() - 2);
            assert_eq!(result.receipt.emitted_row_count as usize, expected.lines().count() - 1);
            assert_eq!(result.receipt.adapter_ids, [component]);
            assert_eq!(result.receipt.original_input_digest, sha256(&input));
            assert_eq!(result.receipt.adapted_input_digest, sha256(expected.as_bytes()));
            assert_eq!(result.receipt.derived_result.as_ref().unwrap().digest, sha256(expected.as_bytes()));
            assert_eq!(result.derived_result_bytes.as_deref(), Some(expected.as_bytes()));
            assert!(!receipt_is_kernel_input_eligible(&result.receipt));
            let preimage = serde_json::to_string(&Preimage { raw: &case["rawCsvLines"], expected: &case["expected"]["outputContains"] }).unwrap() + "\n";
            assert!(result.receipt.source_oracle_id.as_ref().unwrap().ends_with(&format!("/{}", sha256(preimage.as_bytes()))));
        }
    }

    #[test]
    fn residual_supplied_public_parent_gate_preserves_admission() {
        for (component_id, case) in cases() {
            let raw = String::from_utf8(raw(&case)).unwrap();
            let component_id = component_id.as_str();
            let (component, bindings) = literature_component_execution_unit(component_id).unwrap();
            let ids = bindings.iter().map(|b| b.setting_id.clone()).collect::<Vec<_>>();
            let admission = crate::android_method_profile_registry::validate_blocked_component_parent(
                component_id, &component.parent_method_profile_id, &component.source_work_id,
                &component.source_method_variant_id, &component.method_profile_version, &ids);
        let request = serde_json::json!({
            "protocolVersion": crate::RUNTIME_PROTOCOL_VERSION,
            "requestId": "residual-supplied-source-fixture",
            "command": crate::EXECUTE_WORKSPACE_COMMAND,
            "workspaceRootDigest": null,
            "workspaceId": format!("sha256:{}", "a".repeat(64)),
            "inputFileName": "residual-supplied-reductions.csv",
            "inputSha256": sha256(raw.as_bytes()),
            "options": {
                "study_name": "Prepared source-reduction fixture", "timezone": "UTC",
                "usage_session_mode": "app_usage", "include_app_output": true,
                "include_screen_output": false, "use_filter_file": false,
                "use_apps_forcing_screen_open": false, "use_app_codebook": false,
                "correct_duplicate_event_timestamps": true, "allow_stop_event_reuse": false,
                "use_activity_stopped_as_fallback": true, "apply_threshold_to_fallback": true,
                "long_duration_threshold_ns": 43200000000000_i64, "proximity_interval_ns": 0_i64,
                "custom_app_engagement_duration": 300.0, "long_data_time_gap_thresholds": [1.0, 2.0],
                "long_usage_duration_thresholds": [1.0, 2.0],
                "same_app_stop_types": ["Activity Paused", "Activity Resumed"],
                "other_stop_types": ["Activity Resumed", "Device Shutdown"],
                "interaction_types_to_remove": [], "screen_auto_lock_timeout_seconds": 120.0,
                "screen_auto_lock_tolerance_seconds": 30.0, "screen_manual_lock_max_tail_seconds": 30.0,
                "screen_keyguard_near_stop_seconds": 2.0,
                "datetime_of_preprocessing": "2026-09-29 12:00:00 UTC",
                "model_concurrent_usage": false, "minimum_usage_duration": 60.0,
                "micro_use_classification_policy": "none", "minimum_duration_comparator": "strict_lt",
                "minimum_duration_disposition": "chronicle_blank_keep_row",
                "apply_minimum_usage_duration_to_concurrent_subintervals": false
            }
        }).to_string();
            let observed = crate::execute_literature_component_native(component_id, &request,
                raw.as_bytes(), &crate::RuntimeSupportFiles::default());
            match admission {
                Err(expected) => {
                    assert_eq!(observed.err(), Some(expected.clone()));
                    assert!(expected.contains("canonical"));
                    println!("{component_id} public refused before canonical projection: {expected}");
                }
                Ok(()) => {
                    let mut handle = observed.expect("admitted exact owner must use the normal public path");
                    let expected = case["expected"]["outputContains"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n") + "\n";
                    let mut derived_seen = false;
                    let mut receipt_seen = false;
                    for index in 0..handle.artifact_count() {
                        let metadata: Value = serde_json::from_str(&handle.artifact_metadata_json(index).unwrap()).unwrap();
                        let bytes = handle.take_artifact_bytes(index).unwrap();
                        assert_eq!(metadata["digest"], sha256(&bytes));
                        if metadata["kind"] == component.derived_result_kind {
                            assert_eq!(bytes, expected.as_bytes()); derived_seen = true;
                        }
                        if metadata["kind"] == "literature-component-execution-receipt-json" {
                            let receipt: Value = serde_json::from_slice(&bytes).unwrap();
                            assert_eq!(receipt["componentId"], component_id);
                            assert_eq!(receipt["fullProfileExecutionStatus"], "blocked");
                            assert_eq!(receipt["kernelInputEligible"], false);
                            assert_eq!(receipt["derivedResultDigest"], sha256(expected.as_bytes()));
                            receipt_seen = true;
                        }
                    }
                    assert!(derived_seen && receipt_seen, "normal derived/export and execution receipt artifacts");
                    println!("{component_id} native public execution accepted current exact parent ownership");
                }
            }
        }
    }
    #[test]
    fn residual_supplied_all_components_reject_unknown_inventories_and_ownership() {
        for (component, case) in cases() {
            let input = raw(&case);
            let headers = csv::Reader::from_reader(input.as_slice()).headers().unwrap().clone();
            for field in headers.iter().filter(|f| f.starts_with("complete_")) {
                assert!(execute(&component, &change(&input, field, "false")).is_err(), "{component} {field}");
            }
            for field in headers.iter().filter(|f| f.ends_with("_json")) {
                assert!(execute(&component, &change(&input, field, "null")).is_err(), "{component} {field}");
            }
            for field in ["clock_id", "device_id", "participant_id", "population_id", "individual_id", "dataset_id"] {
                if headers.iter().any(|h| h == field) {
                    assert!(execute(&component, &change(&input, field, "")).is_err(), "{component} {field}");
                }
            }
            let first_record = input.split(|b| *b == b'\n').nth(1).unwrap();
            let mut duplicate = input.clone(); duplicate.extend(first_record); duplicate.push(b'\n');
            assert!(execute(&component, &duplicate).is_err(), "{component} duplicate scope owner");
        }
    }

    #[test]
    fn residual_supplied_battery_means_are_not_missing_or_percentage_defaults() {
        battery_domain_cases();
    }

    #[test]
    fn residual_supplied_app_sets_and_printed_scalar_moments_keep_source_meaning() {
        for (component, case) in cases().into_iter().filter(|(c, _)| c.contains("appcapacity")) {
            let input = raw(&case);
            if component.contains("app-space-changes") {
                for value in ["[null]", "[true]", "[1.5]", "[\"\"]"] { assert!(execute(&component, &change(&input, "current_apps_json", value)).is_err()); }
                assert!(execute(&component, &change(&input, "prior_window_id", "after")).is_err());
                let text = String::from_utf8(execute(&component, &input).unwrap().csv_bytes).unwrap();
                assert!(text.contains(",1,2,-1"));
            } else if component.contains("discovery-prefix") {
                for value in ["[]", r#"[{"day_id":"d","apps":[]},{"day_id":"d","apps":[]}]"#, r#"[{"day_id":"d","apps":[null]}]"#] {
                    assert!(execute(&component, &change(&input, "ordered_days_json", value)).is_err());
                }
            } else {
                let conservation = component.contains("conservation");
                let denom = if conservation { "app_gain_standard_deviation" } else { "mean_app_capacity" };
                let numerator = if conservation { "signed_mean_app_gain" } else { "mean_newly_adopted_app_count" };
                for value in ["", "null", "NaN", "inf", "0", "-1"] { assert!(execute(&component, &change(&input, denom, value)).is_err()); }
                for value in ["", "null", "NaN", "inf"] { assert!(execute(&component, &change(&input, numerator, value)).is_err()); }
                assert!(execute(&component, &change(&input, "moment_unit", "unknown")).is_err());
                if conservation {
                    let mut value = change(&input, numerator, "0"); value = change(&value, denom, "1");
                    assert!(String::from_utf8(execute(&component, &value).unwrap().csv_bytes).unwrap().contains("app_count,0,1,0"));
                } else {
                    assert!(execute(&component, &change(&input, numerator, "-1")).is_err());
                    assert!(String::from_utf8(execute(&component, &input).unwrap().csv_bytes).unwrap().contains("app_count,1.5,6,0.25"));
                }
                let overflow = change(&change(&input, numerator, "1.7976931348623157e308"), denom, "5e-324");
                assert!(execute(&component, &overflow).is_err());
            }
        }
    }

    #[test]
    fn residual_supplied_unicity_complete_grid_and_unclipped_rescaling_are_independent() {
        for (component, case) in cases().into_iter().filter(|(c, _)| c.contains("unicity")) {
            let input = raw(&case);
            if component.contains("membership-or") {
                for value in ["[]", "[null]", r#"[{"month_id":"m1","app":1,"membership":2}]"#,
                    r#"[{"month_id":"unknown","app":1,"membership":0}]"#,
                    r#"[{"month_id":"m1","app":"other","membership":0}]"#,
                    r#"[{"month_id":"m1","app":1,"membership":0},{"month_id":"m1","app":1,"membership":1}]"#,
                    r#"[{"month_id":"m1","app":1,"membership":null}]"#] {
                    assert!(execute(&component, &change(&input, "memberships_json", value)).is_err(), "{value}");
                }
                for value in ["[]", r#"["m1","m1"]"#, "[null]"] { assert!(execute(&component, &change(&input, "month_ids_json", value)).is_err()); }
            } else {
                for (field, value) in [("reference_factor", "0"), ("month_factor", "-1"), ("unicity_fraction", "1.1"),
                    ("reference_month_label", "other"), ("factor_unit", "unknown"), ("clock_id", ""), ("reference_factor", "NaN")]
                { assert!(execute(&component, &change(&input, field, value)).is_err()); }
                if component.contains("random") { assert!(execute(&component, &change(&input, "month_factor", "1.5")).is_err()); }
                else { assert!(execute(&component, &change(&input, "month_factor", "1.1")).is_err()); }
                assert!(String::from_utf8(execute(&component, &input).unwrap().csv_bytes).unwrap().contains(",1.5\n"));
            }
        }
    }

    #[test]
    fn residual_supplied_trace_normalized_and_session_app_inventories_do_not_impute() {
        for (component, case) in cases().into_iter().filter(|(c, _)| c.contains("digital-trace") || c.contains("normalized-value") || c.contains("oulas")) {
            let input = raw(&case);
            if component.contains("digital-trace") {
                for value in ["[]", r#"[{"day_id":"d","value":null}]"#, r#"[{"day_id":"d","value":-1}]"#,
                    r#"[{"day_id":"d","value":1},{"day_id":"d","value":2}]"#,
                    r#"[{"day_id":"d","value":1e308},{"day_id":"e","value":1e308}]"#] {
                    assert!(execute(&component, &change(&input, "daily_values_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "measure_id", "survey_screen_time")).is_err());
                assert!(execute(&component, &change(&input, "value_unit", "unknown")).is_err());
            } else if component.contains("normalized-value") {
                for value in [r#"[{"participant_id":"p","value":null}]"#, r#"[{"participant_id":"p","value":1},{"participant_id":"p","value":2}]"#,
                    r#"[{"participant_id":"p","value":1e308},{"participant_id":"q","value":1e308}]"#] {
                    assert!(execute(&component, &change(&input, "normalized_values_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "normalization_definition_id", "")).is_err());
                assert!(execute(&component, &change(&input, "metric_id", "ranking")).is_err());
                assert!(String::from_utf8(execute(&component, &input).unwrap().csv_bytes).unwrap().contains(",2,0\n"));
            } else {
                for value in [r#"[{"occurrence_id":"o","app":null,"duration_seconds":1}]"#, r#"[{"occurrence_id":"o","app":"a","duration_seconds":null}]"#,
                    r#"[{"occurrence_id":"o","app":"a","duration_seconds":-1}]"#,
                    r#"[{"occurrence_id":"o","app":"a","duration_seconds":1e308},{"occurrence_id":"x","app":"a","duration_seconds":1e308}]"#] {
                    assert!(execute(&component, &change(&input, "app_occurrences_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "duration_unit", "minutes")).is_err());
                let empty = execute(&component, &change(&input, "app_occurrences_json", "[]")).unwrap();
                assert_eq!(empty.receipt.emitted_row_count, 0);
            }
        }
    }

    #[test]
    fn residual_supplied_message_and_session_clocks_remain_exact_and_scoped() {
        for (component, case) in cases().into_iter().filter(|(c, _)| c.contains("text-replies") || c.contains("session-reductions") && c.contains("class")) {
            let input = raw(&case);
            assert!(execute(&component, &change(&input, "timestamp_unit", "seconds")).is_err());
            if component.contains("text-replies") {
                for value in [r#"[{"message_id":"r","peer_id":"b","timestamp_ns":"1","direction":"received"},{"message_id":"s","peer_id":"b","timestamp_ns":"1","direction":"sent"}]"#,
                    r#"[{"message_id":"r","peer_id":"b","timestamp_ns":"9223372036854775808","direction":"received"}]"#,
                    r#"[{"message_id":"r","peer_id":"b","timestamp_ns":"1","direction":"unknown"}]"#] {
                    assert!(execute(&component, &change(&input, "messages_json", value)).is_err());
                }
                let precise = r#"[{"message_id":"r","peer_id":"b","timestamp_ns":"-9223372036854775808","direction":"received"},{"message_id":"s","peer_id":"b","timestamp_ns":"-9223368436854775808","direction":"sent"},{"message_id":"late","peer_id":"b","timestamp_ns":"-9223368436854775807","direction":"sent"}]"#;
                let output = String::from_utf8(execute(&component, &change(&input, "messages_json", precise)).unwrap().csv_bytes).unwrap();
                assert!(output.contains("-9223368436854775808,r,3600000000000"));
                assert!(output.contains("-9223368436854775807,,"));
                let even = r#"[{"message_id":"r","peer_id":"b","timestamp_ns":"0","direction":"received"},{"message_id":"s1","peer_id":"b","timestamp_ns":"1","direction":"sent"},{"message_id":"s2","peer_id":"b","timestamp_ns":"2","direction":"sent"}]"#;
                let output = String::from_utf8(execute(&component, &change(&input, "messages_json", even)).unwrap().csv_bytes).unwrap();
                assert!(output.contains(",1,1,100,2,1.5,0.0000000015"));
            } else {
                for value in [r#"[{"session_id":"s","start_ns":"2","end_ns":"1"}]"#,
                    r#"[{"session_id":"s","start_ns":"-9223372036854775808","end_ns":"9223372036854775807"}]"#,
                    r#"[{"session_id":"s","start_ns":"0","end_ns":"1"},{"session_id":"s","start_ns":"2","end_ns":"3"}]"#] {
                    assert!(execute(&component, &change(&input, "sessions_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "scope_level", "inferred")).is_err());
            }
        }
    }

    #[test]
    fn residual_supplied_demonic_qualified_values_do_not_claim_constructor_or_target_parity() {
        for (component, case) in cases().into_iter().filter(|(c, _)| c.contains("demonic")) {
            let input = raw(&case);
            if component.contains("communication") {
                for value in [r#"[{"occurrence_id":"o","kind":"call","duration":null}]"#, r#"[{"occurrence_id":"o","kind":"call","duration":-1}]"#,
                    r#"[{"occurrence_id":"o","kind":"sms","duration":0}]"#, r#"[{"occurrence_id":"o","kind":"unknown","duration":1}]"#,
                    r#"[{"occurrence_id":"o","kind":"call","duration":1e308},{"occurrence_id":"p","kind":"call","duration":1e308}]"#] {
                    assert!(execute(&component, &change(&input, "occurrences_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "duration_unit", "")).is_err());
            } else {
                for value in ["[]", r#"[{"sample_id":"s","magnitude":null}]"#, r#"[{"sample_id":"s","magnitude":-1}]"#,
                    r#"[{"sample_id":"s","magnitude":1e308},{"sample_id":"s","magnitude":1e308}]"#] {
                    assert!(execute(&component, &change(&input, "magnitudes_json", value)).is_err());
                }
                assert!(execute(&component, &change(&input, "magnitude_unit", "")).is_err());
            }
        }
    }

    fn battery_domain_cases() {
        let (component, case) = cases().into_iter().find(|(id, _)| id.contains("battery-state")).unwrap();
        let input = raw(&case);
        for (field, value) in [("original_plugged_column_present", "false"), ("complete_window_inventory", "false"),
            ("clock_id", ""), ("level_unit", ""), ("battery_observations_json", "null"),
            ("battery_observations_json", r#"[{"observation_id":"o","plugged":null,"level":30}]"#),
            ("battery_observations_json", r#"[{"observation_id":"o","plugged":1,"level":null}]"#),
            ("battery_observations_json", r#"[{"observation_id":"o","plugged":1,"level":"NaN"}]"#),
            ("battery_observations_json", r#"[{"observation_id":"o","plugged":1,"level":1e309}]"#),
            ("battery_observations_json", r#"[{"observation_id":"o","plugged":1,"level":1.7976931348623157e308},{"observation_id":"x","plugged":1,"level":1.7976931348623157e308}]"#)]
        { assert!(execute(&component, &change(&input, field, value)).is_err(), "{field}={value}"); }
        let output = execute(&component, &input).unwrap();
        let text = String::from_utf8(output.csv_bytes).unwrap();
        assert!(text.contains("collector_level_units,3,30,1,80"));
        assert!(text.contains("empty,clock,collector_level_units,0,NaN,0,NaN"));
        assert!(text.contains(" raw_units ,2,-1,0,NaN"));
    }

    #[test]
    fn residual_supplied_bluetooth_multiplicity_distinctness_empty_and_daypart_boundaries() {
        for (component, case) in cases().into_iter().filter(|(id, _)| id.contains("bluetooth")) {
            let input = raw(&case);
            for (field, value) in [("complete_window_inventory", "false"), ("scans_json", "null"), ("scans_json", "[null]"),
                ("scans_json", r#"[{"scan_id":"s","addresses":[null]}]"#), ("scans_json", r#"[{"scan_id":"s","addresses":[""]}]"#),
                ("scans_json", r#"[{"scan_id":"","addresses":[]}]"#), ("device_id", "")]
            { assert!(execute(&component, &change(&input, field, value)).is_err(), "{component} {field}={value}"); }
            if component.contains("selected-means") {
                for value in [r#"[{"scan_id":"s","addresses":[]}]"#, r#"[{"scan_id":"s","addresses":[],"source_daytime":null,"source_evening":false}]"#] {
                    assert!(execute(&component, &change(&input, "scans_json", value)).is_err());
                }
            } else {
                let no_daypart = change(&input, "scans_json", r#"[{"scan_id":"s","addresses":["A"," A ","a","A"]}]"#);
                assert!(String::from_utf8(execute(&component, &no_daypart).unwrap().csv_bytes).unwrap().contains("r1,p,d,w,clock,3"));
            }
        }
    }

    #[test]
    fn residual_supplied_studentlife_occurrences_and_active_periods_are_separate() {
        for (component, case) in cases().into_iter().filter(|(id, _)| id.contains("studentlife")) {
            let input = raw(&case);
            let is_fraction = component.contains("inference-fraction");
            let field = if is_fraction { "inferences_json" } else { "periods_json" };
            for value in ["null", "[null]"] { assert!(execute(&component, &change(&input, field, value)).is_err()); }
            if is_fraction {
                for value in ["[]", r#"[{"inference_id":"i","is_nonstationary":null}]"#, r#"[{"inference_id":"i","is_nonstationary":0}]"#] {
                    assert!(execute(&component, &change(&input, field, value)).is_err());
                }
                assert!(String::from_utf8(execute(&component, &input).unwrap().csv_bytes).unwrap().contains("3,4,0.75"));
            } else {
                for value in [r#"[{"period_id":"p","is_active":null}]"#, r#"[{"period_id":"p","is_active":true},{"period_id":"p","is_active":false}]"#] {
                    assert!(execute(&component, &change(&input, field, value)).is_err());
                }
                assert!(execute(&component, &change(&input, "period_duration_minutes", "5")).is_err());
                assert!(execute(&component, &change(&input, "complete_day_period_inventory", "false")).is_err());
                let output = execute(&component, &change(&input, field, "[]")).unwrap();
                assert!(String::from_utf8(output.csv_bytes).unwrap().contains("r1,p,d,stream,day,clock,0,0"));
            }
        }
    }
}

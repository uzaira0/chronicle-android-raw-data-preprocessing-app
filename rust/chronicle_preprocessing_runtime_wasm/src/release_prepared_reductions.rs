//! Bounded retained-source reductions on explicit, complete caller inventories.
//! No pickle/notebook execution, raw days/horizons, timezone, category builders,
//! session FSM, collector availability, or whole-profile admission is provided.
use std::collections::{BTreeMap, BTreeSet};
use serde_json::Value;
use super::{complete_standalone_component_adaptation, phonestudy_median,
    AdaptedLiteratureInput, MethodProfileInputBindingReceipt};
use crate::clear_all_notification_grouping::{filter_active, python_truth};
use crate::count_ratio::{checked_count_sum, construct_named_count_ratios, CountRatioRequest};
use crate::grouped_category_count::count_categories_by_group;
use crate::grouped_distinct_count::{count_distinct_members_by_group, distinct_members_by_group};
use crate::grouped_column_summary::{summarize_columns_by_first_seen_group, GroupedNumericRow};
use crate::grouped_scalar_extrema::finite_scalar_extrema_by_group;
use crate::grouped_scalar_sum_projection::{grouped_scalar_sum_then_project_unique,
    GroupedScalarInput, RCompatibleScalar, SequentialDivisionConfiguration};

pub(super) const STICKY: &str = "chronicle.clear-all-supplied-sticky-reductions";
pub(super) const USER: &str = "chronicle.clear-all-supplied-user-features";
pub(super) const RANK: &str = "chronicle.clear-all-supplied-rank-grid";
pub(super) const BIN: &str = "chronicle.clear-all-supplied-local-bin-mean";
pub(super) const KEYGUARD: &str = "chronicle.keyguard-supplied-day-metrics";
pub(super) const GAP: &str = "chronicle.gap-supplied-session-sets";
pub(super) const HOUR: &str = "chronicle.murnane-supplied-hourly-counts";
pub(super) const BORAPP: &str = "chronicle.borapp-supplied-horizon-reductions";
pub(super) const BEYOND: &str = "chronicle.beyond-supplied-horizon-event-counts";
pub(super) const ADAPTERS: [&str; 9] = [STICKY,USER,RANK,BIN,KEYGUARD,GAP,HOUR,BORAPP,BEYOND];
pub(super) const FIELDS: [&str; 7] = ["source_row_id","participant_id","device_id","scope_id","clock_id","input_stage","payload"];
const STAGE: &str = "source-qualified-complete-supplied-inventory";
pub(super) const OUTPUT_FIELDS: [&str; 12] = ["source_row_id","participant_id","device_id","scope_id","clock_id",
    "output_kind","member","position","value","status","unit","members_json"];

#[derive(Clone)]
struct Input { ids: [String; 5], payload: Value }
struct Outputs { rows: Vec<Vec<String>> }
impl Outputs {
    fn emit(&mut self, row: &Input, kind: &str, member: &str, position: &str,
        value: Option<f64>, metadata: [&str; 3]) {
        let [status, unit, members] = metadata;
        let finite = value.filter(|x| x.is_finite());
        let status = if value.is_some() && finite.is_none() { "arithmetic_unavailable" } else { status };
        let mut result = row.ids.to_vec();
        result.extend([kind.into(),member.into(),position.into(),finite.map(|x| x.to_string()).unwrap_or_default(),
            status.into(),unit.into(),members.into()]);
        self.rows.push(result);
    }
    fn integer(&mut self, row: &Input, kind: &str, member: &str, position: &str, value: u64, unit: &str) {
        let mut result = row.ids.to_vec();
        result.extend([kind.into(),member.into(),position.into(),value.to_string(),"computed".into(),unit.into(),String::new()]);
        self.rows.push(result);
    }
    fn scalar(&mut self, row: &Input, kind: &str, member: &str, position: &str, value: Option<f64>, unit: &str) {
        self.emit(row,kind,member,position,value,[if value.is_some(){"computed"}else{"unavailable_empty_inventory"},unit,""]);
    }
}
fn array<'a>(v: &'a Value, name: &str) -> Result<&'a Vec<Value>,String> {
    v.get(name).and_then(Value::as_array).ok_or_else(|| format!("requires explicit array {name}; absent/null is not known empty"))
}
fn string<'a>(v: &'a Value, name: &str) -> Result<&'a str,String> {
    v.get(name).and_then(Value::as_str).ok_or_else(|| format!("requires literal string {name}"))
}
fn number(v: &Value, name: &str) -> Result<f64,String> {
    let text = string(v,name)?.trim();
    let x = text.parse::<f64>().ok().filter(|x| x.is_finite() && *x >= 0.0)
        .ok_or_else(|| format!("{name} requires complete nonnegative finite supplied binary64 decimal"))?;
    if x == 0.0 && text.split(['e','E']).next().unwrap_or("").chars().any(|c| matches!(c,'1'..='9')) {
        return Err(format!("{name} refuses lexical nonzero parse underflow"));
    }
    Ok(x)
}
fn boolean(v: &Value, name: &str) -> Result<bool,String> {
    v.get(name).and_then(Value::as_bool).ok_or_else(|| format!("requires explicit boolean {name}"))
}
fn count<T>(members: impl IntoIterator<Item=T>) -> u64 {
    count_categories_by_group(members.into_iter().map(|_| ((),()))).first()
        .map(|x| x.observation_count as u64).unwrap_or(0)
}
fn ratio(numerator: u64, denominator: u64) -> Option<f64> {
    construct_named_count_ratios([CountRatioRequest{name:(),numerator,denominator_terms:vec![denominator]}])
        .ok().map(|x| x[0].ratio.value())
}
fn mean(values: &[f64]) -> Result<Option<f64>,String> {
    if values.is_empty() { return Ok(None); }
    let rows = values.iter().map(|x| GroupedNumericRow{group:Some("supplied".into()),values:vec![Some(*x)]}).collect::<Vec<_>>();
    let value = summarize_columns_by_first_seen_group(&rows).map_err(|e|format!("shared mean: {e:?}"))?[0].means[0];
    if value == 0.0 && values.iter().any(|x| *x > 0.0) { return Err("positive mean underflow is unavailable, not known zero".into()); }
    Ok(Some(value))
}
fn sum(values: &[f64]) -> Result<f64,String> {
    if values.is_empty() { return Ok(0.0); }
    let rows = values.iter().map(|x| GroupedScalarInput{entity:(),raw_partition:(),passthrough:(),value:RCompatibleScalar::Finite(*x)}).collect::<Vec<_>>();
    let result = grouped_scalar_sum_then_project_unique(&rows,SequentialDivisionConfiguration{first_divisor:1.0,second_divisor:1.0}, |_|Some(()))
        .map_err(|e|e.to_string())?;
    match result[0].sum { RCompatibleScalar::Finite(x)=>Ok(x), _=>Err("sum arithmetic unavailable".into()) }
}
fn literal_strings(v: &Value, name: &str) -> Result<Vec<String>,String> {
    array(v,name)?.iter().map(|x|x.as_str().map(str::to_owned).ok_or_else(||format!("{name} requires string members, no category/identifier inference"))).collect()
}
fn snapshot_arrays(v: &Value) -> Result<Vec<(&str, &Value)>,String> {
    let mut seen = BTreeSet::new();
    array(v,"snapshots")?.iter().map(|s| {
        let id = string(s,"snapshot_id")?;
        if id.trim().is_empty() || !seen.insert(id) { return Err("requires unique nonblank literal snapshot identity".into()); }
        let active = s.get("Active").ok_or("snapshot requires Active")?;
        active.as_array().ok_or("Active requires explicit array; null is not empty")?;
        Ok((id,active))
    }).collect()
}
fn packages(active: &Value) -> Result<Vec<String>,String> {
    active.as_array().ok_or("Active requires array")?.iter().map(|n|string(n,"packageName").map(str::to_owned)).collect()
}
fn sticky(row: &Input, out: &mut Outputs) -> Result<(u64,u64),String> {
    let snapshots = snapshot_arrays(&row.payload)?;
    let valid = row.payload.get("valid_count").and_then(Value::as_u64).ok_or("requires supplied u64 valid_count; it is not inferred from row presence")?;
    let mut any = Vec::new();
    for (id,active) in &snapshots {
        let members = active.as_array().unwrap();
        let mut sticky_members = Vec::new();
        for n in members {
            let flag = n.get("isClearable").ok_or("raw notification requires isClearable; missing is not false")?;
            if !python_truth(flag) { sticky_members.push(()); }
        }
        let n = count(sticky_members);
        if n > 0 { any.push(()); }
        out.integer(row,"snapshot_sticky_count",id,"",n,"notifications");
        out.integer(row,"snapshot_raw_count",id,"",members.len() as u64,"notifications");
        out.emit(row,"snapshot_sticky_fraction",id,"",ratio(n,members.len() as u64),
            [if members.is_empty(){"undefined_empty_active"}else{"computed"},"fraction",""]);
    }
    let n = count(any);
    out.integer(row,"snapshots_with_any_sticky","","",n,"snapshots");
    out.integer(row,"supplied_valid_count","","",valid,"snapshots");
    out.emit(row,"sticky_snapshot_fraction","","",ratio(n,valid),[if valid==0{"undefined_zero_valid_count"}else{"computed"},"fraction",""]);
    Ok((n,valid))
}
fn sticky_fleet(rows: &[Input], out: &mut Outputs) -> Result<(),String> {
    let first=rows.first().ok_or("requires represented supplied valid-device inventory")?;
    let keys=array(&first.payload,"device_inventory")?.iter().map(|x| {
        let a=x.as_array().filter(|a|a.len()==2).ok_or("device inventory requires participant/device pairs")?;
        Ok((a[0].as_str().ok_or("requires literal participant")?.to_owned(),a[1].as_str().ok_or("requires literal device")?.to_owned()))
    }).collect::<Result<Vec<_>,String>>()?;
    if keys.is_empty() || keys.iter().collect::<BTreeSet<_>>().len()!=keys.len()
        || rows.len()!=keys.len()
        || keys.iter().cloned().collect::<BTreeSet<_>>() != rows.iter().map(|r|(r.ids[1].clone(),r.ids[2].clone())).collect()
        || rows.iter().any(|r| r.ids[3]!=first.ids[3] || r.payload.get("device_inventory")!=first.payload.get("device_inventory")) {
        return Err("requires exact nonempty complete supplied valid-device inventory and analysis scope, with exactly one row per listed participant/device, not admission inferred from row presence".into());
    }
    let mut numerators=Vec::new();let mut denominators=Vec::new();
    for row in rows { let (n,d)=sticky(row,out)?;numerators.push(n);denominators.push(d); }
    let n=checked_count_sum(&numerators).map_err(|e|e.to_string())?;
    let d=checked_count_sum(&denominators).map_err(|e|e.to_string())?;
    let mut aggregate=first.clone();for i in [0,1,2,4] {aggregate.ids[i].clear();}
    out.integer(&aggregate,"fleet_sticky_snapshot_count","","",n,"snapshots");
    out.integer(&aggregate,"fleet_supplied_valid_count","","",d,"snapshots");
    out.emit(&aggregate,"fleet_sticky_snapshot_fraction","","",ratio(n,d),[if d==0{"undefined_zero_valid_count"}else{"computed"},"fraction",""]);
    Ok(())
}
fn user(row: &Input, out: &mut Outputs) -> Result<(),String> {
    let mut counts = Vec::new(); let mut raw_packages = Vec::new();
    for (_,active) in snapshot_arrays(&row.payload)? {
        counts.push(filter_active(active)?.len() as f64);
        raw_packages.extend(packages(active)?);
    }
    out.scalar(row,"mean_grouped_count","","",mean(&counts)?,"notifications");
    out.scalar(row,"median_grouped_count","","",(!counts.is_empty()).then(||phonestudy_median(counts.clone())),"notifications");
    let max = finite_scalar_extrema_by_group(counts.iter().map(|x|((),*x))).map_err(|e|format!("shared maximum: {e:?}"))?.first().map(|x|x.maximum);
    out.scalar(row,"max_grouped_count","","",max,"notifications");
    out.scalar(row,"zero_grouped_fraction","","",ratio(count(counts.iter().filter(|x|**x==0.0)),count(&counts)),"fraction");
    let diversity = count_distinct_members_by_group(raw_packages.into_iter().map(|p|((),p))).first().map(|x|x.distinct_member_count).unwrap_or(0);
    out.integer(row,"raw_package_diversity","","",diversity as u64,"packages");
    Ok(())
}
fn local_bin(row: &Input, out: &mut Outputs) -> Result<(),String> {
    let kind = string(&row.payload,"bin_kind")?;
    let max = match kind { "hour"=>23, "weekday"=>6, _=>return Err("bin_kind requires supplied hour/weekday labels".into()) };
    let bins = array(&row.payload,"bin_inventory")?.iter().map(|x|x.as_u64().ok_or("requires integer local-bin inventory")).collect::<Result<Vec<_>,_>>()?;
    if bins != (0..=max).collect::<Vec<_>>() { return Err("requires complete ordered source bin domain, not an inferred calendar".into()); }
    let mut values = BTreeMap::<u64,Vec<f64>>::new();
    let snapshots = array(&row.payload,"snapshots")?;
    let mut ids = BTreeSet::new();
    for s in snapshots {
        let id=string(s,"snapshot_id")?;
        if id.trim().is_empty() || !ids.insert(id) { return Err("requires unique supplied snapshot IDs".into()); }
        let bin=s.get("local_bin").and_then(Value::as_u64).filter(|x|*x<=max).ok_or("requires source-qualified local bin in domain")?;
        let active=s.get("Active").ok_or("snapshot requires Active")?;
        values.entry(bin).or_default().push(filter_active(active)?.len() as f64);
    }
    for bin in bins { out.scalar(row,"local_bin_grouped_count_mean",kind,&bin.to_string(),mean(values.get(&bin).map(Vec::as_slice).unwrap_or(&[]))?,"notifications"); }
    Ok(())
}

fn rank(rows: &[Input], out: &mut Outputs) -> Result<(),String> {
    // An explicit device/category grid is indispensable for source fillna(0)
    // then device mean. Never infer enrollment or categories from row presence.
    let first=rows.first().ok_or("rank requires explicit supplied device inventory")?;
    let device_inventory=array(&first.payload,"device_inventory")?;
    let device_keys=device_inventory.iter().map(|x| {
        let a=x.as_array().filter(|a|a.len()==2).ok_or("device inventory requires [participant_id,device_id]")?;
        Ok((a[0].as_str().ok_or("device participant ID requires string")?.to_owned(),a[1].as_str().ok_or("device ID requires string")?.to_owned()))
    }).collect::<Result<Vec<_>,String>>()?;
    if device_keys.is_empty() || device_keys.iter().collect::<BTreeSet<_>>().len()!=device_keys.len() { return Err("rank requires nonempty unique complete supplied device inventory".into()); }
    let category_list=literal_strings(&first.payload,"category_inventory")?;
    if category_list.iter().collect::<BTreeSet<_>>().len()!=category_list.len() { return Err("rank refuses duplicate category inventory members".into()); }
    let mapping=first.payload.get("category_map").and_then(Value::as_object).ok_or("requires supplied package category map")?;
    if mapping.values().any(|x|!x.is_string()) { return Err("supplied map values require strings".into()); }
    let keys=rows.iter().map(|r|(r.ids[1].clone(),r.ids[2].clone())).collect::<BTreeSet<_>>();
    if rows.len()!=device_keys.len() || keys != device_keys.iter().cloned().collect() { return Err("rank rows must exactly cover supplied device inventory with exactly one row per listed participant/device; absent is not a known empty device".into()); }
    let mut grid=BTreeMap::<(String,String,usize,String),f64>::new();
    let mut categories_seen=BTreeSet::new();
    for row in rows {
        if row.ids[3]!=first.ids[3]
            || row.payload.get("device_inventory")!=first.payload.get("device_inventory")
            || row.payload.get("category_inventory")!=first.payload.get("category_inventory")
            || row.payload.get("category_map")!=first.payload.get("category_map") {
            return Err("rank requires one unchanged supplied analysis scope/map/device/category inventory".into());
        }
        let snapshots=snapshot_arrays(&row.payload)?;
        if snapshots.is_empty() { return Err("rank device must occur in produced ranking rows; an empty snapshot inventory cannot create ranking UUID membership".into()); }
        let mut observations=Vec::new();
        for (id,active) in &snapshots {
            let grouped=Value::Array(filter_active(active)?);
            let mut vector=packages(&grouped)?.into_iter().take(5).collect::<Vec<_>>();
            vector.resize(5,"_NONE_".into());
            out.emit(row,"snapshot_first_five_padded",id,"",None,["set_vector_transport","packages",&serde_json::to_string(&vector).map_err(|e|e.to_string())?]);
            observations.extend(vector.into_iter().enumerate().map(|(i,p)|(i+1,p)));
        }
        let mut cat_parts=BTreeMap::<(usize,String),Vec<f64>>::new();
        for c in count_categories_by_group(observations) {
            let value=ratio(c.observation_count as u64,snapshots.len() as u64).unwrap();
            out.scalar(row,"position_package_fraction",&c.category,&c.group.to_string(),Some(value),"fraction");
            let category=mapping.get(&c.category).and_then(Value::as_str).unwrap_or("UNKNOWN").to_owned();
            categories_seen.insert(category.clone());
            cat_parts.entry((c.group,category)).or_default().push(value);
        }
        for ((position,category),parts) in cat_parts {
            let value=sum(&parts)?;
            grid.insert((row.ids[1].clone(),row.ids[2].clone(),position,category.clone()),value);
            out.scalar(row,"position_category_fraction",&category,&position.to_string(),Some(value),"fraction");
        }
    }
    if categories_seen != category_list.iter().cloned().collect() { return Err("category inventory must exactly equal categories of supplied produced ranking rows, including supplied pad mapping or UNKNOWN".into()); }
    for position in 1..=5 {
        for category in &category_list {
            let mut values=Vec::new();
            for (participant,device) in &device_keys {
                let value=grid.get(&(participant.clone(),device.clone(),position,category.clone())).copied().unwrap_or(0.0);
                let row=rows.iter().find(|r|&r.ids[1]==participant && &r.ids[2]==device).unwrap();
                out.scalar(row,"complete_device_category_grid",category,&position.to_string(),Some(value),"fraction");
                values.push(value);
            }
            let mut aggregate=first.clone(); for i in [0,1,2,4] {aggregate.ids[i].clear();}
            out.scalar(&aggregate,"device_mean_category_fraction",category,&position.to_string(),mean(&values)?,"fraction");
        }
    }
    Ok(())
}
fn keyguard(row: &Input, out: &mut Outputs) -> Result<(),String> {
    let sessions=array(&row.payload,"sessions")?;
    let unlocks=literal_strings(&row.payload,"unlocks")?;
    let entries=array(&row.payload,"key_entries")?;
    let mut session_ids=BTreeSet::new();let mut locked=Vec::new();let mut unlocked=Vec::new();let mut manual=Vec::new();
    for s in sessions {
        let id=string(s,"session_id")?;
        if id.trim().is_empty() || !session_ids.insert(id) { return Err("requires unique nonblank qualified session IDs".into()); }
        let length=number(s,"length_seconds")?;
        if boolean(s,"unlocked")? { unlocked.push(length); } else { locked.push(length); }
        if boolean(s,"manual_power_off")? { manual.push(()); }
    }
    if unlocks.iter().any(|x|x.trim().is_empty()) || unlocks.iter().collect::<BTreeSet<_>>().len()!=unlocks.len() { return Err("requires distinct supplied unlock occurrence IDs, not a classifier from screenON/session rows".into()); }
    let mut entry_ids=BTreeSet::new();let mut seconds=Vec::new();
    for e in entries {
        let id=string(e,"key_entry_id")?;
        if id.trim().is_empty() || !entry_ids.insert(id) { return Err("requires distinct supplied key-entry IDs".into()); }
        seconds.push(number(e,"seconds")?);
    }
    out.integer(row,"sessions_per_supplied_day","","",count(sessions),"sessions");
    out.integer(row,"unlocks_per_supplied_day","","",count(&unlocks),"unlocks");
    out.scalar(row,"key_entry_seconds_per_supplied_day","","",Some(sum(&seconds)?),"seconds");
    out.scalar(row,"locked_session_mean_length","","",mean(&locked)?,"seconds");
    out.scalar(row,"unlocked_session_mean_length","","",mean(&unlocked)?,"seconds");
    out.integer(row,"manual_power_off_session_count","","",count(&manual),"sessions");
    out.scalar(row,"manual_power_off_all_session_fraction","","",ratio(count(&manual),count(sessions)),"fraction");
    Ok(())
}
fn gap(row: &Input, out: &mut Outputs) -> Result<(),String> {
    for (field,kind) in [("applications","session_application_set"),("categories","session_category_set")] {
        let members=literal_strings(&row.payload,field)?;
        let set=distinct_members_by_group(members.into_iter().map(|x|((),x))).into_iter().next()
            .map(|(_,x)|x).unwrap_or_default();
        out.emit(row,kind,"","",None,["computed_set_membership",field,&serde_json::to_string(&set).map_err(|e|e.to_string())?]);
    }
    Ok(())
}
fn hour(rows: &[Input], out: &mut Outputs) -> Result<(),String> {
    let mut obs=Vec::new(); let mut representatives=BTreeMap::new();
    for row in rows {
        let hour=row.payload.get("local_hour").and_then(Value::as_u64).filter(|x|*x<24).ok_or("requires source-qualified local hour 0..23, no clock construction")?;
        let key=(row.ids[3].clone(),hour);
        representatives.entry(key.clone()).or_insert(row);
        obs.extend(literal_strings(&row.payload,"event_categories")?.into_iter().map(|category|(key.clone(),category)));
    }
    for c in count_categories_by_group(obs) {
        let mut aggregate=representatives[&c.group].clone();for i in [0,1,2,4] {aggregate.ids[i].clear();}
        out.integer(&aggregate,"external_hourly_category_event_count",&c.category,&c.group.1.to_string(),c.observation_count as u64,"usage_events");
    }
    // An explicitly known empty event inventory exports no observed categories;
    // no category×hour grid or availability is synthesized.
    Ok(())
}
fn borapp(row: &Input, out: &mut Outputs) -> Result<(),String> {
    let unlocks=literal_strings(&row.payload,"unlocks")?;
    if unlocks.iter().any(|x|x.trim().is_empty()) || unlocks.iter().collect::<BTreeSet<_>>().len()!=unlocks.len() { return Err("requires distinct caller-admitted unlock IDs within the declared horizon".into()); }
    out.integer(row,"supplied_horizon_unlock_count","","",count(&unlocks),"unlocks");
    for (field,kind) in [("received_byte_increments","received_bytes"),("transmitted_byte_increments","transmitted_bytes")] {
        let values=array(&row.payload,field)?.iter().map(|x|x.as_u64().ok_or_else(||format!("{field} requires supplied u64 increments, not unresolved cumulative counters"))).collect::<Result<Vec<_>,_>>()?;
        let total=checked_count_sum(&values).map_err(|e|e.to_string())?;
        out.integer(row,kind,"","",total,"bytes");
    }
    Ok(())
}
fn beyond(row: &Input, out: &mut Outputs) -> Result<(),String> {
    let event=string(&row.payload,"event")?;let horizon=string(&row.payload,"horizon")?;
    if !matches!((event,horizon),("received_sms","prior_hour")|("app_launch","prior_10_minutes")|("unlock","prior_5_minutes")|("notification_received","supplied_current_day_since_05_00")) {
        return Err("requires one retained primary named event/horizon pair; no generic 197-feature/window constructor".into());
    }
    let events=literal_strings(&row.payload,"event_occurrences")?;
    if events.iter().any(|x|x.trim().is_empty()) || events.iter().collect::<BTreeSet<_>>().len()!=events.len() { return Err("requires distinct source-qualified occurrence IDs; repeated package names are not deduplicated".into()); }
    out.integer(row,"supplied_horizon_event_count",event,horizon,count(&events),"events");
    Ok(())
}

pub(super) fn reduce(adapter: &str, raw: &[u8]) -> Result<(Vec<u8>,usize,usize),String> {
    if !ADAPTERS.contains(&adapter) { return Err("unregistered prepared reduction".into()); }
    let mut reader=csv::ReaderBuilder::new().flexible(false).from_reader(raw);
    let headers=reader.headers().map_err(|e|e.to_string())?.clone();
    if headers.iter().collect::<BTreeSet<_>>().len()!=headers.len() { return Err("refuses duplicate headers".into()); }
    let cols=FIELDS.iter().map(|x|headers.iter().position(|h|h==*x).ok_or_else(||format!("requires {x}"))).collect::<Result<Vec<_>,_>>()?;
    let mut inputs=Vec::new();let mut scopes=BTreeSet::new();
    for record in reader.records() {
        let record=record.map_err(|e|e.to_string())?;
        if cols[..5].iter().any(|c|record[*c].trim().is_empty()) || &record[cols[5]]!=STAGE { return Err("requires nonblank raw lexical scope/clock IDs and exact supplied-complete stage".into()); }
        let ids: [String;5]=std::array::from_fn(|i|record[cols[i]].to_owned());
        let payload=serde_json::from_str::<Value>(&record[cols[6]]).map_err(|e|format!("payload JSON: {e}"))?;
        if !payload.is_object() { return Err("payload requires explicit object".into()); }
        let discriminator=if adapter==HOUR {payload.get("local_hour").map(Value::to_string).unwrap_or_default()}else{String::new()};
        if !scopes.insert((ids[1].clone(),ids[2].clone(),ids[3].clone(),ids[4].clone(),discriminator)) { return Err("refuses duplicate complete scoped inventories; no merge/dedup policy is inferred".into()); }
        inputs.push(Input{ids,payload});
    }
    if inputs.is_empty() { return Err("requires at least one represented complete inventory; absence is not zero".into()); }
    let mut out=Outputs{rows:Vec::new()};
    match adapter {
        STICKY=>sticky_fleet(&inputs,&mut out)?, RANK=>rank(&inputs,&mut out)?, HOUR=>hour(&inputs,&mut out)?,
        _=>for row in &inputs { match adapter {
            USER=>user(row,&mut out)?, BIN=>local_bin(row,&mut out)?,
            KEYGUARD=>keyguard(row,&mut out)?, GAP=>gap(row,&mut out)?, BORAPP=>borapp(row,&mut out)?, BEYOND=>beyond(row,&mut out)?, _=>unreachable!()
        }}
    }
    let mut writer=csv::Writer::from_writer(Vec::new());
    writer.write_record(OUTPUT_FIELDS).map_err(|e|e.to_string())?;
    for row in &out.rows { writer.write_record(row).map_err(|e|e.to_string())?; }
    let bytes=writer.into_inner().map_err(|e|e.to_string())?;
    Ok((bytes,inputs.len(),out.rows.len()))
}
pub(super) fn adapt(adapter: &str, raw: &[u8], digest: &str, bindings: &[MethodProfileInputBindingReceipt]) -> Result<AdaptedLiteratureInput,String> {
    let (bytes,sources,outputs)=reduce(adapter,raw)?;
    let kind=match adapter { STICKY=>"literature-clear-all-supplied-sticky-reductions-csv",USER=>"literature-clear-all-supplied-user-features-csv",
        RANK=>"literature-clear-all-supplied-rank-grid-csv",BIN=>"literature-clear-all-supplied-local-bin-mean-csv",
        KEYGUARD=>"literature-keyguard-supplied-day-metrics-csv",GAP=>"literature-gap-supplied-session-sets-csv",
        HOUR=>"literature-murnane-supplied-hourly-counts-csv",BORAPP=>"literature-borapp-supplied-horizon-reductions-csv",
        BEYOND=>"literature-beyond-supplied-horizon-event-counts-csv",_=>unreachable!() };
    complete_standalone_component_adaptation(adapter,kind,digest,bindings,sources,outputs,bytes)
}

#[cfg(test)]
#[path = "release_prepared_reductions_conformance.rs"]
mod conformance;

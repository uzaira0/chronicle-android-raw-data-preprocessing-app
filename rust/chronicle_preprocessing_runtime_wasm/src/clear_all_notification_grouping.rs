//! Released ClearAll shared.py:11–38, SHA256
//! ad1057116365d0aac16cc585d567c8a70814916035b3f4d9038841df0d346a16.
//! Only the pure filter_active function is reused, not its pickle-loading module.

use std::collections::BTreeMap;
use serde_json::Value;

// Python truth testing on the supported JSON domain, not a lexical bool parser.
pub(crate) fn python_truth(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

pub(crate) fn filter_active(active: &Value) -> Result<Vec<Value>, String> {
    let members = active.as_array().ok_or("Active must be a JSON array")?;
    let mut groups = BTreeMap::<String, (usize, bool)>::new();
    let mut identities = Vec::with_capacity(members.len());
    for (index, member) in members.iter().enumerate() {
        let member = member.as_object().ok_or_else(|| format!("Active[{index}] must be an object"))?;
        let package = member.get("packageName").and_then(Value::as_str)
            .ok_or_else(|| format!("Active[{index}].packageName must be a string"))?;
        let group = match member.get("groupKeyCompat") {
            None => "",
            Some(value) => value.as_str().ok_or_else(|| format!("Active[{index}].groupKeyCompat must be a string when present; null is not absence"))?,
        };
        let summary = member.get("isGroupSummaryCompat")
            .ok_or_else(|| format!("Active[{index}] requires isGroupSummaryCompat"))?;
        // No separator: distinct package/group pairs can intentionally collide.
        let key = format!("{package}{group}");
        let is_summary = python_truth(summary);
        let entry = groups.entry(key.clone()).or_default();
        entry.0 += 1;
        entry.1 |= is_summary;
        identities.push((key, is_summary));
    }
    Ok(members.iter().zip(identities).filter_map(|(member, (key, is_summary))| {
        let (count, has_summary) = groups[&key];
        (count == 1 || (has_summary && is_summary) || !has_summary).then(|| member.clone())
    }).collect())
}

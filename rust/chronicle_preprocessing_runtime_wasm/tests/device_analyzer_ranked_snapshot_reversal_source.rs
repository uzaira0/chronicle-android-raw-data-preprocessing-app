use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

const SOURCE_FIXTURE: &str = include_str!("fixtures/device_analyzer_ranked_snapshot_reversal.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    exact_canonical_settings: Vec<CanonicalSetting>,
    source_artifacts: Vec<SourceArtifact>,
    maximum_tasks: usize,
    input_boundary: String,
    output_boundary: String,
    rows: Vec<RankedRow>,
    expected_source_row_ids: Vec<String>,
    limitations: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSetting {
    setting_id: String,
    parameter_key: String,
    source_observed_setting: String,
    source_value_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArtifact {
    locator: String,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RankedRow {
    source_row_id: String,
    entity_id: String,
    snapshot_id: String,
    raw_key: String,
    component_value: String,
}

fn canonical_rank(raw_key: &str) -> Result<usize, &'static str> {
    let raw_rank = raw_key
        .strip_prefix("app|recent|")
        .ok_or("app_recent_key_required")?;
    if raw_rank.is_empty()
        || !raw_rank.bytes().all(|byte| byte.is_ascii_digit())
        || (raw_rank.len() > 1 && raw_rank.starts_with('0'))
    {
        return Err("canonical_zero_based_rank_required");
    }
    raw_rank
        .parse::<usize>()
        .map_err(|_| "canonical_zero_based_rank_required")
}

fn reverse_ranked_snapshots(
    rows: &[RankedRow],
    maximum_tasks: usize,
) -> Result<Vec<RankedRow>, &'static str> {
    let mut first_seen_snapshots = Vec::<(&str, &str)>::new();
    let mut grouped = BTreeMap::<(&str, &str), Vec<(usize, &RankedRow)>>::new();
    let mut seen_ranks = BTreeMap::<(&str, &str), BTreeSet<usize>>::new();

    for row in rows {
        if row.source_row_id.trim().is_empty()
            || row.entity_id.trim().is_empty()
            || row.snapshot_id.trim().is_empty()
            || row.component_value.is_empty()
        {
            return Err("required_ranked_snapshot_field_missing");
        }
        let rank = canonical_rank(&row.raw_key)?;
        if rank >= maximum_tasks {
            return Err("rank_exceeds_snapshot_capacity");
        }
        let snapshot_key = (row.entity_id.as_str(), row.snapshot_id.as_str());
        if !grouped.contains_key(&snapshot_key) {
            first_seen_snapshots.push(snapshot_key);
        }
        if !seen_ranks.entry(snapshot_key).or_default().insert(rank) {
            return Err("duplicate_rank_within_snapshot");
        }
        grouped.entry(snapshot_key).or_default().push((rank, row));
    }

    let mut output = Vec::with_capacity(rows.len());
    let mut previous_snapshot_by_entity = BTreeMap::new();
    for (entity_id, snapshot_id) in first_seen_snapshots {
        let ranked = grouped
            .get_mut(&(entity_id, snapshot_id))
            .expect("first-seen snapshot has grouped rows");
        ranked.sort_by_key(|(rank, _)| std::cmp::Reverse(*rank));
        let signature: Vec<_> = ranked
            .iter()
            .map(|(rank, row)| (*rank, row.component_value.as_str()))
            .collect();
        if previous_snapshot_by_entity.get(entity_id) == Some(&signature) {
            continue;
        }
        previous_snapshot_by_entity.insert(entity_id, signature);
        output.extend(ranked.iter().map(|(_, row)| (*row).clone()));
    }
    Ok(output)
}

#[test]
fn device_analyzer_snapshot_rows_reverse_to_oldest_first_without_inventing_delta_logic() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("valid source fixture");

    assert_eq!(
        fixture.schema_version,
        "chronicle-device-analyzer-ranked-snapshot-reversal-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1145/2638728.2641700");
    assert_eq!(fixture.maximum_tasks, 10);
    assert!(fixture.input_boundary.contains("app|recent|N"));
    assert!(fixture
        .output_boundary
        .contains("largest source rank to rank zero"));
    assert_eq!(fixture.source_artifacts.len(), 3);
    assert_eq!(
        fixture
            .exact_canonical_settings
            .iter()
            .map(|setting| setting.setting_id.as_str())
            .collect::<Vec<_>>(),
        [
            "method-setting-804c0c3ca2c4ade88c9ae815",
            "method-setting-a5986bb34d2c98401a017ece",
            "atomic-f8ea5a33f3fcccb1fa06f145",
            "method-setting-9383da8ffcad6889d1b1845a",
            "method-setting-1266e78e4cb2fec463919751",
        ]
    );
    assert!(fixture.exact_canonical_settings.iter().all(|setting| {
        !setting.parameter_key.is_empty()
            && setting
                .source_observed_setting
                .starts_with(&setting.parameter_key)
            && setting.source_value_sha256.len() == 64
    }));
    assert!(fixture
        .source_artifacts
        .iter()
        .all(|artifact| { !artifact.locator.is_empty() && artifact.sha256.len() == 64 }));
    assert!(fixture
        .limitations
        .iter()
        .any(|limitation| limitation.contains("does not infer launches")));

    let output = reverse_ranked_snapshots(&fixture.rows, fixture.maximum_tasks)
        .expect("source-shaped ranked snapshots are valid");
    assert_eq!(
        output
            .iter()
            .map(|row| row.source_row_id.as_str())
            .collect::<Vec<_>>(),
        fixture.expected_source_row_ids
    );

    let invalid = |raw_key: &str| RankedRow {
        source_row_id: "bad-row".into(),
        entity_id: "bad-device".into(),
        snapshot_id: "bad-snapshot".into(),
        raw_key: raw_key.into(),
        component_value: "opaque/component".into(),
    };
    assert_eq!(
        reverse_ranked_snapshots(&[invalid("app|running|0")], 10),
        Err("app_recent_key_required")
    );
    assert_eq!(
        reverse_ranked_snapshots(&[invalid("app|recent|01")], 10),
        Err("canonical_zero_based_rank_required")
    );
    assert_eq!(
        reverse_ranked_snapshots(&[invalid("app|recent|10")], 10),
        Err("rank_exceeds_snapshot_capacity")
    );

    let duplicate_rank = vec![
        invalid("app|recent|0"),
        RankedRow {
            source_row_id: "bad-row-2".into(),
            ..invalid("app|recent|0")
        },
    ];
    assert_eq!(
        reverse_ranked_snapshots(&duplicate_rank, 10),
        Err("duplicate_rank_within_snapshot")
    );
}

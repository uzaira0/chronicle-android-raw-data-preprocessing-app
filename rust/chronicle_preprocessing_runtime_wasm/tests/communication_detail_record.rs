#[path = "../src/communication_detail_record.rs"]
mod communication_detail_record;

use communication_detail_record::{
    parse_joint_voice_sms_communication_details, CommunicationDetailRecord,
    CommunicationDetailRecordParseError, CommunicationModality,
    COMMUNICATION_DETAIL_REQUIRED_FIELDS,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const SOURCE_FIXTURE: &str =
    include_str!("fixtures/communication_detail_record_asonam_2012_243.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source_work_id: String,
    source_sha256: String,
    source_locator: String,
    exact_canonical_setting_ids: Vec<String>,
    superseded_atomic_setting_ids: Vec<String>,
    alias_resolution: String,
    alias_tombstone_registry_sha256: String,
    canonical_parameter_key: String,
    canonical_value: Vec<String>,
    canonical_value_sha256: String,
    configuration_relation: String,
    input_boundary: String,
    output_boundary: String,
    limitations: Vec<String>,
    valid_csv_lines: Vec<String>,
    expected_records: Vec<ExpectedRecord>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExpectedRecord {
    source_record_index: usize,
    endpoint_1_id: String,
    endpoint_2_id: String,
    modality: String,
}

impl From<CommunicationDetailRecord> for ExpectedRecord {
    fn from(record: CommunicationDetailRecord) -> Self {
        Self {
            source_record_index: record.source_record_index,
            endpoint_1_id: record.endpoint_1_id,
            endpoint_2_id: record.endpoint_2_id,
            modality: match record.modality {
                CommunicationModality::VoiceCall => "voice_call",
                CommunicationModality::Sms => "sms",
            }
            .to_owned(),
        }
    }
}

fn csv_bytes(lines: &[String]) -> Vec<u8> {
    let mut text = lines.join("\n");
    text.push('\n');
    text.into_bytes()
}

fn required_csv(rows: &[&str]) -> Vec<u8> {
    format!(
        "{}\n{}\n",
        COMMUNICATION_DETAIL_REQUIRED_FIELDS.join(","),
        rows.join("\n")
    )
    .into_bytes()
}

fn canonical_value_sha256(parameter_key: &str, value: &[String]) -> String {
    let value_json = serde_json::to_string(value).expect("canonical value JSON");
    hex::encode(Sha256::digest(
        format!("{parameter_key}: {value_json}").as_bytes(),
    ))
}

#[test]
fn joint_call_sms_records_preserve_only_the_source_disclosed_edge_input() {
    let fixture: Fixture = serde_json::from_str(SOURCE_FIXTURE).expect("T13 fixture JSON");
    assert_eq!(
        fixture.schema_version,
        "chronicle-communication-detail-record-source-fixture/v1"
    );
    assert_eq!(fixture.source_work_id, "doi:10.1109/asonam.2012.243");
    assert_eq!(
        fixture.source_sha256,
        "2d4bc1f05b67b22cc03516ec6a2196f11ea59007d94ce82ae2fc11194e3a8202"
    );
    assert!(fixture
        .source_locator
        .ends_with("2012_AppleAndroid_Battle-layout.txt:11-27,54-60"));
    assert_eq!(
        fixture.exact_canonical_setting_ids,
        ["method-setting-41abbf6fc27ea43b4d3bed16"]
    );
    assert_eq!(
        fixture.superseded_atomic_setting_ids,
        [
            "atomic-20db0381cd44cff94ed9ae8a",
            "atomic-ab0e1633de7c3e6618b20379",
        ]
    );
    assert_eq!(fixture.alias_resolution, "superseded_by");
    assert_eq!(
        fixture.alias_tombstone_registry_sha256,
        "018221f6036218887355a0a2dcd9d6d54a9e90eb93f380b4e1b81cc75c0f76b5"
    );
    assert_eq!(fixture.canonical_parameter_key, "network.records");
    assert_eq!(
        fixture.canonical_value,
        [
            "carrier voice-call detail records",
            "carrier SMS detail records",
        ]
    );
    assert_eq!(
        fixture.canonical_value_sha256,
        "6d43e8cd56c2b953c8d6317893b49d24eb37f0d4ea748badb971185104971698"
    );
    assert_eq!(
        canonical_value_sha256(&fixture.canonical_parameter_key, &fixture.canonical_value),
        fixture.canonical_value_sha256
    );
    assert_eq!(fixture.configuration_relation, "joint_input_set");
    assert!(fixture.input_boundary.contains("already-deidentified"));
    assert!(fixture.output_boundary.contains("later"));
    for undisclosed in [
        "timestamp",
        "direction",
        "duration",
        "weight",
        "deduplication",
    ] {
        assert!(fixture
            .limitations
            .iter()
            .any(|limitation| limitation.contains(undisclosed)));
    }

    let actual = parse_joint_voice_sms_communication_details(&csv_bytes(&fixture.valid_csv_lines))
        .expect("valid joint voice-call/SMS carrier input")
        .into_iter()
        .map(ExpectedRecord::from)
        .collect::<Vec<_>>();
    assert_eq!(actual, fixture.expected_records);
    assert_eq!(actual[1].endpoint_1_id, "subscriber-b");
    assert_eq!(actual[2].endpoint_1_id, "subscriber-a");
    assert_eq!(actual[2].source_record_index, 3);
    assert_eq!(actual[3].source_record_index, 4);
    assert_eq!(actual[2].endpoint_1_id, actual[3].endpoint_1_id);
    assert_eq!(actual[2].endpoint_2_id, actual[3].endpoint_2_id);
    assert_eq!(actual[2].modality, actual[3].modality);
}

#[test]
fn required_fields_and_unknown_modalities_fail_closed() {
    for missing in COMMUNICATION_DETAIL_REQUIRED_FIELDS {
        let headers = COMMUNICATION_DETAIL_REQUIRED_FIELDS
            .iter()
            .copied()
            .filter(|field| *field != missing)
            .collect::<Vec<_>>();
        let row = headers
            .iter()
            .map(|field| match *field {
                "endpoint_1_id" => "a",
                "endpoint_2_id" => "b",
                "communication_modality" => "voice_call",
                _ => unreachable!(),
            })
            .collect::<Vec<_>>();
        let input = format!("{}\n{}\n", headers.join(","), row.join(","));
        let error = parse_joint_voice_sms_communication_details(input.as_bytes())
            .expect_err("missing required column must fail");
        assert!(error.to_string().contains(missing));
    }

    for (field, row) in [
        ("endpoint_1_id", ",b,voice_call\na,b,sms"),
        ("endpoint_2_id", "a,,voice_call\na,b,sms"),
        ("communication_modality", "a,b,\na,b,sms"),
    ] {
        let error = parse_joint_voice_sms_communication_details(&required_csv(&[row]))
            .expect_err("empty required value must fail");
        assert!(error.to_string().contains(field), "{field}: {error}");
    }

    let unknown = parse_joint_voice_sms_communication_details(&required_csv(&[
        "a,b,voice_call",
        "a,b,text_message",
    ]))
    .expect_err("undisclosed modality aliases must not be guessed");
    assert!(matches!(
        unknown,
        CommunicationDetailRecordParseError::UnknownModality { .. }
    ));

    let duplicate_column = parse_joint_voice_sms_communication_details(
        b"endpoint_1_id,endpoint_2_id,communication_modality,endpoint_1_id\na,b,sms,c\n",
    )
    .expect_err("duplicate schema columns must fail");
    assert!(matches!(
        duplicate_column,
        CommunicationDetailRecordParseError::DuplicateColumn(ref field)
            if field == "endpoint_1_id"
    ));

    assert!(parse_joint_voice_sms_communication_details(
        format!("{}\n", COMMUNICATION_DETAIL_REQUIRED_FIELDS.join(",")).as_bytes(),
    )
    .expect("a valid carrier extract may contain zero observed records")
    .is_empty());

    assert_eq!(
        parse_joint_voice_sms_communication_details(&required_csv(&["a,b,voice_call"]))
            .expect("a participant may have no observed SMS records")
            .len(),
        1
    );
    assert_eq!(
        parse_joint_voice_sms_communication_details(&required_csv(&["a,b,sms"]))
            .expect("a participant may have no observed voice-call records")
            .len(),
        1
    );
}

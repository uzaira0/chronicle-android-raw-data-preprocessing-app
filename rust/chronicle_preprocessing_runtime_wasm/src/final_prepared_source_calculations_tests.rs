use super::*;

#[test]
fn final_prepared_registered_routes_replay_all_seven_source_hand_cases_and_refuse_forged_tuples() {
    let hand: Value = serde_json::from_str(include_str!(
        "../tests/fixtures/final_prepared_source_calculations.json"
    ))
    .unwrap();
    let manifest: ConformanceManifest =
        serde_json::from_str(crate::packed_json::ADAPTER_CONFORMANCE.text().unwrap()).unwrap();
    let cases = hand["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    let contract = contract_by_setting().unwrap();
    for expected in cases {
        let id = expected["methodSettingId"].as_str().unwrap();
        let group = manifest
            .groups
            .iter()
            .find(|g| g.adapter_id == expected["adapterId"])
            .unwrap();
        let case = group
            .cases
            .iter()
            .find(|c| c.method_setting_id == id)
            .unwrap();
        let registration = &contract[id];
        let component = registration.component_execution.as_ref().unwrap();
        assert_eq!(component.full_profile_execution_status, "blocked");
        assert_eq!(case.source_value, expected["sourceValue"]);
        assert_eq!(case.source_work_id, expected["sourceWorkId"]);
        assert_eq!(
            component.source_method_variant_id,
            expected["sourceMethodVariantId"]
        );
        let raw = fixture_input(case).unwrap();
        let raw_digest = sha256(&raw);
        let identity = execute_conformance_case(
            group,
            case,
            registration,
            &manifest.source_method_variants[id],
        )
        .unwrap();
        let mut binding = conformance_case_binding(case, registration);
        binding.conformance_result_digest = identity.result_digest;
        let adapted = adapt_literature_inputs(&raw, &raw_digest, &[binding.clone()], |_| &[])
            .unwrap()
            .unwrap();
        assert_eq!(adapted.receipt.original_input_digest, raw_digest);
        assert_eq!(
            adapted.receipt.adapted_input_digest,
            sha256(&adapted.csv_bytes)
        );
        assert_eq!(
            adapted.derived_result_bytes.as_ref().unwrap(),
            &adapted.csv_bytes
        );
        let actual = csv::Reader::from_reader(adapted.csv_bytes.as_slice())
            .records()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        let expected_rows = expected["expectedRows"].as_array().unwrap();
        assert_eq!(actual.len(), expected_rows.len(), "{id}");
        for (actual, expected) in actual.iter().zip(expected_rows) {
            let prefix = expected
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                actual.iter().take(prefix.len()).collect::<Vec<_>>(),
                prefix,
                "{id}"
            );
        }
        binding.source_value = Value::String("forged source operation".into());
        assert!(adapt_literature_inputs(&raw, &raw_digest, &[binding], |_| &[]).is_err());
    }
}

#[test]
fn rapids_screen_registered_route_replays_all_source_hand_cases_and_refuses_forged_tuple() {
    let hand: Value = serde_json::from_str(include_str!(
        "../tests/fixtures/rapids_released_screen_episodes_hand.json"
    ))
    .unwrap();
    let manifest: ConformanceManifest =
        serde_json::from_str(crate::packed_json::ADAPTER_CONFORMANCE.text().unwrap()).unwrap();
    let id = "method-setting-c24027f66c4d4d9c8bc0e66b";
    let group = manifest
        .groups
        .iter()
        .find(|g| g.adapter_id == "chronicle.rapids-released-screen-episodes/v1")
        .unwrap();
    let case = group
        .cases
        .iter()
        .find(|c| c.method_setting_id == id)
        .unwrap();
    let contract = contract_by_setting().unwrap();
    let registration = &contract[id];
    let component = registration.component_execution.as_ref().unwrap();
    assert_eq!(component.full_profile_execution_status, "blocked");
    assert_eq!(case.source_value, hand["sourceValue"]);
    assert_eq!(case.source_work_id, hand["sourceWorkId"]);
    assert_eq!(
        component.source_method_variant_id,
        hand["sourceMethodVariantId"]
    );
    let identity = execute_conformance_case(
        group,
        case,
        registration,
        &manifest.source_method_variants[id],
    )
    .unwrap();
    let mut binding = conformance_case_binding(case, registration);
    binding.conformance_result_digest = identity.result_digest;
    let cases = hand["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 17);
    for expected in cases {
        let lines = expected["rawCsvLines"].as_array().unwrap();
        let raw = format!(
            "{}\n",
            lines
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>()
                .join("\n")
        );
        let raw_digest = sha256(raw.as_bytes());
        let adapted =
            adapt_literature_inputs(raw.as_bytes(), &raw_digest, &[binding.clone()], |_| &[])
                .unwrap()
                .unwrap();
        assert_eq!(adapted.receipt.original_input_digest, raw_digest);
        assert_eq!(adapted.receipt.source_row_count as usize, lines.len() - 1);
        assert_eq!(
            adapted.receipt.adapted_input_digest,
            sha256(&adapted.csv_bytes)
        );
        assert_eq!(
            adapted.derived_result_bytes.as_ref().unwrap(),
            &adapted.csv_bytes
        );
        let actual = csv::Reader::from_reader(adapted.csv_bytes.as_slice())
            .records()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        let expected_rows = expected["expectedRows"].as_array().unwrap();
        assert_eq!(actual.len(), expected_rows.len(), "{}", expected["caseId"]);
        for (actual, expected_row) in actual.iter().zip(expected_rows) {
            assert_eq!(
                actual.iter().collect::<Vec<_>>(),
                expected_row
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<Vec<_>>(),
                "{}",
                expected["caseId"]
            );
        }
    }
    binding.source_value = Value::String("forged source operation".into());
    let raw = fixture_input(case).unwrap();
    assert!(adapt_literature_inputs(&raw, &sha256(&raw), &[binding], |_| &[]).is_err());
}

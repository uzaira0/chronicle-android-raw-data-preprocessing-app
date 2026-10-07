import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LiteratureComponentResultPanel } from "@/components/LiteratureComponentResultPanel";
import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
} from "@/lib/literatureInputAdapters";
import {
  literatureComponentWorkspaceId,
  type LiteratureComponentRuntimeExecution,
} from "@/lib/rustPipelineRuntime";

const EXPECTED = [
  {
    semanticType: "shin_prepared_no_app_day",
    componentId: "chronicle.shin-prepared-no-app-day/v1",
    sourceWorkId: "doi:10.1145/2493432.2493443",
    derivedResultKind: "literature-shin-prepared-no-app-day-csv",
    settingIds: ["method-setting-c2161bf97214a0eabe74d209", "method-setting-40d8673b39c3f146052758aa"],
  },
  {
    semanticType: "hamilton_supplied_no_use_hour_policy",
    componentId: "chronicle.hamilton-supplied-no-use-hour-policy/v1",
    sourceWorkId: "doi:10.1007/s41347-024-00443-5",
    derivedResultKind: "literature-hamilton-supplied-no-use-hour-policy-csv",
    settingIds: ["method-setting-55f7979f94701fb0a8171ee5"],
  },
  {
    semanticType: "notification_seen_time",
    componentId: "chronicle.notification-seen-time/v1",
    sourceWorkId: "doi:10.1145/3131901",
    derivedResultKind: "literature-notification-seen-time-csv",
    settingIds: [
      "method-setting-19df120d26b64e11efb807ab",
      "method-setting-74d0f04af4fa8ee64ddd9b81",
      "method-setting-f095986a1bdd7eb9f5ce9b0d",
    ],
  },
  {
    semanticType: "touch_keyboard_event_vector",
    componentId: "chronicle.touch-keyboard-event-vector/v1",
    sourceWorkId: "doi:10.1109/acii.2019.8925518",
    derivedResultKind: "literature-touch-keyboard-event-vector-csv",
    settingIds: [
      "method-setting-293e63181b72ee0e0b7cc5bc",
      "method-setting-54dfd51fa90147857f7f2522",
      "method-setting-7d8c397698c8e6a833b3f65f",
      "method-setting-a2b695eb8449919ee41d5b04",
      "method-setting-d46f6478867dec906dac2b80",
      "method-setting-e6ca0f6eda4ab9ca31f87d46",
      "method-setting-ea0c43ce79fd78c9089ee6a7",
    ],
  },
  {
    semanticType: "motion_sensor_vector",
    componentId: "chronicle.motion-sensor-vector/v1",
    sourceWorkId: "doi:10.1016/j.inffus.2018.09.002",
    derivedResultKind: "literature-motion-sensor-vector-csv",
    settingIds: [
      "method-setting-cf5961c49b8d305a459526ee",
      "method-setting-9a8ba59dc00b30423cf610e8",
      "method-setting-1d31b1e737addc50136f27ed",
    ],
  },
  {
    semanticType: "timestamp_correction",
    componentId: "chronicle.timestamp-correction/v1",
    sourceWorkId: "doi:10.1016/j.chb.2023.107977",
    derivedResultKind: "literature-timestamp-correction-csv",
    settingIds: [
      "method-setting-89f718192c3ca086dcaa99c5",
      "method-setting-f023abce9be53100e2dd22a6",
      "method-setting-8e387e15b09a02c6d5c2f942",
      "method-setting-cb3bf10d6500476969672b53",
      "method-setting-071995a6e078e7c57832d3a6",
    ],
  },
  {
    semanticType: "aggregated_app_observation",
    componentId: "chronicle.aggregated-app-observation/v1",
    sourceWorkId: "doi:10.1038/s41598-019-47493-x",
    derivedResultKind: "literature-aggregated-app-observation-csv",
    settingIds: ["method-setting-7cc86be8b942308cd15285e8"],
  },
  {
    semanticType: "communication_detail_record",
    componentId: "chronicle.communication-detail-record/v1",
    sourceWorkId: "doi:10.1109/asonam.2012.243",
    derivedResultKind: "literature-communication-detail-record-csv",
    settingIds: ["method-setting-41abbf6fc27ea43b4d3bed16"],
  },
  {
    semanticType: "participant_day_duration_exclusion",
    componentId: "chronicle.participant-day-duration-exclusion/v1",
    sourceWorkId: "doi:10.1186/s13104-015-1280-z",
    derivedResultKind: "literature-participant-day-duration-exclusion-csv",
    settingIds: ["method-setting-dd064a91f6fa5b9b002f5984"],
  },
  {
    semanticType: "date_count_conjunction_exclusion",
    componentId: "chronicle.date-count-conjunction-exclusion/v1",
    sourceWorkId: "doi:10.1016/j.chb.2023.107977",
    derivedResultKind: "literature-date-count-conjunction-exclusion-csv",
    settingIds: ["method-setting-9c709fc6db3b34ad6ee17557"],
  },
  {
    semanticType: "participation_day_warmup",
    componentId: "chronicle.participation-day-warmup/v1",
    sourceWorkId: "doi:10.1145/3544548.3580689",
    derivedResultKind: "literature-participation-day-warmup-csv",
    settingIds: ["method-setting-50d746b62ee05404bbbfaac8"],
  },
  {
    semanticType: "fixed_weekly_self_report_cap",
    componentId: "chronicle.fixed-weekly-self-report-cap/v1",
    sourceWorkId: "doi:10.30773/pi.2020.0197",
    derivedResultKind: "literature-fixed-weekly-self-report-cap-csv",
    settingIds: [
      "method-setting-71f115f4d10a7a596fcaa44c",
      "method-setting-8635523f80433dc441372044",
    ],
  },
  {
    semanticType: "esm_app_sampling_gate",
    componentId: "chronicle.esm-app-sampling-gate/v1",
    sourceWorkId: "doi:10.1145/3191754",
    derivedResultKind: "literature-esm-app-sampling-gate-csv",
    settingIds: [
      "method-setting-637f4a759da2b57b320dc1a9",
      "method-setting-e53245d4f933ef1951b8bd61",
      "method-setting-89b295319a78af875144a91f",
      "method-setting-984ba339b7d47ce4ae74beb2",
    ],
  },
  {
    semanticType: "screen_academic_row_derivation",
    componentId: "chronicle.screen-academic-row-derivation/v1",
    sourceWorkId: "doi:10.1177/0956797620956613",
    derivedResultKind: "literature-screen-academic-row-derivation-csv",
    settingIds: [
      "method-setting-5c3f17fb0b99a68bb5b58faf",
      "method-setting-7ff8cbc41656ef587e3ce315",
      "method-setting-1be0e5d48ec456488904f8f8",
      "method-setting-d7bf0f48272d6fcce11546f9",
      "method-setting-8d69ae47ccd24603e4d86d9e",
      "method-setting-2c2fd81770205f5258803415",
      "method-setting-c5050ba0fae976cbebaa7bf2",
    ],
  },
  {
    semanticType: "iterative_sparse_group_filter",
    componentId: "chronicle.iterative-sparse-group-filter/v1",
    sourceWorkId: "doi:10.1177/0956797620956613",
    derivedResultKind: "literature-iterative-sparse-group-filter-csv",
    settingIds: ["method-setting-d6ec2c28ae4396099857ded7"],
  },
  {
    semanticType: "adjacent_record_duplicate",
    componentId: "chronicle.adjacent-record-duplicate/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-adjacent-record-duplicate-csv",
    settingIds: ["method-setting-f1f151152a7cb4f59ba26374"],
  },
  {
    semanticType: "integer_daypart_bucketizer",
    componentId: "chronicle.integer-daypart-bucketizer/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-integer-daypart-bucketizer-csv",
    settingIds: [
      "method-setting-4b06de7d35a34616aee5aca2",
      "method-setting-7adc9afe3c538cfce5178098",
      "method-setting-3dfc3bf4a0f57e0105cecec5",
      "method-setting-628b56b16dfe48e03f221cd0",
    ],
  },
  {
    semanticType: "hourly_distinct_member_count",
    componentId: "chronicle.hourly-distinct-member-count/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-hourly-distinct-member-count-csv",
    settingIds: ["method-setting-9d9b2409732251983bc1658d"],
  },
  {
    semanticType: "daily_distinct_member_count",
    componentId: "chronicle.daily-distinct-member-count/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-daily-distinct-member-count-csv",
    settingIds: ["method-setting-3a39bfe2f5f374a5a1dadc13"],
  },
  {
    semanticType: "hourly_categorical_mode",
    componentId: "chronicle.hourly-categorical-mode/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-hourly-categorical-mode-csv",
    settingIds: [
      "method-setting-30a656701f4f3ab15c76e2f6",
      "method-setting-4ba32f01e20f10d7a52c7259",
    ],
  },
  {
    semanticType: "categorical_response_rate",
    componentId: "chronicle.categorical-response-rate/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-categorical-response-rate-csv",
    settingIds: [
      "method-setting-89f05ccdfebf96d26c4dac88",
      "method-setting-5facd691213333bd0e7a5c8d",
      "method-setting-7cdca72ce4ba1dae3e06c65d",
    ],
  },
  {
    semanticType: "duration_span_window_projection",
    componentId: "chronicle.duration-span-window-projection/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-duration-span-window-projection-csv",
    settingIds: ["method-setting-41cd423bea34eb27d528548b"],
  },
  {
    semanticType: "grouped_column_summary",
    componentId: "chronicle.grouped-column-summary/v1",
    sourceWorkId: "doi:10.1177/2050157921993896",
    derivedResultKind: "literature-grouped-column-summary-csv",
    settingIds: [
      "method-setting-f8153027f090225acb723955",
      "method-setting-892d9b6b5121e2bf37c75722",
    ],
  },
  {
    semanticType: "call_state_summary",
    componentId: "chronicle.call-state-summary/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-call-state-summary-csv",
    settingIds: [
      "method-setting-4076eae725c960ecbe100733",
      "method-setting-2a03e83df7b172a01f2f79ac",
      "method-setting-fab7ec8a3c91721486072c70",
      "method-setting-c4e83c85eeecb32c9bb15808",
      "method-setting-f037a13808ebed4bdf17177c",
    ],
  },
  {
    semanticType: "call_duration_summary",
    componentId: "chronicle.call-duration-summary/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-call-duration-summary-csv",
    settingIds: [
      "method-setting-7a424fa095bbb01fe0436a78",
      "method-setting-4df11f716c5968d5e6f3a76a",
      "method-setting-763c45045b37b0a8a4e1120b",
    ],
  },
  {
    semanticType: "grouped_category_count",
    componentId: "chronicle.grouped-category-count/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-grouped-category-count-csv",
    settingIds: [
      "method-setting-50478a371ba022b67e2e5dc6",
      "method-setting-66cceba329f0393e7d73f395",
      "method-setting-473c8f4c5145e4c2332cc28a",
      "method-setting-c2e09f6fb72e82a070824d46",
      "method-setting-780c2f0eb3dd7067b0774dfe",
    ],
  },
  {
    semanticType: "grouped_scalar_extrema",
    componentId: "chronicle.grouped-scalar-extrema/v1",
    sourceWorkId: "doi:10.2196/26540",
    derivedResultKind: "literature-grouped-scalar-extrema-csv",
    settingIds: [
      "method-setting-14cb0448e56480a00b2d0400",
      "method-setting-bb801a6f54629c17a9364a0a",
      "method-setting-92122010fb7d055d808726d2",
    ],
  },
  {
    semanticType: "scan_signal_proximity_summary",
    componentId: "chronicle.scan-signal-proximity-summary/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-scan-signal-proximity-summary-csv",
    settingIds: [
      "method-setting-7e3f8a2bea952e5643083e97",
      "method-setting-6f388e47ce29e465d8760b64",
      "method-setting-a757d043298bc2ecdb4767f1",
      "method-setting-9de0ec641dcc228c19b43819",
    ],
  },
  {
    semanticType: "finite_scalar_pivot_classifier",
    componentId: "chronicle.finite-scalar-pivot-classifier/v1",
    sourceWorkId: "doi:10.1109/socialcom.2013.118",
    derivedResultKind: "literature-finite-scalar-pivot-classifier-csv",
    settingIds: [
      "method-setting-859db1341c366e052b69daed",
      "method-setting-0e72d6265ee03fcb1d07b5a6",
      "method-setting-944b443a92867aa4c05d57c4",
    ],
  },
  {
    semanticType: "distance_matrix_medoid",
    componentId: "chronicle.distance-matrix-medoid/v1",
    sourceWorkId: "doi:10.1038/s41598-019-47493-x",
    derivedResultKind: "literature-distance-matrix-medoid-csv",
    settingIds: ["method-setting-e417f78f692addf3c606620a"],
  },
  {
    semanticType: "named_count_ratios",
    componentId: "chronicle.named-count-ratios/v1",
    sourceWorkId: "doi:10.1109/socialcom.2013.118",
    derivedResultKind: "literature-named-count-ratios-csv",
    settingIds: ["method-setting-55f05726b3afe55a886fff1a"],
  },
  {
    semanticType: "accelerometer_magnitude_count_gate",
    componentId: "chronicle.accelerometer-magnitude-count-gate/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-7d18dc8d566bfe8d6b6aa541"],
  },
  {
    semanticType: "integer_rssi_zero_filter",
    componentId: "chronicle.integer-rssi-zero-filter/v1",
    sourceWorkId: "doi:10.1109/socialcom.2013.118",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-0f1f138af4fffdf768a93802"],
  },
  {
    semanticType: "location_accuracy_radius_filter",
    componentId: "chronicle.location-accuracy-radius-filter/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-bda663746ffd6ebe747788f4"],
  },
  {
    semanticType: "place_distance_gate",
    componentId: "chronicle.place-distance-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-642-37210-0_6",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-7f3cb5bc3ef6e02c130d9d97"],
  },
  {
    semanticType: "state_response_count_gate",
    componentId: "chronicle.state-response-count-gate/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-3e0569df9918fa3979d6563d"],
  },
  {
    semanticType: "consecutive_dwell_gate",
    componentId: "chronicle.consecutive-dwell-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-642-37210-0_6",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-950e4e1a1d9d685c18edb489"],
  },
  {
    semanticType: "esm_response_count_gate",
    componentId: "chronicle.esm-response-count-gate/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-f0b202a476f3b87b72455d14"],
  },
  {
    semanticType: "nonnegative_rssi_filter",
    componentId: "chronicle.nonnegative-rssi-filter/v1",
    sourceWorkId: "doi:10.1145/2647868.2654933",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-691e82b28c4c61f0dc0c33b3"],
  },
  {
    semanticType: "full_day_count_gate",
    componentId: "chronicle.full-day-count-gate/v1",
    sourceWorkId: "doi:10.1145/2858036.2858267",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-91f671f5ed4f7d35dca6a5ce"],
  },
  {
    semanticType: "three_g_signal_quality_gate",
    componentId: "chronicle.three-g-signal-quality-gate/v1",
    sourceWorkId: "doi:10.1145/2465529.2466586",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-0f2b73dee364dc49f4044772"],
  },
  {
    semanticType: "valid_activity_day_count_gate",
    componentId: "chronicle.valid-activity-day-count-gate/v1",
    sourceWorkId: "doi:10.1007/s10865-024-00499-x",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: [
      "method-setting-atomic-69156158af538c61d60d",
      "method-setting-atomic-9cd62c7a581c151683c0",
    ],
  },
  {
    semanticType: "emotion_label_count_gate",
    componentId: "chronicle.emotion-label-count-gate/v1",
    sourceWorkId: "doi:10.1109/acii.2019.8925518",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-ec87781289767a090935fe87"],
  },
  {
    semanticType: "valid_activity_wear_hours_gate",
    componentId: "chronicle.valid-activity-wear-hours-gate/v1",
    sourceWorkId: "doi:10.1007/s10865-024-00499-x",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: [
      "method-setting-atomic-6fcfc3398fe5c79806b1",
      "method-setting-atomic-ac4e69c5efb7f5b6321f",
    ],
  },
  {
    semanticType: "session_touch_count_gate",
    componentId: "chronicle.session-touch-count-gate/v1",
    sourceWorkId: "doi:10.1109/acii.2019.8925518",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-733de83da57da36a570a9f1b"],
  },
  {
    semanticType: "country_accepted_user_count_gate",
    componentId: "chronicle.country-accepted-user-count-gate/v1",
    sourceWorkId: "doi:10.1038/s41598-021-82294-1",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-atomic-16230674bb01ce59dc91"],
  },
  {
    semanticType: "phq9_depression_classifier",
    componentId: "chronicle.phq9-depression-classifier/v1",
    sourceWorkId: "doi:10.1145/3410530.3414441",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: [
      "method-setting-994e2587e952171e362b00a0",
      "method-setting-3aacecd369532cadd5475c42",
    ],
  },
  {
    semanticType: "initial_es_observation_count_gate",
    componentId: "chronicle.initial-es-observation-count-gate/v1",
    sourceWorkId: "doi:10.1037/pspp0000469",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-fe3940aa365717252569bced"],
  },
  {
    semanticType: "default_battery_stop_gate",
    componentId: "chronicle.default-battery-stop-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-642-38541-4_4",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-039630561cb82a4dfa0c3d2a"],
  },
  {
    semanticType: "answered_prompt_count_gate",
    componentId: "chronicle.answered-prompt-count-gate/v1",
    sourceWorkId: "doi:10.1080/15213269.2020.1768122",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-5ee37808c3aec49494279731"],
  },
  {
    semanticType: "consecutive_data_weeks_gate",
    componentId: "chronicle.consecutive-data-weeks-gate/v1",
    sourceWorkId: "doi:10.1145/2647868.2654933",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-8564f76c3ce6576b1e10c475"],
  },
  {
    semanticType: "authentication_training_vector_count_gate",
    componentId: "chronicle.authentication-training-vector-count-gate/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-9ecc557d468c83a74e47b9cb"],
  },
  {
    semanticType: "class_attendance_dwell_gate",
    componentId: "chronicle.class-attendance-dwell-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-319-51394-2_2",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-b361e4912604d386fb7d7735"],
  },
  {
    semanticType: "joint_study_weeks_emotion_label_gate",
    componentId: "chronicle.joint-study-weeks-emotion-label-gate/v1",
    sourceWorkId: "doi:10.1145/3536221.3556603",
    derivedResultKind: "literature-source-bound-conjunctive-threshold-gate-csv",
    settingIds: [
      "method-setting-ba08885d883adcfb1bfe74c7",
      "method-setting-f683844ad043f61b6a851a02",
    ],
  },
  {
    semanticType: "gps_hour_coverage_gate",
    componentId: "chronicle.gps-hour-coverage-gate/v1",
    sourceWorkId: "doi:10.1038/s41598-019-47493-x",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-c0af8e44de56c0abaabcc7ff"],
  },
  {
    semanticType: "app_space_membership_count_gate",
    componentId: "chronicle.app-space-membership-count-gate/v1",
    sourceWorkId: "doi:10.1038/s41598-019-47493-x",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-67e693711b7a065ce63386f3"],
  },
  {
    semanticType: "global_prompt_gap_gate",
    componentId: "chronicle.global-prompt-gap-gate/v1",
    sourceWorkId: "doi:10.1145/2968219.2968302",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-9394a68ebba99f6c81d9b845"],
  },
  {
    semanticType: "micro_session_duration_gate",
    componentId: "chronicle.micro-session-duration-gate/v1",
    sourceWorkId: "doi:10.1145/3429360.3468192",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-06352b6f143bde0daf1066ba"],
  },
  {
    semanticType: "study_area_dwell_gate",
    componentId: "chronicle.study-area-dwell-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-319-51394-2_2",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-be84861190f78be728129e6d"],
  },
  {
    semanticType: "questionnaire_completion_duration_gate",
    componentId: "chronicle.questionnaire-completion-duration-gate/v1",
    sourceWorkId: "doi:10.1037/pspp0000469",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-81aa8e8b5e23b45f8267a498"],
  },
  {
    semanticType: "engage_session_duration_gate",
    componentId: "chronicle.engage-session-duration-gate/v1",
    sourceWorkId: "doi:10.1145/3429360.3468192",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-2505e588b53e5beac8491cb7"],
  },
  {
    semanticType: "party_location_dwell_gate",
    componentId: "chronicle.party-location-dwell-gate/v1",
    sourceWorkId: "doi:10.1007/978-3-319-51394-2_2",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-2bf931232c4bd435f1403c59"],
  },
  {
    semanticType: "answer_gap_gate",
    componentId: "chronicle.answer-gap-gate/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-9853159ea7a1ec5f47c85d34"],
  },
  {
    semanticType: "answer_character_count_gate",
    componentId: "chronicle.answer-character-count-gate/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-f40dd0d3ae5d9d47c9738214"],
  },
  {
    semanticType: "building_circle_membership_gate",
    componentId: "chronicle.building-circle-membership-gate/v1",
    sourceWorkId: "doi:10.1016/j.compedu.2019.103611",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-fe9b841235ec149984be1015"],
  },
  {
    semanticType: "attendance_evidence_availability_gate",
    componentId: "chronicle.attendance-evidence-availability-gate/v1",
    sourceWorkId: "doi:10.1016/j.compedu.2019.103611",
    derivedResultKind: "literature-source-bound-conjunctive-threshold-gate-csv",
    settingIds: ["method-setting-f5d1364d0018c64801ccd99c"],
  },
  {
    semanticType: "daily_stress_label_gate",
    componentId: "chronicle.daily-stress-label-gate/v1",
    sourceWorkId: "doi:10.1145/2647868.2654933",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-08dbec13e6499e2df3d79733"],
  },
  {
    semanticType: "esm_lag_gap_gate",
    componentId: "chronicle.esm-lag-gap-gate/v1",
    sourceWorkId: "doi:10.1016/j.chb.2023.107977",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-00df33a6d005b66b496e1aca"],
  },
  {
    semanticType: "active_minute_cadence_gate",
    componentId: "chronicle.active-minute-cadence-gate/v1",
    sourceWorkId: "doi:10.1007/s10865-024-00499-x",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-1b02c4e7cc0b9197d171d7d6"],
  },
  {
    semanticType: "app_participant_support_gate",
    componentId: "chronicle.app-participant-support-gate/v1",
    sourceWorkId: "doi:10.1016/j.compedu.2019.103611",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-ff33809b707c5562646ed8ce"],
  },
  {
    semanticType: "wifi_signal_quality_gate",
    componentId: "chronicle.wifi-signal-quality-gate/v1",
    sourceWorkId: "doi:10.1145/2465529.2466586",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-8a188c8364d1d50b36e04783"],
  },
  {
    semanticType: "password_sample_completion_gate",
    componentId: "chronicle.password-sample-completion-gate/v1",
    sourceWorkId: "doi:10.1145/2406367.2406384",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-64e5c8f54270755059d8b163"],
  },
  {
    semanticType: "activity_duration_gate",
    componentId: "chronicle.activity-duration-gate/v1",
    sourceWorkId: "doi:10.1186/s13673-016-0072-3",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-12675df881758501e89e89b8"],
  },
  {
    semanticType: "music_duration_gate",
    componentId: "chronicle.music-duration-gate/v1",
    sourceWorkId: "doi:10.1186/s13673-016-0072-3",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-59fda2b48095a571041dd10c"],
  },
  {
    semanticType: "communication_similarity_gate",
    componentId: "chronicle.communication-similarity-gate/v1",
    sourceWorkId: "doi:10.1186/s13673-016-0072-3",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-c2058445d529153381cac8a7"],
  },
  {
    semanticType: "location_stationary_speed_gate",
    componentId: "chronicle.location-stationary-speed-gate/v1",
    sourceWorkId: "doi:10.1145/3131901",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-2c6e3ce303322e1543eee698"],
  },
  {
    semanticType: "excessive_daily_epoch_frequency_gate",
    componentId: "chronicle.excessive-daily-epoch-frequency-gate/v1",
    sourceWorkId: "doi:10.4088/jcp.15m10310",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-36820121d28fe36b6ae1ca5b"],
  },
  {
    semanticType: "tolerance_m_trend_gate",
    componentId: "chronicle.tolerance-m-trend-gate/v1",
    sourceWorkId: "doi:10.4088/jcp.15m10310",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-5b1144a46bc1ce3713e5c905"],
  },
  {
    semanticType: "app_usage_participant_conjunction_gate",
    componentId: "chronicle.app-usage-participant-conjunction-gate/v1",
    sourceWorkId: "doi:10.1145/3706598.3713724",
    derivedResultKind: "literature-source-bound-conjunctive-threshold-gate-csv",
    settingIds: ["method-setting-746c132b321541ed6a104a7b"],
  },
  {
    semanticType: "affect_followup_draw_gate",
    componentId: "chronicle.affect-followup-draw-gate/v1",
    sourceWorkId: "doi:10.1145/3191754",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-7d69af05c207b46889d73434"],
  },
  {
    semanticType: "meaningfulness_followup_draw_gate",
    componentId: "chronicle.meaningfulness-followup-draw-gate/v1",
    sourceWorkId: "doi:10.1145/3191754",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-ff8cc6f8912ef08cd4384a65"],
  },
  {
    semanticType: "raw_text_utf16_minimum_gate",
    componentId: "chronicle.raw-text-utf16-minimum-gate/v1",
    sourceWorkId: "doi:10.1145/3191754",
    derivedResultKind: "literature-source-bound-raw-text-utf16-minimum-csv",
    settingIds: [
      "method-setting-b1af907e1494c7266158e17c",
      "method-setting-503fde4baa827bcb852902d3",
    ],
  },
  {
    semanticType: "nonnegative_integer_high_side_cap",
    componentId: "chronicle.nonnegative-integer-high-side-cap/v1",
    sourceWorkId: "doi:10.1016/j.chb.2020.106570",
    derivedResultKind: "literature-source-bound-nonnegative-integer-cap-csv",
    settingIds: ["method-setting-b9e7628e706265b033e571a8"],
  },
  {
    semanticType: "exact_category_membership_filter",
    componentId: "chronicle.exact-category-membership-filter/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    derivedResultKind:
      "literature-source-bound-exact-category-membership-filter-csv",
    settingIds: ["method-setting-f1678dedade69eec5fc81829"],
  },
  {
    semanticType: "exact_cardinality_group_mean",
    componentId: "chronicle.exact-cardinality-group-mean/v1",
    sourceWorkId: "doi:10.3390/j2020008",
    derivedResultKind: "literature-exact-cardinality-group-mean-csv",
    settingIds: ["method-setting-e686bbf41309953e493a1da0"],
  },
  {
    semanticType: "categorized_distinct_member_counts",
    componentId: "chronicle.categorized-distinct-member-counts/v1",
    sourceWorkId: "doi:10.1002/per.2309",
    derivedResultKind: "literature-categorized-distinct-member-counts-csv",
    settingIds: [
      "method-setting-3b19005f5f32678199cf2d77",
      "method-setting-c12c5da24d254ed6174b3f5c",
      "method-setting-2f3f7b71ccbf11cbd2e214bf",
      "method-setting-531e05e0b94cbed7f2cdce95",
      "method-setting-5efeddccbdfe825e34d7da63",
      "method-setting-97063ad355df039b405c0a7a",
    ],
  },
  {
    semanticType: "ranked_snapshot_reversal",
    componentId: "chronicle.ranked-snapshot-reversal/v1",
    sourceWorkId: "doi:10.1145/2638728.2641700",
    derivedResultKind: "literature-ranked-snapshot-reversal-csv",
    settingIds: [
      "method-setting-804c0c3ca2c4ade88c9ae815",
      "method-setting-a5986bb34d2c98401a017ece",
      "atomic-f8ea5a33f3fcccb1fa06f145",
      "method-setting-9383da8ffcad6889d1b1845a",
      "method-setting-1266e78e4cb2fec463919751",
    ],
  },
  {
    semanticType: "app_relationship_matrices",
    componentId: "chronicle.app-relationship-matrices/v1",
    sourceWorkId: "doi:10.1145/2638728.2641700",
    derivedResultKind: "literature-app-relationship-matrices-csv",
    settingIds: [
      "method-setting-d3bd32f112391895ef6bdd9c",
      "method-setting-dabbaa005b4daa28761c6157",
      "method-setting-fafabfbec817bb6c43686677",
      "method-setting-dccbc00c3974d0fa0816f5cf",
    ],
  },
  {
    semanticType: "exact_categorical_row_filter",
    componentId: "chronicle.exact-categorical-row-filter/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    derivedResultKind: "literature-exact-categorical-row-filter-csv",
    settingIds: [
      "method-setting-577ac433c188e9c0d1f21311",
      "method-setting-3f07e9131d5492926afe8c63",
      "method-setting-6945d62974714b285e78cca0",
    ],
  },
  {
    semanticType: "integer_screen_state_vocabulary",
    componentId: "chronicle.integer-screen-state-vocabulary/v1",
    sourceWorkId: "doi:10.2196/13209",
    derivedResultKind: "literature-integer-screen-state-vocabulary-csv",
    settingIds: ["method-setting-a0e0d56bd1a6f08372f0c3e9"],
  },
  {
    semanticType: "integer_screen_state_unlock_to_first_off_or_lock",
    componentId: "chronicle.integer-screen-state-session/v1",
    sourceWorkId: "doi:10.1145/3422821",
    derivedResultKind:
      "literature-unlock-to-off-or-lock-screen-intervals-csv",
    requiredSupportRoles: ["input_capability_evidence_file"],
    settingIds: ["method-setting-0d00eddbbf9b14cb90ae31f0"],
  },
  {
    semanticType: "grouped_scalar_sum_projection",
    componentId: "chronicle.grouped-scalar-sum-projection/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    derivedResultKind: "literature-grouped-scalar-sum-projection-csv",
    settingIds: [
      "method-setting-47a31487d53fcbbfb3599681",
      "method-setting-c6d932d27437255c0c67f9ec",
      "method-setting-af3dc29b102335bbb62f6e7f",
    ],
  },
  {
    semanticType: "analysis_positive_feature_matrix_missingness",
    componentId: "chronicle.analysis-positive-feature-missingness/v1",
    sourceWorkId: "doi:10.2196/13209",
    derivedResultKind: "literature-analysis-feature-matrix-csv",
    requiredSupportRoles: ["analysis_feature_matrix_file"],
    settingIds: [
      "method-setting-79fb8e1d1c3eb1083e945d33",
      "method-setting-bc30a690a8f91c0be9c32846",
      "method-setting-d0b0d241f8cb9af3f729ac1a",
      "method-setting-atomic-3e4326e90309d00dc667",
    ],
  },
  {
    semanticType: "strict_two_token_event_frame",
    componentId: "chronicle.source-event-schema/v1",
    sourceWorkId: "doi:10.1145/2858036.2858267",
    derivedResultKind: "literature-strict-two-token-event-frames-csv",
    settingIds: ["method-setting-eb314ac09a0b1414bdc50cc8"],
  },
  {
    semanticType: "closed_integer_category_map",
    componentId: "chronicle.closed-integer-category-map/v1",
    sourceWorkId: "doi:10.1109/apnoms.2011.6077030",
    derivedResultKind: "literature-closed-integer-category-map-csv",
    settingIds: ["method-setting-edc157e8995c64e134eff044"],
  },
  {
    semanticType: "complete_week_count_gate",
    componentId: "chronicle.complete-week-count-gate/v1",
    sourceWorkId: "doi:10.1109/socialcom.2013.118",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-81c5e2881d3b56866842b6c5"],
  },
  {
    semanticType: "consecutive_week_count_gate",
    componentId: "chronicle.consecutive-week-count-gate/v1",
    sourceWorkId: "doi:10.2139/ssrn.4768783",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-e8e92790d9b904e0020df18f"],
  },
  {
    semanticType: "retransmission_packet_count_gate",
    componentId: "chronicle.retransmission-packet-count-gate/v1",
    sourceWorkId: "doi:10.1145/1879141.1879176",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-79cc8647490f5d49f2004336"],
  },
  {
    semanticType: "throughput_packet_count_gate",
    componentId: "chronicle.throughput-packet-count-gate/v1",
    sourceWorkId: "doi:10.1145/1879141.1879176",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-96c80bf36817f109385d2e48"],
  },
  {
    semanticType: "low_cgpa_rule",
    componentId: "chronicle.low-cgpa-rule/v1",
    sourceWorkId: "doi:10.1145/3429360.3468192",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-b47a396b2c20b57cb06a9836"],
  },
  {
    semanticType: "high_cgpa_rule",
    componentId: "chronicle.high-cgpa-rule/v1",
    sourceWorkId: "doi:10.1145/3429360.3468192",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-a1c7539b39b1734039f95e9a"],
  },
  {
    semanticType: "factor_loading_exclusion_gate",
    componentId: "chronicle.factor-loading-exclusion-gate/v1",
    sourceWorkId: "doi:10.1177/2050157921993896",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-7bc9bf701e7cf62359ec8660"],
  },
  {
    semanticType: "icc_exclusion_gate",
    componentId: "chronicle.icc-exclusion-gate/v1",
    sourceWorkId: "doi:10.1177/2050157921993896",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-f532c6dee5fccdb9a802ede1"],
  },
  {
    semanticType: "baseline_tracking_row_count_gate",
    componentId: "chronicle.baseline-tracking-row-count-gate/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-3cf495b8511d8c26e267fd60"],
  },
  {
    semanticType: "intervention_tracking_row_count_gate",
    componentId: "chronicle.intervention-tracking-row-count-gate/v1",
    sourceWorkId: "doi:10.1080/15213269.2024.2334025",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-7e8f2af3a154b7a2ac3a308a"],
  },
  {
    semanticType: "movement_speed_state_gate",
    componentId: "chronicle.movement-speed-state-gate/v1",
    sourceWorkId: "doi:10.2196/13209",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-b2c40553a9f91ffa6183a1e9"],
  },
  {
    semanticType: "five_minute_step_state_gate",
    componentId: "chronicle.five-minute-step-state-gate/v1",
    sourceWorkId: "doi:10.2196/13209",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-1a0c647be1910bebaf0ceabf"],
  },
  {
    semanticType: "loneliness_score_classifier",
    componentId: "chronicle.loneliness-score-classifier/v1",
    sourceWorkId: "doi:10.2196/13209",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-5b202c5e8f680f2ea695b403"],
  },
  {
    semanticType: "attendance_hours_exclusion_gate",
    componentId: "chronicle.attendance-hours-exclusion-gate/v1",
    sourceWorkId: "doi:10.1177/0956797620956613",
    derivedResultKind: "literature-source-bound-scalar-predicate-csv",
    settingIds: ["method-setting-c97a93da0da2fef6edb1aa85"],
  },
  {
    semanticType: "hmog_sensor_magnitude",
    componentId: "chronicle.hmog-sensor-magnitude/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-hmog-sensor-magnitude-csv",
    settingIds: ["method-setting-e4f35017889fe039197a6900"],
  },
  {
    semanticType: "hmog_supplied_window_reductions",
    componentId: "chronicle.hmog-supplied-window-reductions/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-hmog-supplied-window-reductions-csv",
    settingIds: ["method-setting-dee84b81457048ee0dab27d9","method-setting-10bdbb82a4c932a78730ecdf","method-setting-56c0a334c2f007a1bd7c07bc","method-setting-9be668388c129cd737fb73b1","method-setting-0c9c841e4bb6073292d46b5f","method-setting-a13a69f9866c2b7471cda313"],
  },
  {
    semanticType: "hmog_supplied_stability_search",
    componentId: "chronicle.hmog-supplied-stability-search/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-hmog-supplied-stability-search-csv",
    settingIds: ["method-setting-862c5792ba4654047d684f76","method-setting-d250b6fb854aff9785576bcd"],
  },
  {
    semanticType: "hmog_paired_key_hold",
    componentId: "chronicle.hmog-paired-key-hold/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-hmog-paired-key-hold-csv",
    settingIds: ["method-setting-62a1b5b0d5a41f074fa830ca"],
  },
  {
    semanticType: "hmog_consecutive_press_digraph",
    componentId: "chronicle.hmog-consecutive-press-digraph/v1",
    sourceWorkId: "doi:10.1109/tifs.2015.2506542",
    derivedResultKind: "literature-hmog-consecutive-press-digraph-csv",
    settingIds: ["method-setting-bb7908438cc5872ff33c534e"],
  },
  {
    "semanticType": "affectpro_ordered_touch_features",
    "componentId": "chronicle.affectpro-ordered-touch-features/v1",
    "sourceWorkId": "doi:10.1145/3536221.3556603",
    "derivedResultKind": "literature-affectpro-ordered-touch-features-csv",
    "settingIds": [
      "method-setting-c63ad4b6b73d00eb62a69c58",
      "method-setting-5571f2caf5e344169b7b60bd",
      "method-setting-d7ae57c1e186234e36aac91d"
    ]
  },
  {
    "semanticType": "s3_prepared_sensor_window",
    "componentId": "chronicle.s3-prepared-sensor-window/v1",
    "sourceWorkId": "doi:10.3390/s21113765",
    "derivedResultKind": "literature-s3-prepared-sensor-window-csv",
    "settingIds": [
      "method-setting-382b14aa020c6c96448fb26f",
      "method-setting-99c102ed91f8d08cce15ba85",
      "method-setting-b3ef1358235740aae6fc31ae",
      "method-setting-aaf246c0d641145ff51bc675"
    ]
  },
  {
    "semanticType": "autosen_prepared_dimension_normalization",
    "componentId": "chronicle.autosen-prepared-normalization/v1",
    "sourceWorkId": "doi:10.1109/jiot.2020.2975779",
    "derivedResultKind": "literature-autosen-prepared-normalization-csv",
    "settingIds": [
      "method-setting-86fdc2998969b585190a0ec4"
    ]
  },
  {
    "semanticType": "healthymind_notification_rates",
    "componentId": "chronicle.healthymind-notification-rates/v1",
    "sourceWorkId": "doi:10.1371/journal.pone.0169162",
    "derivedResultKind": "literature-named-count-ratios-csv",
    "settingIds": [
      "method-setting-6d56e50aecf74a2503f6d0b1",
      "method-setting-fffe42f3d588541467ac1c7a"
    ]
  },
  {
    "semanticType": "healthymind_response_delay",
    "componentId": "chronicle.healthymind-response-delay/v1",
    "sourceWorkId": "doi:10.1371/journal.pone.0169162",
    "derivedResultKind": "literature-healthymind-response-delay-csv",
    "settingIds": [
      "method-setting-cc7c4f7ab1fd66651f062b04"
    ]
  },
  {
    "semanticType": "fischer_notification_phase_times",
    "componentId": "chronicle.fischer-notification-phase-times/v1",
    "sourceWorkId": "doi:10.1145/2037373.2037402",
    "derivedResultKind": "literature-fischer-notification-phase-times-csv",
    "settingIds": [
      "method-setting-c0108c78946effd5c5b951d9",
      "method-setting-e75db28a266b92dbd354ea8d",
      "method-setting-7afe4a47e9a11f43a3a4a37f",
      "method-setting-eeb8685c57a00c1ed60c3a81"
    ]
  },
  {
    "semanticType": "supplied_smartphone_usage_reductions",
    "componentId": "chronicle.smartphone-usage-reductions/v1",
    "sourceWorkId": "doi:10.1145/3410530.3414441",
    "derivedResultKind": "literature-smartphone-usage-reductions-csv",
    "settingIds": [
      "method-setting-4a2078e6d011d51524ccea95",
      "method-setting-6639b7fddfed5dd76d87eea3",
      "method-setting-cf205dba47704be3e158eb69",
      "method-setting-4ffac726b9828f0c635d0ce3",
      "method-setting-6c4eba1e6a350ae53e6cf55b",
      "method-setting-e36063d18657d31918d2dd77"
    ]
  },
  {
    "semanticType": "supplied_prosit_unlock_reductions",
    "componentId": "chronicle.prosit-unlock-reductions/v1",
    "sourceWorkId": "doi:10.1016/j.psychres.2023.115298",
    "derivedResultKind": "literature-prosit-unlock-reductions-csv",
    "settingIds": [
      "method-setting-96996b53aa3d3c158a031de4",
      "method-setting-ae01c309d430a2617047b936"
    ]
  },
  {
    "semanticType": "idle_compressed_clock",
    "componentId": "chronicle.idle-compressed-clock/v1",
    "sourceWorkId": "doi:10.1109/jsyst.2015.2472579",
    "derivedResultKind": "literature-idle-compressed-clock-csv",
    "settingIds": [
      "method-setting-4eadf32f10dbd271403548bf",
      "method-setting-atomic-3f760ab5e7a2a2a09a98",
      "method-setting-atomic-941f976e5db6d697b337",
      "method-setting-atomic-ad727dbff4371b1f3f33"
    ]
  },
  {
    "semanticType": "screenlife_capture_gap_partition",
    "componentId": "chronicle.screenlife-capture-gap-partition/v1",
    "sourceWorkId": "doi:10.3758/s13428-022-02006-z",
    "derivedResultKind": "literature-screenlife-capture-gap-partition-csv",
    "settingIds": [
      "method-setting-fa10071bcf13337961f19e36"
    ]
  },
  {
    "semanticType": "resolved_unlock_upper_bound",
    "componentId": "chronicle.resolved-unlock-upper-bound/v1",
    "sourceWorkId": "usenix:soups2014:harbach-hard-lock-life",
    "derivedResultKind": "literature-resolved-unlock-upper-bound-csv",
    "settingIds": [
      "method-setting-210a4202c4b9df1fe287540b"
    ]
  },
  {
    "semanticType": "class_ringer_fractions",
    "componentId": "chronicle.class-ringer-fractions/v1",
    "sourceWorkId": "doi:10.1016/j.compedu.2019.103611",
    "derivedResultKind": "literature-named-count-ratios-csv",
    "settingIds": [
      "method-setting-7cd6ed3257a9c91d27a55ec2"
    ]
  },
  {
    "semanticType": "app_postpone_fraction",
    "componentId": "chronicle.app-postpone-fraction/v1",
    "sourceWorkId": "doi:10.1145/2556288.2557066",
    "derivedResultKind": "literature-named-count-ratios-csv",
    "settingIds": [
      "method-setting-bd63e1f6e9a4c0cb6663bdf5"
    ]
  },
  {
    "semanticType": "twenty_trial_time_mean",
    "componentId": "chronicle.twenty-trial-time-mean/v1",
    "sourceWorkId": "doi:10.1145/2556288.2557066",
    "derivedResultKind": "literature-exact-cardinality-group-mean-csv",
    "settingIds": [
      "method-setting-d5f9e5c2bbc0fcb4c222ee38"
    ]
  },
  {
    "semanticType": "non_country_unicity_mean",
    "componentId": "chronicle.non-country-unicity-mean/v1",
    "sourceWorkId": "doi:10.1038/s41598-021-82294-1",
    "derivedResultKind": "literature-exact-cardinality-group-mean-csv",
    "settingIds": [
      "method-setting-d0310da45e42b6e3ea8b6f32"
    ]
  },
  {
    "semanticType": "country_unicity_mean",
    "componentId": "chronicle.country-unicity-mean/v1",
    "sourceWorkId": "doi:10.1038/s41598-021-82294-1",
    "derivedResultKind": "literature-exact-cardinality-group-mean-csv",
    "settingIds": [
      "method-setting-0164c5720084636709b97833"
    ]
  },
  {
    "semanticType": "frame_unique_app_count",
    "componentId": "chronicle.frame-unique-app-count/v1",
    "sourceWorkId": "doi:10.1145/2634317.2634325",
    "derivedResultKind": "literature-categorized-distinct-member-counts-csv",
    "settingIds": [
      "method-setting-70789f0afe781ffb0130098a"
    ]
  },
  {
    "semanticType": "session_unique_app_count",
    "componentId": "chronicle.session-unique-app-count/v1",
    "sourceWorkId": "doi:10.1145/2634317.2634325",
    "derivedResultKind": "literature-categorized-distinct-member-counts-csv",
    "settingIds": [
      "method-setting-9dc5b53426eae332b221e92b"
    ]
  },
  {
    "semanticType": "keyboard_stress_ordered_axis_statistics",
    "componentId": "chronicle.keyboard-stress-axis-statistics/v1",
    "sourceWorkId": "doi:10.1007/s10916-020-1530-z",
    "derivedResultKind": "literature-keyboard-stress-axis-statistics-csv",
    "settingIds": [
      "method-setting-cb22ef055875b33e1f5809ce",
      "method-setting-6e18a0b2573a0a53ef44eaa8",
      "method-setting-2e8ef4bb09b661f4e17a539b",
      "method-setting-060beca679f3ec61e8cbf115",
      "method-setting-1f88b5f3f78852bc2007d969",
      "method-setting-666e6da8d764734e49c7bc5e",
      "method-setting-fb795fdec528293efc185362",
      "method-setting-a9699eca1bb97217c418361b",
      "method-setting-dc00ea20aa0a9469a1229552",
      "method-setting-400fb0c661c46a862a792c8c",
      "method-setting-7d51c23887719c5980be5fe1",
      "method-setting-2434fa9ada895cbae5e17f57",
      "method-setting-e691a03fd79b3d89f9549b41",
      "method-setting-8fb4bff543b03bb1943a8d08",
      "method-setting-eab7d3e342c88e40217326f2",
      "method-setting-ad7cd7c8eae73b6451fedc2a",
      "method-setting-84192b7a8bfc4c402969af05",
      "method-setting-bfac0ffdc587976a32480dce"
    ]
  },
  {
    "semanticType": "okoshi_notification_latencies",
    "componentId": "chronicle.okoshi-notification-latencies/v1",
    "sourceWorkId": "doi:10.1109/percom.2017.7917856",
    "derivedResultKind": "literature-okoshi-notification-latencies-csv",
    "settingIds": [
      "method-setting-289346371f686d9c9edf5633"
    ]
  },
  {
    "semanticType": "large_scale_notification_click_time",
    "componentId": "chronicle.large-scale-notification-click-time/v1",
    "sourceWorkId": "doi:10.1145/2556288.2557189",
    "derivedResultKind": "literature-large-scale-notification-click-time-csv",
    "settingIds": [
      "method-setting-0194c1557fd258116e698e3c"
    ]
  },
  {
    "semanticType": "content_notification_removal_time",
    "componentId": "chronicle.content-notification-removal-time/v1",
    "sourceWorkId": "doi:10.1145/2750858.2807544",
    "derivedResultKind": "literature-content-notification-removal-time-csv",
    "settingIds": [
      "method-setting-a7509d52dc449dfdc629abed"
    ]
  },
  {
    "semanticType": "batterylogger_weighted_estimate",
    "componentId": "chronicle.batterylogger-weighted-estimate/v1",
    "sourceWorkId": "doi:10.1109/apnoms.2011.6077030",
    "derivedResultKind": "literature-batterylogger-weighted-estimate-csv",
    "settingIds": [
      "method-setting-1dd9fbfda1ef9a9eb54fe246",
      "method-setting-5b4bd135f55e789cc91d5392"
    ]
  },
  {
    "semanticType": "attelia_activity_transition_lookup",
    "componentId": "chronicle.attelia-activity-transition-lookup/v1",
    "sourceWorkId": "doi:10.1145/2750858.2807517",
    "derivedResultKind": "literature-attelia-activity-transition-lookup-csv",
    "settingIds": [
      "method-setting-eb65496e7dd4549cb8ac985e"
    ]
  },
  {
    "semanticType": "backapp_runtime_arithmetic",
    "componentId": "chronicle.backapp-runtime-arithmetic/v1",
    "sourceWorkId": "doi:10.1145/2371574.2371617",
    "derivedResultKind": "literature-backapp-runtime-arithmetic-csv",
    "settingIds": [
      "method-setting-50dee064b8e0d0da777e5364",
      "method-setting-9cba0f8322c7cfcaf51d5301"
    ]
  },
  {
    "semanticType": "s_adl_supplied_array_pair_differences",
    "componentId": "chronicle.s-adl-pair-differences/v1",
    "sourceWorkId": "doi:10.1145/3613904.3642832",
    "derivedResultKind": "literature-s-adl-pair-differences-csv",
    "settingIds": [
      "method-setting-22908ccd3f7b6b2a1151bb5c"
    ]
  },
  {
    "semanticType": "s_adl_qualified_literal_sequence_selection",
    "componentId": "chronicle.s-adl-literal-selection/v1",
    "sourceWorkId": "doi:10.1145/3613904.3642832",
    "derivedResultKind": "literature-s-adl-literal-selection-csv",
    "settingIds": [
      "method-setting-3e86ec2dc78b3cf5536ff7df",
      "method-setting-e4512a605e1f49d2b8b80bd2"
    ]
  },
  {
    "semanticType": "supplied_app_fingerprint_unicity",
    "componentId": "chronicle.supplied-app-fingerprint-unicity/v1",
    "sourceWorkId": "doi:10.1038/s41598-021-82294-1",
    "derivedResultKind": "literature-supplied-app-fingerprint-unicity-csv",
    "settingIds": [
      "method-setting-100352431cbcc5e1abd491cc",
      "method-setting-cd3957a2f5196a7c187cd0ed"
    ]
  },
  {
    "semanticType": "explicit_missing_screen_second_repair",
    "componentId": "chronicle.screen-missing-second-repair/v1",
    "sourceWorkId": "doi:10.1016/j.chb.2024.108281",
    "derivedResultKind": "literature-missing-screen-second-repair-csv",
    "settingIds": [
      "method-setting-587e0e08a3ff7137aabbf8b2"
    ]
  },
  {
    "semanticType": "fukazawa_supplied_acceleration_magnitude",
    "componentId": "chronicle.fukazawa-supplied-acceleration-magnitude/v1",
    "sourceWorkId": "doi:10.1016/j.jbi.2019.103151",
    "derivedResultKind": "literature-fukazawa-supplied-acceleration-magnitude-csv",
    "settingIds": [
      "method-setting-c3a4cc911bce52e21ea3cc21"
    ]
  },
  {
    "semanticType": "accessibility_phrase_set_difference",
    "componentId": "chronicle.accessibility-phrase-set-difference/v1",
    "sourceWorkId": "doi:10.1145/3613904.3642347",
    "derivedResultKind": "literature-accessibility-phrase-set-difference-csv",
    "settingIds": [
      "method-setting-0919856270a0b8557c1a236c"
    ]
  },
  {
    "semanticType": "bod_shape_direction_run_collapse",
    "componentId": "chronicle.bod-shape-direction-run-collapse/v1",
    "sourceWorkId": "doi:10.1145/2470654.2481330",
    "derivedResultKind": "literature-bod-shape-direction-run-collapse-csv",
    "settingIds": [
      "method-setting-d71a05b9805a2b13e9dbe59e"
    ]
  },
  {
    "semanticType": "uniform_five_minute_byte_allocation",
    "componentId": "chronicle.uniform-five-minute-byte-allocation/v1",
    "sourceWorkId": "doi:10.1145/2465529.2466586",
    "derivedResultKind": "literature-uniform-five-minute-byte-allocation-csv",
    "settingIds": [
      "method-setting-9917decef70f8921d65f94e3"
    ]
  },
  {
    "semanticType": "capped_closed_screen_packet_gate",
    "componentId": "chronicle.capped-closed-screen-packet-gate/v1",
    "sourceWorkId": "doi:10.1016/j.smhl.2020.100137",
    "derivedResultKind": "literature-capped-closed-screen-gated-packets-csv",
    "settingIds": [
      "method-setting-7427500edbceab9d67adc3c4"
    ]
  },
  {
    "semanticType": "ohapp_supplied_matched_navigation_time",
    "componentId": "chronicle.ohapp-matched-navigation-time/v1",
    "sourceWorkId": "doi:10.1145/2493190.2493219",
    "derivedResultKind": "literature-ohapp-matched-navigation-time-csv",
    "settingIds": [
      "method-setting-1194b932cc9efd58afd5a39d"
    ]
  },
  {
    "semanticType": "jones_supplied_ordered_interlaunch_time",
    "componentId": "chronicle.jones-ordered-interlaunch-time/v1",
    "sourceWorkId": "doi:10.1145/2750858.2807542",
    "derivedResultKind": "literature-jones-ordered-interlaunch-time-csv",
    "settingIds": [
      "method-setting-69f2a94ffa42fa65484c536a"
    ]
  },
  {
    "semanticType": "touch_event_box_displacement",
    "componentId": "chronicle.touch-box-displacement/v1",
    "sourceWorkId": "doi:10.1145/3490100.3516456",
    "derivedResultKind": "literature-touch-box-displacement-csv",
    "settingIds": [
      "method-setting-2e6781792a189060008d69e5"
    ]
  },
  {
    "semanticType": "screenomics_supplied_text_image_statistics",
    "componentId": "chronicle.screenomics-text-image-statistics/v1",
    "sourceWorkId": "doi:10.1016/j.chb.2020.106570",
    "derivedResultKind": "literature-screenomics-text-image-statistics-csv",
    "settingIds": [
      "method-setting-bf6ca24692b61dd0cd6dd3a6",
      "method-setting-b373c03dd8d6d927b2a4c5f1",
      "method-setting-d05feff793cb753b66a08841",
      "method-setting-9ee60f4dfe9f0ff2990cf7b7"
    ]
  },
  {
    "semanticType": "dismissed_supplied_burst_last",
    "componentId": "chronicle.dismissed-supplied-burst-last/v1",
    "sourceWorkId": "doi:10.1145/3229434.3229445",
    "derivedResultKind": "literature-dismissed-supplied-burst-last-csv",
    "settingIds": [
      "method-setting-24ef9dfe916452d88c3ebd43"
    ]
  },
  {
    "semanticType": "annotif_supplied_summary_hash_filter",
    "componentId": "chronicle.annotif-supplied-summary-hash-filter/v1",
    "sourceWorkId": "doi:10.1145/3365610.3365611",
    "derivedResultKind": "literature-annotif-supplied-summary-hash-filter-csv",
    "settingIds": [
      "method-setting-54a41a15efc9e0f1006b1d66",
      "method-setting-77d7b61979c3b91d68859b89"
    ]
  },
  {
    "semanticType": "dingler_supplied_foreground_exclusion",
    "componentId": "chronicle.dingler-supplied-foreground-exclusion/v1",
    "sourceWorkId": "doi:10.1145/2785830.2785840",
    "derivedResultKind": "literature-dingler-supplied-foreground-exclusion-csv",
    "settingIds": [
      "method-setting-d63e921cbcb407664079c3f9"
    ]
  },
  {
    "semanticType": "myphoneme_supplied_response_times",
    "componentId": "chronicle.myphoneme-supplied-response-times/v1",
    "sourceWorkId": "doi:10.1145/2858036.2858566",
    "derivedResultKind": "literature-myphoneme-supplied-response-times-csv",
    "settingIds": [
      "method-setting-4e42d4710022c5a8e22a79e1",
      "method-setting-908f621f2786d606f466971e",
      "method-setting-a6e7a286e2a35c5f73a79be4",
      "method-setting-b16db1aea2503be300c22459"
    ]
  },
  {
    "semanticType": "monarca_prepared_rms",
    "componentId": "chronicle.monarca-prepared-rms/v1",
    "sourceWorkId": "doi:10.1109/mprv.2015.54",
    "derivedResultKind": "literature-monarca-prepared-rms-csv",
    "settingIds": [
      "method-setting-df6ad61b998c753f0024571f",
      "method-setting-b02ed34cb4fc74cd89f98c53"
    ]
  },
  {
    "semanticType": "moa2_prepared_calendar",
    "componentId": "chronicle.moa2-prepared-calendar/v1",
    "sourceWorkId": "doi:10.1145/2968219.2968302",
    "derivedResultKind": "literature-moa2-prepared-calendar-csv",
    "settingIds": [
      "method-setting-1589d4e25824dc5431aa5c88"
    ]
  },
  {
    "semanticType": "rapids_supplied_foreground_reductions",
    "componentId": "chronicle.rapids-supplied-foreground-reductions/v1",
    "sourceWorkId": "doi:10.1007/s41347-024-00443-5",
    "derivedResultKind": "literature-rapids-supplied-foreground-reductions-csv",
    "settingIds": [
      "method-setting-214fca54493060eff5027268",
      "method-setting-4c7a3e087843bce90f5d1b1b"
    ]
  },
  {
    "semanticType": "rapids_supplied_data_yield",
    "componentId": "chronicle.rapids-supplied-data-yield/v1",
    "sourceWorkId": "doi:10.1007/s41347-024-00443-5",
    "derivedResultKind": "literature-rapids-supplied-data-yield-csv",
    "settingIds": [
      "method-setting-65fedfed63ed322276fc16c3",
      "method-setting-6bf978a2b3c360b4a006b4a4"
    ]
  },
  {
    "semanticType": "nextapp_supplied_opening_counts",
    "componentId": "chronicle.nextapp-supplied-opening-counts/v1",
    "sourceWorkId": "doi:10.1145/2684822.2685302",
    "derivedResultKind": "literature-nextapp-supplied-opening-counts-csv",
    "settingIds": [
      "method-setting-b307f59dfd93eb3ebd6b4821"
    ]
  },
  {
    "semanticType": "van_berkel_resolved_device_session_gap",
    "componentId": "chronicle.van-berkel-resolved-session-gap/v1",
    "sourceWorkId": "doi:10.1145/2858036.2858348",
    "derivedResultKind": "literature-van-berkel-resolved-session-gap-csv",
    "settingIds": [
      "method-setting-73a144facb5859a000cd5ef6",
      "method-setting-3b820927371297cd056c395f"
    ]
  },
  {
    "semanticType": "corrected_password_supplied_entry_time",
    "componentId": "chronicle.corrected-password-entry-time/v1",
    "sourceWorkId": "doi:10.1145/2406367.2406384",
    "derivedResultKind": "literature-corrected-password-entry-time-csv",
    "settingIds": [
      "method-setting-309312902eaa52c924a78528"
    ]
  },
  {
    "semanticType": "ordered_app_presence_vector",
    "componentId": "chronicle.ordered-app-presence-vector/v1",
    "sourceWorkId": "doi:10.1007/s42486-020-00045-z",
    "derivedResultKind": "literature-ordered-app-presence-vector-csv",
    "settingIds": [
      "method-setting-889fc74d1f6f91c743a09654"
    ]
  },
  {
    "semanticType": "supplied_pre_sample_longest_window",
    "componentId": "chronicle.supplied-pre-sample-longest-window/v1",
    "sourceWorkId": "doi:10.1145/2971648.2971762",
    "derivedResultKind": "literature-supplied-pre-sample-longest-window-csv",
    "settingIds": [
      "method-setting-b84b4b434764a3112e597f66",
      "method-setting-ed07f45b174ec86eab70becd"
    ]
  },
  {
    "semanticType": "habitual_android_supplied_duration_bag",
    "componentId": "chronicle.habitual-android-duration-bag/v1",
    "sourceWorkId": "doi:10.1145/3447991",
    "derivedResultKind": "literature-habitual-android-duration-bag-csv",
    "settingIds": [
      "method-setting-58b492c95ad2fdc719dfb352",
      "method-setting-70ae67da970ad0a7b18e9935"
    ]
  },
  {
    "semanticType": "finesse_later_supplied_feature_long_differences",
    "componentId": "chronicle.finesse-later-feature-time/v1",
    "sourceWorkId": "doi:10.1145/3479600",
    "derivedResultKind": "literature-finesse-later-feature-time-csv",
    "settingIds": [
      "method-setting-23541877fb32de245172acc5"
    ]
  },
  {
    "semanticType": "supplied_last_syn_rtt",
    "componentId": "chronicle.supplied-last-syn-rtt/v1",
    "sourceWorkId": "doi:10.1145/1879141.1879176",
    "derivedResultKind": "literature-supplied-last-syn-rtt-csv",
    "settingIds": [
      "method-setting-ab22a63657fdad32a18ae889"
    ]
  },
  {
    "semanticType": "supplied_app_session_tap_rate",
    "componentId": "chronicle.supplied-app-session-tap-rate/v1",
    "sourceWorkId": "doi:10.2139/ssrn.4768783",
    "derivedResultKind": "literature-supplied-app-session-tap-rate-csv",
    "settingIds": [
      "method-setting-c2cf6dbf42081b9b854603aa"
    ]
  },
  {
    "semanticType": "carat_normalized_state_entropy",
    "componentId": "chronicle.carat-normalized-entropy/v1",
    "sourceWorkId": "doi:10.2196/26540",
    "derivedResultKind": "literature-carat-normalized-entropy-csv",
    "settingIds": [
      "method-setting-faf7f8474dd6da546753742d"
    ]
  },
  {
    "semanticType": "carat_paired_hour_regularity",
    "componentId": "chronicle.carat-pair-regularity/v1",
    "sourceWorkId": "doi:10.2196/26540",
    "derivedResultKind": "literature-carat-pair-regularity-csv",
    "settingIds": [
      "method-setting-18df3b8320c2eeda061be0e1",
      "method-setting-73ad5133d2dbd04761035c95"
    ]
  },
  {
    "semanticType": "carat_supplied_day_pair_regularity_mean",
    "componentId": "chronicle.carat-day-regularity-mean/v1",
    "sourceWorkId": "doi:10.2196/26540",
    "derivedResultKind": "literature-carat-day-regularity-mean-csv",
    "settingIds": [
      "method-setting-fe27188f201186ec30748928"
    ]
  },
  {
    "semanticType": "stdd_prepared_axis",
    "componentId": "chronicle.stdd-prepared-axis/v1",
    "sourceWorkId": "doi:10.3390/s20051396",
    "derivedResultKind": "literature-stdd-prepared-axis-csv",
    "settingIds": [
      "method-setting-37a5104fbe72791f3dd0dcca",
      "method-setting-1e6ed6064bceb699996e8142",
      "method-setting-0953459a9ff2e41e8b522540",
      "method-setting-e1b63595bca7fb69a33a8e25",
      "method-setting-a5ac4c8ae27e64e937f53b41",
      "method-setting-c125e4405b968adfd5942c1a",
      "method-setting-4c176d703137ae8cc3fe6814",
      "method-setting-c9d88183b22bb576c0527297",
      "method-setting-6bf25139a0771066e6e7dc94"
    ]
  },
  {
    "semanticType": "touchstroke_prepared_mean",
    "componentId": "chronicle.touchstroke-prepared-mean/v1",
    "sourceWorkId": "doi:10.1007/978-3-319-23222-5_4",
    "derivedResultKind": "literature-touchstroke-prepared-mean-csv",
    "settingIds": [
      "method-setting-b9db9f992f00124929dbd198"
    ]
  },
  {
    semanticType: "sdu_supplied_period_reductions",
    componentId: "chronicle.sdu-supplied-period-reductions/v1",
    sourceWorkId: "doi:10.1016/j.chbr.2021.100164",
    derivedResultKind: "literature-sdu-supplied-period-reductions-csv",
    settingIds: ["outside143:sdu-device-tracker:v1:period_reductions"],
  },
  {
    semanticType: "sdu_supplied_validation_arithmetic",
    componentId: "chronicle.sdu-supplied-validation-arithmetic/v1",
    sourceWorkId: "doi:10.1016/j.chbr.2021.100164",
    derivedResultKind: "literature-sdu-supplied-validation-arithmetic-csv",
    settingIds: ["outside143:sdu-device-tracker:v1:validation_arithmetic"],
  },
  {
    semanticType: "usage_logger_released_numeric",
    componentId: "chronicle.usage-logger-released-numeric/v1",
    sourceWorkId: "doi:10.3758/s13428-021-01585-7",
    derivedResultKind: "literature-usage-logger-released-numeric-csv",
    settingIds: ["outside143:usage-logger:v1:released_numeric"],
  },
  {
    semanticType: "rapids_prepared_resample_categories",
    componentId: "chronicle.rapids-prepared-resample-categories/v1",
    sourceWorkId: "doi:10.1007/s41347-024-00443-5",
    derivedResultKind: "literature-rapids-prepared-resample-categories-csv",
    settingIds: ["method-setting-d9a5de666b5a52c8656cfaff"],
  },
] as const;

describe("held literature components", () => {
  it("registers 825 unique settings and exposes each exact all-or-nothing component", () => {
    const allIds = LITERATURE_INPUT_ADAPTER_CONTRACTS.flatMap(
      (group) => group.methodSettingIds,
    );
    expect(allIds).toHaveLength(825);
    expect(new Set(allIds).size).toBe(825);

    for (const expected of EXPECTED) {
      const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
        ({ componentExecution }) =>
          componentExecution?.componentId === expected.componentId,
      );
      expect(group).toBeDefined();
      expect(group!.semanticType).toBe(expected.semanticType);
      expect(group!.guiSurface).toContain("run-artifacts");
      expect(group!.methodSettingIds).toEqual(expected.settingIds);
      const component = literatureComponentExecutionForSettings(
        group!.methodSettingIds,
      );
      expect(component).toMatchObject({
        componentId: expected.componentId,
        sourceWorkId: expected.sourceWorkId,
        derivedResultKind: expected.derivedResultKind,
        requiredSupportRoles:
          "requiredSupportRoles" in expected
            ? expected.requiredSupportRoles
            : [],
        fullProfileExecutionStatus: "blocked",
      });
      expect(component!.limitations.length).toBeGreaterThan(0);
      expect(
        literatureComponentExecutionForSettings(
          group!.methodSettingIds.slice(0, -1),
        ),
      ).toBeUndefined();
    }
  });

  it("uses the generic result UI and content-addressed persistence identity", async () => {
    const workspaceIds = new Set<string>();
    for (const expected of EXPECTED) {
      const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
        ({ componentExecution }) =>
          componentExecution?.componentId === expected.componentId,
      )!;
      const component = literatureComponentExecutionForSettings(
        group.methodSettingIds,
      )!;
      workspaceIds.add(
        await literatureComponentWorkspaceId(
          component.componentId,
          "a".repeat(64),
        ),
      );
      const result = {
        manifest: {
          componentId: component.componentId,
          sourceRowCount: 2,
          derivedResultRowCount: 1,
        },
        componentExecutionReceipt: { limitations: component.limitations },
        artifacts: [
          {
            metadata: {
              kind: component.derivedResultKind,
              mediaType: "text/csv",
              size: 32,
              rowCount: 1,
            },
            bytes: new Uint8Array(),
          },
        ],
      } as unknown as LiteratureComponentRuntimeExecution;
      const html = renderToStaticMarkup(
        createElement(LiteratureComponentResultPanel, {
          result,
          error: null,
          onDelete: vi.fn(),
          onError: vi.fn(),
        }),
      );
      expect(html).toContain(component.componentId);
      expect(html).toContain(component.derivedResultKind);
      expect(html).toContain("parent paper profile remains blocked");
    }
    expect(workspaceIds.size).toBe(178);
  });
});

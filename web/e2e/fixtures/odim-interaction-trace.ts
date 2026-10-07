import { createHash } from "node:crypto";
import type { InteractionTraceRecord } from "../../src/lib/methodProfiles";

// Analyst-named examples of ODIM pp. 6-9, not author data or an ODIM export schema.
export function odimInteractionTraceExample(profile: unknown) {
  const locator = "doi:10.1145/3743726; author PDF sha256:dcf3c9cdf7d6fe9fb916774ee0cedfcae11ccdc2fe2c93cb922815faafd7e920";
  const trace: InteractionTraceRecord = {
    interaction_trace_id: "example:edited-trace",
    method_profile_id: "method-profile:doi:10.1145/3743726",
    source_work_id: "doi:10.1145/3743726",
    trace_record_origin: "analyst_constructed_example",
    trace_description: "Illustrative supplied trace description: find a destination",
    source_locators: [`${locator}; PDF pp. 6-7 sections 4.2-4.3`, `${locator}; PDF p. 9 section 4.5; manual trace/screen annotations, not the illustrative LLM route`],
    interaction_events: [
      {
        interaction_event_id: "e1", event_sequence_position: 0,
        screen_description: "Illustrative supplied screen description: destination entry",
        screenshot_artifact_id: "image1", hierarchy_artifact_id: "hierarchy1", gesture_artifact_id: null,
        capture_incomplete: true, human_detected_incorrect: null,
        interaction_redactions: [{ redaction_record_id: "device1", redaction_selection_basis: "selected_ui_element",
          selected_element_ids: ["element1"], redacted_screenshot_artifact_id: "image1-redacted",
          redacted_hierarchy_artifact_id: "hierarchy1-redacted", screenshot_redaction_effect: "selected_element_pixels_deleted",
          hierarchy_redaction_effect: "corresponding_text_content_tagged", redaction_justification: "Synthetic example of a private name",
          source_locators: [`${locator}; PDF p. 8 section 4.4`] }],
      },
      {
        interaction_event_id: "e3", event_sequence_position: 1,
        screen_description: "Illustrative supplied screen description: destination results",
        screenshot_artifact_id: "image3", hierarchy_artifact_id: "hierarchy3", gesture_artifact_id: "gesture3",
        capture_incomplete: false, human_detected_incorrect: true,
        interaction_redactions: [{ redaction_record_id: "web3", redaction_selection_basis: "drawn_region_sufficient_iou",
          selected_element_ids: ["element3"], target_region_id: "rectangle3", redacted_screenshot_artifact_id: "image3-redacted",
          redacted_hierarchy_artifact_id: "hierarchy3-redacted", screenshot_redaction_effect: "drawn_region_blackened",
          hierarchy_redaction_effect: "qualifying_element_metadata_removed", source_locators: [`${locator}; PDF p. 9 section 4.4`] }],
      },
    ],
  };
  // Honest hashes of small synthetic label bytes. They are not screenshots or sanitized outputs.
  const referenced_artifacts = ["image1", "hierarchy1", "image2", "hierarchy2", "gesture2", "image3", "hierarchy3", "gesture3",
    "image1-redacted", "hierarchy1-redacted", "image3-redacted", "hierarchy3-redacted"].map((artifact_id) => {
    const bytes = Buffer.from(`synthetic label: ${artifact_id}`);
    return { artifact_id, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      media_type: "application/octet-stream", size: bytes.length, derived_from: [], qualifiers: {} };
  });
  return { profiles: [profile], interaction_traces: [trace], referenced_artifacts };
}

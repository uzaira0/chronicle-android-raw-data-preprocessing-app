import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { parseStudyMethodProfileLibrary } from "@/lib/methodProfiles";
import { compileNativeMethodProfile } from "@/lib/methodProfiles";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { finesseFeatureSessionExample } from "../../e2e/fixtures/finesse-feature-session";

describe("source-backed timed feature-occurrence selection", () => {
  it("imports and persists two same-label occurrences without losing which instance was selected", async () => {
    const input = finesseFeatureSessionExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], app_feature_sessions: library.app_feature_sessions }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], app_feature_sessions: saved.app_feature_sessions });
    expect(restored.app_feature_sessions).toEqual(input.app_feature_sessions);
    const session = restored.app_feature_sessions![0]!;
    expect(session.feature_occurrences.map((row) => row.feature_name)).toEqual(["SEARCH", "SEARCH"]);
    expect(session.session_feature_selections![0]!.selected_feature_occurrence_references).toEqual(["later-search"]);
    expect(session.denotes_interval).not.toHaveProperty("end_instant");
    expect(session.feature_occurrences[0]!.denotes_interval).not.toHaveProperty("duration_seconds");
    expect(session).not.toHaveProperty("app_package_name");
    expect(session.session_feature_selections![1]!.selected_feature_occurrence_references).toEqual([]);
    expect(session.session_feature_selections![2]).not.toHaveProperty("selected_feature_occurrence_references");
    expect(session.session_feature_selections![3]!.selected_feature_occurrence_references).toBeNull();
    expect(compileNativeMethodProfile(restored.profiles[0]!, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);

    const variant = structuredClone(input);
    variant.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["first-search"];
    const first = parseStudyMethodProfileLibrary(variant);
    expect(first.app_feature_sessions![0]!.feature_occurrences).toEqual(session.feature_occurrences);
    expect(first.app_feature_sessions![0]!.session_feature_selections).not.toEqual(session.session_feature_selections);
    await saveResearchMethodSelection(JSON.stringify({ profile: first.profiles[0], app_feature_sessions: first.app_feature_sessions }));
    const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [again.profile], app_feature_sessions: again.app_feature_sessions }).app_feature_sessions).toEqual(variant.app_feature_sessions);
    // A label-only answer collapses two genuinely different supplied selections.
    const names = (ids: string[]) => ids.map((id) => session.feature_occurrences.find((row) => row.feature_occurrence_id === id)!.feature_name);
    expect(names(["first-search"])).toEqual(names(["later-search"]));
    expect(["first-search"]).not.toEqual(["later-search"]);
  });

  it("preserves opaque/equal timing, order, open labels and missing response distinctions without reconstruction", () => {
    const input = finesseFeatureSessionExample();
    const variant = parseStudyMethodProfileLibrary(input);
    const session = variant.app_feature_sessions![0]!;
    session.feature_occurrences[1]!.denotes_interval = structuredClone(session.feature_occurrences[0]!.denotes_interval);
    session.feature_occurrences.reverse();
    session.feature_occurrences[0]!.feature_name = "UNREPORTED_FEATURE_NAME_NOT_IN_43_LABELS";
    session.feature_occurrences[1]!.denotes_interval = { start_instant: null, end_status: "unobserved" };
    session.session_feature_selections![0]!.response_value_json = ' [ "later-search" ] ';
    session.session_feature_selections![0]!.selection_response_status = "supplied status beyond published examples";
    session.session_feature_selections![1]!.selection_response_status = "skipped";
    session.session_feature_selections![1]!.selected_feature_occurrence_references = ["first-search"]; // SKIP's source storage mapping is unreported.
    delete session.session_feature_selections![2]!.questionnaire_item_label;
    session.session_feature_selections![2]!.response_value_json = null;
    session.session_feature_selections!.push({ questionnaire_response_id: "unanswered", selection_response_status: "unanswered", source_locators: session.source_locators });
    expect(parseStudyMethodProfileLibrary(variant).app_feature_sessions).toEqual(variant.app_feature_sessions);
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).app_feature_sessions).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, app_feature_sessions: [] }).app_feature_sessions).toEqual([]);
    for (const selections of [undefined, null, []]) {
      session.session_feature_selections = selections;
      if (selections === undefined) delete session.session_feature_selections;
      expect(parseStudyMethodProfileLibrary(variant).app_feature_sessions).toEqual(variant.app_feature_sessions);
    }
  });

  it("rejects malformed identities, timing and foreign-session references before replacing saved data", async () => {
    const input = finesseFeatureSessionExample();
    await saveResearchMethodSelection(JSON.stringify(input));
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x.app_feature_sessions[0]!.feature_occurrences, 0, null),
      (x) => Reflect.set(x.app_feature_sessions[0]!.session_feature_selections, 0, null),
      (x) => Reflect.set(x.app_feature_sessions[0]!.session_feature_selections[0]!, "questionnaire_item_label", false),
      (x) => Reflect.set(x.app_feature_sessions[0]!.session_feature_selections[0]!, "response_value_json", false),
      (x) => Reflect.set(x.app_feature_sessions[0]!.session_feature_selections[0]!, "selected_feature_occurrence_references", {}),
      (x) => Reflect.set(x, "app_feature_sessions", null),
      (x) => Reflect.set(x.app_feature_sessions, "0", null),
      (x) => { x.app_feature_sessions[0]!.source_work_id = "foreign-work"; },
      (x) => { x.app_feature_sessions[0]!.method_profile_id = "foreign-profile"; },
      (x) => { x.app_feature_sessions[0]!.participant_id = " "; },
      (x) => { x.app_feature_sessions[0]!.feature_session_id = " "; },
      (x) => { x.app_feature_sessions[0]!.app_name = " "; },
      (x) => Reflect.set(x.app_feature_sessions[0]!, "device_id", 0),
      (x) => Reflect.set(x.app_feature_sessions[0]!, "app_package_name", " "),
      (x) => { x.app_feature_sessions[0]!.session_record_origin = "authentic_raw_row"; },
      (x) => Reflect.set(x.app_feature_sessions[0]!, "denotes_interval", null),
      (x) => { x.app_feature_sessions[0]!.denotes_interval.duration_seconds = Infinity; },
      (x) => Reflect.set(x.app_feature_sessions[0]!.denotes_interval, "end_status", "invented"),
      (x) => Reflect.set(x.app_feature_sessions[0]!, "feature_occurrences", null),
      (x) => { x.app_feature_sessions[0]!.feature_occurrences[0]!.feature_occurrence_id = " "; },
      (x) => { x.app_feature_sessions[0]!.feature_occurrences[0]!.feature_name = " "; },
      (x) => { x.app_feature_sessions[0]!.feature_occurrences.push(structuredClone(x.app_feature_sessions[0]!.feature_occurrences[0]!)); },
      (x) => { x.app_feature_sessions[0]!.feature_occurrences[0]!.source_locators = []; },
      (x) => Reflect.set(x.app_feature_sessions[0]!.feature_occurrences[0]!.denotes_interval, "start_instant", 0),
      (x) => Reflect.set(x.app_feature_sessions[0]!, "session_feature_selections", {}),
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.questionnaire_response_id = " "; },
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.selection_response_status = " "; },
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["later-search", "later-search"]; },
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["SEARCH"]; },
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["foreign-session-occurrence"]; },
      (x) => Reflect.set(x.app_feature_sessions[0]!.session_feature_selections[0]!, "response_value_json", "undefined"),
      (x) => { x.app_feature_sessions[0]!.session_feature_selections[0]!.selection_response_status = "expired"; },
      (x) => { x.app_feature_sessions[0]!.session_feature_selections.push(structuredClone(x.app_feature_sessions[0]!.session_feature_selections[0]!)); },
      (x) => { x.app_feature_sessions[0]!.source_locators = [" "]; },
      (x) => Reflect.set(x.app_feature_sessions[0]!, "computed_regret", false),
      (x) => { x.app_feature_sessions.push(structuredClone(x.app_feature_sessions[0]!)); },
    ];
    for (const [i, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `feature-session mutation ${i}`).toThrow();
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(input);
  });

  it("resolves selections within each session and retains repeated local IDs in other owners", () => {
    const input = finesseFeatureSessionExample();
    const other = structuredClone(input.app_feature_sessions[0]!);
    other.feature_session_id = "example-session-2";
    other.feature_occurrences[0]!.feature_occurrence_id = "foreign-session-occurrence";
    input.app_feature_sessions.push(other);
    expect(parseStudyMethodProfileLibrary(input).app_feature_sessions).toHaveLength(2);
    input.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["foreign-session-occurrence"];
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("within session");
    input.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["later-search"];
    const owner = structuredClone(input.profiles[0]!);
    owner.method_profile_id = "example:another-finesse-owner";
    input.profiles.push(owner);
    const copy = structuredClone(input.app_feature_sessions[0]!);
    copy.method_profile_id = owner.method_profile_id;
    input.app_feature_sessions.push(copy);
    expect(parseStudyMethodProfileLibrary(input).app_feature_sessions).toHaveLength(3);
  });
});

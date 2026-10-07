import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";

import {
  compileNativeMethodProfile,
  parseStudyMethodProfileLibrary,
  requiresConfigurationSelection,
  selectMethodConfiguration,
  summarizeMethodConfigurationGroups,
  type StudyMethodProfile,
  type StudyMethodProfileLibrary,
} from "@/lib/methodProfiles";
import {
  literatureComponentExecutionsForSettings,
  literatureInputAdapterForSetting,
  literatureSourceSchemaForSetting,
  type RegisteredLiteratureComponentExecution,
} from "@/lib/literatureInputAdapters";
import { requireDefined } from "@/lib/invariant";
import { methodProfileOutputBindingForSetting } from "@/lib/sourceArtifactProvenanceRegistry";
import type { BrowserProcessingOptions, MethodProfileReceipt } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: (next: BrowserProcessingOptions) => void;
  onCompiled: (receipt: MethodProfileReceipt | null) => void;
  onComponentSelected: (
    component: RegisteredLiteratureComponentExecution | null,
  ) => void;
  onRunComponent: (component: RegisteredLiteratureComponentExecution) => void;
  componentRunning?: boolean;
  onStatus: (message: string, isError?: boolean) => void;
};

type LiteratureComponentActionsProps = {
  components: readonly RegisteredLiteratureComponentExecution[];
  componentRunning: boolean;
  onComponentSelected: Props["onComponentSelected"];
  onRunComponent: Props["onRunComponent"];
};

export function LiteratureComponentActions({
  components,
  componentRunning,
  onComponentSelected,
  onRunComponent,
}: LiteratureComponentActionsProps): ReactElement | null {
  if (!components.length) return null;
  return (
    <>
      <div className="button-row">
        {components.map((component) => (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="run-literature-component"
            data-component-id={component.componentId}
            disabled={componentRunning}
            key={component.componentId}
            onClick={() => {
              onComponentSelected(component);
              onRunComponent(component);
            }}
          >
            {componentRunning
              ? "Running exact component…"
              : components.length === 1
                ? "Run exact supported component"
                : `Run ${component.componentId}`}
          </button>
        ))}
      </div>
      <ul className="preset-diff__list" data-testid="literature-components">
        {components.map((component) => (
          <li key={component.componentId} data-component-id={component.componentId}>
            <span className="preset-diff__label">{component.componentId}</span>
            <span className="preset-diff__change">
              {component.methodSettingIds.length} exact setting{component.methodSettingIds.length === 1 ? "" : "s"}
            </span>
            <span className="text-faint u-meta-xs">
              Required support: {component.requiredSupportRoles.length
                ? component.requiredSupportRoles.join(", ")
                : "none"}
            </span>
            <ul className="preset-diff__list">
              {component.limitations.map((limitation) => (
                <li key={limitation} className="text-faint u-meta-xs">{limitation}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function settingValue(setting: Record<string, unknown>): string {
  const value = setting.method_value_json;
  if (typeof value !== "string") return "No source value";
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function textList(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
}

function scalarText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function objectIdentity(value: Record<string, unknown>): string {
  const entry = Object.entries(value).find(([key, item]) => key.endsWith("_id") && typeof item === "string"
    && !["method_profile_id", "source_work_id", "participant_id", "device_id"].includes(key));
  return entry ? String(entry[1]) : "source-defined object";
}

function profileLabel(profile: StudyMethodProfile): string {
  const variant = scalarText(profile.source_method_variant_label) || profile.source_method_variant_id;
  return variant === "whole_source" ? profile.source_work_id : `${profile.source_work_id} · ${variant}`;
}

function settingMetadata(setting: Record<string, unknown>): string[] {
  const rows = [
    `Target: ${scalarText(setting.method_target_layer) || "unspecified"} · Applicability: ${scalarText(setting.method_applicability_status)} · Disclosure: ${scalarText(setting.method_disclosure_status)} · Implementation: ${scalarText(setting.method_implementation_status)}`,
  ];
  const semantics = [
    scalarText(setting.method_unit) ? `Unit: ${scalarText(setting.method_unit)}` : "",
    scalarText(setting.method_comparator) ? `Comparator: ${scalarText(setting.method_comparator)}` : "",
    scalarText(setting.method_boundary_convention) ? `Boundary: ${scalarText(setting.method_boundary_convention)}` : "",
  ].filter(Boolean).join(" · ");
  if (semantics) rows.push(semantics);
  const bindings = Array.isArray(setting.contract_bindings)
    ? setting.contract_bindings.map((binding) => typeof binding === "object" && binding !== null
      ? `${String((binding as Record<string, unknown>).contract_slot)}=${String((binding as Record<string, unknown>).contract_value_json)}`
      : "").filter(Boolean).join(", ")
    : "";
  const execution = [
    scalarText(setting.method_execution_route) ? `Route: ${scalarText(setting.method_execution_route)}` : "",
    scalarText(setting.method_execution_destination_id) ? `Destination: ${scalarText(setting.method_execution_destination_id)}` : "",
    scalarText(setting.method_execution_parameter_path) ? `Parameter path: ${scalarText(setting.method_execution_parameter_path)}` : "",
    scalarText(setting.method_execution_blocker_code) ? `Route blocker: ${scalarText(setting.method_execution_blocker_code)}` : "",
    scalarText(setting.executor_id) ? `Executor: ${scalarText(setting.executor_id)}` : "",
    bindings ? `Bindings: ${bindings}` : "",
    textList(setting.required_inputs) ? `Required inputs: ${textList(setting.required_inputs)}` : "",
    scalarText(setting.conformance_fixture_id) ? `Conformance fixture: ${scalarText(setting.conformance_fixture_id)}` : "",
    scalarText(setting.conformance_result_digest) ? `Result: ${scalarText(setting.conformance_result_digest)}` : "",
  ].filter(Boolean).join(" · ");
  if (execution) rows.push(execution);
  const settingId = scalarText(setting.method_setting_id);
  const outputBinding = methodProfileOutputBindingForSetting(settingId);
  if (outputBinding) {
    rows.push(`Output: ${outputBinding.outputKind} position ${outputBinding.sourcePosition} · ${outputBinding.sourceField} → ${outputBinding.canonicalField}`);
  }
  const inputAdapter = literatureInputAdapterForSetting(settingId);
  if (inputAdapter) {
    rows.push(
      `Input adapter: ${inputAdapter.adapterId}/${inputAdapter.adapterVersion} · Role: ${inputAdapter.inputRole} · Schema: ${inputAdapter.schemaId} · Upload: ${inputAdapter.guiSurface}`,
      `Required fields: ${inputAdapter.requiredFields.join(", ")}`,
    );
    const sourceSchema = literatureSourceSchemaForSetting(settingId);
    if (sourceSchema) {
      rows.push(
        `Selected source schema: ${sourceSchema.sourceField} → ${sourceSchema.canonicalField}${sourceSchema.canonicalValue ? `=${sourceSchema.canonicalValue}` : ""}`,
        `Source identity: ${sourceSchema.sourceWorkId} · evidence SHA-256: ${sourceSchema.sourceValueSha256}`,
      );
    }
  }
  const mapping = [
    textList(setting.mapped_ontology_term) ? `Ontology: ${textList(setting.mapped_ontology_term)}` : "",
    textList(setting.mapped_contract_slot) ? `Candidate slots: ${textList(setting.mapped_contract_slot)}` : "",
    scalarText(setting.ontology_mapping_note) ? `Mapping note: ${scalarText(setting.ontology_mapping_note)}` : "",
    scalarText(setting.gap_assessment) ? `Gap: ${scalarText(setting.gap_assessment)}` : "",
  ].filter(Boolean).join(" · ");
  if (mapping) rows.push(mapping);
  const variant = [
    scalarText(setting.method_variant_group_id) ? `Variant group: ${scalarText(setting.method_variant_group_id)}` : "",
    scalarText(setting.method_variant_relation) ? `Relation: ${scalarText(setting.method_variant_relation)}` : "",
    scalarText(setting.method_variant_branch_label) || scalarText(setting.method_variant_branch_id)
      ? `Branch: ${scalarText(setting.method_variant_branch_label) || scalarText(setting.method_variant_branch_id)}`
      : "",
  ].filter(Boolean).join(" · ");
  if (variant) rows.push(variant);
  if (scalarText(setting.structured_protocol_candidate_json)) {
    rows.push(`Protocol candidate: ${scalarText(setting.structured_protocol_candidate_json)}`);
  }
  const provenance = [
    scalarText(setting.evidence_layer) ? `Evidence layer: ${scalarText(setting.evidence_layer)}` : "",
    scalarText(setting.integration_source) ? `Integration source: ${scalarText(setting.integration_source)}` : "",
    textList(setting.source_locators) ? `Source: ${textList(setting.source_locators)}` : "",
    scalarText(setting.source_clause_label) ? `Clause: ${scalarText(setting.source_clause_label)}` : "",
    textList(setting.source_clause_ids) ? `Clause IDs: ${textList(setting.source_clause_ids)}` : "",
  ].filter(Boolean).join(" · ");
  if (provenance) rows.push(provenance);
  if (scalarText(setting.source_clause_text)) rows.push(`Atomic clause: ${scalarText(setting.source_clause_text)}`);
  if (scalarText(setting.source_observed_setting)) rows.push(`Source statement: ${scalarText(setting.source_observed_setting)}`);
  return rows;
}

export function ResearchMethodProfileCard({ options, setOptions, onCompiled, onComponentSelected, onRunComponent, componentRunning = false, onStatus }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [profiles, setProfiles] = useState<StudyMethodProfile[]>([]);
  const [interactionTraces, setInteractionTraces] = useState<StudyMethodProfileLibrary["interaction_traces"]>();
  const [referencedArtifacts, setReferencedArtifacts] = useState<StudyMethodProfileLibrary["referenced_artifacts"]>();
  const [notificationSnapshots, setNotificationSnapshots] = useState<StudyMethodProfileLibrary["notification_snapshots"]>();
  const [ringerStateIntervals, setRingerStateIntervals] = useState<StudyMethodProfileLibrary["ringer_state_intervals"]>();
  const [notificationHistories, setNotificationHistories] = useState<StudyMethodProfileLibrary["notification_histories"]>();
  const [callbackGroups, setCallbackGroups] = useState<StudyMethodProfileLibrary["notification_callback_groups"]>();
  const [titleAnnotations, setTitleAnnotations] = useState<StudyMethodProfileLibrary["notification_title_annotations"]>();
  const [notificationOpenings, setNotificationOpenings] = useState<StudyMethodProfileLibrary["notification_opening_occurrences"]>();
  const [participantDayObservations, setParticipantDayObservations] = useState<StudyMethodProfileLibrary["participant_day_observations"]>();
  const [appFeatureSessions, setAppFeatureSessions] = useState<StudyMethodProfileLibrary["app_feature_sessions"]>();
  const [screenshotSessions, setScreenshotSessions] = useState<StudyMethodProfileLibrary["screenshot_sessions"]>();
  const [interruptionSessions, setInterruptionSessions] = useState<StudyMethodProfileLibrary["app_interruption_sessions"]>();
  const [deviceStateObservations, setDeviceStateObservations] = useState<StudyMethodProfileLibrary["device_state_observations"]>();
  const [deviceStateIntervals, setDeviceStateIntervals] = useState<StudyMethodProfileLibrary["device_state_intervals"]>();
  const [textCaptures, setTextCaptures] = useState<StudyMethodProfileLibrary["screen_text_captures"]>();
  const [sensorControls, setSensorControls] = useState<StudyMethodProfileLibrary["sensor_control_occurrences"]>();
  const [keyboardTransactions, setKeyboardTransactions] = useState<StudyMethodProfileLibrary["keyboard_transactions"]>();
  const [typingTrials, setTypingTrials] = useState<StudyMethodProfileLibrary["typing_trials"]>();
  const [taskOccurrences, setTaskOccurrences] = useState<StudyMethodProfileLibrary["task_occurrences"]>();
  const [associationDatabases, setAssociationDatabases] = useState<StudyMethodProfileLibrary["session_association_databases"]>();
  const [deviceUseSessions, setDeviceUseSessions] = useState<StudyMethodProfileLibrary["device_use_sessions"]>();
  const [sampledQuantities, setSampledQuantities] = useState<StudyMethodProfileLibrary["sampled_quantity_observations"]>();
  const [monthlyCells, setMonthlyCells] = useState<StudyMethodProfileLibrary["monthly_app_use_cells"]>();
  const [selectedId, setSelectedId] = useState("");
  const [selectedLevels, setSelectedLevels] = useState<Record<string, string>>({});
  const selectionTouched = useRef(false);
  const importGeneration = useRef(0);
  const selected = profiles.find((profile) => profile.method_profile_id === selectedId) ?? profiles[0];
  useEffect(() => {
    let cancelled = false;
    void loadResearchMethodSelection().then((text) => {
      if (!text || cancelled || selectionTouched.current) return;
      const saved = JSON.parse(text) as { profile?: unknown; selectedLevels?: unknown; interaction_traces?: unknown; referenced_artifacts?: unknown; notification_snapshots?: unknown; ringer_state_intervals?: unknown; notification_histories?: unknown; notification_callback_groups?: unknown; notification_title_annotations?: unknown; notification_opening_occurrences?: unknown; participant_day_observations?: unknown; app_feature_sessions?: unknown; screenshot_sessions?: unknown; app_interruption_sessions?: unknown; device_state_observations?: unknown; device_state_intervals?: unknown; screen_text_captures?: unknown; sensor_control_occurrences?: unknown; keyboard_transactions?: unknown; typing_trials?: unknown; task_occurrences?: unknown; session_association_databases?: unknown; device_use_sessions?: unknown; sampled_quantity_observations?: unknown; monthly_app_use_cells?: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
        ...(saved.interaction_traces !== undefined ? { interaction_traces: saved.interaction_traces } : {}),
        ...(saved.referenced_artifacts !== undefined ? { referenced_artifacts: saved.referenced_artifacts } : {}),
        ...(saved.notification_snapshots !== undefined ? { notification_snapshots: saved.notification_snapshots } : {}),
        ...(saved.ringer_state_intervals !== undefined ? { ringer_state_intervals: saved.ringer_state_intervals } : {}),
        ...(saved.notification_histories !== undefined ? { notification_histories: saved.notification_histories } : {}),
        ...(saved.notification_callback_groups !== undefined ? { notification_callback_groups: saved.notification_callback_groups } : {}),
        ...(saved.notification_title_annotations !== undefined ? { notification_title_annotations: saved.notification_title_annotations } : {}),
        ...(saved.notification_opening_occurrences !== undefined ? { notification_opening_occurrences: saved.notification_opening_occurrences } : {}),
        ...(saved.participant_day_observations !== undefined ? { participant_day_observations: saved.participant_day_observations } : {}),
        ...(saved.app_feature_sessions !== undefined ? { app_feature_sessions: saved.app_feature_sessions } : {}),
        ...(saved.screenshot_sessions !== undefined ? { screenshot_sessions: saved.screenshot_sessions } : {}),
        ...(saved.app_interruption_sessions !== undefined ? { app_interruption_sessions: saved.app_interruption_sessions } : {}),
        ...(saved.device_state_observations !== undefined ? { device_state_observations: saved.device_state_observations } : {}),
        ...(saved.device_state_intervals !== undefined ? { device_state_intervals: saved.device_state_intervals } : {}),
        ...(saved.screen_text_captures !== undefined ? { screen_text_captures: saved.screen_text_captures } : {}),
        ...(saved.sensor_control_occurrences !== undefined ? { sensor_control_occurrences: saved.sensor_control_occurrences } : {}),
        ...(saved.keyboard_transactions !== undefined ? { keyboard_transactions: saved.keyboard_transactions } : {}),
        ...(saved.typing_trials !== undefined ? { typing_trials: saved.typing_trials } : {}),
        ...(saved.task_occurrences !== undefined ? { task_occurrences: saved.task_occurrences } : {}),
        ...(saved.session_association_databases !== undefined ? { session_association_databases: saved.session_association_databases } : {}),
        ...(saved.device_use_sessions !== undefined ? { device_use_sessions: saved.device_use_sessions } : {}),
        ...(saved.sampled_quantity_observations !== undefined ? { sampled_quantity_observations: saved.sampled_quantity_observations } : {}),
        ...(saved.monthly_app_use_cells !== undefined ? { monthly_app_use_cells: saved.monthly_app_use_cells } : {}) });
      if (!saved.selectedLevels || typeof saved.selectedLevels !== "object" || Array.isArray(saved.selectedLevels) || Object.values(saved.selectedLevels).some((value) => typeof value !== "string")) throw new Error("Saved configuration selection is invalid");
      setProfiles(restored.profiles);
      setInteractionTraces(restored.interaction_traces);
      setReferencedArtifacts(restored.referenced_artifacts);
      setNotificationSnapshots(restored.notification_snapshots);
      setRingerStateIntervals(restored.ringer_state_intervals);
      setNotificationHistories(restored.notification_histories);
      setCallbackGroups(restored.notification_callback_groups);
      setTitleAnnotations(restored.notification_title_annotations);
      setNotificationOpenings(restored.notification_opening_occurrences);
      setParticipantDayObservations(restored.participant_day_observations);
      setAppFeatureSessions(restored.app_feature_sessions);
      setScreenshotSessions(restored.screenshot_sessions);
      setInterruptionSessions(restored.app_interruption_sessions);
      setDeviceStateObservations(restored.device_state_observations);
      setDeviceStateIntervals(restored.device_state_intervals);
      setTextCaptures(restored.screen_text_captures);
      setSensorControls(restored.sensor_control_occurrences);
      setKeyboardTransactions(restored.keyboard_transactions);
      setTypingTrials(restored.typing_trials);
      setTaskOccurrences(restored.task_occurrences);
      setAssociationDatabases(restored.session_association_databases);
      setDeviceUseSessions(restored.device_use_sessions);
      setSampledQuantities(restored.sampled_quantity_observations);
      setMonthlyCells(restored.monthly_app_use_cells);
      setSelectedId(requireDefined(restored.profiles[0], "a restored one-profile library keeps that profile").method_profile_id);
      setSelectedLevels(saved.selectedLevels as Record<string, string>);
    }).catch((error: unknown) => { if (!cancelled && !selectionTouched.current) onStatus(`Research selection could not be restored: ${String(error)}`, true); });
    return () => { cancelled = true; importGeneration.current += 1; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    void saveResearchMethodSelection(JSON.stringify({ profile: selected, selectedLevels,
      interaction_traces: interactionTraces?.filter((trace) => trace.method_profile_id === selected.method_profile_id),
      notification_snapshots: notificationSnapshots?.filter((snapshot) => snapshot.method_profile_id === selected.method_profile_id),
      ringer_state_intervals: ringerStateIntervals?.filter((interval) => interval.method_profile_id === selected.method_profile_id),
      notification_histories: notificationHistories?.filter((history) => history.method_profile_id === selected.method_profile_id),
      notification_callback_groups: callbackGroups?.filter((group) => group.method_profile_id === selected.method_profile_id),
      notification_title_annotations: titleAnnotations?.filter((annotation) => annotation.method_profile_id === selected.method_profile_id),
      notification_opening_occurrences: notificationOpenings?.filter((opening) => opening.method_profile_id === selected.method_profile_id),
      participant_day_observations: participantDayObservations?.filter((observation) => observation.method_profile_id === selected.method_profile_id),
      app_feature_sessions: appFeatureSessions?.filter((session) => session.method_profile_id === selected.method_profile_id),
      screenshot_sessions: screenshotSessions?.filter((session) => session.method_profile_id === selected.method_profile_id),
      app_interruption_sessions: interruptionSessions?.filter((session) => session.method_profile_id === selected.method_profile_id),
      device_state_observations: deviceStateObservations?.filter((record) => record.method_profile_id === selected.method_profile_id),
      device_state_intervals: deviceStateIntervals?.filter((record) => record.method_profile_id === selected.method_profile_id),
      screen_text_captures: textCaptures?.filter((record) => record.method_profile_id === selected.method_profile_id),
      sensor_control_occurrences: sensorControls?.filter((record) => record.method_profile_id === selected.method_profile_id),
      keyboard_transactions: keyboardTransactions?.filter((record) => record.method_profile_id === selected.method_profile_id),
      typing_trials: typingTrials?.filter((record) => record.method_profile_id === selected.method_profile_id),
      task_occurrences: taskOccurrences?.filter((record) => record.method_profile_id === selected.method_profile_id),
      session_association_databases: associationDatabases?.filter((record) => record.method_profile_id === selected.method_profile_id),
      device_use_sessions: deviceUseSessions?.filter((record) => record.method_profile_id === selected.method_profile_id),
      sampled_quantity_observations: sampledQuantities?.filter((record) => record.method_profile_id === selected.method_profile_id),
      monthly_app_use_cells: monthlyCells?.filter((record) => record.method_profile_id === selected.method_profile_id),
      referenced_artifacts: referencedArtifacts })).catch((error: unknown) => onStatus(`Research selection could not be saved: ${String(error)}`, true));
  }, [selected, selectedLevels, interactionTraces, referencedArtifacts, notificationSnapshots, ringerStateIntervals, notificationHistories, callbackGroups, titleAnnotations, notificationOpenings, participantDayObservations, appFeatureSessions, screenshotSessions, interruptionSessions, deviceStateObservations, deviceStateIntervals, textCaptures, sensorControls, keyboardTransactions, typingTrials, taskOccurrences, associationDatabases, deviceUseSessions, sampledQuantities, monthlyCells]);
  const grouped = useMemo(() => {
    const groups = new Map<string, StudyMethodProfile["method_settings"]>();
    for (const setting of selected?.method_settings ?? []) {
      const role = typeof setting.method_setting_role === "string" ? setting.method_setting_role : "provenance";
      groups.set(role, [...(groups.get(role) ?? []), setting]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selected]);
  const configurationGroups = useMemo(() => summarizeMethodConfigurationGroups(selected?.method_settings ?? []), [selected]);
  const configurationSpace = selected && typeof selected.method_configuration_space === "object"
    && selected.method_configuration_space !== null && !Array.isArray(selected.method_configuration_space)
    ? selected.method_configuration_space as Record<string, unknown>
    : null;
  const configurationSelection = useMemo(
    () => selected ? selectMethodConfiguration(selected, selectedLevels) : null,
    [selected, selectedLevels],
  );
  const compiled = useMemo(
    () => selected
      ? compileNativeMethodProfile(selected, options, configurationSelection?.ok ? configurationSelection.selection : undefined)
      : null,
    [configurationSelection, options, selected],
  );
  const loadablePlan = compiled?.ok ? compiled : compiled?.supportedPlan;
  const currentSettingsMatch = Boolean(loadablePlan && JSON.stringify(loadablePlan.options) === JSON.stringify(options));
  const componentExecutions = useMemo(() => {
    if (!selected) return [];
    return literatureComponentExecutionsForSettings(
      selected.method_settings.map((setting) => setting.method_setting_id),
    );
  }, [selected]);
  const profileComponentExecutions = useMemo(() => selected
    ? componentExecutions.filter((component) =>
      component.parentMethodProfileId === selected.method_profile_id &&
      component.sourceWorkId === selected.source_work_id &&
      component.sourceMethodVariantId === selected.source_method_variant_id &&
      component.methodProfileVersion === selected.method_profile_version)
    : [], [componentExecutions, selected]);
  const componentExecution = profileComponentExecutions.length === 1
    ? profileComponentExecutions[0]
    : undefined;
  useEffect(() => {
    onComponentSelected(componentExecution ?? null);
  }, [componentExecution, onComponentSelected, selected?.method_profile_id]);
  const typedSections = selected ? [
    ["Method operations", records(selected.method_operations)],
    ["Acquisition protocols", records(selected.acquisition_protocols)],
    ["Session construction policies", records(selected.session_construction_policies)],
    ["Notification attribution policies", records(selected.notification_attribution_policies)],
    ["Duration policies", records(selected.duration_policies)],
    ["Timestamp policies", records(selected.timestamp_policies)],
    ["Parameter provenance assertions", records(selected.parameter_provenance_assertions)],
    ["Source artifact provenance", records(selected.source_artifact_provenance_assertions)],
    ["Diary protocols", records(selected.diary_protocols)],
    ["Release profiles", records(selected.release_profiles)],
    ["Protocol materialization blockers", records(selected.protocol_materialization_blockers)],
    ["Supplied interaction traces", records(interactionTraces?.filter((trace) => trace.method_profile_id === selected.method_profile_id))],
    ["Referenced payload identities", records(referencedArtifacts)],
    ["Notification drawer snapshots", records(notificationSnapshots?.filter((snapshot) => snapshot.method_profile_id === selected.method_profile_id))],
    ["Ringer-state intervals", records(ringerStateIntervals?.filter((interval) => interval.method_profile_id === selected.method_profile_id))],
    ["Notification histories", records(notificationHistories?.filter((history) => history.method_profile_id === selected.method_profile_id))],
    ["Notification callback groups", records(callbackGroups?.filter((group) => group.method_profile_id === selected.method_profile_id))],
    ["Notification title annotations", records(titleAnnotations?.filter((annotation) => annotation.method_profile_id === selected.method_profile_id))],
    ["Notification opening occurrences", records(notificationOpenings?.filter((opening) => opening.method_profile_id === selected.method_profile_id))],
    ["Participant-period observations", records(participantDayObservations?.filter((observation) => observation.method_profile_id === selected.method_profile_id))],
    ["App feature sessions", records(appFeatureSessions?.filter((session) => session.method_profile_id === selected.method_profile_id))],
    ["Screenshot sessions", records(screenshotSessions?.filter((session) => session.method_profile_id === selected.method_profile_id))],
    ["App interruption sessions", records(interruptionSessions?.filter((session) => session.method_profile_id === selected.method_profile_id))],
    ["Device-state observations", records(deviceStateObservations?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Device-state intervals", records(deviceStateIntervals?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Screen-text captures", records(textCaptures?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Sensor-control occurrences", records(sensorControls?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Keyboard transactions", records(keyboardTransactions?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Typing-trial membership", records(typingTrials?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Task occurrences", records(taskOccurrences?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Session association databases", records(associationDatabases?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Device-use sessions", records(deviceUseSessions?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Sampled quantities", records(sampledQuantities?.filter((record) => record.method_profile_id === selected.method_profile_id))],
    ["Monthly app-use cells", records(monthlyCells?.filter((record) => record.method_profile_id === selected.method_profile_id))],
  ] as const : [];

  return (
    <section className="settings-management" aria-labelledby="research-method-profile-title" data-settings-anchor="research-method-profile">
      <header className="workflow-section__header">
        <div>
          <h3 id="research-method-profile-title" className="workflow-section__subtitle">Research method profile</h3>
          <p className="workflow-section__intro">
            Load source-backed paper or diary profiles, inspect every setting, and compile the exact native preprocessing lane. Input, downstream-analysis, and evidence readiness remain explicit.
          </p>
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="method-profile-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const generation = ++importGeneration.current;
          void (async () => {
            try {
              const text = await file.text();
              if (generation !== importGeneration.current) return;
              const parsed: unknown = JSON.parse(text) as unknown;
              const library = parseStudyMethodProfileLibrary(parsed);
              selectionTouched.current = true;
              onCompiled(null);
              setProfiles(library.profiles);
              setInteractionTraces(library.interaction_traces);
              setReferencedArtifacts(library.referenced_artifacts);
              setNotificationSnapshots(library.notification_snapshots);
              setRingerStateIntervals(library.ringer_state_intervals);
              setNotificationHistories(library.notification_histories);
              setCallbackGroups(library.notification_callback_groups);
              setTitleAnnotations(library.notification_title_annotations);
              setNotificationOpenings(library.notification_opening_occurrences);
              setParticipantDayObservations(library.participant_day_observations);
              setAppFeatureSessions(library.app_feature_sessions);
              setScreenshotSessions(library.screenshot_sessions);
              setInterruptionSessions(library.app_interruption_sessions);
              setDeviceStateObservations(library.device_state_observations);
              setDeviceStateIntervals(library.device_state_intervals);
              setTextCaptures(library.screen_text_captures);
              setSensorControls(library.sensor_control_occurrences);
              setKeyboardTransactions(library.keyboard_transactions);
              setTypingTrials(library.typing_trials);
              setTaskOccurrences(library.task_occurrences);
              setAssociationDatabases(library.session_association_databases);
              setDeviceUseSessions(library.device_use_sessions);
              setSampledQuantities(library.sampled_quantity_observations);
              setMonthlyCells(library.monthly_app_use_cells);
              setSelectedId(library.profiles[0]?.method_profile_id ?? "");
              setSelectedLevels({});
              onStatus(`Loaded ${library.profiles.length} research method profile${library.profiles.length === 1 ? "" : "s"}.`);
            } catch (error) {
              if (generation !== importGeneration.current) return;
              onStatus(`Method profile import failed: ${error instanceof Error ? error.message : String(error)}`, true);
            }
          })();
        }}
      />
      <div className="button-row">
        <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
          Import method profile
        </button>
        {selected ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!loadablePlan}
            onClick={() => {
              if (!loadablePlan) return;
              setOptions(loadablePlan.options);
              onCompiled(compiled?.ok ? compiled.receipt : null);
              onStatus(`Loaded ${compiled?.ok ? "selected" : "incomplete, currently supported preprocessing"} settings from ${selected.source_work_id}.`);
            }}
          >
            Load {compiled?.ok ? "selected" : "supported preprocessing"} settings
          </button>
        ) : null}
      </div>

      <LiteratureComponentActions
        components={profileComponentExecutions}
        componentRunning={componentRunning}
        onComponentSelected={onComponentSelected}
        onRunComponent={onRunComponent}
      />

      {selected ? (
        <div className="settings-management__group">
          {profiles.length > 1 ? (
            <label>
              <span className="settings-management__group-title">Profile</span>
              <select className="input" value={selected.method_profile_id} onChange={(event) => {
                onCompiled(null);
                setSelectedId(event.target.value);
                setSelectedLevels({});
              }}>
                {profiles.map((profile) => <option key={profile.method_profile_id} value={profile.method_profile_id}>{profileLabel(profile)}</option>)}
              </select>
            </label>
          ) : null}
          <p className="text-faint u-meta-xs">
            Variant: {profileLabel(selected)} · {label(selected.method_configuration_structure)} · {selected.method_settings.length} evidence-bound settings · {compiled?.ok ? "Selected settings ready" : `${compiled?.blockers.length ?? 0} completion blockers`}
            {loadablePlan ? ` · ${currentSettingsMatch ? "Current supported settings match" : "Supported settings not loaded or modified"}` : ""}
            {compiled?.ok && compiled.receipt.externalBindings?.length
              ? ` · External runtime: ${compiled.receipt.externalBindings.map((binding) => `${binding.executorId} / ${binding.sourceConfigurationId}`).join(", ")}`
              : ""}
            {profileComponentExecutions.length
              ? ` · Exact component${profileComponentExecutions.length === 1 ? "" : "s"} available: ${profileComponentExecutions.map((component) => component.componentId).join(", ")}; full profile remains blocked`
              : ""}
          </p>
          {compiled ? (
            <p className="text-faint u-meta-xs">
              Readiness: {(["configuration", "input", "preprocessing", "downstream", "evidence"] as const)
                .map((dimension) => `${label(dimension)} ${label(compiled.readiness[dimension].status)}`)
                .join(" · ")} · {label(compiled.readiness.disposition)}
            </p>
          ) : null}
          {compiled && !compiled.ok ? (
            <details>
              <summary>Completion blockers ({compiled.blockers.length})</summary>
              <ul className="preset-diff__list">
                {compiled.blockers.map((blocker, index) => (
                  <li key={`${blocker.settingId}:${blocker.code}:${index}`}>
                    <span className="preset-diff__label">{blocker.settingId}</span>
                    <span className="preset-diff__change">{label(blocker.code)}</span>
                    <span className="text-faint u-meta-xs">{blocker.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {configurationGroups.length ? (
            <details>
              <summary>Configuration groups ({configurationGroups.length})</summary>
              <ul className="preset-diff__list">
                {configurationGroups.map((group) => (
                  <li key={group.id}>
                    <span className="preset-diff__label">{group.id}</span>
                    <span className="preset-diff__change">{group.partitionRequired ? "Variant partition pending" : "Joint or fixed"}</span>
                    <span className="text-faint u-meta-xs">
                      {group.settingCount} settings
                      {group.kinds.length ? ` · ${group.kinds.map(label).join(", ")}` : ""}
                      {group.axes.length ? ` · axes: ${group.axes.join(", ")}` : ""}
                      {group.branches.length ? ` · branches: ${group.branches.join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {configurationSpace ? (
            <details>
              <summary>Source configuration space ({records(configurationSpace.method_configuration_groups).length} groups)</summary>
              <p className="text-faint u-meta-xs">
                {scalarText(configurationSpace.method_configuration_space_id)} · {label(scalarText(configurationSpace.method_configuration_structure))}
                {configurationSelection?.ok ? ` · selected inventory: ${configurationSelection.selection.effectiveSettingIds.length} settings` : ` · ${configurationSelection?.blockers.length ?? 0} selection blocker(s)`}
              </p>
              {configurationSelection && !configurationSelection.ok ? (
                <ul className="preset-diff__list">
                  {configurationSelection.blockers.map((blocker, index) => (
                    <li key={`${blocker.groupId}:${blocker.code}:${index}`}>
                      <span className="preset-diff__label">{blocker.groupId}</span>
                      <span className="preset-diff__change">{label(blocker.code)}</span>
                      <span className="text-faint u-meta-xs">{blocker.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="preset-diff__list">
                {records(configurationSpace.method_configuration_groups).map((group) => (
                  <li key={scalarText(group.method_configuration_group_id)}>
                    <span className="preset-diff__label">{scalarText(group.method_configuration_group_id)}</span>
                    <span className="preset-diff__change">{label(scalarText(group.method_configuration_group_kind))}</span>
                    <span className="text-faint u-meta-xs">
                      {label(scalarText(group.method_selection_semantics))} · {records(group.method_configuration_levels).length} source-declared level(s) · {scalarText(group.method_cross_product_policy)}
                    </span>
                    {requiresConfigurationSelection(group) ? (
                      <label>
                        <span className="text-faint u-meta-xs">Select exact source level</span>
                        <select
                          className="input"
                          value={selectedLevels[scalarText(group.method_configuration_group_id)] ?? ""}
                          onChange={(event) => setSelectedLevels((current) => ({
                            ...current,
                            [scalarText(group.method_configuration_group_id)]: event.target.value,
                          }))}
                        >
                          <option value="">Choose a source-declared level</option>
                          {records(group.method_configuration_levels).map((levelValue) => (
                            <option key={scalarText(levelValue.method_configuration_level_id)} value={scalarText(levelValue.method_configuration_level_id)}>
                              {scalarText(levelValue.method_configuration_level_label)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {records(group.method_configuration_levels).map((levelValue) => (
                      <span key={scalarText(levelValue.method_configuration_level_id)} className="text-faint u-meta-xs">
                        {scalarText(levelValue.method_configuration_level_label)} · included {textList(levelValue.included_method_setting_ids) || "none"} · excluded {textList(levelValue.excluded_method_setting_ids) || "none"} · common membership {textList(levelValue.common_method_setting_ids) || "none"} · branch membership {textList(levelValue.branch_method_setting_ids) || "none"}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {interactionTraces?.length || referencedArtifacts?.length ? (
            <p className="text-faint">Supplied normalized records and payload identities only. Referenced payload bytes are not imported or verified by this method-profile import.</p>
          ) : null}
          {notificationSnapshots?.length ? (
            <p className="text-faint">Supplied normalized drawer observations only. An absent snapshot is not an observed empty drawer or a recorded user action.</p>
          ) : null}
          {ringerStateIntervals?.length ? (
            <p className="text-faint">Supplied normalized ringer occupancy only, not continuous device use or an executed constructor. No powered-off duration or missing endpoint is inferred.</p>
          ) : null}
          {deviceStateObservations?.some((record) => record.method_profile_id === selected.method_profile_id)
            || deviceStateIntervals?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied normalized joint states and interval endpoint supports only. Screen-off is not locked; upper-bound unlock cost is not authentication time. No state reconstruction, clock conversion, ordering or duration calculation runs during import.</p>
          ) : null}
          {deviceUseSessions?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied device sessions, owned actions, independent questionnaire answers, definition-specific labels and source-linked quantities. Session, app and category quantities stay distinct even when an app or category identity is unknown. Explicit local action supports retain distinct visits to the same app; answer supports retain response-specific quantities without asserting a clock anchor. Action membership, order and explicit following-interval links stay as supplied, not inferred from equal times. Missing is not negative; repeated answers stay separate. No session reconstruction, prompt scheduling, raw joining, aggregation or label scoring runs during import.</p>
          ) : null}
          {sampledQuantities?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied observations keep process, CPU-core, Android-UID, device and participant subjects distinct. Byte directions, frequency-residency qualifiers and emotion confidence retain their source-specific meaning; confidence is not percent. Unknown units and collection times stay unknown. No counter arithmetic, interval totals or application/frame joins are inferred.</p>
          ) : null}
          {monthlyCells?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Monthly app-use cells retain user, app and month identity: 1 means used, 0 means not used during that month. Unknown cells stay unknown; month labels do not imply day boundaries or a complete fingerprint.</p>
          ) : null}
          {textCaptures?.some((record) => record.method_profile_id === selected.method_profile_id)
            || sensorControls?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied normalized text captures, phrase rectangles and separate sensor-control occurrences only. Equal text does not merge phrase identities; bounds are not glyph positions or visibility. No text parsing, deduplication, clock conversion or disabled-period reconstruction runs during import.</p>
          ) : null}
          {keyboardTransactions?.some((record) => record.method_profile_id === selected.method_profile_id)
            || typingTrials?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied before/after keyboard transactions remain independent of supplied typing-trial membership. Word-correctness and text-change cases keep separate system verdicts and F/T feedback: F means a reported typo in the word task, a reported correction in the change task. Trial questionnaire answers remain separate; withheld text stays unknown. Explicit derived-only trials preserve released lexical cells without inventing retained actions or app/reset/pause boundaries. No trial construction, timestamp sorting, correction classification, questionnaire join, or raw 0/1 flag decoding runs during import.</p>
          ) : null}
          {notificationHistories?.some((history) => history.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied normalized notification histories only; origin distinguishes examples from supplied records, not authentic source rows. Recorded classifications, inferred attention proxies, subjective answers and acceptance outcomes stay separate. Response-stage observability, device-use context, endpoint and objective labels remain independent; unobservable is not an observed negative. No matching or acceptance recode runs during import.</p>
          ) : null}
          {titleAnnotations?.some((annotation) => annotation.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Participant/title labels remain shared annotations, separate from item-specific categories. No title matching, location join or category resolution runs during import; raw titles may be withheld.</p>
          ) : null}
          {callbackGroups?.some((group) => group.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied normalized posted-callback groups and retained-member analytic alert proxies only, not logical notification items or observed perception. Equal times and payloads do not merge callbacks. No burst reconstruction, title filtering, LAST selection or timestamp sorting runs during import.</p>
          ) : null}
          {notificationOpenings?.some((opening) => opening.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied opening identity and pending membership only; app opening is not process launch or actual reading. No pending matching or view inference runs during import.</p>
          ) : null}
          {participantDayObservations?.some((observation) => observation.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied day, specific-hour or night observations, or separately identified collection-run modality availability. Run availability is not an objective aggregate, refusal, permission state, zero count or model eligibility. Legacy day-named transport keys do not turn hours, nights or runs into days; the prompt or submission day is not the recalled day. Explicit cross-period comparisons stay separate from same-period supports. No period reconstruction, aggregation, scheduling or correlation runs during import. Period adjacency, boundaries and timestamp joins are not inferred.</p>
          ) : null}
          {appFeatureSessions?.some((session) => session.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied app sessions, timed feature occurrences and instance-selection responses only. Same-label occurrences stay distinct; submitted-empty is not unanswered or expired. No timing, classifier, sampling eligibility or regret label is inferred during import.</p>
          ) : null}
          {taskOccurrences?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied task occurrences, action roles and independent criterion assessments only. Content evidence is separate from the assessment result; supports resolve within the owning task. Supplied questionnaire answers reference the owning profile's answer or instrument definition, not its invitation. Answers may concern the task/session or a separately identified condition-level questionnaire; no complete instrument, numeric recode or navigation-trial link is inferred. Supplied observation windows reference local anchor actions, compared answers and source definitions; unknown endpoints remain unknown, and no means or first-response events are calculated. No script matching, role assignment, timing reconstruction or scoring runs during import.</p>
          ) : null}
          {associationDatabases?.some((record) => record.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied session transactions and association rules only. Antecedent and consequent are unordered itemsets, not app chronology or causation. Explicit absence differs from an unreported item; clustering and pooled mining remain separately referenced. No session reconstruction, clustering, mining or metric calculation runs during import.</p>
          ) : null}
          {screenshotSessions?.some((session) => session.method_profile_id === selected.method_profile_id) ? (
            <p className="text-faint">Supplied screenshot sessions and range labels only. Range endpoints do not imply inclusive membership or whole-session intent; unlabeled screenshots are not negative answers. No session reconstruction, screenshot deduplication, label propagation or payload verification runs during import.</p>
          ) : null}
          {typedSections.filter(([, objects]) => objects.length).map(([section, objects]) => (
            <details key={section}>
              <summary>{section} ({objects.length})</summary>
              <ul className="preset-diff__list">
                {objects.map((object, index) => (
                  <li key={`${objectIdentity(object)}:${index}`} data-testid={section === "Source artifact provenance" ? "source-artifact-provenance-row" : undefined}>
                    <span className="preset-diff__label">{objectIdentity(object)}</span>
                    {Object.entries(object).filter(([key]) => key !== "method_settings").map(([key, value]) => (
                      <span key={key} className="text-faint u-meta-xs">{label(key)}: {scalarText(value) || JSON.stringify(value)}</span>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {grouped.map(([role, settings]) => (
            <details key={role}>
              <summary>{label(role)} ({settings.length})</summary>
              <ul className="preset-diff__list">
                {settings.map((setting) => (
                  <li key={setting.method_setting_id}>
                    <span className="preset-diff__label">{typeof setting.method_parameter_key === "string" ? setting.method_parameter_key : setting.source_component_id as string}</span>
                    <span className="preset-diff__change">{settingValue(setting)}</span>
                    {settingMetadata(setting).map((row) => <span key={row} className="text-faint u-meta-xs">{row}</span>)}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <p className="empty-state">No source-backed method profile loaded.</p>
      )}
    </section>
  );
}

import { useState, type ReactElement } from "react";

import {
  SLEEP_DIARY_SUPPORTED_PROFILE,
  SLEEP_DIARY_SUPPORTED_PROFILES,
  SLEEP_DIARY_VARIANTS,
  createSleepDiaryMethodProfileReceipt,
} from "@/lib/sleepDiaryReplication";
import { requireDefined } from "@/lib/invariant";
import type { MethodProfileReceipt } from "@/lib/types";

type Props = {
  methodProfileReceipt: MethodProfileReceipt | null;
  onBound: (receipt: MethodProfileReceipt | null) => void;
  onStatus: (message: string, isError?: boolean) => void;
};

export function SleepDiaryReplicationCard({ methodProfileReceipt, onBound, onStatus }: Props): ReactElement {
  const boundDiary = methodProfileReceipt?.diaryReplicationBinding;
  const [selectedVersionId, setSelectedVersionId] = useState(
    boundDiary?.versionDefinitionId ?? SLEEP_DIARY_SUPPORTED_PROFILE.versionDefinitionId,
  );
  const [selectedLayoutId, setSelectedLayoutId] = useState(
    boundDiary?.mappingProfileId ?? SLEEP_DIARY_SUPPORTED_PROFILE.mappingProfile.mapping_profile_id,
  );
  const [verifying, setVerifying] = useState(false);
  const selected = SLEEP_DIARY_VARIANTS.find((variant) => variant.versionDefinitionId === selectedVersionId)
    ?? requireDefined(SLEEP_DIARY_VARIANTS[0], "the sleep-diary bridge ships at least one variant");
  const availableProfiles = SLEEP_DIARY_SUPPORTED_PROFILES.filter((profile) => (
    profile.versionDefinitionId === selected.versionDefinitionId
  ));
  const selectedProfile = availableProfiles.find((profile) => (
    profile.mappingProfile.mapping_profile_id === selectedLayoutId
  ));
  const isBound = methodProfileReceipt?.diaryReplicationBinding?.versionDefinitionId === selected.versionDefinitionId
    && methodProfileReceipt.diaryReplicationBinding.mappingProfileId === selectedLayoutId;

  return (
    <section className="settings-management" aria-labelledby="sleep-diary-replication-title" data-settings-anchor="sleep-diary-replication">
      <header className="workflow-section__header">
        <div>
          <h3 id="sleep-diary-replication-title" className="workflow-section__subtitle">Sleep diary replication</h3>
          <p className="workflow-section__intro">
            Select an exact reviewed diary variant. Every full protocol remains blocked; registered released layouts can be fixture-verified and recorded without claiming protocol execution.
          </p>
        </div>
      </header>

      <label htmlFor="sleep-diary-variant">Diary variant</label>
      <select
        id="sleep-diary-variant"
        className="input"
        value={selected.versionDefinitionId}
        onChange={(event) => {
          const versionDefinitionId = event.target.value;
          const profile = SLEEP_DIARY_SUPPORTED_PROFILES.find((candidate) => (
            candidate.versionDefinitionId === versionDefinitionId
          ));
          setSelectedVersionId(versionDefinitionId);
          setSelectedLayoutId(profile?.mappingProfile.mapping_profile_id ?? "");
        }}
      >
        {SLEEP_DIARY_VARIANTS.map((variant) => (
          <option key={variant.versionDefinitionId} value={variant.versionDefinitionId}>
            {variant.label} · {variant.versionLabel} · blocked ({variant.blockerCodes.length})
          </option>
        ))}
      </select>

      <p role="status">
        <strong>Full profile: blocked.</strong> {selected.blockerCodes.length} source blocker{selected.blockerCodes.length === 1 ? "" : "s"}.
        {selected.releasedSourceLayoutIds.length
          ? ` Released layouts: ${selected.releasedSourceLayoutIds.join(", ")}.`
          : " No released source layout is executable in Chronicle."}
      </p>

      {selectedProfile ? (
        <div>
          <label htmlFor="sleep-diary-layout">Released source layout</label>
          <select
            id="sleep-diary-layout"
            className="input"
            value={selectedLayoutId}
            onChange={(event) => setSelectedLayoutId(event.target.value)}
          >
            {availableProfiles.map((profile) => (
              <option key={profile.mappingProfile.mapping_profile_id} value={profile.mappingProfile.mapping_profile_id}>
                {profile.mappingProfile.mapping_profile_id} · {profile.mappingProfile.execution_adapter_id}/{profile.mappingProfile.execution_adapter_version}
              </option>
            ))}
          </select>
          <p>
            Composed from {selectedProfile.compositionVersionDefinitionIds.length} reviewed version definition{selectedProfile.compositionVersionDefinitionIds.length === 1 ? "" : "s"}: {selectedProfile.diaryItems.length} diary items, {selectedProfile.formElements.length} form elements, {selectedProfile.diaryScheduleRules.length} schedule rules, {selectedProfile.administrationSchedules.length} administration schedules, and {selectedProfile.ruleDefinitions.length} rules.
          </p>
          <details>
            <summary>Composed form ({selectedProfile.formElements.length} elements)</summary>
            <ol>
              {selectedProfile.formElements.map((element) => (
                <li key={element.form_element_definition_id}>
                  <strong>{element.form_element_definition_id}</strong> · {element.element_kind}
                  {element.display_text ? ` · ${element.display_text}` : ""}
                  {element.response_control ? ` · ${element.response_control}` : ""}
                </li>
              ))}
            </ol>
          </details>
          <details>
            <summary>Composed schedule ({selectedProfile.diaryScheduleRules.length} rules)</summary>
            <ul>
              {selectedProfile.diaryScheduleRules.map((rule) => (
                <li key={rule.id}>
                  <strong>{rule.id}</strong> · {rule.administrationTimingLexical ?? "timing blocked"}
                  {rule.dayBoundaryRuleLexical ? ` · ${rule.dayBoundaryRuleLexical}` : ""}
                  {` · ${rule.blockers.length} blocker${rule.blockers.length === 1 ? "" : "s"}`}
                </li>
              ))}
            </ul>
          </details>
          <div className="button-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={verifying}
              onClick={() => {
                setVerifying(true);
                void createSleepDiaryMethodProfileReceipt(selectedProfile.versionDefinitionId, selectedLayoutId)
                  .then((receipt) => {
                    onBound(receipt);
                    onStatus(`Verified and bound ${selectedLayoutId}. The released layout passed its shared fixture; the full diary profile remains blocked.`);
                  })
                  .catch((error: unknown) => {
                    onStatus(`Sleep diary layout verification failed: ${error instanceof Error ? error.message : String(error)}`, true);
                  })
                  .finally(() => setVerifying(false));
              }}
            >
              {verifying ? "Verifying shared fixture…" : isBound ? "Re-verify shared fixture" : "Verify shared fixture and bind layout"}
            </button>
            {isBound ? (
              <button type="button" className="btn btn--ghost" onClick={() => onBound(null)}>Remove diary binding</button>
            ) : null}
          </div>
          {isBound ? (
            <p>
              Bound receipt: fixture {methodProfileReceipt?.diaryReplicationBinding?.fixtureId}; normalized SHA-256 {methodProfileReceipt?.diaryReplicationBinding?.fixtureNormalizedSha256}.
            </p>
          ) : null}
        </div>
      ) : (
        <p>This variant cannot be bound: Chronicle has no fixture-verified released layout for it.</p>
      )}
    </section>
  );
}

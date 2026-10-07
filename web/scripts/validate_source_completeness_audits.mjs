#!/usr/bin/env node
// @ts-nocheck -- executable Node corpus/literature generator; its runnable gate (self-test, ledger counts, --check) is authoritative, not checkJs over untyped JSON authorities.

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { loadPostFreezeAdmissions } from "./literature_post_freeze_admissions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const libraryPath = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/method-profile-library.json");
const auditDirectory = resolve(repo, ".tmp-literature-review-private/ontology-sublation-20260831/source-completeness-audits");
const requireComplete = process.argv.includes("--complete");
const ontology = JSON.parse(readFileSync(resolve(repo,
  "web/schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8"));
assert(Array.isArray(ontology.$defs.MethodSettingRoleId.enum), "missing generated method-role vocabulary");
assert(Array.isArray(ontology.$defs.MethodTargetLayerId.enum), "missing generated method-target vocabulary");
const canonicalRoles = new Set(ontology.$defs.MethodSettingRoleId.enum);
const canonicalTargets = new Set(ontology.$defs.MethodTargetLayerId.enum);
assert(canonicalRoles.size && canonicalTargets.size, "empty generated method vocabulary");
const assertCanonicalRoleTarget = (atom, label) => {
  if (!canonicalRoles.has(atom.canonical_role) || !canonicalTargets.has(atom.canonical_target)) {
    throw new Error(`${label}: atom ${atom.key} lacks a valid explicit canonical role/target`);
  }
};
if (process.argv.includes("--self-test")) {
  for (const target of ["notification_alert", "notification_attendance", "notification_item",
    "analysis_record_set", "device_setting_state_interval"]) {
    assert.doesNotThrow(() => assertCanonicalRoleTarget({
      key: "self-test", canonical_role: "reconstruction", canonical_target: target,
    }, "self-test"));
  }
  for (const [role, target] of [["preprocessing", "raw_record"],
    ["reconstruction", "notification_alert_unrepresented"]]) {
    assert.throws(() => assertCanonicalRoleTarget({
      key: "self-test", canonical_role: role, canonical_target: target,
    }, "self-test"), /lacks a valid explicit canonical role\/target/);
  }
  console.log("PASS generated ontology roles/targets; draft-only labels rejected");
  process.exit(0);
}
const implementationDispositions = new Set(["retain_current_exact", "specification_only"]);
const applicabilityStatuses = new Set(["applicable", "not_applicable", "undetermined"]);
const disclosureStatuses = new Set(["declared", "declared_partial", "delegated", "absent", "not_applicable", "undetermined"]);
const projectionDispositions = new Set(["method_setting", "configuration_metadata"]);
const configurationUnitKinds = new Set([
  "user_selectable_alternative",
  "fixed_pipeline_stage_component",
  "campaign_internal_job_model_cell",
  "output_result_oracle_row",
  "evidence_only_unavailable",
]);
const genericArtifactTokens = new Set(["artifact", "fulltext", "primary", "source", "supplement"]);

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const locatorNamesArtifact = (locator, artifacts) => {
  const normalizedLocator = locator.toLowerCase();
  return artifacts.some((artifact) => {
    const basename = artifact.path.split("/").at(-1);
    const distinctiveTokens = basename.toLowerCase().replace(/\.(pdf|txt|zip|html|xml|docx|jsonl?|rds)$/, "")
      .split("-").filter((token) => token.length >= 5 && !genericArtifactTokens.has(token));
    return locator.includes(artifact.path) || locator.includes(basename)
      || distinctiveTokens.some((token) => normalizedLocator.includes(token));
  });
};
const library = JSON.parse(readFileSync(libraryPath, "utf8"));
const frozenExpected = new Set(library.profiles.map((profile) => profile.source_work_id));
if (!frozenExpected.size || frozenExpected.size !== library.profiles.length) fail("canonical profile identities are missing or duplicated");
const admissions = loadPostFreezeAdmissions(repo, frozenExpected);
const expected = new Set([...frozenExpected, ...admissions.map((entry) => entry.canonical_work_id)]);
if ((statSync(auditDirectory).mode & 0o777) !== 0o700) fail("source-completeness audit directory must be mode 0700");

const auditPaths = readdirSync(auditDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => resolve(auditDirectory, name))
  .concat(admissions.map((entry) => resolve(repo, entry.audit_path)));
const records = auditPaths.map((path) => {
    const name = path.split("/").at(-1);
    if ((statSync(path).mode & 0o777) !== 0o600) fail(`${name}: audit must be mode 0600`);
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.schema_version !== "chronicle-source-completeness-audit/v1") fail(`${name}: unknown schema`);
    if (!expected.has(record.source_work_id)) fail(`${name}: unknown source work ${record.source_work_id}`);
    if (!Array.isArray(record.disclosed_atoms) || record.disclosed_atoms.length === 0) fail(`${name}: no disclosed atoms`);
    if (new Set(record.disclosed_atoms.map((atom) => atom.key)).size !== record.disclosed_atoms.length) {
      fail(`${name}: duplicate disclosed atom key`);
    }
    for (const atom of record.disclosed_atoms) {
      if (!atom || typeof atom.key !== "string" || !atom.key
        || typeof atom.role !== "string" || !atom.role
        || typeof atom.target !== "string" || !atom.target
        || atom.value === undefined
        || typeof atom.locator !== "string" || !atom.locator) {
        fail(`${name}: malformed disclosed atom`);
      }
      if (atom.source_evidence_work_id !== undefined &&
        (typeof atom.source_evidence_work_id !== "string" || !atom.source_evidence_work_id.trim())) {
        fail(`${name}: atom ${atom.key} has invalid source-evidence identity`);
      }
      if (atom.method_applicability_status !== undefined
        && !applicabilityStatuses.has(atom.method_applicability_status)) {
        fail(`${name}: atom ${atom.key} has invalid applicability`);
      }
      if (atom.method_disclosure_status !== undefined
        && !disclosureStatuses.has(atom.method_disclosure_status)) {
        fail(`${name}: atom ${atom.key} has invalid disclosure`);
      }
      if (atom.source_evidence_work_id && atom.source_evidence_work_id !== record.source_work_id
        && (!atom.method_applicability_status || !atom.method_disclosure_status
          || !atom.source_coverage_status)) {
        fail(`${name}: atom ${atom.key} lacks cross-source evidence qualification`);
      }
    }
    for (const atom of record.disclosed_atoms) {
      if (atom.canonical_role !== undefined || atom.canonical_target !== undefined) {
        assertCanonicalRoleTarget(atom, name);
      }
      if (atom.mapped_ontology_term !== undefined && (!Array.isArray(atom.mapped_ontology_term)
        || atom.mapped_ontology_term.some((term) => !ontology.$defs[term]))) {
        fail(`${name}: atom ${atom.key} names an unknown ontology class`);
      }
    }
    if (record.disclosed_atoms.some((atom) => atom.supersedes_method_setting_ids !== undefined
      || atom.implementation_disposition !== undefined)) {
      const supersededSettingIds = [];
      for (const atom of record.disclosed_atoms) {
        if (!Array.isArray(atom.supersedes_method_setting_ids)
          || new Set(atom.supersedes_method_setting_ids).size !== atom.supersedes_method_setting_ids.length
          || atom.supersedes_method_setting_ids.some((id) => typeof id !== "string" || !id)) {
          fail(`${name}: atom ${atom.key} has malformed supersedes_method_setting_ids`);
        }
        if (!implementationDispositions.has(atom.implementation_disposition)) {
          fail(`${name}: atom ${atom.key} has invalid implementation_disposition`);
        }
        if (atom.project_source_semantics !== undefined
          && (atom.project_source_semantics !== true
            || atom.implementation_disposition !== "retain_current_exact")) {
          fail(`${name}: atom ${atom.key} has invalid project_source_semantics`);
        }
        if (!projectionDispositions.has(atom.projection_disposition ?? "method_setting")) {
          fail(`${name}: atom ${atom.key} has invalid projection_disposition`);
        }
        if (atom.projection_disposition === "configuration_metadata"
          && atom.implementation_disposition !== "specification_only") {
          fail(`${name}: configuration metadata atom ${atom.key} cannot retain a method-setting implementation`);
        }
        supersededSettingIds.push(...atom.supersedes_method_setting_ids);
      }
      const retracted = record.retracted_legacy_settings ?? [];
      if (!Array.isArray(retracted) || retracted.some((row) =>
        !row.method_setting_id || !row.source_extraction_id || !row.reason
        || !Array.isArray(row.corrected_source_atom_keys)
        || row.corrected_source_atom_keys.some((key) =>
          !record.disclosed_atoms.some((atom) => atom.key === key)))) {
        fail(`${name}: malformed retracted legacy setting`);
      }
      const accountedSettingIds = [...supersededSettingIds, ...retracted.map((row) => row.method_setting_id)];
      if (new Set(accountedSettingIds).size !== accountedSettingIds.length) {
        fail(`${name}: a current method setting is superseded more than once`);
      }
      const expectedSettingCount = record.current_profile_snapshot?.atomic_setting_count
        ?? record.current_profile_snapshot?.method_setting_count;
      if (Number.isInteger(expectedSettingCount) && accountedSettingIds.length !== expectedSettingCount) {
        fail(`${name}: accounted setting count ${accountedSettingIds.length} != audited current count ${expectedSettingCount}`);
      }
    }
    if (!Array.isArray(record.source_configuration_repairs) || record.source_configuration_repairs.length === 0) {
      fail(`${name}: no source configuration inventory`);
    }
    if (record.source_configuration_repairs.some((repair) => !repair || typeof repair !== "object")) {
      fail(`${name}: malformed source configuration repair`);
    }
    for (const repair of record.source_configuration_repairs) {
      if (repair.conditional_atom_keys === undefined) continue;
      if (!Array.isArray(repair.conditional_branches) || !repair.conditional_branches.length
        || !Array.isArray(repair.conditional_atom_keys) || !repair.conditional_atom_keys.length
        || new Set(repair.conditional_atom_keys).size !== repair.conditional_atom_keys.length
        || repair.conditional_atom_keys.some((key) => !repair.atom_keys?.includes(key)
          || !record.disclosed_atoms.some((atom) => atom.key === key))) {
        fail(`${name}: invalid condition-scoped atom inventory`);
      }
    }
    if (Array.isArray(record.configuration_verdicts)) {
      for (const verdict of record.configuration_verdicts) {
        if (!verdict || !configurationUnitKinds.has(verdict.configuration_unit_kind)) {
          fail(`${name}: configuration verdict has missing or invalid configuration_unit_kind`);
        }
        if (verdict.configuration_axis !== undefined
          && (typeof verdict.configuration_axis !== "string" || !verdict.configuration_axis.trim())) {
          fail(`${name}: configuration verdict has invalid configuration_axis`);
        }
      }
      const selectable = record.configuration_verdicts.filter((verdict) =>
        verdict.configuration_unit_kind === "user_selectable_alternative");
      if (selectable.some((verdict) => verdict.configuration_axis !== undefined)
        && selectable.some((verdict) => verdict.configuration_axis === undefined)) {
        fail(`${name}: selectable configuration axes must be specified for every alternative`);
      }
    }
    if (Array.isArray(record.configuration_verdicts)
      && record.configuration_verdicts.some((verdict) => verdict.atom_keys !== undefined)) {
      const atomKeys = new Set(record.disclosed_atoms.map((atom) => atom.key));
      const covered = new Set();
      for (const verdict of record.configuration_verdicts) {
        if (!Array.isArray(verdict.atom_keys) || verdict.atom_keys.length === 0
          || new Set(verdict.atom_keys).size !== verdict.atom_keys.length) {
          fail(`${name}: each configuration verdict must have unique atom_keys`);
        }
        for (const key of verdict.atom_keys) {
          if (!atomKeys.has(key)) fail(`${name}: configuration verdict names unknown atom ${key}`);
          covered.add(key);
        }
        if (verdict.branch_atom_keys !== undefined) {
          if (verdict.configuration_unit_kind !== "campaign_internal_job_model_cell"
            || !Array.isArray(verdict.branch_atom_keys) || !verdict.branch_atom_keys.length
            || new Set(verdict.branch_atom_keys).size !== verdict.branch_atom_keys.length
            || verdict.branch_atom_keys.some((key) => !verdict.atom_keys.includes(key))) {
            fail(`${name}: invalid campaign branch atom`);
          }
        }
      }
      const omitted = [...atomKeys].filter((key) => !covered.has(key));
      if (omitted.length) fail(`${name}: configuration verdicts omit atoms: ${omitted.join(", ")}`);
    }
    if (!Array.isArray(record.source_artifacts) || record.source_artifacts.length === 0) fail(`${name}: no source artifacts`);
    for (const artifact of record.source_artifacts) {
      const path = resolve(repo, artifact.path);
      if (sha256(path) !== artifact.sha256) fail(`${name}: source artifact hash drift: ${artifact.path}`);
    }
    const projectable = record.disclosed_atoms.every((atom) => canonicalRoles.has(atom.canonical_role)
      && canonicalTargets.has(atom.canonical_target)
      && Array.isArray(atom.supersedes_method_setting_ids)
      && implementationDispositions.has(atom.implementation_disposition))
      && record.configuration_verdicts?.every((verdict) => Array.isArray(verdict.atom_keys));
    if (projectable) {
      for (const atom of record.disclosed_atoms) {
        if (!locatorNamesArtifact(atom.locator, record.source_artifacts)) {
          fail(`${name}: atom ${atom.key} locator does not name a pinned source artifact`);
        }
      }
    }
    return record;
  });

const audited = records.map((record) => record.source_work_id);
if (new Set(audited).size !== audited.length) fail("duplicate source-work audit");
const missing = [...expected].filter((sourceWorkId) => !audited.includes(sourceWorkId)).sort();
if (requireComplete && missing.length) fail(`source-completeness audit incomplete: ${records.length}/${expected.size}`);
const configurationUnitKindCounts = Object.fromEntries([...configurationUnitKinds]
  .map((kind) => [kind, records.reduce((count, record) => count
    + (record.configuration_verdicts ?? []).filter((verdict) => verdict.configuration_unit_kind === kind).length, 0)]));

console.log(JSON.stringify({
  schema_version: "chronicle-source-completeness-audit-validation/v1",
  passed_current_records: true,
  complete: missing.length === 0,
  canonical_profile_count: expected.size,
  frozen_review_profile_count: frozenExpected.size,
  post_freeze_admitted_profile_count: admissions.length,
  audited_profile_count: records.length,
  remaining_profile_count: missing.length,
  audited_source_work_ids: audited.sort(),
  missing_source_work_ids: missing,
  configuration_unit_kind_counts: configurationUnitKindCounts,
}, null, 2));

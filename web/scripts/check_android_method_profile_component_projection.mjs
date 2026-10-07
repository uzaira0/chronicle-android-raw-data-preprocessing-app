import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { projectRegisteredComponents } from "./android_method_profile_component_projection.mjs";

const profile = {
  method_profile_id: "method-profile:doi:example",
  source_work_id: "doi:example",
  source_method_variant_id: "source-configuration-space:example",
  method_profile_version: "v1",
  profile_implementation_status: "blocked",
  method_settings: [
    { method_setting_id: "setting:a", method_applicability_status: "applicable" },
    { method_setting_id: "setting:b", method_applicability_status: "applicable" },
  ],
};
/** @type {import("./android_method_profile_component_projection.mjs").AdapterContract} */
const contract = {
  schemaVersion: "chronicle-literature-input-adapter-contract/v1",
  groups: [{
    adapterId: "chronicle.example",
    adapterVersion: "v1",
    inputRole: "raw_chronicle_csv",
    methodSettingIds: ["setting:a", "setting:b"],
    componentExecution: {
      componentId: "chronicle.example/v1",
      parentMethodProfileId: profile.method_profile_id,
      sourceWorkId: profile.source_work_id,
      sourceMethodVariantId: profile.source_method_variant_id,
      methodProfileVersion: profile.method_profile_version,
      sourceOracleId: "example-source-fixture/v1",
      requiredSupportRoles: ["example_support_file"],
      fullProfileExecutionStatus: "blocked",
      limitations: ["Only the disclosed component is executable."],
    },
  }],
};
const group = contract.groups[0];
assert.ok(group);
const component = group.componentExecution;
assert.ok(component);

test("projects only components with exact parent identity and owned settings", () => {
  assert.deepEqual(projectRegisteredComponents([profile], contract).get(profile.method_profile_id), [{
    component_id: "chronicle.example/v1",
    setting_ids: ["setting:a", "setting:b"],
    input_role: "raw_chronicle_csv",
    required_support_roles: ["example_support_file"],
    limitations: ["Only the disclosed component is executable."],
    source_oracle_id: "example-source-fixture/v1",
    parent_method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id,
    source_method_variant_id: profile.source_method_variant_id,
    method_profile_version: profile.method_profile_version,
    full_profile_execution_status: "blocked",
  }]);
  assert.throws(
    () => projectRegisteredComponents([profile], {
      ...contract,
      groups: [{
        ...group,
        componentExecution: {
          ...component,
          sourceMethodVariantId: "forged",
        },
      }],
    }),
    /parent identity/,
  );
  assert.throws(
    () => projectRegisteredComponents([profile], {
      ...contract,
      groups: [{ ...group, methodSettingIds: ["setting:foreign"] }],
    }),
    /setting ownership/,
  );
  const mismatched = structuredClone(contract);
  const mismatchedComponent = mismatched.groups[0]?.componentExecution;
  assert.ok(mismatchedComponent);
  mismatchedComponent.methodProfileVersion = "recovered-only";
  mismatchedComponent.canonicalRegistrationStatus = "blocked_version_mismatch";
  assert.deepEqual(
    projectRegisteredComponents([profile], mismatched).get(profile.method_profile_id),
    [],
  );
  const artifactOnly = structuredClone(contract);
  const artifactGroup = artifactOnly.groups[0];
  assert.ok(artifactGroup);
  const artifactComponent = artifactGroup.componentExecution;
  assert.ok(artifactComponent);
  artifactComponent.methodProfileVersion = "recovered-apk-only";
  artifactComponent.canonicalRegistrationStatus = "linked_artifact_only";
  artifactGroup.methodSettingIds = ["setting:artifact-only"];
  assert.deepEqual(projectRegisteredComponents([profile], artifactOnly).get(profile.method_profile_id), []);
  artifactGroup.methodSettingIds = ["setting:a"];
  assert.throws(() => projectRegisteredComponents([profile], artifactOnly), /linked artifact overlaps/);
});

test("includes dependencies without changing their original adapter ownership", () => {
  const dependentComponent = { ...component, additionalMethodSettingIds: ["setting:b"] };
  const dependent = {
    ...contract,
    groups: [
      { ...group, methodSettingIds: ["setting:a"], componentExecution: dependentComponent },
      { adapterId: "chronicle.other", adapterVersion: "v1", inputRole: "support_file", methodSettingIds: ["setting:b"] },
    ],
  };
  assert.deepEqual(projectRegisteredComponents([profile], dependent).get(profile.method_profile_id)?.[0]?.setting_ids, ["setting:a", "setting:b"]);
  dependentComponent.additionalMethodSettingIds = ["setting:foreign"];
  assert.throws(() => projectRegisteredComponents([profile], dependent), /setting ownership/);
});

test("does not register a component whose reviewed source is nonretained", () => {
  assert.throws(() => projectRegisteredComponents([], contract), /parent identity/);
  assert.deepEqual([...projectRegisteredComponents([], contract, new Set([profile.source_work_id]))], []);
});

test("accepts only the three closed extensions without changing frozen profile projection", () => {
  /** @type {import("./android_method_profile_component_projection.mjs").AdapterContract} */
  const real = JSON.parse(readFileSync(new URL("../schema/literature-input-adapter-contract.json", import.meta.url), "utf8"));
  const extensions = real.groups.filter((g) => g.componentExecution?.canonicalRegistrationStatus === "outside_frozen143_extension");
  assert.equal(extensions.length,3);
  for (const extension of extensions) {
  const extensionComponent=extension.componentExecution;
  const extensionSettingId=extension.methodSettingIds[0];
  assert.ok(extensionComponent);
  assert.ok(extensionSettingId);
  /** @type {import("./android_method_profile_component_projection.mjs").AdapterContract} */
  const candidate = { schemaVersion: contract.schemaVersion, groups: [group, extension] };
  assert.deepEqual(projectRegisteredComponents([profile], candidate), projectRegisteredComponents([profile], contract));
  for (const field of ["componentId", "parentMethodProfileId", "sourceWorkId", "sourceMethodVariantId", "methodProfileVersion", "derivedResultKind", "sourceOracleId", "tableFormat", "adaptedResultKind"]) {
    const forged = structuredClone(candidate);
    const forgedComponent=forged.groups[1]?.componentExecution;
    assert.ok(forgedComponent);
    Object.assign(forgedComponent, {[field]:"forged"});
    assert.throws(() => projectRegisteredComponents([profile], forged), /outside-freeze/);
  }
  assert.throws(() => projectRegisteredComponents([profile], { ...candidate, groups: [...candidate.groups, extension] }), /outside-freeze/);
  assert.throws(() => projectRegisteredComponents([{ ...profile, source_work_id: extensionComponent.sourceWorkId }], candidate), /outside-freeze|parent identity/);
  const collision = { ...profile, method_settings: [...profile.method_settings,
    {method_setting_id:extensionSettingId, method_applicability_status:"applicable"}] };
  assert.throws(() => projectRegisteredComponents([collision], candidate), /outside-freeze/);
  }
});

test("execution-spec validator shares the closed-extension gate without registering extension lanes", () => {
  /** @type {import("./android_method_profile_component_projection.mjs").AdapterContract} */
  const real = JSON.parse(readFileSync(new URL("../schema/literature-input-adapter-contract.json", import.meta.url), "utf8"));
  const extensions = real.groups.filter((g) => g.componentExecution?.canonicalRegistrationStatus === "outside_frozen143_extension");
  const candidate = { schemaVersion: contract.schemaVersion, groups: [group, ...extensions] };
  const program = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("execution_spec", "scripts/validate-android-profile-execution-spec.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
payload = json.load(sys.stdin)
m.retained_work_ids = lambda: {payload["profile"]["source_work_id"]}
m.nonretained_work_ids = lambda: set()
m.read_json = lambda path: payload["contract"] if path == m.LITERATURE_INPUT_ADAPTER_CONTRACT else {"profiles": [payload["profile"]]}
assert len(m.registered_components()) == 1
payload["contract"]["groups"][1]["componentExecution"]["sourceOracleId"] = "forged"
m.registered_components.cache_clear()
try:
    m.registered_components()
except m.ValidationError:
    pass
else:
    raise AssertionError("forged extension accepted")
`;
  const checked = spawnSync("python3", ["-c", program], {
    cwd: new URL("../../", import.meta.url),
    input: JSON.stringify({ profile, contract: candidate }),
    encoding: "utf8", timeout: 30000,
  });
  assert.equal(checked.status, 0, checked.stderr);
});

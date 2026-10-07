import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { collapseProjection, graphForMode } from "@/components/GraphPanel/graphProjection";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  getRustWorkflowExplorerView,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import type { RustWorkflowExplorerView } from "@/lib/types";
import { workflowExplorerSupportRoles } from "@/lib/workflowExplorerSupport";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

/**
 * These assertions read the REAL Rust workflow contract out of the compiled
 * runtime WASM. The sibling `graphProjection.test.ts` builds its explorer view
 * by hand, which makes it a fine rendering fixture and a useless contract
 * oracle: when `policy.apply_app_inclusion` gained `DropsRows` in
 * `workflow_contract.rs`, every web test stayed green because none of them ever
 * observed a contract value. This file closes that hole — if Rust drops the
 * effect, or adds a `DataEffect` variant the projection does not classify, the
 * failure surfaces here.
 */

/** Every `DataEffect` variant `effectCategories` classifies explicitly. */
const CLASSIFIED_DATA_EFFECTS = new Set([
  "drops_rows",
  "splits_rows",
  "synthesizes_rows",
  "rewrites_values",
  "classifies",
  "aggregates",
  "encodes",
  "preserves",
]);

type ContractOperation = {
  id: string;
  label: string;
  description: string;
  dataEffects: string[];
};

let contractOperations: ContractOperation[];
let view: RustWorkflowExplorerView;

async function initializeRealContract(): Promise<void> {
  const campaignPackage = process.env.CHRONICLE_DEPENDENCY_CAMPAIGN_WASM_DIR;
  const runtimeBytes = await readFile(
    campaignPackage
      ? path.join(campaignPackage, "chronicle_preprocessing_runtime_wasm_bg.wasm")
      : new URL(
          "../../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
          import.meta.url,
        ),
  );
  runtimeWasm.initSync({ module: runtimeBytes });
  setRustRuntimeForTesting(runtimeWasm);
  const contract = JSON.parse(runtimeWasm.workflow_contract_json()) as {
    semantic: { operations: ContractOperation[] };
  };
  contractOperations = contract.semantic.operations;
  view = await getRustWorkflowExplorerView(
    DEFAULT_BROWSER_OPTIONS,
    workflowExplorerSupportRoles(DEFAULT_BROWSER_OPTIONS, {
      filterFile: false,
      appsForcingScreenOpenFile: false,
      backgroundAppsFile: false,
      appCodebookFile: false,
      studyDatesFile: false,
      deviceSharingFile: false,
      surveyAttributionFile: false,
      enrolledDevicesFile: false,
      inputCapabilityEvidenceFile: false,
      analysisFeatureMatrixFile: false,
      callSmsEligibilityFile: false,
      phoneStudyPsCommunicationFile: false,
      phoneStudyEsFile: false,
      anchorEventsFile: false,
    }),
  );
}

describe("Workflow Explorer projection over the real Rust contract", () => {
  beforeAll(initializeRealContract);

  it("declares row removal on the app-inclusion policy operation", () => {
    const operation = contractOperations.find(
      (candidate) => candidate.id === "policy.apply_app_inclusion",
    );
    expect(operation).toBeDefined();
    expect(operation!.dataEffects).toContain("drops_rows");
    expect(operation!.dataEffects).toContain("classifies");
  });

  it("carries that effect into the rendered explorer node", () => {
    // `overview` renders phases only (graphProjection.ts:178-201); `lineage`
    // is the first mode that renders operation nodes.
    const lineage = graphForMode(view, "lineage");
    const lineageNode = lineage.nodes.find(
      (node) => node.id === "policy.apply_app_inclusion",
    );
    expect(lineageNode).toBeDefined();
    expect(lineageNode!.detail).toContain("Impact: value impact, row-set impact");

    const audit = graphForMode(view, "audit");
    const auditNode = audit.nodes.find((node) => node.id === "policy.apply_app_inclusion");
    expect(auditNode).toBeDefined();
    expect(auditNode!.eyebrow).toBe("value impact + row-set impact operation");

    // Collapsing an unrelated phase must not launder the effect away.
    const collapsed = collapseProjection(audit, view, new Set(["import_verify"]));
    expect(
      collapsed.nodes.find((node) => node.id === "policy.apply_app_inclusion")?.eyebrow,
    ).toBe("value impact + row-set impact operation");
  });

  it("classifies every data effect the real contract emits", () => {
    const observed = new Set(
      contractOperations.flatMap((operation) => operation.dataEffects),
    );
    expect(observed.size).toBeGreaterThan(0);
    expect([...observed].sort()).toEqual(
      [...observed].filter((effect) => CLASSIFIED_DATA_EFFECTS.has(effect)).sort(),
    );
  });

  it("keeps the explorer view's effects a subset of the contract's", () => {
    const contractByOperationId = new Map(
      contractOperations.map((operation) => [operation.id, operation]),
    );
    for (const operation of view.operations) {
      const declared = contractByOperationId.get(operation.operationId);
      expect(declared, `explorer operation ${operation.operationId} is not in the contract`)
        .toBeDefined();
      expect([...operation.dataEffects].sort()).toEqual([...declared!.dataEffects].sort());
    }
  });
});

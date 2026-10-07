import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_OUTPUT_KINDS,
  captureCanonicalOutputCells,
  isCanonicalOutputKind,
  changedCellAddresses,
  changedCellScopesByArtifact,
  changedCellsByArtifact,
  type RuntimeArtifactHandle,
} from "@/testSupport/outputCellTomography";
import { isOutputArtifactKind } from "@/testSupport/campaignManifest";

function handle(
  artifacts: Array<{ kind: string; mediaType: string; body: string }>,
): RuntimeArtifactHandle {
  const artifactAt = (index: number) => {
    const artifact = artifacts[index];
    if (artifact === undefined) throw new Error(`no artifact at index ${index}`);
    return artifact;
  };
  return {
    artifact_count: artifacts.length,
    artifact_metadata_json: (index) =>
      JSON.stringify({
        kind: artifactAt(index).kind,
        mediaType: artifactAt(index).mediaType,
      }),
    take_artifact_bytes: (index) => new TextEncoder().encode(artifactAt(index).body),
  };
}

describe("canonical output-cell tomography", () => {
  it("keeps every canonical cell kind inside the byte-captured artifact set", () => {
    // The campaign capture loops gate on isOutputArtifactKind before taking
    // bytes and extracting cells. A kind added to CANONICAL_OUTPUT_KINDS but
    // not to OUTPUT_ARTIFACT_KINDS would be skipped before extraction --
    // symmetrically on warm and cold, so every comparison stays green while
    // the new output silently stops being validated. This runs in the unit
    // suite (make web), which gates before any campaign.
    for (const kind of CANONICAL_OUTPUT_KINDS) {
      expect(isOutputArtifactKind(kind), `${kind} missing from OUTPUT_ARTIFACT_KINDS`).toBe(true);
    }
  });

  it("mirrors the contract's row-addressed kind set exactly, both directions", () => {
    // CANONICAL_OUTPUT_KINDS + the aggregate- prefix arm is a hand-authored
    // mirror of the contract's ROW_ADDRESSED_OUTPUT_KINDS. The kernel golden
    // (re-validated against the live contract by every `make rust` run) is the
    // authority; this equality pin turns either drift direction -- a kind
    // cell-addressed here without contract bindings (a ~40-minute depev red on
    // the declared-reach gate), or a contract-promoted kind the campaigns
    // silently never cell-compare -- into a sub-second unit failure naming the
    // kind.
    const golden = JSON.parse(
      readFileSync(
        join(
          __dirname,
          "../../../rust/chronicle_chrono_kernel_wasm/tests/golden/workflow_contract.json",
        ),
        "utf8",
      ),
    ) as { semantic: { rowAddressedOutputKinds: string[] } };
    const contractKinds = golden.semantic.rowAddressedOutputKinds;
    for (const kind of contractKinds) {
      expect(
        isCanonicalOutputKind(kind),
        `${kind} is row-addressed in the contract but not cell-captured by the campaigns`,
      ).toBe(true);
    }
    for (const kind of CANONICAL_OUTPUT_KINDS) {
      expect(
        contractKinds.includes(kind),
        `${kind} is cell-captured but has no row-addressed declaration in the contract`,
      ).toBe(true);
    }
    expect(contractKinds.some((kind) => kind.startsWith("aggregate-"))).toBe(true);
  });


  it("addresses quoted CSV cells and nested JSON leaves deterministically", () => {
    const cells = captureCanonicalOutputCells(
      handle([
        {
          kind: "app-csv",
          mediaType: "text/csv",
          body: 'participant_id,note\nP01,"comma, value"\n',
        },
        {
          kind: "review-summary-json",
          mediaType: "application/json",
          body: JSON.stringify({ nested: { "a/b": [true, null] } }),
        },
        {
          kind: "execution-ledger-json",
          mediaType: "application/json",
          body: JSON.stringify({ ignored: true }),
        },
      ]),
    );

    expect(cells).toEqual({
      "app-csv#/rows/0/note": "comma, value",
      "app-csv#/rows/0/participant_id": "P01",
      "app-csv#/shape/columns": '["participant_id","note"]',
      "app-csv#/shape/rows": "1",
      "review-summary-json#/nested/a~1b/0": "true",
      "review-summary-json#/nested/a~1b/1": "null",
    });
  });

  it("reports additions, removals and value changes by canonical artifact", () => {
    const source = {
      "app-csv#/rows/0/value": "a",
      "screen-csv#/shape/rows": "1",
    };
    const target = {
      "app-csv#/rows/0/value": "b",
      "review-summary-json#/count": "1",
    };
    const addresses = changedCellAddresses(source, target);
    expect(addresses).toEqual([
      "app-csv#/rows/0/value",
      "review-summary-json#/count",
      "screen-csv#/shape/rows",
    ]);
    expect(changedCellsByArtifact(addresses)).toEqual({
      "app-csv": ["/rows/0/value"],
      "review-summary-json": ["/count"],
      "screen-csv": ["/shape/rows"],
    });
    expect(
      changedCellScopesByArtifact([
        "app-csv#/rows/0/value",
        "app-csv#/rows/17/value",
        "review-summary-json#/days/3/count",
      ]),
    ).toEqual({
      "app-csv": ["/rows/*/value"],
      "review-summary-json": ["/days/*/count"],
    });
  });
});

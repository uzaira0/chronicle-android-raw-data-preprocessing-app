import { describe, expect, it } from "vitest";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
  changedCellScopesByArtifact,
  changedCellsByArtifact,
  type RuntimeArtifactHandle,
} from "@/testSupport/outputCellTomography";

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

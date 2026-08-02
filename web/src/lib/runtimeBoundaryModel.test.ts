import { describe, expect, it } from "vitest";

import {
  RUNTIME_BOUNDARY_MODEL,
  type ArtifactRef,
  type RuntimeArtifactMetadata,
  type RuntimeCounts,
} from "@/lib/generatedRuntimeBoundary";
import {
  decodeBoundaryStruct,
  type BoundaryModel,
} from "@/lib/runtimeBoundaryModel";

function counts(): Record<string, unknown> {
  return { original: 4, processed: 3, app: 2, screen: 1 };
}

function artifactRef(): Record<string, unknown> {
  return {
    artifact_id: "urn:chronicle:artifact:raw",
    digest: `sha256:${"a".repeat(64)}`,
    media_type: "text/csv",
    size: 12,
    derived_from: [],
    qualifiers: { role: "raw_chronicle_csv" },
  };
}

function artifactMetadata(): Record<string, unknown> {
  return {
    artifactId: "urn:chronicle:artifact:app-usage",
    kind: "app-usage-csv",
    mediaType: "text/csv",
    digest: `sha256:${"b".repeat(64)}`,
    size: 64,
    derivedFrom: [],
  };
}

describe("generated runtime boundary model", () => {
  it("covers both serialization roots the browser decodes", () => {
    expect(RUNTIME_BOUNDARY_MODEL.protocolVersion).toBe(
      "chronicle-runtime-boundary-model/v1",
    );
    for (const name of Object.values(RUNTIME_BOUNDARY_MODEL.roots)) {
      expect(RUNTIME_BOUNDARY_MODEL.types[name]?.kind).toBe("struct");
    }
    expect(Object.values(RUNTIME_BOUNDARY_MODEL.roots)).toEqual(
      expect.arrayContaining(["RuntimeManifest", "ReviewRuntimeManifest"]),
    );
  });

  it("accepts the shapes Rust serializes and drops forward-transportable keys", () => {
    expect(
      decodeBoundaryStruct<RuntimeCounts>(
        RUNTIME_BOUNDARY_MODEL,
        "RuntimeCounts",
        { ...counts(), futureField: "ignored" },
        "counts",
      ),
    ).toEqual(counts());
    expect(
      decodeBoundaryStruct<ArtifactRef>(
        RUNTIME_BOUNDARY_MODEL,
        "ArtifactRef",
        artifactRef(),
        "artifact",
      ),
    ).toEqual(artifactRef());
    // rowCount/previewRows carry skip_serializing_if in Rust: absent stays
    // absent, and a present value is still validated.
    expect(
      decodeBoundaryStruct<RuntimeArtifactMetadata>(
        RUNTIME_BOUNDARY_MODEL,
        "RuntimeArtifactMetadata",
        artifactMetadata(),
        "metadata",
      ),
    ).toEqual(artifactMetadata());
  });

  it.each([
    [
      "a missing field",
      "RuntimeCounts",
      (value: Record<string, unknown>) => {
        delete value.app;
      },
      /counts\.app.*non-negative safe integer/,
    ],
    [
      "a fractional integer",
      "RuntimeCounts",
      (value: Record<string, unknown>) => {
        value.processed = 1.5;
      },
      /counts\.processed.*non-negative safe integer/,
    ],
  ] as const)("rejects %s", (_name, type, mutate, expected) => {
    const value = counts();
    mutate(value);
    expect(() =>
      decodeBoundaryStruct(RUNTIME_BOUNDARY_MODEL, type, value, "counts"),
    ).toThrow(expected);
  });

  it("enforces the digest domain the Rust alias declares", () => {
    const value = artifactRef();
    value.digest = "sha256:not-a-digest";
    expect(() =>
      decodeBoundaryStruct(
        RUNTIME_BOUNDARY_MODEL,
        "ArtifactRef",
        value,
        "artifact",
      ),
    ).toThrow(/artifact\.digest.*lowercase sha256 digest/);
  });

  it("rejects an absent optional key's invalid value without inventing one", () => {
    const value = artifactMetadata();
    value.rowCount = -1;
    expect(() =>
      decodeBoundaryStruct(
        RUNTIME_BOUNDARY_MODEL,
        "RuntimeArtifactMetadata",
        value,
        "metadata",
      ),
    ).toThrow(/metadata\.rowCount.*non-negative safe integer/);
  });

  // Seeded drift: the committed artifact must be what the decoder actually
  // consults. If the decoder had kept its own hand-written idea of the shape,
  // mutating the model would change nothing and this test would fail.
  it("decodes through the generated model, so seeded model drift changes the verdict", () => {
    const accepted = counts();
    expect(() =>
      decodeBoundaryStruct(
        RUNTIME_BOUNDARY_MODEL,
        "RuntimeCounts",
        accepted,
        "counts",
      ),
    ).not.toThrow();

    const drifted: BoundaryModel = structuredClone(RUNTIME_BOUNDARY_MODEL);
    const countsModel = drifted.types.RuntimeCounts;
    if (countsModel?.kind !== "struct") {
      throw new Error("generated model lost the RuntimeCounts struct");
    }
    const original = countsModel.fields.find(
      (field) => field.name === "original",
    );
    if (original === undefined) {
      throw new Error("generated model lost RuntimeCounts.original");
    }
    original.value = { kind: "sha256Digest" };

    // The very same value is now rejected: an integer cannot satisfy the
    // digest domain the drifted model declares.
    expect(() =>
      decodeBoundaryStruct(drifted, "RuntimeCounts", accepted, "counts"),
    ).toThrow(
      "runtime manifest contract violation at counts.original: expected a non-empty string",
    );
  });

  it("fails closed when the model has no such type", () => {
    expect(() =>
      decodeBoundaryStruct(
        RUNTIME_BOUNDARY_MODEL,
        "NotAThing",
        counts(),
        "counts",
      ),
    ).toThrow(/runtime boundary model has no struct named NotAThing/);
  });
});

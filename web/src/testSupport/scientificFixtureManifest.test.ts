import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

type FixtureEntry = {
  id: string;
  path: string;
  sha256: string;
  boundRawInputSha256?: string;
};

type FixtureManifest = {
  protocolVersion: string;
  status: string;
  limitations: string[];
  fixtures: FixtureEntry[];
};

const fixtureRoot = resolve(process.cwd(), "src/testSupport/fixtures");
const manifest = JSON.parse(
  readFileSync(resolve(fixtureRoot, "b03-b05-fixture-manifest.json"), "utf8"),
) as FixtureManifest;

function sha256Uri(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("B03-B05 synthetic scientific fixture manifest", () => {
  it("pins the complete reviewed fixture set without path traversal", () => {
    expect(manifest.protocolVersion).toBe(
      "chronicle-b03-b05-scientific-fixtures/v1",
    );
    expect(manifest.status).toBe("synthetic_engineering_evidence_only");
    expect(manifest.limitations).toEqual([
      "contains_no_real_participant_or_study_data",
      "cannot_support_headline_empirical_magnitudes",
      "fixture_specific_assertions_must_be_opt_in",
    ]);
    expect(manifest.fixtures.map(({ id }) => id)).toEqual([
      "b03_b04_duration_boundaries",
      "b05_screen_construction",
      "schoedel_prose_reconstruction",
      "eyes_fau_close_provenance",
      "b05_input_capability_evidence",
      "schoedel_input_capability_evidence",
    ]);

    for (const fixture of manifest.fixtures) {
      expect(fixture.path).toBe(basename(fixture.path));
      const bytes = readFileSync(resolve(fixtureRoot, fixture.path));
      expect(sha256Uri(bytes), fixture.id).toBe(fixture.sha256);
      expect(bytes.length, fixture.id).toBeGreaterThan(0);
    }
  });

  it.each([
    ["b05_input_capability_evidence", "b05_screen_construction"],
    ["schoedel_input_capability_evidence", "schoedel_prose_reconstruction"],
  ])("binds %s to the exact %s raw fixture", (evidenceId, rawId) => {
    const raw = manifest.fixtures.find(({ id }) => id === rawId);
    const evidence = manifest.fixtures.find(({ id }) => id === evidenceId);
    expect(raw).toBeDefined();
    expect(evidence?.boundRawInputSha256).toBe(raw?.sha256);

    const evidenceText = readFileSync(
      resolve(fixtureRoot, evidence?.path ?? "missing"),
      "utf8",
    );
    const boundRows = evidenceText
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[1]);
    expect(new Set(boundRows)).toEqual(new Set([raw?.sha256]));
  });
});

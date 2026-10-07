import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect } from "vitest";

import { LITERATURE_FIXTURE_ROOT, privateCorpusPath } from "@/testSupport/privateCorpus";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";

function fixtureFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? fixtureFiles(join(directory, entry.name)) : [join(directory, entry.name)]);
}

const fixtures = fixtureFiles(LITERATURE_FIXTURE_ROOT).map((path) => relative(LITERATURE_FIXTURE_ROOT, path)).sort();

describe("tracked literature fixtures", () => {
  // The tracked copies stand in for the corpus on machines without it, so a
  // copy that drifted from its original would test stale definitions.
  itWithPrivateCorpus.each(fixtures)("%s is byte-identical to the private corpus original", (path) => {
    expect(readFileSync(join(LITERATURE_FIXTURE_ROOT, path)).equals(readFileSync(privateCorpusPath(path)))).toBe(true);
  });
});

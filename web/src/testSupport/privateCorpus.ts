import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The private literature corpus is the gitignored, machine-local folder
 * `.tmp-literature-review-private/` at the repository root. It holds
 * copyrighted full texts of the reviewed papers and the project's own large
 * derived files (the adjudicated method-profile library, source audits). It is
 * never committed, so a clean clone, CI and other machines do not have it.
 *
 * Tests that read it run only where it exists and are reported as skipped
 * elsewhere, with unchanged assertions where they run: vitest tests are
 * declared with `itWithPrivateCorpus` / `describeWithPrivateCorpus`
 * (privateCorpusGates.ts) and `privateCorpusGlobalSetup.ts` prints one line
 * per run; Playwright specs call `test.skip(!privateCorpusAvailable,
 * PRIVATE_CORPUS_SKIP_REASON)`. This module imports no test runner, so both
 * can use it. Collection-time code (module or describe scope) must not read
 * the corpus.
 */
export const PRIVATE_CORPUS_ROOT = resolve(import.meta.dirname, "../../../.tmp-literature-review-private");

export const privateCorpusAvailable = existsSync(PRIVATE_CORPUS_ROOT);

export const PRIVATE_CORPUS_SKIP_REASON =
  "requires the machine-local private literature corpus (.tmp-literature-review-private), absent here";

/** Absolute path of a file inside the private corpus, from its corpus-relative path. */
export const privateCorpusPath = (...segments: string[]): string => resolve(PRIVATE_CORPUS_ROOT, ...segments);

/**
 * Tracked, byte-identical copies of the few corpus files that are entirely the
 * project's own derived work (source audits with no copied paper text), kept
 * under the same corpus-relative path. `literatureFixtures.test.ts` compares
 * each copy with its original wherever the corpus exists.
 */
export const LITERATURE_FIXTURE_ROOT = resolve(import.meta.dirname, "fixtures/literature");

export const literatureFixturePath = (relativePath: string): string => resolve(LITERATURE_FIXTURE_ROOT, relativePath);

/**
 * A corpus JSON file parsed on first use and shared afterwards, for values a
 * test file used to parse once at module scope (collection time).
 */
export function lazyPrivateCorpusJson<T>(relativePath: string): () => T {
  let loaded: { value: T } | undefined;
  return () => (loaded ??= { value: JSON.parse(readFileSync(privateCorpusPath(relativePath), "utf8")) as T }).value;
}

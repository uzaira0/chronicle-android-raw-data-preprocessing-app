import { describe, it } from "vitest";

import { privateCorpusAvailable } from "./privateCorpus";

/** Vitest declarations for tests that read the private literature corpus (see privateCorpus.ts). */
export const itWithPrivateCorpus = it.skipIf(!privateCorpusAvailable);

export const describeWithPrivateCorpus = describe.skipIf(!privateCorpusAvailable);

import { PRIVATE_CORPUS_ROOT, PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable } from "./privateCorpus";

// One line per run, so a skipped corpus-gated test is never a silent pass.
export default function reportPrivateCorpus(): void {
  process.stdout.write(privateCorpusAvailable
    ? `[private literature corpus] present at ${PRIVATE_CORPUS_ROOT}: corpus-gated tests run.\n`
    : `[private literature corpus] ABSENT at ${PRIVATE_CORPUS_ROOT}: every test declared with`
      + ` itWithPrivateCorpus/describeWithPrivateCorpus is skipped (${PRIVATE_CORPUS_SKIP_REASON}).\n`);
}

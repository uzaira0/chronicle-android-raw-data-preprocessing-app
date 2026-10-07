// @ts-nocheck -- shared, fail-closed input gate for the corpus validator and projector.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const root = ".tmp-literature-review-private/ontology-sublation-20260831";
const fields = new Set(["canonical_work_id", "decision", "decision_reason", "decision_evidence",
  "access_depth", "audit_path", "audit_sha256", "review_path", "review_sha256"]);
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const assertWithin = (path, boundary) => assert(path.startsWith(`${boundary}${sep}`),
  "admission evidence escapes the project-private boundary");

export function validateDecisions(index, frozenWorkIds) {
  assert(index?.schema_version === "chronicle-post-freeze-literature-admissions/v1"
    && Object.keys(index).every((key) => ["schema_version", "admissions"].includes(key))
    && Array.isArray(index.admissions), "invalid post-freeze admission index");
  const identities = new Set();
  for (const entry of index.admissions) {
    assert(entry && Object.keys(entry).length === fields.size
      && Object.keys(entry).every((key) => fields.has(key))
      && [...fields].every((key) => typeof entry[key] === "string" && entry[key].trim()),
    "incomplete or unknown admission fields");
    assert(entry.decision === "RETAIN" && entry.access_depth === "target_primary_fulltext_source_audited",
      "admission requires retained target-primary source audit");
    assert(!frozenWorkIds.has(entry.canonical_work_id) && !identities.has(entry.canonical_work_id),
      "duplicate or frozen admission identity");
    identities.add(entry.canonical_work_id);
    assert(/^[a-f0-9]{64}$/.test(entry.audit_sha256) && /^[a-f0-9]{64}$/.test(entry.review_sha256),
      "admission lacks exact content hashes");
    assert(entry.audit_path.startsWith(`${root}/post-freeze-source-audits/`)
      && entry.audit_path.endsWith(".json") && !entry.audit_path.split("/").includes("..")
      && entry.review_path.startsWith(`${root}/work/`) && !entry.review_path.split("/").includes(".."),
    "admission evidence escapes the project-private boundary");
  }
  return index.admissions;
}

export function loadPostFreezeAdmissions(repo, frozenWorkIds) {
  const path = resolve(repo, root, "post-freeze-admissions.json");
  if (!existsSync(path)) return [];
  const privateRoot = realpathSync(resolve(repo, root));
  assertWithin(privateRoot, realpathSync(repo));
  assertWithin(realpathSync(path), privateRoot);
  assert((statSync(path).mode & 0o777) === 0o600, "admission index must be private");
  const entries = validateDecisions(JSON.parse(readFileSync(path, "utf8")), frozenWorkIds);
  for (const entry of entries) {
    for (const prefix of ["audit", "review"]) {
      const evidence = resolve(repo, entry[`${prefix}_path`]);
      assertWithin(realpathSync(evidence), resolve(privateRoot,
        prefix === "audit" ? "post-freeze-source-audits" : "work"));
      assert((statSync(evidence).mode & 0o777) === 0o600, "admission evidence must be private");
      assert(digest(evidence) === entry[`${prefix}_sha256`], "admission evidence hash drift");
    }
    const audit = JSON.parse(readFileSync(resolve(repo, entry.audit_path), "utf8"));
    assert(audit.source_work_id === entry.canonical_work_id, "admission/audit identity mismatch");
  }
  return entries;
}

export function applyAdmissionsToReviewQueue(queue, admissions) {
  const decisions = new Map(queue.map((entry) => [entry.canonical_work_id, entry]));
  assert(decisions.size === queue.length, "duplicate frozen review identity");
  const admitted = new Set();
  for (const entry of admissions) {
    assert(!admitted.has(entry.canonical_work_id), "duplicate admission identity");
    admitted.add(entry.canonical_work_id);
    const previous = decisions.get(entry.canonical_work_id);
    assert(!previous || previous.decision === "ACQUISITION_PENDING",
      "admission cannot replace a non-pending review decision");
    decisions.set(entry.canonical_work_id, entry);
  }
  return [...decisions.values()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && process.argv.includes("--self-test")) {
  const entry = { canonical_work_id: "synthetic:new", decision: "RETAIN", decision_reason: "Android callbacks",
    decision_evidence: "primary p4", access_depth: "target_primary_fulltext_source_audited",
    audit_path: `${root}/post-freeze-source-audits/synthetic.json`, audit_sha256: "a".repeat(64),
    review_path: `${root}/work/synthetic-review.md`, review_sha256: "b".repeat(64) };
  const index = { schema_version: "chronicle-post-freeze-literature-admissions/v1", admissions: [entry] };
  assert.equal(validateDecisions(index, new Set()).length, 1);
  assert.throws(() => validateDecisions(index, new Set([entry.canonical_work_id])), /frozen admission/);
  assert.throws(() => validateDecisions({ ...index, admissions: [entry, entry] }, new Set()), /duplicate/);
  assert.throws(() => validateDecisions({ ...index, admissions: [{ ...entry, decision: "EXCLUDE" }] }, new Set()), /retained/);
  assert.throws(() => validateDecisions({ ...index, admissions: [{ ...entry, audit_path: `${root}/post-freeze-source-audits/../bad.json` }] }, new Set()), /escapes/);
  assert.throws(() => validateDecisions({ ...index, admissions: [{ ...entry, rank: 1 }] }, new Set()), /unknown admission/);
  assert.doesNotThrow(() => assertWithin("/private/work/review.md", "/private/work"));
  assert.throws(() => assertWithin("/outside/review.md", "/private/work"), /escapes/);
  assert.throws(() => assertWithin("/private/work-elsewhere/review.md", "/private/work"), /escapes/);
  const pending = { ...entry, decision: "ACQUISITION_PENDING", access_depth: "ABSTRACT_ONLY",
    decision_reason: "primary unavailable", decision_evidence: "old abstract observation" };
  const frozen = [pending, { ...pending, canonical_work_id: "synthetic:other" }];
  const original = frozen.map(row => ({ ...row }));
  assert.deepEqual(applyAdmissionsToReviewQueue(frozen, [entry]), [entry, frozen[1]]);
  assert.deepEqual(frozen, original);
  assert.deepEqual(applyAdmissionsToReviewQueue([], [entry]), [entry]);
  assert.throws(() => applyAdmissionsToReviewQueue([pending, pending], [entry]), /duplicate frozen/);
  assert.throws(() => applyAdmissionsToReviewQueue(frozen, [entry, entry]), /duplicate admission/);
  for (const decision of ["EXCLUDE", "RETAIN", "RETAIN_EXTRACTION_PENDING"]) {
    assert.throws(() => applyAdmissionsToReviewQueue([{ ...pending, decision }], [entry]), /non-pending/);
  }
  console.log("PASS explicit post-freeze identities; duplicates, exclusions, invented ranks and escaped paths rejected");
}

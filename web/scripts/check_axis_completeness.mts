/**
 * Definition of done for a delivery axis.
 *
 * The B06 spiral produced 3,846 lines of decision documents and ~9,069 lines of test
 * scaffolding with zero product code, and nothing mechanical objected. This check makes
 * documents and tests insufficient: an axis whose ledger entry claims an implemented status,
 * and which has a paper document under docs/paper/, must also have its option key present in
 * the LinkML contract AND read by the kernel.
 *
 * Sources of truth:
 *   docs/paper/delivery-axis-ledger.yaml            axis id / key / baseline_status
 *   web/schema/chronicle-local-contract.linkml.yaml declared browser option surface
 *   rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs  kernel read of the native key
 *
 * The ledger's own status_vocabulary defines the statuses. Only statuses that assert an
 * implementation exists are gated:
 *   - accepted_on_private_feature_branch                    (implementation accepted)
 *   - mechanism_present_alternatives_source_unverified      (runtime mechanism present)
 * These are NOT gated, because they assert no implementation:
 *   - pending
 *   - conditional_refusal                (delivery:B13 by design — must never fail here)
 *   - reported_unpublished_artifact_absent  (the artifact is absent; a nested
 *                                            campaign_implementation.status, if present and
 *                                            implemented, is what gets gated instead)
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(webDir, "..");

const ledgerPath = path.join(repoDir, "docs/paper/delivery-axis-ledger.yaml");
const paperDir = path.join(repoDir, "docs/paper");
const contractPath = path.join(webDir, "schema/chronicle-local-contract.linkml.yaml");
const kernelPath = path.join(
  repoDir,
  "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
);

async function pipelineSource(root: string): Promise<string> {
  const sources = new Map<string, string>();
  const pending = [root];
  for (const sourcePath of pending) {
    if (sources.has(sourcePath)) continue;
    const source = await readFile(sourcePath, "utf8");
    sources.set(sourcePath, source);
    for (const match of source.matchAll(/#\[path\s*=\s*"([^"]+)"\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([;{])/g)) {
      const child = path.resolve(path.dirname(sourcePath), match[1]!);
      if (match[2] === "{") {
        for (const entry of await readdir(child, { recursive: true })) {
          if (entry.endsWith(".rs")) pending.push(path.join(child, entry));
        }
      } else {
        pending.push(child);
      }
    }
  }
  return [...sources.values()].join("\n");
}

const IMPLEMENTED_STATUSES = new Set([
  "accepted_on_private_feature_branch",
  "mechanism_present_alternatives_source_unverified",
]);

const UNIMPLEMENTED_STATUSES = new Set([
  "pending",
  "conditional_refusal",
  "reported_unpublished_artifact_absent",
]);

type LedgerAxis = {
  id?: string;
  key?: string;
  label?: string;
  baseline_status?: string;
  campaign_implementation?: { status?: string };
};

type Ledger = {
  status_vocabulary?: Record<string, unknown>;
  axes?: LedgerAxis[];
};

function axisNumber(id: string): string | undefined {
  const match = /^delivery:B(\d{2})$/.exec(id);
  return match?.[1];
}

/**
 * An axis's paper documents are docs/paper/b{NN}-*.md. A pooled document such as
 * b03-b05-foundational-semantics-*.md covers every axis in its leading range.
 */
function paperDocumentsForAxis(number: string, paperFiles: readonly string[]): string[] {
  const ordinal = Number(number);
  return paperFiles.filter((name) => {
    const single = /^b(\d{2})-/.exec(name);
    const range = /^b(\d{2})-b(\d{2})-/.exec(name);
    if (range) {
      return ordinal >= Number(range[1]) && ordinal <= Number(range[2]);
    }
    return single ? Number(single[1]) === ordinal : false;
  });
}

const ledgerSource = await readFile(ledgerPath, "utf8");
const ledger = parseYaml(ledgerSource) as Ledger;
const axes = ledger.axes ?? [];
if (axes.length === 0) {
  throw new Error(`${path.relative(repoDir, ledgerPath)}: no axes found`);
}

const vocabulary = new Set(Object.keys(ledger.status_vocabulary ?? {}));
const contractSource = await readFile(contractPath, "utf8");
const kernelSource = await pipelineSource(kernelPath);
const paperFiles = (await readdir(paperDir)).filter((name) => name.endsWith(".md"));

const violations: string[] = [];
const gated: string[] = [];
const skipped: string[] = [];

for (const axis of axes) {
  const id = axis.id ?? "";
  const number = axisNumber(id);
  if (!number) {
    violations.push(`${id || "(missing id)"}: axis id does not match delivery:B(NN)`);
    continue;
  }
  const key = axis.key;
  if (!key) {
    violations.push(`${id}: axis has no key`);
    continue;
  }

  const status = axis.campaign_implementation?.status ?? axis.baseline_status ?? "";
  if (!vocabulary.has(status)) {
    violations.push(
      `${id}: status "${status}" is not defined in the ledger's status_vocabulary`,
    );
    continue;
  }
  if (!IMPLEMENTED_STATUSES.has(status)) {
    if (!UNIMPLEMENTED_STATUSES.has(status)) {
      violations.push(
        `${id}: status "${status}" is classified neither implemented nor unimplemented by ` +
          `this check; classify it in check_axis_completeness.mts before using it`,
      );
      continue;
    }
    skipped.push(`${id} (${key}): ${status} — not gated`);
    continue;
  }

  const documents = paperDocumentsForAxis(number, paperFiles);
  if (documents.length === 0) {
    skipped.push(`${id} (${key}): ${status}, no docs/paper/b${number}-*.md — not gated`);
    continue;
  }

  const inContract = contractSource.includes(key);
  const inKernel = kernelSource.includes(key);
  if (inContract && inKernel) {
    gated.push(`${id} (${key}): ${status} — contract + kernel present`);
    continue;
  }

  const missing: string[] = [];
  if (!inContract) missing.push("web/schema/chronicle-local-contract.linkml.yaml");
  if (!inKernel) missing.push("rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs module closure");
  violations.push(
    `${id} (${key}): status "${status}" claims an implementation and ` +
      `${documents.join(", ")} exists, but the option key "${key}" is absent from ` +
      `${missing.join(" and ")}. Documents and tests do not make an axis done.`,
  );
}

if (violations.length > 0) {
  console.error(
    `Delivery-axis completeness failed:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`,
  );
  process.exit(1);
}

console.log("Delivery-axis completeness: every implemented axis reaches the contract and the kernel.");
for (const line of gated) console.log(`  gated  ${line}`);
for (const line of skipped) console.log(`  skip   ${line}`);

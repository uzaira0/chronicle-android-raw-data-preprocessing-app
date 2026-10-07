import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The execution-query registry of the committed runtime WASM, read through its
 * own `workflow_contract_json()` export: the same build the review-batch
 * benchmarks spawn, so the registry they check manifests against (every query,
 * in contract order) is the one the measured runtime reports.
 * `schema/chronicle-workflow.yaml` is a projection of that contract and does
 * not carry the same per-query shape.
 *
 * @param {string} [packageDirectory] runtime package to read; defaults to the
 *   committed one, which is also the benchmark helper's default
 * @returns {Promise<Array<{id: string, inputs: string[], requestFields: string[]}>>}
 */
export async function loadRuntimeWorkflowQueries(
  packageDirectory = path.resolve(
    "src/wasm/chronicle_preprocessing_runtime_wasm/pkg",
  ),
) {
  const runtime = await import(
    pathToFileURL(
      path.join(packageDirectory, "chronicle_preprocessing_runtime_wasm.js"),
    ).href
  );
  runtime.initSync({
    module: await readFile(
      path.join(packageDirectory, "chronicle_preprocessing_runtime_wasm_bg.wasm"),
    ),
  });
  /** @type {{execution?: {queries?: Array<{id: string, inputs: string[], requestFields: string[]}>}}} */
  const contract = JSON.parse(runtime.workflow_contract_json());
  const queries = contract.execution?.queries;
  if (!Array.isArray(queries)) {
    throw new Error("runtime workflow contract has no execution.queries");
  }
  for (const query of queries) {
    if (
      typeof query.id !== "string" ||
      !Array.isArray(query.inputs) ||
      !Array.isArray(query.requestFields)
    ) {
      throw new Error(
        `runtime workflow query is missing id/inputs/requestFields: ${JSON.stringify(query).slice(0, 200)}`,
      );
    }
  }
  return queries;
}

const QUERY_STATUSES = new Set(["cached", "recomputed", "bypassed", "skipped"]);

/**
 * Check one manifest's query statuses against the runtime registry: every
 * registered query exactly once and in contract order, only known statuses,
 * no `cached` status unless the manifest names the cache it came from, and at
 * least one query recomputed. Returns the per-status counts.
 *
 * Which queries an option change *should* recompute is deliberately not
 * re-derived here from the declared inputs: that table is a may-read mirror,
 * and the result digest's match with the cold oracle is the correctness check.
 *
 * @param {Array<[string, string]>} statuses
 * @param {string[]} queryIds
 * @param {string[]} cacheSources
 * @param {string} label
 * @returns {Record<string, number>}
 */
export function verifyQueryStatuses(statuses, queryIds, cacheSources, label) {
  if (
    !Array.isArray(statuses) ||
    statuses.map(([query]) => query).join("\n") !== queryIds.join("\n")
  ) {
    throw new Error(
      `${label}: query statuses are not the complete registry in contract order`,
    );
  }
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [query, status] of statuses) {
    if (!QUERY_STATUSES.has(status)) {
      throw new Error(`${label}: ${query} reported invalid status ${status}`);
    }
    if (status === "cached" && cacheSources.length === 0) {
      throw new Error(
        `${label}: ${query} reported cached but the manifest names no cache source`,
      );
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  if (!counts.recomputed) {
    throw new Error(`${label}: no query was recomputed`);
  }
  return counts;
}

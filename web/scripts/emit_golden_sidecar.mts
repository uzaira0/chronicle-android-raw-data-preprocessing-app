/**
 * Emit a REAL PROV-O provenance sidecar (`chronicle-provenance.jsonld`) by
 * running one golden scenario through the actual pipeline — the artifact
 * `schema/tests/validate_sidecar.py` SHACL-validates, closing the loop
 * between the runtime lineage ledger and the research ontology's
 * NodeExecution/StepDefinition contract.
 *
 * runId/generatedAt are FIXED: the validation is structural, and a stable
 * identity keeps the emitted graph diffable across runs (timings inside the
 * NodeExecutions still vary — the validator never pins them).
 *
 * Usage: bunx vite-node scripts/emit_golden_sidecar.mts [outPath]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { GOLDEN_SCENARIOS, runGoldenScenario } from "@/lib/pipelineGraph/golden/goldenScenario";
import { buildParameterSetRecord, buildProvenanceJsonLd } from "@/lib/processingReport";

const outPath = resolve(process.argv[2] ?? "schema/tests/.artifacts/chronicle-provenance.jsonld");

const scenario = GOLDEN_SCENARIOS[0];
if (!scenario) throw new Error("emit_golden_sidecar: no golden scenarios defined");

const result = await runGoldenScenario(scenario);
if (!result.executionLedger || result.executionLedger.length === 0) {
  throw new Error("emit_golden_sidecar: the golden run produced no ExecutionLedger");
}

const parameterSet = await buildParameterSetRecord(scenario.options);
const jsonld = buildProvenanceJsonLd({
  results: [result],
  options: scenario.options,
  preprocessorVersion: "golden-sidecar",
  generatedAt: "2026-01-01T00:00:00.000Z",
  runId: "golden-sidecar-run",
  environment: {},
  parameterSetSha256: parameterSet.sha256,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, jsonld, "utf8");
console.log(
  `emit_golden_sidecar: wrote ${outPath} (${jsonld.length} bytes, scenario "${scenario.name}", ` +
    `${result.executionLedger.length} unit records)`,
);

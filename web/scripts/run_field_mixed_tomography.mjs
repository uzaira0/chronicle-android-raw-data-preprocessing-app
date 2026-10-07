import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const expectedDirectory = resolve(
  webRoot,
  "src/lib/pipelineGraph/golden/family-expected",
);
const aggregateFile = join(
  expectedDirectory,
  "field-mixed-tomography-ledger.json",
);
const testFile = "src/lib/pipelineGraph/golden/fieldMixedTomography.test.ts";
const update = process.env.UPDATE_FIELD_MIXED === "1";
// 5 concurrent shards measured safe under the CAP_MEM=12G campaign budget
// (each shard is one vitest worker holding one WASM runtime); 3 left ~44s of
// wall-clock on the table per depev run.
const maxParallel = Number(process.env.FIELD_MIXED_MAX_PARALLEL ?? "5");
if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 12) {
  throw new Error(
    "FIELD_MIXED_MAX_PARALLEL must be an integer from 1 through 12",
  );
}
// Each shard is its own process so the WASM instance is recycled between
// columns, the same reason the mixed artifact campaign shards by role.
const scratchRoot = mkdtempSync(join(webRoot, ".tmp-field-mixed-"));

/** @param {string} bytes */
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** @param {Record<string, string>} env @param {string} label */
function runVitest(env, label) {
  process.stdout.write(`\n── per-field shard: ${label}\n`);
  const child = spawn(
    resolve(webRoot, "node_modules/.bin/vitest"),
    ["run", testFile],
    {
      cwd: webRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    },
  );
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(undefined);
      else
        reject(
          new Error(`${label}: shard exited code=${code} signal=${signal}`),
        );
    });
  });
}

const listFile = join(scratchRoot, "columns.json");
try {
  await runVitest(
    { FIELD_MIXED_LIST_OUTPUT: listFile, FIELD_MIXED_COLUMN: "" },
    "enumerate campaign columns",
  );
  /** @type {{ columns: string[], sourceSensitiveCapabilityColumns: string[], withoutDeclaredReach: string[] }} */
  const { columns, sourceSensitiveCapabilityColumns, withoutDeclaredReach } =
    JSON.parse(readFileSync(listFile, "utf8"));
  if (columns.length === 0)
    throw new Error("no campaign columns were enumerated");
  const only = process.env.FIELD_MIXED_ONLY;
  const selected = only ? columns.filter((column) => column === only) : columns;
  if (selected.length === 0)
    throw new Error(`FIELD_MIXED_ONLY matched nothing: ${only}`);

  for (let index = 0; index < selected.length; index += maxParallel) {
    await Promise.all(
      selected.slice(index, index + maxParallel).map((column) =>
        runVitest(
          {
            FIELD_MIXED_COLUMN: column,
            UPDATE_FIELD_MIXED: update ? "1" : "0",
          },
          column,
        ),
      ),
    );
  }

  const shards = selected.map((sourceField) => {
    const path = join(
      expectedDirectory,
      `field-mixed-tomography-${sourceField.replace(/[^A-Za-z0-9_]/g, "-")}.json`,
    );
    const text = readFileSync(path, "utf8");
    return {
      sourceField,
      path: relative(expectedDirectory, path),
      contentDigest: sha256(text),
      ledger: JSON.parse(text),
    };
  });
  const firstShard = shards[0];
  if (!firstShard) throw new Error("no per-field shards to aggregate");
  const receipt = firstShard.ledger.implementationReceipt;
  for (const shard of shards) {
    if (
      JSON.stringify(shard.ledger.implementationReceipt) !==
      JSON.stringify(receipt)
    ) {
      throw new Error(`${shard.sourceField}: per-field ledger receipt drift`);
    }
  }
  /** @param {string} field */
  const sum = (field) =>
    shards.reduce((total, shard) => total + shard.ledger.coverage[field], 0);
  const aggregate = {
    protocolVersion: "chronicle-field-mixed-tomography-aggregate/v2",
    claimBoundary:
      "Aggregate of independently recycled generic per-source-column shards. Each shard selects one empirically branch-activating intervention that rewrites exactly that supplied column, crosses it with every non-compound computational configuration axis the field-level workflow contract predicts can interact with the column, and adds a deterministic control sample of axes it predicts cannot. The eight conditionally active input-capability fields are explicitly owned by the configuration-space sourceSensitiveScientificCells campaign rather than silently listed as generic shards. Raw×source-sensitive sidecar rebind pairs are explicitly excluded and unestimated; that campaign proves only the generic LF-sidecar to CRLF-raw Parry rebind mechanism. Under every executed configuration every changed canonical output cell belongs to a declared output-cell family of that column, and no control axis introduces a family the base configuration did not move. Columns without an activating intervention in the checked catalog are outside this claim, and a declared family no configuration moved is recorded rather than asserted.",
    implementationReceipt: receipt,
    columnsWithoutDeclaredReach: withoutDeclaredReach,
    sourceSensitiveCapabilityColumns,
    coverage: {
      sourceColumns: shards.length,
      predictedAffectedAxes: sum("predictedAffectedAxes"),
      predictedUnaffectedAxes: sum("predictedUnaffectedAxes"),
      controlAxesExecuted: sum("controlAxesExecuted"),
      activationExecutions: sum("activationExecutions"),
      crossExecutions: sum("crossExecutions"),
      totalRustExecutions: sum("totalRustExecutions"),
    },
    columnShards: shards.map(
      ({ sourceField, path, contentDigest, ledger }) => ({
        sourceField,
        path,
        contentDigest,
        interventionId: ledger.fixture.interventionId,
        corpusId: ledger.fixture.corpusId,
        declaredQueryConeSize: ledger.declaredQueryCone.length,
        declaredCellFamilies: ledger.declaredCellFamilies.length,
        witnessedCellFamilies:
          ledger.witnessedCellFamiliesAcrossAllConfigurations.length,
        structurallyDeclaredButUnwitnessedFamilies:
          ledger.structurallyDeclaredButUnwitnessedFamilies.length,
        queriesOutsideDeclaredConeCarryingChangedFields:
          ledger.queriesOutsideDeclaredConeCarryingChangedFields.length,
      }),
    ),
  };
  const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (update) {
    // FIELD_MIXED_ONLY is a debugging shard filter; recording an aggregate
    // from a filtered run would silently shrink the checked-in evidence to
    // the selected columns.
    if (selected.length !== columns.length) {
      throw new Error(
        `refusing to record a truncated aggregate: FIELD_MIXED_ONLY selected ${selected.length} of ${columns.length} columns`,
      );
    }
    writeFileSync(aggregateFile, serialized, "utf8");
  } else if (serialized !== readFileSync(aggregateFile, "utf8")) {
    throw new Error(
      "per-field aggregate differs from checked-in evidence; rerun with UPDATE_FIELD_MIXED=1 only after reviewing the change",
    );
  }
  process.stdout.write(
    `\nper-field tomography: ${shards.length} columns, ${sum("totalRustExecutions")} Rust executions\n`,
  );
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}

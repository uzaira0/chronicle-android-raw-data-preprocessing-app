import { access, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(webDir, "..");
const artifactMode = process.argv[2] ?? "cloudflare";

const sharedRequiredFiles = ["index.html", "manifest.webmanifest", "sw.js", ".vite/manifest.json"];

const cloudflareRequiredFiles = ["_headers", ...sharedRequiredFiles];
const cloudflareRequiredHeaderSnippets = [
  "Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy: same-origin",
  "Cross-Origin-Embedder-Policy: credentialless",
  "Cross-Origin-Resource-Policy: same-origin",
  "Origin-Agent-Cluster: ?1",
  "Referrer-Policy: no-referrer",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), web-share=()",
  "Strict-Transport-Security: max-age=31536000; includeSubDomains",
  "/index.html",
  "Cache-Control: no-store",
  "/sw.js",
  "Cache-Control: no-cache, no-store, must-revalidate",
  "/manifest.webmanifest",
  "Cache-Control: no-cache",
  "/assets/*",
  "Cache-Control: public, max-age=31536000, immutable",
];

function getArtifactDir(mode: string): string {
  if (mode === "github-pages") {
    return path.join(webDir, ".github-pages-dist");
  }
  return path.join(webDir, "dist");
}

type BundleBudget = {
  totalBytes: number;
  categories: Record<string, number>;
  filePrefixes?: Record<string, number>;
};

type DependencyCertificate = {
  protocol_version: string;
  structural_contract: { plan_digest: string };
  evidence: {
    implementation_receipt: {
      implementation?: string;
      implementationDigest: string;
      planDigest: string;
      profileDigest: string;
      profileLockDigest: string;
      runtimeAuthorityDigest: string;
      productContractDigest: string;
    };
    proof_ledgers: Array<{
      path: string;
      digest: string;
      protocol_version: string;
      claim_boundary: string;
    }>;
  };
};

const requiredProofLedgers = [
  "web/src/lib/pipelineGraph/golden/family-expected/configuration-influence-ledger.json",
  "web/src/lib/pipelineGraph/golden/family-expected/artifact-influence-ledger.json",
  "web/src/lib/pipelineGraph/golden/family-expected/raw-boundary-influence-ledger.json",
  "web/src/lib/pipelineGraph/golden/family-expected/interaction-influence-ledger.json",
  "web/src/lib/pipelineGraph/golden/family-expected/mixed-artifact-configuration-ledger.json",
  "web/src/lib/pipelineGraph/golden/family-expected/semantic-model-mutation-ledger.json",
] as const;

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function verifyDependencyEvidenceCurrent(): Promise<string> {
  const certificate = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        ".semantic-federation/proofs/dependency-certificate.json",
      ),
      "utf8",
    ),
  ) as DependencyCertificate;
  if (certificate.protocol_version !== "chronicle-dependency-certificate/v1") {
    throw new Error(
      `unsupported dependency certificate protocol: ${certificate.protocol_version}`,
    );
  }
  const receipt = certificate.evidence.implementation_receipt;
  const ledgerPaths = certificate.evidence.proof_ledgers
    .map((ledger) => ledger.path)
    .sort();
  const expectedLedgerPaths = [...requiredProofLedgers].sort();
  if (JSON.stringify(ledgerPaths) !== JSON.stringify(expectedLedgerPaths)) {
    throw new Error(
      `dependency proof ledger closure mismatch: expected=${expectedLedgerPaths.join(",")} actual=${ledgerPaths.join(",")}`,
    );
  }
  for (const ledger of certificate.evidence.proof_ledgers) {
    const ledgerPath = path.resolve(repositoryRoot, ledger.path);
    if (!ledgerPath.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error(`dependency proof ledger escapes repository root: ${ledger.path}`);
    }
    const ledgerBytes = await readFile(ledgerPath);
    const actualDigest = sha256(ledgerBytes);
    if (actualDigest !== ledger.digest) {
      throw new Error(
        `dependency proof ledger digest mismatch for ${ledger.path}: certificate=${ledger.digest} current=${actualDigest}`,
      );
    }
    const actualLedger = JSON.parse(ledgerBytes.toString("utf8")) as {
      protocolVersion?: string;
      claimBoundary?: string;
      implementationReceipt?: typeof receipt;
    };
    if (actualLedger.protocolVersion !== ledger.protocol_version) {
      throw new Error(`dependency proof ledger protocol mismatch: ${ledger.path}`);
    }
    if (actualLedger.claimBoundary !== ledger.claim_boundary) {
      throw new Error(`dependency proof ledger claim boundary mismatch: ${ledger.path}`);
    }
    if (
      JSON.stringify(actualLedger.implementationReceipt) !== JSON.stringify(receipt)
    ) {
      throw new Error(`dependency proof ledger authority receipt mismatch: ${ledger.path}`);
    }
  }
  const kernelPath = path.join(
    webDir,
    "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js",
  );
  const kernel = (await import(pathToFileURL(kernelPath).href)) as {
    initSync(input: { module: Uint8Array }): unknown;
    implementation_build_digest(): string;
  };
  kernel.initSync({
    module: await readFile(
      path.join(
        webDir,
        "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
      ),
    ),
  });
  const bindings = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        ".semantic-federation/semantic/capability-bindings.json",
      ),
      "utf8",
    ),
  ) as { product_contract_digest: string };
  const actual = {
    implementationDigest: kernel.implementation_build_digest(),
    planDigest: sha256(
      await readFile(
        path.join(
          repositoryRoot,
          ".semantic-federation/semantic/resources/chronicle.plan.json",
        ),
      ),
    ),
    profileDigest: sha256(
      await readFile(
        path.join(
          repositoryRoot,
          ".semantic-federation/semantic/semantic-profile.json",
        ),
      ),
    ),
    profileLockDigest: sha256(
      await readFile(
        path.join(
          repositoryRoot,
          ".semantic-federation/semantic/semantic-profile.lock",
        ),
      ),
    ),
    runtimeAuthorityDigest: sha256(
      await readFile(
        path.join(
          repositoryRoot,
          ".semantic-federation/semantic/resources/runtime-authority.json",
        ),
      ),
    ),
    productContractDigest: bindings.product_contract_digest,
  };
  if (certificate.structural_contract.plan_digest !== actual.planDigest) {
    throw new Error("dependency certificate structural plan digest is stale");
  }
  for (const [field, value] of Object.entries(actual)) {
    if (receipt[field as keyof typeof receipt] !== value) {
      throw new Error(
        `dependency proof evidence is stale for ${field}: certificate=${receipt[field as keyof typeof receipt]} current=${value}; rerun the combinatorial proof and regenerate the certificate`,
      );
    }
  }
  return actual.implementationDigest;
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

/**
 * Size-budget assertion (bundle-budget.json): total artifact bytes plus
 * per-extension category budgets. Fails on UNEXPLAINED growth — raising a
 * budget is a deliberate, named change to bundle-budget.json.
 */
async function checkBundleBudget(artifactDir: string): Promise<Record<string, number>> {
  const budget = JSON.parse(
    await readFile(path.join(webDir, "bundle-budget.json"), "utf-8"),
  ) as BundleBudget;

  let total = 0;
  const byExtension: Record<string, number> = {};
  const files: Array<{ name: string; bytes: number }> = [];
  for await (const filePath of walkFiles(artifactDir)) {
    const bytes = (await stat(filePath)).size;
    files.push({ name: path.basename(filePath), bytes });
    total += bytes;
    const extension = path.extname(filePath) || "(none)";
    byExtension[extension] = (byExtension[extension] ?? 0) + bytes;
  }

  const failures: string[] = [];
  if (total > budget.totalBytes) {
    failures.push(`total ${total.toLocaleString()} B exceeds budget ${budget.totalBytes.toLocaleString()} B`);
  }
  for (const [extension, limit] of Object.entries(budget.categories)) {
    const actual = byExtension[extension] ?? 0;
    if (actual > limit) {
      failures.push(`${extension} ${actual.toLocaleString()} B exceeds budget ${limit.toLocaleString()} B`);
    }
  }
  for (const [prefix, limit] of Object.entries(budget.filePrefixes ?? {})) {
    const matches = files.filter(({ name }) => name.startsWith(prefix));
    if (matches.length !== 1) {
      failures.push(`${prefix} matched ${matches.length} files; expected exactly one`);
      continue;
    }
    if (matches[0].bytes > limit) {
      failures.push(
        `${matches[0].name} ${matches[0].bytes.toLocaleString()} B exceeds budget ${limit.toLocaleString()} B`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `bundle budget exceeded:\n  ${failures.join("\n  ")}\n` +
        "If the growth is intentional, name the cause and raise bundle-budget.json in the same change.",
    );
  }
  return { totalBytes: total, ...byExtension };
}

async function main(): Promise<void> {
  const artifactDir = getArtifactDir(artifactMode);
  const requiredFiles = artifactMode === "github-pages" ? [".nojekyll", ...sharedRequiredFiles] : cloudflareRequiredFiles;

  for (const relativePath of requiredFiles) {
    await access(path.join(artifactDir, relativePath));
  }

  const indexHtml = await readFile(path.join(artifactDir, "index.html"), "utf-8");
  const manifestText = await readFile(
    path.join(artifactDir, ".vite/manifest.json"),
    "utf-8",
  );
  if (manifestText.includes("browserPipeline")) {
    throw new Error(
      `${path.basename(artifactDir)} includes the archived TypeScript computation in its manifest`,
    );
  }
  for await (const filePath of walkFiles(artifactDir)) {
    if (path.basename(filePath).includes("browserPipeline")) {
      throw new Error(
        `${path.basename(artifactDir)} includes a legacy TypeScript computation chunk: ${path.basename(filePath)}`,
      );
    }
    if (path.extname(filePath) === ".js") {
      const javascript = await readFile(filePath, "utf-8");
      for (const forbidden of [
        "processRawCsvContent",
        'executionAuthority:"typescript"',
      ]) {
        if (javascript.includes(forbidden)) {
          throw new Error(
            `${path.basename(artifactDir)} production JavaScript contains forbidden computational authority: ${forbidden}`,
          );
        }
      }
    }
  }
  const metaCspMatch = indexHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  );
  if (!metaCspMatch) {
    throw new Error(`${path.basename(artifactDir)}/index.html is missing the CSP meta tag fallback`);
  }

  if (artifactMode === "github-pages") {
    try {
      await access(path.join(artifactDir, "_headers"));
      throw new Error("GitHub Pages artifact should not contain Cloudflare-only _headers");
    } catch (error) {
      if (!(error instanceof Error) || !/should not contain/.test(error.message)) {
        // File correctly absent.
      } else {
        throw error;
      }
    }
  } else {
    const headersText = await readFile(path.join(artifactDir, "_headers"), "utf-8");
    for (const snippet of cloudflareRequiredHeaderSnippets) {
      if (!headersText.includes(snippet)) {
        throw new Error(`${path.basename(artifactDir)}/_headers is missing required snippet: ${snippet}`);
      }
    }

    const cspMatch = headersText.match(/Content-Security-Policy: ([^\n]+)/);
    if (!cspMatch) {
      throw new Error(`${path.basename(artifactDir)}/_headers does not contain a Content-Security-Policy rule`);
    }
    const headersCsp = cspMatch[1]!.trim();
    const metaCsp = metaCspMatch[1]!.trim();
    // frame-ancestors is enforceable only via the HTTP header — browsers
    // ignore it in a <meta> CSP and log a console warning — so the meta tag
    // deliberately omits exactly that one directive.
    const headersCspForMeta = headersCsp.replace("; frame-ancestors 'none'", "");
    if (headersCspForMeta === headersCsp) {
      throw new Error(
        `${path.basename(artifactDir)}/_headers CSP no longer pins frame-ancestors 'none'`,
      );
    }
    if (headersCspForMeta !== metaCsp) {
      throw new Error(
        `CSP mismatch between ${path.basename(artifactDir)}/_headers and ${path.basename(artifactDir)}/index.html\nheaders (frame-ancestors removed): ${headersCspForMeta}\nmeta: ${metaCsp}`,
      );
    }
  }

  const bundleSizes = await checkBundleBudget(artifactDir);
  const dependencyImplementationDigest =
    await verifyDependencyEvidenceCurrent();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: artifactMode,
        artifactDir,
        verifiedFiles: requiredFiles,
        bundleSizes,
        dependencyImplementationDigest,
      },
      null,
      2,
    ),
  );
}

await main();

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { build, type Plugin } from "vite";
import { expect, it } from "vitest";
import { methodProfileLiteralInitializers, packedJsonAssetsPlugin } from "../scripts/packed_json_assets.mjs";

it("packages only independent JSON-valued literals without evaluating source or coercing values", () => {
  const large = "x".repeat(1_024);
  const source = `
    const safe = { text: ${JSON.stringify(large)}, values: [-2, 1.5, true, false, null, "", "line\\nend"] } as const;
    const unsafe = { text: ${JSON.stringify(large)}, value: undefined };
    const hole = [${JSON.stringify(large)}, , 1];
    const negativeZero = [${JSON.stringify(large)}, -0];
    const alias = [${JSON.stringify(large)}, safe];
    const prototype = { text: ${JSON.stringify(large)}, __proto__: null };
    const duplicate = { text: ${JSON.stringify(large)}, text: "last" };
    const getter = { text: ${JSON.stringify(large)}, get value() { throw new Error("never execute"); } };
    const computed = { ["text"]: ${JSON.stringify(large)} };
    const spread = { ...safe };
    const nonfinite = [${JSON.stringify(large)}, 1e400];
    let mutable = [${JSON.stringify(large)}];
  `;
  expect(methodProfileLiteralInitializers(source).map(literal => [literal.name, literal.value]))
    .toEqual([["safe", { text: large, values: [-2, 1.5, true, false, null, "", "line\nend"] }]]);
});

it.each(["methodProfiles.ts", "generatedRuntimeBoundary.ts", "generatedContract.ts"])("retains every selected original %s value, including lexical spelling and ordering", (name) => {
  const source = readFileSync(resolve(import.meta.dirname, "lib", name), "utf8");
  const literals = methodProfileLiteralInitializers(source);
  if (name === "methodProfiles.ts") expect(literals.length).toBeGreaterThan(50);
  if (name === "generatedRuntimeBoundary.ts") expect(literals.map(literal => literal.name)).toEqual(["RUNTIME_BOUNDARY_MODEL"]);
  if (name === "generatedContract.ts") expect(literals.map(literal => literal.name)).toEqual([
    "BROWSER_PROCESSING_OPTION_KEYS", "COMPUTATIONAL_BROWSER_OPTION_KEYS",
    "BROWSER_REQUIRED_PROCESSING_OPTION_KEYS", "BROWSER_OPTION_TOOLTIPS",
  ]);
  for (const literal of literals) {
    // Independent execution of ONLY the already-proven literal expression:
    // no source functions, imports, or algorithms enter this bounded context.
    const expression = source.slice(literal.start, literal.end);
    const compiled = ts.transpileModule(`(${expression});`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
    const original: unknown = runInNewContext(compiled, {}, { timeout: 100 });
    expect(JSON.stringify(literal.value), literal.name).toBe(JSON.stringify(original));
  }
  // methodProfiles.ts is ~26k lines parsed and transpiled literal by literal; under
  // the pre-push coverage run with the suite in parallel this exceeds the 5 s default.
}, 60_000);

it("refuses recovered malformed large literals rather than hiding a source syntax error", () => {
  const text = JSON.stringify("x".repeat(1_024));
  for (const source of [`const x = { text: ${text}, a: 1 b: 2 };`, `const x = { text: ${text}, a: 1;`]) {
    expect(() => methodProfileLiteralInitializers(source)).toThrow("invalid method-profile source cannot be packaged");
  }
});

it("builds exact-byte JSON assets with top-level await and counts every emitted payload", async () => {
  const webRoot = resolve(import.meta.dirname, "..");
  const files = [
    "src/generated/android-method-profile-runtime-registry.json",
    "schema/sleep-diary-catalog.bridge.json",
    "schema/literature-input-adapter-contract.json",
    "src/generated/literature-external-executor-registry.json",
    "src/generated/source-artifact-provenance-registry.json",
  ];
  const literalFiles = [
    ["lib/methodProfiles.ts", "method-profile-literals.json.gz"],
    ["lib/generatedRuntimeBoundary.ts", "runtime-boundary-literals.json.gz"],
    ["lib/generatedContract.ts", "browser-contract-literals.json.gz"],
  ];
  const result = await build({
    configFile: false,
    plugins: [packedJsonAssetsPlugin(webRoot), {
      name: "packing-test-entry",
      resolveId: id => id === "packing-test-entry" ? "\0packing-test-entry" : null,
      load: id => id === "\0packing-test-entry" ? files.map((file, i) =>
        `import v${i} from ${JSON.stringify(resolve(webRoot, file))}; console.log(v${i});`).join("\n") +
        literalFiles.map(([file], i) =>
          `\nimport * as literals${i} from ${JSON.stringify(resolve(webRoot, "src", file!))}; console.log(literals${i});`).join("\n") : null,
    } satisfies Plugin],
    resolve: { alias: { "@": resolve(webRoot, "src") } },
    build: { write: false, target: "esnext", assetsInlineLimit: 0, rollupOptions: { input: "packing-test-entry" } },
    logLevel: "silent",
  });
  expect(Array.isArray(result)).toBe(false);
  if (Array.isArray(result) || !("output" in result)) throw new Error("expected one output bundle");
  const chunks = result.output.filter(output => output.type === "chunk");
  expect(chunks.map(chunk => chunk.code).join("\n")).toContain("await");
  const assets = result.output.filter(output => output.type === "asset")
    .filter(output => output.fileName.endsWith(".json.pack"));
  expect(assets).toHaveLength(8);
  for (const file of files) {
    const original = readFileSync(resolve(webRoot, file));
    const asset = assets.find(asset => asset.name === `${file.split("/").at(-1)}.gz`)!;
    expect(gunzipSync(asset.source)).toEqual(original);
    expect(chunks.map(chunk => chunk.code).join("\n"))
      .toContain(createHash("sha256").update(original).digest("hex"));
  }
  for (const [file, assetName] of literalFiles) {
    const source = readFileSync(resolve(webRoot, "src", file!), "utf8");
    const literals = methodProfileLiteralInitializers(source);
    const literalAsset = assets.find(asset => asset.name === assetName)!;
    const originalValues = Object.fromEntries(literals.map(literal => [literal.name, literal.value]));
    expect(JSON.parse(gunzipSync(literalAsset.source).toString())).toEqual(originalValues);
    expect(chunks.map(chunk => chunk.code).join("\n"))
      .toContain(createHash("sha256").update(JSON.stringify(originalValues)).digest("hex"));
  }
  // Aggregates include compressed assets themselves; no payload is dropped or
  // hidden in a transport-only budget outside the normal deploy accounting.
  expect(assets.reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0)).toBeGreaterThan(900_000);
  // A real Vite build over ~900 KB of packed payloads: ~10 s alone, 42 s under the
  // pre-push coverage run with the rest of the suite in parallel. 30 s was too tight.
}, 120_000);

it("packs both runtime URL consumers once while keeping source WASM and the semantic bootstrap raw", async () => {
  const webRoot = resolve(import.meta.dirname, "..");
  const runtime = resolve(webRoot, "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm");
  const glue = resolve(webRoot, "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js");
  const source = readFileSync(runtime);
  const result = await build({ configFile: false,
    plugins: [packedJsonAssetsPlugin(webRoot), { name: "runtime-transport-entry",
      resolveId: id => id === "runtime-transport-entry" ? "\0runtime-transport-entry" : null,
      load: id => id === "\0runtime-transport-entry" ?
        `import url, {packedWasmIdentity} from ${JSON.stringify(runtime + "?chronicle-runtime-asset")};\n` +
        `import init from ${JSON.stringify(glue)}; console.log(url, packedWasmIdentity, init);` : null,
    } satisfies Plugin], resolve: { alias: { "@": resolve(webRoot, "src") } },
    build: { write: false, target: "esnext", assetsInlineLimit: 0, rollupOptions: { input: "runtime-transport-entry" } }, logLevel: "silent" });
  if (Array.isArray(result) || !("output" in result)) throw new Error("expected one output bundle");
  const runtimeAssets = result.output.filter(asset => asset.type === "asset" && asset.fileName.split("/").at(-1)!.startsWith("chronicle_preprocessing_runtime_wasm_bg-"));
  expect(runtimeAssets).toHaveLength(1);
  const asset = runtimeAssets[0]!;
  if (asset.type !== "asset") throw new Error("expected runtime asset");
  expect(asset.fileName).toMatch(/\.wasm$/);
  expect(gunzipSync(asset.source).equals(source)).toBe(true);
  expect(readFileSync(runtime).equals(source)).toBe(true);
  expect(source.subarray(0, 8)).toEqual(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const transport = result.output.find(asset => asset.type === "asset" && asset.fileName === "runtime-wasm-transport.json")!;
  if (transport.type !== "asset") throw new Error("expected transport manifest");
  expect(JSON.parse(String(transport.source))).toEqual({ fileName: asset.fileName, transport: "gzip",
    encodedBytes: Buffer.byteLength(asset.source), decodedBytes: source.length,
    encodedSha256: createHash("sha256").update(asset.source).digest("hex"),
    decodedSha256: createHash("sha256").update(source).digest("hex") });
  const semantic = result.output.filter(asset => asset.type === "asset" && asset.fileName.split("/").at(-1)!.startsWith("chronicle_semantic_index_wasm_bg-"));
  expect(semantic).toHaveLength(1);
  if (semantic[0]!.type !== "asset") throw new Error("expected raw semantic asset");
  expect(Buffer.from(semantic[0]!.source).subarray(0, 8)).toEqual(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
}, 120_000);

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import type { Plugin } from "vite";

const PREFIX = "\0chronicle-packed-json:";
const WASM_QUERY = "?chronicle-runtime-asset";
const WASM_MODULE = "\0chronicle-runtime-wasm-asset.mjs";
const LITERAL_VALUES = "__chroniclePackedMethodProfileLiterals";
const LITERAL_LOADER = "__chronicleLoadMethodProfileLiterals";
type JsonLiteral = null | boolean | number | string | JsonLiteral[] | { [key: string]: JsonLiteral };
type LiteralResult = { value: JsonLiteral } | null;

// Do not evaluate source. Only syntax whose JavaScript value survives JSON
// serialization exactly can use the existing lossless asset transport.
function jsonLiteral(node: ts.Expression): LiteralResult {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return jsonLiteral(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { value: node.text };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isFinite(value) ? { value } : null;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    const value = -Number(node.operand.text);
    return Number.isFinite(value) && !Object.is(value, -0) ? { value } : null;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const value: JsonLiteral[] = [];
    for (const element of node.elements) {
      const member = jsonLiteral(element);
      if (!member) return null;
      value.push(member.value);
    }
    return { value };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, JsonLiteral> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return null;
      const name = property.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return null;
      const key = name.text;
      // A prototype setter is not a JSON property; duplicate keys and numeric
      // spellings are left inline rather than approximating literal semantics.
      if (key === "__proto__" || Object.hasOwn(value, key) || ts.isNumericLiteral(name)) return null;
      const member = jsonLiteral(property.initializer);
      if (!member) return null;
      value[key] = member.value;
    }
    return { value };
  }
  return null;
}

/** Build-derived data only. Original TypeScript declarations remain the owner. */
export function methodProfileLiteralInitializers(source: string) {
  const checked = ts.transpileModule(source, { fileName: "methodProfiles.ts", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext } });
  if (checked.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error("invalid method-profile source cannot be packaged");
  }
  const file = ts.createSourceFile("methodProfiles.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const literals: Array<{ name: string; start: number; end: number; value: JsonLiteral }> = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const parsed = jsonLiteral(declaration.initializer);
      if (!parsed || parsed.value === null || typeof parsed.value !== "object") continue;
      if (Buffer.byteLength(JSON.stringify(parsed.value)) < 1_024) continue;
      literals.push({ name: declaration.name.text, start: declaration.initializer.getStart(file),
        end: declaration.initializer.end, value: parsed.value });
    }
  }
  return literals;
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Package original JSON bytes only; schemas and registries remain their owners. */
export function packedJsonAssetsPlugin(webRoot: string): Plugin {
  const selected = new Set([
    resolve(webRoot, "src/generated/android-method-profile-runtime-registry.json"),
    resolve(webRoot, "schema/sleep-diary-catalog.bridge.json"),
    resolve(webRoot, "schema/literature-input-adapter-contract.json"),
    resolve(webRoot, "src/generated/literature-external-executor-registry.json"),
    resolve(webRoot, "src/generated/source-artifact-provenance-registry.json"),
  ]);
  const loader = resolve(webRoot, "src/lib/packedJsonAsset.ts");
  const runtimeWasm = resolve(webRoot, "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm");
  const runtimeGlue = resolve(webRoot, "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js");
  let production = false;
  let wasmTransport: { fileName: string; transport: "gzip"; encodedBytes: number; decodedBytes: number;
    encodedSha256: string; decodedSha256: string } | undefined;
  const literalModules = new Map([
    [resolve(webRoot, "src/lib/methodProfiles.ts"), "method-profile-literals.json"],
    [resolve(webRoot, "src/lib/generatedRuntimeBoundary.ts"), "runtime-boundary-literals.json"],
    [resolve(webRoot, "src/lib/generatedContract.ts"), "browser-contract-literals.json"],
  ]);
  function packageBytes(raw: Buffer, name: string, emit: (asset: { type: "asset"; name: string; source: Buffer; fileName: string }) => string) {
    const packed = gzipSync(raw, { level: 9 });
    const reference = emit({
      type: "asset", name: `${name}.gz`, source: packed,
      // .gz is an HTTP Content-Encoding on common static hosts. Binary .pack
      // keeps explicit decoding and compressed-byte verification with our owner.
      fileName: `assets/${basename(name, ".json")}-${digest(packed).slice(0, 16)}.json.pack`,
    });
    return `import.meta.ROLLUP_FILE_URL_${reference}, ${raw.length}, ${JSON.stringify(digest(raw))}, ${JSON.stringify(digest(packed))}`;
  }
  function packageRuntime(emit: (asset: { type: "asset"; name: string; source: Buffer; fileName: string }) => string) {
    const raw = readFileSync(runtimeWasm);
    if (raw.length === 0 || raw.length > 16 * 1024 * 1024) throw new Error("runtime WASM exceeds the supported decoded bound");
    if (!raw.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error("runtime source is not raw WASM");
    const packed = gzipSync(raw, { level: 9 });
    if (packed.length > 16 * 1024 * 1024) throw new Error("runtime WASM exceeds the supported encoded bound");
    wasmTransport = { fileName: `assets/chronicle_preprocessing_runtime_wasm_bg-${digest(packed).slice(0, 16)}.wasm`,
      transport: "gzip", encodedBytes: packed.length, decodedBytes: raw.length,
      encodedSha256: digest(packed), decodedSha256: digest(raw) };
    const reference = emit({ type: "asset", name: "chronicle_preprocessing_runtime_wasm_bg.wasm",
      fileName: wasmTransport.fileName, source: packed });
    return { url: `import.meta.ROLLUP_FILE_URL_${reference}`, identity: JSON.stringify(wasmTransport),
      argumentsText: `import.meta.ROLLUP_FILE_URL_${reference}, ${raw.length}, ${JSON.stringify(digest(raw))}, ${JSON.stringify(digest(packed))}, ${packed.length}` };
  }
  return {
    name: "chronicle-lossless-json-assets",
    enforce: "pre",
    configResolved(config) { production = config.command === "build"; },
    resolveId(source, importer) {
      const candidate = source.startsWith("@/")
        ? resolve(webRoot, "src", source.slice(2))
        : source.startsWith(".") && importer
          ? resolve(dirname(importer), source)
          : source;
      if (candidate === runtimeWasm + WASM_QUERY) return WASM_MODULE;
      return production && selected.has(candidate) ? `${PREFIX}${candidate}.mjs` : null;
    },
    load(id) {
      if (id === WASM_MODULE) {
        if (!production) return `import url from ${JSON.stringify(runtimeWasm + "?url")}; export default url; export const packedWasmIdentity = null;`;
        this.addWatchFile(runtimeWasm);
        const asset = packageRuntime(value => this.emitFile(value));
        return `export default ${asset.url}; export const packedWasmIdentity = ${asset.identity};`;
      }
      if (!production) return null;
      if (!id.startsWith(PREFIX)) return null;
      const source = id.slice(PREFIX.length, -4);
      this.addWatchFile(source);
      const raw = readFileSync(source);
      const argumentsText = packageBytes(raw, basename(source), asset => this.emitFile(asset));
      return [
        `import { loadPackedJsonAsset } from ${JSON.stringify(loader)};`,
        `const value = await loadPackedJsonAsset(${argumentsText});`,
        "export default value;",
      ].join("\n");
    },
    transform(source, id) {
      if (!production) return null;
      if (id === runtimeGlue) {
        const original = "module_or_path = new URL('chronicle_preprocessing_runtime_wasm_bg.wasm', import.meta.url);";
        if (source.split(original).length !== 2 || source.includes("__chronicleLoadRuntimeBytes")) throw new Error("runtime generated initialization boundary changed");
        this.addWatchFile(runtimeWasm);
        const asset = packageRuntime(value => this.emitFile(value));
        return { code: `import { loadPackedAssetBytes as __chronicleLoadRuntimeBytes } from ${JSON.stringify(loader)};\n` +
          source.replace(original, `module_or_path = await __chronicleLoadRuntimeBytes(${asset.argumentsText});`), map: null };
      }
      const name = literalModules.get(id);
      if (!name) return null;
      if (source.includes(LITERAL_VALUES) || source.includes(LITERAL_LOADER)) throw new Error("packed literal binding collision");
      const literals = methodProfileLiteralInitializers(source);
      if (!literals.length) return null;
      const values = Object.fromEntries(literals.map(literal => [literal.name, literal.value]));
      const argumentsText = packageBytes(Buffer.from(JSON.stringify(values)), name, asset => this.emitFile(asset));
      let transformed = source;
      for (const literal of [...literals].reverse()) {
        transformed = transformed.slice(0, literal.start) + `${LITERAL_VALUES}[${JSON.stringify(literal.name)}]` + transformed.slice(literal.end);
      }
      return {
        code: `import { loadPackedJsonAsset as ${LITERAL_LOADER} } from ${JSON.stringify(loader)};\n` +
          `const ${LITERAL_VALUES} = await ${LITERAL_LOADER}(${argumentsText});\n` + transformed,
        map: null,
      };
    },
    generateBundle() {
      if (wasmTransport) this.emitFile({ type: "asset", fileName: "runtime-wasm-transport.json",
        source: JSON.stringify(wasmTransport) });
    },
  };
}

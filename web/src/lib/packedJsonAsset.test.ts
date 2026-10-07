import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ initialize: vi.fn(), decode: vi.fn() }));
vi.mock("@/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js", () => ({
  default: runtime.initialize,
  decompress_bundled_gzip: runtime.decode,
  query_registered: () => JSON.stringify({ queryId: "query-registry", rows: [] }),
}));

const bytes = (input: Uint8Array) => new Uint8Array(input).buffer;
const digest = (input: Uint8Array) => createHash("sha256").update(input).digest("hex");
const raw = new TextEncoder().encode(' { "retained": [null, "opaque", 2], "unicode": "α" }\n');
const packed = gzipSync(raw);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.initialize.mockResolvedValue(undefined);
  runtime.decode.mockImplementation((input: Uint8Array) => new Uint8Array(gunzipSync(input)));
  vi.stubGlobal("location", { href: "https://chronicle.test/app/", origin: "https://chronicle.test" });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("lossless build JSON assets", () => {
  it("decodes exact original bytes before parsing and preserves every supplied JSON value", async () => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    expect(await decodePackedJsonBytes(bytes(packed), raw.length, digest(raw), digest(packed)))
      .toEqual(JSON.parse(new TextDecoder().decode(raw)));
    expect(runtime.initialize).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, 16 * 1024 * 1024 + 1])("refuses an invalid decoded size %s before decoding", async size => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(packed), size, digest(raw), digest(packed)))
      .rejects.toThrow("byte identity is invalid");
  });

  it.each([["wrong", digest(packed)], [digest(raw), "wrong"]])("refuses malformed digest metadata", async (rawHash, packedHash) => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(packed), raw.length, rawHash, packedHash))
      .rejects.toThrow("byte identity is invalid");
  });

  it("refuses compressed and decoded digest drift independently", async () => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(packed), raw.length, digest(raw), "0".repeat(64)))
      .rejects.toThrow("compressed digest mismatch");
    await expect(decodePackedJsonBytes(bytes(packed), raw.length, "0".repeat(64), digest(packed)))
      .rejects.toThrow("decoded digest mismatch");
  });

  it.each([raw.length - 1, raw.length + 1])("refuses decoded size drift %s", async size => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(packed), size, digest(raw), digest(packed)))
      .rejects.toThrow("decoded size mismatch");
  });

  it.each([new TextEncoder().encode("not gzip"), packed.subarray(0, packed.length - 1)])("refuses malformed or truncated gzip without a fallback reinterpretation", async broken => {
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(broken), raw.length, digest(raw), digest(broken))).rejects.toThrow();
    expect(runtime.initialize).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array([255]), new TextEncoder().encode("not JSON")])("refuses invalid UTF-8 or JSON after exact-byte verification", async invalid => {
    const compressed = gzipSync(invalid);
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    await expect(decodePackedJsonBytes(bytes(compressed), invalid.length, digest(invalid), digest(compressed))).rejects.toThrow();
  });

  it("uses the shared existing WASM initializer once when platform decompression is absent", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    const decode = () => decodePackedJsonBytes(bytes(packed), raw.length, digest(raw), digest(packed));
    const results = await Promise.all([decode(), decode(), decode()]);
    expect(results).toEqual(Array(3).fill(JSON.parse(new TextDecoder().decode(raw))));
    expect(runtime.initialize).toHaveBeenCalledOnce();
    expect(runtime.decode).toHaveBeenCalledTimes(3);
  });

  it("shares one pending initializer with semantic queries and decodes binary bytes without JSON coercion", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const { decodePackedAssetBytes } = await import("./packedJsonAsset");
    const { queryRegisteredSemanticIndex } = await import("./semanticIndex");
    const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 255]);
    const compressed = gzipSync(binary);
    const [decoded, query] = await Promise.all([
      decodePackedAssetBytes(bytes(compressed), binary.length, digest(binary), digest(compressed)),
      queryRegisteredSemanticIndex(new Uint8Array(), "query-registry"),
    ]);
    expect(decoded).toEqual(binary);
    expect(query).toEqual({ queryId: "query-registry", rows: [] });
    expect(runtime.initialize).toHaveBeenCalledOnce();
  });

  it("names the missing WASM gzip decoder instead of returning undecoded bytes", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const { setSemanticIndexForTesting } = await import("./semanticIndex");
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    // A semantic-index package built before the gzip export existed.
    setSemanticIndexForTesting({
      default: runtime.initialize,
      rebuild_semantic_index: vi.fn(),
      query_registered: vi.fn(),
      query_registered_view: vi.fn(),
    });
    await expect(decodePackedJsonBytes(bytes(packed), raw.length, digest(raw), digest(packed)))
      .rejects.toThrow("semantic index gzip decoder is unavailable");
    expect(runtime.decode).not.toHaveBeenCalled();
  });

  it("allows a failed initializer to retry, and still verifies fallback output", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    runtime.initialize.mockRejectedValueOnce(new Error("missing runtime asset"));
    const { decodePackedJsonBytes } = await import("./packedJsonAsset");
    const decode = () => decodePackedJsonBytes(bytes(packed), raw.length, digest(raw), digest(packed));
    await expect(decode()).rejects.toThrow("missing runtime asset");
    expect(await decode()).toEqual(JSON.parse(new TextDecoder().decode(raw)));
    expect(runtime.initialize).toHaveBeenCalledTimes(2);
    runtime.decode.mockReturnValueOnce(new Uint8Array(1));
    await expect(decode()).rejects.toThrow("decoded size mismatch");
  });

  it.each(["https://foreign.test/payload.json.gz", "data:application/gzip;base64,eA==", "file:///payload.json.gz"])("refuses a non-same-origin URL %s before fetching", async url => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { loadPackedJsonAsset } = await import("./packedJsonAsset");
    await expect(loadPackedJsonAsset(url, raw.length, digest(raw), digest(packed))).rejects.toThrow("same-origin");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the existing fetch cache and retries a missing asset without poisoning it", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValue(new Response(bytes(packed)));
    vi.stubGlobal("fetch", fetch);
    const { loadPackedJsonAsset } = await import("./packedJsonAsset");
    const load = () => loadPackedJsonAsset("./payload.json.gz", raw.length, digest(raw), digest(packed));
    await expect(load()).rejects.toThrow("failed to load bundled asset (404)");
    expect(await load()).toEqual(JSON.parse(new TextDecoder().decode(raw)));
    expect(await load()).toEqual(JSON.parse(new TextDecoder().decode(raw)));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("https://chronicle.test/app/payload.json.gz");
  });

  it("checks encoded transport size before decoding", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(bytes(packed)));
    vi.stubGlobal("fetch", fetch);
    const { loadPackedAssetBytes } = await import("./packedJsonAsset");
    for (const size of [0, -1, 1.5, 16 * 1024 * 1024 + 1]) {
      await expect(loadPackedAssetBytes("./runtime.wasm", raw.length, digest(raw), digest(packed), size)).rejects.toThrow("encoded size is invalid");
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(loadPackedAssetBytes("./runtime.wasm", raw.length, digest(raw), digest(packed), packed.length + 1)).rejects.toThrow("encoded size mismatch");
    expect(await loadPackedAssetBytes("./runtime.wasm", raw.length, digest(raw), digest(packed), packed.length)).toEqual(raw);
  });
});

import { fetchBundledAssetBytes } from "@/lib/bundledAssetLoader";
import { decompressBundledGzip } from "@/lib/semanticIndex";

const MAX_DECODED_JSON_BYTES = 16 * 1024 * 1024;
async function platformDecode(packed: ArrayBuffer, expectedBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") return decompressBundledGzip(new Uint8Array(packed), expectedBytes);
  const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes) {
        await reader.cancel();
        throw new Error("packed JSON decoded size mismatch");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (total !== expectedBytes) throw new Error("packed JSON decoded size mismatch");
  const decoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.byteLength; }
  return decoded;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode the exact source bytes before existing schema/registry validation. */
export async function decodePackedAssetBytes(
  packed: ArrayBuffer, expectedBytes: number, rawSha256: string, packedSha256: string,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_DECODED_JSON_BYTES
    || !/^[0-9a-f]{64}$/.test(rawSha256) || !/^[0-9a-f]{64}$/.test(packedSha256)) {
    throw new Error("packed JSON byte identity is invalid");
  }
  if (await sha256(packed) !== packedSha256) throw new Error("packed JSON compressed digest mismatch");
  const decoded = await platformDecode(packed, expectedBytes);
  if (decoded.byteLength !== expectedBytes) throw new Error("packed JSON decoded size mismatch");
  if (await sha256(new Uint8Array(decoded).buffer) !== rawSha256) throw new Error("packed JSON decoded digest mismatch");
  return decoded;
}

export async function decodePackedJsonBytes(
  packed: ArrayBuffer, expectedBytes: number, rawSha256: string, packedSha256: string,
): Promise<unknown> {
  const decoded = await decodePackedAssetBytes(packed, expectedBytes, rawSha256, packedSha256);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
}

/** Same-origin hashed build asset; top-level await keeps existing lookups synchronous. */
export async function loadPackedJsonAsset(
  url: string, expectedBytes: number, rawSha256: string, packedSha256: string,
): Promise<unknown> {
  const bytes = await loadPackedAssetBytes(url, expectedBytes, rawSha256, packedSha256);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export async function loadPackedAssetBytes(
  url: string, expectedBytes: number, rawSha256: string, packedSha256: string,
  expectedPackedBytes?: number,
): Promise<Uint8Array> {
  const resolved = new URL(url, location.href);
  if (resolved.origin !== location.origin || !["http:", "https:"].includes(resolved.protocol)) {
    throw new Error("packed JSON must be a same-origin bundled asset");
  }
  if (expectedPackedBytes !== undefined && (!Number.isSafeInteger(expectedPackedBytes)
    || expectedPackedBytes <= 0 || expectedPackedBytes > MAX_DECODED_JSON_BYTES)) throw new Error("packed asset encoded size is invalid");
  const packed = await fetchBundledAssetBytes(resolved.href);
  if (expectedPackedBytes !== undefined && packed.byteLength !== expectedPackedBytes) throw new Error("packed asset encoded size mismatch");
  return decodePackedAssetBytes(packed, expectedBytes, rawSha256, packedSha256);
}

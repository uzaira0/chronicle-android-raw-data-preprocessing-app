/**
 * RFC4122 v4 UUID with a fallback for non-secure contexts.
 *
 * `crypto.randomUUID` is only defined in secure contexts (https / localhost) and
 * throws in plain-http pages and some older WebViews. Prefer it when available,
 * otherwise build a v4 UUID from `crypto.getRandomValues`, which is far more
 * broadly available. Both read from `globalThis.crypto` (also a global in Node).
 */
export function safeUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

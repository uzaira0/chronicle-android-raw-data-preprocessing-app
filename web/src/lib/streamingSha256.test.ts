import { describe, expect, it } from "vitest";

import { StreamingSha256 } from "@/lib/streamingSha256";

async function subtleDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("StreamingSha256", () => {
  it("matches crypto.subtle for every padding case and any split into pieces", async () => {
    let seed = 7;
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70_001]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (seed = (seed * 1_103_515_245 + 12_345) >>> 0) >>> 24;
      const expected = await subtleDigest(bytes);
      expect(new StreamingSha256().update(bytes).digest()).toBe(expected);
      const pieces = new StreamingSha256();
      for (let at = 0, step = 1; at < length; at += step, step = (step * 7 + 3) % 97 || 1) {
        pieces.update(bytes.subarray(at, Math.min(length, at + step)));
      }
      expect(pieces.digest()).toBe(expected);
    }
  });
});

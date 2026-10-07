import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { queryPersistedRustReview } from "@/lib/rustPipelineRuntime";

const DIGEST = "a".repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A browser that cannot persist (no OPFS, and therefore no reason to hold the
 * workspace lock) still runs A/B comparisons: the caller falls back to
 * transferring the raw bytes. `queryPersistedRustReview` was the one persisted
 * entry point that forced `persistRustWorkspace: true` and took
 * `withWorkspaceLock` unconditionally, so in that context it threw "Durable
 * workspace mutation requires the browser Web Locks API" — not a
 * `PersistedReviewMiss`, so it propagated and every comparison failed while
 * the ephemeral banner said the run still works.
 */
describe("persisted review query in an ephemeral context", () => {
  it("reports a miss instead of demanding the workspace lock", async () => {
    // No `locks` — exactly the shape a private-browsing / OPFS-less context
    // presents. Reaching the lock at all would throw here.
    vi.stubGlobal("navigator", {});
    await expect(
      queryPersistedRustReview(
        1024,
        "Raw P01.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: false },
        DIGEST,
      ),
    ).resolves.toBeNull();
  });

  it("still validates its bound inputs before deciding anything", async () => {
    vi.stubGlobal("navigator", {});
    await expect(
      queryPersistedRustReview(
        -1,
        "Raw P01.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: false },
        DIGEST,
      ),
    ).rejects.toThrow("non-negative safe integer");
    await expect(
      queryPersistedRustReview(
        1024,
        "Raw P01.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: false },
        "NOTAHEXDIGEST",
      ),
    ).rejects.toThrow("64 lowercase hexadecimal characters");
  });

  it("does not take the ephemeral shortcut when persistence is on", async () => {
    // The durable path must keep its fail-closed lock requirement: with the
    // Web Locks API absent it refuses rather than silently reporting a miss.
    vi.stubGlobal("navigator", {});
    await expect(
      queryPersistedRustReview(
        1024,
        "Raw P01.csv",
        DEFAULT_BROWSER_OPTIONS,
        undefined,
        { persistRustWorkspace: true },
        DIGEST,
      ),
    ).rejects.toThrow(/Web Locks API/);
  });
});

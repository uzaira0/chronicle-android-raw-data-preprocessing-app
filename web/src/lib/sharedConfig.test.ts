import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildShareableConfigUrl,
  decodeOptionsFromParam,
  diffOptionsFromDefaults,
  encodeOptionsToParam,
  readSharedConfig,
  sanitizeOptions,
  SHARED_CONFIG_PARAM,
} from "@/lib/settingsPersistence";
import { CANONICAL_INTERACTION_TYPES } from "@/lib/interactionTypes";

describe("shareable config URL (#23)", () => {
  it("diff contains only keys that differ from defaults", () => {
    const options = { ...DEFAULT_BROWSER_OPTIONS, studyName: "MyStudy", processScreenUsage: false };
    const diff = diffOptionsFromDefaults(options) as Record<string, unknown>;
    expect(diff.studyName).toBe("MyStudy");
    // processScreenUsage default is true, so flipping it to false should appear.
    expect(diff.processScreenUsage).toBe(false);
    // An unchanged key must not be in the diff.
    expect(diff).not.toHaveProperty("processAppUsage");
  });

  it("defaults produce an empty diff (shortest possible link)", () => {
    expect(diffOptionsFromDefaults({ ...DEFAULT_BROWSER_OPTIONS })).toEqual({});
  });

  it("encode → decode round-trips to the sanitized options", () => {
    const options = { ...DEFAULT_BROWSER_OPTIONS, studyName: "RoundTrip", minimumUsageDuration: 7 };
    const decoded = decodeOptionsFromParam(encodeOptionsToParam(options));
    expect(decoded).toEqual(options);
  });

  it("buildShareableConfigUrl embeds the param and readSharedConfig recovers it", () => {
    const options = { ...DEFAULT_BROWSER_OPTIONS, studyName: "ViaUrl" };
    const url = buildShareableConfigUrl(options, "https://example.com/app/");
    const parsed = new URL(url);
    expect(parsed.searchParams.has(SHARED_CONFIG_PARAM)).toBe(true);
    expect(readSharedConfig(parsed.search)).toEqual(options);
  });

  it("re-sharing replaces an existing config param rather than appending", () => {
    const first = buildShareableConfigUrl(
      { ...DEFAULT_BROWSER_OPTIONS, studyName: "A" },
      "https://example.com/?config=stale&keep=1",
    );
    const url = new URL(first);
    // Only one config param, and the unrelated query param is preserved.
    expect(url.searchParams.getAll(SHARED_CONFIG_PARAM)).toHaveLength(1);
    expect(url.searchParams.get("keep")).toBe("1");
    expect(readSharedConfig(url.search)?.studyName).toBe("A");
  });

  it("returns null for an absent or malformed param", () => {
    expect(readSharedConfig("")).toBeNull();
    expect(readSharedConfig("?other=1")).toBeNull();
    expect(decodeOptionsFromParam("{not json")).toBeNull();
    expect(decodeOptionsFromParam(null)).toBeNull();
  });
});

describe("sanitizeOptions interactionTypeRemap validation (FU3)", () => {
  it("drops entries whose target is not a canonical interaction type", () => {
    expect(
      sanitizeOptions({ interactionTypeRemap: ["Move to Foreground => BogusType"] })
        .interactionTypeRemap,
    ).toEqual([]);
  });

  it("keeps a canonical target with a free-form (non-canonical) source", () => {
    const entry = "VENDOR_WEIRD_EVENT => Activity Resumed";
    expect(sanitizeOptions({ interactionTypeRemap: [entry] }).interactionTypeRemap).toEqual([entry]);
  });

  it("filters a mixed list to only canonical-target entries", () => {
    const ok = "VENDOR_X => Activity Paused";
    expect(
      sanitizeOptions({ interactionTypeRemap: ["A => BogusType", ok, "B => NotReal"] })
        .interactionTypeRemap,
    ).toEqual([ok]);
  });

  it("keeps inert in-progress rows (no delimiter / empty side)", () => {
    const rows = ["Move to Foreground", "=>Activity Resumed", "foo =>"];
    expect(sanitizeOptions({ interactionTypeRemap: rows }).interactionTypeRemap).toEqual(rows);
  });

  it("accepts every canonical type as a remap target", () => {
    const entries = CANONICAL_INTERACTION_TYPES.map((t) => `SRC => ${t}`);
    expect(sanitizeOptions({ interactionTypeRemap: entries }).interactionTypeRemap).toEqual(entries);
  });

  it("closes the untrusted share-link vector on decode", () => {
    // Hand-built param (not the encoder, which sanitizes on its own path) models
    // an attacker-crafted link.
    const param = JSON.stringify({ interactionTypeRemap: ["VENDOR => BogusType"] });
    expect(decodeOptionsFromParam(param)?.interactionTypeRemap).toEqual([]);
  });
});

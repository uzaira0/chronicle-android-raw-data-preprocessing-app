import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildShareableConfigUrl,
  decodeOptionsFromParam,
  diffOptionsFromDefaults,
  encodeOptionsToParam,
  readSharedConfig,
  SHARED_CONFIG_PARAM,
} from "@/lib/settingsPersistence";

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

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserProcessingOptions } from "@/lib/types";

describe("browser support-file boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("loads only enabled bundled defaults, preserves uploads, and reuses successful fetches", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(new TextEncoder().encode(`bytes:${url}`), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const contract = await import("@/lib/processingUiContract");
    const uploadedFilter = {
      name: "uploaded-filter.csv",
      bytes: new TextEncoder().encode("uploaded").buffer,
    };
    const studyDatesFile = {
      name: "study-dates.csv",
      bytes: new ArrayBuffer(0),
    };
    const deviceSharingFile = {
      name: "sharing.csv",
      bytes: new ArrayBuffer(0),
    };
    const surveyAttributionFile = {
      name: "survey.csv",
      bytes: new ArrayBuffer(0),
    };
    const enrolledDevicesFile = {
      name: "devices.csv",
      bytes: new ArrayBuffer(0),
    };
    const options: BrowserProcessingOptions = {
      ...contract.DEFAULT_BROWSER_OPTIONS,
      useFilterFile: true,
      useAppsForcingScreenOpenFile: true,
      useBackgroundAppsFile: false,
      useAppCodebook: true,
    };
    const uploads = {
      filterFile: uploadedFilter,
      studyDatesFile,
      deviceSharingFile,
      surveyAttributionFile,
      enrolledDevicesFile,
    };

    const first = await contract.resolveDefaultSupportFiles(options, uploads);
    const second = await contract.resolveDefaultSupportFiles(options, uploads);

    expect(contract.PREPROCESSOR_VERSION).toBe("1.0.0");
    expect(contract.TIMEZONE_HANDLING_OPTIONS).toHaveLength(4);
    expect(contract.SAME_APP_INTERACTION_TYPE_OPTIONS).toHaveLength(4);
    expect(contract.OTHER_INTERACTION_TYPE_OPTIONS.length).toBeGreaterThan(4);
    expect(contract.INTERACTION_TYPES_TO_REMOVE_OPTIONS).toContain("End of Usage Missing");
    expect(first.filterFile).toBe(uploadedFilter);
    expect(first.backgroundAppsFile).toBeUndefined();
    expect(first.studyDatesFile).toBe(studyDatesFile);
    expect(first.deviceSharingFile).toBe(deviceSharingFile);
    expect(first.surveyAttributionFile).toBe(surveyAttributionFile);
    expect(first.enrolledDevicesFile).toBe(enrolledDevicesFile);
    expect(first.appsForcingScreenOpenFile?.name).toMatch(/screen_open.*\.csv$/);
    expect(first.appCodebookFile?.name).toMatch(/codebook.*\.csv$/);
    expect(second.appsForcingScreenOpenFile?.bytes).toBe(
      first.appsForcingScreenOpenFile?.bytes,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("evicts a failed bundled fetch so a later attempt can recover", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 503 }))
      .mockResolvedValueOnce(new Response("package_name\ncom.example", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const contract = await import("@/lib/processingUiContract");
    const options = {
      ...contract.DEFAULT_BROWSER_OPTIONS,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: true,
      useAppCodebook: false,
    };

    await expect(contract.resolveDefaultSupportFiles(options)).rejects.toThrow(
      /failed to load bundled asset \(503\)/,
    );
    const recovered = await contract.resolveDefaultSupportFiles(options);
    expect(recovered.backgroundAppsFile?.name).toMatch(/background_apps.*\.csv$/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty support set when every optional source is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const contract = await import("@/lib/processingUiContract");
    const options = {
      ...contract.DEFAULT_BROWSER_OPTIONS,
      useFilterFile: false,
      useAppsForcingScreenOpenFile: false,
      useBackgroundAppsFile: false,
      useAppCodebook: false,
    };
    await expect(contract.resolveDefaultSupportFiles(options)).resolves.toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
});

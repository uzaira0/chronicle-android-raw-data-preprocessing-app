import { readFileSync } from "node:fs";

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { BROAD_CATEGORY_ALIASES, deriveBroadAppCategory } from "@/lib/browserPipeline";
import { CATEGORY_COLORS } from "@/lib/plotGenerator";

// The 12 assignable palette categories (every CATEGORY_COLORS key except the
// "Unknown" sentinel, which means "no category data at all").
const PALETTE = new Set(Object.keys(CATEGORY_COLORS).filter((k) => k !== "Unknown"));

describe("deriveBroadAppCategory", () => {
  it("maps babyemu UPPERCASE enum values to palette categories", () => {
    expect(deriveBroadAppCategory(["GAMING"])).toBe("Games");
    expect(deriveBroadAppCategory(["SOCIAL"])).toBe("Social & Communication");
    expect(deriveBroadAppCategory(["COMMUNICATION"])).toBe("Social & Communication");
    expect(deriveBroadAppCategory(["VIDEO"])).toBe("Video Players (e.g. YouTube)");
    expect(deriveBroadAppCategory(["LIFESTYLE_MANAGEMENT"])).toBe("Lifestyle");
    expect(deriveBroadAppCategory(["PRODUCTIVITY_AND_BUSINESS"])).toBe("Productivity & Business");
    expect(deriveBroadAppCategory(["ARTS_AND_LEISURE"])).toBe("Entertainment");
    expect(deriveBroadAppCategory(["UTILITIES"])).toBe("Productivity & Business");
    expect(deriveBroadAppCategory(["KNOWLEDGE_AND_INFORMATION"])).toBe("Education");
  });

  it("maps non-app vocabularies to Uncategorised", () => {
    expect(deriveBroadAppCategory(["System/OEM"])).toBe("Uncategorised");
    expect(deriveBroadAppCategory(["Other"])).toBe("Uncategorised");
  });

  it("passes palette categories through unchanged", () => {
    expect(deriveBroadAppCategory(["Games"])).toBe("Games");
    expect(deriveBroadAppCategory(["Social & Communication"])).toBe("Social & Communication");
  });

  it("prefers a specific category over an Uncategorised-mapping candidate", () => {
    // usc 'Other' would map to Uncategorised, but babyemu 'GAMING' is specific.
    expect(deriveBroadAppCategory(["Other", "GAMING"])).toBe("Games");
    expect(deriveBroadAppCategory(["", "  ", "VIDEO"])).toBe("Video Players (e.g. YouTube)");
  });

  it("prefers an earlier clean column over a later one (desktop coalesce order)", () => {
    // play_store 'Education' wins even though babyemu would map GAMING->Games.
    expect(deriveBroadAppCategory(["Education", null, "GAMING", "Games"])).toBe("Education");
  });

  it("returns Unknown only when no source provides any category", () => {
    expect(deriveBroadAppCategory([])).toBe("Unknown");
    expect(deriveBroadAppCategory([null, undefined, ""])).toBe("Unknown");
  });
});

describe("BROAD_CATEGORY_ALIASES invariant", () => {
  it("every alias target is a real palette category (no relabelling one gray as another)", () => {
    for (const target of Object.values(BROAD_CATEGORY_ALIASES)) {
      expect(PALETTE.has(target)).toBe(true);
    }
  });
});

describe("real codebook coverage (reproduction)", () => {
  it("assigns a specific palette colour to the majority of categorised apps", () => {
    const csv = readFileSync(
      new URL("../assets/defaults/unified_app_codebook.csv", import.meta.url),
      "utf-8",
    );
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    });
    const rows = parsed.data;

    let withAnyCategory = 0;
    let specificallyColoured = 0;
    for (const row of rows) {
      // The bundled unified codebook ships per-source columns only; the old
      // single broad_app_category column is deprecated and not present.
      const sources = [
        row.play_store_broad_app_category,
        row.usc_broad_app_category,
        row.babyemu_broad_app_category,
        row.bcm_cnrc_heuristic_category,
      ];
      const hasAny = sources.some((c) => c && c.trim());
      if (!hasAny) continue;
      withAnyCategory += 1;
      const category = deriveBroadAppCategory(sources);
      if (PALETTE.has(category) && category !== "Uncategorised") {
        specificallyColoured += 1;
      }
    }

    expect(withAnyCategory).toBeGreaterThan(1000);
    // A raw coalesce colours only ~44% (babyemu UPPERCASE enums match no palette
    // key). Normalising babyemu onto the palette must lift this well past half.
    const fraction = specificallyColoured / withAnyCategory;
    expect(fraction).toBeGreaterThan(0.7);
  });
});

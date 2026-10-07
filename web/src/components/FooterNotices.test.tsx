import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  FooterNotices,
  GITHUB_PRIVACY_STATEMENT_URL,
  LICENSE_URL,
  SOURCE_REPOSITORY_URL,
  UPSTREAM_REPOSITORY_URL,
  buildSourceUrl,
  thirdPartyNoticesUrl,
} from "@/components/FooterNotices";

function render(buildSha = "0ef0e870", baseUrl = "/chronicle/"): string {
  return renderToStaticMarkup(
    createElement(FooterNotices, {
      buildSha,
      baseUrl,
      deleteDisabled: false,
      onDeleteAllLocalData: vi.fn(),
    }),
  );
}

describe("FooterNotices", () => {
  it("states local processing, the host's IP logging, and where data is stored", () => {
    const html = render();
    expect(html).toContain("processed on this device, inside this");
    expect(html).toContain("nothing you load or produce is uploaded");
    expect(html).toContain("GitHub Pages: GitHub, Inc. receives each visitor’s IP");
    expect(html).toContain(GITHUB_PRIVACY_STATEMENT_URL);
    expect(html).toContain(
      "origin-private file storage, IndexedDB and localStorage) until",
    );
    expect(html).toContain('data-testid="delete-all-local-data"');
  });

  it("carries the research-use, no-warranty and non-affiliation statements", () => {
    const html = render();
    expect(html).toContain("For research use only");
    expect(html).toContain("without warranty of any kind");
    expect(html).toContain("ABSOLUTELY NO WARRANTY");
    expect(html).toContain("Not affiliated with, or endorsed by, Methodic or Chronicle.");
  });

  it("links the GPL license, the source, the upstream work and the third-party notices", () => {
    const html = render();
    expect(html).toContain("GNU General Public License");
    expect(html).toContain(`href="${LICENSE_URL}"`);
    expect(html).toContain(`href="${SOURCE_REPOSITORY_URL}"`);
    expect(html).toContain(`href="${SOURCE_REPOSITORY_URL}/tree/0ef0e870"`);
    expect(html).toContain(`href="${UPSTREAM_REPOSITORY_URL}"`);
    expect(html).toContain('href="/chronicle/THIRD-PARTY-NOTICES.txt"');
  });

  it("omits the per-build source link when the build stamped no real commit", () => {
    expect(buildSourceUrl("dev")).toBeNull();
    expect(render("dev")).not.toContain("/tree/");
    expect(thirdPartyNoticesUrl("/base")).toBe("/base/THIRD-PARTY-NOTICES.txt");
  });
});

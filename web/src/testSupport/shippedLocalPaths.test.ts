import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Everything under these roots can reach a user's browser: the HTML entry
// point, application source and its generated registries/evidence (src),
// static files (public), and the schemas packed into the build (schema). Tests
// and their support code never ship, so they may carry machine-shaped example
// paths as inputs.
const webRoot = resolve(import.meta.dirname, "../..");
const shippedRoots = ["index.html", "src", "public", "schema"];
const notShipped = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.startsWith("src/testSupport/");

// A developer home directory, plain or percent-encoded (audit locators carry
// URL-encoded paths), or the private literature corpus reached through any
// absolute prefix. The repository-relative ".tmp-literature-review-private/…"
// locator form is allowed: it names a corpus file without naming a machine.
const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  // "\/" covers JSON-escaped slashes.
  /(?<![\w.%-])\\?\/(?:Users|root|Volumes)\\?\//,
  /(?<![\w.%-])\\?\/home\\?\/[^/\\\s"'`]+\\?\//,
  /\b[A-Za-z]:\\{1,2}Users\\{1,2}/,
  /%2F(?:Users|home)(?:%2F|\/)/i,
  /(?<![\w.-])\/(?:[^\s"'`/]+\/)*\.tmp-literature-review-private\b/,
  /%2F\.tmp-literature-review-private\b/i,
];

function localPathLeaks(text: string): string[] {
  return LOCAL_PATH_PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [text.slice(Math.max(0, match.index - 40), match.index + 80)] : [];
  });
}

// Tracked files plus new files not yet added; ignored build/cache output
// (for example a local __pycache__ under schema/generated) never ships.
function shippedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...shippedRoots],
    { cwd: webRoot, encoding: "utf8" }).split("\0").filter(Boolean);
}

describe("shipped web files carry no local machine paths", () => {
  it("detects home directories and absolute corpus paths but allows repository-relative locators", () => {
    expect(localPathLeaks(".tmp-literature-review-private/corrective-packet-08/fulltext/rank288.txt:357-364")).toEqual([]);
    expect(localPathLeaks("x.pdf#audit-locator=.tmp-literature-review-private%2Fwork%2Fa.txt%3A1-2")).toEqual([]);
    expect(localPathLeaks("https://example.org/home/page/ and https://example.org/Users/list")).toEqual([]);
    expect(localPathLeaks("../../.tmp-literature-review-private/ontology/library.json")).toEqual([]);
    for (const leak of [
      "/Users/u/chronicle-android-raw-data-preprocessing-app/web/src/lib/x.ts",
      "{\"path\":\"\\/Users\\/u\\/repo\\/a.txt\"}",
      "\"/home/researcher/checkout/notes.txt\"",
      "/root/checkout/a.txt",
      "/Volumes/External/checkout/a.txt",
      "C:\\\\Users\\\\someone\\\\a.txt",
      "file:///Users/someone/a.txt",
      "locator=%2FUsers%2Fu%2Frepo%2Fa.txt",
      "locator=%2FUsers/u/repo/a.txt",
      "/srv/checkout/.tmp-literature-review-private/text/59.txt",
      "/.tmp-literature-review-private/text/59.txt",
      "audit-locator=%2Fsrv%2Fcheckout%2F.tmp-literature-review-private%2Fa.txt",
    ]) {
      expect(localPathLeaks(leak), leak).not.toEqual([]);
    }
  });

  it("finds none in application source, generated registries, evidence, public files or packed schemas", () => {
    const leaks: Record<string, string[]> = {};
    let scanned = 0;
    for (const name of shippedFiles()) {
      // A deleted-but-still-tracked path is not shipped either.
      if (notShipped(name) || !existsSync(join(webRoot, name))) continue;
      scanned += 1;
      // latin1 maps every byte to one character, so binary assets (WASM,
      // images) are scanned byte-for-byte without decoding errors.
      const found = localPathLeaks(readFileSync(join(webRoot, name), "latin1"));
      if (found.length) leaks[name] = found;
    }
    expect(scanned).toBeGreaterThan(100);
    expect(leaks).toEqual({});
  });
});

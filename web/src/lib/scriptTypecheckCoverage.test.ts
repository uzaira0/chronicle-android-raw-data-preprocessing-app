import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Guards script typecheck coverage along the two axes the bench_plotting
// `generateAllPlots` arity bug exposed:
//
//   1. WIRING (F1's actual mechanism): the side configs only run if
//      `package.json`'s `typecheck` script explicitly `-p`-invokes them. Plain
//      `tsc --noEmit` ignores `references`, so before the fix the scripts were in
//      tsconfig.node.json's include yet checked by NOTHING — F1 shipped. Reverting
//      `typecheck` to bare `tsc --noEmit` must fail a test, not pass silently.
//   2. EXTENSION (the sibling hole): web/scripts/ is covered ONLY by the side
//      configs — tsconfig.node.json (scripts/**/*.mts) and tsconfig.mjs.json
//      (scripts/**/*.mjs); the root tsconfig includes just src/ and e2e/. A script
//      with any other extension (.ts/.js/.cts/.cjs) slips through every config.
//
// If you add a script with a new extension, extend the relevant tsconfig include;
// if you change how typecheck is invoked, keep all configs wired. These tests fail
// loudly until you do.

// This test lives in web/src/lib/ (alongside the other unit tests) because
// .gitignore's blanket `*test*` rule only un-ignores web/src/lib/** — a test file
// placed elsewhere under src/ would be silently untracked.
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Parse a (comment-free) tsconfig and return its `include` globs. */
function includesOf(tsconfigName: string): string[] {
  const parsed = JSON.parse(readFileSync(join(webRoot, tsconfigName), "utf-8")) as {
    include?: string[];
  };
  return parsed.include ?? [];
}

/** Extensions a set of include globs grant to files under scripts/. */
function scriptExtensionsFrom(globs: string[]): string[] {
  return globs
    .filter((glob) => glob.startsWith("scripts/"))
    .map((glob) => extname(glob)) // "scripts/**/*.mts" -> ".mts"
    .filter((ext) => ext.length > 1);
}

/** Every file under a directory, recursively. */
function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("script typecheck coverage", () => {
  const coveredExtensions = new Set([
    ...scriptExtensionsFrom(includesOf("tsconfig.node.json")),
    ...scriptExtensionsFrom(includesOf("tsconfig.mjs.json")),
  ]);

  it("package.json's typecheck script invokes every script config (F1's gap)", () => {
    // F1 shipped because `tsc --noEmit` silently ignores project `references`; the
    // side configs only run when explicitly passed with `-p`. This is the assertion
    // that actually fails if someone reverts to bare `tsc --noEmit`.
    const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const typecheck = pkg.scripts?.typecheck ?? "";
    expect(typecheck).toContain("-p tsconfig.node.json");
    expect(typecheck).toContain("-p tsconfig.mjs.json");
  });

  it("the side configs grant both .mts and .mjs coverage to scripts/", () => {
    // Regression guard: a config dropping/renaming its scripts glob would silently
    // stop typechecking that whole extension.
    expect(coveredExtensions.has(".mts")).toBe(true);
    expect(coveredExtensions.has(".mjs")).toBe(true);
  });

  it("the root tsconfig does NOT cover scripts/ (that is the side configs' job)", () => {
    // If scripts/ ever reappears in the root include, it would be double-checked
    // and the side-config split would be silently pointless.
    expect(scriptExtensionsFrom(includesOf("tsconfig.json"))).toEqual([]);
  });

  it("every file under web/scripts/ is matched by a typecheck config", () => {
    const uncovered = listFiles(join(webRoot, "scripts"))
      .filter((file) => !coveredExtensions.has(extname(file)))
      .map((file) => file.slice(webRoot.length + 1));
    expect(
      uncovered,
      "These scripts are typechecked by NO tsconfig (the bench_plotting bug class). " +
        "Add their extension to a tsconfig include: " +
        uncovered.join(", "),
    ).toEqual([]);
  });
});

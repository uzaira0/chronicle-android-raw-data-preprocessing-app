// Emits THIRD-PARTY-NOTICES.txt at the root of the Vite build output, so every
// deploy serves it at <site URL>/THIRD-PARTY-NOTICES.txt. It concatenates:
//
//   1. npm packages bundled into the JavaScript of the main build AND of the
//      module-worker sub-builds, collected by rollup-plugin-license (license
//      and NOTICE texts read from each package);
//   2. Rust crates linked into the WebAssembly packages, from the committed
//      web/third-party/rust-wasm-crates.txt (written by rust_wasm_notices.mjs,
//      because the deploy runner cannot resolve the Rust dependency graph);
//   3. code ported from other projects, web/third-party/ported-code.txt.
//
// Vite builds each module worker as a separate Rollup build before the main
// bundle is written, so one shared collector receives both and the main
// build's generateBundle emits the combined file.
import { readFileSync } from "node:fs";
import path from "node:path";
import license from "rollup-plugin-license";
import type { Plugin } from "vite";

export const THIRD_PARTY_NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";

type Dependency = {
  readonly name: string | null;
  readonly version: string | null;
  readonly license: string | null;
  readonly licenseText: string | null;
  readonly noticeText: string | null;
  readonly repository: string | { url: string } | null;
  readonly homepage: string | null;
};

// This repository's own WASM packages (src/wasm/*/pkg/package.json) are the
// GPL-3.0-only application itself, not third-party code.
const isOwnPackage = (name: string): boolean => name.startsWith("chronicle_");

function repositoryUrl(dependency: Dependency): string {
  const { repository } = dependency;
  if (typeof repository === "string") return repository;
  return repository?.url ?? dependency.homepage ?? "";
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

export function thirdPartyNoticesPlugins(webRoot: string): {
  main: Plugin[];
  worker: () => Plugin;
} {
  const collected = new Map<string, Dependency>();
  const collector = () =>
    license({
      thirdParty: {
        includePrivate: false,
        multipleVersions: true,
        output: (dependencies) => {
          for (const dependency of dependencies) {
            if (!dependency.name || isOwnPackage(dependency.name)) continue;
            collected.set(`${dependency.name}@${dependency.version ?? ""}`, dependency);
          }
        },
      },
    }) as Plugin;

  const emitter: Plugin = {
    name: "chronicle-third-party-notices",
    apply: "build",
    generateBundle() {
      const dependencies = [...collected.values()].sort(
        (left, right) =>
          left.name!.localeCompare(right.name!) ||
          (left.version ?? "").localeCompare(right.version ?? ""),
      );
      const unlicensed = dependencies.filter((dependency) => !dependency.license);
      if (unlicensed.length > 0) {
        throw new Error(
          `bundled npm packages declare no license: ${unlicensed.map((dependency) => dependency.name).join(", ")}`,
        );
      }
      const rule = "=".repeat(78);
      const npmSection = dependencies.flatMap((dependency) => [
        `--- ${dependency.name} ${dependency.version ?? ""}  [${dependency.license}]  ${repositoryUrl(dependency)}`.trimEnd(),
        "",
        dependency.licenseText
          ? normalize(dependency.licenseText)
          : `(The package ships no license file. It is licensed under ${dependency.license}.)`,
        ...(dependency.noticeText ? ["", "NOTICE:", "", normalize(dependency.noticeText)] : []),
        "",
      ]);
      const read = (file: string) =>
        normalize(readFileSync(path.join(webRoot, "third-party", file), "utf8"));
      const source = [
        "THIRD-PARTY NOTICES",
        "Chronicle Android Raw Data Preprocessor",
        "",
        "This application is licensed under the GNU General Public License,",
        "version 3 only (GPL-3.0-only). Its source code is published at",
        "https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app",
        "",
        "It includes the third-party software listed below, each under its own",
        "license, reproduced here with any NOTICE file the software carries.",
        "",
        "  1. npm packages bundled into the JavaScript",
        "  2. Rust crates linked into the WebAssembly packages",
        "  3. Code and material ported from other projects",
        "",
        rule,
        `1. npm packages bundled into the JavaScript (${dependencies.length})`,
        rule,
        "",
        ...npmSection,
        rule,
        "2. Rust crates linked into the WebAssembly packages",
        rule,
        "",
        read("rust-wasm-crates.txt"),
        "",
        rule,
        "3. Code and material ported from other projects",
        rule,
        "",
        read("ported-code.txt"),
        "",
      ].join("\n");
      this.emitFile({ type: "asset", fileName: THIRD_PARTY_NOTICES_FILE, source });
    },
  };

  return {
    main: [collector(), emitter],
    worker: collector,
  };
}

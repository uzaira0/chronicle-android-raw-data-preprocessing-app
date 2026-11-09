import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { execFileSync } from "./fileStdin";

const childReport = [
  "const fs = require('node:fs');",
  "const stat = fs.fstatSync(0);",
  "process.stdout.write(JSON.stringify({ file: stat.isFile(), fifo: stat.isFIFO(), socket: stat.isSocket(), body: fs.readFileSync(0, 'utf8') }));",
].join("\n");

const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("chronicle-stdin-"));

describe("execFileSync with file-backed stdin", () => {
  it("hands input to the child as a regular file, not a pipe or socket, and removes it", () => {
    const before = leftovers();
    const input = JSON.stringify({ rows: Array.from({ length: 20_000 }, (_, id) => ({ id })) });
    const report = JSON.parse(execFileSync(process.execPath, ["-e", childReport], { input, encoding: "utf8", timeout: 30_000 })) as unknown;
    expect(report).toEqual({ file: true, fifo: false, socket: false, body: input });
    expect(leftovers()).toEqual(before);
  });

  it("passes calls without input straight through", () => {
    expect(execFileSync(process.execPath, ["-e", "process.stdout.write('plain')"], { encoding: "utf8" })).toBe("plain");
  });

  it("is the only execFileSync a test uses to feed a child stdin", () => {
    const root = join(import.meta.dirname, "..");
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.test\.tsx?$/.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          if (/import\s*\{[^}]*\bexecFileSync\b[^}]*\}\s*from\s*"node:child_process"/.test(text) && /\binput\s*:/.test(text)
            && /execFileSync\([^;]*?\binput\s*:/s.test(text)) offenders.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

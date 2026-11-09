import { execFileSync as nodeExecFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type FileStdinOptions = {
  input?: string;
  encoding: "utf8";
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * `execFileSync` for tests that hand a child process JSON on stdin.
 *
 * Node's own `input` option writes the bytes into a pipe from inside the
 * synchronous call. On macOS that write intermittently never completes: the
 * child sits in read(0) on a socket whose only other end is the test worker,
 * and the call dies on its timeout (ETIMEDOUT at 180 s in the coverage gate).
 * Measured 2026-11-09 with Node 22.23 and 32 concurrent workers each running a
 * one-line `json.load(sys.stdin)`: 2 of 3,840 pipe calls hung; 0 of 2,560
 * calls hung when stdin was a file. So `input` is written to a private
 * temporary file and that file is the child's stdin; stdout and stderr stay
 * pipes and the result is the same string `execFileSync` returns.
 */
export function execFileSync(file: string, args: readonly string[], options: FileStdinOptions): string {
  const { input, ...rest } = options;
  if (input === undefined) return nodeExecFileSync(file, args, rest);
  const directory = mkdtempSync(join(tmpdir(), "chronicle-stdin-"));
  try {
    const path = join(directory, "stdin");
    writeFileSync(path, input, { mode: 0o600 });
    const descriptor = openSync(path, "r");
    try {
      return nodeExecFileSync(file, args, { ...rest, stdio: [descriptor, "pipe", "pipe"] });
    } finally {
      closeSync(descriptor);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

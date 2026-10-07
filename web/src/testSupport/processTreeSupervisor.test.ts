import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { snapshotGeneratedPaths } from "../../scripts/generated_path_transaction.mjs";
import {
  createProcessTreeSupervisor,
  ProcessSignalError,
  signalExitCode,
  stopWriterTreesThenRestore,
} from "../../scripts/process_tree_supervisor.mjs";

const temporaryRoots: string[] = [];
const supervisors: ReturnType<typeof createProcessTreeSupervisor>[] = [];
const removeSignalHandlers: Array<() => void> = [];

function createTemporaryRoot() {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "chronicle-process-tree-supervisor-"),
  );
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}

function createSupervisor() {
  const supervisor = createProcessTreeSupervisor({
    terminationGraceMs: 30,
    forceKillWaitMs: 1_000,
    treeDrainWaitMs: 1_000,
    pollIntervalMs: 5,
  });
  supervisors.push(supervisor);
  return supervisor;
}

async function waitForFile(filePath: string) {
  const deadline = Date.now() + 2_000;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for child marker ${filePath}`);
    }
    await delay(10);
  }
}

// A writer that survives the supervisor's stop damages its target this long
// after reporting ready. It has to exceed the stop latency on a loaded host:
// at 250 ms, a load average near 30 let the write land before the kill did.
const LATE_WRITE_MS = 2_000;

function delayedWriterSource(
  targetPath: string,
  readyPath: string,
  contents: string,
) {
  return `
    import { writeFileSync } from "node:fs";
    process.on("SIGINT", () => {});
    process.on("SIGTERM", () => {});
    writeFileSync(${JSON.stringify(readyPath)}, "ready");
    setTimeout(
      () => writeFileSync(${JSON.stringify(targetPath)}, ${JSON.stringify(contents)}),
      ${LATE_WRITE_MS},
    );
    setInterval(() => {}, 1_000);
  `;
}

afterEach(async () => {
  for (const removeHandlers of removeSignalHandlers.splice(0)) {
    removeHandlers();
  }
  await Promise.allSettled(
    supervisors
      .splice(0)
      .map((supervisor) =>
        supervisor.stopAndWait(new Error("process supervisor test cleanup")),
      ),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) =>
        rm(temporaryRoot, { recursive: true, force: true }),
      ),
  );
});

describe("dependency evidence process-tree supervisor", () => {
  it("kills and awaits a delayed descendant before restoring a snapshot on SIGTERM", async () => {
    const temporaryRoot = createTemporaryRoot();
    const repositoryRoot = path.join(temporaryRoot, "repo");
    const targetPath = path.join(repositoryRoot, "generated/evidence.txt");
    const descendantReadyPath = path.join(temporaryRoot, "descendant-ready");
    const backupRoot = path.join(temporaryRoot, "backup");
    await rm(repositoryRoot, { recursive: true, force: true });
    await mkdir(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, "before");
    const transaction = snapshotGeneratedPaths({
      repositoryRoot,
      backupRoot,
      relativePaths: ["generated/evidence.txt"],
    });

    const descendantSource = delayedWriterSource(
      targetPath,
      descendantReadyPath,
      "late descendant write",
    );
    const launcherSource = `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      process.on("SIGINT", () => {});
      process.on("SIGTERM", () => {});
      writeFileSync(${JSON.stringify(targetPath)}, "during refresh");
      spawn(
        process.execPath,
        ["--input-type=module", "--eval", ${JSON.stringify(descendantSource)}],
        { stdio: "ignore" },
      );
      setInterval(() => {}, 1_000);
    `;
    const supervisor = createSupervisor();
    const signalTarget = new EventEmitter();
    removeSignalHandlers.push(supervisor.installSignalHandlers(signalTarget));
    const runPromise = supervisor.run(
      "injected delayed descendant",
      process.execPath,
      ["--input-type=module", "--eval", launcherSource],
    );

    await waitForFile(descendantReadyPath);
    expect(readFileSync(targetPath, "utf8")).toBe("during refresh");
    signalTarget.emit("SIGTERM");

    const interruption = await runPromise.catch((error: unknown) => error);
    expect(interruption).toBeInstanceOf(ProcessSignalError);
    expect(interruption).toMatchObject({ signal: "SIGTERM", exitCode: 143 });
    expect(supervisor.activeProcessTreeCount()).toBe(0);

    const finalFailure = await stopWriterTreesThenRestore(
      supervisor,
      transaction,
      interruption,
    );
    expect(finalFailure).toBe(interruption);
    transaction.cleanup();
    await delay(LATE_WRITE_MS + 100);
    expect(readFileSync(targetPath, "utf8")).toBe("before");
    expect(existsSync(backupRoot)).toBe(false);

    const forbiddenWrite = path.join(temporaryRoot, "forbidden-write");
    await expect(
      supervisor.run("forbidden post-signal launch", process.execPath, [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(forbiddenWrite)}, "bad");`,
      ]),
    ).rejects.toMatchObject({ signal: "SIGTERM", exitCode: 143 });
    expect(existsSync(forbiddenWrite)).toBe(false);
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGTERM")).toBe(143);
    expect(signalExitCode("SIGHUP")).toBe(129);
  });

  it("runAll terminates sibling and descendant writers after a direct failure", async () => {
    const temporaryRoot = createTemporaryRoot();
    const repositoryRoot = path.join(temporaryRoot, "repo");
    const generatedRoot = path.join(repositoryRoot, "generated");
    const backupRoot = path.join(temporaryRoot, "failure-backup");
    const descendantReadyPath = path.join(
      temporaryRoot,
      "failure-descendant-ready",
    );
    const siblingReadyPath = path.join(temporaryRoot, "sibling-ready");
    const descendantWritePath = path.join(generatedRoot, "descendant.txt");
    const siblingWritePath = path.join(generatedRoot, "sibling.txt");
    await mkdir(generatedRoot, { recursive: true });
    writeFileSync(descendantWritePath, "descendant before");
    writeFileSync(siblingWritePath, "sibling before");
    const transaction = snapshotGeneratedPaths({
      repositoryRoot,
      backupRoot,
      relativePaths: ["generated"],
    });
    const descendantSource = delayedWriterSource(
      descendantWritePath,
      descendantReadyPath,
      "bad descendant write",
    );
    const failingLauncherSource = `
      import { spawn } from "node:child_process";
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(descendantWritePath)}, "during failure");
      spawn(
        process.execPath,
        ["--input-type=module", "--eval", ${JSON.stringify(descendantSource)}],
        { stdio: "ignore" },
      );
      const readyPoll = setInterval(() => {
        if (
          existsSync(${JSON.stringify(descendantReadyPath)}) &&
          existsSync(${JSON.stringify(siblingReadyPath)})
        ) {
          clearInterval(readyPoll);
          process.exit(7);
        }
      }, 5);
    `;
    const siblingSource = delayedWriterSource(
      siblingWritePath,
      siblingReadyPath,
      "bad sibling write",
    );
    const supervisor = createSupervisor();

    const runAllFailure = await supervisor
      .runAll([
        supervisor.run("injected direct failure", process.execPath, [
          "--input-type=module",
          "--eval",
          failingLauncherSource,
        ]),
        supervisor.run("injected sibling writer", process.execPath, [
          "--input-type=module",
          "--eval",
          siblingSource,
        ]),
      ])
      .catch((error: unknown) => error);
    expect(runAllFailure).toBeInstanceOf(Error);
    expect(runAllFailure).toMatchObject({
      message: "injected direct failure failed with exit code 7",
    });

    expect(existsSync(descendantReadyPath)).toBe(true);
    expect(existsSync(siblingReadyPath)).toBe(true);
    expect(supervisor.activeProcessTreeCount()).toBe(0);
    expect(readFileSync(descendantWritePath, "utf8")).toBe("during failure");
    const finalFailure = await stopWriterTreesThenRestore(
      supervisor,
      transaction,
      runAllFailure,
    );
    expect(finalFailure).toBe(runAllFailure);
    transaction.cleanup();
    await delay(LATE_WRITE_MS + 100);
    expect(readFileSync(descendantWritePath, "utf8")).toBe("descendant before");
    expect(readFileSync(siblingWritePath, "utf8")).toBe("sibling before");
    expect(existsSync(backupRoot)).toBe(false);
    await expect(
      supervisor.run("forbidden post-failure launch", process.execPath, [
        "--version",
      ]),
    ).rejects.toThrow("injected direct failure failed with exit code 7");
  });

  it("turns asynchronous spawn errors into a stopped, drained supervisor", async () => {
    const temporaryRoot = createTemporaryRoot();
    const supervisor = createSupervisor();
    const missingExecutable = path.join(temporaryRoot, "missing-command");

    await expect(
      supervisor.run("injected spawn error", missingExecutable, []),
    ).rejects.toThrow("injected spawn error failed to start");
    expect(supervisor.activeProcessTreeCount()).toBe(0);
    await expect(
      supervisor.run("forbidden post-spawn-error launch", process.execPath, [
        "--version",
      ]),
    ).rejects.toThrow("injected spawn error failed to start");
  });
});

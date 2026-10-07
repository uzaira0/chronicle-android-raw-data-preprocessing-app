import { spawn } from "node:child_process";

const DEFAULT_TERMINATION_GRACE_MS = 500;
const DEFAULT_FORCE_KILL_WAIT_MS = 2_000;
const DEFAULT_TREE_DRAIN_WAIT_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 10;
/** @type {readonly ("SIGINT" | "SIGTERM" | "SIGHUP")[]} */
const HANDLED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);

/**
 * @typedef {{
 *   code: number | null,
 *   signal: NodeJS.Signals | null,
 *   error?: Error,
 * }} DirectResult
 */

/**
 * @typedef {{
 *   child: import("node:child_process").ChildProcess,
 *   label: string,
 *   pid: number | undefined,
 *   directSettled: boolean,
 *   directResult: Promise<DirectResult>,
 * }} ProcessTree
 */

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {unknown} value */
function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

/** @param {unknown} error */
function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/** @param {"SIGINT" | "SIGTERM" | "SIGHUP"} signal */
export function signalExitCode(signal) {
  if (signal === "SIGHUP") return 129;
  return signal === "SIGINT" ? 130 : 143;
}

export class ProcessSignalError extends Error {
  /** @param {"SIGINT" | "SIGTERM" | "SIGHUP"} signal */
  constructor(signal) {
    super(`dependency evidence interrupted by ${signal}`);
    this.name = "ProcessSignalError";
    this.signal = signal;
    this.exitCode = signalExitCode(signal);
  }
}

/**
 * Close the only safe path from a failed writer command to snapshot restore.
 * A caller may clean its temporary and backup directories only after this
 * function resolves. If tree termination cannot be proven, it deliberately
 * leaves the snapshot untouched for manual recovery.
 *
 * @param {ReturnType<typeof createProcessTreeSupervisor>} supervisor
 * @param {{restore(): void} | null} transaction
 * @param {unknown} failure
 * @returns {Promise<Error>}
 */
export async function stopWriterTreesThenRestore(
  supervisor,
  transaction,
  failure,
) {
  const originalFailure = asError(failure);
  await supervisor.stopAndWait(originalFailure);
  if (supervisor.activeProcessTreeCount() !== 0) {
    throw new Error(
      "process supervisor returned before every writer tree exited",
    );
  }
  const finalFailure = supervisor.currentStopReason() ?? originalFailure;
  try {
    transaction?.restore();
  } catch (restoreError) {
    throw new AggregateError(
      [finalFailure, restoreError],
      "dependency evidence failed and its generated-path rollback also failed",
    );
  }
  return finalFailure;
}

/**
 * Supervise writer commands as process trees rather than direct children.
 *
 * On POSIX, every direct child starts in its own process group, so one negative
 * PID signal reaches the child and every descendant that has not deliberately
 * escaped that group. Completed direct children remain registered while their
 * group still exists. That closes the failure mode where a launcher exits but
 * leaves a delayed writer alive during rollback.
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   terminationGraceMs?: number,
 *   forceKillWaitMs?: number,
 *   treeDrainWaitMs?: number,
 *   pollIntervalMs?: number,
 * }} [options]
 */
export function createProcessTreeSupervisor(options = {}) {
  const platform = options.platform ?? process.platform;
  const terminationGraceMs =
    options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const forceKillWaitMs = options.forceKillWaitMs ?? DEFAULT_FORCE_KILL_WAIT_MS;
  const treeDrainWaitMs = options.treeDrainWaitMs ?? DEFAULT_TREE_DRAIN_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  /** @type {Set<ProcessTree>} */
  const processTrees = new Set();
  /** @type {Error | null} */
  let stopReason = null;
  /** @type {ProcessSignalError | null} */
  let signalError = null;
  /** @type {Error | null} */
  let terminationFailure = null;
  /** @type {Promise<void> | null} */
  let stopPromise = null;
  let signalHandlersInstalled = false;

  /** @param {string} label @param {number} value */
  function validateDuration(label, value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be a non-negative finite number`);
    }
  }
  validateDuration("terminationGraceMs", terminationGraceMs);
  validateDuration("forceKillWaitMs", forceKillWaitMs);
  validateDuration("treeDrainWaitMs", treeDrainWaitMs);
  validateDuration("pollIntervalMs", pollIntervalMs);

  /** @param {ProcessTree} tree */
  function isTreeAlive(tree) {
    if (platform === "win32") return !tree.directSettled;
    const pid = tree.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid)) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if (isMissingProcess(error)) return false;
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        return true;
      }
      throw error;
    }
  }

  /** @param {Iterable<ProcessTree>} trees */
  function pendingTrees(trees) {
    const pending = [];
    for (const tree of trees) {
      if (tree.directSettled && !isTreeAlive(tree)) {
        processTrees.delete(tree);
      } else {
        pending.push(tree);
      }
    }
    return pending;
  }

  /**
   * @param {ProcessTree[]} trees
   * @param {number} timeoutMs
   */
  async function waitForTrees(trees, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const pending = pendingTrees(trees);
      if (pending.length === 0) return [];
      if (Date.now() >= deadline) return pending;
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
  }

  /**
   * @param {number} pid
   * @param {boolean} force
   * @returns {Promise<void>}
   */
  function runWindowsTreeKill(pid, force) {
    return new Promise((resolve, reject) => {
      const args = ["/pid", String(pid), "/t"];
      if (force) args.push("/f");
      const killer = spawn("taskkill", args, {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", reject);
      killer.once("close", () => resolve());
    });
  }

  /**
   * @param {ProcessTree} tree
   * @param {NodeJS.Signals} signal
   */
  async function signalTree(tree, signal) {
    const pid = tree.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid)) return;
    if (platform === "win32") {
      await runWindowsTreeKill(pid, signal === "SIGKILL");
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
      if (!tree.directSettled) tree.child.kill(signal);
    }
  }

  /** @param {NodeJS.Signals} initialSignal */
  async function terminateRegisteredTrees(initialSignal) {
    const trees = [...processTrees];
    await Promise.all(trees.map((tree) => signalTree(tree, initialSignal)));
    let pending = await waitForTrees(trees, terminationGraceMs);
    if (pending.length > 0) {
      await Promise.all(pending.map((tree) => signalTree(tree, "SIGKILL")));
      pending = await waitForTrees(pending, forceKillWaitMs);
    }
    if (pending.length > 0) {
      const identities = pending
        .map((tree) => `${tree.label}:${tree.pid ?? "unspawned"}`)
        .join(", ");
      throw new Error(`writer process trees did not terminate: ${identities}`);
    }
  }

  /**
   * @param {import("node:child_process").ChildProcess} child
   * @param {string} label
   */
  function trackChild(child, label) {
    /** @type {(result: DirectResult) => void} */
    let resolveDirect = () => {};
    const directResult = /** @type {Promise<DirectResult>} */ (
      new Promise((resolve) => {
        resolveDirect = resolve;
      })
    );
    /** @type {ProcessTree} */
    const tree = {
      child,
      label,
      pid: child.pid,
      directSettled: false,
      directResult,
    };
    let settled = false;
    /** @param {DirectResult} result */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      tree.directSettled = true;
      resolveDirect(result);
    };
    child.once("error", (error) => {
      settle({ code: null, signal: null, error: asError(error) });
    });
    child.once("close", (code, signal) => {
      settle({ code, signal });
    });
    processTrees.add(tree);
    return tree;
  }

  function currentStopReason() {
    return terminationFailure ?? signalError ?? stopReason;
  }

  function throwIfStopping() {
    const reason = currentStopReason();
    if (reason) throw reason;
  }

  /**
   * Stop accepting launches, terminate every registered process tree, and do
   * not resolve until all direct children and descendant process groups are
   * gone. A rejection is deliberately unsafe for rollback: callers must retain
   * their snapshots instead of restoring underneath a possible writer.
   *
   * @param {unknown} [reason]
   * @param {NodeJS.Signals} [initialSignal]
   */
  function stopAndWait(
    reason = new Error("dependency evidence process supervisor stopped"),
    initialSignal = "SIGTERM",
  ) {
    if (!stopReason) stopReason = asError(reason);
    if (!stopPromise) {
      stopPromise = terminateRegisteredTrees(initialSignal).catch((error) => {
        const reasonMessage =
          stopReason?.message ?? "process supervisor stopped";
        terminationFailure = new Error(
          `${reasonMessage}; process-tree termination failed: ${asError(error).message}`,
        );
        throw terminationFailure;
      });
    }
    return stopPromise;
  }

  /** @param {"SIGINT" | "SIGTERM" | "SIGHUP"} signal */
  function requestSignal(signal) {
    if (!signalError) signalError = new ProcessSignalError(signal);
    return stopAndWait(signalError, signal);
  }

  /**
   * @param {{
   *   on(eventName: string, listener: () => void): unknown,
   *   off(eventName: string, listener: () => void): unknown,
   * }} [signalTarget]
   */
  function installSignalHandlers(signalTarget = process) {
    if (signalHandlersInstalled) {
      throw new Error(
        "dependency evidence signal handlers are already installed",
      );
    }
    signalHandlersInstalled = true;
    const handlers = new Map();
    for (const signal of HANDLED_SIGNALS) {
      const handler = () => {
        if (signalError) {
          process.stderr.write(
            `\n[dependency evidence] already stopping after ${signalError.signal}; waiting for writer trees to exit before rollback\n`,
          );
        }
        void requestSignal(signal).catch(() => {
          // The active run/main transaction observes the stored termination
          // failure and refuses rollback. Consume this branch so the signal
          // handler itself never creates an unhandled rejection.
        });
      };
      handlers.set(signal, handler);
      signalTarget.on(signal, handler);
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      for (const [signal, handler] of handlers) {
        signalTarget.off(signal, handler);
      }
      signalHandlersInstalled = false;
    };
  }

  /**
   * @param {string} label
   * @param {string} command
   * @param {string[]} args
   * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [runOptions]
   */
  async function run(label, command, args, runOptions = {}) {
    throwIfStopping();
    let child;
    try {
      child = spawn(command, args, {
        cwd: runOptions.cwd,
        env: runOptions.env,
        stdio: "inherit",
        detached: platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      const failure = new Error(
        `${label} failed to start: ${asError(error).message}`,
      );
      await stopAndWait(failure);
      throw failure;
    }

    const tree = trackChild(child, label);
    const result = await tree.directResult;
    if (currentStopReason()) {
      await stopAndWait(currentStopReason());
      throw currentStopReason();
    }
    let failure = null;
    if (result.error) {
      failure = new Error(`${label} failed to start: ${result.error.message}`);
    } else if (result.signal) {
      failure = new Error(`${label} ended from signal ${result.signal}`);
    } else if (result.code !== 0) {
      failure = new Error(`${label} failed with exit code ${result.code}`);
    }
    if (failure) {
      await stopAndWait(failure);
      throw failure;
    }

    const pending = await waitForTrees([tree], treeDrainWaitMs);
    if (pending.length > 0) {
      failure = new Error(`${label} left descendant writer processes alive`);
      await stopAndWait(failure);
      throw failure;
    }
    throwIfStopping();
  }

  /** @param {Promise<unknown>[]} jobs */
  async function runAll(jobs) {
    const watchedJobs = jobs.map((job) =>
      Promise.resolve(job).catch(async (error) => {
        await stopAndWait(error);
        throw error;
      }),
    );
    const results = await Promise.allSettled(watchedJobs);
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => asError(result.reason).message);
    if (failures.length > 0) {
      // stopAndWait always records a stop reason, so the ?? arms are
      // defense-in-depth only; keep the thrown error identical to the stored
      // reason (tests pin single-failure attribution -- do not join failures).
      await stopAndWait(currentStopReason() ?? new Error(failures[0]));
      throw currentStopReason() ?? new Error([...new Set(failures)].join("; "));
    }
    throwIfStopping();
  }

  async function waitForIdle() {
    throwIfStopping();
    const pending = await waitForTrees([...processTrees], treeDrainWaitMs);
    if (pending.length > 0) {
      const failure = new Error(
        "dependency evidence commands left writer processes alive",
      );
      await stopAndWait(failure);
      throw failure;
    }
    throwIfStopping();
  }

  return Object.freeze({
    activeProcessTreeCount: () => pendingTrees(processTrees).length,
    currentStopReason,
    installSignalHandlers,
    requestSignal,
    run,
    runAll,
    stopAndWait,
    throwIfStopping,
    waitForIdle,
  });
}

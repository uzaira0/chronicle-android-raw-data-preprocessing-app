export class ProcessSignalError extends Error {
  constructor(signal: "SIGINT" | "SIGTERM" | "SIGHUP");
  readonly signal: "SIGINT" | "SIGTERM" | "SIGHUP";
  readonly exitCode: 129 | 130 | 143;
}

export function signalExitCode(signal: "SIGINT" | "SIGTERM" | "SIGHUP"): 129 | 130 | 143;

export function stopWriterTreesThenRestore(
  supervisor: ProcessTreeSupervisor,
  transaction: { restore(): void } | null,
  failure: unknown,
): Promise<Error>;

export interface ProcessTreeSupervisor {
  activeProcessTreeCount(): number;
  currentStopReason(): Error | null;
  installSignalHandlers(signalTarget?: {
    on(eventName: string, listener: () => void): unknown;
    off(eventName: string, listener: () => void): unknown;
  }): () => void;
  requestSignal(signal: "SIGINT" | "SIGTERM" | "SIGHUP"): Promise<void>;
  run(
    label: string,
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<void>;
  runAll(jobs: Promise<unknown>[]): Promise<void>;
  stopAndWait(reason?: unknown, initialSignal?: NodeJS.Signals): Promise<void>;
  throwIfStopping(): void;
  waitForIdle(): Promise<void>;
}

export function createProcessTreeSupervisor(options?: {
  platform?: NodeJS.Platform;
  terminationGraceMs?: number;
  forceKillWaitMs?: number;
  treeDrainWaitMs?: number;
  pollIntervalMs?: number;
}): ProcessTreeSupervisor;

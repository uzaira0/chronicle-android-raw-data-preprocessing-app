import type { ParticipantPartitionTransport } from "@/lib/fileInspection";

type ParticipantPartitionLaneOperations = {
  begin: (secret: Uint8Array) => Promise<string>;
  register: (csvBytes: Uint8Array, batchId: string) => Promise<void>;
  dispose: (batchId: string) => Promise<boolean>;
};

export async function beginParticipantInspectionBatchZeroing(
  secretBuffer: ArrayBuffer,
  begin: (secret: Uint8Array) => Promise<string>,
): Promise<string> {
  const secret = new Uint8Array(secretBuffer);
  try {
    return await begin(secret);
  } finally {
    secret.fill(0);
  }
}

type ParticipantPartitionLaneInput<T> = {
  csvBytes: Uint8Array;
  partition: ParticipantPartitionTransport | undefined;
  secretBuffer: ArrayBuffer | undefined;
  operations: ParticipantPartitionLaneOperations;
  execute: (
    partition: ParticipantPartitionTransport | undefined,
  ) => Promise<T>;
};

let activeLaneTail: Promise<void> = Promise.resolve();

export async function withRuntimeExecutionLane<T>(
  operation: () => Promise<T>,
): Promise<T> {
  // A predecessor's failure belongs to its own caller; this operation only
  // waits for the lane to be free.
  const predecessor = activeLaneTail.catch(() => {});
  let release!: () => void;
  activeLaneTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await predecessor;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Keep participant-partition setup, exact-artifact registration, scientific
 * preflight, and execution inside one worker lane. The batch is disposed after
 * every post-begin outcome, including identity mismatch and registration or
 * execution failure. The transferred secret is wiped independently.
 */
export async function withParticipantPartitionLane<T>({
  csvBytes,
  partition,
  secretBuffer,
  operations,
  execute,
}: ParticipantPartitionLaneInput<T>): Promise<T> {
  if (!partition) {
    if (secretBuffer) {
      new Uint8Array(secretBuffer).fill(0);
      throw new Error(
        "participant partition secret was supplied without partition metadata",
      );
    }
    // Runtime pending scientific preflight is workspace-scoped and consumed
    // unconditionally by execute. An inactive call interleaved between an
    // active preflight and execute could otherwise steal that one-shot commit.
    // Serialize every call on this worker; pool workers still provide bounded
    // cross-worker parallelism.
    return withRuntimeExecutionLane(() => execute(undefined));
  }
  if (!secretBuffer) {
    throw new Error(
      "participant partition execution requires its ephemeral batch secret",
    );
  }

  return withRuntimeExecutionLane(() =>
    runActiveParticipantPartitionLane({
      csvBytes,
      partition,
      secretBuffer,
      operations,
      execute,
    }),
  );
}

async function runActiveParticipantPartitionLane<T>({
  csvBytes,
  partition,
  secretBuffer,
  operations,
  execute,
}: {
  csvBytes: Uint8Array;
  partition: ParticipantPartitionTransport;
  secretBuffer: ArrayBuffer;
  operations: ParticipantPartitionLaneOperations;
  execute: (
    partition: ParticipantPartitionTransport | undefined,
  ) => Promise<T>;
}): Promise<T> {
  const secret = new Uint8Array(secretBuffer);
  if (secret.byteLength !== 32) {
    secret.fill(0);
    throw new Error(
      "participant partition secret must contain exactly 32 bytes",
    );
  }

  let configuredBatchId: string | undefined;
  try {
    try {
      configuredBatchId = await operations.begin(secret);
    } finally {
      secret.fill(0);
    }
    if (configuredBatchId !== partition.participantPartitionBatchId) {
      throw new Error("participant partition batch identity mismatch");
    }
    await operations.register(csvBytes, configuredBatchId);
    return await execute(partition);
  } finally {
    if (configuredBatchId) {
      await operations.dispose(configuredBatchId);
    }
  }
}

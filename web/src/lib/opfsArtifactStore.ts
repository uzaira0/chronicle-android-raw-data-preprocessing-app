/**
 * Thin OPFS persistence adapter for Rust-owned runtime artifacts.
 *
 * Rust defines artifact bytes, digests, lineage, and the workspace-root
 * manifest. This module performs browser filesystem I/O only: content-addressed
 * object placement, alternating root slots, verified recovery, and retained-root
 * garbage collection.
 */

const STORE_DIRECTORY = "chronicle-preprocessing-runtime-v1";
export const OPFS_WORKSPACES_DIRECTORY = "chronicle-preprocessing-workspaces-v1";
const OBJECTS_DIRECTORY = "objects";
const ROOTS_DIRECTORY = "roots";
const CLOSURE_MAGIC = new TextEncoder().encode("CHRONICLE-CLOSURE-V1\n");
const MAX_CLOSURE_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CLOSURE_OBJECTS = 100_000;
const MAX_HISTORY_ROOTS = 10_000;
const MAX_ROOT_SLOT_ARTIFACTS = 1_024;
const MAX_ROOT_SLOT_BYTES = 128 * 1024;

export type PersistedRuntimeArtifact = {
  kind: string;
  digest: string;
  size: number;
  bytes: Uint8Array;
  digestVerified?: true;
};

export type PersistedRuntimeArtifactMetadata = Omit<
  PersistedRuntimeArtifact,
  "bytes"
>;

export type WorkspaceRootSlot = {
  protocolVersion: "chronicle-opfs-root/v1";
  generation: number;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  artifactDigests: string[];
  checksum: string;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[
    string,
    FileSystemFileHandle | FileSystemDirectoryHandle,
  ]>;
};

type UnsignedWorkspaceRootSlot = Omit<WorkspaceRootSlot, "checksum">;
export type RuntimeClosureManifest = {
  protocolVersion: "chronicle-runtime-closure/v1";
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  objects: Array<{ digest: string; size: number; offset: number }>;
};

export type RuntimeClosureInspection = {
  manifest: RuntimeClosureManifest;
  object(digest: string): Uint8Array;
};

export type OpfsCapability =
  | { status: "ready"; evictionProtected: boolean | null }
  | { status: "unavailable"; reason: string };

function digestHex(digest: string): string {
  const value = digest.startsWith("sha256:") ? digest.slice(7) : "";
  if (value.length !== 64 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error(`invalid SHA-256 digest: ${digest}`);
  }
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    const owned =
      bytes.buffer instanceof ArrayBuffer
        ? (bytes as Uint8Array<ArrayBuffer>)
        : new Uint8Array(bytes);
    await writable.write(owned);
  } finally {
    await writable.close();
  }
}

async function readFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();
  if (maxBytes !== undefined && file.size > maxBytes) {
    throw new Error(`file exceeds the ${maxBytes} byte read limit`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

async function storeDirectories(root: FileSystemDirectoryHandle): Promise<{
  objects: FileSystemDirectoryHandle;
  roots: FileSystemDirectoryHandle;
}> {
  const store = await root.getDirectoryHandle(STORE_DIRECTORY, { create: true });
  return {
    objects: await store.getDirectoryHandle(OBJECTS_DIRECTORY, { create: true }),
    roots: await store.getDirectoryHandle(ROOTS_DIRECTORY, { create: true }),
  };
}

async function objectDirectory(
  objects: FileSystemDirectoryHandle,
  digest: string,
  create: boolean,
): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
  const hex = digestHex(digest);
  return {
    directory: await objects.getDirectoryHandle(hex.slice(0, 2), { create }),
    name: hex.slice(2),
  };
}

async function putObject(
  objects: FileSystemDirectoryHandle,
  artifact: PersistedRuntimeArtifact,
): Promise<void> {
  if (artifact.bytes.byteLength !== artifact.size) {
    throw new Error(`artifact size mismatch for ${artifact.kind}`);
  }
  if (!artifact.digestVerified) {
    const actual = await sha256(artifact.bytes);
    if (actual !== artifact.digest) {
      throw new Error(`artifact digest mismatch for ${artifact.kind}`);
    }
  }
  const { directory, name } = await objectDirectory(objects, artifact.digest, true);
  try {
    const existing = await readFile(directory, name);
    if (existing.byteLength === artifact.size && (await sha256(existing)) === artifact.digest) {
      return;
    }
  } catch {
    // Missing or unreadable objects are repaired by the verified write below.
  }
  await writeFile(directory, name, artifact.bytes);
  const stored = await readFile(directory, name);
  if (stored.byteLength !== artifact.size || (await sha256(stored)) !== artifact.digest) {
    throw new Error(`OPFS verification failed for ${artifact.kind}`);
  }
}

/** Verify and place one immutable object without advancing a workspace root. */
export async function persistRuntimeObject(
  root: FileSystemDirectoryHandle,
  artifact: PersistedRuntimeArtifact,
): Promise<void> {
  await persistRuntimeObjects(root, [artifact]);
}

/** Verify and place a caller-bounded set of immutable objects. */
export async function persistRuntimeObjects(
  root: FileSystemDirectoryHandle,
  artifacts: readonly PersistedRuntimeArtifact[],
): Promise<void> {
  const { objects } = await storeDirectories(root);
  await Promise.all(artifacts.map((artifact) => putObject(objects, artifact)));
}

async function readVerifiedObject(
  objects: FileSystemDirectoryHandle,
  digest: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  const { directory, name } = await objectDirectory(objects, digest, false);
  const bytes = await readFile(directory, name, maxBytes);
  if ((await sha256(bytes)) !== digest) {
    throw new Error(`corrupt OPFS object: ${digest}`);
  }
  return bytes;
}

async function signedSlot(
  unsigned: UnsignedWorkspaceRootSlot,
): Promise<WorkspaceRootSlot> {
  return { ...unsigned, checksum: await sha256(encodeJson(unsigned)) };
}

async function parseSlot(bytes: Uint8Array): Promise<WorkspaceRootSlot> {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as WorkspaceRootSlot;
  const { checksum, ...unsigned } = parsed;
  if (
    parsed.protocolVersion !== "chronicle-opfs-root/v1" ||
    !Number.isSafeInteger(parsed.generation) ||
    parsed.generation < 1 ||
    !Array.isArray(parsed.artifactDigests) ||
    parsed.artifactDigests.length > MAX_ROOT_SLOT_ARTIFACTS ||
    new Set(parsed.artifactDigests).size !== parsed.artifactDigests.length ||
    checksum !== (await sha256(encodeJson(unsigned)))
  ) {
    throw new Error("invalid OPFS root slot");
  }
  digestHex(parsed.workspaceRootDigest);
  if (parsed.previousWorkspaceRootDigest !== null) {
    digestHex(parsed.previousWorkspaceRootDigest);
  }
  for (const digest of parsed.artifactDigests) digestHex(digest);
  return parsed;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isRecoverableRootSlotError(error: unknown): boolean {
  return (
    isNotFoundError(error) ||
    error instanceof SyntaxError ||
    (error instanceof Error &&
      (error.message === "invalid OPFS root slot" ||
        error.message.startsWith("invalid SHA-256 digest:") ||
        error.message.startsWith("file exceeds the ")))
  );
}

function isRecoverableClosureObjectError(error: unknown): boolean {
  return (
    isNotFoundError(error) ||
    (error instanceof Error && error.message.startsWith("corrupt OPFS object:"))
  );
}

async function rootSlotCandidates(
  roots: FileSystemDirectoryHandle,
): Promise<{ candidates: WorkspaceRootSlot[]; rootSlotObserved: boolean }> {
  const candidates: WorkspaceRootSlot[] = [];
  let rootSlotObserved = false;
  for (const name of ["root-a.json", "root-b.json"]) {
    try {
      const bytes = await readFile(roots, name, MAX_ROOT_SLOT_BYTES);
      rootSlotObserved = true;
      candidates.push(await parseSlot(bytes));
    } catch (error) {
      if (!isNotFoundError(error)) rootSlotObserved = true;
      if (!isRecoverableRootSlotError(error)) throw error;
      // Alternating slots are intentionally independent: one torn/corrupt slot
      // must not prevent recovery from the other.
    }
  }
  candidates.sort((left, right) => right.generation - left.generation);
  return { candidates, rootSlotObserved };
}

function cachedObjectVerifier(
  objects: FileSystemDirectoryHandle,
): (digest: string) => Promise<void> {
  const checks = new Map<string, Promise<void>>();
  return (digest) => {
    let check = checks.get(digest);
    if (!check) {
      check = readVerifiedObject(objects, digest).then(() => undefined);
      checks.set(digest, check);
    }
    return check;
  };
}

async function verifySlotObjects(
  candidate: WorkspaceRootSlot,
  verifyObject: (digest: string) => Promise<void>,
): Promise<void> {
  await verifyObject(candidate.workspaceRootDigest);
  for (const digest of candidate.artifactDigests) {
    await verifyObject(digest);
  }
}

async function recoverableSlotsFromDirectories(
  objects: FileSystemDirectoryHandle,
  roots: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot[]> {
  const { candidates, rootSlotObserved } = await rootSlotCandidates(roots);
  const recovered: WorkspaceRootSlot[] = [];
  const verifyObject = cachedObjectVerifier(objects);
  for (const candidate of candidates) {
    try {
      await verifySlotObjects(candidate, verifyObject);
      recovered.push(candidate);
    } catch (error) {
      if (!isRecoverableClosureObjectError(error)) throw error;
      // A newer slot with an incomplete closure falls back to the prior slot.
    }
  }
  if (rootSlotObserved && recovered.length === 0) {
    throw new Error(
      "OPFS workspace roots exist, but no valid artifact closure can be recovered",
    );
  }
  return recovered;
}

async function recoverFromDirectories(
  objects: FileSystemDirectoryHandle,
  roots: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot | undefined> {
  const { candidates, rootSlotObserved } = await rootSlotCandidates(roots);
  const verifyObject = cachedObjectVerifier(objects);
  for (const candidate of candidates) {
    try {
      await verifySlotObjects(candidate, verifyObject);
      return candidate;
    } catch (error) {
      if (!isRecoverableClosureObjectError(error)) throw error;
      // A newer incomplete slot falls back to the older independent slot.
    }
  }
  if (rootSlotObserved) {
    throw new Error(
      "OPFS workspace roots exist, but no valid artifact closure can be recovered",
    );
  }
  return undefined;
}

async function recoverHeadFromDirectories(
  objects: FileSystemDirectoryHandle,
  roots: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot | undefined> {
  const { candidates, rootSlotObserved } = await rootSlotCandidates(roots);
  const verifyObject = cachedObjectVerifier(objects);
  for (const candidate of candidates) {
    try {
      // Interactive review needs the signed slot and its root commit, then it
      // verifies the requested closure objects directly. Do not hash every
      // unrelated exported artifact just to locate those two cache objects.
      const rootBytes = await readVerifiedObject(
        objects,
        candidate.workspaceRootDigest,
      );
      const rootCommit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
        artifactClosureDigest?: unknown;
      };
      if (typeof rootCommit.artifactClosureDigest !== "string") {
        throw new Error("invalid OPFS review head");
      }
      digestHex(rootCommit.artifactClosureDigest);
      await verifyObject(rootCommit.artifactClosureDigest);
      return candidate;
    } catch (error) {
      if (
        !isRecoverableClosureObjectError(error) &&
        !(error instanceof SyntaxError) &&
        !(error instanceof Error &&
          (error.message === "invalid OPFS review head" ||
            error.message.startsWith("invalid SHA-256 digest:")))
      ) {
        throw error;
      }
    }
  }
  if (rootSlotObserved) {
    throw new Error("OPFS workspace roots exist, but no valid head can be recovered");
  }
  return undefined;
}

export async function openOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("OPFS is unavailable in this browser");
  }
  return navigator.storage.getDirectory();
}

export async function openOpfsWorkspace(
  workspaceId: string,
): Promise<FileSystemDirectoryHandle> {
  const root = await openOpfsRoot();
  const workspaces = await root.getDirectoryHandle(OPFS_WORKSPACES_DIRECTORY, {
    create: true,
  });
  return workspaces.getDirectoryHandle(digestHex(workspaceId), { create: true });
}

export async function probeOpfsCapability(): Promise<OpfsCapability> {
  try {
    if (!navigator.locks?.request) {
      return {
        status: "unavailable",
        reason:
          "The Web Locks API is unavailable, so workspace commits cannot be serialized safely.",
      };
    }
    await openOpfsRoot();
    const evictionProtected = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : null;
    return { status: "ready", evictionProtected };
  } catch (error) {
    return {
      status: "unavailable",
      reason: `Origin-private file storage could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Write a complete artifact set and advance the alternating root.
 *
 * Concurrency contract: exclusive write access per workspace is the caller's
 * job — every production path routes through `withWorkspaceLock` in
 * rustPipelineRuntime.ts (the Web Locks API); this module never takes a lock
 * itself. What it does guarantee is detection: recovery runs twice (here
 * before any object write, and again disk-verified inside
 * commitPersistedRuntimeWorkspace), so a root advanced by another writer
 * mid-persist fails the previous-root check instead of being clobbered.
 */
export async function persistRuntimeWorkspace(
  root: FileSystemDirectoryHandle,
  input: {
    workspaceRootDigest: string;
    previousWorkspaceRootDigest: string | null;
    artifacts: PersistedRuntimeArtifact[];
    recoveredSlot?: WorkspaceRootSlot;
    verifiedDetachedHistory?: boolean;
    slotArtifactDigests?: string[];
  },
): Promise<WorkspaceRootSlot> {
  digestHex(input.workspaceRootDigest);
  const { objects, roots } = await storeDirectories(root);
  const byDigest = new Map<string, PersistedRuntimeArtifact>();
  for (const artifact of input.artifacts) {
    const existing = byDigest.get(artifact.digest);
    if (existing && existing.size !== artifact.size) {
      throw new Error(`conflicting artifact metadata for ${artifact.digest}`);
    }
    // A content-addressed object can legitimately satisfy several semantic
    // roles. Kind is assignment metadata, not part of object identity.
    byDigest.set(artifact.digest, artifact);
  }
  if (!byDigest.has(input.workspaceRootDigest)) {
    throw new Error("runtime artifact set is missing the workspace-root object");
  }
  const previous = input.recoveredSlot
    ? await parseSlot(encodeJson(input.recoveredSlot))
    : await recoverFromDirectories(objects, roots);
  const incomingHistoryContains = async (targetDigest: string): Promise<boolean> => {
    const seen = new Set<string>();
    let rootDigest: string | null = input.workspaceRootDigest;
    while (rootDigest !== null) {
      if (rootDigest === targetDigest) return true;
      if (seen.has(rootDigest) || seen.size >= MAX_HISTORY_ROOTS) {
        throw new Error("incoming workspace history is cyclic or too large");
      }
      seen.add(rootDigest);
      const artifact = byDigest.get(rootDigest);
      const bytes: Uint8Array = artifact
        ? artifact.bytes
        : await readVerifiedObject(objects, rootDigest);
      if ((await sha256(bytes)) !== rootDigest) {
        throw new Error(`incoming workspace root digest mismatch: ${rootDigest}`);
      }
      rootDigest = decodeHistoryRoot(bytes).previousWorkspaceRootDigest;
    }
    return false;
  };
  const previousIsAncestor =
    previous !== undefined &&
    input.previousWorkspaceRootDigest !== previous.workspaceRootDigest
      ? await incomingHistoryContains(previous.workspaceRootDigest)
      : false;
  if (
    (previous?.workspaceRootDigest ?? null) !== input.previousWorkspaceRootDigest &&
    !(input.verifiedDetachedHistory && previous === undefined) &&
    !previousIsAncestor
  ) {
    throw new Error("recovered OPFS root does not match the runtime's previous root");
  }
  // Objects are immutable and independently addressed; only the alternating
  // root commit is order-sensitive. Two writers overlap OPFS latency without
  // multiplying the large artifact buffers as an unbounded Promise.all would.
  const objectsToWrite = [...byDigest.values()].sort(
    (left, right) => right.size - left.size,
  );
  let writeIndex = 0;
  const writeNext = async (): Promise<void> => {
    for (;;) {
      const artifact = objectsToWrite[writeIndex];
      writeIndex += 1;
      if (!artifact) return;
      await putObject(objects, artifact);
    }
  };
  await Promise.all([writeNext(), writeNext()]);
  return commitPersistedRuntimeWorkspace(root, {
    ...input,
    artifacts: input.artifacts,
  });
}

/**
 * Advance the alternating root only after every listed object has already been
 * verified and placed in the content-addressed store.
 *
 * Concurrency contract: callers must hold the per-workspace Web Lock (see
 * `withWorkspaceLock` in rustPipelineRuntime.ts). The disk-verified recovery
 * below is deliberately repeated even when persistRuntimeWorkspace already
 * recovered pre-write: it is the mid-write race detector, not redundancy.
 */
export async function commitPersistedRuntimeWorkspace(
  root: FileSystemDirectoryHandle,
  input: {
    workspaceRootDigest: string;
    previousWorkspaceRootDigest: string | null;
    artifacts: PersistedRuntimeArtifactMetadata[];
    recoveredSlot?: WorkspaceRootSlot;
    verifiedDetachedHistory?: boolean;
    slotArtifactDigests?: string[];
  },
): Promise<WorkspaceRootSlot> {
  digestHex(input.workspaceRootDigest);
  const { objects, roots } = await storeDirectories(root);
  const byDigest = new Map<string, PersistedRuntimeArtifactMetadata>();
  for (const artifact of input.artifacts) {
    const existing = byDigest.get(artifact.digest);
    if (existing && existing.size !== artifact.size) {
      throw new Error(`conflicting artifact metadata for ${artifact.digest}`);
    }
    byDigest.set(artifact.digest, artifact);
  }
  if (!byDigest.has(input.workspaceRootDigest)) {
    throw new Error("runtime artifact set is missing the workspace-root object");
  }
  const previous = input.recoveredSlot
    ? await parseSlot(encodeJson(input.recoveredSlot))
    : await recoverFromDirectories(objects, roots);
  const incomingHistoryContains = async (targetDigest: string): Promise<boolean> => {
    const seen = new Set<string>();
    let rootDigest: string | null = input.workspaceRootDigest;
    while (rootDigest !== null) {
      if (rootDigest === targetDigest) return true;
      if (seen.has(rootDigest) || seen.size >= MAX_HISTORY_ROOTS) {
        throw new Error("incoming workspace history is cyclic or too large");
      }
      seen.add(rootDigest);
      rootDigest = decodeHistoryRoot(
        await readVerifiedObject(objects, rootDigest),
      ).previousWorkspaceRootDigest;
    }
    return false;
  };
  const previousIsAncestor =
    previous !== undefined &&
    input.previousWorkspaceRootDigest !== previous.workspaceRootDigest
      ? await incomingHistoryContains(previous.workspaceRootDigest)
      : false;
  if (
    (previous?.workspaceRootDigest ?? null) !== input.previousWorkspaceRootDigest &&
    !(input.verifiedDetachedHistory && previous === undefined) &&
    !previousIsAncestor
  ) {
    throw new Error("recovered OPFS root does not match the runtime's previous root");
  }
  // The object writes above are not a workspace commit. Check the complete
  // projected history before advancing either root slot so a hard limit can
  // never make the newly committed head unreadable.
  if (previous) {
    const history = await collectCommittedHistoryFromObjects(
      objects,
      previous.workspaceRootDigest,
    );
    if (history.rootDigests.length >= MAX_HISTORY_ROOTS) {
      throw new Error(
        `workspace history has reached ${MAX_HISTORY_ROOTS} roots; export and start a new workspace before committing`,
      );
    }
    const projectedObjects = new Set(history.digests);
    for (const digest of byDigest.keys()) projectedObjects.add(digest);
    if (projectedObjects.size > MAX_CLOSURE_OBJECTS) {
      throw new Error(
        `workspace history would exceed ${MAX_CLOSURE_OBJECTS} objects; export and start a new workspace before committing`,
      );
    }
  } else if (byDigest.size > MAX_CLOSURE_OBJECTS) {
    throw new Error(`runtime artifact set exceeds ${MAX_CLOSURE_OBJECTS} objects`);
  }
  const slotArtifactDigests = input.slotArtifactDigests ?? [...byDigest.keys()];
  if (
    slotArtifactDigests.length > MAX_ROOT_SLOT_ARTIFACTS ||
    new Set(slotArtifactDigests).size !== slotArtifactDigests.length ||
    slotArtifactDigests.some((digest) => !byDigest.has(digest))
  ) {
    throw new Error("runtime root slot artifact set is invalid");
  }
  const unsigned: UnsignedWorkspaceRootSlot = {
    protocolVersion: "chronicle-opfs-root/v1",
    generation: (previous?.generation ?? 0) + 1,
    workspaceRootDigest: input.workspaceRootDigest,
    previousWorkspaceRootDigest: input.previousWorkspaceRootDigest,
    artifactDigests: [...slotArtifactDigests].sort(),
  };
  if (encodeJson(unsigned).byteLength > MAX_ROOT_SLOT_BYTES) {
    throw new Error("runtime root slot is too large");
  }
  const slot = await signedSlot(unsigned);
  const slotName = slot.generation % 2 === 1 ? "root-a.json" : "root-b.json";
  await writeFile(roots, slotName, encodeJson(slot));
  const verified = await parseSlot(await readFile(roots, slotName));
  if (verified.workspaceRootDigest !== input.workspaceRootDigest) {
    throw new Error("OPFS root commit verification failed");
  }
  return verified;
}

export async function recoverRuntimeWorkspace(
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot | undefined> {
  const { objects, roots } = await storeDirectories(root);
  return recoverFromDirectories(objects, roots);
}

/**
 * Recover only a checksum-valid root slot whose root object is intact.
 * Requested artifacts must still be verified individually before use. Full
 * closure recovery remains `recoverRuntimeWorkspace`.
 */
export async function recoverRuntimeWorkspaceHead(
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot | undefined> {
  const { objects, roots } = await storeDirectories(root);
  return recoverHeadFromDirectories(objects, roots);
}

/** All independently recoverable alternating roots, newest first. */
export async function recoverRuntimeWorkspaceRoots(
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot[]> {
  const { objects, roots } = await storeDirectories(root);
  return recoverableSlotsFromDirectories(objects, roots);
}

export async function readRuntimeObject(
  root: FileSystemDirectoryHandle,
  digest: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  const { objects } = await storeDirectories(root);
  return readVerifiedObject(objects, digest, maxBytes);
}

/**
 * Read an untrusted prefix for format selection without loading a large object.
 * The caller must verify the complete selected object with `readRuntimeObject`
 * before using it as authority. Exact total size is checked here so a closure
 * descriptor cannot point the probe at a truncated or oversized file.
 */
export async function readRuntimeObjectPrefix(
  root: FileSystemDirectoryHandle,
  digest: string,
  expectedSize: number,
  prefixBytes: number,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    !Number.isSafeInteger(prefixBytes) ||
    prefixBytes < 0
  ) {
    throw new Error("invalid OPFS object prefix bounds");
  }
  if (maxBytes !== undefined && expectedSize > maxBytes) {
    throw new Error(`file exceeds the ${maxBytes} byte read limit`);
  }
  const { objects } = await storeDirectories(root);
  const { directory, name } = await objectDirectory(objects, digest, false);
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();
  if (file.size !== expectedSize) {
    throw new Error(`persisted OPFS object size mismatch: ${digest}`);
  }
  return new Uint8Array(
    await file.slice(0, Math.min(prefixBytes, expectedSize)).arrayBuffer(),
  );
}

type HistoryRootCommit = {
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  artifactDigests: string[];
  inputDigest?: string;
  optionsDigest?: string;
  assignmentDigests?: Record<string, string>;
};

function decodeHistoryRoot(bytes: Uint8Array): HistoryRootCommit {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HistoryRootCommit;
  parsed.previousWorkspaceRootDigest ??= null;
  parsed.artifactDigests ??= [];
  if (
    typeof parsed.workspaceId !== "string" ||
    (parsed.previousWorkspaceRootDigest !== null &&
      typeof parsed.previousWorkspaceRootDigest !== "string") ||
    !Array.isArray(parsed.artifactDigests) ||
    parsed.artifactDigests.length > MAX_ROOT_SLOT_ARTIFACTS ||
    new Set(parsed.artifactDigests).size !== parsed.artifactDigests.length ||
    (parsed.inputDigest !== undefined && typeof parsed.inputDigest !== "string") ||
    (parsed.optionsDigest !== undefined && typeof parsed.optionsDigest !== "string") ||
    (parsed.assignmentDigests !== undefined &&
      (typeof parsed.assignmentDigests !== "object" ||
        Array.isArray(parsed.assignmentDigests)))
  ) {
    throw new Error("invalid committed workspace root");
  }
  digestHex(parsed.workspaceId);
  if (parsed.previousWorkspaceRootDigest !== null) {
    digestHex(parsed.previousWorkspaceRootDigest);
  }
  if (parsed.inputDigest) digestHex(parsed.inputDigest);
  if (parsed.optionsDigest) digestHex(parsed.optionsDigest);
  for (const digest of parsed.artifactDigests) digestHex(digest);
  for (const digest of Object.values(parsed.assignmentDigests ?? {})) digestHex(digest);
  return parsed;
}

function directRootDigests(
  rootDigest: string,
  commit: HistoryRootCommit,
): Set<string> {
  return new Set([
    rootDigest,
    ...(commit.inputDigest ? [commit.inputDigest] : []),
    ...(commit.optionsDigest ? [commit.optionsDigest] : []),
    ...Object.values(commit.assignmentDigests ?? {}),
    ...commit.artifactDigests,
  ]);
}

async function collectCommittedHistoryFromObjects(
  objects: FileSystemDirectoryHandle,
  headRootDigest: string,
): Promise<{ workspaceId: string; digests: string[]; rootDigests: string[] }> {
  digestHex(headRootDigest);
  const digests = new Set<string>();
  const rootDigests: string[] = [];
  const seenRoots = new Set<string>();
  let workspaceId: string | undefined;
  let rootDigest: string | null = headRootDigest;
  while (rootDigest !== null) {
    if (seenRoots.has(rootDigest)) {
      throw new Error(`workspace history contains a root cycle at ${rootDigest}`);
    }
    if (seenRoots.size >= MAX_HISTORY_ROOTS) {
      throw new Error(`workspace history exceeds ${MAX_HISTORY_ROOTS} roots`);
    }
    seenRoots.add(rootDigest);
    rootDigests.push(rootDigest);
    const commit = decodeHistoryRoot(await readVerifiedObject(objects, rootDigest));
    workspaceId ??= commit.workspaceId;
    if (commit.workspaceId !== workspaceId) {
      throw new Error("workspace history crosses workspace identities");
    }
    for (const digest of directRootDigests(rootDigest, commit)) {
      digests.add(digest);
      if (digests.size > MAX_CLOSURE_OBJECTS) {
        throw new Error(`workspace history exceeds ${MAX_CLOSURE_OBJECTS} objects`);
      }
    }
    rootDigest = commit.previousWorkspaceRootDigest;
  }
  if (!workspaceId) throw new Error("workspace history is empty");
  for (const digest of digests) await readVerifiedObject(objects, digest);
  return { workspaceId, digests: [...digests].sort(), rootDigests };
}

export async function collectRuntimeHistoryDigests(
  root: FileSystemDirectoryHandle,
  headRootDigest: string,
): Promise<string[]> {
  const { objects } = await storeDirectories(root);
  return (await collectCommittedHistoryFromObjects(objects, headRootDigest)).digests;
}

export async function verifyRuntimeWorkspace(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
): Promise<void> {
  const { objects } = await storeDirectories(root);
  await parseSlot(encodeJson(slot));
  if (!slot.artifactDigests.includes(slot.workspaceRootDigest)) {
    throw new Error("workspace slot does not retain its root object");
  }
  const history = await collectCommittedHistoryFromObjects(
    objects,
    slot.workspaceRootDigest,
  );
  const head = decodeHistoryRoot(
    await readVerifiedObject(objects, slot.workspaceRootDigest),
  );
  if (
    history.workspaceId !== head.workspaceId ||
    head.previousWorkspaceRootDigest !== slot.previousWorkspaceRootDigest ||
    [...directRootDigests(slot.workspaceRootDigest, head)].some(
      (digest) => !slot.artifactDigests.includes(digest),
    )
  ) {
    throw new Error("workspace slot does not match its committed head root");
  }
}

export async function exportRuntimeClosure(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
): Promise<Uint8Array> {
  await verifyRuntimeWorkspace(root, slot);
  const rootCommit = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, slot.workspaceRootDigest),
    ),
  ) as { workspaceId?: string };
  if (!rootCommit.workspaceId) {
    throw new Error("workspace root is missing its workspace identity");
  }
  digestHex(rootCommit.workspaceId);
  const sorted = await collectRuntimeHistoryDigests(
    root,
    slot.workspaceRootDigest,
  );
  const payloads: Uint8Array[] = [];
  let offset = 0;
  const objects = [];
  for (const digest of sorted) {
    const bytes = await readRuntimeObject(root, digest);
    objects.push({ digest, size: bytes.byteLength, offset });
    payloads.push(bytes);
    offset += bytes.byteLength;
  }
  const manifest: RuntimeClosureManifest = {
    protocolVersion: "chronicle-runtime-closure/v1",
    workspaceId: rootCommit.workspaceId,
    workspaceRootDigest: slot.workspaceRootDigest,
    previousWorkspaceRootDigest: slot.previousWorkspaceRootDigest,
    objects,
  };
  const manifestBytes = encodeJson(manifest);
  if (manifestBytes.byteLength > MAX_CLOSURE_MANIFEST_BYTES) {
    throw new Error("runtime closure manifest is too large");
  }
  const archive = new Uint8Array(
    CLOSURE_MAGIC.byteLength + 4 + manifestBytes.byteLength + offset,
  );
  archive.set(CLOSURE_MAGIC, 0);
  new DataView(archive.buffer).setUint32(
    CLOSURE_MAGIC.byteLength,
    manifestBytes.byteLength,
    true,
  );
  const payloadStart = CLOSURE_MAGIC.byteLength + 4 + manifestBytes.byteLength;
  archive.set(manifestBytes, CLOSURE_MAGIC.byteLength + 4);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    const entry = objects[index];
    if (payload === undefined || entry === undefined) {
      throw new Error("runtime closure payload and object tables diverged");
    }
    archive.set(payload, payloadStart + entry.offset);
  }
  return archive;
}

function parseRuntimeClosure(archive: Uint8Array): RuntimeClosureInspection {
  if (
    archive.byteLength < CLOSURE_MAGIC.byteLength + 4 ||
    !CLOSURE_MAGIC.every((byte, index) => archive[index] === byte)
  ) {
    throw new Error("invalid runtime closure magic");
  }
  const manifestSize = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  ).getUint32(CLOSURE_MAGIC.byteLength, true);
  if (
    manifestSize === 0 ||
    manifestSize > MAX_CLOSURE_MANIFEST_BYTES ||
    CLOSURE_MAGIC.byteLength + 4 + manifestSize > archive.byteLength
  ) {
    throw new Error("invalid runtime closure manifest size");
  }
  const payloadStart = CLOSURE_MAGIC.byteLength + 4 + manifestSize;
  const manifest = JSON.parse(
    new TextDecoder().decode(
      archive.subarray(CLOSURE_MAGIC.byteLength + 4, payloadStart),
    ),
  ) as RuntimeClosureManifest;
  if (
    manifest.protocolVersion !== "chronicle-runtime-closure/v1" ||
    manifest.objects.length > MAX_CLOSURE_OBJECTS
  ) {
    throw new Error("unsupported runtime closure manifest");
  }
  digestHex(manifest.workspaceId);
  digestHex(manifest.workspaceRootDigest);
  if (manifest.previousWorkspaceRootDigest !== null) {
    digestHex(manifest.previousWorkspaceRootDigest);
  }
  const seen = new Set<string>();
  const entriesByDigest = new Map<string, RuntimeClosureManifest["objects"][number]>();
  let expectedOffset = 0;
  for (const object of manifest.objects) {
    digestHex(object.digest);
    if (
      seen.has(object.digest) ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0 ||
      object.offset !== expectedOffset ||
      payloadStart + object.offset + object.size > archive.byteLength
    ) {
      throw new Error("invalid runtime closure object table");
    }
    seen.add(object.digest);
    entriesByDigest.set(object.digest, object);
    expectedOffset += object.size;
  }
  if (
    payloadStart + expectedOffset !== archive.byteLength ||
    !seen.has(manifest.workspaceRootDigest)
  ) {
    throw new Error("runtime closure payload is incomplete");
  }
  return {
    manifest,
    object(digest) {
      const entry = entriesByDigest.get(digest);
      if (!entry) throw new Error(`runtime closure object is missing: ${digest}`);
      return archive.subarray(
        payloadStart + entry.offset,
        payloadStart + entry.offset + entry.size,
      );
    },
  };
}

export function runtimeClosureWorkspaceId(archive: Uint8Array): string {
  return parseRuntimeClosure(archive).manifest.workspaceId;
}

export async function importRuntimeClosure(
  root: FileSystemDirectoryHandle,
  archive: Uint8Array,
  verify: (closure: RuntimeClosureInspection) => Promise<void>,
): Promise<WorkspaceRootSlot> {
  const closure = parseRuntimeClosure(archive);
  const artifacts: PersistedRuntimeArtifact[] = [];
  for (const object of closure.manifest.objects) {
    const bytes = closure.object(object.digest);
    if ((await sha256(bytes)) !== object.digest) {
      throw new Error(`runtime closure object digest mismatch: ${object.digest}`);
    }
    artifacts.push({
      kind:
        object.digest === closure.manifest.workspaceRootDigest
          ? "workspace-root-json"
          : "closure-object",
      digest: object.digest,
      size: object.size,
      bytes,
      digestVerified: true,
    });
  }
  await verify(closure);
  const current = await recoverRuntimeWorkspace(root);
  if (current?.workspaceRootDigest === closure.manifest.workspaceRootDigest) {
    await verifyRuntimeWorkspace(root, current);
    return current;
  }
  const seenRoots = new Set<string>();
  let importedRoot: string | null = closure.manifest.workspaceRootDigest;
  while (importedRoot !== null) {
    if (seenRoots.has(importedRoot) || seenRoots.size >= MAX_HISTORY_ROOTS) {
      throw new Error("runtime closure history is cyclic or too large");
    }
    seenRoots.add(importedRoot);
    const commit = decodeHistoryRoot(closure.object(importedRoot));
    if (commit.workspaceId !== closure.manifest.workspaceId) {
      throw new Error("runtime closure history crosses workspace identities");
    }
    importedRoot = commit.previousWorkspaceRootDigest;
  }
  if (current && !seenRoots.has(current.workspaceRootDigest)) {
    throw new Error("runtime closure diverges from the existing workspace history");
  }
  const headCommit = decodeHistoryRoot(
    closure.object(closure.manifest.workspaceRootDigest),
  );
  if (
    headCommit.workspaceId !== closure.manifest.workspaceId ||
    headCommit.previousWorkspaceRootDigest !==
      closure.manifest.previousWorkspaceRootDigest
  ) {
    throw new Error("runtime closure head does not match its outer manifest");
  }
  return persistRuntimeWorkspace(root, {
    workspaceRootDigest: closure.manifest.workspaceRootDigest,
    previousWorkspaceRootDigest:
      closure.manifest.previousWorkspaceRootDigest,
    artifacts,
    recoveredSlot: current,
    verifiedDetachedHistory: current === undefined,
    slotArtifactDigests: [
      ...directRootDigests(closure.manifest.workspaceRootDigest, headCommit),
    ],
  });
}

export async function garbageCollectRuntimeObjects(
  root: FileSystemDirectoryHandle,
  retainedRoots: readonly WorkspaceRootSlot[],
): Promise<number> {
  const { objects } = await storeDirectories(root);
  const retained = new Set<string>();
  for (const slot of retainedRoots) {
    const history = await collectCommittedHistoryFromObjects(
      objects,
      slot.workspaceRootDigest,
    );
    for (const digest of history.digests) retained.add(digestHex(digest));
  }
  let removed = 0;
  for await (const [prefix, handle] of (
    objects as IterableDirectoryHandle
  ).entries()) {
    if (handle.kind !== "directory") continue;
    const directory = handle;
    for await (const [name, entry] of (
      directory as IterableDirectoryHandle
    ).entries()) {
      if (entry.kind === "file" && !retained.has(`${prefix}${name}`)) {
        await directory.removeEntry(name);
        removed += 1;
      }
    }
  }
  return removed;
}

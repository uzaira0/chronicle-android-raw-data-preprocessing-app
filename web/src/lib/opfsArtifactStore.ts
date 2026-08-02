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
/**
 * Scratch directory for `probeOpfsCapability`. Deliberately a sibling of the
 * workspace tree so a probe write can never collide with, or be mistaken for,
 * a content-addressed object or a root slot.
 */
const OPFS_CAPABILITY_PROBE_DIRECTORY = "chronicle-capability-probe-v1";
const OBJECTS_DIRECTORY = "objects";
const ROOTS_DIRECTORY = "roots";
const CLOSURE_MAGIC = new TextEncoder().encode("CHRONICLE-CLOSURE-V1\n");
const CLOSURE_ARCHIVE_MIME = "application/vnd.chronicle.workspace";
/**
 * How many payload bytes may sit in the JS heap before the archive builder
 * hands them to blob storage. This is the export path's memory bound: peak heap
 * is this budget plus the single object currently being read and hashed, never
 * the size of the closure.
 */
const CLOSURE_STAGING_BYTES = 4 * 1024 * 1024;
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

/**
 * An artifact whose bytes are produced on demand rather than held by the caller.
 *
 * Every object write goes through this shape, so persisting N artifacts never
 * requires N live buffers: `read()` is called once, immediately before that one
 * object is verified and placed, and its bytes are released before the next
 * object is read. `PersistedRuntimeArtifact` callers are adapted by
 * `eagerArtifactSource` and behave exactly as before.
 */
type PersistedRuntimeArtifactSource = PersistedRuntimeArtifactMetadata & {
  digestVerified?: true;
  read: () => Promise<Uint8Array>;
};

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
  /** Read exactly one declared object out of the archive. */
  object(digest: string): Promise<Uint8Array>;
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
    // Copy unless the view already spans its whole buffer. Two engine facts
    // force this, and only one of them was previously handled:
    //  - a SharedArrayBuffer-backed view is not an accepted BufferSource;
    //  - WebKit's FileSystemWritableFileStream.write() IGNORES byteOffset and
    //    byteLength and writes the ENTIRE underlying ArrayBuffer (measured on
    //    WebKit 26.4: a 10-byte subarray of a 100-byte buffer wrote 100 bytes;
    //    Chromium 147 and Firefox 148 wrote 10). `importRuntimeClosure` hands
    //    this function subarray views over one archive buffer, so on Safari
    //    every imported object was being written as the whole archive.
    const owned =
      bytes.buffer instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength
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

function eagerArtifactSource(
  artifact: PersistedRuntimeArtifact,
): PersistedRuntimeArtifactSource {
  const { bytes, ...metadata } = artifact;
  return { ...metadata, read: () => Promise.resolve(bytes) };
}

/**
 * Read, verify, and write one object. Scoped separately from the read-back
 * check below so the source bytes are unreachable before the stored copy is
 * read: holding both at once doubled peak memory for the largest artifact in a
 * closure for no added guarantee.
 */
async function writeVerifiedObject(
  directory: FileSystemDirectoryHandle,
  name: string,
  artifact: PersistedRuntimeArtifactSource,
): Promise<boolean> {
  const bytes = await artifact.read();
  if (bytes.byteLength !== artifact.size) {
    throw new Error(`artifact size mismatch for ${artifact.kind}`);
  }
  if (!artifact.digestVerified) {
    const actual = await sha256(bytes);
    if (actual !== artifact.digest) {
      throw new Error(`artifact digest mismatch for ${artifact.kind}`);
    }
  }
  try {
    const existing = await readFile(directory, name);
    if (existing.byteLength === artifact.size && (await sha256(existing)) === artifact.digest) {
      return true;
    }
  } catch {
    // Missing or unreadable objects are repaired by the verified write below.
  }
  await writeFile(directory, name, bytes);
  return false;
}

async function putObject(
  objects: FileSystemDirectoryHandle,
  artifact: PersistedRuntimeArtifactSource,
): Promise<void> {
  const { directory, name } = await objectDirectory(objects, artifact.digest, true);
  if (await writeVerifiedObject(directory, name, artifact)) return;
  const stored = await readFile(directory, name);
  if (stored.byteLength !== artifact.size) {
    // Naming the observed size is what turned a WebKit corruption into a
    // one-line diagnosis: "wrote 812, read back 6291456" is the engine storing
    // a view's whole backing buffer, not a random I/O fault.
    throw new Error(
      `OPFS verification failed for ${artifact.kind}: wrote ${artifact.size} bytes, read back ${stored.byteLength}`,
    );
  }
  if ((await sha256(stored)) !== artifact.digest) {
    throw new Error(
      `OPFS verification failed for ${artifact.kind}: ${artifact.size} bytes stored with a different digest`,
    );
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
  await Promise.all(
    artifacts.map((artifact) => putObject(objects, eagerArtifactSource(artifact))),
  );
}

/** Byte length of a stored object from filesystem metadata, without reading it. */
async function storedObjectByteLength(
  objects: FileSystemDirectoryHandle,
  digest: string,
): Promise<number> {
  const { directory, name } = await objectDirectory(objects, digest, false);
  const handle = await directory.getFileHandle(name);
  return (await handle.getFile()).size;
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

function capabilityErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prove the exact primitives this module persists with — `createWritable`
 * followed by a verified `getFile` read-back — rather than only proving that
 * the OPFS entry points exist.
 *
 * A browser that hands out a directory handle but refuses writes (private
 * browsing, a denied or exhausted quota, a sandbox that stubs the API) would
 * otherwise pass an existence-only probe and then lose the run at commit time.
 * Removal is best-effort on purpose: durability never depends on deletion, only
 * `garbageCollectRuntimeObjects` does, so a leftover 32-byte probe file must not
 * be reported as a durability failure.
 */
async function probeVerifiedRoundTrip(
  root: FileSystemDirectoryHandle,
): Promise<string | null> {
  // A unique name per probe: the boot probe, the worker probe and a second tab
  // can all be in flight at once, and a shared file name would make them read
  // back each other's random bytes and report a false failure.
  const expected = crypto.getRandomValues(new Uint8Array(32));
  const name = `round-trip-${Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}.bin`;
  let probeDirectory: FileSystemDirectoryHandle;
  try {
    probeDirectory = await root.getDirectoryHandle(
      OPFS_CAPABILITY_PROBE_DIRECTORY,
      { create: true },
    );
  } catch (error) {
    return `Origin-private file storage is readable but no directory can be created: ${capabilityErrorText(
      error,
    )}`;
  }
  try {
    await writeFile(probeDirectory, name, expected);
  } catch (error) {
    return `Origin-private file storage is open but not writable: ${capabilityErrorText(
      error,
    )}`;
  }
  let readBack: Uint8Array;
  try {
    readBack = await readFile(probeDirectory, name);
  } catch (error) {
    return `Origin-private file storage accepted a write it cannot read back: ${capabilityErrorText(
      error,
    )}`;
  }
  if (
    readBack.byteLength !== expected.byteLength ||
    readBack.some((byte, index) => byte !== expected[index])
  ) {
    return "Origin-private file storage returned different bytes than were written, so verified persistence is impossible.";
  }
  try {
    await probeDirectory.removeEntry(name);
  } catch {
    // Deletion is not a durability primitive; a stale probe file is harmless.
  }
  return null;
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
    const root = await openOpfsRoot();
    const roundTripFailure = await probeVerifiedRoundTrip(root);
    if (roundTripFailure !== null) {
      return { status: "unavailable", reason: roundTripFailure };
    }
    const evictionProtected = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : null;
    return { status: "ready", evictionProtected };
  } catch (error) {
    return {
      status: "unavailable",
      reason: `Origin-private file storage could not be opened: ${capabilityErrorText(
        error,
      )}`,
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
  return persistRuntimeWorkspaceFromSources(root, {
    ...input,
    artifacts: input.artifacts.map(eagerArtifactSource),
  });
}

/**
 * The single persist implementation. Callers that already hold every buffer
 * (normal execution commits) reach it through `persistRuntimeWorkspace`;
 * callers streaming from an archive supply sources that read one object at a
 * time. Nothing below ever retains an object's bytes past its own write.
 */
async function persistRuntimeWorkspaceFromSources(
  root: FileSystemDirectoryHandle,
  input: {
    workspaceRootDigest: string;
    previousWorkspaceRootDigest: string | null;
    artifacts: readonly PersistedRuntimeArtifactSource[];
    recoveredSlot?: WorkspaceRootSlot;
    verifiedDetachedHistory?: boolean;
    slotArtifactDigests?: string[];
  },
): Promise<WorkspaceRootSlot> {
  digestHex(input.workspaceRootDigest);
  const { objects, roots } = await storeDirectories(root);
  const byDigest = new Map<string, PersistedRuntimeArtifactSource>();
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
        ? await artifact.read()
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
 * Assemble the closure archive without ever holding it in the JS heap.
 *
 * Staged chunks are handed to a `Blob` once they reach `CLOSURE_STAGING_BYTES`;
 * the Blob constructor copies them into browser-managed (disk-backed) blob
 * storage and the JS references are dropped. The final `Blob` is a list of
 * those parts by reference, so the archive can be many times larger than the
 * heap that produced it.
 */
class ClosureArchiveBuilder {
  private readonly parts: Blob[] = [];
  private staged: BlobPart[] = [];
  private stagedBytes = 0;

  append(bytes: Uint8Array): void {
    this.staged.push(bytes as BlobPart);
    this.stagedBytes += bytes.byteLength;
    if (this.stagedBytes >= CLOSURE_STAGING_BYTES) this.flush();
  }

  private flush(): void {
    if (this.staged.length === 0) return;
    this.parts.push(new Blob(this.staged));
    this.staged = [];
    this.stagedBytes = 0;
  }

  finish(): Blob {
    this.flush();
    return new Blob(this.parts, { type: CLOSURE_ARCHIVE_MIME });
  }
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
    artifacts: readonly PersistedRuntimeArtifactMetadata[];
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

/**
 * Stream the complete verified closure into a portable archive.
 *
 * Format (unchanged, `chronicle-runtime-closure/v1`): magic, a little-endian
 * u32 manifest length, the manifest JSON, then every object's payload
 * back-to-back in manifest order at the declared offsets. Because the manifest
 * precedes the payload and declares each object's exact offset and size, the
 * archive is consumable one object at a time in both directions — no version
 * bump is needed to stream it, and archives written by the previous
 * whole-buffer writer are byte-identical to these.
 *
 * Two passes over the object table keep peak heap flat: pass one reads only
 * filesystem sizes so the manifest can be written first, pass two reads,
 * digest-verifies, and appends one object at a time.
 */
export async function exportRuntimeClosure(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
): Promise<Blob> {
  await verifyRuntimeWorkspace(root, slot);
  const rootCommit = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, slot.workspaceRootDigest),
    ),
  ) as { workspaceId?: string };
  // Unreachable: verifyRuntimeWorkspace above already decoded this exact root
  // via decodeHistoryRoot, which rejects a non-string workspaceId. Kept as a
  // type-narrowing guard for the manifest below.
  /* v8 ignore start */
  if (!rootCommit.workspaceId) {
    throw new Error("workspace root is missing its workspace identity");
  }
  /* v8 ignore stop */
  digestHex(rootCommit.workspaceId);
  const sorted = await collectRuntimeHistoryDigests(
    root,
    slot.workspaceRootDigest,
  );
  const { objects: objectDirectoryHandle } = await storeDirectories(root);
  let offset = 0;
  const objects = [];
  for (const digest of sorted) {
    const size = await storedObjectByteLength(objectDirectoryHandle, digest);
    objects.push({ digest, size, offset });
    offset += size;
  }
  const manifest: RuntimeClosureManifest = {
    protocolVersion: "chronicle-runtime-closure/v1",
    workspaceId: rootCommit.workspaceId,
    workspaceRootDigest: slot.workspaceRootDigest,
    previousWorkspaceRootDigest: slot.previousWorkspaceRootDigest,
    objects,
  };
  const manifestBytes = encodeJson(manifest);
  // Unreachable while MAX_CLOSURE_OBJECTS holds: 100k manifest entries encode
  // to ~12 MiB, under the 16 MiB cap, and commits reject larger histories.
  // Kept so a future constant change cannot silently produce a corrupt header.
  /* v8 ignore start */
  if (manifestBytes.byteLength > MAX_CLOSURE_MANIFEST_BYTES) {
    throw new Error("runtime closure manifest is too large");
  }
  /* v8 ignore stop */
  const header = new Uint8Array(CLOSURE_MAGIC.byteLength + 4);
  header.set(CLOSURE_MAGIC, 0);
  new DataView(header.buffer).setUint32(
    CLOSURE_MAGIC.byteLength,
    manifestBytes.byteLength,
    true,
  );
  const builder = new ClosureArchiveBuilder();
  builder.append(header);
  builder.append(manifestBytes);
  for (const entry of objects) {
    const payload = await readVerifiedObject(objectDirectoryHandle, entry.digest);
    // The manifest was written from filesystem metadata. A payload that no
    // longer matches its declared length would silently shift every later
    // offset, so it fails the export instead.
    if (payload.byteLength !== entry.size) {
      throw new Error(`runtime closure object changed while exporting: ${entry.digest}`);
    }
    builder.append(payload);
  }
  return builder.finish();
}

async function readArchiveRange(
  archive: Blob,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return new Uint8Array(await archive.slice(start, end).arrayBuffer());
}

/**
 * Read and fully validate the archive framing and object table without reading
 * a single payload byte, then expose an accessor that reads exactly one object
 * on demand.
 *
 * Every structural check the whole-buffer parser made is made here, from the
 * manifest plus `archive.size` alone: contiguous ascending offsets, no
 * duplicate digests, non-negative safe-integer sizes, the root object present,
 * and a total that lands exactly on the end of the archive. A truncated archive
 * — including one cut in the middle of an object — therefore fails before any
 * object is hashed and long before anything is written.
 */
async function openRuntimeClosure(archive: Blob): Promise<RuntimeClosureInspection> {
  const headerSize = CLOSURE_MAGIC.byteLength + 4;
  if (archive.size < headerSize) {
    throw new Error("invalid runtime closure magic");
  }
  const header = await readArchiveRange(archive, 0, headerSize);
  if (!CLOSURE_MAGIC.every((byte, index) => header[index] === byte)) {
    throw new Error("invalid runtime closure magic");
  }
  const manifestSize = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  ).getUint32(CLOSURE_MAGIC.byteLength, true);
  if (
    manifestSize === 0 ||
    manifestSize > MAX_CLOSURE_MANIFEST_BYTES ||
    headerSize + manifestSize > archive.size
  ) {
    throw new Error("invalid runtime closure manifest size");
  }
  const payloadStart = headerSize + manifestSize;
  const manifest = JSON.parse(
    new TextDecoder().decode(
      await readArchiveRange(archive, headerSize, payloadStart),
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
      payloadStart + object.offset + object.size > archive.size
    ) {
      throw new Error("invalid runtime closure object table");
    }
    seen.add(object.digest);
    entriesByDigest.set(object.digest, object);
    expectedOffset += object.size;
  }
  if (
    payloadStart + expectedOffset !== archive.size ||
    !seen.has(manifest.workspaceRootDigest)
  ) {
    throw new Error("runtime closure payload is incomplete");
  }
  return {
    manifest,
    async object(digest) {
      const entry = entriesByDigest.get(digest);
      if (!entry) throw new Error(`runtime closure object is missing: ${digest}`);
      const bytes = await readArchiveRange(
        archive,
        payloadStart + entry.offset,
        payloadStart + entry.offset + entry.size,
      );
      // `Blob.slice` clamps silently, so a source that shrank underneath an
      // already-validated table would otherwise yield a short object.
      if (bytes.byteLength !== entry.size) {
        throw new Error(`runtime closure object is truncated: ${digest}`);
      }
      return bytes;
    },
  };
}

export async function runtimeClosureWorkspaceId(archive: Blob): Promise<string> {
  return (await openRuntimeClosure(archive)).manifest.workspaceId;
}

/**
 * Import a portable closure, consuming it one object at a time.
 *
 * The fail-closed order is exactly the whole-buffer path's order, and nothing
 * is written until all of it has passed: framing and object table, then every
 * object rehashed against its declared digest, then the caller's semantic
 * closure verification, then the workspace-identity and history checks. Only
 * after that are objects placed (again one at a time, re-read from the
 * archive), and the alternating root slot advances last, so a rejection at any
 * point leaves no workspace state visible.
 */
export async function importRuntimeClosure(
  root: FileSystemDirectoryHandle,
  archive: Blob,
  verify: (closure: RuntimeClosureInspection) => Promise<void>,
): Promise<WorkspaceRootSlot> {
  const closure = await openRuntimeClosure(archive);
  const artifacts: PersistedRuntimeArtifactSource[] = [];
  for (const object of closure.manifest.objects) {
    // Read, hash, compare, release. Only the verified metadata survives the
    // iteration; the bytes are read again when this object is actually placed.
    if ((await sha256(await closure.object(object.digest))) !== object.digest) {
      throw new Error(`runtime closure object digest mismatch: ${object.digest}`);
    }
    artifacts.push({
      kind:
        object.digest === closure.manifest.workspaceRootDigest
          ? "workspace-root-json"
          : "closure-object",
      digest: object.digest,
      size: object.size,
      read: () => closure.object(object.digest),
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
    const commit = decodeHistoryRoot(await closure.object(importedRoot));
    if (commit.workspaceId !== closure.manifest.workspaceId) {
      throw new Error("runtime closure history crosses workspace identities");
    }
    importedRoot = commit.previousWorkspaceRootDigest;
  }
  if (current && !seenRoots.has(current.workspaceRootDigest)) {
    throw new Error("runtime closure diverges from the existing workspace history");
  }
  const headCommit = decodeHistoryRoot(
    await closure.object(closure.manifest.workspaceRootDigest),
  );
  if (
    headCommit.workspaceId !== closure.manifest.workspaceId ||
    headCommit.previousWorkspaceRootDigest !==
      closure.manifest.previousWorkspaceRootDigest
  ) {
    throw new Error("runtime closure head does not match its outer manifest");
  }
  return persistRuntimeWorkspaceFromSources(root, {
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

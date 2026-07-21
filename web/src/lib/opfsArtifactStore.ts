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

export type PersistedRuntimeArtifact = {
  kind: string;
  digest: string;
  size: number;
  bytes: Uint8Array;
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
  const owned = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
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
    await writable.write(Uint8Array.from(bytes));
  } finally {
    await writable.close();
  }
}

async function readFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<Uint8Array> {
  const handle = await directory.getFileHandle(name);
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
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
  const actual = await sha256(artifact.bytes);
  if (actual !== artifact.digest) {
    throw new Error(`artifact digest mismatch for ${artifact.kind}`);
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

async function readVerifiedObject(
  objects: FileSystemDirectoryHandle,
  digest: string,
): Promise<Uint8Array> {
  const { directory, name } = await objectDirectory(objects, digest, false);
  const bytes = await readFile(directory, name);
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
    checksum !== (await sha256(encodeJson(unsigned)))
  ) {
    throw new Error("invalid OPFS root slot");
  }
  digestHex(parsed.workspaceRootDigest);
  for (const digest of parsed.artifactDigests) digestHex(digest);
  return parsed;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function recoverableSlotsFromDirectories(
  objects: FileSystemDirectoryHandle,
  roots: FileSystemDirectoryHandle,
): Promise<WorkspaceRootSlot[]> {
  const candidates: WorkspaceRootSlot[] = [];
  let rootSlotObserved = false;
  for (const name of ["root-a.json", "root-b.json"]) {
    try {
      const bytes = await readFile(roots, name);
      rootSlotObserved = true;
      candidates.push(await parseSlot(bytes));
    } catch (error) {
      if (!isNotFoundError(error)) rootSlotObserved = true;
      // Alternating slots are intentionally independent: one torn/corrupt slot
      // must not prevent recovery from the other.
    }
  }
  candidates.sort((left, right) => right.generation - left.generation);
  const recovered: WorkspaceRootSlot[] = [];
  for (const candidate of candidates) {
    try {
      await readVerifiedObject(objects, candidate.workspaceRootDigest);
      for (const digest of candidate.artifactDigests) {
        await readVerifiedObject(objects, digest);
      }
      recovered.push(candidate);
    } catch {
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
  return (await recoverableSlotsFromDirectories(objects, roots))[0];
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

export async function persistRuntimeWorkspace(
  root: FileSystemDirectoryHandle,
  input: {
    workspaceRootDigest: string;
    previousWorkspaceRootDigest: string | null;
    artifacts: PersistedRuntimeArtifact[];
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
  for (const artifact of byDigest.values()) await putObject(objects, artifact);
  const previous = await recoverFromDirectories(objects, roots);
  const unsigned: UnsignedWorkspaceRootSlot = {
    protocolVersion: "chronicle-opfs-root/v1",
    generation: (previous?.generation ?? 0) + 1,
    workspaceRootDigest: input.workspaceRootDigest,
    previousWorkspaceRootDigest: input.previousWorkspaceRootDigest,
    artifactDigests: [...byDigest.keys()].sort(),
  };
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
): Promise<Uint8Array> {
  const { objects } = await storeDirectories(root);
  return readVerifiedObject(objects, digest);
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
  for (const digest of slot.artifactDigests) {
    await readVerifiedObject(objects, digest);
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
  const sorted = [...new Set(slot.artifactDigests)].sort();
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
    archive.set(payloads[index], payloadStart + objects[index].offset);
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
  const seen = new Set<string>();
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
      const entry = manifest.objects.find((object) => object.digest === digest);
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
    });
  }
  await verify(closure);
  return persistRuntimeWorkspace(root, {
    workspaceRootDigest: closure.manifest.workspaceRootDigest,
    previousWorkspaceRootDigest:
      closure.manifest.previousWorkspaceRootDigest,
    artifacts,
  });
}

export async function garbageCollectRuntimeObjects(
  root: FileSystemDirectoryHandle,
  retainedRoots: readonly WorkspaceRootSlot[],
): Promise<number> {
  const { objects } = await storeDirectories(root);
  const retained = new Set<string>();
  for (const slot of retainedRoots) {
    retained.add(digestHex(slot.workspaceRootDigest));
    for (const digest of slot.artifactDigests) retained.add(digestHex(digest));
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

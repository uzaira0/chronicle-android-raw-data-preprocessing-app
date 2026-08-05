import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  collectRuntimeHistoryDigests,
  commitPersistedRuntimeWorkspace,
  detectLegacyOpfsState,
  garbageCollectRuntimeObjects,
  exportRuntimeClosure,
  importRuntimeClosure,
  openOpfsRoot,
  openOpfsWorkspace,
  persistRuntimeObject,
  persistRuntimeObjects,
  persistRuntimeWorkspace,
  probeOpfsCapability,
  readRuntimeObject,
  readRuntimeObjectPrefix,
  recoverRuntimeWorkspace,
  recoverRuntimeWorkspaceHead,
  recoverRuntimeWorkspaceRoots,
  runtimeClosureWorkspaceId,
  type PersistedRuntimeArtifact,
  type RuntimeClosureManifest,
  type WorkspaceRootSlot,
  verifyRuntimeWorkspace,
} from "@/lib/opfsArtifactStore";

/**
 * Geometry of the last BufferSource handed to `write()`. WebKit's
 * FileSystemWritableFileStream ignores byteOffset/byteLength and writes the
 * whole underlying ArrayBuffer, so passing a partial view is a real
 * cross-browser corruption bug that an in-memory mock (which copies the view
 * faithfully) can never reproduce. Recording the geometry lets a test assert
 * the constraint directly.
 */
type WriteGeometry = { byteOffset: number; byteLength: number; bufferBytes: number };

class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes = new Uint8Array();
  reads = 0;
  lastWriteGeometry: WriteGeometry | undefined;
  nextReadError: Error | undefined;
  nextWriteTransform:
    | ((bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>)
    | undefined;

  getFile(): Promise<File> {
    this.reads += 1;
    if (this.nextReadError) {
      const error = this.nextReadError;
      this.nextReadError = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve(new File([this.bytes], "object"));
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    let pending = new Uint8Array();
    return Promise.resolve({
      write: (data: FileSystemWriteChunkType) => {
        if (data instanceof Uint8Array) {
          this.lastWriteGeometry = {
            byteOffset: data.byteOffset,
            byteLength: data.byteLength,
            bufferBytes: data.buffer.byteLength,
          };
          pending = Uint8Array.from(data);
        } else if (data instanceof ArrayBuffer) {
          this.lastWriteGeometry = {
            byteOffset: 0,
            byteLength: data.byteLength,
            bufferBytes: data.byteLength,
          };
          pending = new Uint8Array(data);
        } else throw new Error("unsupported test write");
        return Promise.resolve();
      },
      close: async () => {
        this.bytes = this.nextWriteTransform
          ? await this.nextWriteTransform(pending)
          : pending;
        this.nextWriteTransform = undefined;
      },
    } as FileSystemWritableFileStream);
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.directories.get(name);
    if (!directory && options?.create) {
      directory = new MemoryDirectoryHandle();
      this.directories.set(name, directory);
    }
    if (!directory) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(directory as unknown as FileSystemDirectoryHandle);
  }

  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new MemoryFileHandle();
      this.files.set(name, file);
    }
    if (!file) throw new DOMException("missing", "NotFoundError");
    return Promise.resolve(file as unknown as FileSystemFileHandle);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("missing", "NotFoundError");
    }
    return Promise.resolve();
  }

  async *entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  > {
    await Promise.resolve();
    for (const entry of this.directories) {
      yield [entry[0], entry[1] as unknown as FileSystemDirectoryHandle];
    }
    for (const entry of this.files) {
      yield [entry[0], entry[1] as unknown as FileSystemFileHandle];
    }
  }
}

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  if (typeof File === "undefined") {
    vi.stubGlobal(
      "File",
      class extends Blob {
        constructor(parts: BlobPart[]) {
          super(parts);
        }
      },
    );
  }
});

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await webcrypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  return `sha256:${Buffer.from(value).toString("hex")}`;
}

async function artifact(
  kind: string,
  value: string,
): Promise<PersistedRuntimeArtifact> {
  if (kind === "workspace-root-json" && !value.trimStart().startsWith("{")) {
    const testLabel = value;
    value = JSON.stringify({
      workspaceId: `sha256:${"1".repeat(64)}`,
      previousWorkspaceRootDigest: null,
      artifactDigests: [],
      testLabel,
    });
  }
  const bytes = new TextEncoder().encode(value);
  return { kind, digest: await digest(bytes), size: bytes.byteLength, bytes };
}

function rootHandle(root: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}

function objectFile(
  root: MemoryDirectoryHandle,
  objectDigest: string,
): MemoryFileHandle {
  const hex = objectDigest.slice(7);
  return root.directories
    .get("chronicle-workflow-runtime-v1")!
    .directories.get("objects")!
    .directories.get(hex.slice(0, 2))!
    .files.get(hex.slice(2))!;
}

async function signedTestSlot(
  workspaceRootDigest: string,
  previousWorkspaceRootDigest: string | null,
  generation = 1,
): Promise<WorkspaceRootSlot> {
  const unsigned = {
    protocolVersion: "chronicle-opfs-root/v1" as const,
    generation,
    workspaceRootDigest,
    previousWorkspaceRootDigest,
    artifactDigests: [workspaceRootDigest],
  };
  return {
    ...unsigned,
    checksum: await digest(new TextEncoder().encode(JSON.stringify(unsigned))),
  };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function asArchive(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart]);
}

/**
 * Wrap an archive so every range read goes through `slice`. Import must reach
 * the archive only that way, so this is how the tests observe (and perturb)
 * exactly what the streaming importer asks for.
 */
function archiveWithSliceHook(
  archive: Blob,
  slice: (start: number, end: number) => Blob,
): Blob {
  return new Proxy(archive, {
    get(target, property, receiver) {
      if (property === "slice") return slice;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function"
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * A whole-buffer implementation of the current workflow archive, retained as
 * a byte-compatibility oracle for the streaming writer.
 */
async function wholeBufferExportRuntimeClosure(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
): Promise<Uint8Array> {
  const magic = new TextEncoder().encode("CHRONICLE-WORKFLOW-CLOSURE-V1\n");
  const rootCommit = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, slot.workspaceRootDigest),
    ),
  ) as { workspaceId: string };
  const sorted = await collectRuntimeHistoryDigests(
    root,
    slot.workspaceRootDigest,
  );
  const payloads: Uint8Array[] = [];
  let offset = 0;
  const objects: Array<{ digest: string; size: number; offset: number }> = [];
  for (const objectDigest of sorted) {
    const bytes = await readRuntimeObject(root, objectDigest);
    objects.push({ digest: objectDigest, size: bytes.byteLength, offset });
    payloads.push(bytes);
    offset += bytes.byteLength;
  }
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      protocolVersion: "chronicle-runtime-closure/v1",
      workspaceId: rootCommit.workspaceId,
      workspaceRootDigest: slot.workspaceRootDigest,
      previousWorkspaceRootDigest: slot.previousWorkspaceRootDigest,
      objects,
    }),
  );
  const archive = new Uint8Array(
    magic.byteLength + 4 + manifestBytes.byteLength + offset,
  );
  archive.set(magic, 0);
  new DataView(archive.buffer).setUint32(
    magic.byteLength,
    manifestBytes.byteLength,
    true,
  );
  const payloadStart = magic.byteLength + 4 + manifestBytes.byteLength;
  archive.set(manifestBytes, magic.byteLength + 4);
  for (let index = 0; index < payloads.length; index += 1) {
    archive.set(payloads[index]!, payloadStart + objects[index]!.offset);
  }
  return archive;
}

function buildTestClosureArchive(
  workspaceId: string,
  workspaceRootDigest: string,
  previousWorkspaceRootDigest: string | null,
  artifacts: readonly PersistedRuntimeArtifact[],
): Uint8Array {
  const magic = new TextEncoder().encode("CHRONICLE-WORKFLOW-CLOSURE-V1\n");
  let offset = 0;
  const objects = artifacts.map((value) => {
    const entry = { digest: value.digest, size: value.size, offset };
    offset += value.size;
    return entry;
  });
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      protocolVersion: "chronicle-runtime-closure/v1",
      workspaceId,
      workspaceRootDigest,
      previousWorkspaceRootDigest,
      objects,
    }),
  );
  const archive = new Uint8Array(
    magic.byteLength + 4 + manifestBytes.length + offset,
  );
  archive.set(magic);
  new DataView(archive.buffer).setUint32(
    magic.byteLength,
    manifestBytes.byteLength,
    true,
  );
  let writeOffset = magic.byteLength + 4;
  archive.set(manifestBytes, writeOffset);
  writeOffset += manifestBytes.byteLength;
  for (const value of artifacts) {
    archive.set(value.bytes, writeOffset);
    writeOffset += value.size;
  }
  return archive;
}

describe("OPFS content-addressed runtime workspace", () => {
  it("detects legacy namespaces without reading or modifying them", async () => {
    const root = new MemoryDirectoryHandle();
    const legacy = new MemoryDirectoryHandle();
    legacy.files.set("opaque-object", new MemoryFileHandle());
    root.directories.set("chronicle-preprocessing-runtime-v1", legacy);

    await expect(detectLegacyOpfsState(rootHandle(root))).resolves.toEqual({
      detected: true,
      directoryNames: ["chronicle-preprocessing-runtime-v1"],
    });
    expect(legacy.files.get("opaque-object")?.reads).toBe(0);
    expect(root.directories.has("chronicle-workflow-runtime-v1")).toBe(false);
  });

  it("reports no legacy state without creating legacy directories", async () => {
    const root = new MemoryDirectoryHandle();

    await expect(detectLegacyOpfsState(rootHandle(root))).resolves.toEqual({
      detected: false,
      directoryNames: [],
    });
    expect(root.directories.size).toBe(0);
  });

  it("reads only an untrusted prefix and leaves full digest verification to the selected read", async () => {
    const root = new MemoryDirectoryHandle();
    const value = await artifact("review-base", "0123456789abcdef");
    await persistRuntimeObject(rootHandle(root), value);

    await expect(
      readRuntimeObjectPrefix(
        rootHandle(root),
        value.digest,
        value.size,
        4,
        value.size,
      ),
    ).resolves.toEqual(new TextEncoder().encode("0123"));
    await expect(
      readRuntimeObjectPrefix(
        rootHandle(root),
        value.digest,
        value.size + 1,
        4,
      ),
    ).rejects.toThrow(/size mismatch/);

    objectFile(root, value.digest).bytes[0] = "X".charCodeAt(0);
    await expect(
      readRuntimeObjectPrefix(rootHandle(root), value.digest, value.size, 4),
    ).resolves.toEqual(new TextEncoder().encode("X123"));
    await expect(
      readRuntimeObject(rootHandle(root), value.digest),
    ).rejects.toThrow(/corrupt OPFS object/);
  });

  it("persists one object, enforces bounded reads, and collects unreferenced objects", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "retained");
    const slot = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    const orphan = await artifact("app-csv", "unreferenced");
    await persistRuntimeObject(rootHandle(root), orphan);

    await expect(
      readRuntimeObject(rootHandle(root), orphan.digest, orphan.size - 1),
    ).rejects.toThrow(/read limit/);
    await expect(
      garbageCollectRuntimeObjects(rootHandle(root), [slot]),
    ).resolves.toBe(1);
    await expect(
      readRuntimeObject(rootHandle(root), orphan.digest),
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("commits alternating roots, deduplicates objects, recovers, reads, and collects", async () => {
    const root = new MemoryDirectoryHandle();
    const firstPayload = await artifact("app-csv", "first");
    const firstRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [firstPayload.digest],
      }),
    );
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstPayload],
    });
    expect(first.generation).toBe(1);
    expect(
      await readRuntimeObject(rootHandle(root), firstPayload.digest),
    ).toEqual(firstPayload.bytes);

    const secondPayload = await artifact("app-csv", "second");
    const secondRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: firstRoot.digest,
        artifactDigests: [secondPayload.digest],
      }),
    );
    const second = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      artifacts: [secondRoot, secondPayload, secondPayload],
    });
    expect(second.generation).toBe(2);
    expect(
      (await recoverRuntimeWorkspace(rootHandle(root)))?.workspaceRootDigest,
    ).toBe(secondRoot.digest);
    expect(await recoverRuntimeWorkspaceRoots(rootHandle(root))).toHaveLength(
      2,
    );
    expect(
      await garbageCollectRuntimeObjects(
        rootHandle(root),
        await recoverRuntimeWorkspaceRoots(rootHandle(root)),
      ),
    ).toBe(0);
    expect(await recoverRuntimeWorkspace(rootHandle(root))).toMatchObject({
      generation: 2,
    });
  });

  it("rejects a writer whose previous root is stale (lost the race to another commit)", async () => {
    const root = new MemoryDirectoryHandle();
    const firstPayload = await artifact("app-csv", "first");
    const firstRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [firstPayload.digest],
      }),
    );
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstPayload],
    });
    // A second writer that recovered BEFORE the first commit landed still
    // believes previous=null. Its commit must fail the previous-root check —
    // this is the detection layer the lock invariant on
    // persistRuntimeWorkspace relies on (see its doc comment).
    const stalePayload = await artifact("app-csv", "stale-writer");
    const staleRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [stalePayload.digest],
      }),
    );
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: staleRoot.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [staleRoot, stalePayload],
      }),
    ).rejects.toThrow(
      "recovered OPFS root does not match the runtime's previous root",
    );
  });

  it("falls back to the prior valid slot when the newest closure is corrupt", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "root-one");
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot],
    });
    const secondRoot = await artifact("workspace-root-json", "root-two");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      artifacts: [secondRoot],
    });
    await garbageCollectRuntimeObjects(
      rootHandle(root),
      await recoverRuntimeWorkspaceRoots(rootHandle(root)),
    );
    objectFile(root, secondRoot.digest).bytes = new TextEncoder().encode(
      "corrupt",
    );
    expect(await recoverRuntimeWorkspace(rootHandle(root))).toMatchObject({
      generation: 1,
      workspaceRootDigest: firstRoot.digest,
    });
  });

  it("does not hide a transient newest-root read failure by rolling back", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "root-one");
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot],
    });
    const secondRoot = await artifact("workspace-root-json", "root-two");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      recoveredSlot: first,
      artifacts: [secondRoot],
    });
    objectFile(root, secondRoot.digest).nextReadError = new DOMException(
      "temporary device failure",
      "NotReadableError",
    );

    await expect(recoverRuntimeWorkspace(rootHandle(root))).rejects.toThrow(
      /temporary device failure/,
    );
  });

  it("stops after verifying the newest valid root", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "root-one");
    const firstPayload = await artifact("app-csv", "first-payload");
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstPayload],
    });
    const secondRoot = await artifact("workspace-root-json", "root-two");
    const secondPayload = await artifact("app-csv", "second-payload");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      recoveredSlot: first,
      artifacts: [secondRoot, secondPayload],
    });
    objectFile(root, firstRoot.digest).reads = 0;
    objectFile(root, firstPayload.digest).reads = 0;
    objectFile(root, secondRoot.digest).reads = 0;
    objectFile(root, secondPayload.digest).reads = 0;

    await expect(
      recoverRuntimeWorkspace(rootHandle(root)),
    ).resolves.toMatchObject({
      generation: 2,
    });
    expect(objectFile(root, firstRoot.digest).reads).toBe(0);
    expect(objectFile(root, firstPayload.digest).reads).toBe(0);
    expect(objectFile(root, secondRoot.digest).reads).toBeGreaterThan(0);
    expect(objectFile(root, secondPayload.digest).reads).toBeGreaterThan(0);
  });

  it("recovers a review head without hashing unrelated exported artifacts", async () => {
    const root = new MemoryDirectoryHandle();
    const closure = await artifact("artifact-closure-json", "closure");
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({ artifactClosureDigest: closure.digest }),
    );
    const unrelatedExport = await artifact("parquet-export", "large-output");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, closure, unrelatedExport],
    });
    objectFile(root, rootArtifact.digest).reads = 0;
    objectFile(root, unrelatedExport.digest).reads = 0;
    objectFile(root, unrelatedExport.digest).bytes = new TextEncoder().encode(
      "corrupt-unrelated-output",
    );

    await expect(
      recoverRuntimeWorkspaceHead(rootHandle(root)),
    ).resolves.toMatchObject({ workspaceRootDigest: rootArtifact.digest });
    expect(objectFile(root, rootArtifact.digest).reads).toBeGreaterThan(0);
    expect(objectFile(root, closure.digest).reads).toBeGreaterThan(0);
    expect(objectFile(root, unrelatedExport.digest).reads).toBe(0);
    await expect(recoverRuntimeWorkspace(rootHandle(root))).rejects.toThrow(
      /no valid artifact closure/,
    );
  });

  it("falls back to the older review head when the newest closure is corrupt", async () => {
    const root = new MemoryDirectoryHandle();
    const firstClosure = await artifact("artifact-closure-json", "closure-one");
    const firstRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [firstClosure.digest],
        artifactClosureDigest: firstClosure.digest,
      }),
    );
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstClosure],
    });
    const secondClosure = await artifact(
      "artifact-closure-json",
      "closure-two",
    );
    const secondRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: firstRoot.digest,
        artifactDigests: [secondClosure.digest],
        artifactClosureDigest: secondClosure.digest,
      }),
    );
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      recoveredSlot: first,
      artifacts: [secondRoot, secondClosure],
    });
    objectFile(root, secondClosure.digest).bytes = new TextEncoder().encode(
      "corrupt-newest-closure",
    );

    await expect(
      recoverRuntimeWorkspaceHead(rootHandle(root)),
    ).resolves.toMatchObject({ workspaceRootDigest: firstRoot.digest });
    objectFile(root, firstClosure.digest).bytes = new TextEncoder().encode(
      "corrupt-older-closure",
    );
    await expect(recoverRuntimeWorkspaceHead(rootHandle(root))).rejects.toThrow(
      /no valid head/,
    );
  });

  it("distinguishes empty, malformed, and transiently unreadable review heads", async () => {
    await expect(
      recoverRuntimeWorkspaceHead(rootHandle(new MemoryDirectoryHandle())),
    ).resolves.toBeUndefined();

    const malformed = new MemoryDirectoryHandle();
    const malformedRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
      }),
    );
    await persistRuntimeWorkspace(rootHandle(malformed), {
      workspaceRootDigest: malformedRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [malformedRoot],
    });
    await expect(
      recoverRuntimeWorkspaceHead(rootHandle(malformed)),
    ).rejects.toThrow(/no valid head/);

    const transient = new MemoryDirectoryHandle();
    const closure = await artifact("artifact-closure-json", "closure");
    const transientRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({ artifactClosureDigest: closure.digest }),
    );
    await persistRuntimeWorkspace(rootHandle(transient), {
      workspaceRootDigest: transientRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [transientRoot, closure],
    });
    objectFile(transient, transientRoot.digest).nextReadError =
      new DOMException("temporarily unavailable", "NotReadableError");
    await expect(
      recoverRuntimeWorkspaceHead(rootHandle(transient)),
    ).rejects.toThrow(/temporarily unavailable/);
  });

  it("does not hide transient closure failures while listing recoverable roots", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "root");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    objectFile(root, rootArtifact.digest).nextReadError = new DOMException(
      "device busy",
      "NotReadableError",
    );
    await expect(
      recoverRuntimeWorkspaceRoots(rootHandle(root)),
    ).rejects.toThrow(/device busy/);
  });

  it("exports and imports a self-verifying portable artifact closure", async () => {
    const source = new MemoryDirectoryHandle();
    const workspaceId = `sha256:${"7".repeat(64)}`;
    const payload = await artifact("app-csv", "payload");
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [payload.digest],
      }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, payload],
    });
    const archive = await exportRuntimeClosure(rootHandle(source), slot);
    expect(archive.type).toBe("application/vnd.chronicle.workflow-workspace");
    await expect(runtimeClosureWorkspaceId(archive)).resolves.toBe(workspaceId);
    const destination = new MemoryDirectoryHandle();
    let verified = false;
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      archive,
      async (closure) => {
        expect(closure.manifest.workspaceRootDigest).toBe(rootArtifact.digest);
        expect(closure.manifest.workspaceId).toBe(workspaceId);
        expect(await closure.object(payload.digest)).toEqual(payload.bytes);
        verified = true;
      },
    );
    expect(verified).toBe(true);
    expect(imported.workspaceRootDigest).toBe(rootArtifact.digest);
    expect(
      await readRuntimeObject(rootHandle(destination), payload.digest),
    ).toEqual(payload.bytes);

    const corrupt = await blobBytes(archive);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        asArchive(corrupt),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/digest mismatch/);
  });

  it("writes bytes identical to the pre-streaming whole-buffer exporter and imports that writer's archives", async () => {
    const workspaceId = `sha256:${"5".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    let slot: WorkspaceRootSlot | undefined;
    const values: PersistedRuntimeArtifact[] = [];
    for (const label of ["alpha", "beta"]) {
      const payload = await artifact("app-csv", label.repeat(4096));
      const rootArtifact = await artifact(
        "workspace-root-json",
        JSON.stringify({
          workspaceId,
          previousWorkspaceRootDigest: slot?.workspaceRootDigest ?? null,
          artifactDigests: [payload.digest],
        }),
      );
      slot = await persistRuntimeWorkspace(rootHandle(source), {
        workspaceRootDigest: rootArtifact.digest,
        previousWorkspaceRootDigest: slot?.workspaceRootDigest ?? null,
        recoveredSlot: slot,
        artifacts: [rootArtifact, payload],
      });
      values.push(rootArtifact, payload);
    }

    const wholeBuffer = await wholeBufferExportRuntimeClosure(rootHandle(source), slot!);
    const streamed = await exportRuntimeClosure(rootHandle(source), slot!);
    // Byte-for-byte, not merely "parses the same": an archive written by the
    // shipped whole-buffer exporter is exactly what this exporter now writes,
    // so the format needed no version bump and no backup was invalidated.
    expect(await blobBytes(streamed)).toEqual(wholeBuffer);

    const destination = new MemoryDirectoryHandle();
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      asArchive(wholeBuffer),
      () => Promise.resolve(),
    );
    expect(imported.workspaceRootDigest).toBe(slot!.workspaceRootDigest);
    for (const value of values) {
      await expect(
        readRuntimeObject(rootHandle(destination), value.digest),
      ).resolves.toEqual(value.bytes);
    }
  });

  it("streams a many-object archive and never reads more than one object at a time", async () => {
    const workspaceId = `sha256:${"3".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    const payloads: PersistedRuntimeArtifact[] = [];
    for (let index = 0; index < 64; index += 1) {
      payloads.push(await artifact("app-csv", `object-${index}-${"x".repeat(2048)}`));
    }
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: payloads.map(({ digest }) => digest),
      }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, ...payloads],
    });

    const archive = await exportRuntimeClosure(rootHandle(source), slot);
    const destination = new MemoryDirectoryHandle();
    // A slice reader that refuses to hand out more than one object's worth of
    // bytes per call proves the importer never asks for the whole payload.
    const largest = Math.max(...payloads.map(({ size }) => size), rootArtifact.size);
    let widestRead = 0;
    let sliceCalls = 0;
    const bounded = archiveWithSliceHook(archive, (start, end) => {
      sliceCalls += 1;
      // Calls 1 and 2 are the fixed header and the manifest; every later read
      // is a single object payload.
      if (sliceCalls > 2) widestRead = Math.max(widestRead, end - start);
      return archive.slice(start, end);
    });
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      bounded,
      () => Promise.resolve(),
    );
    expect(imported.workspaceRootDigest).toBe(rootArtifact.digest);
    expect(widestRead).toBeLessThanOrEqual(largest);
    for (const value of [rootArtifact, ...payloads]) {
      await expect(
        readRuntimeObject(rootHandle(destination), value.digest),
      ).resolves.toEqual(value.bytes);
    }
  });

  it("flushes staged payloads past the staging budget without changing the bytes", async () => {
    const workspaceId = `sha256:${"c".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    // Six 1 MiB objects cross the 4 MiB staging budget, so the builder hands
    // parts to blob storage mid-export instead of only at `finish()`.
    const payloads: PersistedRuntimeArtifact[] = [];
    for (let index = 0; index < 6; index += 1) {
      payloads.push(
        await artifact("app-csv", `${String(index)}${"x".repeat(1024 * 1024)}`),
      );
    }
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: payloads.map(({ digest }) => digest),
      }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, ...payloads],
    });

    const archive = await exportRuntimeClosure(rootHandle(source), slot);
    expect(archive.size).toBeGreaterThan(4 * 1024 * 1024);
    // Staging is an allocation strategy, never a format decision: a flushed
    // archive is byte-identical to the whole-buffer writer's output. Compared
    // by digest because element-wise deep equality over megabytes of typed
    // array costs seconds and proves nothing extra.
    const wholeBuffer = await wholeBufferExportRuntimeClosure(rootHandle(source), slot);
    expect(archive.size).toBe(wholeBuffer.byteLength);
    expect(await digest(await blobBytes(archive))).toBe(await digest(wholeBuffer));

    const destination = new MemoryDirectoryHandle();
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      archive,
      () => Promise.resolve(),
    );
    expect(imported.workspaceRootDigest).toBe(rootArtifact.digest);
    for (const value of [rootArtifact, ...payloads]) {
      const stored = await readRuntimeObject(rootHandle(destination), value.digest);
      expect(stored.byteLength).toBe(value.size);
      expect(await digest(stored)).toBe(value.digest);
    }
  });

  it("fails the export when filesystem metadata disagrees with the object it reads", async () => {
    const source = new MemoryDirectoryHandle();
    const workspaceId = `sha256:${"b".repeat(64)}`;
    const payload = await artifact("app-csv", "metadata-disagreement");
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [payload.digest],
      }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, payload],
    });

    // The manifest is written from `file.size`; the payload comes from a later
    // full read. A store that reports the wrong size would shift every offset
    // after this object, so the export refuses rather than emitting a manifest
    // that does not describe its own payload.
    const handle = objectFile(source, payload.digest);
    const honest = handle.getFile.bind(handle);
    handle.getFile = async () => {
      const file = await honest();
      return new Proxy(file, {
        get(target, property, receiver) {
          if (property === "size") return target.size + 1;
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? (value as (...args: never[]) => unknown).bind(target)
            : value;
        },
      });
    };
    await expect(exportRuntimeClosure(rootHandle(source), slot)).rejects.toThrow(
      /changed while exporting/,
    );
  });

  it("rejects an archive truncated inside an object without writing anything", async () => {
    const workspaceId = `sha256:${"2".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    const payload = await artifact("app-csv", "truncation-probe".repeat(64));
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [payload.digest],
      }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, payload],
    });
    const complete = await blobBytes(
      await exportRuntimeClosure(rootHandle(source), slot),
    );

    // Cutting one byte, half an object, and all-but-one byte of an object each
    // leaves the last declared object extending past the end of the archive.
    // That is caught from the table alone, before any payload is hashed.
    for (const cut of [1, Math.floor(payload.size / 2), payload.size - 1]) {
      const destination = new MemoryDirectoryHandle();
      await expect(
        importRuntimeClosure(
          rootHandle(destination),
          asArchive(complete.subarray(0, complete.byteLength - cut)),
          () => Promise.resolve(),
        ),
      ).rejects.toThrow(/invalid runtime closure object table/);
      // Nothing may have been placed, and no root slot may exist.
      expect(
        destination.directories.get("chronicle-workflow-runtime-v1"),
      ).toBeUndefined();
    }

    // The mirror case: bytes beyond the last declared object mean the table
    // does not account for the whole archive.
    const padded = new Uint8Array(complete.byteLength + 7);
    padded.set(complete);
    const overlong = new MemoryDirectoryHandle();
    await expect(
      importRuntimeClosure(rootHandle(overlong), asArchive(padded), () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/payload is incomplete/);
    expect(
      overlong.directories.get("chronicle-workflow-runtime-v1"),
    ).toBeUndefined();

    // A digest that no longer matches its object is rejected before any write,
    // even though the framing is intact.
    const flipped = Uint8Array.from(complete);
    flipped[flipped.byteLength - 1] = (flipped[flipped.byteLength - 1] ?? 0) ^ 0xff;
    const tampered = new MemoryDirectoryHandle();
    await expect(
      importRuntimeClosure(rootHandle(tampered), asArchive(flipped), () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/digest mismatch/);
    expect(
      tampered.directories.get("chronicle-workflow-runtime-v1"),
    ).toBeUndefined();
  });

  it("imports an archive whose object table is not in sorted digest order", async () => {
    const workspaceId = `sha256:${"a".repeat(64)}`;
    const payload = await artifact("app-csv", "unordered-payload");
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [payload.digest],
      }),
    );
    const ordered = [rootArtifact, payload].sort((left, right) =>
      left.digest < right.digest ? -1 : 1,
    );
    const destination = new MemoryDirectoryHandle();
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      asArchive(
        buildTestClosureArchive(
          workspaceId,
          rootArtifact.digest,
          null,
          [...ordered].reverse(),
        ),
      ),
      () => Promise.resolve(),
    );
    expect(imported.workspaceRootDigest).toBe(rootArtifact.digest);
    for (const value of ordered) {
      await expect(
        readRuntimeObject(rootHandle(destination), value.digest),
      ).resolves.toEqual(value.bytes);
    }
  });

  it("retains, exports, and imports the complete three-run history", async () => {
    const workspaceId = `sha256:${"6".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    let previous: WorkspaceRootSlot | undefined;
    const roots: PersistedRuntimeArtifact[] = [];
    const payloads: PersistedRuntimeArtifact[] = [];
    for (const label of ["first", "second", "third"]) {
      const payload = await artifact("app-csv", label);
      const rootArtifact = await artifact(
        "workspace-root-json",
        JSON.stringify({
          workspaceId,
          previousWorkspaceRootDigest: previous?.workspaceRootDigest ?? null,
          artifactDigests: [payload.digest],
        }),
      );
      previous = await persistRuntimeWorkspace(rootHandle(source), {
        workspaceRootDigest: rootArtifact.digest,
        previousWorkspaceRootDigest: previous?.workspaceRootDigest ?? null,
        recoveredSlot: previous,
        artifacts: [rootArtifact, payload],
      });
      roots.push(rootArtifact);
      payloads.push(payload);
    }
    const heads = await recoverRuntimeWorkspaceRoots(rootHandle(source));
    expect(heads.map(({ generation }) => generation)).toEqual([3, 2]);
    await expect(
      garbageCollectRuntimeObjects(rootHandle(source), heads),
    ).resolves.toBe(0);
    for (const value of [...roots, ...payloads]) {
      await expect(
        readRuntimeObject(rootHandle(source), value.digest),
      ).resolves.toEqual(value.bytes);
    }

    const archive = await exportRuntimeClosure(rootHandle(source), previous!);
    const destination = new MemoryDirectoryHandle();
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      archive,
      () => Promise.resolve(),
    );
    expect(imported.previousWorkspaceRootDigest).toBe(roots[1]?.digest);
    await expect(
      verifyRuntimeWorkspace(rootHandle(destination), imported),
    ).resolves.toBeUndefined();
    for (const value of [...roots, ...payloads]) {
      await expect(
        readRuntimeObject(rootHandle(destination), value.digest),
      ).resolves.toEqual(value.bytes);
    }
    await expect(
      importRuntimeClosure(rootHandle(destination), archive, () =>
        Promise.resolve(),
      ),
    ).resolves.toEqual(imported);

    const divergent = new MemoryDirectoryHandle();
    const divergentRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
        branch: "divergent",
      }),
    );
    await persistRuntimeWorkspace(rootHandle(divergent), {
      workspaceRootDigest: divergentRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [divergentRoot],
    });
    await expect(
      importRuntimeClosure(rootHandle(divergent), archive, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/diverges/);
  });

  it("fast-forwards an existing workspace across more than one imported commit", async () => {
    const workspaceId = `sha256:${"4".repeat(64)}`;
    const source = new MemoryDirectoryHandle();
    let sourceSlot: WorkspaceRootSlot | undefined;
    const roots: PersistedRuntimeArtifact[] = [];
    const payloads: PersistedRuntimeArtifact[] = [];
    for (const label of ["first", "second", "third"]) {
      const payload = await artifact("app-csv", label);
      const rootArtifact = await artifact(
        "workspace-root-json",
        JSON.stringify({
          workspaceId,
          previousWorkspaceRootDigest: sourceSlot?.workspaceRootDigest ?? null,
          artifactDigests: [payload.digest],
        }),
      );
      sourceSlot = await persistRuntimeWorkspace(rootHandle(source), {
        workspaceRootDigest: rootArtifact.digest,
        previousWorkspaceRootDigest: sourceSlot?.workspaceRootDigest ?? null,
        recoveredSlot: sourceSlot,
        artifacts: [rootArtifact, payload],
      });
      roots.push(rootArtifact);
      payloads.push(payload);
    }
    const archive = await exportRuntimeClosure(rootHandle(source), sourceSlot!);
    const [firstRoot, secondRoot, thirdRoot] = roots;
    const firstPayload = payloads[0];
    if (!firstRoot || !secondRoot || !thirdRoot || !firstPayload) {
      throw new Error("expected three persisted commits");
    }

    const destination = new MemoryDirectoryHandle();
    const localFirst = await persistRuntimeWorkspace(rootHandle(destination), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstPayload],
    });
    expect(localFirst.workspaceRootDigest).toBe(firstRoot.digest);

    const imported = await importRuntimeClosure(
      rootHandle(destination),
      archive,
      () => Promise.resolve(),
    );
    expect(imported.workspaceRootDigest).toBe(thirdRoot.digest);
    expect(imported.previousWorkspaceRootDigest).toBe(secondRoot.digest);
    await expect(
      verifyRuntimeWorkspace(rootHandle(destination), imported),
    ).resolves.toBeUndefined();
  });

  it("fails closed for malformed artifacts, metadata conflicts, and a missing root object", async () => {
    const root = new MemoryDirectoryHandle();
    const valid = await artifact("workspace-root-json", "root");
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: valid.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [{ ...valid, size: valid.size + 1 }],
      }),
    ).rejects.toThrow(/size mismatch/);
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: valid.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [{ ...valid, digest: `sha256:${"0".repeat(64)}` }],
      }),
    ).rejects.toThrow(/missing the workspace-root object/);
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: valid.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [
          valid,
          { ...valid, kind: "different", size: valid.size + 1 },
        ],
      }),
    ).rejects.toThrow(/conflicting artifact metadata/);
    await expect(readRuntimeObject(rootHandle(root), "bad")).rejects.toThrow(
      /invalid SHA-256/,
    );

    const wrongDigest = { ...valid, digest: `sha256:${"0".repeat(64)}` };
    await expect(
      persistRuntimeWorkspace(rootHandle(new MemoryDirectoryHandle()), {
        workspaceRootDigest: wrongDigest.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [wrongDigest],
      }),
    ).rejects.toThrow(/artifact digest mismatch/);
    await expect(
      persistRuntimeWorkspace(rootHandle(new MemoryDirectoryHandle()), {
        workspaceRootDigest: wrongDigest.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [{ ...wrongDigest, digestVerified: true }],
      }),
    ).rejects.toThrow(/OPFS verification failed/);
  });

  it("rejects detached history, direct-commit metadata errors, and invalid retained sets", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "first");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot],
    });
    const detachedRoot = await artifact("workspace-root-json", "detached");
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: detachedRoot.digest,
        previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
        artifacts: [detachedRoot],
      }),
    ).rejects.toThrow(/previous root/);

    const claimedDigest = `sha256:${"8".repeat(64)}`;
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: claimedDigest,
        previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
        artifacts: [
          {
            ...detachedRoot,
            digest: claimedDigest,
            digestVerified: true,
          },
        ],
      }),
    ).rejects.toThrow(/incoming workspace root digest mismatch/);

    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: detachedRoot.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [
          detachedRoot,
          { ...detachedRoot, kind: "duplicate", size: detachedRoot.size + 1 },
        ],
      }),
    ).rejects.toThrow(/conflicting artifact metadata/);
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: claimedDigest,
        previousWorkspaceRootDigest: null,
        artifacts: [detachedRoot],
      }),
    ).rejects.toThrow(/missing the workspace-root object/);

    const fresh = new MemoryDirectoryHandle();
    await persistRuntimeObject(rootHandle(fresh), detachedRoot);
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(fresh), {
        workspaceRootDigest: detachedRoot.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [detachedRoot],
        slotArtifactDigests: [detachedRoot.digest, detachedRoot.digest],
      }),
    ).rejects.toThrow(/root slot artifact set is invalid/);

    await persistRuntimeObject(rootHandle(root), detachedRoot);
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: detachedRoot.digest,
        previousWorkspaceRootDigest: `sha256:${"9".repeat(64)}`,
        artifacts: [detachedRoot],
      }),
    ).rejects.toThrow(/previous root/);
  });

  it("enforces metadata and committed-history safety ceilings", async () => {
    const digestFor = (index: number): string =>
      `sha256:${index.toString(16).padStart(64, "0")}`;
    const excessiveMetadata = Array.from({ length: 100_001 }, (_, index) => ({
      kind: `artifact-${index}`,
      digest: digestFor(index),
      size: 0,
      digestVerified: true as const,
    }));
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(new MemoryDirectoryHandle()), {
        workspaceRootDigest: digestFor(0),
        previousWorkspaceRootDigest: null,
        artifacts: excessiveMetadata,
      }),
    ).rejects.toThrow(/exceeds 100000 objects/);

    const root = new MemoryDirectoryHandle();
    const currentRoot = await artifact("workspace-root-json", "current");
    const current = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: currentRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [currentRoot],
    });
    const chain: PersistedRuntimeArtifact[] = [];
    let previousDigest: string | null = null;
    for (let index = 0; index < 10_001; index += 1) {
      const next = await artifact(
        "workspace-root-json",
        JSON.stringify({
          workspaceId: `sha256:${"1".repeat(64)}`,
          previousWorkspaceRootDigest: previousDigest,
          artifactDigests: [],
          index,
        }),
      );
      chain.push(next);
      previousDigest = next.digest;
    }
    const head = chain.at(-1)!;
    const tenThousandth = chain.at(-2)!;
    const tenThousandthPrevious = chain.at(-3)!.digest;
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: head.digest,
        previousWorkspaceRootDigest: tenThousandth.digest,
        recoveredSlot: current,
        artifacts: chain,
      }),
    ).rejects.toThrow(/incoming workspace history is cyclic or too large/);

    await persistRuntimeObjects(rootHandle(root), chain);
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: head.digest,
        previousWorkspaceRootDigest: tenThousandth.digest,
        recoveredSlot: current,
        artifacts: chain,
      }),
    ).rejects.toThrow(/incoming workspace history is cyclic or too large/);
    await expect(
      collectRuntimeHistoryDigests(rootHandle(root), head.digest),
    ).rejects.toThrow(/exceeds 10000 roots/);
    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        asArchive(
          buildTestClosureArchive(
            `sha256:${"1".repeat(64)}`,
            head.digest,
            tenThousandth.digest,
            [...chain].reverse(),
          ),
        ),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/closure history is cyclic or too large/);

    const nextRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: tenThousandth.digest,
        artifactDigests: [],
      }),
    );
    await persistRuntimeObject(rootHandle(root), nextRoot);
    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: nextRoot.digest,
        previousWorkspaceRootDigest: tenThousandth.digest,
        recoveredSlot: await signedTestSlot(
          tenThousandth.digest,
          tenThousandthPrevious,
        ),
        artifacts: [nextRoot],
      }),
    ).rejects.toThrow(/history has reached 10000 roots/);
  }, 30_000);

  it("rejects an oversized history closure before reading absent objects", async () => {
    const assignments = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, index) => [
        `role-${index}`,
        `sha256:${index.toString(16).padStart(64, "0")}`,
      ]),
    );
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
        assignmentDigests: assignments,
      }),
    );
    await persistRuntimeObject(rootHandle(root), rootArtifact);
    await expect(
      collectRuntimeHistoryDigests(rootHandle(root), rootArtifact.digest),
    ).rejects.toThrow(/exceeds 100000 objects/);
  });

  it("rejects a root slot that changes between write and read-back", async () => {
    const root = new MemoryDirectoryHandle();
    const priorRoot = await artifact("workspace-root-json", "prior");
    const nextRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: priorRoot.digest,
        artifactDigests: [],
      }),
    );
    await persistRuntimeObjects(rootHandle(root), [priorRoot, nextRoot]);
    const roots = root.directories
      .get("chronicle-workflow-runtime-v1")!
      .directories.get("roots")!;
    const changedAfterWrite = new MemoryFileHandle();
    changedAfterWrite.nextWriteTransform = async (bytes) => {
      const parsed = JSON.parse(
        new TextDecoder().decode(bytes),
      ) as WorkspaceRootSlot;
      const changed = {
        protocolVersion: parsed.protocolVersion,
        generation: parsed.generation,
        workspaceRootDigest: `sha256:${"4".repeat(64)}`,
        previousWorkspaceRootDigest: parsed.previousWorkspaceRootDigest,
        artifactDigests: parsed.artifactDigests,
      };
      return new TextEncoder().encode(
        JSON.stringify({
          ...changed,
          checksum: await digest(
            new TextEncoder().encode(JSON.stringify(changed)),
          ),
        }),
      );
    };
    roots.files.set("root-b.json", changedAfterWrite);

    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: nextRoot.digest,
        previousWorkspaceRootDigest: priorRoot.digest,
        recoveredSlot: await signedTestSlot(priorRoot.digest, null),
        artifacts: [nextRoot],
      }),
    ).rejects.toThrow(/root commit verification failed/);
  });

  it("detects workspace-identity crossings and signed head mismatches", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
      }),
    );
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot],
    });
    const secondRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"2".repeat(64)}`,
        previousWorkspaceRootDigest: firstRoot.digest,
        artifactDigests: [],
      }),
    );
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: firstRoot.digest,
      recoveredSlot: first,
      artifacts: [secondRoot],
    });
    await expect(
      collectRuntimeHistoryDigests(rootHandle(root), secondRoot.digest),
    ).rejects.toThrow(/crosses workspace identities/);

    const mismatchedUnsigned = {
      protocolVersion: first.protocolVersion,
      generation: first.generation,
      workspaceRootDigest: first.workspaceRootDigest,
      previousWorkspaceRootDigest: `sha256:${"3".repeat(64)}`,
      artifactDigests: first.artifactDigests,
    };
    await expect(
      verifyRuntimeWorkspace(rootHandle(root), {
        ...mismatchedUnsigned,
        checksum: await digest(
          new TextEncoder().encode(JSON.stringify(mismatchedUnsigned)),
        ),
      }),
    ).rejects.toThrow(/does not match its committed head root/);
  });

  it("deduplicates an already verified object and fails closed when every root is corrupt", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "stable-root");
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: rootArtifact.digest,
        previousWorkspaceRootDigest: first.workspaceRootDigest,
        artifacts: [rootArtifact],
      }),
    ).resolves.toMatchObject({ generation: 2 });

    const roots = root.directories
      .get("chronicle-workflow-runtime-v1")!
      .directories.get("roots")!;
    roots.files.get("root-a.json")!.bytes = new TextEncoder().encode(
      JSON.stringify({ protocolVersion: "bad", generation: 1 }),
    );
    roots.files.get("root-b.json")!.bytes = new TextEncoder().encode(
      "not-json",
    );
    await expect(recoverRuntimeWorkspace(rootHandle(root))).rejects.toThrow(
      /no valid artifact closure can be recovered/,
    );
    await expect(
      recoverRuntimeWorkspaceRoots(rootHandle(root)),
    ).rejects.toThrow(/no valid artifact closure can be recovered/);
  });

  it("accepts shared-memory views without retaining them and repairs same-size corruption", async () => {
    const root = new MemoryDirectoryHandle();
    const source = new TextEncoder().encode(
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
      }),
    );
    const sharedBytes = new Uint8Array(
      new SharedArrayBuffer(source.byteLength),
    );
    sharedBytes.set(source);
    const sharedArtifact: PersistedRuntimeArtifact = {
      kind: "workspace-root-json",
      digest: await digest(source),
      size: sharedBytes.byteLength,
      bytes: sharedBytes,
    };
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: sharedArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [sharedArtifact],
    });
    expect(
      await readRuntimeObject(rootHandle(root), sharedArtifact.digest),
    ).toEqual(source);

    objectFile(root, sharedArtifact.digest).bytes = new TextEncoder().encode(
      "broken-root",
    );
    const secondRoot = await artifact("workspace-root-json", "second-root");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      recoveredSlot: first,
      artifacts: [secondRoot, sharedArtifact],
    });
    expect(
      await readRuntimeObject(rootHandle(root), sharedArtifact.digest),
    ).toEqual(source);
  });

  it("never hands the browser a partial view of a larger buffer", async () => {
    // `importRuntimeClosure` slices every object out of one archive buffer, so
    // the artifacts it persists are subarray views. WebKit's
    // FileSystemWritableFileStream.write() ignores byteOffset/byteLength and
    // stores the WHOLE underlying ArrayBuffer (WebKit 26.4; Chromium 147 and
    // Firefox 148 honour the view), which wrote the entire archive in place of
    // each object and failed the store's own read-back check. The store must
    // therefore only ever pass a buffer the view completely spans.
    const root = new MemoryDirectoryHandle();
    const source = new TextEncoder().encode(
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: null,
        artifactDigests: [],
      }),
    );
    const archive = new Uint8Array(source.byteLength + 64);
    archive.set(source, 32);
    const viewArtifact: PersistedRuntimeArtifact = {
      kind: "workspace-root-json",
      digest: await digest(source),
      size: source.byteLength,
      bytes: archive.subarray(32, 32 + source.byteLength),
    };
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: viewArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [viewArtifact],
    });
    const written = objectFile(root, viewArtifact.digest).lastWriteGeometry;
    expect(written).toEqual({
      byteOffset: 0,
      byteLength: source.byteLength,
      bufferBytes: source.byteLength,
    });
    expect(
      await readRuntimeObject(rootHandle(root), viewArtifact.digest),
    ).toEqual(source);
  });

  it("distinguishes a new empty workspace from a corrupt existing workspace", async () => {
    await expect(
      recoverRuntimeWorkspace(rootHandle(new MemoryDirectoryHandle())),
    ).resolves.toBeUndefined();
  });

  it("verifies that retained roots include their own root object", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "root");
    const committed = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    const unsigned = {
      protocolVersion: committed.protocolVersion,
      generation: committed.generation,
      workspaceRootDigest: committed.workspaceRootDigest,
      previousWorkspaceRootDigest: committed.previousWorkspaceRootDigest,
      artifactDigests: [],
    };
    await expect(
      verifyRuntimeWorkspace(rootHandle(root), {
        ...unsigned,
        checksum: await digest(
          new TextEncoder().encode(JSON.stringify(unsigned)),
        ),
      }),
    ).rejects.toThrow(/does not retain its root object/);
  });

  it("reports the browser capability boundary", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    await expect(openOpfsRoot()).rejects.toThrow(/OPFS is unavailable/);
    await expect(probeOpfsCapability()).resolves.toMatchObject({
      status: "unavailable",
    });
    const root = new MemoryDirectoryHandle();
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(rootHandle(root)),
        persisted: () => Promise.resolve(true),
      },
      locks: { request: vi.fn() },
    });
    await expect(openOpfsRoot()).resolves.toBe(rootHandle(root));
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "ready",
      evictionProtected: true,
    });

    vi.stubGlobal("navigator", {
      storage: {
        // Deliberately model a browser API rejecting with an opaque value so
        // the user-facing boundary proves it still renders a useful reason.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        getDirectory: () => Promise.reject("opaque failure"),
      },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "unavailable",
      reason: "Origin-private file storage could not be opened: opaque failure",
    });

    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(rootHandle(root)),
      },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "ready",
      evictionProtected: null,
    });

    // A browser that hands out a directory handle but refuses the write is the
    // exact half-run this gate exists to stop: an existence-only probe reports
    // "ready" and the run dies at commit time instead of before it starts.
    const writeDenied = new MemoryDirectoryHandle();
    writeDenied.getDirectoryHandle = () =>
      Promise.resolve({
        getFileHandle: () =>
          Promise.reject(new DOMException("quota", "QuotaExceededError")),
      } as unknown as FileSystemDirectoryHandle);
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(rootHandle(writeDenied)) },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "unavailable",
      reason: "Origin-private file storage is open but not writable: quota",
    });

    // A browser that hands out the origin root but refuses to create the probe
    // directory (private browsing, an exhausted quota) never reaches the write
    // at all, and must be reported at that boundary rather than as a write
    // failure the caller could misread as transient.
    const noDirectories = new MemoryDirectoryHandle();
    noDirectories.getDirectoryHandle = () =>
      Promise.reject(new DOMException("no space", "QuotaExceededError"));
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(rootHandle(noDirectories)) },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "unavailable",
      reason:
        "Origin-private file storage is readable but no directory can be created: no space",
    });

    // A store that accepts the write and then cannot read the file back is the
    // other half of the round trip: verified persistence needs both, so a
    // write-only store fails closed with its own distinct reason.
    const unreadable = new MemoryDirectoryHandle();
    const unreadableProbe = (await unreadable.getDirectoryHandle(
      "chronicle-capability-probe-v1",
      { create: true },
    )) as unknown as MemoryDirectoryHandle;
    const unreadableGetFileHandle =
      unreadableProbe.getFileHandle.bind(unreadableProbe);
    unreadableProbe.getFileHandle = async (name, options) => {
      const handle = (await unreadableGetFileHandle(
        name,
        options,
      )) as unknown as MemoryFileHandle;
      // Writing never calls getFile(), so this only bites the read-back.
      handle.nextReadError = new DOMException("read failed", "NotReadableError");
      return handle as unknown as FileSystemFileHandle;
    };
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(rootHandle(unreadable)) },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "unavailable",
      reason:
        "Origin-private file storage accepted a write it cannot read back: read failed",
    });

    // A store that accepts the write and returns different bytes cannot back a
    // verified workspace at all, so it must fail closed too.
    const lyingStore = new MemoryDirectoryHandle();
    const probeDirectory = (await lyingStore.getDirectoryHandle(
      "chronicle-capability-probe-v1",
      { create: true },
    )) as unknown as MemoryDirectoryHandle;
    const originalGetFileHandle =
      probeDirectory.getFileHandle.bind(probeDirectory);
    probeDirectory.getFileHandle = async (name, options) => {
      const handle = (await originalGetFileHandle(
        name,
        options,
      )) as unknown as MemoryFileHandle;
      handle.nextWriteTransform = (bytes) =>
        Promise.resolve(Uint8Array.from(bytes, (byte) => byte ^ 0xff));
      return handle as unknown as FileSystemFileHandle;
    };
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(rootHandle(lyingStore)) },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "unavailable",
      reason:
        "Origin-private file storage returned different bytes than were written, so verified persistence is impossible.",
    });

    // Deletion is not a durability primitive — a store that cannot remove the
    // probe file still persists verified objects, so it must stay "ready".
    const noDelete = new MemoryDirectoryHandle();
    const noDeleteProbe = (await noDelete.getDirectoryHandle(
      "chronicle-capability-probe-v1",
      { create: true },
    )) as unknown as MemoryDirectoryHandle;
    noDeleteProbe.removeEntry = () =>
      Promise.reject(new DOMException("read-only", "NoModificationAllowedError"));
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(rootHandle(noDelete)) },
      locks: { request: vi.fn() },
    });
    await expect(probeOpfsCapability()).resolves.toEqual({
      status: "ready",
      evictionProtected: null,
    });

    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve(rootHandle(root)),
      },
      locks: { request: vi.fn() },
    });
    const first = await openOpfsWorkspace(`sha256:${"1".repeat(64)}`);
    const second = await openOpfsWorkspace(`sha256:${"2".repeat(64)}`);
    expect(first).not.toBe(second);
    expect(
      root.directories.get("chronicle-workflow-workspaces-v1")?.directories
        .size,
    ).toBe(2);
  });

  it("rejects malformed portable closure framing and tables", async () => {
    const source = new MemoryDirectoryHandle();
    const workspaceId = `sha256:${"7".repeat(64)}`;
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({ workspaceId }),
    );
    const payload = await artifact("app-csv", "payload");
    const slot = await persistRuntimeWorkspace(rootHandle(source), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact, payload],
    });
    const valid = await blobBytes(
      await exportRuntimeClosure(rootHandle(source), slot),
    );
    const magic = new TextEncoder().encode("CHRONICLE-WORKFLOW-CLOSURE-V1\n");

    await expect(
      runtimeClosureWorkspaceId(asArchive(new Uint8Array([1, 2, 3]))),
    ).rejects.toThrow(/invalid runtime closure magic/);
    await expect(
      runtimeClosureWorkspaceId(asArchive(new Uint8Array(magic.byteLength + 3))),
    ).rejects.toThrow(/invalid runtime closure magic/);
    // Long enough to carry a header, but the magic itself is wrong: the framing
    // check reads the header range and compares every byte, so this is rejected
    // without reading a manifest or a payload.
    const wrongMagic = new Uint8Array(valid);
    wrongMagic[magic.byteLength - 1] =
      (wrongMagic[magic.byteLength - 1] ?? 0) ^ 0xff;
    await expect(runtimeClosureWorkspaceId(asArchive(wrongMagic))).rejects.toThrow(
      /invalid runtime closure magic/,
    );
    const zeroManifest = new Uint8Array(magic.byteLength + 4);
    zeroManifest.set(magic);
    await expect(
      runtimeClosureWorkspaceId(asArchive(zeroManifest)),
    ).rejects.toThrow(/invalid runtime closure manifest size/);

    type MutableClosureManifest = Omit<
      RuntimeClosureManifest,
      "protocolVersion"
    > & {
      protocolVersion: string;
    };
    const rewrite = (mutate: (manifest: MutableClosureManifest) => void): Blob => {
      const oldSize = new DataView(
        valid.buffer,
        valid.byteOffset,
        valid.byteLength,
      ).getUint32(magic.byteLength, true);
      const oldPayload = valid.slice(magic.byteLength + 4 + oldSize);
      const manifest = JSON.parse(
        new TextDecoder().decode(
          valid.slice(magic.byteLength + 4, magic.byteLength + 4 + oldSize),
        ),
      ) as MutableClosureManifest;
      mutate(manifest);
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const next = new Uint8Array(
        magic.byteLength + 4 + manifestBytes.byteLength + oldPayload.byteLength,
      );
      next.set(magic);
      new DataView(next.buffer).setUint32(
        magic.byteLength,
        manifestBytes.byteLength,
        true,
      );
      next.set(manifestBytes, magic.byteLength + 4);
      next.set(oldPayload, magic.byteLength + 4 + manifestBytes.byteLength);
      return asArchive(next);
    };

    await expect(
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          manifest.protocolVersion = "unsupported";
        }),
      ),
    ).rejects.toThrow(/unsupported runtime closure manifest/);
    await expect(
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          const firstObject = manifest.objects[0];
          if (!firstObject) throw new Error("closure manifest has no objects");
          firstObject.size = -1;
        }),
      ),
    ).rejects.toThrow(/invalid runtime closure object table/);
    await expect(
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          manifest.workspaceRootDigest = `sha256:${"9".repeat(64)}`;
        }),
      ),
    ).rejects.toThrow(/runtime closure payload is incomplete/);

    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        rewrite((manifest) => {
          manifest.workspaceId = `sha256:${"8".repeat(64)}`;
        }),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/crosses workspace identities/);
    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        rewrite((manifest) => {
          manifest.previousWorkspaceRootDigest = `sha256:${"8".repeat(64)}`;
        }),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/head does not match its outer manifest/);

    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        asArchive(valid),
        async (closure) => {
          await expect(
            closure.object(`sha256:${"9".repeat(64)}`),
          ).rejects.toThrow(/runtime closure object is missing/);
        },
      ),
    ).resolves.toMatchObject({ workspaceRootDigest: rootArtifact.digest });

    // A source that shrinks after the table validated cannot yield a short
    // object: Blob.slice clamps silently, so the accessor length-checks.
    let shrinkingCalls = 0;
    const validArchive = asArchive(valid);
    const shrinking = archiveWithSliceHook(validArchive, (start, end) => {
      shrinkingCalls += 1;
      // Leave the header and manifest intact so the object table still
      // validates; only the payload reads come back short.
      return shrinkingCalls <= 2
        ? validArchive.slice(start, end)
        : validArchive.slice(start, Math.max(start, end - 1));
    });
    await expect(
      importRuntimeClosure(
        rootHandle(new MemoryDirectoryHandle()),
        shrinking,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(/runtime closure object is truncated/);
  });

  it("rejects closure export when the root omits its workspace identity", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact(
      "workspace-root-json",
      JSON.stringify({ command: "ExecuteWorkspace" }),
    );
    const slot = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    await expect(exportRuntimeClosure(rootHandle(root), slot)).rejects.toThrow(
      /workspace identity|invalid committed workspace root/,
    );
  });

  it("rejects prefix reads with invalid bounds or an exceeded read limit", async () => {
    const root = new MemoryDirectoryHandle();
    const bogusDigest = `sha256:${"a".repeat(64)}`;
    await expect(
      readRuntimeObjectPrefix(rootHandle(root), bogusDigest, 8, -1),
    ).rejects.toThrow(/invalid OPFS object prefix bounds/);
    await expect(
      readRuntimeObjectPrefix(rootHandle(root), bogusDigest, 8, 4, 4),
    ).rejects.toThrow(/exceeds the 4 byte read limit/);
  });

  it("names both sizes when a write reads back with a different length", async () => {
    // WebKit's writable stream ignores byteOffset/byteLength and stores the
    // whole backing buffer. The read-back check exists to catch exactly that,
    // and it must name the observed size — "wrote 812, read back 6291456" is
    // what turns an engine bug into a one-line diagnosis.
    const root = new MemoryDirectoryHandle();
    const payload = await artifact("blob", "seven-byte-ish payload");
    const hex = payload.digest.slice(7);
    const store = (await root.getDirectoryHandle(
      "chronicle-workflow-runtime-v1",
      { create: true },
    )) as unknown as MemoryDirectoryHandle;
    const objects = (await store.getDirectoryHandle("objects", {
      create: true,
    })) as unknown as MemoryDirectoryHandle;
    const shard = (await objects.getDirectoryHandle(hex.slice(0, 2), {
      create: true,
    })) as unknown as MemoryDirectoryHandle;
    const handle = (await shard.getFileHandle(hex.slice(2), {
      create: true,
    })) as unknown as MemoryFileHandle;
    handle.nextWriteTransform = (bytes) =>
      Promise.resolve(Uint8Array.from([...bytes, ...bytes]));

    await expect(
      persistRuntimeObject(rootHandle(root), payload),
    ).rejects.toThrow(
      `OPFS verification failed for blob: wrote ${payload.size} bytes, read back ${payload.size * 2}`,
    );
  });

  it("refuses a commit that would push the projected closure past the object ceiling", async () => {
    // The already-committed history counts toward the ceiling: checking only
    // the incoming set would let a workspace grow past the limit one commit at
    // a time and become unreadable.
    const root = new MemoryDirectoryHandle();
    const committed = await artifact("workspace-root-json", "ceiling-base");
    const current = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: committed.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [committed],
    });
    const nextRoot = await artifact(
      "workspace-root-json",
      JSON.stringify({
        workspaceId: `sha256:${"1".repeat(64)}`,
        previousWorkspaceRootDigest: committed.digest,
        artifactDigests: [],
      }),
    );
    const filler = Array.from({ length: 100_000 }, (_, index) => ({
      kind: `artifact-${index}`,
      digest: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
      size: 0,
      digestVerified: true as const,
    }));

    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: nextRoot.digest,
        previousWorkspaceRootDigest: committed.digest,
        recoveredSlot: current,
        artifacts: [
          { kind: nextRoot.kind, digest: nextRoot.digest, size: nextRoot.size },
          ...filler,
        ],
        slotArtifactDigests: [nextRoot.digest],
      }),
    ).rejects.toThrow(
      /workspace history would exceed 100000 objects; export and start a new workspace/,
    );
  });

  it("refuses to write a root slot larger than a recoverable slot read", async () => {
    // Recovery reads a slot under a hard 128 KiB limit, so writing one past
    // that ceiling would commit a head no reader could ever recover. The write
    // is refused instead of producing an unreadable workspace.
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "oversize-slot");
    const bloated = `sha256:${"a".repeat(200_000)}`;

    await expect(
      commitPersistedRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: rootArtifact.digest,
        previousWorkspaceRootDigest: null,
        artifacts: [
          {
            kind: rootArtifact.kind,
            digest: rootArtifact.digest,
            size: rootArtifact.size,
          },
          { kind: "bloated", digest: bloated, size: 0 },
        ],
      }),
    ).rejects.toThrow("runtime root slot is too large");
    // Nothing was committed: recovery still reports an empty workspace.
    await expect(
      recoverRuntimeWorkspace(rootHandle(root)),
    ).resolves.toBeUndefined();
  });

  it("rejects a persist whose incoming root artifact lies about its digest", async () => {
    const root = new MemoryDirectoryHandle();
    const first = await artifact("workspace-root-json", "history-base");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: first.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [first],
    });
    const liar = await artifact("workspace-root-json", "history-liar");
    const unrelated = await artifact("blob", "unrelated-bytes");
    const misdeclared = { ...liar, digest: unrelated.digest };
    await expect(
      persistRuntimeWorkspace(rootHandle(root), {
        workspaceRootDigest: misdeclared.digest,
        previousWorkspaceRootDigest: first.digest,
        artifacts: [misdeclared],
      }),
    ).rejects.toThrow(/artifact digest mismatch for workspace-root-json/);
  });
});

import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  garbageCollectRuntimeObjects,
  exportRuntimeClosure,
  importRuntimeClosure,
  openOpfsRoot,
  openOpfsWorkspace,
  persistRuntimeQueryCache,
  persistRuntimeWorkspace,
  probeOpfsCapability,
  readRuntimeObject,
  recoverRuntimeQueryCache,
  recoverRuntimeQueryCacheSlots,
  recoverRuntimeWorkspace,
  recoverRuntimeWorkspaceRoots,
  runtimeClosureWorkspaceId,
  type PersistedRuntimeArtifact,
  type RuntimeClosureManifest,
  verifyRuntimeWorkspace,
} from "@/lib/opfsArtifactStore";

class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes = new Uint8Array();
  reads = 0;

  getFile(): Promise<File> {
    this.reads += 1;
    return Promise.resolve(new File([this.bytes], "object"));
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    let pending = new Uint8Array();
    return Promise.resolve({
      write(data: FileSystemWriteChunkType) {
        if (data instanceof Uint8Array) pending = Uint8Array.from(data);
        else if (data instanceof ArrayBuffer) pending = new Uint8Array(data);
        else throw new Error("unsupported test write");
        return Promise.resolve();
      },
      close: () => {
        this.bytes = pending;
        return Promise.resolve();
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

  async *entries(): AsyncIterableIterator<[
    string,
    FileSystemFileHandle | FileSystemDirectoryHandle,
  ]> {
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
  const value = await webcrypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${Buffer.from(value).toString("hex")}`;
}

async function artifact(
  kind: string,
  value: string,
): Promise<PersistedRuntimeArtifact> {
  const bytes = new TextEncoder().encode(value);
  return { kind, digest: await digest(bytes), size: bytes.byteLength, bytes };
}

function rootHandle(root: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return root as unknown as FileSystemDirectoryHandle;
}

function objectFile(root: MemoryDirectoryHandle, objectDigest: string): MemoryFileHandle {
  const hex = objectDigest.slice(7);
  return root.directories
    .get("chronicle-preprocessing-runtime-v1")!
    .directories.get("objects")!
    .directories.get(hex.slice(0, 2))!
    .files.get(hex.slice(2))!;
}

describe("OPFS content-addressed runtime workspace", () => {
  it("commits optional query caches without making them workspace authority", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "root-one");
    const workspaceSlot = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot],
    });
    const firstCacheBytes = new TextEncoder().encode("salsa-cache-one");
    const firstCache = await persistRuntimeQueryCache(rootHandle(root), {
      baseWorkspaceRootDigest: workspaceSlot.workspaceRootDigest,
      bytes: firstCacheBytes,
    });
    expect(firstCache.generation).toBe(1);
    await expect(
      recoverRuntimeQueryCache(rootHandle(root), workspaceSlot.workspaceRootDigest),
    ).resolves.toMatchObject({ slot: { generation: 1 }, bytes: firstCacheBytes });

    expect(
      await garbageCollectRuntimeObjects(
        rootHandle(root),
        [workspaceSlot],
        [firstCache],
      ),
    ).toBe(0);
    expect(await readRuntimeObject(rootHandle(root), firstCache.cacheObjectDigest)).toEqual(
      firstCacheBytes,
    );

    const unrelatedRoot = `sha256:${"d".repeat(64)}`;
    await expect(
      recoverRuntimeQueryCache(rootHandle(root), unrelatedRoot),
    ).resolves.toBeUndefined();
    expect((await recoverRuntimeWorkspace(rootHandle(root)))?.workspaceRootDigest).toBe(
      workspaceSlot.workspaceRootDigest,
    );
  });

  it("drops corrupt or torn optional query caches while preserving the workspace", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "stable-root");
    const workspaceSlot = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    const cache = await persistRuntimeQueryCache(rootHandle(root), {
      baseWorkspaceRootDigest: workspaceSlot.workspaceRootDigest,
      bytes: new TextEncoder().encode("cache"),
    });
    objectFile(root, cache.cacheObjectDigest).bytes = new TextEncoder().encode("bad!!");
    await expect(
      recoverRuntimeQueryCache(rootHandle(root), workspaceSlot.workspaceRootDigest),
    ).resolves.toBeUndefined();
    await expect(recoverRuntimeWorkspace(rootHandle(root))).resolves.toMatchObject({
      workspaceRootDigest: workspaceSlot.workspaceRootDigest,
    });

    const roots = root.directories
      .get("chronicle-preprocessing-runtime-v1")!
      .directories.get("roots")!;
    roots.files.get("cache-a.json")!.bytes = new TextEncoder().encode("torn");
    await expect(
      recoverRuntimeQueryCache(rootHandle(root), workspaceSlot.workspaceRootDigest),
    ).resolves.toBeUndefined();
    await expect(recoverRuntimeWorkspace(rootHandle(root))).resolves.toMatchObject({
      workspaceRootDigest: workspaceSlot.workspaceRootDigest,
    });
  });

  it("retains both cache generations so corruption falls back to the prior cache", async () => {
    const root = new MemoryDirectoryHandle();
    const rootArtifact = await artifact("workspace-root-json", "stable-root");
    const workspaceSlot = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: rootArtifact.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [rootArtifact],
    });
    const firstBytes = new TextEncoder().encode("cache-generation-one");
    const secondBytes = new TextEncoder().encode("cache-generation-two");
    const first = await persistRuntimeQueryCache(rootHandle(root), {
      baseWorkspaceRootDigest: workspaceSlot.workspaceRootDigest,
      bytes: firstBytes,
    });
    const second = await persistRuntimeQueryCache(rootHandle(root), {
      baseWorkspaceRootDigest: workspaceSlot.workspaceRootDigest,
      bytes: secondBytes,
    });
    const retained = await recoverRuntimeQueryCacheSlots(rootHandle(root));
    expect(retained.map(({ generation }) => generation)).toEqual([2, 1]);
    expect(
      await garbageCollectRuntimeObjects(rootHandle(root), [workspaceSlot], retained),
    ).toBe(0);

    objectFile(root, second.cacheObjectDigest).bytes = new TextEncoder().encode("corrupt");
    await expect(
      recoverRuntimeQueryCache(rootHandle(root), workspaceSlot.workspaceRootDigest),
    ).resolves.toMatchObject({
      slot: { generation: first.generation },
      bytes: firstBytes,
    });
  });

  it("commits alternating roots, deduplicates objects, recovers, reads, and collects", async () => {
    const root = new MemoryDirectoryHandle();
    const firstRoot = await artifact("workspace-root-json", "root-one");
    const firstPayload = await artifact("app-csv", "first");
    const first = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: firstRoot.digest,
      previousWorkspaceRootDigest: null,
      artifacts: [firstRoot, firstPayload],
    });
    expect(first.generation).toBe(1);
    expect(await readRuntimeObject(rootHandle(root), firstPayload.digest)).toEqual(
      firstPayload.bytes,
    );

    const secondRoot = await artifact("workspace-root-json", "root-two");
    const secondPayload = await artifact("app-csv", "second");
    const second = await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      artifacts: [secondRoot, secondPayload, secondPayload],
    });
    expect(second.generation).toBe(2);
    expect((await recoverRuntimeWorkspace(rootHandle(root)))?.workspaceRootDigest).toBe(
      secondRoot.digest,
    );
    expect(await recoverRuntimeWorkspaceRoots(rootHandle(root))).toHaveLength(2);
    expect(
      await garbageCollectRuntimeObjects(
        rootHandle(root),
        await recoverRuntimeWorkspaceRoots(rootHandle(root)),
      ),
    ).toBe(0);
    expect(await recoverRuntimeWorkspace(rootHandle(root))).toMatchObject({ generation: 2 });
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
    objectFile(root, secondRoot.digest).bytes = new TextEncoder().encode("corrupt");
    expect(await recoverRuntimeWorkspace(rootHandle(root))).toMatchObject({
      generation: 1,
      workspaceRootDigest: firstRoot.digest,
    });
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

    await expect(recoverRuntimeWorkspace(rootHandle(root))).resolves.toMatchObject({
      generation: 2,
    });
    expect(objectFile(root, firstRoot.digest).reads).toBe(0);
    expect(objectFile(root, firstPayload.digest).reads).toBe(0);
    expect(objectFile(root, secondRoot.digest).reads).toBeGreaterThan(0);
    expect(objectFile(root, secondPayload.digest).reads).toBeGreaterThan(0);
  });

  it("exports and imports a self-verifying portable artifact closure", async () => {
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
    const archive = await exportRuntimeClosure(rootHandle(source), slot);
    expect(runtimeClosureWorkspaceId(archive)).toBe(workspaceId);
    const destination = new MemoryDirectoryHandle();
    let verified = false;
    const imported = await importRuntimeClosure(
      rootHandle(destination),
      archive,
      (closure) => {
        expect(closure.manifest.workspaceRootDigest).toBe(rootArtifact.digest);
        expect(closure.manifest.workspaceId).toBe(workspaceId);
        expect(closure.object(payload.digest)).toEqual(payload.bytes);
        verified = true;
        return Promise.resolve();
      },
    );
    expect(verified).toBe(true);
    expect(imported.workspaceRootDigest).toBe(rootArtifact.digest);
    expect(
      await readRuntimeObject(rootHandle(destination), payload.digest),
    ).toEqual(payload.bytes);

    const corrupt = Uint8Array.from(archive);
    corrupt[corrupt.length - 1] ^= 0xff;
    await expect(
      importRuntimeClosure(rootHandle(new MemoryDirectoryHandle()), corrupt, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/digest mismatch/);
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
      .get("chronicle-preprocessing-runtime-v1")!
      .directories.get("roots")!;
    roots.files.get("root-a.json")!.bytes = new TextEncoder().encode(
      JSON.stringify({ protocolVersion: "bad", generation: 1 }),
    );
    roots.files.get("root-b.json")!.bytes = new TextEncoder().encode("not-json");
    await expect(recoverRuntimeWorkspace(rootHandle(root))).rejects.toThrow(
      /no valid artifact closure can be recovered/,
    );
    await expect(recoverRuntimeWorkspaceRoots(rootHandle(root))).rejects.toThrow(
      /no valid artifact closure can be recovered/,
    );
  });

  it("accepts shared-memory views without retaining them and repairs same-size corruption", async () => {
    const root = new MemoryDirectoryHandle();
    const source = new TextEncoder().encode("shared-root");
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(source.byteLength));
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
    expect(await readRuntimeObject(rootHandle(root), sharedArtifact.digest)).toEqual(source);

    objectFile(root, sharedArtifact.digest).bytes = new TextEncoder().encode("broken-root");
    const secondRoot = await artifact("workspace-root-json", "second-root");
    await persistRuntimeWorkspace(rootHandle(root), {
      workspaceRootDigest: secondRoot.digest,
      previousWorkspaceRootDigest: first.workspaceRootDigest,
      artifacts: [secondRoot, sharedArtifact],
    });
    expect(await readRuntimeObject(rootHandle(root), sharedArtifact.digest)).toEqual(source);
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
        checksum: await digest(new TextEncoder().encode(JSON.stringify(unsigned))),
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

    const first = await openOpfsWorkspace(`sha256:${"1".repeat(64)}`);
    const second = await openOpfsWorkspace(`sha256:${"2".repeat(64)}`);
    expect(first).not.toBe(second);
    expect(
      root.directories
        .get("chronicle-preprocessing-workspaces-v1")
        ?.directories.size,
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
    const valid = await exportRuntimeClosure(rootHandle(source), slot);
    const magic = new TextEncoder().encode("CHRONICLE-CLOSURE-V1\n");

    expect(() => runtimeClosureWorkspaceId(new Uint8Array([1, 2, 3]))).toThrow(
      /invalid runtime closure magic/,
    );
    const zeroManifest = new Uint8Array(magic.byteLength + 4);
    zeroManifest.set(magic);
    expect(() => runtimeClosureWorkspaceId(zeroManifest)).toThrow(
      /invalid runtime closure manifest size/,
    );

    type MutableClosureManifest = Omit<RuntimeClosureManifest, "protocolVersion"> & {
      protocolVersion: string;
    };
    const rewrite = (mutate: (manifest: MutableClosureManifest) => void) => {
      const oldSize = new DataView(valid.buffer, valid.byteOffset, valid.byteLength).getUint32(
        magic.byteLength,
        true,
      );
      const oldPayload = valid.slice(magic.byteLength + 4 + oldSize);
      const manifest = JSON.parse(
        new TextDecoder().decode(valid.slice(magic.byteLength + 4, magic.byteLength + 4 + oldSize)),
      ) as MutableClosureManifest;
      mutate(manifest);
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const next = new Uint8Array(magic.byteLength + 4 + manifestBytes.byteLength + oldPayload.byteLength);
      next.set(magic);
      new DataView(next.buffer).setUint32(magic.byteLength, manifestBytes.byteLength, true);
      next.set(manifestBytes, magic.byteLength + 4);
      next.set(oldPayload, magic.byteLength + 4 + manifestBytes.byteLength);
      return next;
    };

    expect(() =>
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          manifest.protocolVersion = "unsupported";
        }),
      ),
    ).toThrow(/unsupported runtime closure manifest/);
    expect(() =>
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          manifest.objects[0].size = -1;
        }),
      ),
    ).toThrow(/invalid runtime closure object table/);
    expect(() =>
      runtimeClosureWorkspaceId(
        rewrite((manifest) => {
          manifest.workspaceRootDigest = `sha256:${"9".repeat(64)}`;
        }),
      ),
    ).toThrow(/runtime closure payload is incomplete/);

    await expect(
      importRuntimeClosure(rootHandle(new MemoryDirectoryHandle()), valid, (closure) => {
        expect(() => closure.object(`sha256:${"9".repeat(64)}`)).toThrow(
          /runtime closure object is missing/,
        );
        return Promise.resolve();
      }),
    ).resolves.toMatchObject({ workspaceRootDigest: rootArtifact.digest });
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
      /workspace identity/,
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPFS_WORKSPACES_DIRECTORY,
  removeOpfsWorkspace,
} from "@/lib/opfsArtifactStore";
import {
  MemoryDirectoryHandle,
  MemoryFileHandle,
  memoryDirectoryHandle,
} from "@/testSupport/memoryFileSystem";

const TARGET = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

/** Two workspaces, each holding one object file with participant bytes. */
function workspaceTree(): MemoryDirectoryHandle {
  const root = new MemoryDirectoryHandle();
  const workspaces = new MemoryDirectoryHandle();
  root.directories.set(OPFS_WORKSPACES_DIRECTORY, workspaces);
  for (const id of [TARGET, OTHER]) {
    const workspace = new MemoryDirectoryHandle();
    const objects = new MemoryDirectoryHandle();
    const table = new MemoryFileHandle();
    table.bytes = new TextEncoder().encode("participant_id\nPMARKER777\n");
    objects.files.set("participant-table", table);
    workspace.directories.set("objects", objects);
    workspaces.directories.set(id.slice("sha256:".length), workspace);
  }
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("removeOpfsWorkspace", () => {
  it("removes exactly the named workspace directory and keeps the others", async () => {
    const root = workspaceTree();
    const workspaces = root.directories.get(OPFS_WORKSPACES_DIRECTORY)!;

    await removeOpfsWorkspace(TARGET, memoryDirectoryHandle(root));

    expect(workspaces.directories.has("a".repeat(64))).toBe(false);
    expect(workspaces.directories.has("b".repeat(64))).toBe(true);
  });

  it("treats an already-absent workspace or workspace tree as removed", async () => {
    await expect(
      removeOpfsWorkspace(TARGET, memoryDirectoryHandle(new MemoryDirectoryHandle())),
    ).resolves.toBeUndefined();

    const root = workspaceTree();
    await removeOpfsWorkspace(TARGET, memoryDirectoryHandle(root));
    await expect(
      removeOpfsWorkspace(TARGET, memoryDirectoryHandle(root)),
    ).resolves.toBeUndefined();
  });

  it("reports a removal the browser refused instead of claiming success", async () => {
    const root = workspaceTree();
    const workspaces = root.directories.get(OPFS_WORKSPACES_DIRECTORY)!;
    workspaces.removeEntry = () =>
      Promise.reject(new DOMException("in use", "NoModificationAllowedError"));

    await expect(
      removeOpfsWorkspace(TARGET, memoryDirectoryHandle(root)),
    ).rejects.toThrow("in use");
    expect(workspaces.directories.has("a".repeat(64))).toBe(true);
  });

  it("refuses a malformed workspace id rather than removing a guessed path", async () => {
    await expect(
      removeOpfsWorkspace("not-a-digest", memoryDirectoryHandle(workspaceTree())),
    ).rejects.toThrow("invalid SHA-256 digest");
  });

  it("reports a refused workspace-tree lookup instead of treating it as absent", async () => {
    const root = workspaceTree();
    root.getDirectoryHandle = () =>
      Promise.reject(new DOMException("denied", "SecurityError"));

    await expect(
      removeOpfsWorkspace(TARGET, memoryDirectoryHandle(root)),
    ).rejects.toThrow("denied");
  });

  it("removes from the browser's own OPFS root when no root is supplied", async () => {
    const root = workspaceTree();
    const workspaces = root.directories.get(OPFS_WORKSPACES_DIRECTORY)!;
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve(memoryDirectoryHandle(root)) },
    });

    await removeOpfsWorkspace(TARGET);

    expect(workspaces.directories.has("a".repeat(64))).toBe(false);
    expect(workspaces.directories.has("b".repeat(64))).toBe(true);
  });
});

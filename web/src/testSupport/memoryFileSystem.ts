/**
 * Minimal deterministic File System Access implementation used by storage
 * tests and proof tooling. It intentionally models only the methods exercised
 * by the production OPFS adapter.
 */

export type MemoryWriteGeometry = {
  byteOffset: number;
  byteLength: number;
  bufferBytes: number;
};

export class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes = new Uint8Array();
  reads = 0;
  retainReadBuffers = false;
  readonly retainedReadBuffers: Uint8Array[] = [];
  lastWriteGeometry: MemoryWriteGeometry | undefined;
  nextReadError: Error | undefined;
  errorOnReadNumber: { read: number; error: Error } | undefined;
  nextWriteTransform:
    | ((bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>)
    | undefined;

  getFile(): Promise<File> {
    this.reads += 1;
    if (this.errorOnReadNumber?.read === this.reads) {
      const { error } = this.errorOnReadNumber;
      this.errorOnReadNumber = undefined;
      return Promise.reject(error);
    }
    if (this.nextReadError) {
      const error = this.nextReadError;
      this.nextReadError = undefined;
      return Promise.reject(error);
    }
    const file = new File([this.bytes], "object");
    if (!this.retainReadBuffers) return Promise.resolve(file);
    return Promise.resolve(
      new Proxy(file, {
        get: (target, property, receiver) => {
          if (property === "arrayBuffer") {
            return async () => {
              const buffer = await target.arrayBuffer();
              this.retainedReadBuffers.push(new Uint8Array(buffer));
              return buffer;
            };
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? (value as (...args: never[]) => unknown).bind(target)
            : value;
        },
      }),
    );
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
        } else {
          throw new Error("unsupported test write");
        }
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

export class MemoryDirectoryHandle {
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

export function memoryDirectoryHandle(
  directory: MemoryDirectoryHandle,
): FileSystemDirectoryHandle {
  return directory as unknown as FileSystemDirectoryHandle;
}

import { describe, expect, it, vi } from "vitest";

import {
  beginParticipantInspectionBatchZeroing,
  withRuntimeExecutionLane,
  withParticipantPartitionLane,
} from "@/lib/participantPartitionLane";

const batchId = `sha256:${"a".repeat(64)}`;
const partition = {
  participantPartitionBatchId: batchId,
  fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
};

function input() {
  const secretBuffer = new Uint8Array(32).fill(7).buffer;
  const begin = vi.fn(() => Promise.resolve(batchId));
  const register = vi.fn(() => Promise.resolve());
  const dispose = vi.fn(() => Promise.resolve(true));
  const execute = vi.fn(() => Promise.resolve("done"));
  return {
    secretBuffer,
    begin,
    register,
    dispose,
    execute,
    run: () =>
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1, 2, 3]),
        partition,
        secretBuffer,
        operations: { begin, register, dispose },
        execute,
      }),
  };
}

describe("withParticipantPartitionLane", () => {
  it.each(["success", "rejection"])(
    "zeroes the worker-side inspection secret after begin %s",
    async (outcome) => {
      const buffer = new Uint8Array(32).fill(6).buffer;
      const begin =
        outcome === "success"
          ? vi.fn(() => Promise.resolve(batchId))
          : vi.fn(() => Promise.reject(new Error("begin refused")));
      const result = beginParticipantInspectionBatchZeroing(buffer, begin);
      if (outcome === "success") await expect(result).resolves.toBe(batchId);
      else await expect(result).rejects.toThrow("begin refused");
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array(32));
    },
  );

  it("keeps begin, registration, execution, and disposal in exact order", async () => {
    const fixture = input();
    await expect(fixture.run()).resolves.toBe("done");
    expect(fixture.begin.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.register.mock.invocationCallOrder[0]!,
    );
    expect(fixture.register.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.execute.mock.invocationCallOrder[0]!,
    );
    expect(fixture.execute.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.dispose.mock.invocationCallOrder[0]!,
    );
    expect(new Uint8Array(fixture.secretBuffer)).toEqual(new Uint8Array(32));
  });

  it.each(["identity mismatch", "registration refusal", "execute refusal"])(
    "disposes and wipes after %s",
    async (failure) => {
      const fixture = input();
      if (failure === "identity mismatch") {
        fixture.begin.mockResolvedValue(`sha256:${"c".repeat(64)}`);
      } else if (failure === "registration refusal") {
        fixture.register.mockRejectedValue(new Error("register refused"));
      } else {
        fixture.execute.mockRejectedValue(new Error("execute refused"));
      }
      await expect(fixture.run()).rejects.toThrow();
      expect(fixture.dispose).toHaveBeenCalledTimes(1);
      expect(new Uint8Array(fixture.secretBuffer)).toEqual(new Uint8Array(32));
    },
  );

  it("detaches inactive metadata without touching the registry", async () => {
    const begin = vi.fn();
    const register = vi.fn();
    const dispose = vi.fn();
    const execute = vi.fn(() => Promise.resolve("inactive"));
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1]),
        partition: undefined,
        secretBuffer: undefined,
        operations: { begin, register, dispose },
        execute,
      }),
    ).resolves.toBe("inactive");
    expect(begin).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(undefined);
  });

  it("serializes rapid active lanes through each complete disposal", async () => {
    let releaseFirst = (): void => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    let execution = 0;
    const operations = {
      begin: vi.fn(() => {
        events.push("begin");
        return Promise.resolve(batchId);
      }),
      register: vi.fn(() => {
        events.push("register");
        return Promise.resolve();
      }),
      dispose: vi.fn(() => {
        events.push("dispose");
        return Promise.resolve(true);
      }),
    };
    const run = () =>
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1]),
        partition,
        secretBuffer: new Uint8Array(32).fill(9).buffer,
        operations,
        execute: async () => {
          execution += 1;
          events.push(`execute-${execution}`);
          if (execution === 1) await firstBlocked;
          return execution;
        },
      });
    const first = run();
    await vi.waitFor(() => expect(events).toContain("execute-1"));
    const second = run();
    await Promise.resolve();
    expect(events).toEqual(["begin", "register", "execute-1"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual([
      "begin",
      "register",
      "execute-1",
      "dispose",
      "begin",
      "register",
      "execute-2",
      "dispose",
    ]);
  });

  it("serializes active no-overlap preflight/execute pairs without registry work", async () => {
    let releaseFirst = (): void => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    let execution = 0;
    const operations = {
      begin: vi.fn(),
      register: vi.fn(),
      dispose: vi.fn(),
    };
    const run = () =>
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1]),
        partition: undefined,
        secretBuffer: undefined,
        operations,
        execute: async () => {
          execution += 1;
          const current = execution;
          events.push(`preflight-execute-${current}`);
          if (current === 1) await firstBlocked;
          events.push(`complete-${current}`);
          return current;
        },
      });
    const first = run();
    await vi.waitFor(() =>
      expect(events).toContain("preflight-execute-1"),
    );
    const second = run();
    await Promise.resolve();
    expect(events).toEqual(["preflight-execute-1"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual([
      "preflight-execute-1",
      "complete-1",
      "preflight-execute-2",
      "complete-2",
    ]);
    expect(operations.begin).not.toHaveBeenCalled();
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.dispose).not.toHaveBeenCalled();
  });

  it("serializes inactive work behind an active no-overlap lane so it cannot steal the pending receipt", async () => {
    let releaseFirst = (): void => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: number[] = [];
    const operations = {
      begin: vi.fn(),
      register: vi.fn(),
      dispose: vi.fn(),
    };
    let execution = 0;
    const run = () =>
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1]),
        partition: undefined,
        secretBuffer: undefined,
        operations,
        execute: async () => {
          execution += 1;
          const current = execution;
          started.push(current);
          if (current === 1) await firstBlocked;
          return current;
        },
      });
    const first = run();
    await vi.waitFor(() => expect(started).toEqual([1]));
    const second = run();
    await Promise.resolve();
    expect(started).toEqual([1]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(started).toEqual([1, 2]);
  });

  it("serializes a persisted review behind an active raw preflight/execute lane", async () => {
    let releaseActive = (): void => {};
    const activeBlocked = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const events: string[] = [];
    const operations = {
      begin: vi.fn(),
      register: vi.fn(),
      dispose: vi.fn(),
    };
    const active = withParticipantPartitionLane({
      csvBytes: new Uint8Array([1]),
      partition: undefined,
      secretBuffer: undefined,
      operations,
      execute: async () => {
        events.push("active-preflight-execute");
        await activeBlocked;
        events.push("active-finalized");
        return "active";
      },
    });
    await vi.waitFor(() =>
      expect(events).toEqual(["active-preflight-execute"]),
    );
    const persisted = withRuntimeExecutionLane(() => {
      events.push("persisted-review");
      return Promise.resolve("persisted");
    });
    await Promise.resolve();
    expect(events).toEqual(["active-preflight-execute"]);
    releaseActive();
    await expect(Promise.all([active, persisted])).resolves.toEqual([
      "active",
      "persisted",
    ]);
    expect(events).toEqual([
      "active-preflight-execute",
      "active-finalized",
      "persisted-review",
    ]);
  });

  it("hands the lane to the next operation after the one before it rejected", async () => {
    const failing = withRuntimeExecutionLane(() =>
      Promise.reject(new Error("execution refused")),
    );
    await expect(failing).rejects.toThrow("execution refused");
    await expect(
      withRuntimeExecutionLane(() => Promise.resolve("next")),
    ).resolves.toBe("next");
  });
});

describe("withParticipantPartitionLane disposal", () => {
  it("disposes nothing when no batch was ever configured", async () => {
    const dispose = vi.fn(() => Promise.resolve(true));
    await expect(
      withParticipantPartitionLane({
        csvBytes: new Uint8Array([1, 2, 3]),
        partition,
        secretBuffer: new Uint8Array(32).fill(7).buffer,
        operations: {
          begin: () => Promise.reject(new Error("begin refused")),
          register: () => Promise.resolve(),
          dispose,
        },
        execute: () => Promise.resolve("unreached"),
      }),
    ).rejects.toThrow("begin refused");
    expect(dispose).not.toHaveBeenCalled();
  });
});

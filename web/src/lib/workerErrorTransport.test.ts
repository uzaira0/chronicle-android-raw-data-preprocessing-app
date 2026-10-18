import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";

import { failureText, UserFacingError } from "@/lib/diagnostics";
import { installUserFacingErrorTransport } from "@/lib/workerErrorTransport";

type Handler = Comlink.TransferHandler<{ value: unknown }, unknown>;

function roundTrip(value: unknown): unknown {
  installUserFacingErrorTransport();
  const handler = Comlink.transferHandlers.get("throw") as Handler;
  const [wire] = handler.serialize({ value });
  // Structured clone is what postMessage applies between the worker and the page.
  const received = structuredClone(wire);
  try {
    handler.deserialize(received);
  } catch (error) {
    return error;
  }
  throw new Error("deserialize must throw");
}

describe("worker error transport", () => {
  it("keeps a researcher-facing error, its name and its details across the worker boundary", () => {
    class RefusalError extends UserFacingError {
      constructor() {
        super("The long episode rule you chose cannot run with your other settings.", "strict_max refused: provider_unavailable");
        this.name = "RefusalError";
      }
    }
    const received = roundTrip(new RefusalError());
    expect(received).toBeInstanceOf(UserFacingError);
    expect(received).toMatchObject({
      name: "RefusalError",
      message: "The long episode rule you chose cannot run with your other settings.",
      details: "strict_max refused: provider_unavailable",
    });
    expect(failureText(received, "unused lead").message).toBe(
      "The long episode rule you chose cannot run with your other settings.",
    );
  });

  it("leaves an internal error unmarked, so the page shows a plain sentence instead", () => {
    const received = roundTrip(new Error("persisted artifact closure identity mismatch"));
    expect(received).toBeInstanceOf(Error);
    expect(received).not.toBeInstanceOf(UserFacingError);
    const shown = failureText(received, "P01.csv could not be processed.");
    expect(shown.message).toMatch(/^P01\.csv could not be processed\./);
    expect(shown.details).toBe("persisted artifact closure identity mismatch");
  });

  it("passes a thrown non-error through unchanged", () => {
    expect(roundTrip({ kind: "plain" })).toEqual({ kind: "plain" });
  });
});

import * as Comlink from "comlink";

import { UserFacingError } from "@/lib/diagnostics";

type Thrown = { value: unknown };
type Wire = { isError?: boolean; value?: unknown; userFacingDetails?: string | null };

let installed = false;

/**
 * Comlink rebuilds an Error thrown in a worker from its message, name and
 * stack only, so a UserFacingError would reach the page as a plain Error and
 * be shown as a generic failure. This wraps Comlink's own "throw" handler to
 * keep the marker and its technical details. Install it in the worker and on
 * the page before the first call; repeat calls do nothing.
 */
export function installUserFacingErrorTransport(): void {
  if (installed) return;
  const builtIn = Comlink.transferHandlers.get("throw") as Comlink.TransferHandler<Thrown, Wire> | undefined;
  // A test that replaces Comlink has no built-in handler to wrap.
  if (!builtIn) return;
  installed = true;
  Comlink.transferHandlers.set("throw", {
    canHandle: (value: unknown): value is Thrown => builtIn.canHandle(value),
    serialize(thrown: Thrown): [Wire, Transferable[]] {
      const [wire, transfer] = builtIn.serialize(thrown);
      return thrown.value instanceof UserFacingError
        ? [{ ...wire, userFacingDetails: thrown.value.details ?? null }, transfer]
        : [wire, transfer];
    },
    deserialize(wire: Wire): Thrown {
      let original: unknown;
      try {
        original = builtIn.deserialize(wire);
      } catch (error) {
        original = error;
      }
      if (wire.userFacingDetails === undefined || !(original instanceof Error)) throw original;
      throw Object.assign(new UserFacingError(original.message, wire.userFacingDetails ?? undefined), {
        name: original.name,
        stack: original.stack,
      });
    },
  } as Comlink.TransferHandler<Thrown, Wire>);
}

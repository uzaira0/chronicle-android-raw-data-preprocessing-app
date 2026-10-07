/**
 * A failure inside a worker that no request is waiting on (today: the sweep
 * that removes dead workers' payload spill files). The worker posts it beside
 * the Comlink channel, the same way it announces `chronicle-worker-api-ready/v1`,
 * and `rustWorkerClient` hands it to the page so it reaches the user instead
 * of only the worker console.
 */
export const WORKER_BACKGROUND_FAILURE_MESSAGE = "chronicle-worker-background-failure/v1";

export type WorkerBackgroundFailure = {
  operation: "spill-sweep";
  message: string;
};

export function parseWorkerBackgroundFailure(data: unknown): WorkerBackgroundFailure | null {
  if (data === null || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (value.type !== WORKER_BACKGROUND_FAILURE_MESSAGE) return null;
  if (value.operation !== "spill-sweep" || typeof value.message !== "string") return null;
  return { operation: value.operation, message: value.message };
}

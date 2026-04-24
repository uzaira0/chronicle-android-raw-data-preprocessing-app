import * as Comlink from "comlink";
import type { MatcherInput, MatcherOutput } from "@/lib/types";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";

let workerApiPromise: Promise<Comlink.Remote<ChronicleWorkerApi>> | null = null;

async function getWorkerApi(): Promise<Comlink.Remote<ChronicleWorkerApi>> {
  if (workerApiPromise) {
    return workerApiPromise;
  }
  workerApiPromise = Promise.resolve().then(() => {
    const worker = new Worker(new URL("../workers/chronicle-worker.ts", import.meta.url), {
      type: "module",
    });
    return Comlink.wrap<ChronicleWorkerApi>(worker);
  });
  return workerApiPromise;
}

export async function getMatcherVersion(): Promise<string> {
  const api = await getWorkerApi();
  return api.matcherVersion();
}

export async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  const api = await getWorkerApi();
  return api.runMatcher(input);
}

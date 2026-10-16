import { availableParallelism, totalmem } from "node:os";

/**
 * Memory one campaign worker needs. Measured 2026-10-16 on the interaction
 * campaign (each worker is a vitest process tree of three node processes):
 * 4 workers peaked at 3.6 GiB, 8 at 7.2 GiB, 12 at 11.2 GiB.
 */
export const CAMPAIGN_WORKER_BYTES = 1024 ** 3;

/** @param {string} value e.g. "12G", "512M", "128g" @returns {number | undefined} */
function capMemoryBytes(value) {
  const match = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(value.trim());
  if (!match) return undefined;
  const unit = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[(match[2] ?? "").toUpperCase()];
  return unit === undefined ? undefined : Number(match[1]) * unit;
}

/**
 * Workers this machine can run at once across every campaign in a wave: one
 * per core but one, and no more than three quarters of the memory budget
 * holds. The budget is `CAP_MEM` when the run is capped, else the RAM.
 * @param {NodeJS.ProcessEnv} env
 */
export function machineCampaignWorkers(env = process.env) {
  const memory = (env.CAP_MEM && capMemoryBytes(env.CAP_MEM)) || totalmem();
  return Math.max(1, Math.min(availableParallelism() - 1, Math.floor((memory * 0.75) / CAMPAIGN_WORKER_BYTES)));
}

/**
 * Worker count for one campaign. `CHRONICLE_CAMPAIGN_WORKERS` sets it outright
 * (up to `maximum`). Otherwise it is this machine's share: the machine budget
 * divided by `CHRONICLE_CAMPAIGN_WORKER_SHARE`, the number of pooled campaigns
 * the evidence run starts side by side (1 when a campaign runs alone), and
 * never above `automaticMaximum`, the most workers the campaign can use well.
 * @param {{maximum: number, automaticMaximum?: number, env?: NodeJS.ProcessEnv}} input
 */
export function campaignWorkers({ maximum, automaticMaximum = maximum, env = process.env }) {
  const explicit = env.CHRONICLE_CAMPAIGN_WORKERS;
  if (explicit !== undefined && explicit !== "") {
    const requested = Number(explicit);
    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw new Error(`CHRONICLE_CAMPAIGN_WORKERS must be a positive integer, got: ${explicit}`);
    }
    return Math.min(maximum, requested);
  }
  const share = Number(env.CHRONICLE_CAMPAIGN_WORKER_SHARE ?? 1);
  if (!Number.isSafeInteger(share) || share < 1) {
    throw new Error(`CHRONICLE_CAMPAIGN_WORKER_SHARE must be a positive integer, got: ${env.CHRONICLE_CAMPAIGN_WORKER_SHARE}`);
  }
  return Math.max(1, Math.min(automaticMaximum, Math.floor(machineCampaignWorkers(env) / share)));
}

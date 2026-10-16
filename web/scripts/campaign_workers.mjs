import { availableParallelism, totalmem } from "node:os";

const GiB = 1024 ** 3;

/**
 * Per campaign: the most workers it can use (`maximum`), the most it starts
 * when nobody asks for more (`automaticMaximum`), and the peak memory of one
 * worker. Memory measured 2026-10-16 as the peak RSS of each runner's whole
 * process tree divided by its workers: configuration 9.4 GiB / 10,
 * artifact 6.9 GiB / 6, raw boundary 6.9 GiB / 6, interaction 11.2 GiB / 12,
 * mixed 21.5 GiB / 9, field-mixed tomography 14.3 GiB / 12.
 */
export const CAMPAIGN_WORKER_PROFILES = {
  // 12 and 31 workers both finish in about 60 s on the 32-core reference
  // machine, so 12 is the automatic ceiling; explicit runs may go to 32.
  "configuration-influence": { maximum: 32, automaticMaximum: 12, workerBytes: 1 * GiB },
  "artifact-influence": { maximum: 6, automaticMaximum: 6, workerBytes: 1.25 * GiB },
  // One worker per raw-boundary corpus.
  "raw-boundary-influence": { maximum: 6, automaticMaximum: 6, workerBytes: 1.25 * GiB },
  "interaction-influence": { maximum: 12, automaticMaximum: 12, workerBytes: 1 * GiB },
  // One worker per source role.
  "mixed-artifact-configuration": { maximum: 9, automaticMaximum: 9, workerBytes: 2.5 * GiB },
  // One worker per campaign column; the runner passes the column count.
  "field-mixed-tomography": { maximum: Infinity, automaticMaximum: Infinity, workerBytes: 1.25 * GiB },
};

/** @typedef {keyof typeof CAMPAIGN_WORKER_PROFILES} CampaignWorkerId */

/** @param {string} value e.g. "12G", "512M", "128g" @returns {number | undefined} */
function capMemoryBytes(value) {
  const match = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(value.trim());
  if (!match) return undefined;
  const unit = { "": 1, K: 1024, M: 1024 ** 2, G: GiB, T: 1024 ** 4 }[(match[2] ?? "").toUpperCase()];
  return unit === undefined ? undefined : Number(match[1]) * unit;
}

/**
 * What this machine can give the campaigns of one evidence step: a worker per
 * core but one, and 85% of the memory budget, which is `CAP_MEM` when the run
 * is capped and the RAM otherwise.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function machineWorkerBudget(env = process.env) {
  const memory = (env.CAP_MEM && capMemoryBytes(env.CAP_MEM)) || totalmem();
  return { workers: Math.max(1, availableParallelism() - 1), bytes: memory * 0.85 };
}

/** @param {NodeJS.ProcessEnv} env @returns {number | undefined} */
function explicitWorkers(env) {
  const explicit = env.CHRONICLE_CAMPAIGN_WORKERS;
  if (explicit === undefined || explicit === "") return undefined;
  const requested = Number(explicit);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error(`CHRONICLE_CAMPAIGN_WORKERS must be a positive integer, got: ${explicit}`);
  }
  return requested;
}

/**
 * Workers for one campaign started by itself. `CHRONICLE_CAMPAIGN_WORKERS`
 * sets the count outright (up to the campaign's maximum); otherwise it is as
 * many as the machine's cores and memory hold, up to the automatic maximum.
 * The dependency-evidence run, which starts campaigns side by side, passes each
 * one its share from `splitCampaignWorkers` through `CHRONICLE_CAMPAIGN_WORKERS`.
 * @param {CampaignWorkerId} id
 * @param {{maximum?: number, env?: NodeJS.ProcessEnv}} [options] `maximum`
 *   narrows the profile's (the field-mixed runner passes its column count)
 */
export function campaignWorkers(id, { maximum, env = process.env } = {}) {
  const profile = CAMPAIGN_WORKER_PROFILES[id];
  const limit = Math.min(profile.maximum, maximum ?? Infinity);
  const explicit = explicitWorkers(env);
  if (explicit !== undefined) return Math.max(1, Math.min(limit, explicit));
  const budget = machineWorkerBudget(env);
  return Math.max(
    1,
    Math.min(limit, profile.automaticMaximum, budget.workers, Math.floor(budget.bytes / profile.workerBytes)),
  );
}

/**
 * Share the machine between campaigns that run at the same time. Each starts
 * with one worker; then workers are handed out one at a time to the campaign
 * furthest below its automatic maximum, as long as the total stays within the
 * machine's cores and memory after `reserved` (another process of the same
 * step). With `CHRONICLE_CAMPAIGN_WORKERS` set, every campaign gets that count.
 * @param {CampaignWorkerId[]} ids
 * @param {{reserved?: {workers: number, bytes: number}, env?: NodeJS.ProcessEnv}} [options]
 * @returns {Record<string, number>}
 */
export function splitCampaignWorkers(ids, { reserved = { workers: 0, bytes: 0 }, env = process.env } = {}) {
  const explicit = explicitWorkers(env);
  if (explicit !== undefined) {
    return Object.fromEntries(ids.map((id) => [id, Math.min(CAMPAIGN_WORKER_PROFILES[id].maximum, explicit)]));
  }
  const budget = machineWorkerBudget(env);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(ids.map((id) => [id, 1]));
  let workers = reserved.workers + ids.length;
  let bytes = reserved.bytes + ids.reduce((sum, id) => sum + CAMPAIGN_WORKER_PROFILES[id].workerBytes, 0);
  for (;;) {
    const next = ids
      .filter((id) => {
        const profile = CAMPAIGN_WORKER_PROFILES[id];
        return (
          (counts[id] ?? 0) < profile.automaticMaximum &&
          workers + 1 <= budget.workers &&
          bytes + profile.workerBytes <= budget.bytes
        );
      })
      .sort(
        (left, right) =>
          (counts[left] ?? 0) / CAMPAIGN_WORKER_PROFILES[left].automaticMaximum -
          (counts[right] ?? 0) / CAMPAIGN_WORKER_PROFILES[right].automaticMaximum,
      )[0];
    if (next === undefined) return counts;
    counts[next] = (counts[next] ?? 0) + 1;
    workers += 1;
    bytes += CAMPAIGN_WORKER_PROFILES[next].workerBytes;
  }
}

import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_WORKER_PROFILES,
  campaignWorkers,
  machineWorkerBudget,
  splitCampaignWorkers,
} from "../../scripts/campaign_workers.mjs";

const GiB = 1024 ** 3;
const cores = Math.max(1, availableParallelism() - 1);

describe("campaign worker count", () => {
  it("budgets a worker per core but one and 85% of the memory cap", () => {
    expect(machineWorkerBudget({ CAP_MEM: "12G" })).toEqual({ workers: cores, bytes: 12 * GiB * 0.85 });
    expect(machineWorkerBudget({ CAP_MEM: "12288M" }).bytes).toBe(12 * GiB * 0.85);
  });

  it("fits one campaign to the machine's cores and memory, up to its automatic maximum", () => {
    // 12 GiB at 85% holds ten 1 GiB configuration workers, under its automatic 12.
    expect(campaignWorkers("configuration-influence", { env: { CAP_MEM: "12G" } })).toBe(Math.min(cores, 10));
    // ...and four 2.5 GiB mixed workers.
    expect(campaignWorkers("mixed-artifact-configuration", { env: { CAP_MEM: "12G" } })).toBe(Math.min(cores, 4));
    // A runner's own limit narrows the profile.
    expect(campaignWorkers("field-mixed-tomography", { maximum: 3, env: { CAP_MEM: "64G" } })).toBe(Math.min(cores, 3));
    // Never zero, even when the cap holds less than one worker.
    expect(campaignWorkers("mixed-artifact-configuration", { env: { CAP_MEM: "512M" } })).toBe(1);
  });

  it("lets an explicit count override the machine, up to the campaign's maximum", () => {
    const env = { CHRONICLE_CAMPAIGN_WORKERS: "24", CAP_MEM: "1G" };
    expect(campaignWorkers("configuration-influence", { env })).toBe(24);
    expect(campaignWorkers("artifact-influence", { env })).toBe(CAMPAIGN_WORKER_PROFILES["artifact-influence"].maximum);
    expect(campaignWorkers("field-mixed-tomography", { maximum: 5, env })).toBe(5);
    for (const bad of ["0", "-2", "1.5", "many"]) {
      expect(() => campaignWorkers("interaction-influence", { env: { CHRONICLE_CAMPAIGN_WORKERS: bad } })).toThrow(
        "CHRONICLE_CAMPAIGN_WORKERS must be a positive integer",
      );
    }
    expect(
      splitCampaignWorkers(["interaction-influence", "mixed-artifact-configuration"], {
        env: { CHRONICLE_CAMPAIGN_WORKERS: "10" },
      }),
    ).toEqual({ "interaction-influence": 10, "mixed-artifact-configuration": 9 });
  });

  it("shares the machine between campaigns that run side by side, within cores and memory", () => {
    const ids = ["interaction-influence", "mixed-artifact-configuration"] as const;
    const env = { CAP_MEM: "12G" };
    const split = splitCampaignWorkers([...ids], { env });
    const budget = machineWorkerBudget(env);
    const used = ids.reduce((sum, id) => sum + (split[id] ?? 0) * CAMPAIGN_WORKER_PROFILES[id].workerBytes, 0);
    const workers = ids.reduce((sum, id) => sum + (split[id] ?? 0), 0);
    expect(used).toBeLessThanOrEqual(budget.bytes);
    expect(workers).toBeLessThanOrEqual(budget.workers);
    // Nothing left over: one more worker for either campaign breaks a limit.
    for (const id of ids) {
      const profile = CAMPAIGN_WORKER_PROFILES[id];
      expect(
        (split[id] ?? 0) >= profile.automaticMaximum ||
          workers + 1 > budget.workers ||
          used + profile.workerBytes > budget.bytes,
      ).toBe(true);
    }
    // Room for no more than the first worker of each: both still run.
    expect(splitCampaignWorkers([...ids], { env: { CAP_MEM: "1G" } })).toEqual({
      "interaction-influence": 1,
      "mixed-artifact-configuration": 1,
    });
  });

  it("leaves room for a reserved process of the same step", () => {
    const ids: ["configuration-influence", "artifact-influence"] = ["configuration-influence", "artifact-influence"];
    const env = { CAP_MEM: "24G" };
    const reserved = { workers: 1, bytes: 8 * GiB };
    const split = splitCampaignWorkers(ids, { env, reserved });
    const budget = machineWorkerBudget(env);
    const used = ids.reduce((sum, id) => sum + (split[id] ?? 0) * CAMPAIGN_WORKER_PROFILES[id].workerBytes, 0);
    const workers = ids.reduce((sum, id) => sum + (split[id] ?? 0), 0);
    expect(reserved.bytes + used).toBeLessThanOrEqual(budget.bytes);
    // Without the reservation the same budget fills to the automatic maxima (12 + 6
    // workers, 19.5 GiB of 20.4) wherever the cores allow it.
    expect(used).toBeLessThan(19.5 * GiB);
    expect(workers === ids.length || reserved.workers + workers <= budget.workers).toBe(true);
  });
});

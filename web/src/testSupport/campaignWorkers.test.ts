import { availableParallelism, totalmem } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_WORKER_BYTES,
  campaignWorkers,
  machineCampaignWorkers,
} from "../../scripts/campaign_workers.mjs";

const cores = availableParallelism() - 1;

describe("campaign worker count", () => {
  it("is bounded by both cores and the memory budget", () => {
    expect(machineCampaignWorkers({})).toBe(
      Math.max(1, Math.min(cores, Math.floor((totalmem() * 0.75) / CAMPAIGN_WORKER_BYTES))),
    );
    // A 4 GiB cap holds three 1 GiB workers at three quarters, whatever the core count.
    expect(machineCampaignWorkers({ CAP_MEM: "4G" })).toBe(Math.max(1, Math.min(cores, 3)));
    expect(machineCampaignWorkers({ CAP_MEM: "4096M" })).toBe(Math.max(1, Math.min(cores, 3)));
    // Never zero, even when the cap holds less than one worker.
    expect(machineCampaignWorkers({ CAP_MEM: "512M" })).toBe(1);
  });

  it("splits the machine between campaigns that run side by side, within each campaign's useful maximum", () => {
    const env = { CAP_MEM: "12G" }; // nine workers at most
    const machine = machineCampaignWorkers(env);
    expect(campaignWorkers({ maximum: 32, env })).toBe(machine);
    expect(campaignWorkers({ maximum: 32, env: { ...env, CHRONICLE_CAMPAIGN_WORKER_SHARE: "3" } })).toBe(
      Math.max(1, Math.floor(machine / 3)),
    );
    expect(campaignWorkers({ maximum: 2, env })).toBe(Math.min(2, machine));
    expect(campaignWorkers({ maximum: 32, automaticMaximum: 1, env })).toBe(1);
  });

  it("lets an explicit count override the machine, up to the campaign's maximum", () => {
    expect(campaignWorkers({ maximum: 12, env: { CHRONICLE_CAMPAIGN_WORKERS: "4", CAP_MEM: "1G" } })).toBe(4);
    expect(campaignWorkers({ maximum: 6, env: { CHRONICLE_CAMPAIGN_WORKERS: "24" } })).toBe(6);
    expect(campaignWorkers({ maximum: 32, automaticMaximum: 12, env: { CHRONICLE_CAMPAIGN_WORKERS: "24" } })).toBe(24);
    for (const bad of ["0", "-2", "1.5", "many"]) {
      expect(() => campaignWorkers({ maximum: 12, env: { CHRONICLE_CAMPAIGN_WORKERS: bad } })).toThrow(
        "CHRONICLE_CAMPAIGN_WORKERS must be a positive integer",
      );
    }
    expect(() => campaignWorkers({ maximum: 12, env: { CHRONICLE_CAMPAIGN_WORKER_SHARE: "0" } })).toThrow(
      "CHRONICLE_CAMPAIGN_WORKER_SHARE must be a positive integer",
    );
  });
});

export interface CampaignWorkerProfile {
  maximum: number;
  automaticMaximum: number;
  workerBytes: number;
}
export declare const CAMPAIGN_WORKER_PROFILES: {
  readonly "configuration-influence": CampaignWorkerProfile;
  readonly "artifact-influence": CampaignWorkerProfile;
  readonly "raw-boundary-influence": CampaignWorkerProfile;
  readonly "interaction-influence": CampaignWorkerProfile;
  readonly "mixed-artifact-configuration": CampaignWorkerProfile;
  readonly "field-mixed-tomography": CampaignWorkerProfile;
};
export type CampaignWorkerId = keyof typeof CAMPAIGN_WORKER_PROFILES;
export declare function machineWorkerBudget(env?: NodeJS.ProcessEnv): { workers: number; bytes: number };
export declare function campaignWorkers(
  id: CampaignWorkerId,
  options?: { maximum?: number; env?: NodeJS.ProcessEnv },
): number;
export declare function splitCampaignWorkers(
  ids: CampaignWorkerId[],
  options?: { reserved?: { workers: number; bytes: number }; env?: NodeJS.ProcessEnv },
): Record<string, number>;

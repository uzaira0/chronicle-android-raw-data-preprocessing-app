export declare const CAMPAIGN_WORKER_BYTES: number;
export declare function machineCampaignWorkers(env?: NodeJS.ProcessEnv): number;
export declare function campaignWorkers(input: {
  maximum: number;
  automaticMaximum?: number;
  env?: NodeJS.ProcessEnv;
}): number;

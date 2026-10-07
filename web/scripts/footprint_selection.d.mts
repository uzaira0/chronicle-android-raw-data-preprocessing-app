export interface SelectableCampaign {
  id: string;
  stepLabel: string;
  ledger: string;
  /** Runner script and campaign test file, web-relative. */
  harnessEntries: string[];
}

export interface SelectionBasis {
  perFileDigests: Record<string, string>;
  manifestClosureDigest: string;
  contractDigest: string;
  /** Per campaign id. */
  harnessDigests: Record<string, string>;
  toolchain: string;
}

export type CampaignVerdict =
  | { verdict: "clean" }
  | { verdict: "dirty"; reason: string };

export interface ImplementationReceipt {
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
}

/** Toolchain name for the instrumented build and its llvm tools
 * (CHRONICLE_NIGHTLY_TOOLCHAIN, default "nightly"). */
export const NIGHTLY_TOOLCHAIN: string;
export const SELECTABLE_CAMPAIGNS: readonly SelectableCampaign[];

export function currentSelectionBasis(input: {
  repositoryRoot: string;
  webRoot: string;
}): SelectionBasis;

export function assertSelectionBasisUnchanged(
  initial: SelectionBasis,
  current: SelectionBasis,
): void;

export function harnessClosureFiles(webRoot: string, entries: string[]): string[];
export function footprintDir(repositoryRoot: string): string;

export function campaignVerdict(input: {
  campaign: SelectableCampaign;
  basis: SelectionBasis;
  repositoryRoot: string;
}): CampaignVerdict;

export function recordCampaignFootprint(input: {
  campaign: SelectableCampaign;
  basis: SelectionBasis;
  repositoryRoot: string;
  profrawRoot: string;
  linkedBootstrapWasm: string;
}): { covered: number; untracked: number };

export function restampInheritedLedger(input: {
  familyExpectedDir: string;
  campaign: SelectableCampaign;
  donorReceipt: ImplementationReceipt;
  footprintFileDigest: string;
}): void;

export function classifyCoverageFile(
  filename: string,
  repositoryRoot: string,
):
  | { kind: "repository"; key: string }
  | { kind: "registry" | "toolchain"; key: string };

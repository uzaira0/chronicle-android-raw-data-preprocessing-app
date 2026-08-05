/** Stable framing and manifest contract for portable workflow workspaces. */
export const WORKFLOW_CLOSURE_MAGIC_TEXT =
  "CHRONICLE-WORKFLOW-CLOSURE-V1\n" as const;
export const WORKFLOW_CLOSURE_PROTOCOL_VERSION =
  "chronicle-runtime-closure/v1" as const;
export const WORKFLOW_CLOSURE_ARCHIVE_MIME =
  "application/vnd.chronicle.workflow-workspace" as const;

export function encodeWorkflowClosureMagic(): Uint8Array {
  return new TextEncoder().encode(WORKFLOW_CLOSURE_MAGIC_TEXT);
}

export type RuntimeClosureManifest = {
  protocolVersion: typeof WORKFLOW_CLOSURE_PROTOCOL_VERSION;
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  objects: Array<{ digest: string; size: number; offset: number }>;
};

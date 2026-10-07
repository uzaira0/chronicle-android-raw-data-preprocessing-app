import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";

const digest = (character: string): string =>
  `sha256:${character.repeat(64)}`;

/** Exact generated-boundary fixture for structured-clone/preflight tests. */
export function runtimeScientificPreflightFixture(): RuntimeScientificPreflightReceipt {
  return {
    protocolVersion: "chronicle-runtime-scientific-preflight/v2",
    key: {
      protocolVersion: "chronicle-runtime-scientific-preflight/v2",
      optionsDigest: digest("1"),
      inputDigest: digest("2"),
      inputSizeBytes: 91,
      activeIngressRoles: {},
      fragmentedParticipantCount: 0,
      fragmentedParticipantTokenScopeDigest: digest("3"),
    },
    keyDigest: digest("4"),
    b05Schoedel: {
      protocolVersion: "chronicle-b05-schoedel-preflight/v1",
      disposition: "not_applicable",
      optionsDigest: digest("1"),
      componentOptionsDigest: digest("5"),
      screenComponentOptionsDigest: digest("6"),
      schoedelComponentOptionsDigest: digest("7"),
      optionsDigestOrigin: "verified_request_jcs",
      requestedScreenStrategyId: "chronicle_screen_interactive_v1",
      effectiveScreenStrategyId: "chronicle_screen_interactive_v1",
      requestedEpisodeStrategyId: "fused_state_machine_v1",
      effectiveEpisodeStrategyId: "fused_state_machine_v1",
      screenConstructionPhase: "not_applicable",
      schoedelReconstructionPhase: "not_applicable",
      screenApplicability: null,
      schoedelApplicability: null,
    },
    b05SchoedelDigest: digest("8"),
    eyesInputPartition: {
      protocolVersion: "chronicle-eyes-input-partition-preflight/v2",
      disposition: "not_applicable",
      inputDigest: digest("2"),
      optionsDigest: digest("1"),
      optionsDigestOrigin: "verified_request_jcs",
      requestedEpisodeStrategyId: "fused_state_machine_v1",
      effectiveEpisodeStrategyId: null,
      relation: null,
      refusalReason: null,
      refusalDetail: null,
      fragmentedParticipantCount: 0,
      resolutionDigest: digest("9"),
    },
    eyesInputPartitionDigest: digest("a"),
    commitDigest: digest("b"),
  };
}

/** Exact refusal-shaped variant used to prove browser decision visibility. */
export function runtimeScientificRefusalFixture(): RuntimeScientificPreflightReceipt {
  const receipt = runtimeScientificPreflightFixture();
  return {
    ...receipt,
    b05Schoedel: {
      ...receipt.b05Schoedel,
      disposition: "refused",
      screenConstructionPhase: "prepared_raw_source_arm",
      screenApplicability: {
        protocolVersion: "chronicle-b05-foundational-semantics/v1",
        relation: "refused",
        executable: false,
        refusalReason: "capability_evidence_not_bound_to_input",
        refusalDetail: "capability_evidence_not_bound_to_input",
      },
    },
  };
}

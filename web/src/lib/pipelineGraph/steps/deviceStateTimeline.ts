import {
  buildClassifiedScreenSessions,
  collectKeyguardShownTimestamps,
  walkScreenStateMachine,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("device_state_timeline");

export const collectKeyguard = step({
  id: "collect_keyguard_timestamps",
  label: "Collect keyguard timestamps",
  description: "Sorted timestamps of every keyguard-shown event — the lock-screen evidence stream.",
  inputs: { rows: appPolicyWiring.ports.rows },
  run: ({ rows }) => collectKeyguardShownTimestamps(rows),
});

export const walkStateMachine = step({
  id: "walk_screen_state_machine",
  label: "Walk screen state machine",
  description:
    "CLOSED —screen-start→ OPEN —screen-stop→ CLOSED, accumulating keyguard/unlock/foreground evidence; emits one close per session.",
  inputs: { rows: appPolicyWiring.ports.rows },
  run: ({ rows }) => walkScreenStateMachine(rows),
});

export const buildClassifiedSessions = step({
  id: "build_classified_sessions",
  label: "Build & classify sessions",
  description:
    "Materialize each close as a 'Screen Usage' row and classify its end reason (manual/auto lock, kept-awake, lock-screen-only, …) with a confidence.",
  inputs: {
    rows: appPolicyWiring.ports.rows,
    closes: walkStateMachine,
    keyguard: collectKeyguard,
  },
  run: ({ rows, closes, keyguard }, ctx) =>
    buildClassifiedScreenSessions(
      rows,
      closes,
      keyguard,
      ctx.options,
      ctx.support.appsForcingScreenOpenMap,
    ),
});

export const deviceStateTimelineWiring = wireUnitWhole<CanonicalRow[]>(
  "device_state_timeline",
  [collectKeyguard, walkStateMachine, buildClassifiedSessions],
  port(buildClassifiedSessions),
);

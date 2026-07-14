# Typed-Edge Ontology — the "factor graph but more complex"

The dependency graph has TWO levels. The distinction is the crux of the design: primitive
edges are declared and drive execution; causal roles are DERIVED from paths and drive the
analysis UI. Deriving (rather than drawing) the roles keeps them provably consistent with
the executable graph.

## Primitive edges (declared in `graphDef`, drive recompute)

| Type | From → To | Meaning | Recompute semantics |
|---|---|---|---|
| `feeds` | node → node | A's output is B's input (dataflow) | dirty(A) ⇒ dirty(B) |
| `gates` | knob → node | A decides whether B applies at all (on/off) | change(A) ⇒ dirty(B); when gated OFF, B becomes identity/pass-through and its subtree recomputes accordingly |
| `moderates` | knob → node | A parameterizes B's transform (magnitude/shape, not data) | change(A) ⇒ dirty(B) |

Examples: usageSessionReconstruction —feeds→ screenGatedUsageCredit;
`enableScreenGatedCrediting` —gates→ screenGatedUsageCredit;
`useFilterFile` —gates→ systemAppMarking;
`maxCreditedSessionMinutes` —moderates→ the long-session truncation;
`deviceLivenessGapToleranceMinutes` —moderates→ the device-liveness chain;
`minimumUsageDuration` —moderates→ usageSessionReconstruction.

Naming convention: node ids and knob names are verb-noun and self-describing. No internal
decision-record numbers, no engine jargon ("matcher") in user-facing ids.

## Derived causal roles (computed by `analysis.ts` over the primitive graph)

| Role | Derivation rule | Concrete example in this pipeline |
|---|---|---|
| `mediates` | Every path from knob A to output C passes through node B ⇒ "B mediates A→C" | Proximity affects total screen time ONLY through the reconstructed session set |
| `confounds` | Knob A reaches ≥2 distinct downstream nodes via disjoint paths ⇒ changing A co-moves both ("A confounds X and Y") | The app-filter list hits total time directly AND changes the no-witness day-app-count gate inside screen-gated crediting — two paths, correlated effects. Timezone confounds day-attribution and study-window membership |
| `collides` | Node B has ≥2 knob/node ancestors with no path between them ⇒ B is a collider; conditioning on B's output (e.g. selecting VALID participants) induces dependence between the ancestors | Compliance is a collider of attribution and usage volume: filtering to valid participants induces sharing-status ↔ usage correlation in the retained sample |

Notes:
- These are the pipeline-knob analogues of the mediation/moderation/confounding/collision
  vocabulary from causal inference (DAGitty-style), applied to the *processing graph*, not
  to subject-level variables. `moderates` is primitive here (a parameter edge) while the
  other three are path properties — that asymmetry is intentional.
- The panel interaction: select any knob or node → highlight the affected downstream cone →
  the analysis sidebar lists derived roles in plain language ("changing X moves both Y and Z
  — through separate paths; comparisons across them are not independent").
- Derived roles are recomputed whenever the graph definition changes (build time), not at
  runtime — the graph is static per app version; only dirty-state is dynamic.

## Node metadata (drives sections + UI)

Each node declares: `id`, `section` (preprocess|clean|analyze), `label`, `knobs` (bound
option keys), `inputs` (upstream node ids + support-file dependencies), `outputKind`
(frame | report | placeholder), `lockedByDefault` (preprocess = true).

Cache key per node = hash(ordered upstream output hashes, bound knob values, support-file
content hashes). Same-key ⇒ serve cached output; the graph panel shows cached vs recomputed
vs dirty per node after every run.

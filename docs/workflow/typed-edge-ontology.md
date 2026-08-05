# Typed-Edge Ontology — the dependency graph and its two levels

The dependency graph has TWO levels. Primitive edges are declared and drive execution;
path queries are DERIVED from the declared graph and drive the visual analysis UI.
Deriving (rather than drawing) the second level keeps it provably consistent with the
executable graph.

## Primitive edges (declared in `graphDef`, drive recompute)

| Type | From → To | Meaning | Recompute semantics |
|---|---|---|---|
| `feeds` | node → node | A's output is B's input (dataflow) | dirty(A) ⇒ dirty(B) |
| `gates` | knob → node | A decides whether B applies at all (on/off) | change(A) ⇒ dirty(B); when gated OFF, B becomes identity/pass-through and its subtree recomputes accordingly |
| `tunes` | knob → node | A parameterizes B's transform (magnitude/shape, not data) | change(A) ⇒ dirty(B) |

Examples: `reconstruct_episodes` —feeds→ `effective_usage`;
`enableScreenGatedCrediting` —gates→ `effective_usage`;
`useFilterFile` —gates→ `app_policy`;
`maxCreditedSessionMinutes` —tunes→ the long-interval truncation;
`deviceLivenessGapToleranceMinutes` —tunes→ `device_state_timeline`;
`minimumUsageDuration` —tunes→ `reconstruct_episodes`.

Naming convention: node ids and knob names are verb-noun and self-describing, grounded in
the community vocabulary in the [prior-art vocabulary](prior-art-vocabulary.md). No internal
decision-record numbers, no engine jargon
("matcher") in user-facing ids.

## Derived path queries (computed by `analysis.ts` — visual-first, NO taxonomy)

DECISION (owner, 2026-07-14): the derived layer carries **no named taxonomy**. The
causal-inference vocabulary (mediates/confounds/collides) was dropped — the second audit
showed those labels overclaim causal semantics for what are structural path facts (any
two-path knob would be a "confounder", any join a "collider", and the labels change if a
node is split in two). The audit's replacement graph-theory terms (dominates_path /
fans_out_to / merges_at) were ALSO rejected as unintuitive. Resolution: the derived layer
is a small set of path QUERIES, surfaced only as graph highlights plus plain-English
sentences.

| Engine query | Visual surface | Plain-English sentence template |
|---|---|---|
| `affectedBy(knobOrNode)` — downstream cone | click → cone lights up | "Changing this re-runs these N steps and changes these outputs." |
| `builtFrom(node)` — upstream cone | click output → reverse highlight | "This result is built from these inputs and settings." |
| `sharedUpstream(a, b)` — common ancestors | select two outputs → shared ancestors pulse | "Both of these depend on X — they move together; they are not independent checks." |
| `mustPassThrough(src, dst)` — nodes on every src→dst path | hover a knob with an output pinned | "Everything this setting does to that report goes through here." |
| `joinPoint(node)` — ≥2 disjoint upstream paths merge here | small badge on the node | "Two separate chains combine here — selecting/filtering on this output links them." |

Rules:
- The engine exports these as plainly named functions; the UI renders highlights and
  sentences. No role labels appear in the UI, the contract, or the exports.
- Queries are computed over the primitive graph at build time (the graph is static per app
  version); only dirty/clean state is dynamic.
- Sentences state only what the declared graph shows ("every declared path…"), never
  subject-level causal claims. They are granularity-honest by construction: splitting or
  merging nodes changes the highlights, and that is fine, because the highlights describe
  the pipeline, not the world.

## Node metadata (drives sections + UI)

Each node declares: `id`, `section` (preprocess|clean|analyze), `label`, `knobs` (bound
option keys), `inputs` (upstream node ids + support-file dependencies), `outputKind`
(frame | report | placeholder), `lockedByDefault` (preprocess = true).

Cache key per node = hash(ordered upstream output hashes, bound knob values, support-file
content hashes). Same-key ⇒ serve cached output; the graph panel shows cached vs recomputed
vs dirty per node after every run. Policy tables and semantic presets are versioned
independently of the app version, and their hashes are included in every report
(second-audit recommendation #6).

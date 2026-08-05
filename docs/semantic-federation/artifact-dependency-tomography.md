# Raw and support artifact dependency tomography

The configuration campaign holds artifacts constant and varies methods. This
campaign holds the complete processing configuration constant and changes
exactly one source artifact. Together they test both halves of the product's
incremental identity:

```text
method intervention     artifact intervention
        \                 /
         exact workflow checkpoints
                   |
     deterministic percolation cluster
                   |
        independent cold Rust oracle
```

The product-local name is **artifact dependency tomography**. Each controlled
intervention reveals where one source change enters the declared DAG, where
its semantic effect propagates, where it converges, and which output artifacts
change. The mechanism is reusable; the artifact roles, record fields, and
meaning of each checkpoint remain Chronicle-owned.

## Checked scope

The checked catalog contains 32 intervention kinds applied independently to
all six synthetic corpus profiles (192 source/target cases):

- all eleven supplied raw columns;
- raw row addition, removal, exact duplication, and reordering;
- one branch-activating substantive mutation for each of the eight support
  roles;
- byte-different CRLF controls for raw input and every support role.

A second checked boundary catalog applies 27 timestamp interventions to each
of all six synthetic corpus profiles (162 source/target cases):

- exact adjacent-event gaps at 0, 1, 2; 29, 30, 31; 59, 60, 61; 119, 120,
  121; 299, 300, 301; 3,599, 3,600, 3,601; and 43,199, 43,200, 43,201
  seconds; and
- explicit spring-forward, fall-back, day-end, and day-start calendar joints.

Each gap mutation chooses a row whose parsed instant truly changes, rather
than mistaking a byte-only fractional-second spelling change for a semantic
intervention.

Every intervention changes exactly one source artifact digest. Four executions
then establish its result:

1. cold source;
2. cold target;
3. source in a retained incremental workspace;
4. target in that same workspace.

The warm source and target must each equal their independent cold oracle at all
every workflow checkpoints and for every researcher-visible output artifact. The
changed input-key set must equal the predicted cluster derived from only:

- the raw seed (`parse_events`) or support-role owners declared by
  `chronicle.plan.json`; and
- upstream workflow checkpoints that actually changed.

This detects missing edges, stale cache reuse, and logical over-invalidation.
The fused kernel remains the independent cold correctness backstop. Warm
execution now uses the Salsa query engine, and regenerated evidence must record
the exact query bodies that executed for each artifact intervention.

Every supplied root artifact also passes the product-local qualification
solver. The runtime records one rule-by-rule trace proving candidate identity,
exactly one asserted role, registered role identity, accepted media type,
SHA-256 form, singleton cardinality, and the non-authoritative status of
informational qualifiers. File names never infer roles. Multiple role claims
or competing candidates for a singleton role are `ambiguous`; invalid media,
digests, identities, and roles are `rejected`. Neither state can execute.

For the synthetic all-support fixture, each intervention must change exactly
one qualification trace and one role-requirement trace: the role whose source
artifact changed. All rule outcomes remain accepted. This closes the
source-to-binding correspondence without conflating new source identity with a
new computational result.

A substantive intervention need not activate on every corpus. That distinction
is evidence, not a fixture failure: 117 cases have a semantic effect, three
forcing-app cases converge because the named package is not in an effective
screen-tail position, and all 72 representation/ignored-field controls
converge. Every substantive intervention kind still has at least one
branch-activating corpus witness. The ledger records active and converged
corpora per intervention so context-dependent support edges remain explicit.

## Typed checkpoint shape

`chronicle-workflow-checkpoint/v1` (current shipping version) replaces an opaque stage comparison
with six product-owned components:

| Component | Chronicle meaning |
|---|---|
| `rowMembershipDigest` | Source-row membership canonicalized by stable source identity |
| `rowOrderDigest` | Sequence-sensitive row positions and stable source identities |
| `temporalStateDigest` | Event/calendar/interval/duration/time-gap state |
| `classificationDigest` | Identity, app, attribution, flag, codebook, and category state |
| `payloadDigest` | Non-row products such as compliance/output bytes or bypass state |
| `schemaDigest` | Exact product checkpoint field partition and group/payload labels |

The six high-frequency component digests use `blake3:` so native and browser
WASM builds can use the algorithm's SIMD implementation. The terminal stage
digest remains `sha256:` and commits to the exact six labeled components;
exported artifacts and content-addressed storage also remain SHA-256. Every raw,
support, and configuration transition proves both directions: a changed
terminal has at least one changed component, and no component changes behind
an unchanged terminal. For example, a timestamp edit changes the temporal
component at `parse_events` without falsely changing membership or
classification; an output-only study label changes the output payload while
all upstream dimensions remain fixed.

The Rust partition is compiler-enforced. Every internal `Row` field is bound by
an exhaustive pattern and must feed exactly one row-identity, temporal, or
classification digest; adding a field breaks compilation until it is placed,
and binding a field without hashing it is a denied unused-variable error.

The boundary campaign caught a false explanatory dependency in the first
implementation: membership and classification were hashed in current row
order, so a timestamp that reordered rows falsely changed both components.
They are now associated and canonicalized by stable source identity; only the
order and temporal components change when time moves a row without changing
its membership or classification. A Rust unit mutant and all 162 browser-WASM
boundary cases enforce that separation.

## Bidirectional correspondence

Each run now exports `correspondence-index-json` using
`chronicle-correspondence-index/v4`. Its directed edge set can be traversed
forward or backward and binds:

- exact artifact digests to accepted role assignments and qualification traces;
- exact raw/support/configuration artifact identities to
  `source-coordinate-index-arrow`, whose stable coordinates bind a role,
  artifact digest, decoded record/field or JSON pointer, value digest, source
  media type, and explicit normalization boundary;
- qualification candidates to asserted/selected roles, rule evaluations,
  decisions, reasons, and the corresponding conditional role-requirement state;
- the canonical processing-options artifact to each resolved option value;
- option values and support roles to the plan nodes they tune, gate, or support;
- declared node-to-node feeds;
- typed checkpoints and execution artifacts to their workflow query groups; and
- terminal nodes to researcher-visible artifact digests; and
- the normalized result-cell index to each canonical CSV/JSON output and to
  its row-correspondence table; and
- a normalized `source-result-influence-arrow` witness joining qualified
  source scopes to workflow checkpoints, raw source rows to output rows, and
  unresolved source scopes to result families whose exact cell contributors
  are not yet known.

The source-coordinate index deliberately stops at the correct epistemic
boundary: indexing a value proves that the value existed in a qualified source,
not that it contributed to a particular output. The separate influence witness
adds only relationships for which the runtime has an explicit basis. It records
declared-transitive source-scope-to-checkpoint edges and conservative
raw-row-to-output-row lineage, while retaining unresolved result-family gaps.
It never promotes one unchanged perturbation to a non-influence proof and never
labels a raw field or support record as an exact cell contributor without a
dependency witness.

The existing `row-lineage-arrow` remains the large row correspondence table
from output rows back to one-based raw source rows. Precision is deliberately
honest: qualification, checkpoint, execution, and publication edges are exact;
plan dependencies are declared; raw row dependency sets remain conservative.
`result-cell-correspondence-arrow` now gives every canonical CSV cell and JSON
leaf an exact normalized address, exact value digest, terminal workflow query group,
and (for row-addressed CSV cells) an exact join key into `row-lineage-arrow`.
`source-result-influence-arrow` normalizes the bridge rather than materializing
the source-coordinate×result-cell Cartesian product: selectors join through a
role or selector prefix, source rows join through row keys, and result cells
join through output kind and output row. Absence of a bridge row is explicitly
not a non-influence claim. Raw-field contributors, support-record contributors,
and semantic cell dependencies beyond the declared transitive plan remain
unresolved. The intervention harness separately supplies empirical forward
correspondence—named changed component to exactly changed canonical output
cells—for its checked cases.

## Computation, correspondence, and representation

The proof deliberately keeps three identities separate:

| Identity | Question |
|---|---|
| Source identity | Did the exact input bytes change? |
| Semantic checkpoint identity | Did Chronicle's state at this logical joint change? |
| Correspondence/provenance identity | Is the same output still attributable to the same exact source object and record positions? |

The current fixture proves that supplied `possible_device_model`,
`start_timestamp`, and `stop_timestamp` values do not enter the active raw
parser's computational state. CRLF versus LF is also computationally
equivalent for every source role. These changes still produce a different raw
or support artifact identity, and raw changes can therefore change the Arrow
lineage artifact even when all workflow query-group checkpoints converge. That is not
a contradiction: computational equivalence must not erase which exact source
object was processed.

Conversely, all twenty interventions classified as substantive have at least
one branch-activating semantic witness. The support fixtures are selected from
the shipped catalogs and generated corpus so a catalog membership that never
matches an event label is not misrepresented as a tested filter effect.

## Evidence and commands

The digest-bound ledger is
`web/src/lib/pipelineGraph/golden/family-expected/artifact-influence-ledger.json`.
It records the exact implementation receipt, source digests, intervention
components, qualification/requirement correspondence, changed typed checkpoint
components, direct binders, changed semantic nodes, predicted and observed
input-key clusters, warm execution statuses, output effects, and a canonical
case-set digest.

The ledger also commits to the compressed
`artifact-output-cell-correspondence.json.gz` sidecar. For every intervention,
that sidecar maps the named changed raw/support component to every changed cell
address in the canonical Rust-produced CSV and JSON outputs. It contains
202,124 changed-cell addresses across the 192 cases. The ledger retains a
per-case address digest and a compact wildcarded column/path scope so it stays
human-reviewable. Parquet, SPSS, and Arrow remain byte/digest-verified derived
artifacts; they are not falsely decoded as independent semantic cell surfaces.

That receipt has two independent invalidation identities: the production
Rust/toolchain implementation digest and the product semantic-contract digest.
Both are included in every scheduler input key. Consequently, artifact evidence
cannot be replayed under changed code or a changed plan while appearing to be a
valid warm-cache result.

The generated `proofs/dependency-certificate.json` closes the remaining gap
between evidence and cache construction. It binds the exact raw/support/config
role owners and option binders used by these campaigns to the current plan and
all six empirical ledger digests. Narrow invalidation is available only when
that structural surface matches. A missing or unknown option, stale plan,
unknown protocol, or altered binding surface switches the scheduler to a
deterministic full-context key for every workflow query group; an unknown role is
rejected. Evidence currency is reported separately and enforced by the release
gate, allowing a changed implementation to run the cold/warm proof campaign
without first pretending its old empirical receipt is current.

The independent boundary ledger is
`web/src/lib/pipelineGraph/golden/family-expected/raw-boundary-influence-ledger.json`.
It records 648 Rust/WASM executions, 162 exact warm/cold comparisons, 162 exact
declared-versus-observed cluster comparisons, 162 typed-component comparisons,
162 artifact-to-role qualification correspondence comparisons, and 651,823
changed canonical output-cell addresses in the checked
`raw-boundary-output-cell-correspondence.json.gz` sidecar.

```sh
cd web

# Verify the checked ledger.
npm run test:artifact-influence
npm run test:raw-boundary-influence

# Intentionally regenerate after reviewing a source, plan, fixture, or
# implementation change.
UPDATE_ARTIFACT_INFLUENCE=1 npm run test:artifact-influence
UPDATE_RAW_BOUNDARY_INFLUENCE=1 npm run test:raw-boundary-influence

# Run configuration coverage and both tomography ledgers together.
cd .. && make combinatorial
```

The current intervention claim is exact only for the named deterministic
fixtures and interventions. It proves empirical changed-component-to-output-
cell correspondence, not yet a complete runtime backward explanation for every
unchanged cell. Exhaustive boundary discovery beyond the declared catalog also
remains an expansion rather than implied coverage. Interaction tomography and
semantic-model mutation testing are separate checked gates documented with the
configuration-space campaign.

## Next proof frontier: a context-conditioned influence atlas

The next model is not a larger unconditional DAG. Configuration, qualifications,
and data shape can change which bindings and dependencies are active, so the
actual object is a product-owned family of specialized DAGs indexed by context.
The compact representation should be a certified influence atlas whose records
bind:

- a Chronicle source-coordinate or change pattern;
- a Chronicle checkpoint component, output row, or result-cell pattern;
- the exact configuration/data/qualification region in which the claim holds;
- a dependence channel: value, membership, order, control, qualification, or
  schema/contract;
- a relation: observed effect, declared possible influence, empirically
  invariant over an explicit finite domain, or unresolved; and
- the cold/warm, mutation, coverage-domain, implementation, and contract
  evidence that justifies that relation.

Non-influence is not the bottom of an influence-strength scale. It is a
separate, bounded claim and is admitted only when its declared domain was
exhausted or a product-specific invariant independently proves it. One
convergent intervention never creates a non-influence edge.

At runtime the current assignments and options specialize the atlas. Narrow
reuse is allowed only when every cache-relevant path lies inside a current
certified region. A novel context, an unresolved critical path, stale evidence,
or a contradiction triggers conservative recomputation and emits a new coverage
hole for the intervention campaign. Cold execution remains the independent
oracle. A changed checkpoint outside the predicted cone is a soundness failure;
an unnecessarily recomputed checkpoint is a separately reported minimality
failure.

The reusable scaffold should standardize only this experiment-and-certificate
envelope. Chronicle continues to own its coordinate schemas, context predicates,
checkpoint components, comparators, generators, and meanings. Other products
can provide different adapters without adopting Chronicle's ontology or model
of computation.

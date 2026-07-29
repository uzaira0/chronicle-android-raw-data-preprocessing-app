# Chronicle research ontology — schema & generator toolchain

LinkML is the single source of truth for the Android event-log → usage-measurement
**research ontology**. Every artifact under `generated/` is produced from
`chronicle-research-ontology.linkml.yaml` — **never hand-edit generated files**.

This ontology is **descriptive scaffolding**: it declares provenance, absence
semantics, and the attribution contract *around* the existing algorithm. It never
changes what the pipeline computes — that invariant is locked separately by the
golden reproduction harness (`../src/lib/pipelineGraph/golden/`, and
`docs/pipeline-graph/13-research-ontology-design.md` §"North star").

## Layout

| Path | What |
|------|------|
| `chronicle-research-ontology.linkml.yaml` | SSOT — the D4 five-way entity model (occurrence / record / optional observation / assertion / execution / interval), enums, slots. Backbone: SOSA/SSN + OWL-Time + PROV-O + P-Plan, upper-neutral. |
| `axioms/contract.shacl.ttl` | Hand-authored SHACL invariants LinkML can't express (closed & conservative attribution, explicit endpoint absence, no-data needs an expectation, provenance completeness). |
| `tools/canonicalize_ttl.py` | Byte-determinism for OWL/SHACL (ported from sleep-scoring-ontology). |
| `generated/owl/…owl.ttl` | OWL (gen-owl), canonicalized. |
| `generated/shacl/…shacl.ttl` | SHACL from the schema (gen-shacl), canonicalized. |
| `generated/shacl/merged.shacl.ttl` | Generated SHACL **+** the hand-authored contract axioms — the shapes graph to validate against. |
| `generated/pydantic/…py` | Pydantic v2 models (gen-pydantic). |
| `generated/json-schema/…schema.json` | JSON Schema (gen-json-schema). |
| `generated/sql/…ddl.sql` | SQL DDL (gen-sqlddl). |

## Regenerating

Requires `uv` (the toolchain is pinned to `linkml==1.10.0` via `uvx`; no venv
needed) and `make`:

```bash
cd web/schema
make all            # regenerate every artifact + merge axioms
make repro-check    # assert OWL + SHACL + merged are byte-stable (must exit 0)
make validate       # assert every contract axiom actually fires (pyshacl; must exit 0)
make check          # repro-check + validate (full local verification)
make clean          # remove generated/
```

Individual targets: `make owl | shacl | pydantic | json-schema | sqlddl | merge-axioms`.
`make validate` runs `tests/validate_axioms.py`, which builds a canonical instance
per axiom via `linkml-convert` and checks pyshacl fires (bad) / conforms (good).

## Validating instances

```bash
# Conformance of an RDF instance graph against the full contract:
uvx --from pyshacl pyshacl -s generated/shacl/merged.shacl.ttl -sf turtle -df turtle instances.ttl
```

## Notes / follow-ups

- **Class identity is minted `chron:`; upper-ontology types are `broad_mappings`.**
  Every domain/provenance/structural class declares its upper-ontology type
  (`prov:Entity`, `time:ProperInterval`, `prov:Activity`, `sosa:*`, `pplan:*`) as a
  `broad_mappings` (→ `skos:broadMatch` in OWL), NOT as `class_uri`. This is
  load-bearing: with a shared `class_uri` LinkML types every instance
  `a prov:Entity`, which (a) makes the `axioms/` `sh:targetClass chron:X` shapes
  never match, and (b) makes `gen-shacl` collapse all those classes into one
  over-firing `prov:Entity` shape. Minting distinct `chron:` IRIs fixes both. The
  relation is `skos:broadMatch` (the upper type is *broader*), NOT `skos:exactMatch`:
  exactMatch is symmetric+transitive and would falsely entail that every
  `prov:Entity` subclass (e.g. `AttributionAssertion` ≡ `ParameterSet`) is
  equivalent. broadMatch also fits the module's upper-neutral, mappings-based
  federation stance (doc 13 D2/D3).
- **Identifier-bearing classes need a CURIE identifier value.** `PipelinePlan`,
  `StepDefinition`, and `ReconstructionStrategy` are keyed by an `identifier: true`
  slot (`plan_id` / `step_id` / `strategy_id`). LinkML mints the instance IRI from
  that value, so a **bare local id** (`plan_id: p1`) fails `linkml-convert` with
  `Unknown CURIE prefix: @base` — there is no base URI to resolve it against. Write
  the id as a CURIE in the module's default prefix (`plan_id: "chron:plan-1"`); it
  serializes to `chron:plan-1 a chron:PipelinePlan`. This matches the sibling
  research-standards ontology's fixtures (`device_id: "screen_device:dev-0001"`).
  `make validate` cases C4–C6 exercise exactly these three classes so the
  round-trip stays proven. Classes with no `identifier` slot (e.g. `ParameterSet`)
  serialize as blank nodes and need no id.
- **Enum conditions in `axioms/` match string literals**, not enum IRIs. LinkML
  serializes enum-valued slots as their permissible-value text (`xsd:string`), so
  `sh:hasValue "unresolved"` fires and `sh:hasValue <…#unresolved>` would not.
- All 5 contract axioms (A2–A6; A1 cardinality is delegated to the generated
  shape) are pyshacl-verified to fire on canonically-produced instances (bad →
  reports EVERY invariant's message, incl. both of the two-invariant provenance
  shape; good → conforms); a valid `ParameterSet` conforms with no spurious
  `participant_id` violation.
- **Scope of the contract:** these shapes validate the LinkML *canonical instance
  model* (`chron:`-typed instances, as `make validate` builds via `linkml-convert`).
  They do NOT govern the pipeline's runtime PROV-O sidecar
  (`web/src/lib/processingReport.ts`), which is self-contained JSON-LD typed with
  `prov:` IRIs — a separate emission this ontology describes but does not yet
  validate end-to-end.
- `gen-shacl` prints `Overlapping type and slot names: date` — harmless: the slot
  `date` (analysis date) and the built-in `date` type share a name; generation is
  unaffected.
- External-framework mappings (doc 13 D3) are asserted only from VERIFIED anchors:
  the `engagement` layer carries `skos:relatedMatch` to BCIO
  `participant engagement with behaviour change intervention`
  (`BCIO_013000`, verified via EBI OLS) — **relatedMatch, not closeMatch**, because
  BCIO engagement is intervention-scoped while chronicle engagement is device/app
  usage. The Shaleha et al. 2026 screen-use measurement framework is a conceptual
  framework with no class IRIs, so it is referenced via `rdfs:seeAlso` its DOI plus
  a `skos:note` (objective-log / passive-sensing modality axis), never class-mapped.
- BFO-vs-DOLCE upper grounding is deliberately deferred; federation would come via
  an SSSOM mapping set, not by re-grounding this module (doc 13 D2).

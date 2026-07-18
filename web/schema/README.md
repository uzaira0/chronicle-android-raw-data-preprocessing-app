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
make repro-check    # assert OWL + SHACL are byte-stable (must exit 0)
make clean          # remove generated/
```

Individual targets: `make owl | shacl | pydantic | json-schema | sqlddl | merge-axioms`.

## Validating instances

```bash
# Conformance of an RDF instance graph against the full contract:
uvx --from pyshacl pyshacl -s generated/shacl/merged.shacl.ttl -sf turtle -df turtle instances.ttl
```

## Notes / follow-ups

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

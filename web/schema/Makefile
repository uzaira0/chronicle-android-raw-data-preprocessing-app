# Chronicle research-ontology generator toolchain.
#
# Mirrors the sibling sleep-scoring-ontology pattern: LinkML is the SSOT, every
# downstream artifact (OWL / SHACL / Pydantic / JSON-Schema / SQL DDL) is
# GENERATED, never hand-edited. Pinned to linkml==1.10.0 via uvx so no project
# venv is needed and the toolchain is reproducible. OWL/SHACL are canonicalized
# (tools/canonicalize_ttl.py, ported from sleep-scoring) so `make` twice yields
# byte-identical .ttl.
#
# These artifacts are DESCRIPTIVE scaffolding — they never touch the algorithm
# outputs the workflow validation harness locks (docs/workflow/research-ontology-design.md).

.DELETE_ON_ERROR:
.PHONY: all owl shacl pydantic json-schema sqlddl merge-axioms repro-check methods-doc methods-doc-check validate validate-workflow emit-sidecar validate-sidecar check clean

LINKML := uvx --from linkml==1.10.0
# linkml (for linkml-convert) + pyshacl in one ephemeral env for the axiom test.
VALIDATE_ENV := uvx --from linkml==1.10.0 --with pyshacl
SCHEMA := chronicle-research-ontology.linkml.yaml
CONTRACT := chronicle-local-contract.linkml.yaml
GRAPH    := chronicle-workflow.yaml
GEN    := generated
AXIOMS := axioms

# Researcher-facing methods document, RENDERED from the LinkML ontology +
# contract + pipeline graph (tools/generate_methods_doc.py). Lives at the repo
# root docs/ (two levels up). Generated, never hand-edited — same discipline as
# the OWL/SHACL artifacts above.
METHODS_DOC := ../../docs/METHODS.md
METHODS_GEN := tools/generate_methods_doc.py

OWL_TTL   := $(GEN)/owl/chronicle-research-ontology.owl.ttl
SHACL_TTL := $(GEN)/shacl/chronicle-research-ontology.shacl.ttl
MERGED    := $(GEN)/shacl/merged.shacl.ttl
PYDANTIC  := $(GEN)/pydantic/chronicle_research_ontology.py
JSONSCHEMA:= $(GEN)/json-schema/chronicle-research-ontology.schema.json
DDL       := $(GEN)/sql/chronicle-research-ontology.ddl.sql
RUNTIME_CRATE := ../../rust/chronicle_preprocessing_runtime_wasm

all: owl shacl pydantic json-schema sqlddl merge-axioms methods-doc

owl: $(OWL_TTL)
$(OWL_TTL): $(SCHEMA) tools/canonicalize_ttl.py
	@mkdir -p $(dir $@)
	$(LINKML) gen-owl $(SCHEMA) > $@.tmp
	$(LINKML) python tools/canonicalize_ttl.py $@.tmp $@
	@rm -f $@.tmp

shacl: $(SHACL_TTL)
$(SHACL_TTL): $(SCHEMA) tools/canonicalize_ttl.py
	@mkdir -p $(dir $@)
	$(LINKML) gen-shacl $(SCHEMA) > $@.tmp
	$(LINKML) python tools/canonicalize_ttl.py $@.tmp $@
	@rm -f $@.tmp

pydantic: $(PYDANTIC)
$(PYDANTIC): $(SCHEMA)
	@mkdir -p $(dir $@)
	$(LINKML) gen-pydantic $(SCHEMA) > $@

json-schema: $(JSONSCHEMA)
$(JSONSCHEMA): $(SCHEMA)
	@mkdir -p $(dir $@)
	$(LINKML) gen-json-schema $(SCHEMA) > $@

sqlddl: $(DDL)
$(DDL): $(SCHEMA)
	@mkdir -p $(dir $@)
	$(LINKML) gen-sqlddl $(SCHEMA) > $@

# Merge generated SHACL with the hand-authored contract axioms into one shapes
# graph, then canonicalize so the merged artifact is byte-reproducible too.
# `merge-axioms` is a phony alias for the real file target $(MERGED) so it does
# not re-run when nothing changed (the output is a tracked git artifact).
merge-axioms: $(MERGED)
$(MERGED): $(SHACL_TTL) $(wildcard $(AXIOMS)/*.shacl.ttl) tools/canonicalize_ttl.py
	@mkdir -p $(dir $(MERGED))
	cat $(SHACL_TTL) > $(MERGED)
	@for f in $(AXIOMS)/*.shacl.ttl; do \
		[ -f "$$f" ] && printf '\n' >> $(MERGED) && cat "$$f" >> $(MERGED) || true; \
	done
	$(LINKML) python tools/canonicalize_ttl.py $(MERGED) $(MERGED)

# Byte-reproducibility guard: regenerate OWL + SHACL + the merged shapes graph
# into a temp tree and diff against the committed artifacts. `set -e` makes a
# generation/canonicalize failure abort immediately (instead of being masked by
# a later "file not found" diff); the EXIT trap cleans up. Must exit 0.
# NOTE: the merge is re-derived here INDEPENDENTLY (not by invoking the $(MERGED)
# recipe) on purpose — a byte-repro guard must not call the recipe it verifies, so
# any drift between the production merge and this one surfaces as a diff failure.
repro-check: all
	@mkdir -p tests/.artifacts
	@set -e; tmp=$$(mktemp -d tests/.artifacts/repro.XXXXXX); trap 'rm -rf $$tmp' EXIT; \
	$(LINKML) gen-owl $(SCHEMA) > $$tmp/o.tmp; $(LINKML) python tools/canonicalize_ttl.py $$tmp/o.tmp $$tmp/owl.ttl; \
	$(LINKML) gen-shacl $(SCHEMA) > $$tmp/s.tmp; $(LINKML) python tools/canonicalize_ttl.py $$tmp/s.tmp $$tmp/shacl.ttl; \
	cat $$tmp/shacl.ttl > $$tmp/merged.ttl; \
	for f in $(AXIOMS)/*.shacl.ttl; do \
		[ -f "$$f" ] && printf '\n' >> $$tmp/merged.ttl && cat "$$f" >> $$tmp/merged.ttl || true; \
	done; \
	$(LINKML) python tools/canonicalize_ttl.py $$tmp/merged.ttl $$tmp/merged.ttl; \
	diff -u $(OWL_TTL) $$tmp/owl.ttl; \
	diff -u $(SHACL_TTL) $$tmp/shacl.ttl; \
	diff -u $(MERGED) $$tmp/merged.ttl; \
	echo "repro-check OK: OWL + SHACL + merged are byte-stable"

# Methods document: render docs/METHODS.md from the three schema YAMLs. Uses the
# same pinned linkml env as the other recipes (it only needs PyYAML, which linkml
# brings in) so no project venv is required.
methods-doc: $(METHODS_DOC)
$(METHODS_DOC): $(SCHEMA) $(CONTRACT) $(GRAPH) $(METHODS_GEN)
	$(LINKML) python $(METHODS_GEN) $(METHODS_DOC)

# Byte-reproducibility guard for the methods doc: regenerate into a temp file and
# diff against the committed docs/METHODS.md. Mirrors repro-check — regenerated
# INDEPENDENTLY (not via the $(METHODS_DOC) recipe) so any drift surfaces as a
# diff failure. Must exit 0.
methods-doc-check: methods-doc
	@mkdir -p tests/.artifacts
	@set -e; tmp=$$(mktemp tests/.artifacts/methods.XXXXXX); trap 'rm -f $$tmp' EXIT; \
	$(LINKML) python $(METHODS_GEN) $$tmp; \
	diff -u $(METHODS_DOC) $$tmp; \
	echo "methods-doc-check OK: docs/METHODS.md is byte-stable"

# Contract test: prove every hand-authored axiom actually fires on canonically
# produced instances (bad → non-conformant + right message; good → conforms).
validate: $(MERGED)
	$(VALIDATE_ENV) python tests/validate_axioms.py

# Validate the generated YAML as an actual instance of the workflow classes
# authored in the local LinkML contract. The validator also requires a broken
# nested-operation fixture to fail, proving the gate has teeth.
validate-workflow: $(GRAPH) $(CONTRACT) tests/validate_workflow_projection.py
	$(VALIDATE_ENV) python tests/validate_workflow_projection.py

# Loop closure: call the production Rust provenance builder through a thin Rust
# fixture binary, then SHACL-validate those exact bytes against the same merged
# shapes graph used for canonical ontology instances. TypeScript is not an
# authority or fixture generator anywhere in this path.
SIDECAR := tests/.artifacts/chronicle-provenance.jsonld
emit-sidecar:
	@mkdir -p $(dir $(SIDECAR))
	cargo run --quiet --locked --manifest-path $(RUNTIME_CRATE)/Cargo.toml --bin export_workflow_provenance > $(SIDECAR)

validate-sidecar: $(MERGED) emit-sidecar
	$(VALIDATE_ENV) python tests/validate_sidecar.py $(SIDECAR)

# Full local verification: artifacts are byte-stable, the methods doc is
# byte-stable, both LinkML instances validate, the axioms constrain, and the
# Rust runtime sidecar conforms.
check: repro-check methods-doc-check validate validate-workflow validate-sidecar

clean:
	rm -rf $(GEN)

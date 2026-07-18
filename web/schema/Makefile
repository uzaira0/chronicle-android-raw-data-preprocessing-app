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
# outputs the golden harness locks (docs/pipeline-graph/13-research-ontology-design.md).

.DELETE_ON_ERROR:
.PHONY: all owl shacl pydantic json-schema sqlddl merge-axioms repro-check clean

LINKML := uvx --from linkml==1.10.0
SCHEMA := chronicle-research-ontology.linkml.yaml
GEN    := generated
AXIOMS := axioms

OWL_TTL   := $(GEN)/owl/chronicle-research-ontology.owl.ttl
SHACL_TTL := $(GEN)/shacl/chronicle-research-ontology.shacl.ttl
MERGED    := $(GEN)/shacl/merged.shacl.ttl
PYDANTIC  := $(GEN)/pydantic/chronicle_research_ontology.py
JSONSCHEMA:= $(GEN)/json-schema/chronicle-research-ontology.schema.json
DDL       := $(GEN)/sql/chronicle-research-ontology.ddl.sql

all: owl shacl pydantic json-schema sqlddl merge-axioms

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
merge-axioms: $(SHACL_TTL) $(wildcard $(AXIOMS)/*.shacl.ttl) tools/canonicalize_ttl.py
	@mkdir -p $(dir $(MERGED))
	cat $(SHACL_TTL) > $(MERGED)
	@for f in $(AXIOMS)/*.shacl.ttl; do \
		[ -f "$$f" ] && printf '\n' >> $(MERGED) && cat "$$f" >> $(MERGED) || true; \
	done
	$(LINKML) python tools/canonicalize_ttl.py $(MERGED) $(MERGED)

# Byte-reproducibility guard: regenerate OWL + SHACL into a temp tree and diff
# against the committed artifacts. `make repro-check` must exit 0.
repro-check: all
	@tmp=$$(mktemp -d); \
	$(LINKML) gen-owl $(SCHEMA) > $$tmp/o.tmp && $(LINKML) python tools/canonicalize_ttl.py $$tmp/o.tmp $$tmp/owl.ttl; \
	$(LINKML) gen-shacl $(SCHEMA) > $$tmp/s.tmp && $(LINKML) python tools/canonicalize_ttl.py $$tmp/s.tmp $$tmp/shacl.ttl; \
	diff -u $(OWL_TTL) $$tmp/owl.ttl && diff -u $(SHACL_TTL) $$tmp/shacl.ttl \
		&& echo "repro-check OK: OWL + SHACL are byte-stable" ; \
	rc=$$?; rm -rf $$tmp; exit $$rc

clean:
	rm -rf $(GEN)

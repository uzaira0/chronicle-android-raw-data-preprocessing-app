SEM_PROF_BIN ?= semprof
SEMANTIC_REGISTRY ?= vendor/semantic-profile-registry

.PHONY: semantic check architecture chronicle closure

semantic:
	$(SEM_PROF_BIN) generate --source semantic/profile-source.json --output semantic/semantic-profile.json
	$(SEM_PROF_BIN) resolve --manifest semantic/semantic-profile.json --registry $(SEMANTIC_REGISTRY) --output semantic/semantic-profile.lock
	$(SEM_PROF_BIN) verify --lock semantic/semantic-profile.lock
	$(SEM_PROF_BIN) verify-bindings --bindings semantic/capability-bindings.json
	$(SEM_PROF_BIN) conform --lock semantic/semantic-profile.lock --subject semantic/semantic-profile.json --output semantic/conformance-report.json

architecture:
	python3 scripts/check-architecture.py

chronicle:
	../scripts/generate_semantic_behavior_inventory.py --check
	python3 scripts/check-chronicle.py

closure: semantic
	$(SEM_PROF_BIN) closure --root semantic --output semantic/artifact-closure.json

check: semantic architecture chronicle closure
	python3 scripts/check-semantic.py

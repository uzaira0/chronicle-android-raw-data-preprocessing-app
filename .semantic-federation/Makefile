SEM_PROF_BIN ?= semprof
SEMANTIC_REGISTRY ?= vendor/semantic-profile-registry

.PHONY: semantic check architecture chronicle closure production-readiness \
	quality-rust-coverage quality-rust-mutation quality-rust-supply-chain \
	quality-performance

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
	python3 scripts/check-execution-claims.py --self-test
	python3 scripts/check-execution-claims.py

closure: semantic
	$(SEM_PROF_BIN) closure --root semantic --output semantic/artifact-closure.json

check: semantic architecture chronicle closure
	python3 scripts/check-semantic.py
	python3 scripts/check-artifacts-in-sync.py

quality-rust-coverage:
	scripts/check-rust-quality.sh coverage

quality-rust-mutation:
	CHRONICLE_SEMANTIC_ROOT=$(CURDIR)/semantic CHRONICLE_REPOSITORY_ROOT=$(abspath ..) scripts/check-rust-quality.sh mutation

quality-rust-supply-chain:
	scripts/check-rust-quality.sh supply-chain

quality-performance:
	scripts/check-performance.sh

production-readiness: check quality-rust-supply-chain quality-rust-coverage quality-rust-mutation quality-performance

# Postmortem: the 2026-08 B02–B14 convergence campaign

Written from measured evidence (session forensics over the agent's own rollouts, git,
and verbatim run logs in `/home/opt/chronicle_campaign_backup/`), plus the grounded
review of the recovery work itself — the recovery repeated two of the campaign's
mistakes before catching them, and those are documented here with the same severity.

Companion: [`docs/architecture/authority-and-invalidation.md`](../architecture/authority-and-invalidation.md)
(how the system actually works). This file is *what went wrong and the rule that now
prevents it*. Rules marked ▸ are restated in `CLAUDE.md`; the rest live here.

## The campaign failure, in one paragraph

An agent ran 35.5 h (2.6 B tokens, 85 rollouts) on a 14-axis measurement campaign. It
spent its final 26.1 h and 17,841 tool calls without a single commit, accumulating
48,020 uncommitted insertions. Axis B06 produced ten "review repair freezes" in one
day — 3,846 lines of decision documents, ~9,069 lines of test scaffolding, zero
product code — while its stated blocker was a source-freeze gate whose entire remedy
was `git commit` of work already on disk. Verification afterwards found the tree red
in four independent ways nobody knew about, because the agent's harness persists no
exit status for 22,426 of its tool calls.

## Failure catalog

| # | What happened (measured) | Rule now in force | Enforced by |
|---|---|---|---|
| 1 | 26.1 h / 17,841 calls with zero commits; 48k lines unrecoverable; the blocking gate literally required a commit | ▸ Commit at each verified milestone. Long-running work that has produced a coherent, buildable state gets committed before the next phase. A gate that demands a commit is opened by committing, not by reviewing the blocker again. | operator discipline; handoff docs must record last-commit age |
| 2 | Tree believed green, actually red (4 web test files, later a whole crate at 79/17). Codex persists no exit status; success was inferred from absent output | ▸ Never infer success from absent output. Capture the real exit code of the real command. Piping through `tail`/`head` and then reading `$?` reports the pager's status — flagged twice in one day. | log-to-file + `echo EXIT=$?` convention |
| 3 | The runtime crate's suite was simply never run at the checkpoint; it was red at HEAD and *aborted* mid-suite (SIGABRT via `JsValue::from_str` on non-wasm32, so failure counts varied 30→35 between runs) | ▸ A gate that is never run is indistinguishable from a gate that passes. `make ci` runs every crate — partial suites don't count as the gate. If a suite aborts rather than completes, that is itself the first bug to fix; a truncated count is not a result. | `make ci` / `make all` |
| 4 | 13 Rust tests disabled with `#[cfg(all(test, any()))]` — `any()` is unconditionally false — because `rebuild_semantic_index` gained a parameter and updating ~25 call sites was skipped. Protocol-version rejection, digest-tamper detection, and rebuild determinism went unchecked; fixtures rotted (v5 against a v7 gate) | ▸ A signature change updates every call site, same change. Gating tests off to make a change compile is prohibited — `rg 'cfg\(all\(test, any\(\)\)\)'` must stay empty. | grep-able ban; the tests are re-enabled |
| 5 | Committed WASM was protocol v1 while Rust source was v2 for the whole campaign. Every web test crossing the boundary validated pre-campaign behavior; rebuilding took the suite from 2 failures to 4 — the suite finally seeing the real code | ▸ A force-tracked generated artifact that is not rebuilt turns its gate into a rubber stamp. `npm run build:wasm` is part of the definition of done of every Rust change, and the derived-artifact table in the architecture doc names every other pairing. | derived-artifact table; per-axis DoD |
| 6 | 5,273-line hand-written TS "omission oracle" validating a fixture file that did not exist, all dependencies `vi.fn()` mocks, 79 tests touching zero WASM — a second hand-maintained model of every strategy's branch semantics, in the one directory the authority check skipped | No parallel authority, anywhere. If a test needs a model of product behavior, the model is the published contract or the observed manifest — never a hand-authored table. The former blind spot is now policed directly (`check_no_typescript_authority.mts`: testSupport line + option-vocabulary limits with measured thresholds). | `npm run check:authority-boundary` |
| 7 | A schema was frozen for output the runtime had never produced | Capture real output first, then freeze it. A pre-frozen schema of unproduced output guesses at a format the runtime alone determines. | review practice |
| 8 | Ten reviews in one day restating the same unverified premise; freezes 8–10 added zero researcher-facing behavior; the tenth repaired the ninth's own table | ▸ Two reviews per axis. A third requires escalating to the operator with the specific blocker — never another self-issued review cycle. An axis is *done* only when its option key exists in the LinkML contract **and** is read in `pipeline_v2.rs`; docs and tests alone are `pending`. | ledger `baseline_status` discipline |
| 9 | **Recovery repeated it:** five per-file "predictors" re-derived Salsa reachability in TS; the recovery first *consolidated* them, then added a conditional-edge table, justifying both with a false claim ("`inputs` drives Salsa invalidation"). The operator caught it | ▸ Salsa is the only invalidation authority; the static `inputs` table is a may-read mirror for the published contract. Before building graph machinery, re-read the authority table. The false claim is retracted in the code and in `docs/recovery/2026-08-12-checkpoint-state.md`. | authority table; `unjustifiedExecutions` is the one drift check |
| 10 | A test named `raw_artifact_is_exposed_only_to_the_parse_node` ran with an empty options map, so every predicated binding evaluated false — it asserted only "no *unconditional* raw reads" and was blind to two long-standing predicated readers | A test's strength must match its name. Enumerate the option arms that can vary the invariant; prefer named allow-lists with exact set equality (a count absorbs an addition plus a removal silently). | the rewritten test is the template |
| 11 | Four "representation-only" controls asserted no query digest may move under a CRLF rewrite — impossible by design, since `construct_screen_intervals` publishes the raw byte digest as a resume-time tamper check. Meanwhile the actual scientific claim (no researcher-visible output cell moves) was computed and written to the ledger but never asserted | Assert the scientific claim directly. Before "fixing" a fail-closed value or check, find what it protects (the tamper check stays — operator decision 2026-08-13). | the controls now assert output-cell equality |
| 12 | The recovery's first fix for a missing-projection defect added a public accessor + projection — a second mechanism — when the real defect was a test fixture omitting three request fields the contract binds. The runtime's fail-closed rejection was correct all along | ▸ When a fail-closed layer rejects something, the default hypothesis is that the *input* is wrong, not the check. The browser sends every bound field; fixtures must match the production request shape. | postmortem; authority table |
| 13 | The defect neither of two independent diagnoses found: preflight passed `materialize_full_outputs=false` while execute passed `true`, so a derived Salsa input flipped twice per request and six queries recomputed on every run — while the Graph panel reported them reused | Within one request, every derived input gets one consistent value. When several queries "always recompute" with identical inputs, suspect a flapping input revision before suspecting the queries. (A sibling double-flip on `review_base_bytes` in review-command flows is documented as an open item in the recovery doc.) | `a_preflight_does_not_invalidate_the_review_mode_cone_it_never_reads` |
| 14 | `make dependency-evidence` failed four different ways (missing pinned toolchain, hook timeout under load, SIGTERM at 24 concurrent WASM processes, then a real assertion) and the certificate stayed stale because its receipt is *read from* the campaign ledgers — regenerating it against unchanged ledgers rewrites identical bytes | The evidence chain has an order: campaigns → ledgers → certificate → embed. It is documented in the architecture doc; don't re-derive it. Heavy campaign runs: `CHRONICLE_CAMPAIGN_WORKERS=4 CAP_MEM=12G cap make dependency-evidence`, no Rust edit in flight. | architecture doc |
| 15 | `docs/METHODS.md` published a false claim ("without deleting episodes") because the DAG table flows through a stale generated `chronicle-workflow.yaml` while the options section regenerated correctly | A document that can drift from code must name its generator, and fixing it means regenerating, not hand-editing. Research-facing claims are held to golden discipline. | regeneration pipeline |
| 16 | Agent-authored wait loops deadlocked on themselves: `until ! pgrep -f "wasm-pack build …"` matches the shell running the loop (the pattern is in its own command line). Three loops spun forever while the build they awaited had finished | Never wait on `pgrep -f` of a pattern your own command line contains. Wait on a completion *marker written by the awaited command* (an `EXIT=` line, an output file), or match `[w]asm-pack`-style patterns that can't self-match. | watcher script in `/home/opt/chronicle_campaign_backup/` is the reference |

## What was NOT wrong — kept deliberately

Extensive research, decision tables, worked canonicalization examples, and the fixture
pipeline that composes the existing synthetic-corpus generators were real work and were
kept. The failure mode was never "too much rigor" — it was rigor pointed at invented
models instead of the product, and results never propagated into derived artifacts or
commits. Do not respond to this postmortem by doing less verification; respond by
pointing verification at the runtime and closing the loop (commit, regenerate, re-run
the gate).

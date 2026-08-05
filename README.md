# Chronicle Android Raw Data Preprocessing App

An application for preprocessing and plotting Chronicle Android raw data.

The browser application is the first full implementation target for the
generalized semantic-federation scaffold. Browser computation is Rust/WASM. A
count-neutral workflow contract separates researcher-facing phases, scientific
operations, typed artifacts, physical Salsa queries, checkpoint policy, and run
evidence. The registered queries match the complete Rust oracle in every usage
mode; an unchanged call reuses all applicable computation.

The runtime reports actual query execution events. Query groups are internal
reporting projections, not scientific operations and not another scheduler.
Persisted Salsa snapshots were removed after profiling showed that restoring
one was slower and much larger than recalculating from the verified inputs.
OPFS keeps the source, configuration, results, history, evidence, and views;
the in-worker Salsa database is only a fast disposable cache.

See the
[query-registry incremental Rust plan](docs/semantic-federation/incremental-runtime-plan.md)
for the current/target distinction, exact implementation backlog, and release
checks. The separate
[production proof](docs/semantic-federation/production-proof.md) records what
the existing semantic, storage, provenance, and browser boundaries already
prove.

The executable variability proof uses a contract-derived Rust/WASM campaign
over all 46 computational options,
separate proofs for the eight annotation/view/execution axes, catalog-derived
synthetic corpora, explicit binding/qualification holes, and
incremental-versus-cold replay. The existing checked controlled-intervention ledger holds
all other inputs constant across every ordered value transition, records the
exact observed invalidation/state/output effects, compares every workflow query-group
checkpoint with an independent cold Rust target, and requires a concrete
activating case for every computational axis. The model preserves enum, numeric, list,
and string equivalence domains; it does not reduce non-boolean settings to
flags. Declared logical propagation is exact for the recorded test scope. Those
ledgers have been regenerated on the physical Salsa engine (see the campaign
status table in `docs/semantic-federation/incremental-runtime-plan.md`);
regenerate them again after any change to the tracked query set.

The companion
[artifact dependency tomography](docs/semantic-federation/artifact-dependency-tomography.md)
holds configuration constant while changing every raw column, raw row shape,
and support-artifact role one at a time across all six synthetic corpora. Its
checked 192-case ledger compares all warm checkpoints and outputs with cold
Rust targets, records context-dependent convergence, and separates
computational equivalence from exact source/correspondence identity. A second
162-case boundary ledger probes 21 adjacent timestamp gaps and six calendar/DST
joints across those same corpora. Compressed digest-bound sidecars retain the
853,947 exact canonical CSV/JSON cell addresses changed by those controlled
interventions. A model-mutation gate also deletes or reverses every declared
DAG edge and deletes every recorded option and input-role binding; all 116
mutants must be killed by an attributed empirical or structural test case.

Not affiliated with GetMethodic/Chronicle, please visit them here: https://getmethodic.com/

Credits:
- GetMethodic/Chronicle for their app, website, and providing their original preprocessing code: https://github.com/methodic-labs/chronicle-processing
- Anil Kumar Vadathya, MS for writing our original custom preprocessing code (https://github.com/anilrgukt)
- Heidi Weeks, PhD (https://radesky.lab.medicine.umich.edu/home) for writing the original plotting code in R and providing apps for the app codebook
- Josh Culverhouse, PhD (https://sc.edu/study/colleges_schools/public_health/research/research_centers/acoi/) for modifying and helping to convert the plotting code to Python, providing apps for the app codebook, and helping to test the code significantly
- Lindon Camaj, MS (https://github.com/lindoncamaj) for providing the app scraping code used to obtain app store categories and other info for apps

## Preprocessing Features
- Labeling usage differently for filtered apps defined in a file
- Custom definition of the minimum duration in seconds required to include an instance of app usage
- Custom app engagement duration estimation
- Custom hour thresholds for flagging potentially erroneous instances of long-running app usage or data gaps
- Custom timezone removal/conversion
- Custom configuration of which interaction types to stop usage at
- Custom configuration of which interaction types to remove from the final preprocessed output
- Various columns to help with sorting and filtering the final preprocessed output
- App categorization columns

## Plotting Features
- Including or excluding filtered app usage defined in the preprocessing
- Custom loading of app codebooks to color apps in plots based on their categories
- Marking device shutdown and device startup events
- Marking data time gaps (WIP)

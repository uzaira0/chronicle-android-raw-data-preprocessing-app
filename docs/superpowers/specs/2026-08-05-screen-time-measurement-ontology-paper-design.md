# Design — screen-time measurement ontology paper

**Status: WORKING DRAFT, not final.** Written 2026-08-05, mid-research. Several load-bearing
numbers do not exist yet and are marked `HOLE`. Do not treat any claim here as settled unless it
cites a verified source in `docs/paper/literature-dossier.md`.

Evidence base: `docs/paper/literature-dossier.md` (1,154 lines),
`docs/paper/citation-chase/lane-{1..5}.md` (all five lanes reported),
`docs/paper/winklbauer-batinic-references.md` (the 51-entry seed set).

---

## 1. What this paper is

An **ontology / measurement-theory paper**, not a tool paper and not a software paper. The
artifact exists and works, but the contribution is conceptual.

**The claim, in two sentences:** every published screen-time reconstruction rule is a special case
of one structure, and this is the structure. Because the structure names the components a rule must
settle, it doubles as a **test you run on a paper** — most papers specify no component, or a
fragment of one, and therefore cannot be classified at all, which means their reported numbers do
not identify a determinate quantity.

The first half is a sublation, not a critique. The published methods are not rivals to be adjudicated or
threats to be cleared — they are instances, and each one that the structure expresses is evidence
for it. The paper is falsified by a published rule the structure cannot express, which is the only
attack worth defending against. The demonstration that the choice between bindings changes the
resulting numbers (§C2) is what makes the structure non-trivial rather than a taxonomy.

**The four methods, and where each currently lives in the code:**

| Method | Binding id | Actual state in the tree, verified 2026-08-05 (updated after the seam landed) |
|---|---|---|
| Chronicle fused matcher | `fused_matcher` | Registered and selectable; the default. Output byte-identical to before the option existed. |
| Parry & Toth forward pairing | `parry_toth_forward_pairing` | Implemented in `chronicle_app_usage_matcher` (Steps 6–7, 9 tests) and bound to the seam. |
| EYES complement segmentation | `eyes_complement` | Implemented and bound to the seam; takes the masked rows as well as the matcher index, because it segments the device-state timeline. |
| Culverhouse trim-and-log | **not a binding yet** | Downstream interval-quality policy only — see §5.8. Needs promoting to a named binding for the four-arm comparison to be honest. |

All three implemented bindings are separation-tested: on one fixture they produce three different
episode sets. Committed 2026-08-05 as `1d720eb`; `make all` green.

**Correction to an earlier claim.** Both this spec's first draft and
`docs/workflow/device-state-machine.md` stated that the strategies were implemented as an
`EpisodeReconstructionStrategy` enum in `pipeline_v2.rs` and exposed as an
`episode_reconstruction_strategy` option key. **Neither identifier has ever existed in this
repository** — `git log --all -S` over all history finds no Rust file containing either, and
`chronicle-local-contract.linkml.yaml` carries no such option key. Corrected in both documents.

This changes what C2 is blocked on: not "wire up EYES" but "build the seam and implement Parry &
Toth." Culverhouse is the odd one out on purpose — it is a *quality* rule over already-reconstructed
intervals, not a reconstruction rule, but it still has to be a named arm for a four-way comparison
to be honest.

Culverhouse is the odd one out on purpose: it is a *quality* rule over already-reconstructed
intervals, not a reconstruction rule. It still has to be declarable as a named arm for the
four-way comparison to be honest, which is why §5.7 exists.

**Locked scope decisions** (from the requirements pass, do not relitigate without cause):

| Decision | Value |
|---|---|
| Paper type | Ontology / measurement theory |
| Argument shape | **Sublation-led** — one ontology, four methods absorbed as bindings inside it |
| Platforms | Android primary; iOS as a full second case, not a conceptual aside |
| Evidence | Android multiverse **+** iOS quality numbers |
| Data | Synthetic fixture for the reproducible artifact; real study data for the headline |
| Disaggregation target | Per-app **and** daily totals, both with hourly bars |
| Reliability metric | Downstream-statistic preservation, ICC-family reported as secondary |

---

## 2. The argument in one paragraph

Screen-time measures are not read off a device; they are *reconstructed* from punctual event
records that underdetermine them. Many reconstruction rules have been published — in papers, in
platform source, and in shipped code — and they disagree. **Every one of them is a special case of
a single structure, and this paper gives that structure.** We state the ontology, express each
published rule as a binding within it, implement those bindings against one engine, and show what
changes when the binding changes. The rules are not rivals to be adjudicated; they are instances,
and the structure is what they are instances of. Naming the structure's components then makes it a
classification test: applied to the literature, it shows that most published screen-time numbers
leave enough components unspecified that they do not identify a determinate quantity, and so cannot
be reproduced, compared, or pooled.

---

## 3. Claims, and the evidence status of each

### C1. Every published reconstruction rule is a special case of one structure
**Status: EVIDENCE IN HAND for the enumeration; the structure is implemented.** This is the
paper's central claim, and it is a claim about *coverage*, not about anyone's failings. It is
falsified by producing a published rule the structure cannot express — which is a far harder
attack than finding a counter-example to "nobody declares."

**The rule families to be covered.** The six-slice sweep recovered six recurrent families across
papers, platform source, and shipped code:

| Family | Instances |
|---|---|
| Forward to the next retained event | Parry & Toth 2025; Schoedel et al. 2026; Usage Logger |
| Matched lifecycle state machine | ActivityWatch; DetoxDroid; Olauncher; usageDirect |
| Device-state boundaries | Andrews; Hintze; Jones; Zhu; Karas; Terzimehić |
| Vendor / pre-formed intervals | Wakoopa; Stachl; BEHAPP; Ethica; Apple Screen Time |
| Inactivity-gap grouping | Böhmer 30 s; Van Canneyt 10 s; Mon Majhi 45 s; Peng & Zhu per-user median; DetoxDroid 5 min |
| Hybrid contextual boundaries | Hsu et al. (screenshot stability + accessibility inactivity); Hintze (calls/keyguard/shutdown) |

Each family is a setting of the same small number of structural choices: which event types open
an episode, which close it, what closes an episode when no closing event arrives, how collisions
between overlapping opens resolve, where the observation window censors, and what caps apply.
Naming those choices *is* the ontology; the families are what you get by varying them.

**These are material, not competition.** Each is an instance the structure has to express, and each
one that fits strengthens the coverage claim.

**But keep the sources separated, because the separation is itself a finding.** The rules recovered
above do not come from one population:

| Source population | Who | What they specify |
|---|---|---|
| Peer-reviewed studies that publish screen-time numbers | most of the census | usually nothing, or one fragment |
| Methodological primers | Parry & Toth 2025; Schoedel et al. 2026 | a reconstruction rule, no failure policy for most cases |
| Independent implementers | usageDirect (2021); ActivityWatch; Olauncher; DetoxDroid; Usage Logger | the most complete specifications in existence, including the unmatched-event taxonomy |
| Platform source | AOSP `UsageStats.update()`; the `UsageEvents.Event` reference | the vendor's own algorithm and its stated instruction for unmatched events |

**The 2021 usageDirect wiki is not the field.** It is one independent developer who enumerated
every unmatched-event case — duplicate open, duplicate close, shutdown, startup, cross-boundary
open, emptied log, timezone switch — and stated the chosen handling for each, five years before any
peer-reviewed paper did. Cite it as exactly that: evidence that the specification work was cheap,
public, and available the whole time, done by someone outside the literature who had no incentive
beyond wanting the number to be right. Do not launder it into "the field declares." Nothing about
it mitigates the census; it sharpens it.

#### C1a. The structure is a classification test, and most papers fail it
**Status: EVIDENCE IN HAND; the scoring instrument needs writing.** This is the second half of the
contribution and the part with immediate practical use.

Once the structure names its components — which event types open an episode, which close it, what
happens when no closing event arrives, how overlapping opens resolve, where the observation window
censors, what caps apply, and with what provenance each parameter was set — it becomes an
instrument you can run **on a paper**. For each component, that paper either **specifies** it,
**partially specifies** it, **delegates** it (to a vendor, a library, or a citation), or **is
silent**.

**The component list — this table is itself the complexity argument.** Every row is a decision that
must be settled before a duration exists. None is optional: a pipeline that does not settle a row
explicitly settles it by accident. Draft, to be pinned before anything is scored:

| # | Component | The decision | Observed settings |
|---|---|---|---|
| 1 | Event-type selection | Which of the 32 AOSP types are read at all | P&T keep {1,15,16,17,18,26,27}; the matcher also reads 2 and 23 |
| 2 | Opener set | Which types open an episode | `ACTIVITY_RESUMED`; `MOVE_TO_FOREGROUND`; screen-on; keyguard-hidden |
| 3 | Closer set | Which types close one | `ACTIVITY_PAUSED`; `ACTIVITY_STOPPED`; next opener; screen-off; none |
| 4 | Pairing discipline | How openers bind to closers | matched-lifecycle / forward-to-next / inactivity-gap / vendor-preformed |
| 5 | Unmatched open | No closing event ever arrives | drop / censor at window edge / synthesize a close / cap / carry forward |
| 6 | Unmatched close | Close with no preceding open | drop / count from window start / look back N hours |
| 7 | Duplicate opens | Two opens, same package, no close between | drop first / drop second / treat as one |
| 8 | Duplicate closes | Two closes for one open | drop second / reuse / error |
| 9 | Same-package runs | Consecutive openers for one package | collapse (P&T Step 6) / keep as separate episodes |
| 10 | Collision policy | Overlapping episodes across packages | forbid / split / model concurrent / last-wins |
| 11 | Device-state coupling | Does screen-off end an app episode? | yes (Schoedel) / no (the matcher today) / only via crediting |
| 12 | Shutdown / startup | Open events spanning a reboot | AOSP: close at shutdown, **drop** at startup; others silent |
| 13 | Window censoring | Episodes crossing the query or day boundary | truncate / drop / carry / duplicate across days |
| 14 | Day and timezone assignment | Where a day boundary falls | device tz / study tz / UTC (Karas) / modal tz (Culverhouse); DST handling |
| 15 | Maximum duration | Cap, and the action on exceed | none / drop / truncate-to-cap / flag-and-retain / zero the row |
| 16 | Minimum duration | Floor below which an episode is discarded | 0 / 60 s / event-defined |
| 17 | Inactivity gap | Gap threshold, where the rule uses one | 10 s / 30 s / 45 s / per-user median / **none, event-defined** |
| 18 | Package policy | Launchers, system apps, keyboards | keep (P&T) / blacklist / per-package cap (Culverhouse) |
| 19 | Background attribution | Whether background events count | included / excluded / separately modelled |
| 20 | Data-gap policy | Logging gaps and device silence | ignore / flag the day / break the liveness chain / impute |
| 21 | Parameter provenance | For each numeric above, where the value came from | inherited / cited / data-derived / engineering constant / unstated |

Twenty-one components. A rule is a setting of all of them. That is the complexity claim, and it is
made by exhibiting the list, not by asserting that the problem is hard.

That yields a per-paper classification vector, and three outcomes:

| Outcome | Meaning |
|---|---|
| **Classifiable** | Every component resolved. The measure has a definition; it can be reproduced and compared with another classifiable study. |
| **Partially classifiable** | Some components resolved, others silent. The measure is defined only up to the missing components, and the comparison is valid only across studies that match on what *is* specified. |
| **Unclassifiable** | Too few components resolved to determine what was measured. The reported number does not identify a quantity. |

**This is the deliverable a reader can use tomorrow.** Not "the field should do better" — an actual
test. Hand it a paper, get back which components it pinned and which it left open, and therefore
whether its number can be compared with anyone else's or pooled into a meta-analysis. A number
whose construction is unclassifiable is not a weaker measurement of screen time; it is not a
measurement of a determinate quantity at all, and meta-analyses that pool it are pooling
differently-defined variables.

**How the two halves of the paper meet.** The component list bounds the multiverse: C2 does not
vary parameters arbitrarily, it varies *these rows*, and each arm is a published rule's setting of
them. So "how complicated it is" (the list) and "how much it moves the result" (the divergence)
are the same object seen twice — the second measures the cost of the first going unstated.

Run the instrument over the census and report the distribution. On the app-level subset the
expected result is that a large majority are unclassifiable or barely partial — 2 of 16 specify a
reconstruction rule at all, and specifying the rule is only one of the components. Report the
per-component fill rate, not just an overall verdict, because the pattern of *which* components go
unspecified is the map of where the structure was most needed.

**Frame it as diagnosis, not indictment.** The claim is not that authors were careless; it is that
without a vocabulary there was nothing to fill in, so a paper could pass review while leaving its
central quantity undetermined. The test also cuts the other way and must be reported when it does:
where a study is fully classifiable, say so, and say what it can therefore be compared with.

#### C1c. Where the rule had to be recovered from
**Status: EVIDENCE IN HAND — all 5 lanes reported (lane 5 landed 2026-08-05).** Census over
Winklbauer & Batinic's own 51-entry reference list — a set we did not choose, which matters for
the base-rate claim.

This is the supporting sub-claim, and its job is to explain why the structure had to be *recovered*
rather than read off. Rules exist; they are stated in incompatible places at incompatible levels of
detail. The taxonomy is of **recovery source** — declared in prose, recoverable only from code,
inherited by citation, or sealed inside a vendor — not of researcher virtue.

**Reconciled 2026-08-05** under one uniform rule — see `docs/paper/citation-chase/census-reconciliation.md`.
The lanes' own tallies are not comparable (different strictness, different ladder rungs) and must
not be pooled.

Coverage: **35 of 51 read in full, 16 abstract/metadata only.** State this before any ratio.

**The headline numbers:**

| | |
|---|---|
| Hold an app-level event stream (Rung 3/4) | **16** |
| …of which declare an app-level reconstruction rule | **2** — Parry & Toth (a primer, no data) and Toth & Trifonova (the only empirical study) |
| Hold only a screen on/off pair | **7** |
| …of which declare the device-level rule | **5** |
| Sensitivity analysis over a threshold, in all 51 | **1** (Siebers et al.) |

**The split *is* the point, so never collapse it into one "N of 51".** Where reconstruction is one
unambiguous pair, the rule is stated. Where it requires a choice — which of the 32 AOSP event types
open and close an episode, what to do when the closing event never arrives — the statement stops.
Prose declaration tracks the *number of structural choices*, and fails exactly where the structure
has degrees of freedom. That is C3 restated as a base rate, and it is the reason a vocabulary is
needed rather than a norm.

**Two sentences that are false and cheap to disprove — do not write either.** "Nobody declares a
reconstruction rule": Parry & Toth, Toth & Trifonova, Geyer/Usage Logger, Hintze, Ahmed, Karas and
Schoedel do. "Nobody enumerated the unmatched-event cases": usageDirect did, in 2021.

The true statement is stronger and survives a reviewer: **the specifications that exist are mutually
incompatible, live in incomparable formats, sit mostly outside the peer-reviewed literature, and
have never been expressed in a common structure — so no two studies can be compared, and most
cannot be classified at all.**

The 14 non-declaring app-level papers fail in four distinct ways (refuses to state / vendor /
named library by URL / absent). Report the taxonomy, not just the count.

Best exhibits:
- **Beierle et al. (2020)** — the only rung-4 study in the first twenty: *"We implemented a
  heuristic for estimating actual usage sessions… Based on 40,140,665 app events, our heuristic
  yielded 1,826,060 usage sessions."* 22:1 compression on the word "heuristic." No parameters, no
  code.
- **Langener et al. (2024)** — the field's most explicit treatment of temporal researcher degrees
  of freedom, conceding its GPS staypoint window is *"relatively arbitrary"* and *"could also be
  part of a multiverse analysis,"* then excluding it. For app usage the equivalent window is not
  even acknowledged.
- **Lee, Park & Lee (2022)**, ACM Computing Surveys — reviews 109 studies, classifies them by
  *what data were collected*, never asks how any turned `UsageEvents` into episodes, and offers
  terminological standardisation "to improve reproducibility."
- **Three published counts of one CSV**: Schoedel's own Table 2 says 1231; Parry & Toth say 1,232;
  Winklbauer & Batinic say 1,197.
- **Stachl et al. (2020), PNAS** — says it out loud: *"Raw data files cannot be provided… full
  reproducibility is possible for the analyses but not for preprocessing and variable
  extraction."* The paper then reports app usage as its second most important predictor class for
  personality. The field's flagship smartphone-personality result concedes that the event→episode
  layer beneath its features cannot be rerun by anyone.
- **Wenz et al. (2024)** — the reconstruction escapes into a vendor. *"the duration of any
  instance of use"* arrives pre-computed from the Wakoopa SDK. N = 1204, 55 days, headline
  112.1 min/day whose definition exists only inside commercial software. The authors caveat
  app→activity classification carefully and never ask how a duration was formed.
- **Toth & Trifonova (2021) is the counter-example that proves the point.** The only empirical
  paper in the set that names its event types, states which open and close a session, *and* admits
  the rule failed — 12 h and 9 h phantom sessions, *"interruptions of app uses through screen locks
  and shutdowns were probably not always captured properly"* — then patches it with a borrowed 5 h
  cutoff. Full declaration did not remove the problem; it made it visible. Every other app-level
  paper had the same failure mode available and none mentions it.

### C1b. Thresholds are parameters of the structure, and their provenance is a typed property
**Status: EVIDENCE IN HAND (lane 5).** A threshold is not a fact about phones; it is an argument to
a binding. The ontology therefore carries it as a parameter *with its provenance*, and the observed
provenance values fall into five kinds:

| Provenance kind | Examples |
|---|---|
| Inherited by citation | 15 s phone-check; the 5 h plausibility cutoff |
| Cited precedent | Mon Majhi's 45 s |
| Derived from the data | Peng & Zhu's per-user median inter-app interval |
| Engineering constant | Usage Logger 2 h cap; ActivityWatch 1 s / 4 h bounds; Olauncher 24 h repair lookback |
| Event-defined (no numeric threshold) | Parry & Toth's core rule; screen/keyguard state machines |

That last row matters most: a rule with **no** numeric threshold is not a rule with a hidden one.
The structure has to express "this binding takes no gap parameter" as a first-class state, or it
will quietly invent a default and misrepresent half the literature.

Within the census, the dominant kind is inheritance by citation:

| Value | Kind | Where it came from |
|---|---|---|
| 15 s | "check" length classifier | Wilcockson et al. (2018) cites Andrews et al. (2015). No further justification anywhere in the paper. |
| 15 s | "phone-checking" | Tkaczyk et al. (2024) cites *Andrews 2015 and Wilcockson 2018* — the row above, which cites Andrews. |
| 5 h | max session cutoff | Toth & Trifonova: adopted because *"Andrews et al. (2015) considered very long use"* — after their event rule demonstrably failed. |
| 30 s | inactivity gap | Böhmer et al. (2011), reported by Zhu only to reject it. |
| 10 s | inactivity gap | Van Canneyt et al. (2017) — **attested second-hand only.** |

**Within these 51, one paper reports a sensitivity analysis over its threshold and none derives a
value from its own data.** Scope that count to the census — outside it, Karas et al. (2024) vary a
cap and report the effect in minutes per day, Siebers et al. vary 0/10/30/60/90 s, and van Berkel
et al. compare gap thresholds empirically. The paper that interrogates the practice hardest,
Zhu et al. (2018), does so to abandon thresholds entirely: *"The threshold is arbitrarily chosen."*
Eight years on, the field still cites Zhu's dichotomy and still does not say which side of it any
given paper is on — which is a statement about the absence of a vocabulary, not about diligence.

Sharpest exhibit, and worth a sentence of its own: **the 10 s figure is nominally gold open
access under CC-BY, and no automated client can read it.** ACM DL returns 403 to every non-browser
client; no OA mirror exists. The field knows that number only through a secondary citation. A
threshold propagating without its source is C1b in miniature.

### C2. The structure is non-trivial: its bindings disagree, measurably
**Status: HOLE — this is the paper's headline experiment and it does not exist yet.**

Parry & Toth discard Android's `ACTIVITY_STOPPED` (event 23) and justify forward pairing thus:
*"event type 23 can be delayed… Therefore, it is more effective and accurate to define the start of
a new app episode as the end of the previous app episode."* **"More effective and accurate" is
asserted with no quantification or validation anywhere in the 32 pages.**

We are the only party holding both implementations against one engine. The experiment:
same real study data, four bindings, report divergence in the downstream statistics researchers
actually publish (daily minutes, session counts, per-app totals, fragmentation).

**Unblocked 2026-08-05.** All three rules are bound to the seam and selectable, and they are
separation-tested: on a four-event fixture the three rules produce three different episode sets
(see §5). What remains for C2 is not engineering — it is running the comparison on real study data
and reporting the downstream statistics.

**Its role in the argument.** This is not the paper's headline; it is what stops the ontology being
a taxonomy nobody needs. If every binding produced the same numbers, naming them would be
bookkeeping. The disagreement is what makes the choice load-bearing, and therefore what makes a
declared, comparable vocabulary worth having. Karas already established this at device level; C2
establishes it at app level, across independently authored rules rather than one pipeline's
parameter.

### C3. Instrument capability bounds definability (the ladder)
**Status: EVIDENCE IN HAND, structure settled.** See dossier §7.1.

| Rung | Instrument | Definable |
|---|---|---|
| 4 | Raw platform event log, declared semantics (Android `UsageEvents`) | All four methods; binding auditable |
| 3 | App-level logging research app (PhoneStudy, Behapp, AWARE) | Episodes; rule usually undeclared |
| 3− | Vendor-derived event stream, undeclared predicate (Apple `App.InFocus`) | Episodes, but the predicate is Apple's and **differs by device class** |
| 2 | Screen-on/off only (Wilcockson, Shaw, Tkaczyk) | Device sessions only; app attribution impossible |
| 1 | Vendor aggregate (iOS Screen Time rendered; Android Digital Wellbeing) | Nothing; construct arrives pre-decided |

The rung-3− row is new and comes from reading ASTER in full. Its own text gives three different
definitions of "in focus" — Mac, iPhone/iPad, Watch — pooled into one dataset, none documented by
Apple, none tested. Cite that passage; it is the thesis stated by authors who did not notice.

### C4. Sub-hour recovery from hourly bars is quantified, and its reliability metric is honest
**Status: EVIDENCE IN HAND (user's existing analysis, not re-derived here).**

λ(Δ) = Var(T)/(Var(T)+Var(E)) over Android ground truth: 0.80/0.79 at 1 min rising to 0.92/0.92 at
30 min (TECH/GNSM). **Signed bias = 0.00 at every Δ.** Median displacement 1 min; **55% of minutes
land exactly right.**

**Mandatory framing:** λ(60) = 1.00 is a *structural identity*, not a result — placement is
mass-conserving within the hour by construction. Say so in the same breath as the table. An
unexplained 1.00 discards the whole thing in a reviewer's eyes. The existing analysis already
labels it correctly; the paper must not lose that.

Lead with displacement (55% exact, median 1 min), not with a correlation-family statistic.

Independent corroboration worth stating: λ ≥ 0.87 at 15 min and the continuous-analysis Tier 1
boundary at ≥15 min are two different statistics landing on the same cut.

### C5. Android is the only platform where the vendor aggregate can be checked
**Status: DESIGN OPPORTUNITY, no data.** Digital Wellbeing is ontologically identical to iOS Screen
Time — rung 1, undisclosed rule, screenshot-only acquisition. But on Android it coexists with the
raw log on the same device, so the gap between the vendor's number and each binding's number is
directly measurable, and that measured gap is the warrant for the iOS argument.

We hold no Digital Wellbeing data. Flagged, not claimed.

---

## 3b. What the six-slice search sweep changed (2026-08-05)

Results in `docs/paper/search-briefs/results-slice-{A..F}.md`. Four claims must be narrowed, one
must be dropped, and two new citations are mandatory. None of this is optional framing — each item
below makes a sentence in the current draft false as written.

**C1 must be scoped to mobile screen-time research, explicitly.** Slice C found that declaring the
sessionization rule is the *norm* in web analytics, process mining, GPS staypoint detection,
accelerometry, and eye tracking. van Hees et al. (2018) is the killer counter-example: nine
numbered steps, every constant given, shipped in GGIR v1.5-23, validated against polysomnography.
Draw the contrast deliberately — it makes the finding sharper, not weaker. An unscoped "the field
doesn't declare its rule" is simply wrong.

**"Nobody declares it" is false even inside the mobile literature.** Two clean declarations:
- **Ernala et al. (2020), CHI** — 30 s idle timeout closing retroactively at the last event, a
  separate 60 s session-merge gap, *and* a sensitivity check. Then names logging as a discrepancy
  source and dismisses it unmeasured.
- **Toth & Trifonova (2021)** — already in the census as the counter-example that proves the point.

The defensible claim is the **rate and the pattern**, not a universal. And note the correlation
slice F found: the one paper that attributes error to the *rule* is the one paper that wrote its
rule down. You can only blame a rule you declared.

**Scope discipline, stated once so it stops slipping.** This paper's claim is about **Android
event-log episode reconstruction**: turning typed punctual events into app episodes when the
closing event is delayed, absent, or ambiguous. Findings from web sessionization, GPS staypoints,
accelerometry epochs, and metered browsing are **context and method precedent**, not competitors.
When a search agent ranks one of them as a "citation threat", ignore the ranking and read the item
for the rule or machinery it contributes — the paper has no competitors by construction, because
its claim is that published rules are instances of the structure. One such ranking already had to
be reversed (Ochoa & Revilla, below), and the whole ranking frame was retired on 2026-08-05.

**The declarations exist — outside the literature that uses the measurements.** Slice A's biggest
find, and it reframes the whole contribution. **Scope it exactly as written here:**
- Android's own `UsageEvents.Event` reference states that "any open events without matching close
  events between DEVICE_SHUTDOWN and DEVICE_STARTUP should be ignored because the closing time is
  unknown."
- AOSP's `UsageStats.update()` / `updateActivity()` **is** Google's complete event→duration
  algorithm, readable in source: per-`instanceId` state machine, no threshold of any kind. That is
  the definition of `getTotalTimeInForeground()` — i.e. the rung-1 aggregate is not actually
  opaque on Android.
- `usageDirect` published the full edge-case taxonomy on a Codeberg wiki in 2021 — duplicate
  open/close, shutdown, startup, true vs faulty unmatched close, true vs faulty unmatched open,
  data gone, timezone-shifted midnight — implemented in Olauncher's `EventLogWrapper.kt`.

So the thesis becomes: **the rule is knowable, has been written down repeatedly, and no published
study that reports a screen-time number cites any of it.** Stronger and more defensible than
"nobody knows."

**But state the evidence for the second half exactly.** What was actually established is
*uncited in the searchable indexed literature*, which is not the same as "no paper anywhere":
- OpenAlex full text since 2015: `UsageStatsManager` in **45** works, `UsageEvents` in **49**
  (several false positives on unrelated senses), `MOVE_TO_FOREGROUND` in exactly **3**. None of the
  three is a methods paper about episode construction.
- Plus zero citations across the ~85 items retained by slice A and the 51 census entries.

OpenAlex does not index every paywalled body, so the defensible phrasing is **"uncited in the
searchable literature"** with the counts given. Do not write "no study cites it" unqualified.

**Factual correction to our own materials:** AOSP defines **32** event types (0–31,
`MAX_EVENT_TYPE = 31`), 16 of them `@hide`; the public reference lists 18 constants / 16 distinct
values. The "~46 interaction types" figure used in the search brief and in earlier notes matches no
AOSP source. Fix it everywhere before it reaches the paper.

**C2 and Ochoa & Revilla — method precedent, NOT a citation threat.** The search agent ranked this
"threat rank 1"; that ranking was against a claim this paper does not make, and it must not be
carried forward.

- What they are: **Ochoa & Revilla (2025), PLOS ONE.** Survey methodologists studying **job-search
  behaviour from web browsing**, collected by the Wakoopa commercial meter on a Netquest survey
  panel. The records are URL visits with timestamps. 10,080 operationalizations varying session gap
  (10/30/60 min), minimum visit duration (2/5/10 s), max-duration outlier handling, and search-spell
  separation. Correlations between measurement pairs 0.14–0.91.
- What that has to do with Android event logs: **nothing structural.** No typed event constants, no
  `ACTIVITY_RESUMED`, no delayed or absent close event. A metered URL visit has a start and the
  meter observes the exit. The problem this paper is about does not arise in their data.
- The only real link is provenance: their 30-minute gap is justified as "the 30-minute standard used
  in Google Analytics." That makes them **one more exhibit for C1b** (thresholds are inherited, not
  derived), and a **precedent for the method** of varying construction rather than model.
- **The claim they would refute — "nobody has run a multiverse below the analysis layer in any
  field" — is not this paper's claim and never was.** Cite them as method precedent, in one
  sentence, and move on.

**Karas et al. 2024 (JMIR mHealth) already established that the binding matters — use it.**
They declare their rule, publish BSD-3 R code, and report one preprocessing cap moving daily screen
time by **−106.1 and −133.5 min/day**, while writing "we do not have a definitive reason for
choosing the 30-minute threshold." Do not treat this as a claim to defend against. Cite it as the
device-level demonstration that a reconstruction choice is load-bearing, and let C2 extend it where
Karas could not go: their logs carry no app attribution, and they vary one parameter of one
pipeline rather than comparing independently authored rules.

**Prior art for the screen-gated crediting layer.** Verbeij et al. (2021, 2022) already intersect
app usage with screen state on Android logs and quantify it (2% / 2.6% of records dropped). We are
not first. Position that work on the reporting/option-space side, not as novel capability.

**The methodology we should adopt, not invent.** Berendt, Mobasher, Nakagawa & Spiliopoulou
(WebKDD 2002) formalised exactly our step: a sessionization heuristic `h` maps an activity log to
constructed sessions, scored against ground truth by named recall/precision measures. Their ground
truth came from ablation — strip the site's own session ID, run each rule, score it. That design
transfers to Android unchanged, and it is the right evaluation frame for C2. Their headline is also
our headline in another domain: 13,829 real sessions became 14,234 / 15,971 / 41,117 depending only
on the rule.

**Threshold provenance extends beyond our set.** Catledge & Pitkow's mean 9.3 min + 1.5 SD = 25.5
min → "smoothed out to 30 minutes" → Berendt's θ=30 → **Google Analytics 4's still-current
default**. Three independent refutations (Jones & Klinkner 2008, Mehrzadi 2012, Halfaker 2015,
whose fitted thresholds span 14–335 min) never stopped it. Two bonus exhibits: two papers cite
Catledge & Pitkow as different years, and the famous "25.5 min performs no better than random"
soundbite is contradicted by Jones & Klinkner's own Table 3.

**iOS: the export premise does not hold.** See §6 — this was our assumption, and it is unverified.

**Ontology (slice E) — the closest existing formal work, which must be cited and distinguished:**
- **IoT-Stream (Elsaleh et al., Sensors 2020)** already publishes the normative claim, for numeric
  streams: "When IotStreams are derived from another IotStream, the Analytics applied, i.e., the
  methods and their corresponding parameters need to be declared and annotated." It lacks typed
  punctual events with open/close roles, missing-terminator handling, and any internal rule
  structure (`methods` is an opaque string vector).
- **gOCED (Hooshyar et al.)** names our problem and dissolves it — intervals "can be directly
  defined, without needing to reconstruct these periods from a sequence of events." Our counter:
  Android's `UsageEvents` is not ours to redesign, so reconstruction is permanent.
- **`sosa:Procedure`** and **`oboe:Measurement`** already make the generic pattern normative;
  **`prov:Plan`** is explicitly "left to be extended by applications" — take that framing, it is to
  our advantage.
- **The finding worth its own paragraph in the paper: UFO-B axiom T5' requires every event to have
  exactly one begin and one end point.** UFO-B literally cannot represent an unterminated episode —
  which is exactly the End-of-Usage-Missing case, the single most consequential thing an Android
  event log does. A foundational ontology being unable to express the field's central pathology is
  a real result.
- **No ontology of screen time, app usage, or device usage exists at all.** OpenAlex returns 0.

**One unread lead that could still overturn a priority claim:** Shaleha, Roque et al. (2026),
"Screen Use Measurement Tools: A Mapping of 36 Instruments" (SAGE, 403). Most likely place someone
already catalogued whether tools document their reconstruction. **Resolve before claiming
priority.** Second: SAO (Stream Annotation Ontology), the one remaining candidate that could
overturn "no ontology does this."

**Contamination flagged, do not launder:** two slices independently surfaced a "Carnegie Mellon
(2022) 37–68% deviation across 42 test users" study. Not in Crossref, OpenAlex, Semantic Scholar,
or PubMed; the host is SEO content. Treat as fabricated until a primary source appears.

---

## 4. Related work — what each work contributes to the structure

Nothing in this section is a competitor. The ontology's claim is that these are all instances, so
every entry is read for **the rule it implements** or **the piece of machinery it supplies**. An
entry that fits is evidence for coverage; an entry that does not fit is the only thing that can
falsify the paper.

| Work | What it contributes |
|---|---|
| **Winklbauer & Batinic (2026)** | The downstream half. 16,128 specifications, but their input was *already-reconstructed episodes* (their p.32). They vary everything above the episode; this paper varies the episode. The two compose. |
| **ASTER (Martens & Van Gaeveren 2026)** | An iOS binding, and a worked example of a rule with no unmatched-event policy. Same stream Edwards documented in 2018 (`/app/inFocus` → `App.InFocus`); broke during its own peer review; timezone lost. |
| **Hooshyar et al. (2025)** | Machinery. Process-mining metamodel; gives events capacity to *hold* an interval, never asks where the interval comes from. Take `gufo:QVAS` for device-state-over-interval. |
| **Karas et al. (2024)** | A device-level binding, plus the effect size. Declares its rule, publishes code, and reports that swapping one cap moves daily totals by 106–133 min. Cite for "the binding matters," which they established. |
| **Schoedel et al. (2026)** | A rung-4 binding: app episode from a type-1 launch until the next launch or screen-off. Forward pairing with a screen terminator. |
| **usageDirect (2021)** | The most complete published enumeration of unmatched-event cases, with a handling chosen for each — duplicate open/close, shutdown, startup, cross-boundary opens. A binding recovered from a wiki. |
| **GSIM / DDI-SDTL / SOSA / IoT-Stream / P-Plan** | The host vocabularies. They already model `Rule`, `Process Method`, parameters, and execution provenance. The paper's job is the domain contents, not a new provenance language — say so and cite them. |
| **OntoKratos (2026)** | The nearest domain ontology. Models problematic smartphone use, app categories, screen status. Carries no opener/closer, pairing, or missing-close semantics — which locates the gap precisely. |

The distinguishing sentence, to be written explicitly because a process-mining reviewer will assume
total overlap: *they formalise how to represent an event that has a duration; this paper formalises
how to decide what the duration is when the record does not say.*

---

## 5. What the app needs

**Built 2026-08-05** (items 1–3 below are now done; the rest stand):

- `EpisodeReconstructionStrategy` in `pipeline_v2.rs` — `FusedMatcher` (default),
  `ParryTothForwardPairing`, `EyesComplement`, with `canonical_id()` /
  `from_canonical_id()` round-tripping the ontology's `ReconstructionStrategyId`. Unknown ids fall
  back to the production path.
- `match_app_usage_forward_pairing_indices_core` in `chronicle_app_usage_matcher` — Parry & Toth's
  Steps 6–7, with 9 tests pinning each clause. It never reads `same_stop` / `other_stop` /
  `stopped`, because their rule discards type 23.
- `match_app_episodes_with_strategy` in `pipeline_v2_incremental.rs` — the single dispatch seam.
  Every arm takes the same `MatcherInput` and returns the same `MatcherOutput`, so nothing
  downstream changes. **The strategy is part of the alternation cache key**; without that,
  switching rules on identical input would return the previous rule's cached output.
- `episode_reconstruction_strategy` option key in the browser contract, default `fused_matcher`,
  declared in `workflow_contract.rs` with edge `selects` (not `tunes` — it picks an algorithm, and
  the four `MatchOptions` keys are read by the fused matcher only).
- 5 seam tests, including one that asserts the default reproduces the production matcher **exactly**
  and one that asserts forward pairing closes an episode somewhere the fused matcher does not —
  same input, two rules, two answers. Without that second test the seam would be an unverified
  claim.
- **All three rules are bound to the seam** (`eyes_complement` wired 2026-08-05, later the same
  day). `match_app_episodes_with_strategy` takes the masked rows as well as the `MatcherInput`,
  because EYES segments the *device-state* timeline and needs the screen and power events the
  matcher index does not carry. `eyes_complement_episodes` maps EYES's timestamp-keyed episodes
  back to row indices by exact match — a resume time can only bind to an `ACTIVITY_RESUMED` row of
  that package bearing that timestamp — and an episode whose end cannot be resolved is reported
  missing rather than closed at a guessed row.
- The seam is separation-tested on a fixture built to split all three rules. Rows: screen on,
  `R(com.a)`, `R(com.b)`, `R(com.a)`, `S(com.a)` far from the newest resume.

  | rule | `stop_start` → `stop_event` | reading |
  |---|---|---|
  | `fused_matcher` | `[3,2,1] → [4,4,4]` | every open start pairs against the one observed stop |
  | `parry_toth_forward_pairing` | `[1,2] → [2,3]` | stop discarded; resume chains to resume |
  | `eyes_complement` | `[1,3] → [2,4]`, missing `[2]` | far stop kills the package; the superseded block is repaired forward onto `com.b`'s resume (`MST`); `com.b` itself is never terminated |

  A test asserts no two rules produce identical episodes on it. Without that, "the seam selects a
  rule" would be an unverified claim.

Ordered by dependency, not priority.

1. **`episode_reconstruction_strategy`** — DONE for `parry_toth_forward_pairing` and
   `fused_matcher`. Default path is byte-identical, verified.
2. **`eyes_complement`** — DONE. Module landed 2026-08-05 as
   `rust/chronicle_chrono_kernel_wasm/src/eyes_complement.rs` (3,003 lines, 78 inline tests, all
   green; clippy and wasm32 check clean). Built from the EYES reference sources, not from the doc
   summary. Bound to the strategy seam the same day and selectable from the browser UI; C2 is no
   longer blocked on it.
   - The `MST` repair walk is implemented: when a stop is missing, walk forward and take the next
     foreign package's resume as the end. Without it every damaged episode overstates duration.
     Paper finding in its own right: the two "opposed" methods converge under damage.
   - Three deliberate divergences from the reference are documented and each has a test (stale
     predecessor after a forward reboot gap; non-monotonic gap emission; nested-block cursor
     reset). These are bugs in the reference, and they are citable.
   - **The `anomaly_states` interpretation was reviewed independently, and the port was wrong.**
     The premise behind the original split — "a block's tag is whichever was written last, so
     behavior depends on write order" — is false. `ActivityBlock` has **three separate fields**
     (`resume_event`, `pause_event`, `stop_event`); there is no shared field and no layering, and
     `duration()` tests exactly one of them. `MAR` is only ever written to `resume_event` and `NPI`
     only ever to `pause_event`, so both are **dead entries** in `anomaly_states`: the reference's
     test reduces to `stop_event ∈ {NSI, AKD, SSD}`. The port's widened predicate fired the repair
     walk on a class of blocks the reference leaves at zero, and — because the walk writes a
     synthetic `time_stop_ns` — that propagated into `merge_app_chunks`, changing Final App Usage
     fragments and the downstream ACTIVE/IDLE tagging, not just a duration column. The one test
     that exercised the branch had **pinned the divergence as if it were the reference's
     behavior**. Fixed: the predicate is restricted to the three stop tags, the test is rebuilt on
     a fixture that is anomalous by the reference's own rule, and a new test pins the zero for a
     block superseded by a newer resume of the same package. This is the third time a green
     self-validation in this tree concealed a real logic bug — the standing rule that logic-dense
     changes get an independent oracle is earning its keep.
   - **A fourth divergence from the reference was undocumented and is now recorded:** the port
     filters the pickup export to paired blocks. The reference's `EventBlock.duration_seconds`
     returns `None` for a partial block and `gen_pickups.py:99` compares it with `>=`, so the
     reference **crashes with a `TypeError`** on any dataset containing an unpaired `SHUTDOWN` —
     which its own design emits. The port's silent drop is correct behavior and a citable defect
     in the reference.
3. **A second bug the same review caught, in this repository's own persistence, not in EYES.**
   `ReconstructionBaseInputKey` hand-enumerates every matcher-influencing option and had omitted
   the new strategy. The restore path returns the entire persisted reconstructed row table *plus*
   the persisted `match_app_episodes` checkpoint **without ever calling the matcher** — so running
   a file under one rule, then re-running it under another with everything else unchanged, served
   the first rule's rows under the second rule's receipt. It also bypassed the seam's own
   fail-closed guard entirely, since that guard lives inside the function the restore path skips.
   Fixed: the strategy is in both key builders and the format is bumped v8 → v9 (`CHRRX009`) so
   already-persisted v8 bases cannot match. The in-session alternation caches were already correct;
   the persisted key was the single hand-maintained one, and it was the one that was missed.
4. **`make dependency-evidence`, once, now that EYES has landed.** Source-sensitive — it builds
   WASM from the live worktree, so no Rust edits may be in flight. The runtime crate's 7 failures
   were **proved reversibly** to be digest staleness, not logic: removing the module and reverting
   `lib.rs` gives 74 passed / 0 failed. `build.rs:206` hashes the kernel `src/` into
   `CHRONICLE_IMPLEMENTATION_BUILD_DIGEST`, so any new production file fails the certificate closed.
5. **A/B → N-arm comparison.** `armB` is currently hardcoded in `App.tsx` / `ViewPanel.tsx`. The
   paper needs four arms side by side; the UI needs to stop assuming two.
6. **Named configuration presets** — one per published method, so a reader can reproduce
   "Parry & Toth 2025" by name rather than by reconstructing eleven toggles.
7. **Ontology additions** — `PlacementStrategy` class; a rendered-measurement class (for rung-1
   vendor aggregates); a temporal-resolution property; claim-type → method binding.
8. **Culverhouse trim-and-log as a declared binding** — currently downstream policy, not a named
   strategy. Needed for the four-arm comparison to be honest.

---

## 6. Known holes

Each is a real gap, not a caveat.

| Hole | Blocks | Note |
|---|---|---|
| **C2 experiment** | The headline result | No longer blocked on engineering — all three rules run. Needs the comparison run on real study data, and the fourth arm (Culverhouse trim-and-log) is still downstream policy rather than a named binding. |
| **Quote verification pass** | Any quotation in the paper | ~10 load-bearing quotes need checking against source PDFs **by someone other than the agent that found them**. Not done. |
| **iOS export — REOPENED, two routes** | The iOS case's data source | Slice B's "no export exists" conclusion was **wrong by omission**, and the cause is instructive: neither route appears in the iOS 26 release notes or the WWDC25 index, so a release-note sweep could not find them. A follow-up agent enumerated all 404 symbols across `DeviceActivity`, `FamilyControls` and `ManagedSettings` via Apple's index endpoints and read each one's availability metadata. Two live routes: <br>**(A) `DeviceActivityData.activityData(filteredBy:using:)`, iOS 26.4.** Apple's documentation, verbatim: *"Use this method to export family activity data, for use in another app or platform."* This reverses the `DeviceActivityReport` sandbox rule. Four gates: the new `com.apple.developer.family-controls.app-and-website-usage` entitlement; the new `AuthorizationStatus.approvedWithDataAccess` grant; **EU device location AND EU Apple Account**; and **one app per device, exclusively**. Returns per-app `totalActivityDuration`, `numberOfPickups`, `numberOfNotifications` with real bundle IDs — **bucketed hourly at finest** (`SegmentInterval` is hourly/daily/weekly). No raw event timestamps exist anywhere in the framework. The DMA→26.4 causal link is *unverified*: the EU gating is documented, the reason is not. <br>**(B) "Get App & Website Data", a Shortcuts action, iOS 26.0.** Apple publishes the action's **name only** — no parameters and no output type, anywhere. **What it returns is UNVERIFIED and unanswerable from the web**; resolving it needs an iOS 26 device and the action's in-app info button. This is the highest-value open question in the iOS case: if it returns per-app totals it is participant-runnable with **no entitlement and no EU gate**, strictly better than route A for research logistics. <br>Confirmed alongside: the `DeviceActivityReport` sandbox blocks *"moving sensitive content outside the extension's address space"* — stronger than "no network", and it forecloses shared containers and share sheets too. `ManagedSettingsStore` carries no usage data at all. **No Screen Time App Intents surface exists** (zero hits across all 28 App Intents schema domains; none of the 404 symbols conforms to `AppIntent`), so even an entitled developer cannot vend this into Shortcuts. Screen Time is not an automation trigger. iOS 27's Time Allowances and Screen Time redesign (previewed 2026-06-08, ships "this fall") are **setting-side only** — zero mention of export or Shortcuts — and had not shipped as of this writing. |
| **What "Get App & Website Data" returns** | Whether the iOS case has a participant-runnable collection route | Needs an iOS 26 device. Apple documents the name and nothing else, and the Shortcuts changelogs only start at iOS 16.0 with no cumulative action catalog — so "undocumented" here means *Apple has not published it*, not *it does not exist*. |
| **`totalActivityDuration` vs DeviceActivity** | The rung 3− argument | Best single iOS artefact found. An Apple Frameworks Engineer, in Developer Forums thread 722334, states `totalActivityDuration` "includes screen time where no apps or websites are used (e.g. the time spent on the Home Screen), whereas Device Activity is only monitored for actively used apps and websites." Two Apple APIs, two different constructs, and the definition exists **only in that forum reply** — the documented description is one sentence with no discussion. This partly contradicts a flat "the vendor never declares" framing. The defensible claim: **the rule is real, consequential, and unpublished.** |
| **Van Canneyt 10 s** | One row of the C1b table | CC-BY paper, ACM DL 403s every non-browser client, no OA mirror. Either get the PDF another way or report the value as second-hand — which is itself the point. |
| **Coverage beyond W&B's 51** | External validity of C1 | The census is one reference list. It is the right *first* set (we did not pick it), but a reviewer will ask whether the silence holds outside it. A second sweep is queued — see `docs/paper/search-briefs/`. |
| **`native_screen_end_reason_v1`** | Strategy vocabulary completeness | Named in `device-state-machine.md`, never declared in the ontology. Decide: fifth strategy, or folded into `fused_matcher`? |
| **Digital Wellbeing data** | C5 | None collected |
| **Title** | Nothing yet | Deliberately deferred |

---

## 7. Base rates, stated carefully

The census is a **null-result claim over a set we did not select**, which is its main defence
against cherry-picking: hiding a declaration would strengthen the claim, and every instruction ran
the other way — agents were told to report surprises, so a study that *did* declare its rule would
have been the headline.

Two honesty constraints that must survive into the paper:

1. **Separate the census from the exhibits.** The agent briefs asked for quotable material
   ("quote liberally", "the verbatim sentence is the deliverable"). That is correct for finding
   candidate evidence and wrong for establishing a base rate. Report the denominator from the
   structured fields; use quotes only to illustrate.
2. **Never score an unread paper as silent.** 9 of 41 are abstract- or metadata-only. They are
   undetermined and must be reported as such.

---

## 8. Next actions

1. EYES lands → `make dependency-evidence` (once) → `make all`.
2. Run C2: four bindings, one dataset, downstream-statistic divergence.
3. Census reconciliation across all five lanes, app-level vs screen-level split.
4. Quote verification pass on the load-bearing ~10.
5. Revisit this spec with C2's numbers in it. **Then** it stops being a draft.

Evidence base as of this draft: `docs/paper/citation-chase/lane-{1..5}.md`, all five lanes
reported.

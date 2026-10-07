# Literature dossier — screen-time measurement ontology paper

**Compiled:** 2026-08-05. **Window:** 2020 – August 2026 (foundational older work included only
where attribution requires it).
**Method:** six parallel search lanes (measurement validity; preprocessing multiverse;
measurement ontologies; temporal disaggregation; vendor-reported/iOS data; adjacent fields),
each run with negation queries and an exclusion list of already-known prior art. Every DOI below
was then checked against the Crossref REST API in a single verification pass.

**Verification status:** 53 of 54 DOIs resolved against Crossref with matching titles.
The one miss (`10.48550/arXiv.2306.04335`) is a DataCite arXiv DOI, which Crossref does not index —
not a bad citation. Items marked **UNVERIFIED** below were never opened by a lane agent and are
recorded here as leads, not citations. **Do not put an UNVERIFIED item in a bibliography without
resolving it first.**

---

## 1. Corrections to existing repo documentation

### 1.1 The "Traces as Data" citation is a ghost — delete it

`docs/workflow/prior-art-vocabulary.md` carried a flagged, self-admittedly unverified claim that
Valkenburg/Beyens (Amsterdam/ASCoR) published a specification-curve analysis titled
*"Traces as Data"*. The doc itself said "confirm the citation before it goes in a paper."

**Resolved: the paper does not exist.** Searched by exact phrase, by author, and by institution;
Patti Valkenburg's own publications page and the Project AWeSome publications page were both
fetched and neither lists it — nor any specification-curve or multiverse paper by Valkenburg,
Beyens, Siebers, Verbeij, Pouwels, or van Driel. The attribution was wrong on all three counts
and conflated two separate papers by two separate groups.

The likely source of the "Amsterdam" error: `specr`, a widely used specification-curve R package,
is authored at VU Amsterdam.

**What is actually true**, and what the doc should say instead:

| Claim | Reality |
|---|---|
| Multiverse over Android-log usage metrics | **Winklbauer & Batinic (2026)**, Johannes Kepler University **Linz** |
| Multiverse over temporal windowing | **Klingelhoefer, Gilbert, Adrian & Meier (2026)**, *J. Communication* — FAU **Erlangen-Nürnberg** / Mainz |
| Fragmented / sticky use metrics | **Siebers, Beyens & Valkenburg** — Amsterdam supplied the *metrics*, not the multiverse |

### 1.2 Other bibliographic corrections found during verification

- **Siebers et al.** — *Mobile Media & Communication* **12(1):45–70**; online 2023-08-16, print
  2024-01. Cite as 2023 or 2024 consistently; it is not 12(2).
- **Milan models paper** (`10.1515/cclm-2024-0104`) — first author is **Jones, Graham R.D.**,
  not Sandberg. Sandberg is sixth of eight. *CCLM* 62(8):1531–1537.
- **Jansen (2026)** — the abstract does **not** say duration-based measures yield negative
  associations and content-based ones positive. Verified wording: detrimental outcomes are most
  frequent in **cross-sectional self-report** studies, while **null or mixed** results emerge when
  **objective, within-person, or fine-grained** measures are applied. See §3.2 — the real finding
  is more useful *and* more double-edged.

---

## 2. Direct novelty threats

Ranked by how much they constrain the paper's contribution claims.

### 2.1 Winklbauer, A., & Batinic, B. (2026) — the closest competitor

*From Logs to Metrics: The Impact of Researcher Degrees of Freedom on Smartphone Usage Metrics.*
SSRN preprint, Johannes Kepler University Linz. doi:10.2139/ssrn.7008242
**VERIFIED FROM FULL TEXT.** The 45-page preprint was read in full (user-supplied PDF, 2026-08-05).
Everything below is from the source document, not from search snippets or the abstract.

Verified findings:

- **16,128 unique analytical specifications** over **10 methodological dimensions**, applied to
  four usage metrics: duration, frequency, fragmented use, sticky use.
- Absolute estimates of duration, frequency and fragmentation vary **by up to nearly threefold**
  depending on specification.
- **Session threshold is the dominant factor, explaining 51–78% of the variance** in absolute
  metric values.
- Participant **rankings remain stable** across specifications, mean Spearman **r = .87–.93**.
- **The dimension driving absolute values (session threshold) is not the dimension driving rank
  stability (window length).** These come apart.
- Correlations of usage duration with self-reported usage (r = .28–.45) and with age
  (r = −.36 to −.16) varied across specifications **in strength but not in direction**; longer
  measurement windows and stricter data-availability criteria generally yielded stronger
  associations.
- Their own framing: absolute estimates are compromised for cross-study comparison, but
  "relative comparisons between individuals remain relatively robust, which is reassuring for
  individual-differences research."

#### The exact 10 dimensions (their Table 1, p.15)

| Dimension | Operationalizations | k |
|---|---|---|
| Window Length | 7 d, 14 d, 28 d, all available days | 4 |
| Window Selection | minimal-missing-data window, initial days | 2 |
| Data availability exclusion | ≥2/3 days, ≥1/4 days, ≥11 events/day | 3 |
| Session Exclusion | none, >10 h sessions, >24 h sessions | 3 |
| Long Duration Handling | none, 5 h cutoff | 2 |
| System App Filtering | none, Schoedel et al. (2022), Parry & Toth (2025), extended merge | 4 |
| Launcher Inclusion | include, exclude | 2 |
| Session Threshold | 10 s, 30 s, 60 s, 300 s | 4 |
| Temporal Aggregation | all days, usage days only | 2 |
| Summary Statistic | mean, median | 2 |

Window selection is nested within window length (inapplicable to "all available days"), giving 7
effective window combinations. Total = 7 × 3 × 3 × 2 × 4 × 2 × 4 × 2 × 2 = **16,128**.

#### Sample and instrument

591 German Android users from the respondi AG (Bilendi) commercial opt-in panel; survey December
2023, tracking data 15 June – 31 December 2023. 41.3% female, age 19–85 (M = 47.8, SD = 12.1).
Tracking software: **Wakoopa**. Retained N per specification ranged 416–586 (M = 538). A **common
core of 374 participants (63.3%)** survived all 16,128 specifications. Analyses in R 4.4.1;
multiverse framing from Steegen et al. (2016).

#### Numbers worth quoting exactly (their Tables 2–4)

| Metric | Mdn | IQR | Range | max/min | mean Spearman *r* | SD *r* |
|---|---|---|---|---|---|---|
| Duration (h/day) | 2.95 | 0.45 | [2.28, 4.18] | 1.83 | .93 | .04 |
| Frequency (sessions/day) | 30.75 | 11.67 | [17.8, 45.3] | 2.55 | .91 | .04 |
| Fragmentation | 4.08 | 1.33 | [2.23, 6.81] | 3.06 | .93 | .03 |
| Stickiness (ln s) | 7.64 | 0.24 | [7.14, 8.12] | 1.14 | .87 | .06 |

Session-threshold variance share (Table 3): duration 58.1%, frequency 77.3%, fragmentation 51.2%,
stickiness 77.7% (mean 66.1%). Rank impact never exceeded 100 × (1 − r) = 10 for any dimension;
window length was the largest rank disruptor. For RQ3 (Table 4), **data availability exclusion**
explained the most variance in the correlation coefficients (34.9% for self-report, 32.5% for age),
with session threshold mattering for age (25.9%) but not self-report (3.3%).

Filtering effects, useful as concrete numbers: the Schoedel et al. (2022) list (1,197 identifiers,
174 matched) removed **23.2% of events but only 10.5% of duration**; Parry & Toth's list (183
identifiers, 126 matched) removed **12.1% of events / 5.0% of duration**; the merged list 23.5% /
11.7%. Launcher events were **20.6% of all events but 7.9% of duration**.

#### The limitation that defines the remaining gap (their p.32)

> "The data therefore consisted of **preprocessed application episodes rather than raw event logs**,
> which restricted our ability to vary certain preprocessing decisions that would introduce
> additional degrees of freedom in raw log-based workflows."

This is the single most important sentence in the paper for our purposes. Their multiverse starts
*downstream of reconstruction*. Wakoopa handed them episodes; they never varied — and could not
vary — the rule that turns raw `UsageEvents` into episodes in the first place. Every one of their
ten dimensions is a filter, a window, an exclusion, or an aggregation over episodes that already
exist. **The reconstruction rule itself is absent from the largest multiverse ever run on this
data type.** That is precisely the axis Parry & Toth forward-pairing, EYES complement, Culverhouse
trim-and-log, and the Chronicle matcher differ on.

Two further self-identified limitations that read as direct invitations:

- **Overlapping episodes** (their footnote 6, p.33): overlaps were <0.1% of duration in their data
  and did not affect their session-level metrics, "**However, future studies aggregating
  event-level durations (e.g., per-app usage time) should address overlapping episodes
  explicitly.**" — this is an explicit call for what `split_overlapping_sessions` already does.
- **iOS** (their p.33): iOS "does not offer comparable third-party access to granular usage logs,
  making the type of multiverse analysis conducted here largely infeasible on that platform … they
  face a different — and likely more constrained — set of researcher degrees of freedom, **which
  may warrant separate investigation in the future.**"

#### Also noted

Their "Declaration of generative AI use" states Claude (Anthropic) was used for R syntax, code
comments, and manuscript writing improvements. Not paper-relevant, but worth knowing the norm is
now to declare it.

**What this threatens.** Result 2 of the planned paper — "the same log, processed different ways,
gives different minutes" — is substantially their result. It is also stronger corroboration of the
thesis than anything the repo had, and the session-threshold dominance finding is a gift.

**What survives, and it has to be stated precisely.** Three things, all now confirmed from the
full text rather than inferred:

1. **They never varied reconstruction.** Their input was already-reconstructed episodes (p.32,
   quoted above). The four named methods this paper absorbs disagree about exactly the step they
   held fixed.
2. **They vary one team's own parameter grid** and report dispersion. The planned paper formalises
   **four independently authored, published, named methods** (Parry & Toth, EYES, Culverhouse,
   Chronicle) as bindings in a single ontology, and verifies each binding computes correctly. They
   have no ontology; the choices are researcher degrees of freedom to sensitivity-test, never a
   semantics of what an episode *is*.
3. **They excluded iOS by construction** and said so, flagging it as future work.

Cite them as corroboration, not as a competitor to work around.

**The rebuttal that must be written, not improvised.** A reviewer will lead with rank stability:
"the binding doesn't matter." Three counters, all sourced:
1. Rank stability *within one dataset* says nothing about comparing two studies that used
   different bindings — and cross-study comparison is exactly what the authors themselves flag as
   compromised.
2. Absolute minutes are what guidelines, clinical cutoffs, prevalence statistics, and
   meta-analyses run on. See Zenko et al. (2019), §4.1 — the accelerometry analogue moves a
   policy-relevant prevalence figure from 3.4% to 95.6% on identical raw records.
3. Jansen (2026) shows operationalization choice tracks published effect *direction* across a
   whole literature (§3.2).

**Watch item:** if this lands in *CCR* or *Behavior Research Methods* before submission it becomes
concurrent work that must be engaged in the text, not merely cited.

### 2.2 Hooshyar, H., Fumagalli, M., Montali, M., & Guizzardi, G. (2025)

*Time and Relations into Focus: Ontological Foundations of Object-Centric Event Data.*
arXiv:2512.14425. **VERIFIED (fetched).**

**READ 2026-08-05 — pages 1–10 of 25** (abstract, introduction, the six open challenges, related
work, the gUFO background, and the full concept-by-concept grounding in §5). Sections 6–8
(conceptual assessment, case-study evaluation, conclusion) are still unread; they do not bear on
the novelty question, which pages 1–10 settle. **Verdict: NOT a novelty threat. Downgrade.**

**What it actually is.** A *process mining* paper. The domain is business processes — purchase
orders, shipping, student supervision. It takes the **OCED Core Model** (Fahland et al.) and grounds
it in **gUFO**, a lightweight OWL implementation of UFO-B, producing a metamodel they call
**gOCED**. UFO is the upcoming **ISO/IEC CD 21838-5**, which is a useful standards anchor for us.

**Their six challenges** (C1–C6, §2): C1 no event-to-event relations; **C2 event atomicity**; C3
representing objects over time; C4 binary-only O2O; C5 O2O identification; C6 O2O ambiguity. Five of
the six are about *object relationships*. Only C2 touches our territory.

**Why C2 does not threaten the paper — this is the whole argument, and it is sharp.** Their C2
states that Core Model events are punctual while real events have duration, and they note the
standard workaround verbatim:

> "This limitation is typically addressed by mapping a durative event into two punctual events
> denoting start and completion."

That is *precisely* the Android/Apple situation — and they raise it only to dismiss it as an
inelegant **representational** patch. Their fix is representational too: a `gufo:Event` "can be
either instantaneous or extended over a temporal interval. The duration of an event is specified by
its association with two points in time: the beginning and the end of the event."

**They give the metamodel the capacity to hold an interval. They never ask where the interval comes
from.** In process mining the log records what happened and the start/end are given; the modelling
question is how to represent them faithfully. In our domain the interval is **not given** — it must
be *inferred* from punctual observations that underdetermine it, and there are named, published,
mutually incompatible inference rules (Parry & Toth forward-pairing, EYES triplets + `MST` repair,
ASTER naive open/close pairing, the Chronicle matcher). Hooshyar et al. have no concept for a
derived interval, no way to say which rule produced one, and no treatment of the case where two
rules yield different intervals from identical input.

So the two papers are adjacent, not overlapping: **they formalise how to represent an event that
has a duration; this paper formalises how to decide what the duration is when the record does not
say.** State the distinction in exactly those terms — a reviewer from the process-mining side will
otherwise assume the overlap is total.

**What they do NOT cover, confirmed from the text:** derived vs observed assertions; execution
provenance of a derivation; missingness and gaps as first-class; competing reconstructions of the
same input; measurement validity of any kind.

**Vocabulary worth borrowing (real value, cite them for it).**
- `gufo:Event` / `gufo:Endurant` (perdurant vs continuant) — the occurrence/interval distinction
  with an ISO-track foundation behind it.
- **`gufo:QVAS`** (Quality Value Attribution Situation): "the period during which a particular
  quality value is attributed," with start and end times. This is a well-founded, citable model for
  **device state over an interval** — screen on/off, locked/unlocked — which is exactly what the
  EYES block timeline and our `device_state_timeline` node represent. Better than inventing our own.
- `gufo:Relator` for reified relationships with their own identity.
- Their explicit endorsement of **Allen interval relations** for relating events, which the paper
  already uses.
- Event mereology: atomic vs complex events with the weak supplementation and extensional axioms —
  relevant if a session is modelled as composed of episodes.

**Consequence:** §2.2 no longer constrains contribution claims. Cite gOCED as the object-centric
counterpart and borrow QVAS. The remaining pages (6–8) are worth a skim only if the case-study
evaluation turns out to include a temporal-derivation step, which the abstract does not suggest.

### 2.3 Leo, S., Crusoe, M.R., Rodríguez-Navas, L. et al. (2024)

*Recording provenance of workflow runs with RO-Crate.* PLOS ONE 19(9):e0309210.
doi:10.1371/journal.pone.0309210 — **VERIFIED.**

Three-tier profiles (Process / Workflow / Provenance Run Crate) for retrospective execution
provenance, PROV-aligned, implemented across six workflow systems. A reviewer will ask why the
paper does not simply emit a Workflow Run RO-Crate. The answer — typed field-level provenance
*inside* the engine, and assertion-level rather than run-level granularity — must be in the text.

### 2.4 Martens, M., & Van Gaeveren, K. (2026) — ASTER

*Making the impossible possible: Leveraging built-in features for non-intrusive and accurate Apple
Screen Time tracking through ASTER.* Behavior Research Methods.
doi:10.3758/s13428-026-03065-2 — **VERIFIED** (article page + GitHub README; full text paywalled).

Exploits Screen Time's iCloud sync: the participant donates macOS system files, yielding usage for
every device on the Apple ID. Parses `~/Library/Biome/streams/` `App.InFocus` plus
`com.apple.syncedpreferences/sync.db`, emitting **per-event open/close records**, not the bar chart.

Published 29 May 2026, Behavior Research Methods 58, article 179. Abstract concedes three
limitations in the authors' own words: **requires the participant to own a Mac**, captures **only
the previous 4 weeks**, and is "**vulnerable to changes in Apple's software structure, echoing the
moving target problem.**"

**Downgraded from novelty threat to illustration.** Two independent reasons.

**1. The extraction technique is eight years old and comes from digital forensics, not from
psychology.** Reading Apple's local usage store to recover per-app open/close records with
durations is documented in detail by **Sarah Edwards, "Knowledge is Power! Using the macOS/iOS
knowledgeC.db Database to Determine Precise User and Application Usage," mac4n6.com, 6 August
2018** — a month *before* Screen Time shipped with iOS 12. That post already documents the
`ZOBJECT` / `ZSTRUCTUREDMETADATA` / `ZSOURCE` tables, bundle IDs via `ZVALUESTRING`, start/end
timestamps with second-level durations, the macOS paths (`~/Library/Application Support/Knowledge/`
and `/private/var/db/CoreDuet/Knowledge`), the iOS path, and **the same ~4-week retention window
ASTER reports**. The technique is standard tooling in the forensics industry — Belkasoft, Magnet
AXIOM, Velociraptor and the APOLLO toolkit all parse it. ASTER reads
`~/Library/Biome/streams/App.InFocus`, which is simply where **Apple moved this data in iOS 16 /
macOS 13 (2022)**. So the store has already migrated once inside the technique's lifetime; the
"moving target problem" the abstract gestures at is not hypothetical, it is the documented history
of the exact file being read.

Implication for our citation practice: **do not cite ASTER as the first or only way under the iOS
aggregate.** Cite it as a recent published instance of a long-established forensic extraction, and
cite Edwards (2018) for the technique. If the paper needs to say the field avoided publishing on
this, that is an argument from silence and must be phrased as such.

**2. Operator domain judgment (recorded, not independently verified):** the method is known to be
**extremely inconsistent in practice and is likely already broken**, and other researchers avoided
publishing on it for that reason. This is the user's assessment from direct familiarity with the
approach. It is consistent with the verified migration history above, but it is a practitioner
judgment, not a literature finding — **do not assert it in the paper as fact.** What *can* be
asserted from the record: Mac-only, 4 weeks, and one documented store migration already.

### 2.4b ASTER — corrections after reading the full text (2026-08-05)

The published article (7 pages, Behavior Research Methods 58:179, received 5 Dec 2025, accepted
7 May 2026) was read in full. **Two things previously recorded in this dossier were wrong. Both are
corrected here; do not carry the old versions into the paper.**

**Correction 1 — ASTER is NOT rung 1. It is rung 3.** The earlier entry said it yields Apple's
aggregate more conveniently. It does not. `~/Library/Biome/streams/restricted/App.InFocus` yields
**per-app open and close events with microsecond timestamps** — their Table 1 shows real rows
(`com.openai.chat`, `com.apple.mobilesafari`, `org.whispersystems.signal`) with `open_close` coded
1/0. Their own words (p.3): "ASTER accesses the 'raw data' as collected by the operating system
itself and entails the parsing of that raw data, **without any other aggregation and minimal
processing**." So the bar chart is genuinely bypassed. The ladder entry for iOS must distinguish
**Screen Time the rendered aggregate (rung 1)** from **the Biome App.InFocus stream (rung 3)**.

**Correction 2 — ASTER applies no cleaning or deduplication rule.** The earlier entry claimed it
did. It does not. Duration is defined by subtraction and nothing else (p.4): "each app usage will
thus have two entries in the dataset (1 and 0). The usage time can be calculated by subtracting the
timestamps of both entries." No threshold, no gap logic, no system-app filter, no overlap handling,
no cap. That is a **third reconstruction rule** alongside P&T forward-pairing and EYES triplets —
the naive open/close pairing — and it is the weakest of the three because it has no repair path at
all for an unmatched open.

**What survives, and it is sharper than what it replaces.** Apple's `in focus` predicate is itself
an undeclared reconstruction decision, and **it is not the same predicate across device classes**
(p.5, verbatim):

> "Only apps in focus are logged. An app is considered in focus on the Mac when it appears in the
> top left corner of the Mac's active screen (if multiple screens are in use). For the iPhone and
> iPad, it is the app that is currently visible or being interacted with last (if multiple apps are
> open). On the Apple Watch, it is the app that is open and visible. Apps that are running in the
> background but not visible or active are not logged."

Three different definitions of "in use," pooled into one cross-device dataset, none of them
documented by Apple, none of them varied or tested by ASTER. **This is the paper's thesis in a
single paragraph, published by authors who did not notice they had written it.** Cite this passage.

**The fragility is confirmed by the authors, not merely suspected** (p.5, verbatim):

> "In an earlier version, this study adopted a different strategy with the same idea… At that time,
> the relevant Screen Time information was stored in the KnowledgeC.db SQLite database, and
> extraction required only one straightforward SQL query. However, **during the review phase**,
> Apple released major operating system updates (iOS 26, iPadOS 26, macOS 26) that **rendered this
> method inoperative**. The data was migrated to less interpretable Biome SEGB files, which
> underpins the current methodology."

So: v1 of ASTER *was* the `knowledgeC.db` technique Edwards documented in August 2018, and it broke
**between submission and acceptance**. The authors then call this "a perfect example of the 'moving
target' problem." The operator judgment recorded above — inconsistent, likely already broken — is
consistent with the paper's own account of itself.

Their opening claim, "To our knowledge, prior to 2019, there was no way to access the raw data of
iOS Screen Time" (p.3), is contradicted by Edwards (6 August 2018). Note the hedge does real work
there; treat it as a novelty claim that did not survive checking, and do not repeat it.

#### OPEN — the highest-value unverified item in this dossier

ASTER's central premise is stated at the top of its Discussion (p.5, verbatim):

> "Apple does not provide granular Screen Time data through its Screen Time APIs, nor is such data
> included when users request their personal information through the Data and Privacy portal.
> Consequently, obtaining usage data from Apple devices remains a significant challenge for both
> individuals and researchers."

**Operator claim (user, 2026-08-05, unverified here): iOS 26 permits users to hand over their
Screen Time data directly.** If that is right, the premise is false *as of the paper's own
publication date* — and note the irony, because iOS 26 is the same release the authors say broke
their v1 method during peer review. The same update that forced the rewrite would also have
removed the need for it. That is not a small correction; it goes to whether the contribution
exists at all.

**Why this must be checked before ASTER is cited for anything.** The two claims sit in the same
paragraph of the same page, so the authors were plainly aware of iOS 26 when they asserted no API
access. Either they are right and the premise holds, or the paper's motivation was obsolete on
arrival. Our own §3.1 absence claim is unaffected either way (Apple documenting an *export* is not
Apple documenting its *aggregation rule*), but the framing of ASTER in our related-work section
depends entirely on the answer.

**How to check, in order.** Session web-search budget was exhausted before this could be resolved,
and a `WebFetch` of Apple's DeviceActivity documentation returned a hallucinated answer (it asserted
iOS 26 does not exist) rather than page content — so **nothing here is verified**. Next session:
Apple's `DeviceActivity` / `FamilyControls` / `ManagedSettings` release notes for iOS 26; the iOS 26
"What's new" developer documentation; the Data & Privacy portal's current category list; and WWDC
2025/2026 session material on Screen Time. Prefer Apple primary sources over commentary.

#### Operator context, recorded as context and not as evidence

The user reports that **a researcher at the University of Hawai'i attempted this same
Mac-side extraction approach and abandoned it because of how inconsistent it proved in practice.**
Unpublished and unattributable, so it cannot be cited — but it is consistent with the paper's own
account of a method that broke between submission and acceptance, and it is a good reason not to
build any part of this paper's iOS argument on ASTER's continued operability.

**Hard operating requirements** (p.3, p.4): macOS 26 / iOS 26 / iPadOS 26 / watchOS 26 or later —
"devices running older software versions are not supported"; a Mac in the household; **28 days** of
retention, so longitudinal work needs repeated donation; SEGB V2 encoding (they suggest verifying
with `hexdump -C "path" | head -20` for the `SEGB` magic, `53 45 47 42`); dependence on `sync.db`
keeping its `DevicePeer` schema. Authors' own framing: "ASTER is not a finished product. It is
intended as a proof-of-concept." No preregistration. Code at
`github.com/kvgaever/ASTER-Apple_Screen_Time_ExploreR`.

**Consequence for §3.1.** The Apple-aggregation absence claim is *unaffected and slightly
strengthened*: ASTER is the paper most likely to have documented Apple's rule, it had the raw
stream in hand, and it still does not describe how Apple's own Screen Time totals are computed from
these events. It documents the stream, not the aggregation.

### 2.4c ASTER (2026) vs Edwards (2018) — same stream, eight years apart

Edwards, S. **"Knowledge is Power! Using the macOS/iOS knowledgeC.db Database to Determine Precise
User and Application Usage."** mac4n6.com, 6 August 2018. **VERIFIED (fetched in full.)**

**The decisive fact: it is the same stream, under the same name.** Edwards' 2018 query filters
`WHERE ZSTREAMNAME IS "/app/inFocus"`. ASTER's 2026 method reads
`~/Library/Biome/streams/restricted/**App.InFocus**`. Apple renamed the container and changed the
encoding from SQLite to SEGB; the semantic stream is unchanged. ASTER is not a new source of data.
It is the 2018 source after a storage migration.

| | **Edwards (2018)** | **ASTER (2026)** |
|---|---|---|
| Store | `knowledgeC.db`, SQLite | `App.InFocus`, Biome SEGB V2 |
| Stream name | `/app/inFocus` | `App.InFocus` |
| Access | one SQL query | parse SEGB + join `sync.db` `DevicePeer` |
| Record shape | **one row per episode**: `ZSTARTDATE`, `ZENDDATE` | **two rows per episode**: `open_close` 1 then 0 |
| Duration | `(ZENDDATE − ZSTARTDATE)`, direct | subtract paired rows — pairing can fail |
| App identity | `ZVALUESTRING` (bundle ID) | `app_bundle` + `app_version` |
| **Timezone** | **`ZSECONDSFROMGMT`, present** | **absent from the export** |
| Day of week | `ZSTARTDAYOFWEEK`, present | absent |
| Write time | `ZCREATIONDATE`, present | `last_sync_date` |
| Devices | one device per acquisition | **all devices on the Apple ID, synced to one Mac** |
| Retention | "approximately 4 weeks" | 28 days |
| OS scope | macOS 10.13 / iOS 11 | macOS 26 / iOS 26 / iPadOS 26 / watchOS 26 **only** |

**What is new in ASTER — and this was previously overstated here, corrected 2026-08-05.** An
earlier draft of this section credited the "iCloud sync trick" as a real contribution to
acquisition burden. That was too generous. **Their own Step 1 is a settings toggle.** Verbatim
(p.3): "the first step is to launch the Mac computer and open the Screen Time tab in settings. In
this tab, the toggle labeled 'share across devices' should be set to 'on.'" The cross-device
coverage is a user-facing Apple feature being switched on. It is not a technique, and it is not
something Edwards could not have done — he was doing single-device forensic acquisition because the
forensic use case is single-device, not because the toggle was unavailable.

What actually remains as new relative to Edwards (2018) is narrower still: **a SEGB V2 parser**,
because Apple changed the encoding. Note that SEGB parsing is itself established territory in the
same forensics community that produced the `knowledgeC.db` documentation — public SEGB parsers
exist. Before citing the tool as a contribution, check whether the parser is novel or a
reimplementation. **Unverified.**

**Two regressions worth naming, because they cut against the paper's own accuracy claim.**

1. **The record shape got worse.** 2018 gave a complete episode on one row with both endpoints.
   2026 gives two rows that must be paired, which introduces a failure mode that did not previously
   exist — an `open` with no matching `close` (app killed, device off, sync boundary, 28-day
   window edge). ASTER states no rule for this case. Every other method in this paper's comparison
   *does* have one: P&T takes the next row's start, EYES walks forward to the next foreign resume
   (`MST`). ASTER has no repair path at all.
2. **Timezone was lost.** `ZSECONDSFROMGMT` was in the 2018 schema and is absent from ASTER's
   export (their Table 1 columns are `timestamp, open_close, app_bundle, app_version,
   last_sync_date, device_identifier, device_name`). For a screen-time instrument this is not
   cosmetic — daily totals, bedtime windows, and DST-boundary days all depend on local offset. Our
   own pipeline treats timezone as first-class (`day_flags` carries `DST_day`).

**Edwards' caveats that ASTER inherits without repeating.** Verbatim from 2018: application usage
"is really only for GUI-based applications"; and the schema warning, "This data is specific to
macOS 10.13 and iOS 11. Other versions may contain the same data but the schemas/contents may be
slightly different." That second sentence, written in 2018, predicts precisely the failure ASTER
suffered during peer review in 2026.

**How to use this in the paper.** Not as a takedown — as the cleanest available case study of the
thesis. A team invests real effort to reach event-level Apple data, succeeds, and still ships an
instrument whose central predicate ("in focus") has three different device-specific definitions it
does not control, no rule for unmatched events, and no timezone. The measurement questions are
invisible *because the acquisition problem was so hard that solving it felt like solving the
measurement problem*. That confusion — acquisition mistaken for measurement — is worth naming
explicitly in the discussion, and ASTER is the example that makes it concrete.

### 2.5 The validation design is standard — do not claim it

Coarsen a fine ground truth, recover it, score against the retained truth. Three independent
confirmations in three fields:

- **Nash, Bhatt, Cori & Nouvellet (2023)**, PLOS Comput Biol 19(8):e1011439,
  doi:10.1371/journal.pcbi.1011439 — **VERIFIED.** EM reconstruction of daily incidence from weekly
  totals under an exact-sum constraint, initialised at *uniform* disaggregation; validated by
  taking daily data, artificially aggregating to weekly, and scoring recovery (R² 0.91–0.99).
- **Zabel & Poschlod (2023)**, Geosci. Model Dev. 16:5383–5399, doi:10.5194/gmd-16-5383-2023 —
  **VERIFIED.** Aggregated hourly WFDE5 to daily, re-disaggregated, correlated against the original
  hourly observations across 30 sites and 40 years. Also the closest published analogue to a
  donor-shape method.
- **Tackney et al. (2023)**, Stat Methods Med Res 32(10):1936–1960,
  doi:10.1177/09622802231188518 — **VERIFIED.** 473 complete-data participants, induced realistic
  missingness, imputed, scored against known truth.

**Defensible instead:** not the design but the substrate — (a) ground truth is **microsecond
event-log timestamps**, not merely a finer aggregate, so unlike prior work the study actually sees
true within-bin timing; (b) the coarsening is a **real platform constraint imposed by Apple**, not
synthetic; (c) the **cross-platform** step, Android truth licensing claims about iOS data.

---

## 3. Confirmed gaps — the negation searches that came back empty

Each was searched deliberately, including "why X fails" phrasings. These are the paper's positions.

1. **No head-to-head comparison of multiple *published* Android preprocessing implementations on
   one event log.** Winklbauer & Batinic sweep parameters within one pipeline; nobody has run four
   independently authored methods over the same log and reported divergence in minutes.
2. **No formal ontology of usage-episode concepts.** No competitor found in any lane. BCIO remains
   the nearest neighbour and does not formalise temporal segmentation of device logs.
3. **No documentation, by Apple or anyone else, of how Screen Time aggregates raw usage into
   hourly bars.** See §3.1 for the careful version.
4. **No study treating the session/inactivity threshold as *definitional* rather than a nuisance
   parameter.** Where thresholds are discussed they are researcher degrees of freedom to be
   sensitivity-tested, never a semantics that determines what the measured entity is.
5. **No many-analysts study on screen-time logs.** N teams handed one raw Android log and asked for
   daily minutes does not exist. The paper does analytically what such a study would do
   empirically, with four real published methods standing in for the teams — arguably a stronger
   framing than "multiverse."
6. **No application of temporal disaggregation (Denton, Chow-Lin, Fernández, Litterman) to
   screen-time, smartphone, or app-usage data at any resolution.** The app-usage literature splits
   a known session at the hour delimiter — the inverse operation, with timestamps in hand.
7. **No published edge-loaded contiguous-session placement model** — the structural argument that a
   multi-hour run exists *because* a session crossed a boundary, so run-start hours are back-loaded
   and run-end hours front-loaded. No analogue found in any domain. This is the most clearly
   original method available and should be foregrounded over the Denton variants.
8. **No sub-epoch placement method in accelerometry.** The field's response to aggregation loss was
   to argue for shorter epochs and characterise the bias, never to invert the aggregation.
9. **No boundary-anchored / zero-padded Denton variant** in the literature. Cholette (1984)
   identified the first-period distortion; the specific run-boundary ramp fix is unpublished.
10. **No minimax-regret selection among disaggregation estimators.** Ensembling exists (NNLS in the
    Python `tempdisagg`); regret-based hedging does not.
11. **No OCR-accuracy benchmark specific to Screen Time screenshots**, no published QC protocol, no
    inter-rater or OCR-vs-human comparison, no error-propagation analysis for the screenshot lane.
    A second, separable absence the paper can claim.
12. **No paper whose subject is iOS/Android non-equivalence** as a threat to cross-platform
    inference. Nobody has written "pooling iOS and Android screen time pools two different
    constructs."
13. **No reporting standard naming session/episode/glance/gap policies as required disclosures.**
    Langener et al. (2024) gets closest and stops short of the sessionization primitives.
14. **No LinkML adoption in behavioral-science measurement.** Adoption is genomics, microbiome,
    biomedical KGs. Claimable as a first.
15. **No maintained missingness/censoring ontology.** Nothing beyond DQV-level annotation. No
    ontology encodes MAR/MNAR assumptions, censoring type, or sensitivity-analysis provenance. The
    statistical literature on partial identification has zero semantic-web uptake.
16. **Not one critique in the screen-time literature targets the log-processing layer.** The whole
    critique cluster aims at self-report and content-vs-duration.

### 3.1 The Apple-aggregation absence, stated carefully

The distinction between "no public documentation" and "I could not find it" matters, and the
situation is not uniform:

- **Apple's user-facing docs**: fetched and read. The macOS Screen Time page explains only the
  chart legend — "The bars represent your total usage. The colored parts represent the top three
  categories... The gray parts represent usage that does not fall into those categories." That is
  a legend, not a definition. No usage definition, no bucketing rule, no rounding, no treatment of
  background audio or picture-in-picture.
- **Apple's developer docs**: the DeviceActivity framework overview and `DeviceActivityFilter`
  reference define `SegmentInterval` only as "the interval at which the system subdivides device
  activity data." No duration semantics anywhere in the framework. ⚠ The `SegmentInterval` enum
  cases could **not** be retrieved — do not write `.hourly`/`.daily`/`.weekly` without checking.
- **The one rule-like statement Apple has made anywhere** is a Frameworks Engineer reply in
  Developer Forums thread 722334 (Dec 2022): `totalActivityDuration` "includes screen time where no
  apps or websites are used (e.g. the time spent on the Home Screen)," whereas DeviceActivity
  monitors only actively used apps and websites. One forum sentence — which also documents that
  two first-party Apple APIs disagree on the same underlying usage.
- **Why the data cannot be exported**: Developer Forums thread 817516 (Mar 2026), Apple DTS
  engineer, confirms the confinement is deliberate — the report extension runs in a read-only
  sandbox so it "can't export that sensitive data." App Groups, shared `UserDefaults`, shared
  containers and `CFPreferences` all fail by design. This is the structural fact that forces OCR.
- **Reverse engineering has gone only halfway.** Forensics and grey literature established *what
  Apple stores* — `knowledgeC.db` with second-precision start/end intervals per bundle ID per
  device; ASTER reaches the same layer via Biome `App.InFocus`. **Nobody has published the mapping
  from those rows to the rendered bars.**

Recommended phrasing for the paper:

> The raw substrate underlying iOS Screen Time has been characterized by forensic and open-source
> work at second-level interval granularity. The transform that turns it into the Screen Time
> display — session boundary rules, hourly bucketing, treatment of Home Screen, picture-in-picture,
> background audio, and sub-second foreground transitions — is, to our knowledge, undocumented by
> Apple and uncharacterized in the published literature.

**Unclosed:** the body text of Apple's iPhone-side support pages (JS-rendered, did not fetch) and
the `SegmentInterval` enum cases. Neither likely hides an aggregation spec, but neither was read.

---

## 4. The strongest supporting evidence found

### 4.1 Adjacent fields — the analogy that carries the introduction

- **Verhoog, Gubelmann, Bano et al. (2023)**, Sci Rep 13:2879, doi:10.1038/s41598-023-29872-7 —
  **VERIFIED.** 2,693 adults, one set of raw wrist accelerometer files, three software packages
  (plus two versions of the same package) under two threshold sets. Moderate PA: **19 to 161
  min/day**. The authors state flatly that results across studies are not comparable. **Software
  version is itself a parameter binding.** This is the paper the screen-time field lacks and the
  planned paper supplies.
- **Zenko, Willis & White (2019)**, Front Public Health 7:135, doi:10.3389/fpubh.2019.00135 —
  **VERIFIED.** NHANES accelerometer data under two cut-points × bouted/non-bouted rules: the
  proportion meeting the 2018 US guideline ranges **3.4% to 95.6%** on identical raw records. A
  policy-relevant prevalence statistic, moved by two preprocessing parameters. The bout rule
  ("counts only if sustained ≥10 min") is structurally identical to a minimum-session-duration
  threshold. **This is the single best rhetorical exhibit in the dossier.**
- **Haddadj et al. (2024)**, PLoS ONE 19(12):e0316176, doi:10.1371/journal.pone.0316176 —
  **VERIFIED.** Six epoch lengths on one dataset: WHO guideline adherence **99.4% at 1 s vs 12.2%
  at 60 s**. Bias direction is non-monotone — coarsening inflates the middle category while
  deflating both tails.
- **Panesar et al. (2025)**, JMIR Form Res 9:e70778, doi:10.2196/70778 — **VERIFIED.** Five
  actigraphy scoring algorithms on MESA (n=1,440) with synchronised polysomnography: total sleep
  time mean differences from **−46 to +91 min**. Note the asymmetry to exploit: sleep research has
  a gold standard and can rank algorithms by validity. Screen-time preprocessing has none, so its
  choices are currently *unfalsifiable* — which is precisely why declaring them formally is the
  only available move.
- **Vanhelst et al. (2019)**, BMC Med Res Methodol 19:72, doi:10.1186/s12874-019-0712-1 —
  **VERIFIED.** Seven non-wear rules against a time-stamped removal diary: wear time varied 17%,
  sedentary time 30%, **MVPA barely moved**. Use this for honesty — claim *which* parameters are
  load-bearing, not that all preprocessing matters.
- **Sensors (2022) 22(13):5041** sleep-onset rule comparison — **UNVERIFIED author list.** Found
  *no* significant effect of the 1/5/10-consecutive-minute onset rule. A disciplined null; include
  one so the thesis is falsifiable.
- **Dibben et al. (2025)**, Scand J Med Sci Sports 35(10):e70143, doi:10.1111/sms.70143 —
  **VERIFIED.** **47 competing accelerometry guidance documents** in a decade, inconsistencies
  persisting. Proliferation of standards is itself a failure mode. Argues for a single
  machine-checkable declaration over a forty-eighth prose checklist.

### 4.2 Meta-research anchors

- **Botvinik-Nezer et al. (2020)**, Nature 582, doi:10.1038/s41586-020-2314-9 — 70 teams, one fMRI
  dataset; no two workflows identical, hypothesis outcomes diverge. The canonical anchor.
- **Schweinsberg et al. (2021)**, OBHDP 165:228–249, doi:10.1016/j.obhdp.2021.02.003 — isolates
  *operationalization*, not modelling, as the dispersion source.
- **Bastiaansen et al. (2020)**, J Psychosom Res 137:110211, doi:10.1016/j.jpsychores.2020.110211 —
  many analysts, one ESM dataset; explicitly localises divergence in **preprocessing**.
- **Del Giudice & Gangestad (2021)**, AMPPS 4(1), doi:10.1177/2515245920954925 — **the objection
  that must be answered.** Deciding which specifications are genuinely arbitrary is the hard,
  neglected problem; "a few decisions incorrectly treated as arbitrary can quickly explode the size
  of the multiverse, drowning reasonable effect estimates in a sea of unjustified alternatives."
  **The defence is strong and should be explicit: the four bindings are not arbitrary grid points,
  they are published methods with authors — which is exactly the "principled equivalence" standard
  the paper demands.**

### 4.3 Screen-time specific

- **Siebers, Beyens & Valkenburg (2023/2024)**, Mobile Media & Communication 12(1):45–70,
  doi:10.1177/20501579231193941 — **VERIFIED.** "Fragmented use" and "sticky use" are established
  psychological constructs **definitionally downstream of the session boundary rule**. Change the
  inactivity threshold and both change mechanically. The thesis, using someone else's published
  constructs.
- **Alexander et al. (2024)**, Sci Rep 14:17982, doi:10.1038/s41598-024-68467-8 — **VERIFIED.**
  n=1,415 ABCD adolescents. Two passive measures of the same phone use correlate **r = 0.33**. They
  published explicit code to harmonize Android vs iOS — documentary proof the bindings are not
  interchangeable.
- **Kristensen et al. (2022)**, Comput Hum Behav Rep 5:100164, doi:10.1016/j.chbr.2021.100164 —
  **VERIFIED citation; numbers from snippets, re-check the PDF.** n=40. **Android: mean bias
  −0.8 min/day, r = 0.99. iOS: mean bias 19.3 min/day, r = 0.88.** Note the direction — the Android
  pair agrees to within a minute a day because both sides read the same documented event stream;
  the iOS pair is off ~20 min/day because one side is Apple's undocumented reconstruction. **The
  headline platform-asymmetry number.**
- **Radesky et al. (2020)**, Pediatrics 146(1):e20193518, doi:10.1542/peds.2019-3518 —
  **VERIFIED.** n=346 parents of 3–5-year-olds. **Android measured by the Chronicle app; iOS by
  screenshots of the Battery page**; 126 Android / 220 iOS, then pooled. The canonical instance of
  the asymmetry, in the Chronicle lineage this repo sits in. Likely the paper's motivating example.
- **Perez et al. (2023)**, PLoS ONE 18(4):e0283714, doi:10.1371/journal.pone.0283714 —
  **VERIFIED.** Identifies two studies using Apple Screen Time screenshots **as the criterion
  measure**. The field has promoted an unaudited vendor number to ground truth against which
  self-report is judged. The strongest version of the argument.
- **Byrne, Terranova & Trost (2021)**, Obes Rev 22(8):e13260, doi:10.1111/obr.13260 —
  **VERIFIED.** In 0–6 screen-time research, only 40% of articles cited the measure used and only
  **11% reported any psychometric properties**.
- **Parry, Davidson, Sewall, Fisher, Mieczkowski & Quintana (2021)**, Nat Hum Behav 5(11):1535–1547,
  doi:10.1038/s41562-021-01117-5 — **VERIFIED.** The canonical self-report/log discrepancy
  meta-analysis. Frame it as the paper that *installed logged data as the implicit ground truth* —
  the assumption this paper attacks — not as background.
- **Vadathya et al. (2024)**, Sci Rep 14:29805, doi:10.1038/s41598-024-81136-0 — **VERIFIED.**
  FLASH-TV validated against human-coded video, 85% accuracy, κ=0.71. The only measure in the field
  with a genuine external gold standard — and even it discretises to 5-second epochs.

### 4.4 Jansen (2026) — verified in detail

*Addressing Heterogeneity in Research: A Systematic Review of Evening Mobile Media Use and Sleep.*
**Astrid Jansen** (sole author), University of Hohenheim. *Media Psychology*, published online
2026-07-07, pp. 1–22. doi:10.1080/15213269.2026.2692472
**VERIFIED** — record and abstract retrieved via OpenAlex; Taylor & Francis returns 403 to
automated fetch, so the full text is unread. Crossref carries no abstract for this DOI.

**76 studies** of evening and presleep mobile media use, across North America, Europe, Asia, the
Middle East and Africa, predominantly adolescent and young-adult samples. The review "adopts a
methodological lens... examining how conceptual, operational, and design-related factors shape
reported findings."

Verified findings:
- Risk-oriented conceptualizations prevail.
- **Detrimental outcomes are most frequently reported in cross-sectional self-report studies.**
- **Null or mixed results emerge when objective, within-person, or fine-grained measures are
  applied.**
- Conclusion: "the field's heterogeneity largely reflects **systematic methodological variation
  rather than substantive disagreement**."
- The organising distinction is **what is measured, how it is measured, and when**.

**Why this matters more than the lane summary suggested.** The earlier characterisation
("duration-based measures yield negative associations, content-based yield positive") is not what
the abstract says and should not be used. The real finding is sharper on two fronts:

1. It is direct evidence that operationalization choice tracks published *effect direction* across
   an entire literature — the strongest available rebuttal to Winklbauer & Batinic's rank-stability
   reassurance.
2. It is **double-edged, and the paper should say so.** Jansen finds that objective and
   fine-grained measurement produces *null* results. A paper arguing for better-specified objective
   measurement must not imply that better measurement will recover the detrimental effects — on
   this evidence it does the opposite. The honest framing: the ontology makes claims *auditable and
   comparable*, which is a different and more defensible promise than making them *larger*.

Jansen's three-way split (what / how / when) maps onto the ontology's own axes and is worth
adopting as vocabulary.

---

## 5. Methodological warnings

### 5.1 ICC will be inflated by the exact-total constraint

The reliability plan is ICC-type analysis of disaggregation methods. Two problems:

1. **ICC is not the convention in this literature.** None of the disaggregation-validation papers
   read used it. Nash et al. use Pearson/R² plus classification agreement; Zabel & Poschlod use
   per-variable correlation; the cascade-model literature scores reproduction of *structural*
   statistics (variance, autocorrelation function, wet-spell duration, extreme percentiles,
   intermittency); the accelerometry MI literature uses bias and coverage against known truth.
2. **The aggregation constraint partially manufactures agreement.** Every placement method
   preserves the hour total exactly by construction, so the series agree at the hour level no
   matter how badly they place within it. A correlation-family measure will read that built-in
   agreement as reliability and inflate. A reviewer will ask why a correlation-family statistic was
   chosen for a problem where the totals are constrained equal.

**Recommendation:** headline on per-bin placement error (RMSE/MAE) plus **structural-statistic
recovery** — bout counts, ACF, entropy — which is what actually discriminates the methods. Keep
ICC as a secondary agreement measure and state its form explicitly (model, single vs average,
consistency vs absolute agreement) per Koo & Li (2016), doi:10.1016/j.jcm.2016.02.012 —
**VERIFIED** — with Shrout & Fleiss (1979) doi:10.1037/0033-2909.86.2.420 and McGraw & Wong (1996)
doi:10.1037/1082-989X.1.1.30, both **VERIFIED**.

#### 5.1a The analysis already exists, and it already handles the inflation correctly

**Source: the user, 2026-08-05, reporting their own existing implementation.** Not independently
inspected here — `analyses/ios-placement-analysis/` sits in the consumer repo, which is under a
standing do-not-read instruction on this machine. Figures below are as supplied.

Implementation: `placement_proof/sci_page.py:70-84`, rendered under the "Usable resolution" heading
of `placement_proof/placement_results.html`. It computes a **full-series reliability λ(Δ)** in the
classical-test-theory signal-fraction form:

```
λ(Δ) = Var(T) / (Var(T) + Var(E))
```

where the 1440-minute day is reshaped into 1440/Δ bins for Δ ∈ {1, 5, 10, 15, 30} minutes, `T` is
true minutes per bin from the Android Chronicle microsecond ground truth (same `build_occupancy`
harness as `android_truth_validation.py`, caps applied), `P` is what `edge_loaded` reconstructs from
the hour totals alone, and `E = P − T`.

| Bin width | λ TECH | λ GNSM | Single realization | Averaged |
|---|---|---|---|---|
| 1 min | 0.80 | 0.79 | no | yes |
| 5 min | 0.83 | 0.81 | with EIV/robust | yes |
| 10 min | 0.85 | 0.84 | with EIV/robust | yes |
| 15 min | 0.87 | 0.86 | yes | yes |
| 30 min | 0.92 | 0.92 | yes | yes |
| 60 min | 1.00 | 1.00 | exact | exact |

**§5.1's warning is confirmed and already correctly disarmed.** λ(60) = 1.00 exactly, because
placement is mass-conserving within the hour by construction — it moves minutes inside an hour and
never across one. The analysis names this a **structural identity, not an empirical result**. That
is precisely the inflation this section warned about, found and labelled independently. **The paper
must state it the same way**: the hourly row is an identity, everything below 60 minutes is the
finding. A reviewer who spots an unexplained ICC = 1.00 will discard the whole table.

**The load-bearing fact is that signed bias = 0.00 at every Δ.** The error is zero-mean, not merely
small. That is what separates the two usability columns: population means, time-of-day profiles and
any averaged curve are unbiased at *any* resolution including 1 minute, because errors cancel across
days and participants. Only single-realization work — one child, one day, fine grain — degrades, and
it degrades gracefully rather than off a cliff. At 5–10 min the recommendation is errors-in-variables
or robust methods rather than treating the series as measured; at ≥15 min it can be used directly.

**Companion metric, same function:** mass-weighted displacement via per-hour optimal transport —
how far each reported minute sits from its true position. Median displacement 1 min; mean 4.5
(TECH) / 4.8 (GNSM); signed bias again 0.00. Breakdown: **55% / 55% exact**, 13% / 12% off by 1–2
min, 8% / 8% by 3–5 min, 8% / 9% by 6–10 min, 15% / 17% by more than 10 min. A slim majority of
minutes land exactly right; the tail carries the variance. This is a better headline than any
correlation-family statistic and should lead the results section.

**Consistency check that strengthens both:** the three-tier verdict from the continuous-analysis work
put Tier 1 ("analyze on edge-loaded directly, bias ≈ 0") at ≥15 min — exactly the λ ≥ 0.87 row.
Two independent derivations of the same boundary. Say so explicitly; converging estimates from
different statistics is much harder to dismiss than either alone.

**Two things not to conflate, per the user:**
- `resolution_check.py` is a **different** analysis. It re-runs the method ranking at SUB=120
  (30-second bins) to confirm the begin / uniform / boundary-anchored / edge_loaded ordering is
  resolution-invariant. It does not compute λ.
- The λ table was generated **2026-06-29**, before the July point-mass fix (`7fb91a3`) that rewrote
  `begin`/`middle`/`end`. **λ is unaffected**: it is computed on `edge_loaded` only
  (`sci_page.py:50`), and that commit replaced `_point_mass` with `_block` without touching
  `edge_loaded`, which builds its blocks directly and never passes through the feasibility
  projection. The λ numbers stand. **The `begin` comparison figures elsewhere on that page are
  stale** — do not quote those without regenerating.

### 5.2 Temporal-disaggregation attribution trap

"Denton-Cholette" is **not a single joint paper.** The `tempdisagg` package attributes its
`denton-cholette` method to Dagum & Cholette (2006), not to Cholette (1984) alone. Cite the chain:

| Method | Citation | DOI | Status |
|---|---|---|---|
| Denton | Denton (1971), JASA 66(333):99–102 | 10.1080/01621459.1971.10482227 | VERIFIED |
| Cholette | Cholette (1984), *Survey Methodology* 10(1):35–49 | none (Statistics Canada) | UNVERIFIED |
| Dagum & Cholette | (2006), Springer LNS 186 | 10.1007/0-387-35439-5 | VERIFIED |
| Chow-Lin | Chow & Lin (1971), REStat 53(4):372–375 | 10.2307/1928739 | VERIFIED |
| Fernández | Fernández (1981), REStat 63(3):471–476 | 10.2307/1924371 | VERIFIED |
| Litterman | Litterman (1983), JBES 1(2):169–173 | 10.1080/07350015.1983.10509336 | VERIFIED |
| `tempdisagg` (R) | Sax & Steiner (2013), R Journal 5(2):80–87 | 10.32614/RJ-2013-028 | VERIFIED |

Cholette's specific 1984 contribution — dropping Denton's requirement that the first period be
predetermined, because minimizing the first correction distorts the series — is **directly relevant
to the boundary-anchored variant** and should be named as such rather than lumped in.

**Theoretical framing to adopt:** Heitjan & Rubin (1991), *Ignorability and Coarse Data*, Ann.
Statist. 19(4):2244–2253, doi:10.1214/aos/1176348396 — **VERIFIED.** Hourly binning is
*coarsening*, not missingness, and the coarsened-at-random condition states exactly when a
placement rule is innocuous. This is the citation that makes the whole disaggregation section
rigorous.

**The negative result to cite rather than assert:** Müller-Thomy & Haberlandt (2020), HESS
24(1):169–188, doi:10.5194/hess-24-169-2020 — **VERIFIED DOI, author list UNVERIFIED.**
Exact-total-preserving cascade disaggregation reproduces totals but systematically fails to
reproduce the autocorrelation function and misrepresents intensities. Precisely the "single
placement is inadequate for fine structure" argument, already demonstrated in another field.

### 5.3 Claim-type method selection — claim the formalization, not the principle

The principle that the correct method depends on the evidentiary purpose is **well established in
four professional communities**, and asserting it as novel will be shot down:

- **JCGM 106:2012** (BIPM/JCGM), *The role of measurement uncertainty in conformity assessment* —
  guard bands and acceptance limits allocated by who bears the cost of being wrong. This is
  "benefit of the doubt", quantified and direction-dependent. **The closest existing formalization.**
- **ICH E9(R1)** estimands addendum — define the question first, choose the estimator after; five
  intercurrent-event strategies selected by what is being asked. Structurally identical to
  reconstruction-strategy selection. Primer: Cro et al. (2024) BMJ, PMID 38262663.
- **FDA (2018)** Biomarker Qualification Evidentiary Framework — Context of Use: a biomarker is not
  valid, it is valid *for a stated use*.
- **ENFSI (2015)** Guideline for Evaluative Reporting — reporting mode (technical / investigative /
  evaluative) determined by whether an authority must arbitrate competing propositions.
- **Jones et al. (2024)** CCLM 62(8):1531–1537, doi:10.1515/cclm-2024-0104 — **VERIFIED.** Milan
  models: required analytical quality is a function of the decision the number supports.

**But no ontology does it.** Checked: SOSA `Procedure` is a bare hook with no purpose relation;
PROV `Activity` has no purpose/intent property at all; IAO/OBI `objective specification` types the
objective of an investigation, not a constraint selecting among competing procedures; no metrology,
sensor, health or behavioral ontology surveyed contains a purpose→method relation. Nobody has
written the axiom "if the assertion's claim type is rule-violation, admissible reconstruction
strategies are restricted to physically-possible-lower-bound."

**Confidence:** ~75–80% that no published ontology formalizes this; ~95% that the four analogues
above exist and omitting them is a reviewer risk.

**Framing:** port JCGM 106's decision rules and E9(R1)'s estimand discipline into a form a
validator can enforce, attached to individual derived assertions. This converts four threats into
four supporting citations.

**In-repo evidence for the claim:** production runs `edge_loaded` placement, *except* GNSM pre-bed
violations, which run `begin` deliberately — a violation claim wants the physically-possible floor,
not the accuracy optimum. The same study uses two different rules for two different claim types.
That is the thesis demonstrated in production rather than argued in the abstract.

---

## 6. Vocabulary worth borrowing

The repo has a standing rule to name things in community vocabulary rather than mint new terms.
These have established definitions and standing citations.

| Term | Field | Meaning | Use here |
|---|---|---|---|
| **Case notion** | Process mining | The choice of which entity groups events into one case — a *selection*, not a property of the log | The best available name for what the four methods differ on. "Session definition" → "case notion choice" |
| **Convergence / divergence** | Object-centric process mining (van der Aalst 2019) | Convergence: one event duplicated across cases. Divergence: causally unrelated repeats inside one case | Names the two failure modes of any single session definition; proves no binding is neutral |
| **Activity instance** | Process mining | One occurrence of a higher-level activity assembled from several low-level events | Formal name for "usage episode" |
| **Abstraction gap** | Process mining | Distance between the level events are recorded at and the level analysts reason at | The thesis phenomenon in one citable phrase |
| **Extraction / correlation / abstraction** | Process mining (De Weerdt & Wynn 2022) | The three stages of turning raw records into analysable event data | Top-level structure for the ontology's parameter groups |
| **Episode** | Time-use / MTUS | A period during which *no field of the diary changes* — any state-field change starts a new episode | Generalises the gap threshold into "which state fields are boundary-relevant" — strictly more general, and all four methods fit inside it |
| **Sub-episode split** | Time-use / MTUS | Overlapping episodes split into sub-episodes summing to the original duration | Handles backgrounded/PiP apps without double-counting |
| **Input vs output harmonisation** | Official statistics / HETUS | Agree the instrument up front vs post-hoc mapping of divergent instruments onto a common target | Names exactly what this ontology is (output harmonisation) and why it is the only option in a field with no mandating authority |
| **Bout / break / interruption / pattern** | SBRN consensus (Tremblay et al. 2017), doi:10.1186/s12966-017-0525-8 | Bout = uninterrupted period of the target state; break = a non-target bout between two target bouts | Direct replacements for "session" and "gap". Note the instructive weakness: the consensus fixed concepts and left thresholds open, which is why the field still disagrees on numbers — that gap is the contribution |
| **Guider vs epoch classifier** | Sleep / GGIR–HDCZA (van Hees et al. 2018), doi:10.1038/s41598-018-31266-z | Bracket detection is a separate, separately-parameterised stage from moment-level classification | Splits episode-boundary policy from is-this-use policy. Probably the highest-value structural borrowing available |
| **Epoch length / cut-point** | Accelerometry | Aggregation interval before classification; threshold converting continuous signal to discrete category | Temporal-resolution parameter, distinct from the gap/merge parameter |
| **Non-wear; valid day; valid week** | Accelerometry | Rules for inferring device absence, and for admitting a day/participant | Two separate parameter classes: absence semantics, and inclusion rules that change *the sample* |
| **Event log imperfection pattern** | Process mining (Suriadi et al. 2017), doi:10.1016/j.is.2016.07.011 | Recurring log-quality defects in symptom/cause/remedy template form | Citable taxonomy for Android log pathologies. Several map one-to-one: *elusive case* = the log has no session identifier (the thesis); *inadvertent time travel* = timezone/clock corruption; *scattered event* = one record standing in for several real ones |
| **Compositional data / isotemporal substitution** | CoDA | The 24 h day as a constrained composition; time is reallocated, never created | Frames parameter sensitivity as redistribution among parts of a fixed whole rather than a level shift |

**Note on Suriadi et al.**: the eleven pattern names come from independent search corroboration
after a direct PDF fetch returned a mis-attributed citation. Confirm against the ScienceDirect
record before publication.

---

## 7. The instrument lineage — what the tool can see bounds what can be measured

Winklbauer & Batinic's own related-work passage names the research-app lineage:

> "an increasing number of studies have turned to self-developed research applications or
> open-source tools that allow full control over data collection and processing (e.g., Jones et
> al., 2015; Kristensen et al., 2022; Stachl et al., 2020; Toth & Trifonova, 2021; Toth, 2023).
> These range from **simplified screen-on/off logging** (e.g., Shaw et al., 2020; Tkaczyk et al.,
> 2024; Wilcockson et al., 2018) to **detailed application-level event logging** (e.g., Stachl et
> al., 2020; Toth & Trifonova, 2021; Toth, 2023)."

That "range from... to..." is a **granularity axis**, and it is load-bearing for this paper in a way
Winklbauer & Batinic do not develop: *the instrument's event vocabulary bounds which measurement
constructs are definable at all.* A screen-on/off logger cannot express an app usage episode — not
because the analyst chose a different threshold, but because the events required to define one were
never recorded. This is the same argument the paper makes about iOS, one rung further down.

### 7.1 The measurement-capability ladder

| Rung | Instrument | Events available | Which constructs are definable |
|---|---|---|---|
| 4 | Raw platform event log with **declared semantics** (Android `UsageEvents`) | Full lifecycle vocabulary, each constant tied to a named callback | All four published methods expressible; the binding is a choice and is auditable |
| 3 | **App-level event logging** research app (PhoneStudy; Toth & Trifonova) | App foreground transitions | Episodes definable; the reconstruction rule is a choice, usually undeclared |
| 2 | **Screen-on/off logging** (Wilcockson et al.; Shaw et al.; Tkaczyk et al.) | Device screen state only | Device-level sessions and "checks" only. **App attribution is impossible, not merely unreported** |
| 3− | **Vendor-derived event stream with undeclared predicate** (Apple `App.InFocus` via ASTER / `knowledgeC.db`) | Open/close per app, but "in focus" is Apple's predicate and **differs by device class** | Episodes definable, but the predicate is neither documented nor controllable, and there is no timezone. See §2.4b–c |
| 1 | **Vendor aggregate with hidden rule** (iOS Screen Time as rendered; Android Digital Wellbeing) | None — hourly bins of a completed reconstruction | Nothing is definable. The construct arrives pre-decided, and sub-hour claims require inference (§2.5) |

The paper's four-method comparison lives entirely at rung 4. The contribution is partly that
**rung 4 is the only rung where the question "which binding did you use?" is even answerable** — and
that most of the field's evidence base sits at rungs 1–3, where it cannot be asked.

#### Android Digital Wellbeing occupies rung 1, and that makes it the calibration bridge

Digital Wellbeing is ontologically identical to iOS Screen Time: a vendor-computed aggregate,
delivered as a rendered summary, produced by an undisclosed rule, with the raw events withheld.
Winklbauer & Batinic group them together for exactly this reason (their p.3: "system-generated
usage summaries provided by built-in smartphone tools such as Digital Wellbeing (Android) or Screen
Time (iOS)… rely on aggregation algorithms whose inner workings are not transparent to
researchers"). Same rung, same problem.

**But Android is the only platform where rung 1 and rung 4 coexist on one device.** The same phone
that renders a Digital Wellbeing bar chart also exposes `UsageEvents`. iOS renders the chart and
exposes nothing. That asymmetry is a research design, not a footnote:

- On Android, the vendor aggregate can be **differenced against** every one of the four
  reconstruction bindings computed from the raw log on the same device, same window. The gap
  between "what Google says the number is" and "what each named method says it is" is directly
  measurable.
- That measured gap is the empirical warrant for the claim the iOS half of the paper needs:
  *a rendered vendor aggregate is not a neutral report of the same quantity a reconstruction
  produces — it is one more unlabelled binding.* Without the Android comparison that claim is an
  assertion; with it, it is a number.
- It also bounds the disaggregation error budget honestly. Sub-hour placement error is being
  measured against Android ground truth already; the Digital Wellbeing difference measures the
  error that is present *before* any disaggregation happens, in the hourly totals themselves.

Practical caveat, recorded so it is not discovered late: Digital Wellbeing has **no research API**.
It is obtained the same way iOS Screen Time is — participant screenshots — so the collection burden
and the OCR/annotation pipeline are the same, and any Android study collecting it inherits the iOS
pipeline's failure modes. The gain is that the ground truth exists on the same device, which it
never does on iOS.

**Status:** we hold no Digital Wellbeing data today. This is a design opportunity the ladder
exposes, not a claim about existing evidence. Flagged for the design discussion, not the dossier's
evidence sections.

### 7.2 The tools, verified

- **AWARE** — Ferreira, D., Kostakos, V., & Dey, A. K. (2015). *AWARE: Mobile Context
  Instrumentation Framework.* Frontiers in ICT 2:6. doi:10.3389/fict.2015.00006 — **VERIFIED
  (OpenAlex).** The framework underlying Jones et al. 2015; Ferreira and Kostakos are co-authors of
  both. The major open mobile-sensing instrumentation platform of this lineage and the right anchor
  citation for "self-developed research applications."

- **Jones, S., Ferreira, D., Hosio, S., Gonçalves, J., & Kostakos, V. (2015).** *Revisitation
  analysis of smartphone app use.* UbiComp '15. doi:10.1145/2750858.2807542 — **VERIFIED
  (Crossref; full author list confirmed via OpenAlex).** Note this is a *revisitation* analysis —
  the unit of interest is the return to an app, which is a sessionization-dependent construct.

- **Stachl, C., Au, Q., Schoedel, R., Gosling, S. D., Harari, G. M., Buschek, D., Völkel, S. T.,
  Schuwerk, T., et al. (2020).** *Predicting personality from patterns of behavior collected with
  smartphones.* PNAS 117(30). doi:10.1073/pnas.1920484117 — **VERIFIED (Crossref + OpenAlex,
  abstract read).** 624 volunteers, 30 consecutive days, **25,347,089 logging events**, six
  behavioral classes including app usage; PhoneStudy app. 320 citations.
  ⚠ **There is a published correction**: *Correction to Supporting Information for Stachl et al.*,
  PNAS 2021. doi:10.1073/pnas.2110330118 — **VERIFIED.** Cite the correction alongside the paper;
  its content has not been read and should be checked before relying on any SI-derived detail.

- **Wilcockson, T. D. W., Ellis, D. A., & Shaw, H. (2018).** *Determining Typical Smartphone Usage:
  What Data Do We Need?* Cyberpsychology, Behavior, and Social Networking 21(6).
  doi:10.1089/cyber.2017.0652 — **VERIFIED (Crossref + OpenAlex, abstract read).** 147 citations.

  **This one is directly useful ammunition.** Verified findings: usage collected for a minimum of
  **5 days** reflects typical weekly usage in hours, but **habitual checking behaviours can be
  reliably inferred within 2 days** — where a check is defined as **"uses lasting <15 seconds."**
  Neither measure correlated reliably with a self-report problematic-use scale.

  The 15-second cutoff is a **threshold definition of a behavioural construct, stated in passing and
  never justified** — a "check" exists because someone picked 15 seconds. It is the cleanest small
  example of the thesis available, it comes from a well-cited paper, and it sits at rung 2 where
  the analyst could not have chosen otherwise even if they wanted to. Pair it with Siebers et al.
  (§4.3) as the two published constructs that are entirely preprocessing artifacts.

- **Tóth, R., & Trifonova, T. (2021).** *Somebody's Watching Me: Smartphone Use Tracking and
  Reactivity.* Computers in Human Behavior Reports 4:100142. doi:10.1016/j.chbr.2021.100142 —
  **VERIFIED.** Note the author's name carries a diacritic (**Tóth**, per OpenAlex) which Crossref
  renders as "Toth"; use the accented form.

- **Kristensen et al. (2022)** — see §4.3. **Shaw et al. (2020)** and **Tkaczyk et al. (2024)** —
  see the verified bibliography; both already in the dossier.

### 7.3 "Toth, 2023" — RESOLVED

From the Winklbauer & Batinic reference list (p.41 of the PDF), verbatim:

> **Toth, R. (2023). One App to Assess Them All.** *Publizistik*, 68(2–3), 281–290.
> https://doi.org/10.1007/s11616-023-00788-6

A German-language communication-science journal article, which is why author/topic searches of
Crossref and OpenAlex in English kept missing it. Use the accented form **Tóth** in prose (see the
Tóth & Trifonova entry above); the Publizistik record renders it unaccented.

**Search lesson, recorded so it is not repeated:** three lanes burned effort triangulating this from
snippets across two sessions. The citing paper's own reference list is the authoritative record of
what the citing paper cited. Go to the primary document first; database search is the fallback, not
the entry point.

### 7.4 Citations recovered verbatim from the Winklbauer & Batinic reference list

Transcribed from pp.35–41 of the PDF. These are publisher-deposited strings from a preprint's own
bibliography — authoritative for *what they cited*, and each still worth a Crossref check before it
enters our bibliography, but not guesses.

**The two anchor method papers this repo's work descends from:**

- **Parry, D., & Toth, R. (2025).** *Extracting meaningful measures of smartphone usage from
  android event log data: A methodological primer.* **Computational Communication Research 7(1),
  1.** doi:10.5117/ccr2025.1.parr — the exact citation for the primer. Their system-app list is
  **183 identifiers** (per W&B p.13).
- **Schoedel, R., Oldemeier, M., Bonauer, L., & Sust, L. (2022).** *Systematic Categorisation of
  3,091 Smartphone Applications From a Large-Scale Smartphone Sensing Dataset.* Journal of Open
  Psychology Data 10(1), 7. doi:10.5334/jopd.59 — **1,197 system-app identifiers** (W&B p.13).

**Directly relevant, previously absent from the dossier:**

- **Zhu, J. J. H., Chen, H., Peng, T.-Q., Liu, X. F., & Dai, H. (2018).** *How to measure sessions
  of mobile phone use? Quantification, evaluation, and applications.* MMC 6(2):215–232.
  doi:10.1177/2050157917748351 — source of the threshold-based vs screen-based session dichotomy.
- **Langener, A. M., et al. (2024).** *It's All About Timing: Exploring Different Temporal
  Resolutions for Analyzing Digital-Phenotyping Data.* AMPPS 7(1). doi:10.1177/25152459231202677.
- **Baumgartner, S. E., Sumter, S. R., Petkevič, V., & Wiradhany, W. (2022).** *A Novel iOS Data
  Donation Approach.* SSCR 41(4):1456–1472. doi:10.1177/08944393211071068.
- **Lee, H., Park, J., & Lee, U. (2022).** *A Systematic Survey on Android API Usage for
  Data-driven Analytics with Smartphones.* ACM Computing Surveys 55(5):1–38. doi:10.1145/3530814 —
  the survey to cite for what the Android APIs actually expose.
- **Schoedel, R., & Mehl, M. (2024).** *Mobile sensing methods.* In Reis, West & Judd (Eds.),
  Handbook of research methods in social and personality psychology (3rd), pp. 297–321. Cambridge
  University Press. doi:10.1017/9781009170123.014.
- **Sust, L., Talaifar, S., & Stachl, C. (2023).** *Mobile application usage in psychological
  research.* In Mehl, Eid, Wrzus, Harari & Ebner-Priemer (Eds.), Mobile sensing in psychology:
  Methods and applications, pp. 184–214. Guilford Press.
- **Steegen, S., Tuerlinckx, F., Gelman, A., & Vanpaemel, W. (2016).** *Increasing Transparency
  Through a Multiverse Analysis.* PPS 11(5):702–712. doi:10.1177/1745691616658637 — the multiverse
  method itself.
- **Van Canneyt, S., Bron, M., Haines, A., & Lalmas, M. (2017).** *Describing Patterns and
  Disruptions in Large Scale Mobile App Usage Data.* WWW '17 Companion, 1579–1584.
  doi:10.1145/3041021.3051113 — source of the **10-second** session threshold, the shortest in use.
- **Böhmer, M., Hecht, B., Schöning, J., Krüger, A., & Bauer, G. (2011).** *Falling asleep with
  Angry Birds, Facebook and Kindle.* MobileHCI '11, 47–56. doi:10.1145/2037373.2037383 — origin of
  the **30-second** threshold that became the de facto default.
- **Kristensen, P. L., et al. (2022).** *Criterion validity of a research-based application for
  tracking screen time on android and iOS smartphones and tablets.* CHBR 5:100164.
  doi:10.1016/j.chbr.2021.100164 — already in §4.3; the full author list is now confirmed.

**Confirms an earlier correction:** Siebers, T., Beyens, I., & Valkenburg, P. M. (2023). *The
effects of fragmented and sticky smartphone use on distraction and task delay.* **MMC 12(1):45–70**,
doi:10.1177/20501579231193941 — matches the correction already applied to
`docs/workflow/prior-art-vocabulary.md` (12(1):45–70, not 12(2)).

---

## 8. Open verification debts

Resolve before anything here enters a bibliography.

**Must read in full (they constrain contribution claims):**
1. ~~Hooshyar et al. 2025, arXiv:2512.14425 — the occurrence/interval novelty threat.~~
   **DONE 2026-08-05 (pp. 1–10 of 25). NOT a threat — see §2.2, rewritten.** It is a process-mining
   metamodel paper; it gives events the *capacity* to carry an interval and never asks how the
   interval is derived. Borrow `gufo:QVAS` from it. Sections 6–8 unread and low priority.
2. ~~Winklbauer & Batinic 2026 full PDF~~ — **DONE 2026-08-05.** Read in full; §2.1 rewritten from
   the source document, §7.3 resolved from its reference list.
3. ~~ASTER Methods as "the one plausible home for a published discussion of Apple's
   aggregation"~~ — **DOWNGRADED 2026-08-05, see §2.4.** ASTER reads Apple's *output* store; it
   never documents Apple's rule. Still read the Methods, but only to name their cleaning rule as a
   fifth binding. §3.1's absence claim does not depend on it.
   Also add **Edwards, S. (2018), mac4n6.com, 6 August 2018** — the forensic documentation of
   `knowledgeC.db` that predates ASTER's technique by eight years, and the Biome migration
   (iOS 16 / macOS 13, 2022) that already moved the store once.
4. **Langener, A. M., Stulp, G., Jacobson, N. C., Costanzo, A., Jagesar, R. R., Kas, M. J., &
   Bringmann, L. F. (2024).** *It's All About Timing: Exploring Different Temporal Resolutions for
   Analyzing Digital-Phenotyping Data.* AMPPS 7(1). doi:10.1177/25152459231202677 — surfaced from
   the Winklbauer & Batinic reference list. **This is directly on the disaggregation question** —
   choice of temporal resolution in digital-phenotyping data — and was not in the dossier before.
   Read before writing the hourly→sub-hourly section.
5. **Baumgartner, S. E., Sumter, S. R., Petkevič, V., & Wiradhany, W. (2022).** *A Novel iOS Data
   Donation Approach: Automatic Processing, Compliance, and Reactivity in a Longitudinal Study.*
   SSCR 41(4):1456–1472. doi:10.1177/08944393211071068 — iOS screenshot/data-donation pipeline;
   the closest published relative of the `ios-screen-time-screenshot-processing` work.
6. **Zhu, J. J. H., Chen, H., Peng, T.-Q., Liu, X. F., & Dai, H. (2018).** *How to measure sessions
   of mobile phone use? Quantification, evaluation, and applications.* MMC 6(2):215–232.
   doi:10.1177/2050157917748351 — Winklbauer & Batinic lean on this for the threshold-based vs
   screen-based session dichotomy. That dichotomy is the ontology's core distinction; read the
   primary source rather than their summary of it.

**Citation details unconfirmed:**
- Cholette (1984), *Survey Methodology* 10(1):35–49 — no DOI located; likely has none.
- Müller-Thomy & Haberlandt (2020) — DOI verified, author list and page range not.
- Suriadi et al. (2017) — the eleven pattern names.
- Rowlands et al. (2018) — venue ambiguous between *MSSE* and *Sports Medicine*; PMID 29360664.
- Keadle et al. (2014); Migueles et al. (2017); the two accelerometry epoch-length papers cited in
  prose; SBP-BRiMS 2024 chapter author list (doi:10.1007/978-3-031-72241-7_8).
- Savage (1951), Manski (2004), Stoye (2009) for the minimax-regret lineage — none checked.
- Aczel et al. — DOI stem says 2025, OpenAlex dates it 2026-04; check the final issue.
- WWDC21 session 10123 — existence and presenter confirmed, content not. Watch the transcript
  before citing any claim about it.

**Paywall gaps:** LSE eprint for Asensio et al. (2025); PMC11681177 for Liu & Marciano pipeline
detail; the Kristensen et al. PDF for the −0.8 / 19.3 min/day figures.

**Null results that need one more pass before being asserted:**
- "No published study has used Apple's Screen Time API as a research instrument" — one search pass
  only; run a Scopus/Web of Science query on `DeviceActivity` + `FamilyControls` first.
- Whether Winklbauer & Batinic is under review and where.

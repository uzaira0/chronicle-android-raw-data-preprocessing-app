# Census reconciliation — all five lanes, one uniform rule

Purpose: the five lanes were audited by five agents with slightly different strictness, and their
entries sit at different rungs of the instrument ladder. Pooling their raw tallies would produce a
number that is not defensible. This file applies **one rule** to all 51 entries and reports the
result split by what the instrument could have declared.

Source of record: `lane-1.md` … `lane-5.md`. Nothing here is a new reading; every reassignment is
traceable to a field in those files.

Set: the 51 references of Winklbauer & Batinic (2026). **We did not choose this set** — that is
what makes the null result reportable.

---

## 1. Coverage

| | Count |
|---|---|
| Read in full (published, accepted-manuscript, or preprint) | **35** |
| Abstract or metadata only | **16** |
| **Total** | **51** |

Per lane: L1 6/10 · L2 7/10 · L3 7/11 · L4 7/10 · L5 8/10.

**An unread paper is undetermined, never silent.** Every count below carries its own denominator.

Two of the 16 are notable in themselves: entry 11 and entry 48 are recorded as open access
(`is_oa: true`, CC-BY in 48's case) and **no automated client can retrieve either**. Access
metadata at scale mis-scores both.

---

## 2. The uniform rule

> **Does the document state how raw device events become episodes with durations?**

Applied at two levels, because the instrument decides which level is even askable:

- **App level** — how a stream of per-app events becomes per-app episodes. Requires a Rung 3/4
  instrument that records app identity.
- **Device level** — how screen/power events become device sessions. Requires only an on/off pair.

Scoring: **DECLARED** = the rule is written down (prose, pseudo-code, or event-by-event).
**DELEGATED** = the rule provably exists elsewhere (vendor, named library) and is not stated.
**ABSENT** = nothing. **N/A** = no event log is held. **UNDET** = not read in full.

---

## 3. Denominators — who could have declared an app-level rule

Of 51 entries:

| Category | N | Why excluded from the app-level denominator |
|---|---|---|
| Not a measurement study (review, commentary, book, meta-analysis, handbook chapter) | 10 | Collects no data. Entries 2, 13, 24, 28, 31, 32, 34, 37, 40, 44 |
| Rung 1 — vendor aggregate, no event log ever held | 12 | The rule is Apple's or Google's and is *unavailable*, not merely undeclared |
| Rung 2 — screen on/off only, no app identity | 6 | An app-level rule is not expressible |
| Undetermined at abstract level, instrument unnamed | 7 | Cannot be scored either way |
| **Holds an app-level event stream (Rung 3 or 4)** | **16** | **This is the app-level denominator** |

---

## 4. Result

### App level — **2 of 16**

| Entry | What it declares | Kind |
|---|---|---|
| 33 · Parry & Toth (2025) | Nine steps, prose + figures + pseudo-code + R implementation + open sample data | **methodological primer, not a study** |
| 46 · Toth & Trifonova (2021) | Event by event: which `UsageEvents` types open and close a session, named individually | **empirical study** |

**Only one empirical study in 16 states how it turned app events into app episodes.**

The other 14 fail in four distinct ways, and the distinctions matter more than the count:

| Way of not declaring | N | Examples |
|---|---|---|
| Says the rule exists and refuses to state it | 1 | **Beierle et al. (2020)** — "a heuristic … including background app removal, detection, and imputation of missing events". 40,140,665 events → 1,826,060 sessions. No parameters, no appendix, no code. |
| Delegated to a vendor, never mentioned | 5 | **Wenz et al. (2024)** (Wakoopa SDK supplies "duration of any instance of use"); Cernat (respondi/bilendi); Festic (unnamed mobile vendor); Siebers (Ethica); Kasturiratna |
| Delegated to a named library by URL, not stated | 1 | **Hamilton et al. (2024)** — takes "sum duration" from RAPIDS by name |
| Absent — a duration appears and is never defined | 7 | **Stachl et al. (2020, PNAS)**; Schoedel et al. (2022); Langener et al. (2024); Toth (2023); Dekker; Jürgens; Deng |

### Device level — **5 of 7**

Entries 30, 42, 45, 50, 51 state or unambiguously imply the screen-on → screen-off pair; 51 alone
publishes an algorithm. Two do not.

**This split is the finding, not an artifact of it.** Where reconstruction is one unambiguous
pair, the field declares it. Where reconstruction requires a choice — which of ~46 event types
open and close an episode, what to do when the closing event never arrives — the field goes quiet.
Declarability collapses exactly where the degrees of freedom appear.

---

## 5. Session thresholds — **5 of 51**, and none of them is what W&B varied

| Entry | Value | Kind |
|---|---|---|
| 20 · Jones et al. | 30 s | pop-up suppression, justified by citation |
| 39 · Siebers et al. | 30 s | inactivity gap — **the only one**, with a five-point sensitivity analysis (0/10/30/60/90 s) that flipped a between-person effect |
| 45 · Tkaczyk et al. | 15 s | session-*length* classifier |
| 50 · Wilcockson et al. | 15 s | same classifier, same lineage |
| 46 · Toth & Trifonova | 5 h | maximum-session *cutoff* |

Every one is inherited by citation. Both 15 s figures trace to Andrews et al. (2015) — entry 45
cites entry 50, which cites Andrews. The 5 h cutoff is set by what "Andrews et al. (2015)
considered very long use." Entry 39 is the sole sensitivity analysis in 51 papers.

The 10 s figure attributed to Van Canneyt et al. (2017) is **attested second-hand only**, through
Zhu et al., whose verdict on the whole practice is four words: *"The threshold is arbitrarily
chosen."* (2018.)

---

## 6. Ladder distribution, pooled

| Rung | N | Note |
|---|---|---|
| 4 — raw platform event log, declared semantics | **5** | 4 Beierle, 33 P&T, 46 Toth & Trifonova, 47 Toth, 51 Zhu (device level) |
| 3 — app-level research app, semantics undeclared | 13 | |
| 2 — screen on/off only | 6 | |
| 1 — vendor aggregate | 12 | All iOS except two |
| N/A | 10 | |
| Undetermined | 5 | |

**Five entries out of fifty-one touch a raw platform event log and say what they did with it.**
One of those five is a primer with no data. One is a device-level logger with no app identity.

---

## 7. What goes in the paper

Report these, in this order:

1. **2 of 16 app-level; 1 of 16 if you require an empirical study.**
2. **5 of 7 at device level** — and say why the gap exists.
3. **1 sensitivity analysis in 51 papers** (entry 39).
4. **35 of 51 read in full; 16 undetermined**, stated before any ratio.

Do **not** report a single pooled "N of 51 declare" figure. It hides the mechanism, and the
mechanism is the argument.

---

## 8. Audit note on cherry-picking

The lane briefs asked agents to quote liberally and to report surprises. That is right for
*finding* evidence and wrong for *counting* it — a brief that rewards striking quotes biases
toward striking entries.

Two protections apply here:
- The **set was fixed by Winklbauer & Batinic**, not by us.
- The claim is a **null result**. A paper that declared its rule would have been the headline
  finding, and the briefs explicitly asked for exactly that. The incentive ran against the result.

The counts above come from the structured per-entry fields, not from the quoted passages.

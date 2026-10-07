# Search brief — find papers relevant to the screen-time reconstruction ontology

Copy everything below the line into a fresh agent. One agent per SLICE; give each agent exactly
one slice so they don't converge on the same results.

---

## Your job

Find published work — **2015 to August 2026**, with priority on 2020+ — relevant to a paper about
**how raw device event logs get turned into screen-time measures, and the fact that the field
almost never says which rule it used.**

You are looking for two things at once:

1. **Papers we must cite** — anyone who has actually confronted the event→episode step.
2. **Papers that threaten the contribution** — anyone who already did this. Finding one is a
   success, not a failure. Report it loudly.

### What "the event→episode step" means

Android's `UsageStatsManager` / `UsageEvents` API emits punctual timestamped events (`ACTIVITY_RESUMED`,
`ACTIVITY_PAUSED`, `ACTIVITY_STOPPED`, `SCREEN_INTERACTIVE`, `DEVICE_SHUTDOWN`, ~46 types total).
None of them is "the user used WhatsApp for 4 minutes." Turning the first into the second requires
a **rule**: which events open an episode, which close it, what happens when the closing event
never arrives, how long a gap is still the same session. Different published rules give different
numbers from identical raw data. That rule is the object of study.

iOS has the same problem in a harder form: `knowledgeC.db` / `App.InFocus`, Screen Time exports,
and the Screen Time UI itself all supply intervals whose construction rule Apple has never
documented.

---

## Hard rules

**Do not poison the well.** Do not search for tools or terms we already use. Searching
"Chronicle preprocessing" or "Parry Toth forward pairing" finds only what we already know.
Search the **problem**, not the solution.

- Bad: `"UsageEvents episode reconstruction"` — nobody calls it that; you'll find nothing and
  conclude wrongly that nothing exists.
- Good: `"how do researchers define a smartphone session"`, `"smartphone use duration
  measurement error"`, `"what counts as one app use"`.

**Run negation queries.** `"problems with screen time measurement"`, `"screen time data
considered harmful"`, `"why passive sensing fails"`, `"limitations of smartphone log data"`.

**Vary phrasing by source.** Do not paste the same string into every engine.

**Search adjacent fields.** The same problem exists, sometimes solved, in: web analytics
sessionization, clickstream segmentation, process mining (event-log → case), activity recognition
from wearables, GPS staypoint detection, EEG/actigraphy epoch definition, telephony CDR session
inference. **Borrowing a solved formulation from one of these is a high-value find.**

**No browser automation.** `WebFetch` and `curl` only. If a page 403s or needs JavaScript, record
it as unavailable — that is a finding, not a failure. Do not launch Playwright, Chrome, or any
driver.

**Never guess a value.** If you cannot read the full text, say "abstract only" and stop. An
undetermined paper is undetermined, never silent.

---

## Slices — take exactly one

**SLICE A — Android event-log methodology.** Papers that read `UsageEvents`/`UsageStats` directly
and say what they did with the event constants. Also: AOSP behavior documentation, Stack Overflow
canonical answers, and any R/Python package that implements a reconstruction (search package
registries, not just papers).

**SLICE B — iOS.** `knowledgeC.db`, `App.InFocus`, SEGB/biome files, Screen Time API, the
`DeviceActivity` framework, Screen Time data-donation studies, forensic-analysis literature
(digital forensics found this stream years before psychology did). Include the iOS 26 export
question: does Apple now let users export granular Screen Time data, and from which release?

**SLICE C — sessionization outside mobile.** Web analytics, clickstream, process mining, CDR.
Find the formalisms. We want the ones with named algorithms and evaluation, not the ones that
assert a 30-minute timeout.

**SLICE D — measurement theory and multiverse.** Researcher degrees of freedom in preprocessing;
multiverse/specification-curve analysis applied *below* the analysis layer; reliability of derived
behavioral measures; validity of vendor-supplied aggregates. Also: anyone who has argued that a
preprocessing choice should be reported as a measurement decision.

**SLICE E — ontology and formal representation.** Event ontologies with temporal extent (UFO-B,
gUFO, `gufo:QVAS`, Allen interval algebra applied to behavioral logs), process-mining metamodels,
provenance models (PROV-O) applied to derived measurements, and any existing ontology of
device-usage or screen-time concepts.

**SLICE F — self-report vs logged discrepancy.** Large literature. Look specifically for papers
that attribute part of the discrepancy to the *processing* rather than to human recall — that
attribution is rare and each instance is valuable.

---

## For every paper you keep, record exactly these fields

```
## <n>. Authors (year) — Title

- **Why it matters here.** One sentence. If it is a citation-threat, say so first.
- **Instrument and ladder rung.** Rung 4 = raw platform event log with declared semantics;
  Rung 3 = app-level event-logging research app; Rung 2 = screen on/off only;
  Rung 1 = vendor aggregate (Screen Time, Digital Wellbeing, battery stats). N/A if no data.
- **Episode reconstruction rule.** DECLARED (quote it) / DELEGATED (to whom) / ABSENT / N/A /
  UNDETERMINED (not read in full).
- **Session threshold.** Value, kind (inactivity gap vs length classifier vs max cutoff), and the
  verbatim justification. If it is justified only by a citation, name the cited work — we are
  tracing threshold provenance and inheritance chains are the finding.
- **Availability.** Data? Code? Is the event→episode step re-runnable by a third party?
- **Access.** Full text / accepted manuscript / preprint / abstract only / metadata only, and by
  what route.
```

Quote verbatim, with location. A paraphrase is not evidence.

---

## Report at the end

- Total found, total read in full, total abstract-only.
- **Citation threats, ranked.** Anyone close to our contribution.
- **Anything that contradicts us.** A paper that *does* declare its rule is the most useful thing
  you can bring back. Do not soften it.
- **Three things you expected and did not find.** Absences are data.
- Dead ends: what you searched that returned nothing, so the next agent doesn't repeat it.

Write to `docs/paper/search-briefs/results-slice-<X>.md`. Touch no other file.

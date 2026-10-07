# Results — SLICE E: ontology and formal representation

> **Independent expansions (2026-08-05 and 2026-08-06):** Two broad passes retained **94 internally deduplicated sources** across event/interval ontologies, executable rule languages, measurement standards, provenance, and direct smartphone/wearable semantic pipelines. E77–E94 are 18 repo-wide-new records; overlapping citations across passes must not be counted twice.

Scope executed: event ontologies with temporal extent (UFO-B, gUFO, `gufo:QVAS`, ISO/IEC 21838-5,
Allen interval algebra applied to behavioural logs), process-mining metamodels, PROV-O applied to
derived measurements, and any existing ontology of device-usage / screen-time concepts.

Method: WebSearch + WebFetch + `curl` only. No browser automation was used at any point. Where a
publisher blocked retrieval I say so and give the route I used instead, or mark the source
UNDETERMINED. Every quoted string below was extracted by me from a file I downloaded and read,
**except** the four entries explicitly marked `via WebFetch extraction` or `metadata only` — those
quotes come from the fetch tool's reading of the page and I have not verified them against raw
bytes, so treat them as second-hand.

Downloaded artifacts are in `~/Scripts/scratch/slice-E-refs/` (outside this repo).

---

## Direct answer to the question that was asked

**Question: does any published ontology already model "a measurement derived from punctual events
under a declared reconstruction rule"?**

**No — not as a single named construct. But every component of it exists, in four separate
communities, and one ontology (IoT-Stream) comes uncomfortably close.** Ranked by closeness:

1. **IoT-Stream (Elsaleh et al. 2020)** — closest. It has `derivedFrom` between streams, an
   `Analytics` class carrying `methods` / `parameters` / `paramValues`, and a `StreamObservation`
   with `windowStart` / `windowEnd`. It states outright that the producing method **must be
   declared**. What it does not have: typed punctual events with open/close roles, any notion of a
   terminator that never arrives, or a rule with internal structure (its `methods` is a vector of
   strings).
2. **SOSA/SSN and OBOE** — the generic pattern "measurement + the procedure that produced it" is
   already normative and standardised (`sosa:usedProcedure`, `oboe:measuresUsingProtocol`). But
   `Procedure` / `Protocol` are opaque: no internal structure, no event-log input, and SOSA's input
   is a physical `Stimulus`, not prior data.
3. **IAO/OBI** — `measurement datum` + `data transformation` + `plan specification` expresses
   "output datum produced by a process that realizes a declared plan" in full generality, with zero
   temporal-episode machinery and no model of the plan's content.
4. **gUFO / UFO-B / gOCED** — has exactly the target temporal machinery (events with begin/end
   points, Allen relations, `QVAS` holding over an interval) and **explicitly identifies the
   reconstruction problem** — then solves it by recording intervals directly so they need not be
   reconstructed. No representation of a reconstruction rule, and no link from a derived interval
   back to the events it was inferred from.
5. **HED** — the only standard found that names the punctual-marker-vs-extended-event confusion
   out loud, and gives a declared mechanism (`Onset` / `Offset` on a `Def`) for pairing markers into
   an extended event. But the pairing rule is fixed by the standard, not declared per study, and no
   measurement is derived.

So the specific construct — *a derived interval-valued measure over a typed punctual event log,
carrying the reconstruction rule (including its failure branches) as a first-class declared entity*
— is not in the published record I could reach. The contribution survives. What does **not**
survive is any claim that "nobody has thought about declaring the rule": IoT-Stream requires it for
streams, V3 requires it for clinical sensor measures, and OBOE/SOSA require a procedure reference
for every measurement. The paper must position against those, not ignore them.

---

## Entries

### 1. Hooshyar, Fumagalli, Montali, Guizzardi (2025, rev. 2026) — Time and Relations into Focus: Ontological Foundations of Object-Centric Event Data

- **Why it matters here.** **Citation threat, highest in this slice.** It is the only work found
  that grounds an event-data metamodel in a foundational ontology *and* explicitly names the
  interval-reconstruction-from-punctual-events problem — though it dissolves the problem rather
  than formalising the rule. Verbatim, §6: "gOCED also enables the explicit specification of time
  intervals for O2O relationships (and any other concrete individuals). Therefore, the start and
  end times of Supervision instances can be directly defined, **without needing to reconstruct
  these periods from a sequence of events**." And on the status quo it is replacing: "determining
  the time interval during which a value v1 was valid requires assuming that its validity starts at
  time t1 and ends when the subsequent value of the same attribute, v2, is observed at time t2.
  Consequently, computing the validity interval of v1 relies on knowing t1, the subsequent value
  v2, and its timestamp t2." That is our forward-pairing rule, stated as an ontological defect.
  It also records what OCEL V2 does instead: "To represent activity instances spanning a duration,
  the author suggests using separate start and end events or adding a duration attribute."
- **Instrument and ladder rung.** N/A — no data.
- **Episode reconstruction rule.** ABSENT as a modelled entity. The paper's position is that
  intervals should be *given*, not derived; it therefore has no construct for the rule, no
  provenance edge from interval back to constituent events, and no failure branch for a missing
  end event.
- **Session threshold.** N/A.
- **Availability.** No data or code artifact linked in the HTML I read. gOCED is presented as a
  metamodel, not a published OWL file.
- **Access.** Full text read (arXiv HTML v1, `arxiv.org/html/2512.14425v1`, extracted to text and
  read in full). Abstract also confirmed via `arxiv.org/abs/2512.14425`. arXiv:2512.14425,
  cs.DB, submitted 16 Dec 2025, revised 23 Mar 2026. Affiliations in the HTML are Free University
  of Bozen-Bolzano and University of Twente.

### 2. Benevides, Bourguet, Guizzardi, Peñaloza (2017) — Representing the UFO-B Foundational Ontology of Events in SROIQ

- **Why it matters here.** The citable formal source for UFO-B's temporal-extent axioms, and it
  documents a limitation that matters to us: Allen relations cannot be fully expressed in the
  decidable fragment. §2.4 verbatim: "[1, T7–T13] formalizes the temporal Allen relations [7]. Also,
  the set of time points is totally ordered by the relation precedes [1, T1–T4], and the temporal
  extent of an event (improperly) includes the temporal extent of all the (proper) parts of the
  event [1, T14]." And: "[8] discusses the impossibility of expressing the Allen's time interval
  relations [7] in SROIQ. The best we can do is to provide partial axiomatizations of UFO-B's
  temporal relations between events." Axiom T5' verbatim:
  "∀e:Event∃!t,t′:TimePoint(beginPoint(e,t) ∧ endPoint(e,t′))" — i.e. **every** UFO-B event has
  exactly one begin and one end point. UFO-B cannot represent an event whose end is unknown, which
  is precisely the End-of-Usage-Missing case. That is a real modelling gap for us to name.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A — foundational ontology, no derivation from logs.
- **Session threshold.** N/A.
- **Availability.** OWL 2 DL TBoxes reported as produced and validated against Alloy models; no URL
  captured in the section I read.
- **Access.** Full text read (PDF from `ceur-ws.org/Vol-2050/FOUST_paper_7.pdf`, converted with
  `pdftotext` and read). CEUR-WS Vol-2050, FOUST (Joint Ontology Workshops / FOIS workshop series).

### 3. Almeida, Guizzardi, Sales, Fonseca — gUFO: A Gentle Foundational Ontology for Semantic Web Knowledge Graphs (2026) + the gUFO ontology artifact

- **Why it matters here.** `gufo:QualityValueAttributionSituation` (QVAS) is the nearest existing
  construct to "an interval-valued derived attribute", and it is the construct gOCED builds on.
  From `gufo.ttl` (line 1186 ff., `rdfs:comment` on the class): "A gufo:QualityValueAttributionSituation
  should be used only for mutable qualities, i.e. those whose value can vary in time." And on
  `gufo:Situation` (line 1275 ff.): "Note that, in Guizzardi et al. (2013), situations were
  considered to obtain at a specific point in time. Here, instead, they obtain in a time interval
  when begin and end points differ." On `gufo:hasBeginPoint` (line 258 ff.): "In the case of
  endurants, this identifies the time point when the endurant comes into existence. In the case of
  events, this identifies the time point when the event starts to take place. In the case of
  situation, this identifies the time point when the situation begins to hold." **Crucially, QVAS
  has no property recording how the value or the interval boundaries were obtained** — the class's
  only structural properties are `concernsQualityType`, `concernsQualityValue` /
  `concernsReifiedQualityValue`, plus the generic begin/end points. That absence is the hole our
  work fills.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** ABSENT — no derivation construct exists in gUFO.
- **Session threshold.** N/A.
- **Availability.** Ontology file public and machine-readable: `gufo.ttl` from
  `github.com/nemo-ufes/gufo` (read in full, 101 KB), documentation at `nemo-ufes.github.io/gufo/`
  (downloaded, 227 KB).
- **Access.** Ontology artifact read directly. Paper: **abstract only**, verbatim via WebFetch on
  `arxiv.org/abs/2603.20948`, submitted 21 March 2026 — "gUFO is a lightweight implementation of the
  Unified Foundational Ontology (UFO) suitable for Semantic Web OWL 2 DL applications… Moreover, it
  is currently in the process of standardization by the International Organization for
  Standardization as the ISO/IEC CD 21838-5." I did not read the paper body.

### 4. ISO/IEC DIS 21838-5 — Information technology — Top level ontologies (TLO) — Part 5: Unified Foundational Ontology (UFO)

- **Why it matters here.** If we ground the paper's event model in UFO-B, this is the standards
  citation and it is live, not hypothetical. Note the version drift in the sources: the gUFO paper
  abstract (Mar 2026) says "ISO/IEC **CD** 21838-5"; gOCED says "the upcoming ISO/IEC CD 21838-5";
  the standards resellers now list it at **DIS**, stage 40.20 (DIS ballot initiated, 12 weeks),
  under ISO/IEC JTC 1/SC 32. Cite the stage, not a publication year — it is not published.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** Paywalled standard; not read.
- **Access.** **Metadata only.** `iso.org/standard/89915.html` returned **HTTP 403 to `curl`** —
  recorded as unavailable. Title and stage taken from `genorma.com/en/standards/iso-iec-dis-21838-5`
  via WebFetch extraction (title "Information technology — Top level ontologies (TLO) — Part 5:
  Unified Foundational Ontology (UFO)", stage 40.20, date given there as 8 June 2026, owner ISO/IEC
  JTC 1/SC 32). A second search result reported DIS registration 9 April 2026. I could not
  reconcile the two dates from a primary source; both are recorded, neither is asserted.

### 5. Haller, Janowicz, Cox, Lefrançois, Taylor et al. — Semantic Sensor Network Ontology (W3C Recommendation) + SOSA

- **Why it matters here.** **This is the standardised general form of our claim, and it predates us
  by a decade.** `sosa:Observation` verbatim (§4.2.1 of the spec text I extracted): "Act of carrying
  out an (Observation) Procedure to estimate or calculate a value of a property of a
  FeatureOfInterest." `sosa:Procedure` verbatim (§4.8.2.1): "A workflow, protocol, plan, algorithm,
  or computational method specifying how to make an Observation, create a Sample, or make a change
  to the state of the world (via an Actuator). A Procedure is re-usable, and might be involved in
  many Observations, Samplings, or Actuations. **It explains the steps to be carried out to arrive
  at reproducible Results.**" `sosa:usedProcedure` (§4.8.2.2): "A relation to link to a re-usable
  Procedure used in making an Observation, an Actuation, or a Sample, typically through a Sensor,
  Actuator or Sampler." The spec also aligns Procedure to PROV: "sp:hadProcedure subproperty of
  prov:hadPlan, range sosa:Procedure", with "sosa:usedProcedure property chain axiom
  [sp:eventAssociation, sp:hadProcedure]".
  What SOSA does **not** give us: the input to an Observation is `ssn:Stimulus` — "An event in the
  real world that 'triggers' the Sensor" — i.e. a physical trigger, not a prior log of typed
  punctual records; there is no `derivedFrom` between Observations (the only derivation vocabulary
  is borrowed from PROV); and `Procedure` has no internal structure beyond `ssn:hasInput` /
  `ssn:hasOutput` / `ssn:implementedBy`.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** DELEGATED, by construction — to whatever `sosa:Procedure`
  instance an application declares. The ontology mandates that a procedure be nameable; it says
  nothing about what is in it.
- **Session threshold.** N/A.
- **Availability.** Public W3C/OGC standard, machine-readable ontology.
- **Access.** Full spec read (`w3.org/TR/vocab-ssn/`, 673 KB HTML, extracted to 194 KB text and
  searched). Companion read: **Extensions to the SSN Ontology** (`w3.org/TR/vocab-ssn-ext/`) —
  `sosa:ObservationCollection` with `sosa:usedProcedure max 1`, and an explicit OBOE alignment:
  "The ObservationCollection supports the full encoding of an oboe:Observation, which is a
  collection of oboe:Measurements concerning a common oboe:Entity."

### 6. OBOE — The Extensible Observation Ontology (NCEAS; oboe-core 1.2)

- **Why it matters here.** OBOE is the strongest existing statement that *a measurement is not
  complete without its protocol*. Verbatim `rdfs:comment` on `oboe:Measurement`: "A measurement is
  an assertion that a characteristic of an entity had a particular value with respect to an
  observation event. **A measurement is comprised of a characteristic, a value, a measurement
  standard, and a protocol.** Measurements can also have precision as well as a description of the
  methods used." And `oboe:Protocol`, in full: "**A protocol is a procedure for generating or
  processing data.**" That one-line definition is the whole of it — the object property
  `oboe:measuresUsingProtocol` exists, but Protocol is otherwise unstructured. `oboe:Observation`:
  "An observation is an assertion that an entity … was observed by an observer. An observation
  primarily serves to group a set of measurements together into a single 'observation event'."
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** DELEGATED to an unstructured `Protocol` instance.
- **Session threshold.** N/A.
- **Availability.** Public OWL: `raw.githubusercontent.com/NCEAS/oboe/master/oboe-core.owl`.
- **Access.** Ontology artifact read directly (69 KB OWL; class comments extracted verbatim). The
  companion paper (Bowers et al., *Ecological Informatics*) was **not** read — UNDETERMINED.

### 7. Lebo, Sahoo, McGuinness et al. — PROV-O: The PROV Ontology (W3C Recommendation)

- **Why it matters here.** PROV is the obvious home for "this measure was derived from that log by
  that rule", and the spec is explicit that it stops short of modelling the rule.
  `prov:Derivation` verbatim: "A derivation is a transformation of an entity into another, an update
  of an entity resulting in a new one, or the construction of a new entity based on a pre-existing
  entity." `prov:Plan` verbatim: "A plan is an entity that represents a set of actions or steps
  intended by one or more agents to achieve some goals." And the decisive sentence, §3 on qualified
  association: "the plan of actions and steps that the Agent used to achieve its goals is provided
  using the prov:hadPlan property and an instance of prov:Plan… **Both prov:Plan and prov:Role are
  left to be extended by applications.**" So the standard hands the reconstruction-rule slot to us
  deliberately empty. Any claim we make about PROV must be "we supply the domain extension PROV
  leaves open", not "PROV lacks this".
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** ABSENT by design; the slot (`prov:Plan`) is present and empty.
- **Session threshold.** N/A.
- **Availability.** Public W3C standard.
- **Access.** Full spec read (`w3.org/TR/prov-o/`, 464 KB HTML, extracted to 193 KB text and
  searched).

### 8. Cox, Little — Time Ontology in OWL (W3C Recommendation)

- **Why it matters here.** This is the citable OWL implementation of Allen, and it is the reason we
  can put Allen relations on episodes without inventing vocabulary. Verbatim §3.1: "The basic
  structure of the ontology is based on an algebra of binary relations on intervals (e.g., meets,
  overlaps, during) developed by Allen [al-84], [af-97] for representing qualitative temporal
  information, and to address the problem of reasoning about such information." And §4.1: "Fifteen
  properties :intervalBefore, :intervalAfter, :intervalMeets, :intervalMetBy, :intervalOverlaps,
  :intervalOverlappedBy, :intervalStarts, :intervalStartedBy, :intervalDuring, :intervalContains,
  :intervalFinishes, :intervalFinishedBy, :intervalEquals :intervalDisjoint :intervalIn support the
  set of interval relations defined by Allen [al-84] and Allen and Ferguson [af-97]." Note it also
  contains a section aligning PROV-O with OWL-Time — relevant if we express episodes as
  PROV entities with OWL-Time extents.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** Public W3C standard.
- **Access.** Full spec read (`w3.org/TR/owl-time/`, 265 KB HTML, extracted and searched).
  Allen (1983/1984) and Allen & Ferguson (1997) are cited *through* this spec and UFO-B; I did not
  fetch Allen's originals — mark them UNDETERMINED if we quote them.

### 9. Elsaleh, Enshaeifar, Rezvani, Acton, Janeiko, Bermudez-Edo (2020) — IoT-Stream: A Lightweight Ontology for Internet of Things Data Streams and Its Use with Data Analytics and Event Detection Services

- **Why it matters here.** **This is the closest existing formal work to our contribution and it
  must be cited and distinguished in the paper's related-work section.** It is a published ontology
  in which a derived, interval-bearing observation carries the declared method and parameters that
  produced it. Verbatim, §3.2: "StreamObservations that belongTo IotStreams can be either the output
  of sensor readings, or the output of an Analytics process. In the case where IotStreams are
  analysedBy a data analytics process, the Analytics class captures the methods from data analysis
  techniques applied on the IotStream. It can be a single process or a cascade of processes, and
  hence is represented as a vector string with the data properties methods parameters and
  paramValues." On intervals: "the sosa:Observation class has been extended with a subclass,
  StreamObservation, to include direct datatype properties for representing temporal windows. These
  are captured in the data properties windowStart and windowEnd, which represent the start and the
  end of the window, respectively." And the declaration requirement, §4: "**When IotStreams are
  derived from another IotStream, the Analytics applied, i.e., the methods and their corresponding
  parameters need to be declared and annotated.**"
  Where it stops short of us: input is a numeric stream, not a typed punctual event log; `methods`
  is an opaque string vector with no semantics for which event opens or closes an interval; no
  representation of a missing terminator, a fallback closer, or a maximum-duration cutoff; and the
  derived `Event` class is a detection label, not a measure.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** **DECLARED — in the sense that the ontology requires the
  producing method and parameters be recorded, but does not model the rule's content.** This is the
  single most important nuance in this slice.
- **Session threshold.** N/A (windows are declared per instance, no default asserted in the text I
  read).
- **Availability.** Ontology and tooling described as public in the paper; four classes, five object
  properties, eight datatype properties in the core model.
- **Access.** Full text read. **MDPI blocked direct retrieval — `mdpi.com/1424-8220/20/4/953`
  returned HTTP 403 to both WebFetch and `curl`.** Retrieved instead via Europe PMC full-text XML
  for PMC7071512 (139 KB), converted to text and read. *Sensors* 20(4):953, doi
  10.3390/s20040953, PMID 32053898.

### 10. SAO — Stream Annotation Ontology (Kolozali et al.)

- **Why it matters here.** IoT-Stream describes SAO as the prior art that already combined PROV-O
  with SSN for streams — i.e. someone may have joined provenance to stream segments before 2020.
  Reported in IoT-Stream §2 verbatim: "SAO has been built on top of some well-known ontologies to
  represent IoT data streams: TimeLine [15], PROV-O [21], SSN [6], and Event Ontology [15].
  StreamData, StreamEvent, StreamAnalysis, Observation, Sensor, and Segment concepts enable this
  ontology to describe temporal concepts accurately. With StreamData class, SAO can provide a
  stream data as a temporal point or segment and it describes the output of the observation as an
  event with StreamEvent class [8]."
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** **UNDETERMINED.**
- **Session threshold.** N/A.
- **Availability.** UNDETERMINED.
- **Access.** **Not read — known only through IoT-Stream's related-work description.** This is the
  highest-value unread lead in the slice: an ontology with `Segment`, `StreamAnalysis` and PROV-O
  together is structurally very close to us. **Next agent should read SAO directly.**

### 11. Graß, Deshmukh (2024) — SemTS: The Semantic Time Series Ontology, v1.2.0

- **Why it matters here.** Has a first-class `TimeSeriesSegment` but, per the fetch, no first-class
  segmentation rule — a useful "the obvious thing was not done" data point. Quoted via WebFetch
  extraction: `TimeSeriesSegment` = "Represents a segment (also referred to as slice) of a uni- or
  multivariate time series. Any segment can correspond to the whole time series, a subintervall
  potentially further limited to a subset of dimensions or only to a single data point."; and a
  `KnowledgeGenerationEntity` = "the highest entity to define the process of knowledge generation."
  The fetch's assessment: the ontology "does not explicitly record segmentation rules as first-class
  entities."
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** ABSENT (per fetch; not independently verified against the OWL
  file).
- **Session threshold.** N/A.
- **Availability.** GitHub-hosted ontology; no peer-reviewed publication found on the doc page.
- **Access.** **Documentation page via WebFetch extraction only** —
  `semts-ontology.github.io/SemTS/ontology/current/index.html`, released 13 December 2024. I did not
  download and parse the OWL file. Treat the "no rule" finding as provisional.

### 12. IAO / OBI — `measurement datum`, `data transformation`, `plan specification`

- **Why it matters here.** The OBO Foundry answer to "a datum produced by a declared procedure",
  and the most general one available. Verbatim definitions retrieved from the EBI OLS4 API:
  `IAO:0000109` measurement datum — "A measurement datum is an information content entity that is a
  recording of the output of a measurement such as produced by a device."; `OBI:0200000` data
  transformation — "**A completely executed planned process that produces output data from input
  data.**"; `IAO:0000104` plan specification — "A directive information entity with action
  specifications and objective specifications as parts, and that may be concretized as a realizable
  entity that, if realized, is realized in a process in which the bearer tries to achieve the
  objectives by taking the actions specified."; `OBI:0000070` assay — "A planned process that has
  the objective to produce information about a material entity (the evaluant) by examining it."
  Composed, these say: *a derived datum is the specified output of a data transformation realizing a
  concretized plan specification.* That is our sentence, minus all the temporal structure and minus
  any model of what the plan says. Note the IAO plan-specification entry carries an unresolved
  editor note from 2009 flagging that action/conditional specifications are "not well enough
  specified" — the OBO stack has known this slot is thin for fifteen years.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** DELEGATED to an unstructured plan specification.
- **Session threshold.** N/A.
- **Availability.** Public OBO ontologies.
- **Access.** Term definitions read directly from the EBI OLS4 REST API (`ebi.ac.uk/ols4/api/search`,
  ontologies iao/obi/bfo). Underlying papers not read.

### 13. IEEE 1849 (XES) — `lifecycle:transition`

- **Why it matters here.** The single most widely deployed *implicit* reconstruction rule in the
  adjacent field: an activity instance is the pairing of a `start` event with a `complete` event on
  the same activity. The convention is normative in a standard, and the standard says nothing about
  what to do when the `complete` never arrives — the same silence we are documenting for Android.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** DECLARED-BY-CONVENTION (start/complete pairing), failure branch
  ABSENT.
- **Session threshold.** N/A.
- **Availability.** IEEE Std 1849-2016, superseded by IEEE Std 1849-2023.
- **Access.** **Not read — secondary descriptions only** (search results citing the XES lifecycle
  extension and the IEEE 1849 publication/revision dates). I did not obtain the standard text.
  **UNDETERMINED** on the exact normative wording. Anyone quoting the lifecycle model must get the
  standard first.

### 14. Fahland, Montali, Lebherz, van der Aalst et al. (2024) — Towards a Simple and Extensible Standard for Object-Centric Event Data (OCED) — Core Model, Design Space, and Lessons Learned

- **Why it matters here.** The community's in-progress event-data standard, and the target gOCED
  criticises. gOCED reports its position verbatim (gOCED §2, challenge C2): "According to the Core
  Model, events are punctual and associated to a single time point. However, in real-world
  scenarios, events can be complex and span a duration." And on OCEL V2: "In this model, events
  continue to be atomic, and E2E relations are still not supported. To represent activity instances
  spanning a duration, the author suggests using separate start and end events or adding a duration
  attribute."
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** ABSENT (events are punctual by definition; duration is left to
  a convention or an attribute).
- **Session threshold.** N/A.
- **Availability.** arXiv report; OCEL 2.0 has public exchange formats (SQLite/XML/JSON) per
  `ocel-standard.org`.
- **Access.** **Abstract only**, via WebFetch on `arxiv.org/abs/2410.14495` — the fetch explicitly
  reported it could not see the body. All statements about the Core Model's treatment of duration
  above are **quoted from gOCED's reading of it**, not from the report itself. Read the report
  before citing it for that claim.

### 15. van Zelst, Mannhardt, de Leoni, Koschmider (2021) — Event abstraction in process mining: literature review and taxonomy

- **Why it matters here.** The canonical survey of "low-level events do not match the activities
  people mean" — the exact shape of our problem in the adjacent field, with a taxonomy of solutions.
  Abstract verbatim: "Most process mining techniques assume that the event data are of the same
  and/or appropriate level of granularity. However, in practice, the data are extracted from
  different systems … record the events at different granularity levels."
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A — it surveys reconstruction *algorithms*; the survey's
  framing is that abstraction is a modelling choice, not that it should be declared as a
  measurement decision.
- **Session threshold.** N/A.
- **Availability.** Open access (CC-BY).
- **Access.** PDF downloaded from `d-nb.info/1238523943/34` and converted; **abstract and structure
  read, body skimmed by keyword only** — I did not read all 18 pages. *Granular Computing*
  6(3):719–736, doi 10.1007/s41066-020-00226-2.

### 16. Liu, Stein Dani, Beerepoot, Lu (2023) — Turning Logs into Lumber: Preprocessing Tasks in Process Mining

- **Why it matters here.** A direct, quotable statement that the preprocessing layer is undeclared
  in the adjacent field. Abstract verbatim: "Despite the recognized importance, the execution of
  preprocessing tasks remains **ad-hoc, lacking support**." Body: "Despite the acknowledgment, the
  execution of log preprocessing seems to remain ad-hoc. Moreover, little support has been provided
  on which preprocessing tasks are possible and how to select them." This is the process-mining
  analogue of our central claim and it is worth quoting as convergent evidence from another field.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** arXiv preprint; also in Springer LNBIP (10.1007/978-3-031-56107-8_8).
- **Access.** Full text read (`arxiv.org/html/2309.17100`, extracted to text). Utrecht University.

### 17. Robbins, Truong, Appelhoff, Delorme, Makeig (2021) — Capturing the nature of events and event context using Hierarchical Event Descriptors (HED)

- **Why it matters here.** **The only source found that names our exact conceptual error in
  print**, and it does so as part of a deployed annotation standard. Verbatim: "In neuroimaging
  time-series recordings, metadata, experiment events are typically recorded using event markers
  … that each mark the time of some phase transition or other point of interest in the unfolding
  event or event process (most often, time of onset). **Unfortunately, in practice these event
  markers are often themselves labelled and referred to as 'events', risking conceptual
  confusion.** Each event marker designates a single time point … To be useful, the event marker
  must be associated with metadata that includes information about the type of event phase
  transition it marks, a reference to the ongoing event process it marks, as well as a description
  of the nature of that event. … Event markers of later phase transitions in the event (e.g., its
  offset) need not repeat this description if they include an unequivocal reference to the event."
  And the mechanism, verbatim: "the researcher can annotate the event marking the start of the
  movie with (Def/Play-movie, Onset) and the event marking the end of the movie with
  (Def/Play-movie, Offset)." Also: "HED user definitions also play an integral role in assisting
  data authors in documenting experiment architecture, **event temporal extent**, and other dataset
  aspects." HED is the event-annotation mechanism used by BIDS.
- **Instrument and ladder rung.** N/A (EEG/MEG/behavioural time series, not device logs).
- **Episode reconstruction rule.** **DECLARED, at the annotation layer, by a fixed standard
  convention** — `Onset`/`Offset` on a named `Def` pairs punctual markers into an extended event.
  What is not declarable: what to do when the `Offset` marker is absent, or any parameterised gap
  tolerance. The rule is the standard's, not the study's.
- **Session threshold.** N/A.
- **Availability.** Open standard with public schema, validators, and tooling; used by BIDS.
- **Access.** Full preprint read (bioRxiv PDF, doi 10.1101/2021.05.06.442841, version posted 18 Nov
  2021, CC-BY, converted with `pdftotext`). The peer-reviewed version is in *NeuroImage* (2021);
  I read the preprint, not the journal version. The HED specification itself was **not** read —
  `hed-specification.readthedocs.io` returned **HTTP 429**, and the GitHub code-search API required
  authentication. The normative `Temporal-scope` section is therefore UNDETERMINED.

### 18. Goldsack, Coravos, Bakker, Bent, Dowling, Fitzer-Attas, Godfrey, Godino, Gujar, Izmailova, Manta, Peterson, Vandendriessche, Wood, Wang, Dunn (2020) — Verification, analytical validation, and clinical validation (V3): the foundation of determining fit-for-purpose for Biometric Monitoring Technologies (BioMeTs)

- **Why it matters here.** **Partial contradiction of any "nobody says the algorithm matters" claim.**
  This is a widely adopted framework whose entire middle pillar is the algorithm that turns raw
  sensor samples into a measure. Verbatim: "BioMeTs are connected digital medicine products that
  process data captured by mobile sensors **using algorithms** to generate measures of behavioral
  and/or physiological function."; "in this manuscript we use the term 'algorithm' to describe a
  range of data manipulation processes embedded in firmware and software, including but not limited
  to signal processing, data compression and decompression, artificial intelligence, and machine
  learning."; "All digital measurements reported by BioMeTs are derived through a **data supply
  chain**, which includes hardware, firmware, and software components."; "Each of these steps along
  the data supply chain has to be verified before the resulting measurement can be validated in a
  given population under specified conditions." Figure 2 is titled "The 'Raw' data dilemma:
  defining sample-level data in the data supply chain in a uniaxial MEMS accelerometer" and
  "illustrates that 'raw' data coul[d]" mean different things at different points — the same
  ambiguity we attack for event logs.
  Distinction to draw: V3 is a *validation* framework for physiological measures against a
  reference standard. It has no formal representation, no ontology, and it does not address the
  case where there is no ground truth against which an episode rule can be validated.
- **Instrument and ladder rung.** N/A — framework paper.
- **Episode reconstruction rule.** N/A; the framework *demands* the algorithm be characterised but
  supplies no representation for it.
- **Session threshold.** N/A.
- **Availability.** Open access.
- **Access.** Full text read via Europe PMC XML for PMC7156507 (142 KB). *npj Digital Medicine* 3,
  article 55 (2020), doi 10.1038/s41746-020-0260-4, PMID 32337371. **`nature.com` redirected to an
  IdP authorization URL** on direct fetch — Europe PMC was the working route.

---

## Sources checked and found NOT to contain what we needed

Recorded so the next agent does not re-run them.

- **No ontology of screen time, app usage, or device usage exists in the reachable literature.**
  OpenAlex `title_and_abstract.search` for `ontology AND "screen time"` (2015+) returned **8 works
  total**, none of which is an ontology of screen time — the hits are a *Teachers College Record*
  essay, an epigenetics paper, film-studies work on cinema, and a Mendelian-randomisation paper.
  The same search for `ontology AND "app usage"` returned **0**. Targeted WebSearch for
  "ontology of smartphone usage screen time concepts digital wellbeing formal vocabulary" returned
  only substantive-psychology papers; the search tool itself concluded the results "focus primarily
  on research and applied concepts in digital wellbeing rather than formal ontologies or
  standardized vocabularies."
- **BCIO (Behaviour Change Intervention Ontology)** — upper level specifies 42 entities across BCI
  content, engagement, context, mechanism of action, and outcome behaviour. Nothing in the material
  I read models *how an outcome behaviour is measured from a device log*. **Abstracts and search
  summaries only; not read in full — UNDETERMINED** on whether a lower-level BCIO module covers
  measurement method.
- **GSIM (UNECE Generic Statistical Information Model)** — reported to model derived variables via
  Process Step / Process Method / Rule. This is a genuine "declared derivation" metamodel from
  official statistics and may be a useful analogue. **Search-result summaries only; the GSIM
  specification PDF was not fetched — UNDETERMINED.**
- **DDI (Data Documentation Initiative) `GenerationInstruction` / derived-variable derivation** —
  same status. Potentially a strong analogue for "the derivation rule travels with the variable" in
  the social sciences. **Search-result summaries only — UNDETERMINED.** Recommend the next agent
  read the DDI-Lifecycle specification directly.
- **Open mHealth / IEEE 1752** — has a `descriptive-statistic` schema plus point-or-interval
  `effective time frame`, i.e. an aggregate measure over an interval. The aggregation is limited to
  named statistics (average/min/max); nothing suggests an episode-construction rule.
  **Search-result summaries only — UNDETERMINED.**
- **Computable phenotypes (EHR)** — "Desiderata for computable representations of EHR-driven
  phenotype algorithms" (PMID 26342218) is reported to include "support for defining temporal
  relations between events" among its desiderata. This is the closest *desiderata* document from
  another field and is worth reading. **Not read — UNDETERMINED.**
- **Ontology-based activity recognition / segmentation** (smart homes, HAR) — several papers use
  ontological reasoning *to perform* segmentation. None found that represents the segmentation rule
  as a declared, first-class entity attached to the output. Not pursued to full text.
- **DeMO (Discrete-event Modeling Ontology)** — surfaced on the first broad query; it is an ontology
  of discrete-event *simulation models*, not of measurements derived from event logs. Not relevant.

---

## Report

**Totals.** 18 numbered entries kept, plus 8 sources checked and explicitly parked as
not-what-we-needed. Read in full from bytes I downloaded myself: **12** (gOCED; UFO-B in SROIQ;
gufo.ttl; SSN; SSN-ext; PROV-O; OWL-Time; OBOE core OWL; IoT-Stream; HED preprint; V3; Turning Logs
into Lumber). Read via API term records: **1** (IAO/OBI via OLS4). Abstract/metadata only: **4**
(gUFO paper; OCED Core Model; ISO/IEC DIS 21838-5; event-abstraction review body). Second-hand via
WebFetch extraction, unverified against raw bytes: **1** (SemTS). Not read at all but named:
**SAO**, **IEEE 1849/XES**, and everything in the parked section.

**Citation threats, ranked.**

1. **IoT-Stream (Elsaleh et al. 2020).** A published ontology in which a derived, interval-bearing
   observation carries its producing method and parameters, with an explicit requirement that they
   "need to be declared and annotated". If a reviewer knows this paper, "we are the first to make
   the rule a declared first-class object" will not survive contact. The honest framing is: the
   declared-method pattern exists for numeric IoT streams; we supply it for typed punctual event
   logs, with the failure branches (missing terminator, fallback closer, maximum duration) that
   stream analytics never needed.
2. **gOCED (Hooshyar et al. 2025/2026).** Names the reconstruction problem in ontological terms and
   dismisses it as an artifact of a poor metamodel. Our answer must be that a phone's
   `UsageEvents` stream is not ours to redesign — we cannot ask Android to emit intervals — so
   the reconstruction step is permanent and must therefore be represented, not designed away.
3. **SOSA/SSN + OBOE.** Two standards that already require every measurement to point at the
   procedure or protocol that produced it. Whatever we build should be presented as a profile or
   extension of these, not as a new idea.
4. **HED (Robbins et al. 2021).** Already publishes the punctual-marker/extended-event distinction
   and a declared pairing mechanism. Quote it as support; do not claim the distinction as ours.
5. **V3 (Goldsack et al. 2020).** Establishes in a different clinical community that the raw→measure
   algorithm is a first-class object of evaluation.

**Anything that contradicts us — stated plainly, not softened.**

- IoT-Stream **does** require the derivation rule to be declared: "the Analytics applied, i.e., the
  methods and their corresponding parameters need to be declared and annotated." That is a real,
  published, prior instance of our normative claim in an adjacent domain.
- SOSA makes the procedure link a modelling requirement of every Observation, and OBOE makes the
  protocol a *constituent part* of every Measurement: "A measurement is comprised of a
  characteristic, a value, a measurement standard, and a protocol." The general norm is not novel.
- HED states in print that calling punctual markers "events" risks conceptual confusion.
- PROV explicitly leaves `prov:Plan` open "to be extended by applications" — so a reviewer can say
  the standard already anticipated us and we are filling in a designated blank. That framing is
  actually to our advantage if we take it first.

**Three things I expected and did not find.**

1. **Any ontology, vocabulary, or schema of device-usage or screen-time concepts.** Not one. Two
   independent OpenAlex searches and three WebSearch phrasings produced nothing. For a construct
   with this much publication volume, having no formal representation at all is itself a finding
   worth stating in the paper.
2. **Any application of PROV-O to a screen-time or smartphone-log-derived measure.** PROV is applied
   to sensor data, mHealth device provenance, ML pipelines, statistical production, and energy
   cyber-physical systems — but nothing connects it to behavioural episode reconstruction.
3. **Any SOSA/SSN profile treating a phone's event stream as observations with a declared episode
   `Procedure`.** The fit is close to obvious — `Procedure` is defined as "a workflow, protocol,
   plan, algorithm, or computational method … It explains the steps to be carried out to arrive at
   reproducible Results" — and nobody appears to have done it.
   *(Fourth, worth recording:* no process-mining metamodel stores the abstraction mapping with the
   log as first-class provenance; the event-abstraction literature treats it as an algorithm to run,
   and "Turning Logs into Lumber" confirms the whole preprocessing layer "remains ad-hoc, lacking
   support".)

**Access failures — recorded as findings, not retried with automation.**

- `mdpi.com/1424-8220/20/4/953` — HTTP 403 to both WebFetch and `curl` (with browser UA). Worked
  around via Europe PMC full-text XML (PMC7071512).
- `iso.org/standard/89915.html` — HTTP 403 to `curl`. ISO/IEC DIS 21838-5 metadata taken from a
  reseller mirror; the two registration dates I found could not be reconciled from a primary source.
- `nature.com/articles/s41746-020-0260-4` — 303 redirect to `idp.nature.com` authorization.
  Worked around via Europe PMC (PMC7156507).
- `hed-specification.readthedocs.io` — HTTP 429. HED normative spec text not obtained.
- `raw.githubusercontent.com/hed-standard/hed-specification/main/docs/{04,05}_*.md` — HTTP 404
  (path/branch layout differs from what I guessed).
- GitHub code-search API — HTTP 401, requires authentication.
- No browser, driver, or automation was used at any point, per the brief.

**Dead ends — searches that returned nothing useful; do not repeat.**

- `ontology representing a measurement derived from discrete events under a stated procedure` —
  returns only DeMO and discrete-event *simulation* ontologies. The phrase "discrete event" is
  captured by the simulation community and poisons the query.
- `ontology AND "app usage"` on OpenAlex — 0 results.
- `"user session" ontology OWL definition web usage mining semantic representation of session
  boundary` — returns generic web-usage-mining and ontology-tutorial material; no formalism.
- `Basic Formal Ontology applied to smartphone use behaviour sensor derived behavioural measure` —
  returns BFO's own homepage and unrelated BFO applications; the search tool itself reported no hits
  on the intersection.
- `ontology screen time smartphone usage measurement` (OpenAlex full search) — returns nomophobia
  and physical-activity-recognition papers; full-text search on OpenAlex is too noisy for this,
  use `title_and_abstract.search` instead, and note that OpenAlex mishandles boolean `AND` with
  quoted phrases (a query containing `sessionization` returned 725 unrelated works, i.e. the term
  was effectively dropped).
- `Allen interval algebra applied to behavioral log data temporal reasoning episodes` — returns
  Allen's own algebra, tractable-subclass complexity theory, and an AI-agent-memory blog post.
  Allen applied to behavioural logs specifically was not found; the useful Allen route is through
  OWL-Time and UFO-B, both of which axiomatise it.

**One concrete follow-up for whoever picks this up:** read **SAO (Stream Annotation Ontology)**
directly. IoT-Stream reports that SAO already combines PROV-O, SSN, an Event Ontology, and a
`Segment` concept — that combination is the nearest thing to our construct that I could identify
but not read, and it is the one remaining candidate that could turn a "no published ontology does
this" claim into a "one does".

<!-- independent-expansion-20260805:E -->

---

# Independent expansion ledger — Slice E (76 internally deduplicated sources)


**Search date:** 2026-08-05  
**Scope:** Broad, category-level discovery for ontologies, standards, semantic models, event-log models, temporal models, and provenance/derivation vocabularies that could represent raw events, intervals/episodes, derived measurements, and their construction. The named examples in the brief were treated as a deduplication boundary, not as a preferred author or citation neighborhood.  
**Target concept:** a first-class, machine-readable rule that converts lower-level events into an interval/episode or derived measure while recording boundaries, parameters/thresholds, missing-event behavior, provenance, and rerunnable implementation.  
**Evidence states:** `VERIFIED` means the cited primary source was inspected and supports the statement; `UNDETERMINED` means the relevant full text or exact rule text was unavailable; `N/A` means the source is not intended to define such a rule.  
**Ladder:** Rungs are supplied only where the work is also a measurement study. Almost all ontology/standards papers are `N/A`; assigning them a measurement rung would create a false comparison.

## Executive result

The search found **76 distinct citable items** across five independent literatures. It falsifies any broad claim that formal models do not represent derivation methods, rules, inputs, outputs, parameters, temporal intervals, or provenance. GSIM, DDI Lifecycle/SDTL, IoT-Stream, SOSA/SSN/OMS, DQD, P-Plan/OPMW/ProvONE, workflow-run RO-Crate, Activity Streams, SensorThings, and OpenTelemetry all cover substantial pieces. It also updates the narrower domain landscape: OntoKratos (2026) is a genuine ontology for problematic smartphone use, and Nascimento et al. (2024) give an ontology-oriented digital-wellbeing scheme.

The defensible remaining gap is narrower and more operational: **none of the inspected sources defines a reusable screen/app-usage event-to-episode construction object that jointly declares opener/closer event semantics, ordering and pairing, timeout/fallback behavior for missing closers, minimum/maximum duration or other thresholds, provenance/version, and an executable/rerunnable implementation.** Generic rule and workflow vocabularies can host such an object, so novelty should be framed as the domain-specific formalization and implementation of that construction—not as invention of provenance or derivation metadata in general.

### Corpus and access accounting

- 76 unique items after title/DOI/standard-version deduplication.
- 50 full texts, specifications, or ontology artifacts inspected in relevant sections.
- 16 full accepted manuscripts or preprints inspected.
- 7 abstract/landing-page-only records.
- 2 metadata-only standards records.
- 1 inspected gray-project page (kept separate from peer-reviewed/standards evidence).
- 75 scholarly/standards/specification items; 1 gray item. No item is counted twice even when both a paper and ontology artifact exist.

## Ranked closest threats to a broad novelty claim

1. **GSIM 1.2** — already makes `Rule`, `Process Method`, `Process Step`, inputs, outputs, parameters, and execution traces first-class. A claim that no standard can represent a declared derivation rule is untenable.
2. **DDI Lifecycle GenerationInstruction + SDTL** — directly represents recodes/derivations, source variables, command code, and versioned variable transformations; SDTL is explicitly designed for machine-actionable, cross-package transformation histories.
3. **IoT-Stream** — models analytics over streams with methods, parameters, input/output streams, and windows. It is close to event-to-derived-stream provenance, though it does not prescribe smartphone episode reconstruction or failure policy.
4. **HED temporal scope** — provides machine-actionable onset/offset and duration/delay mechanisms. It is a strong temporal-boundary precedent, but it annotates scope rather than specifying raw-event pairing/fallback algorithms.
5. **DQD and the Johnson et al. data-quality ontology** — make computable measurement definitions/methods and results explicit. They threaten any claim about ontologizing derived measures generally.
6. **P-Plan, OPMW, ProvONE, Workflow Run RO-Crate, and NIDM** — jointly cover prospective plans, parameters, execution steps, artifacts, and provenance. They can express a rerunnable implementation but do not supply the domain rule.
7. **gOCED + Semantic OCED/OCEDO** — semantic object-centric event models with temporal extents or event points and executable conversion tooling. They do not define screen-time sessionization or missing-close behavior.
8. **SOSA/SSN + OMS/ISO 19156 + OBOE** — mature observation/measurement/procedure vocabulary. They require or permit a procedure/protocol, but leave the procedure internals external.
9. **OntoKratos** — the closest direct smartphone-use ontology and therefore an important citation. Its inspected model captures applications, screen state, habits, time, and context; it does not formalize event-to-episode reconstruction.

## A. Temporal, event, and change ontologies

### E01. Time Ontology in OWL (OWL-Time)

- **Identity:** Simon Cox & Chris Little (eds.), W3C Recommendation, 2017; revised 2022. DOI: N/A. Primary: https://www.w3.org/TR/owl-time/ ; namespace/artifact: http://www.w3.org/2006/time#
- **Why it matters / rung:** Canonical web vocabulary for instants, intervals, durations, and Allen-style interval relations; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: “a vocabulary for expressing facts about topological (ordering) relations among instants and intervals, together with information about durations.” It defines temporal relations but no event-to-episode construction algorithm.
- **Thresholds/provenance; data/code/rerunnability; access:** No pairing thresholds or derivation provenance. RDF/OWL ontology is directly reusable and reasoner-rerunnable. **Access: full specification/artifact inspected.**

### E02. An Ontological Interpretation of the Temporal Semantics of UFO (UFO-B)

- **Identity:** A. B. Benevides et al., 2017. DOI: not assigned. Primary/full text: https://ceur-ws.org/Vol-2050/FOUST_paper_7.pdf
- **Why it matters / rung:** Foundational event ontology with formal event boundaries and temporal relations; N/A rung.
- **Formal/rule statement:** VERIFIED, formalization section: every event has exactly one begin and one end; the paper also explains that the complete Allen relation set is not expressible in SROIQ. It provides ontological constraints, not a raw-event pairing rule.
- **Thresholds/provenance; data/code/rerunnability; access:** No empirical thresholds, missing-end policy, or workflow provenance. Formal axioms are inspectable; no execution package identified. **Access: full text inspected.**

### E03. gUFO: A Lightweight Implementation of the Unified Foundational Ontology

- **Identity:** Giancarlo Guizzardi et al., 2026. DOI: 10.48550/arXiv.2603.20948. Preprint: https://arxiv.org/abs/2603.20948 ; artifact: https://github.com/nemo-ufes/gufo
- **Why it matters / rung:** Current computable UFO implementation; its qualities and events can host changing measurements and intervals; N/A rung.
- **Formal/rule statement:** VERIFIED in artifact/documentation: a mutable quality-value attribution can hold over a time interval. No normative algorithm says how raw phone events create that interval.
- **Thresholds/provenance; data/code/rerunnability; access:** Thresholds and reconstruction provenance are user-supplied. OWL files and examples are rerunnable. **Access: full preprint plus artifact inspected.**

### E04. The Time Ontology of Allen’s Interval Algebra

- **Identity:** Michael Grüninger & Zhuojun Li, 2017. DOI: 10.4230/LIPIcs.TIME.2017.16. Primary/full text: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.TIME.2017.16
- **Why it matters / rung:** Gives a first-order ontology logically synonymous with Allen’s 13 interval relations; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: “a one-to-one correspondence between models of the ontology and solutions to temporal constraints.” This is interval reasoning after intervals exist, not construction of intervals from events.
- **Thresholds/provenance; data/code/rerunnability; access:** No thresholds/provenance or empirical data; the formal axioms are reproducible with theorem-proving tools, though no dedicated package was verified. **Access: full text inspected.**

### E05. Time Event Ontology (TEO)

- **Identity:** Cui Tao et al., 2020. DOI: 10.1093/jamia/ocaa058. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC7647306/
  - *Corrected 2026-08-07.* The ledger previously carried `10.1186/s13326-020-00236-9`
    (J Biomed Semantics), which 404s. TEO was published in JAMIA, not J Biomed
    Semantics — wrong journal, not a typo. The replacement was confirmed through the
    Crossref record (`Time event ontology (TEO)…`, JAMIA 2020, Li/Du/He/Song) and
    agrees with the PMC id this entry already supplied. `doi.org` returns 403 to
    `curl` for this DOI because OUP blocks the agent, not because it is missing.
- **Why it matters / rung:** Represents and reasons over complete and incomplete temporal information for clinical events; N/A rung.
- **Formal/rule statement:** VERIFIED, methods: Allen relations are used when temporal information is complete and Basic Time Relations when it is partial. The model permits start/end comparisons but restricts an event to one valid time and does not define signal-to-episode pairing.
- **Thresholds/provenance; data/code/rerunnability; access:** No episode thresholds/fallback policy; ontology/evaluation examples support reasoning reruns, not raw reconstruction. **Access: full text inspected.**

### E06. HuTO: Human Time Ontology

- **Identity:** Julien Barroy et al., 2015. DOI: 10.48550/arXiv.1506.05969. Full preprint: https://arxiv.org/abs/1506.05969
- **Why it matters / rung:** RDFS vocabulary for human temporal expressions, including intervals and non-convex periods; N/A rung.
- **Formal/rule statement:** VERIFIED in the ontology paper: temporal expressions are normalized into RDF structures. No rule constructs an episode from device events.
- **Thresholds/provenance; data/code/rerunnability; access:** No domain thresholds or provenance. Vocabulary/query examples are reproducible; no maintained execution bundle verified. **Access: full preprint inspected.**

### E07. Temporally Enhanced Ontologies in OWL

- **Identity:** S. Batsakis, E. G. M. Petrakis, I. Tachmazidis, G. Antoniou & F. Frasincar, 2015. DOI: 10.1007/978-3-319-26190-4_3. Accepted manuscript: https://personal.eur.nl/frasincar/papers/WISE2015/wise2015.pdf
- **Why it matters / rung:** Systematic temporalization of otherwise atemporal OWL statements using fluent properties; N/A rung.
- **Formal/rule statement:** VERIFIED, methods: temporally varying properties are represented through fluent/reification patterns while retaining reasoner compatibility. It does not specify event boundary extraction.
- **Thresholds/provenance; data/code/rerunnability; access:** No thresholds/missing-event rules; transformation approach is described, but implementation artifact was not verified. **Access: full accepted manuscript inspected.**

### E08. NdFluents: An Ontology for Annotated Statements with Contexts

- **Identity:** José M. Giménez-García, Antoine Zimmermann & Pierre Maret, 2016. DOI: **unconfirmed**; preprint: https://arxiv.org/abs/1609.07102
  - *Corrected 2026-08-07.* The ledger previously carried `10.1007/978-3-319-46547-0_40`,
    which does not resolve. No replacement is pinned: the obvious EKAW-2016 volume guess
    resolved to a different paper, so substituting it would trade a dead identifier for a
    wrong one. Cite the arXiv preprint (1609.07102, which resolves) until the chapter DOI
    is confirmed by hand against the published proceedings.
- **Why it matters / rung:** Extends 4D fluents to multiple contextual dimensions, including time and provenance; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: it generalizes 4D fluents to “multidimensional context” and permits context-dependent assertions. No session construction rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Can attach provenance context but does not prescribe thresholds. OWL ontology/examples make reasoning reproducible. **Access: full preprint inspected.**

### E09. Temporal Representation and Reasoning in OWL 2

- **Identity:** Sotiris Batsakis, Euripides G. M. Petrakis, Ilias Tachmazidis & Grigoris Antoniou, 2017. DOI: 10.3233/SW-150210. Primary: https://www.semantic-web-journal.net/content/temporal-representation-and-reasoning-owl-2
- **Why it matters / rung:** Combines 4D fluents/n-ary relations with temporal reasoning in OWL 2; N/A rung.
- **Formal/rule statement:** UNDETERMINED from accessible abstract/landing page; the stated contribution is temporal representation and inference, not observed-event pairing.
- **Thresholds/provenance; data/code/rerunnability; access:** No thresholds or provenance established from accessible material; implementation availability not verified. **Access: abstract/landing page only.**

### E10. Ontology Patterns for the Representation of Quality Changes of Cells in Time

- **Identity:** Peter Burek, N. Scherf, Heinrich Herre et al., 2019. DOI: 10.1186/s13326-019-0206-4. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC6796485/
- **Why it matters / rung:** Directly compares n-ary reification, state/role patterns, and 4D fluents for temporally changing qualities; N/A rung.
- **Formal/rule statement:** VERIFIED, conclusion: “there is no single best choice” across simplicity, scalability, extensibility, and adequacy. It models already-recognized change, not raw-event-to-state construction.
- **Thresholds/provenance; data/code/rerunnability; access:** Uses synthetic benchmark data; no domain threshold/failure rule. Pattern encodings permit reasoning experiments, but no turnkey package was identified. **Access: full text inspected.**

### E11. What to Consider About Events: A Survey on the Ontology of Occurrents

- **Identity:** Carlos M. C. Rodrigues & Mara Abel, 2019. DOI: 10.3233/AO-190217. Primary: https://journals.sagepub.com/doi/abs/10.3233/AO-190217
- **Why it matters / rung:** Broad survey of event/occurrent commitments and boundary choices, preventing dependence on one ontology family; N/A rung.
- **Formal/rule statement:** UNDETERMINED from the accessible abstract. It surveys conceptual commitments rather than prescribing a sessionization algorithm.
- **Thresholds/provenance; data/code/rerunnability; access:** N/A; no artifact or executable rule established. **Access: abstract only.**

### E12. Hierarchical Event Descriptor (HED) Advanced Annotation / Temporal Scope

- **Identity:** HED Working Group, continuously maintained; advanced specification current in 2026. DOI: N/A. Primary: https://www.hedtags.org/hed-specification/05_Advanced_annotation.html
- **Why it matters / rung:** Machine-actionable event annotation with explicit temporal-scope constructs; N/A rung.
- **Formal/rule statement:** VERIFIED, Temporal scope §: “HED has two distinct mechanisms for expressing temporal scope: `Onset`/`Offset` and `Duration`/`Delay`.” The same section states that an Offset “Must be preceded by an `Onset` anchored by the same definition,” and for Duration, “The offset = start + duration.”
- **Thresholds/provenance; data/code/rerunnability; access:** Durations/delays are declared; no missing-offset fallback or smartphone semantics. Validators and transformation tools make annotations rerunnable. **Access: full specification inspected.**

### E13. EventKG: A Multilingual Event-Centric Temporal Knowledge Graph

- **Identity:** Simon Gottschalk & Elena Demidova, 2018 (model revisited in 2024 chapter). DOI: 10.1007/978-3-030-00668-6_18. Primary model chapter: https://link.springer.com/chapter/10.1007/978-3-031-64451-1_6
- **Why it matters / rung:** Uses event-centric temporal knowledge modeling with provenance and source integration; N/A rung.
- **Formal/rule statement:** UNDETERMINED from accessible chapter abstract. EventKG represents extracted real-world events; it does not appear to define low-level device-event sessionization.
- **Thresholds/provenance; data/code/rerunnability; access:** Strong source provenance; extraction thresholds/code were not established from accessible material. **Access: abstract/landing page only.**

### E14. Open Event Knowledge Graph (OEKG)

- **Identity:** Olaf Hartig et al., 2023. DOI: 10.48550/arXiv.2302.14688. Full preprint: https://arxiv.org/abs/2302.14688
- **Why it matters / rung:** Open, event-centric graph with explicit event descriptions and links; broadens beyond one event-ontology group; N/A rung.
- **Formal/rule statement:** VERIFIED at model level: the graph represents event entities, participants, places, and temporal information. Event extraction is not a normative signal-to-episode rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Dataset and generation resources improve rerunnability; no phone-episode thresholds/fallback semantics. **Access: full preprint inspected.**

## B. Smartphone, context, behavior, and sensing ontologies

### E15. OntoKratos: An Ontology for Problematic Smartphone Use

- **Identity:** P. Schroeder, L. Heckler, R. Francisco & J. L. V. Barbosa, 2026. DOI: 10.3897/jucs.147898. Primary/full package: https://zenodo.org/records/19061086
- **Why it matters / rung:** Closest direct domain ontology found; represents problematic smartphone use, application categories, screen status, habits, time, and context. N/A rung (ontology plus simulation, not a direct measurement validation study).
- **Formal/rule statement:** VERIFIED, §4.2: “Regarding the representation of PSU concepts, no ontologies were found.” §4.4 includes applications used and screen status as dynamic context. The inspected model contains no explicit opener/closer, event-pairing, missing-close, or duration-threshold rule.
- **Thresholds/provenance; data/code/rerunnability; access:** §5 generates 30 synthetic days and converts raw data into higher-level information using randomly selected user conditions. Ontology and simulator artifacts are downloadable; the high-level conversion logic is not a general screen-session construction specification. **Access: full text and package inspected.**

### E16. SmartOntoSensor: Ontology for Smartphone Sensors

- **Identity:** F. Ali et al., 2017. DOI: 10.1155/2017/8790198. Full text: https://onlinelibrary.wiley.com/doi/10.1155/2017/8790198
- **Why it matters / rung:** Formal smartphone resources/sensors vocabulary with taxonomy, relationships, performance, reliability, and OWL-Time alignment; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology description: it models smartphones and their sensing capabilities/observations. No rule constructs app-use or screen-use episodes from system events.
- **Thresholds/provenance; data/code/rerunnability; access:** Sensor performance/reliability can be described; no session thresholds/fallback policy. Ontology artifact supports reuse; no episode builder. **Access: full text inspected.**

### E17. User Context Ontology for Adaptive Mobile-Phone Interfaces

- **Identity:** M. W. Iqbal et al., 2021. DOI: 10.1109/ACCESS.2021.3095300. Primary DOI: https://doi.org/10.1109/ACCESS.2021.3095300
- **Why it matters / rung:** Models mobile-user context for adaptive interfaces, a direct neighboring use of phone activity/context; N/A rung.
- **Formal/rule statement:** UNDETERMINED from accessible abstract/metadata. Nothing accessible established a formal raw-event-to-episode rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Context rules may drive adaptation, but thresholds, derivation provenance, data, and code were not verified. **Access: abstract/landing page only.**

### E18. Context Ontology in Mobile Applications (COCCC)

- **Identity:** N. Norki, R. Mohamad & H. Ibrahim, 2020 (online 2019). DOI: not assigned. Primary/full text: https://e-journal.uum.edu.my/index.php/jict/article/view/12347
- **Why it matters / rung:** Android-specific context ontology developed with METHONTOLOGY and expert evaluation; N/A rung.
- **Formal/rule statement:** VERIFIED at model level: represents mobile-application context and relationships; no event-pair session construction rule was found.
- **Thresholds/provenance; data/code/rerunnability; access:** Evaluated by five experts, not by event reconstruction. No thresholds/fallback policy or executable sessionizer. **Access: full text inspected.**

### E19. CAMeOnto: Context-Awareness Meta-Ontology Modeling

- **Identity:** José Aguilar et al., 2018. DOI: 10.1016/j.aci.2017.08.001. Full text: https://www.sciencedirect.com/science/article/pii/S2210832717301643
- **Why it matters / rung:** General context model organized around who/when/what/where/why and reused by smartphone ontologies; N/A rung.
- **Formal/rule statement:** VERIFIED in model sections: CAMeOnto structures context and reasoning concepts, but supplies no phone-event boundary construction.
- **Thresholds/provenance; data/code/rerunnability; access:** No session thresholds or missing-event branch; ontology model is reusable, execution package not verified. **Access: full text inspected.**

### E20. Ontology-Based High-Level Context Inference for Human Behavior Identification

- **Identity:** Claudia Villalonga, Muhammad A. Razzaq, Wajahat A. Khan, Héctor Pomares, Ignacio Rojas, Sungyoung Lee & Oresti Baños, 2016. DOI: 10.3390/s16101617. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC5087405/
- **Why it matters / rung:** Infers higher-level behavior/context from low-level activity, location, and emotion observations; N/A rung.
- **Formal/rule statement:** VERIFIED in methods: ontology/rule reasoning combines low-level contextual facts into high-level situations. It is classification/inference, not temporal episode pairing with missing-close semantics.
- **Thresholds/provenance; data/code/rerunnability; access:** Rules are described; model-specific thresholds and datasets are reported, but no generic event-to-episode contract. Ontology/examples are available enough for partial reproduction; turnkey rerun not verified. **Access: full text inspected.**

### E21. Deriving Human Activity from Geo-Located Data by Ontological and Statistical Reasoning

- **Identity:** Zolzaya Dashdorj et al., 2018. DOI: 10.1016/j.knosys.2017.11.038. Primary: https://www.sciencedirect.com/science/article/pii/S0950705117305701
- **Why it matters / rung:** HBOnto plus statistical reasoning maps geotemporal phone/transaction traces and POI context to qualitative human activities; N/A rung.
- **Formal/rule statement:** VERIFIED from detailed abstract: the model “generates a set of human activities with a likelihood from the set of POIs.” No raw-event-to-interval construction rule is reported there.
- **Thresholds/provenance; data/code/rerunnability; access:** Evaluated in Trento/Barcelona using user feedback and transaction data; likelihood parameters exist, but code/artifact and episode failure handling were not verified. **Access: abstract plus section snippets only.**

### E22. Human-Aware Sensor Network Ontology (HASNetO)

- **Identity:** Paulo Pinheiro, Deborah L. McGuinness & Henrique Santos, 2017. DOI: 10.48550/arXiv.1704.01806. Full preprint: https://arxiv.org/abs/1704.01806
- **Why it matters / rung:** Integrates sensing-infrastructure and provenance ontologies for empirical data collection; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: “a comprehensive alignment and integration of a sensing infrastructure ontology and a provenance ontology.” It records compatible measurement context, not app-use episode derivation.
- **Thresholds/provenance; data/code/rerunnability; access:** Strong provenance and deployment metadata; no phone thresholds/pairing. Ontology used in multiple ecological projects and reusable as OWL. **Access: full preprint inspected.**

### E23. MIMU-Wear: Ontology-Based Sensor Selection for Real-World Wearable Activity Recognition

- **Identity:** Claudia Villalonga et al., 2017. DOI: 10.1016/j.neucom.2016.09.125. Primary: https://www.sciencedirect.com/science/article/pii/S0925231217302369
- **Why it matters / rung:** OWL 2 ontology plus heuristic rules for replacing failed wearable inertial sensors; useful adjacent evidence on explicit failure handling; N/A rung.
- **Formal/rule statement:** VERIFIED from abstract: “builds on a set of heuristic rules to infer the candidate replacement sensors under different conditions.” The rule concerns sensor replacement, not temporal session recovery.
- **Thresholds/provenance; data/code/rerunnability; access:** Sensor capabilities/anomalies are modeled; no session threshold. Full ontology/code availability was not verified. **Access: abstract and detailed snippets only.**

### E24. Switching Off to Switch On: An Ontological Inquiry into Many Facets of Digital Well-Being

- **Identity:** A. Nascimento, R. Motta, A. Correia & D. Schneider, 2024. DOI: 10.1007/978-3-031-61063-9_10. Primary: https://link.springer.com/chapter/10.1007/978-3-031-61063-9_10
- **Why it matters / rung:** Directly addresses digital well-being through an initial ontology-based conceptual scheme; N/A rung.
- **Formal/rule statement:** UNDETERMINED from accessible abstract. The work is conceptual and does not establish a machine-readable screen-session algorithm in the accessible record.
- **Thresholds/provenance; data/code/rerunnability; access:** No thresholds, data, code, or rerunnable artifact verified. **Access: abstract/landing page only.**

### E25. Screenomics: A Venue for Developing an Ontology of Everyday Digital Media

- **Identity:** Stanford mediaX research project, 2020. DOI: N/A. Primary project page: https://mediax.stanford.edu/research-projects/screenomics-a-venue-for-developing-an-ontology-of-informal-learning-through-everyday-digital-media/
- **Why it matters / rung:** Gray but domain-direct: proposes an ontology of screen content, functions, contexts, and timescales around screenshot traces. Rung 3 for the underlying in-the-wild screenshot logging, but the page is not a validation paper.
- **Formal/rule statement:** N/A/UNDETERMINED: no formal OWL/RDF rule or event-to-episode construction was published on the inspected project page.
- **Thresholds/provenance; data/code/rerunnability; access:** Screenshot capture supplies primary trace data; thresholds and code are not disclosed on the page. **Access: inspected gray-project page; excluded from scholarly total.**

## C. Event-log, process-mining, and object-centric event models

### E26. IEEE 1849 — eXtensible Event Stream (XES)

- **Identity:** IEEE Standards Association, 2016; current revision metadata 2023. DOI: 10.1109/IEEESTD.2016.7740858. Primary: https://standards.ieee.org/ieee/1849/4953/
- **Why it matters / rung:** Canonical event-log interchange standard with traces, events, attributes, classifiers, and lifecycle extension; N/A rung.
- **Formal/rule statement:** UNDETERMINED because the normative standard was not openly inspectable. Public descriptions identify lifecycle values such as start/complete, but no claim about missing-end handling is made here.
- **Thresholds/provenance; data/code/rerunnability; access:** XES serializes results rather than prescribing extraction thresholds. Many tools read it; normative rule text remains unavailable. **Access: metadata only.**

### E27. OCEL: A Standard for Object-Centric Event Logs

- **Identity:** G. G. A. Ghahfarokhi, G. Park, A. Berti & W. M. P. van der Aalst, 2021. DOI: 10.1007/978-3-030-85082-1_16. Manuscript: https://www.vdaalst.com/publications/p1212.pdf
- **Why it matters / rung:** Replaces single-case traces with events related to multiple objects; N/A rung.
- **Formal/rule statement:** VERIFIED in formal definitions: events have activity/timestamp/attributes and links to objects. The standard represents event logs after extraction; it does not define phone event pairing or fallback.
- **Thresholds/provenance; data/code/rerunnability; access:** No extraction thresholds; example logs/tools support replay and analysis. **Access: full accepted manuscript inspected.**

### E28. OCEL 2.0 Specification

- **Identity:** Alessandro Berti et al., 2023/2024. DOI: 10.5281/zenodo.8412919. Official: https://ocel-standard.org/specification/overview/ ; paper: https://arxiv.org/abs/2403.01975
- **Why it matters / rung:** Adds object changes, qualifiers, and richer relations to the object-centric log standard; N/A rung.
- **Formal/rule statement:** VERIFIED in specification: an event has one timestamp and relationships may carry qualifiers; object attribute changes can be timestamped. It still does not prescribe signal-to-event/session extraction.
- **Thresholds/provenance; data/code/rerunnability; access:** No domain thresholds or missing-closer rule. Schemas and tool ecosystem enable interchange/reruns. **Access: full preprint and official specification inspected.**

### E29. Towards a Core Metamodel for Object-Centric Event Data (OCED)

- **Identity:** Dirk Fahland et al., 2024. DOI: 10.48550/arXiv.2410.14495. Full preprint: https://arxiv.org/abs/2410.14495
- **Why it matters / rung:** General core metamodel for events, objects, attributes, and relations that avoids format-specific commitments; N/A rung.
- **Formal/rule statement:** VERIFIED in metamodel definitions: event data structure is formalized, while event extraction/correlation semantics are intentionally external. No phone-session rule.
- **Thresholds/provenance; data/code/rerunnability; access:** No thresholds/failure branch; schemas/examples support reuse, but raw-to-log procedure is not encoded. **Access: full preprint inspected.**

### E30. Semantic OCED / OCEDO

- **Identity:** Atif Latif, Fajar J. Ekaputra, Mikhail Vidgof, Sabrina Kirrane & Andrea Di Ciccio, 2025. DOI: 10.48550/arXiv.2511.03351. Full preprint: https://arxiv.org/abs/2511.03351 ; tool: https://github.com/wu-semsys/ocedo
- **Why it matters / rung:** Supplies a semantic ontology and converter for object-centric event data; N/A rung.
- **Formal/rule statement:** VERIFIED, §model: “An event represents a point-in-time occurrence of an action.” Introduction notes, “An accurate semantic ontology of the novel meta-model is still under discussion.” No duration or missing-event reconstruction semantics.
- **Thresholds/provenance; data/code/rerunnability; access:** Timestamp is when an event was registered. XES plus descriptor can be converted to RDF with OCEDO, so conversion is rerunnable; upstream event construction remains external. **Access: full preprint and code inspected.**

### E31. gOCED: A Grounded Object-Centric Event Data Ontology

- **Identity:** M. Hooshyar et al., 2025/2026. DOI: 10.48550/arXiv.2512.14425. Full preprint: https://arxiv.org/abs/2512.14425
- **Why it matters / rung:** Grounds OCED in UFO and supports temporal extents rather than only punctual events; N/A rung.
- **Formal/rule statement:** VERIFIED, temporal modeling section: intervals can be defined directly “without needing to reconstruct these periods from a sequence of events.” This is a useful contrast: it represents known intervals but deliberately avoids prescribing their reconstruction.
- **Thresholds/provenance; data/code/rerunnability; access:** No raw-event pairing thresholds or fallback; ontology artifact/examples make representation reproducible. **Access: full preprint inspected.**

### E32. Event Abstraction in Process Mining: Literature Review and Taxonomy

- **Identity:** Sebastiaan J. van Zelst, Felix Mannhardt, Massimiliano de Leoni & Agnes Koschmider, 2021. DOI: 10.1007/s41066-020-00226-2. Full text: https://link.springer.com/article/10.1007/s41066-020-00226-2
- **Why it matters / rung:** Systematic review of converting low-level events into higher-level events; closest process-mining formulation of the target problem. N/A rung.
- **Formal/rule statement:** VERIFIED in taxonomy: abstraction methods vary by supervision, modeling paradigm, and required domain knowledge; no single standard rule representation dominates.
- **Thresholds/provenance; data/code/rerunnability; access:** Individual methods use parameters but the review does not impose a universal failure policy. Corpus/taxonomy are reproducible conceptually; no unified runner. **Access: full text inspected.**

### E33. Turning Logs into Lumber: Preprocessing Raw Event Data

- **Identity:** Chen Liu et al., 2023/2024. DOI: 10.1007/978-3-031-56107-8_8. Full preprint: https://arxiv.org/abs/2309.17100
- **Why it matters / rung:** Directly studies the under-supported work of constructing analysis-ready event logs from raw data; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: preprocessing is often “ad-hoc, lacking support.” The proposed framework organizes preprocessing but does not provide the specific screen-use pairing/fallback rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Supports explicit preprocessing choices; no universal thresholds. Prototype/examples are described; exact turnkey rerun status not verified. **Access: full preprint inspected.**

### E34. Foundations of Process Event Data

- **Identity:** Jochen De Weerdt & Moe T. Wynn, 2022. DOI: 10.1007/978-3-031-08848-3_6. Full text: https://link.springer.com/chapter/10.1007/978-3-031-08848-3_6
- **Why it matters / rung:** Formal and conceptual foundation for event extraction, correlation, abstraction, cases, activities, and timestamps; N/A rung.
- **Formal/rule statement:** VERIFIED in chapter: event data are modeling products, not neutral exhaust. It defines core concepts but does not standardize domain-specific pairing and missing-event behavior.
- **Thresholds/provenance; data/code/rerunnability; access:** Encourages documenting choices; no screen thresholds or implementation package. **Access: full text inspected.**

### E35. Extracting and Pre-Processing Event Logs

- **Identity:** Dirk Fahland, 2022. DOI: 10.48550/arXiv.2211.04338. Full preprint: https://arxiv.org/abs/2211.04338
- **Why it matters / rung:** Focused treatment of modeling decisions between source data and event logs; N/A rung.
- **Formal/rule statement:** VERIFIED, abstract: “Event log extraction itself is an act of modeling as the analyst has to consciously choose which features of the raw data are used for describing which behavior of which entities.”
- **Thresholds/provenance; data/code/rerunnability; access:** Makes selection/correlation choices explicit but no standard parameter/failure schema. Examples are pedagogically reproducible; no general extraction engine. **Access: full preprint inspected.**

### E36. OnProm: Ontology-Based Data Access for Extracting Event Logs from Legacy Data

- **Identity:** Diego Calvanese, E. Kalayci, Marco Montali & G. Tinella, 2017. DOI: not assigned in proceedings record. Full text: https://www.inf.unibz.it/~montali/papers/calvanese-etal-BIS2017-onprom.pdf
- **Why it matters / rung:** Uses ontology-based data access mappings to generate event logs from heterogeneous legacy sources; N/A rung.
- **Formal/rule statement:** VERIFIED in architecture: mappings and queries mediate source schemas and process concepts. This can encode extraction logic but does not supply phone episode pairing or missing-close semantics.
- **Thresholds/provenance; data/code/rerunnability; access:** Mappings provide partial provenance; thresholds are application-defined. Prototype described; public turnkey package not verified. **Access: full text inspected.**

### E37. A Virtual Knowledge Graph Based Approach for Object-Centric Event Log Extraction

- **Identity:** Jing Xiong, Guohui Xiao, Tahir Emre Kalayci, Marco Montali, Zhenzhen Gu & Diego Calvanese, 2022/2023. DOI: 10.1007/978-3-031-27815-0_34. Accepted manuscript: https://www.inf.unibz.it/~calvanese/papers/xion-etal-PQMI-2022.pdf
- **Why it matters / rung:** Extends ontology/mapping-based extraction to object-centric logs; N/A rung.
- **Formal/rule statement:** VERIFIED in method: virtual knowledge graph mappings expose source data for OCEL extraction. Event construction semantics live in mappings/queries, not a reusable domain rule object.
- **Thresholds/provenance; data/code/rerunnability; access:** Mapping provenance is explicit; no screen thresholds/failure branch. Prototype evaluation is described, but artifact availability was not verified. **Access: full accepted manuscript inspected.**

### E38. Connecting Databases with Process Mining: A Meta Model and Toolset

- **Identity:** E. González López de Murillas, Hajo A. Reijers & Wil M. P. van der Aalst, 2019. DOI: 10.1007/s10270-018-0664-7. Full text: https://link.springer.com/article/10.1007/s10270-018-0664-7
- **Why it matters / rung:** Provides a database-to-event-data metamodel and tools for extraction; N/A rung.
- **Formal/rule statement:** VERIFIED in metamodel: event/object/relationship structures can be created from relational data. It does not define the target domain’s boundary/fallback rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Query/configuration choices are rerunnable in the toolset; no general missing-event semantics or screen thresholds. **Access: full text inspected.**

### E39. Event Log Preprocessing for Process Mining: A Review

- **Identity:** C. dos Santos Garcia et al., 2021. DOI: 10.3390/app112210556. Full text: https://www.mdpi.com/2076-3417/11/22/10556
- **Why it matters / rung:** Broad review of cleaning, transformation, abstraction, and preprocessing, reducing citation-loop risk; N/A rung.
- **Formal/rule statement:** VERIFIED in taxonomy: preprocessing is heterogeneous and task-dependent. No consensus formalism jointly covers boundary semantics, thresholds, failures, provenance, and execution.
- **Thresholds/provenance; data/code/rerunnability; access:** Reviews parameterized methods but offers no normative threshold/fallback. Review protocol is reported; no unified code. **Access: full text inspected.**

### E40. Ontology-Based Semantic Validation of Process Event Logs

- **Identity:** N. Aryania, S. Ahmed & M. Helfert, 2025. DOI: not assigned. Full text: https://ceur-ws.org/Vol-4171/paper_68.pdf
- **Why it matters / rung:** Combines an event-log ontology with SHACL constraints for machine-checkable validation; N/A rung.
- **Formal/rule statement:** VERIFIED in method: SHACL shapes validate semantic constraints on event logs. Validation occurs after event construction and does not create missing intervals.
- **Thresholds/provenance; data/code/rerunnability; access:** Constraint thresholds can be encoded in shapes; provenance and public code were not verified. Shapes/examples are in the paper. **Access: full text inspected.**

### E41. Process Mining over Multiple Behavioral Dimensions with Event Knowledge Graphs

- **Identity:** Dirk Fahland, 2022. DOI: 10.1007/978-3-031-08848-3_9. Full text: https://link.springer.com/chapter/10.1007/978-3-031-08848-3_9
- **Why it matters / rung:** Uses graph structures to preserve multiple entities and relations rather than forcing one case notion; N/A rung.
- **Formal/rule statement:** VERIFIED in chapter: event knowledge graphs represent events/entities/relations for multiple behavioral views. They do not prescribe low-level temporal pairing.
- **Thresholds/provenance; data/code/rerunnability; access:** Analysis queries can be rerun; extraction thresholds and missing-close policy remain external. **Access: full text inspected.**

### E42. A Framework for Advanced Case Notions in Object-Centric Process Mining

- **Identity:** Jan Niklas van Detten, Pol Schumacher & Sander J. J. Leemans, 2025. DOI: 10.1007/978-3-031-82225-4_30. Full text: https://link.springer.com/chapter/10.1007/978-3-031-82225-4_30
- **Why it matters / rung:** Formally models a case notion as a function from a log graph to sets of subgraphs, making grouping semantics explicit; N/A rung.
- **Formal/rule statement:** VERIFIED in formal definition: a case notion maps the log graph to a power set of subgraphs and can duplicate or omit nodes. This is grouping after event extraction, not event-to-duration reconstruction.
- **Thresholds/provenance; data/code/rerunnability; access:** Case parameters may be explicit; no screen thresholds/failure branch. Evaluation/examples reported; code availability not verified. **Access: full text inspected.**

## D. Observation, provenance, workflow, and derivation vocabularies

### E43. PROV-O: The PROV Ontology

- **Identity:** Timothy Lebo, Satya Sahoo & Deborah McGuinness (eds.), W3C Recommendation, 2013. DOI: N/A. Primary: https://www.w3.org/TR/prov-o/
- **Why it matters / rung:** Canonical entity/activity/agent provenance vocabulary; N/A rung.
- **Formal/rule statement:** VERIFIED, recommendation: PROV-O provides classes/properties for representing and interchanging provenance. A derivation can link input/output through an activity, but algorithm internals and fallback branches are not prescribed.
- **Thresholds/provenance; data/code/rerunnability; access:** Excellent provenance shell; thresholds and implementation references must be supplied by an extension/application. OWL artifact is reusable. **Access: full specification inspected.**

### E44. SOSA/SSN: Semantic Sensor Network Ontology

- **Identity:** W3C/OGC Spatial Data on the Web Working Group, 2017; revised recommendation current 2023. DOI: N/A. Primary: https://www.w3.org/TR/vocab-ssn/
- **Why it matters / rung:** Standard vocabulary for observations, sensors, procedures, results, samples, and actuations; N/A rung.
- **Formal/rule statement:** VERIFIED, `sosa:Procedure` definition: “A workflow, protocol, plan, algorithm, or computational method specifying how to make an Observation…” and it “explains the steps … reproducible Results.” It does not require the algorithm body to be embedded.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters/provenance can be attached through extensions; no standard phone thresholds/failure branch. RDF vocabulary is reusable. **Access: full specification inspected.**

### E45. OGC Observations, Measurements, and Samples (OMS) / ISO 19156:2023

- **Identity:** OGC, 2023/2024. DOI: N/A. Open OGC specification: https://docs.ogc.org/as/20-082r4/20-082r4.html
- **Why it matters / rung:** Formal conceptual model for observation procedures, results, features of interest, and samples; N/A rung.
- **Formal/rule statement:** VERIFIED, core: an observation uses a specified procedure “such as a sensor, instrument, algorithm or process chain”; `observingProcedure` is used to determine the result value and is exactly one in the conceptual schema.
- **Thresholds/provenance; data/code/rerunnability; access:** Procedure identity is required, but procedure steps/thresholds/failures may remain external. No executable artifact beyond schemas/models. **Access: full specification inspected.**

### E46. Extensible Observation Ontology (OBOE)

- **Identity:** M. B. Schildhauer et al./NCEAS, 2010 onward. DOI: 10.48550/arXiv.1009.0585 for design paper. Artifact: https://raw.githubusercontent.com/NCEAS/oboe/master/oboe-core.owl
- **Why it matters / rung:** Models observations and measurements with characteristics, values, standards, and protocols; N/A rung.
- **Formal/rule statement:** VERIFIED in OWL artifact: a measurement is associated with a characteristic, value, standard, and protocol; `Protocol` describes procedures for generating/processing data. It does not prescribe a screen-session algorithm.
- **Thresholds/provenance; data/code/rerunnability; access:** Protocol and standard can carry provenance; thresholds/code must be externalized by the user. OWL artifact is reusable. **Access: ontology artifact inspected.**

### E47. Information Artifact Ontology (IAO) and Ontology for Biomedical Investigations (OBI)

- **Identity:** IAO/OBI Consortia, 2008–current. DOI: 10.1038/nbt.1622 (OBI overview). Primary artifacts: https://github.com/information-artifact-ontology/IAO ; https://github.com/obi-ontology/obi
- **Why it matters / rung:** Mature distinction among measurement datum, data transformation, planned process, plan specification, inputs, and outputs; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology definitions: `data transformation` is a planned process that produces output data from input data. The plan can specify a method, but target-domain pairing semantics are not supplied.
- **Thresholds/provenance; data/code/rerunnability; access:** Strong typed provenance scaffold; parameters/thresholds and code references must be instantiated. OWL releases are versioned/reusable. **Access: ontology artifacts inspected.**

### E48. IoT-Stream: A Lightweight Ontology for IoT Data Streams and Analytics

- **Identity:** Maria Bermudez-Edo et al., 2020. DOI: 10.3390/s20040953. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC7071512/
- **Why it matters / rung:** One of the closest formal models for derived streams: analytics, methods, parameters, input/output streams, and analysis windows; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology sections: analytics can be associated with methods and parameters and streams can be `derivedFrom` other streams; window start/end are representable. It models declarations but does not normatively define raw smartphone event pairing or missing-close behavior.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters/windows/provenance are first-class enough to host thresholds. Ontology and examples are available; analytics implementation itself must be supplied for reruns. **Access: full text inspected.**

### E49. Stream Annotation Ontology (SAO)

- **Identity:** Şefki Kolozali, Maria Bermudez-Edo, Daniel Puschmann, Frieder Ganz & Payam Barnaghi, 2014. DOI: 10.1109/iThings.2014.39. Author full text: https://www.ugr.es/~mbe/pdfs/IEEE_iThings_2014.pdf
- **Why it matters / rung:** Predecessor stream vocabulary with stream data, segments, segment analysis, summarization, reliability, time, and provenance; N/A rung.
- **Formal/rule statement:** VERIFIED, §IV: SAO “allows publishing content-derived data about IoT streams” and provides `StreamData`, `Segment`, and `SegmentAnalysis`. It annotates derived segments but does not define a general event-pair failure policy.
- **Thresholds/provenance; data/code/rerunnability; access:** Summarization/reliability metadata are modeled; paper reports raw/aggregated sensor evaluation. Ontology reuse is possible; original complete runtime was not verified. **Access: full author manuscript inspected.**

### E50. SemTS: Semantic Time-Series Ontology

- **Identity:** SemTS maintainers, 2024–current. DOI: not identified. Primary artifact/documentation: https://semts-ontology.github.io/SemTS/ontology/current/index.html
- **Why it matters / rung:** Current ontology for time series and time-series segments; N/A rung.
- **Formal/rule statement:** VERIFIED in artifact: `TimeSeriesSegment` and related temporal/observation concepts represent a selected segment. No normative rule says how event pairs select it.
- **Thresholds/provenance; data/code/rerunnability; access:** Segment metadata can carry boundaries; thresholds/provenance and code are application-defined. OWL documentation is reusable. **Access: ontology artifact inspected.**

### E51. DDI Lifecycle 3.3 — GenerationInstruction

- **Identity:** DDI Alliance, 2020. DOI: N/A. Primary: https://docs.ddialliance.org/DDI-Lifecycle/3.3/model/item-types/GenerationInstruction/
- **Why it matters / rung:** Direct standard for recodes and derived variables with sources, command code, control constructs, and aggregation; N/A rung.
- **Formal/rule statement:** VERIFIED, definition: “Processing instructions for recodes, derivations from multiple question or variable sources, and derivations based on external sources.” The model includes input references, `CommandCode`, `ControlConstruct`, `Aggregation`, and `IsDerived`.
- **Thresholds/provenance; data/code/rerunnability; access:** Can explicitly carry thresholds in command code and source provenance. Rerunnability depends on the command language/environment, which can be identified. **Access: full specification inspected.**

### E52. Structured Data Transformation Language (SDTL)

- **Identity:** DDI Alliance, 2020–current. DOI: N/A. Primary: https://docs.ddialliance.org/SDTL/1.0/model/use-cases/
- **Why it matters / rung:** Package-neutral, machine-actionable representation of data transformations and variable lineage; N/A rung.
- **Formal/rule statement:** VERIFIED, use cases: changes are documented in SDTL, derived variables are linked to originals, and an updater assigns a unique identifier to every variable version. Commands represent recodes, computations, merges, and related operations.
- **Thresholds/provenance; data/code/rerunnability; access:** Constants/conditions are explicit, lineage is versioned, and translators can regenerate target statistical code. It does not define phone episode semantics. **Access: full specification inspected.**

### E53. Generic Statistical Information Model (GSIM) 1.2

- **Identity:** UNECE High-Level Group for the Modernisation of Official Statistics, 2025. DOI: N/A. Primary glossary: https://statswiki.unece.org/spaces/gsim/pages/260407605/GSIM+v1.2+Glossary
- **Why it matters / rung:** Strongest generic threat: formal information objects for Rule, Process Method, Process Step, Process Input/Output, and execution traces; N/A rung.
- **Formal/rule statement:** VERIFIED, glossary: a `Rule` is a “specific mathematical or logical expression which can be evaluated to determine specific behavior”; a `Process Step` processes inputs according to a `Process Method`; `Process Input` may be a Rule/control parameter; execution records actual inputs/outputs.
- **Thresholds/provenance; data/code/rerunnability; access:** Thresholds can be Rules/parameters and execution provenance is explicit. GSIM is conceptual, so rerun requires linked implementation. **Access: full specification inspected.**

### E54. P-Plan Ontology

- **Identity:** Daniel Garijo & Yolanda Gil, 2012–2014. DOI: 10.1007/978-3-642-38288-8_49. Primary: https://www.opmw.org/model/p-plan/
- **Why it matters / rung:** Extends PROV with prospective plans, ordered steps, variables, inputs/outputs, and correspondence to executions; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology documentation: plans are composed of steps and variables, and executions correspond to plan elements. It can host a sessionization plan but does not provide one.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters and provenance can be instantiated; executable code linkage is application-specific. OWL is reusable. **Access: full specification/artifact inspected.**

### E55. Open Provenance Model for Workflows (OPMW)

- **Identity:** Daniel Garijo & Yolanda Gil, 2011–current. DOI: 10.1145/2457317.2457375. Primary: https://www.opmw.org/model/OPMW/
- **Why it matters / rung:** Models workflow templates, parameter variables, data variables, execution processes/artifacts, and provenance; N/A rung.
- **Formal/rule statement:** VERIFIED in documentation: a workflow template declares steps and variables; an execution process consumes/generates execution artifacts. Algorithm semantics remain in linked code/software.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters, code/software, and execution provenance can be referenced, making a properly populated workflow rerunnable. No domain pairing/fallback rule included. **Access: full specification/artifact inspected.**

### E56. ProvONE Data Model

- **Identity:** DataONE Provenance Working Group, 2015. DOI: not assigned. Primary: https://jenkins-1.dataone.org/jenkins/job/ProvONE-Documentation-1.0.0/ws/provenance/ProvONE/v1/provone.html
- **Why it matters / rung:** Integrates prospective scientific workflow structure with retrospective execution provenance; N/A rung.
- **Formal/rule statement:** VERIFIED in specification: programs, ports, channels, executions, entities, and associations represent workflow design and runs. No built-in screen-session construction.
- **Thresholds/provenance; data/code/rerunnability; access:** Can represent parameters and exact run lineage; rerun requires referenced code/environment. Ontology is downloadable. **Access: full specification inspected.**

### E57. Workflow Run RO-Crate

- **Identity:** Stian Soiland-Reyes et al., 2024. DOI: 10.48550/arXiv.2312.07852. Preprint: https://arxiv.org/abs/2312.07852 ; profiles: https://www.researchobject.org/workflow-run-crate/profiles/
- **Why it matters / rung:** Packages workflow, inputs, outputs, software, parameters, and run provenance at process/workflow/step granularity; N/A rung.
- **Formal/rule statement:** VERIFIED in profiles: prospective workflow and retrospective run metadata are linked. It packages an implementation but does not define target-domain logic.
- **Thresholds/provenance; data/code/rerunnability; access:** Excellent vehicle for threshold/version/code/environment provenance and reruns when artifacts are included. **Access: full preprint and profiles inspected.**

### E58. REPRODUCE-ME Ontology

- **Identity:** Sheeba Samuel & Birgitta König-Ries et al., 2022. DOI: 10.1186/s13326-021-00253-1. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC8734275/
- **Why it matters / rung:** Models experiments, ordered steps, time, agents, data, procedures, settings, parameters, and results for reproducibility; N/A rung.
- **Formal/rule statement:** VERIFIED, formal definition section: a scientific experiment includes steps/order/time/agents/data/standardized procedures/settings/environment and generates a result.
- **Thresholds/provenance; data/code/rerunnability; access:** Can record transformation parameters and provenance. Rerunnability depends on linked executable resources; ontology/examples are available. **Access: full text inspected.**

### E59. ProvCaRe: Provenance for Clinical and Healthcare Research

- **Identity:** Satya S. Sahoo et al., 2017. DOI: 10.1186/s13326-017-0127-z. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC5333253/
- **Why it matters / rung:** Extends PROV-O for biomedical research workflows, study data, agents, and processes; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology description: prospective and retrospective provenance terms represent research processes and data derivations. No universal event-pairing rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Strong provenance representation; threshold/code detail depends on instance data. Ontology and examples are available. **Access: full text inspected.**

### E60. Neuroimaging Data Model Results (NIDM-Results)

- **Identity:** Camille Maumet et al., 2016. DOI: 10.1038/sdata.2016.102. Specification: https://nidm.nidash.org/specs/nidm-results.html ; full paper: https://www.nature.com/articles/sdata2016102
- **Why it matters / rung:** Domain example of PROV-based linkage among input data, workflow/software, parameters, statistical maps, and derived results; N/A rung.
- **Formal/rule statement:** VERIFIED in specification: entities and activities describe model fitting, contrasts, inference, software, inputs, and outputs. Domain computations are identified but not redefined as general ontology rules.
- **Thresholds/provenance; data/code/rerunnability; access:** Statistical thresholds and software versions are representable; export tools support reproducibility. No screen-event semantics. **Access: full specification and paper inspected.**

### E61. Data Quality Vocabulary (DQV)

- **Identity:** W3C Data on the Web Best Practices Working Group, 2016. DOI: N/A. Primary: https://www.w3.org/TR/vocab-dqv/
- **Why it matters / rung:** Standard vocabulary for quality dimensions, metrics, measurements, values, annotations, and policies; N/A rung.
- **Formal/rule statement:** VERIFIED in specification: a `dqv:Metric` represents a standard/procedure for measuring quality and a `dqv:QualityMeasurement` records the value. It does not require executable metric logic.
- **Thresholds/provenance; data/code/rerunnability; access:** Threshold/policy/provenance can be linked but are not inherently executable. RDF vocabulary is reusable. **Access: full specification inspected.**

### E62. Data Quality Definitions (DQD) Ontology

- **Identity:** Michael Schrott, Oliver Meindl, Martin Lettner, Wolfram Wöß & Lisa Ehrlinger, 2024. DOI: 10.1007/978-3-031-65990-4_27. Artifact: https://dqm.faw.jku.at/ontologies/dqd/0.5/index.html
- **Why it matters / rung:** Direct ontology for machine-readable data-quality measurement definitions and results; N/A rung.
- **Formal/rule statement:** VERIFIED in artifact documentation: the framework defines data-quality measurements; definitions serve as input to tools and metadata for measurement results.
- **Thresholds/provenance; data/code/rerunnability; access:** Conditions/parameters and result provenance can be represented; compatible tooling can execute definitions. No screen episode construction included. **Access: full artifact/documentation inspected.**

### E63. A Data Quality Ontology for the Secondary Use of EHR Data

- **Identity:** Steve Johnson, Stuart Speedie, Gyorgy J. Simon, Vipin Kumar & Bonnie L. Westra, 2015. DOI: not assigned. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC4765682/
- **Why it matters / rung:** Defines computable measurement concepts and a measurement process/method/result pattern; N/A rung.
- **Formal/rule statement:** VERIFIED in model: a measurement process applies a measurement method to a dataset and yields a measurement result; constraints are intended to be precise and computable.
- **Thresholds/provenance; data/code/rerunnability; access:** Four dimensions and 19 measures are defined; method parameters and provenance can be instantiated. Detailed example supports reimplementation; code package not verified. **Access: full text inspected.**

### E64. Application of an Ontology for Characterizing Data Quality for a Secondary Use of EHR Data

- **Identity:** Steve G. Johnson, Stuart Speedie, Gyorgy Simon, Vipin Kumar & Bonnie L. Westra, 2016. DOI: 10.4338/ACI-2015-08-RA-0107. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC4817336/
- **Why it matters / rung:** Separate applied evaluation showing that ontology-defined measures can drive automated computation; N/A rung.
- **Formal/rule statement:** VERIFIED in methods: ontology-based definitions are operationalized against EHR data to calculate data-quality results. This is a close precedent for executable derived measurement, not temporal phone sessions.
- **Thresholds/provenance; data/code/rerunnability; access:** Measure constraints and source data mappings are described; code/data availability is limited by clinical data access. **Access: full text inspected.**

### E65. Ontology of Biological and Clinical Statistics (OBCS)

- **Identity:** Jie Zheng et al., 2016. DOI: 10.1186/s13326-016-0100-2. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC5024438/
- **Why it matters / rung:** Models statistical analyses, data transformations, inputs/outputs, software, and parameters using OBI-aligned planned processes; N/A rung.
- **Formal/rule statement:** VERIFIED in ontology sections: statistical data transformations/analyses are planned processes consuming input data and producing output data.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters/software/provenance can be represented; actual executable code is linked externally. Ontology is downloadable. **Access: full text inspected.**

## E. Measurement interoperability and reproducible computation neighbors

### E66. IEEE 1752.1 / 1752.2 — Mobile Health Data and Metadata Standards

- **Identity:** IEEE Standards Association, 2021–2022. DOI: N/A. Primary metadata: https://standards.ieee.org/ieee/1752.2/10610/
- **Why it matters / rung:** Standardizes representations/metadata for mobile-health measures such as physical activity and sleep, a direct mobile-derived-measure neighbor; N/A rung.
- **Formal/rule statement:** UNDETERMINED because normative text was paywalled. No accessible evidence established a screen-time event-to-episode rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Metadata standardization is the purpose, but exact threshold/provenance requirements and executable artifacts could not be verified. **Access: metadata only.**

### E67. Open mHealth Schemas

- **Identity:** Open mHealth community, 2014–current. DOI: N/A. Primary: https://www.openmhealth.org/mhealth-schema/ ; artifacts: https://github.com/openmhealth/schemas
- **Why it matters / rung:** Concrete schemas for interoperable mobile-health observations and derived measures; N/A rung.
- **Formal/rule statement:** VERIFIED in schema repository: schemas constrain fields/units/metadata for measures. They do not generally encode the algorithm that derives a measure from raw events.
- **Thresholds/provenance; data/code/rerunnability; access:** Source/temporal metadata are representable; thresholds and algorithm versions are application-defined. JSON Schemas/tests are directly reusable. **Access: artifacts/documentation inspected.**

### E68. ML-Schema: Exposing the Semantics of Machine Learning with Schemas and Ontologies

- **Identity:** P. Publio et al., 2018. DOI: 10.48550/arXiv.1807.05351. Full preprint: https://arxiv.org/abs/1807.05351
- **Why it matters / rung:** Generic ontology for algorithms, datasets, tasks, experiments, implementations, hyperparameters, and results; N/A rung.
- **Formal/rule statement:** VERIFIED in model: executions connect algorithms/implementations, data, parameters, and outputs. It records a derivation experiment but does not formalize phone-session semantics.
- **Thresholds/provenance; data/code/rerunnability; access:** Hyperparameters and implementation provenance are first-class; rerun depends on linked code/data. Vocabulary artifact is available. **Access: full preprint inspected.**

### E69. MEX Vocabulary: Machine Learning Experiments

- **Identity:** Larissa C. Moreira et al., 2015. DOI: 10.1007/978-3-319-25007-6_14. Author full text: https://jens-lehmann.org/files/2015/semantics_mex.pdf
- **Why it matters / rung:** Models algorithms, configurations, executions, input features, datasets, and evaluation measures; N/A rung.
- **Formal/rule statement:** VERIFIED in vocabulary/model sections: experiment configurations connect algorithms and parameters to inputs and results. No event boundary/failure semantics.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters and execution provenance are representable; code/data links determine rerunnability. **Access: full text inspected.**

### E70. Metadata4Ing

- **Identity:** NFDI4Ing consortium, current release 1.3.1 (2025). DOI: 10.5281/zenodo.5957104 for releases. Primary artifact: https://nfdi4ing.pages.rwth-aachen.de/metadata4ing/metadata4ing/1.3.1/index.html
- **Why it matters / rung:** Engineering-research ontology with processing steps, inputs, outputs, tools, variables, and provenance; N/A rung.
- **Formal/rule statement:** VERIFIED in artifact: a processing step consumes input and produces output using tools/methods. The domain-specific transformation rule must still be supplied.
- **Thresholds/provenance; data/code/rerunnability; access:** Variables/parameters and provenance can be captured; rerun requires linked code/environment. OWL artifact is versioned. **Access: ontology artifact inspected.**

### E71. A Semantic Framework for Reproducible Variational Quantum Algorithm Execution Records

- **Identity:** Silvie Illésová & Martin Beseda, 2026. DOI: 10.48550/arXiv.2607.03982. Full preprint: https://arxiv.org/abs/2607.03982
- **Why it matters / rung:** Very recent ontology/SHACL approach for algorithms, parameters, executions, and results; retained to ensure the search is current through August 2026. N/A rung.
- **Formal/rule statement:** VERIFIED, abstract/model: the OWL ontology represents algorithms, circuits, optimizers, backends, noise models, mitigation, execution steps, software environments, measurement outcomes, and results; SHACL validates completeness and consistency. It does not supply smartphone event sessionization.
- **Thresholds/provenance; data/code/rerunnability; access:** Parameters, stopping criteria, software versions, and result provenance are explicit. The paper’s Data Availability section reports a replication package containing the ontology, SHACL shapes, SPARQL queries, example records, validation scripts, outputs, and documentation. **Access: full preprint inspected.**

### E72. V3 Framework for Algorithmic Digital-Health Measures

- **Identity:** Jennifer C. Goldsack et al., 2020. DOI: 10.1038/s41746-020-0260-4. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC7156507/
- **Why it matters / rung:** Verification, analytical validation, and clinical validation framework for biometric monitoring technologies and algorithmic measures; N/A rung as a framework paper.
- **Formal/rule statement:** VERIFIED in framework: the algorithmic “data supply chain” from sensor to measure must be evaluated across verification and validation stages. It is not an ontology and does not define an event-pair rule.
- **Thresholds/provenance; data/code/rerunnability; access:** Emphasizes prespecified algorithms and performance thresholds; it does not require executable code/provenance packaging. **Access: full text inspected.**

## Contradictions and claim corrections

1. **“No ontology exists for smartphone use/digital well-being” is no longer supportable.** OntoKratos (E15) is explicitly a problematic-smartphone-use ontology, and Nascimento et al. (E24) present an ontology-oriented digital-wellbeing scheme. Screenomics (E25) is a gray but relevant ontology project. The narrower absence is event-to-episode construction semantics.
2. **“No formal vocabulary requires or represents a derivation rule/method” is false.** GSIM (E53), DDI GenerationInstruction/SDTL (E51–E52), SOSA/OMS (E44–E45), IoT-Stream (E48), DQD (E62), and Johnson et al. (E63–E64) explicitly model rules, procedures, methods, parameters, or computable definitions.
3. **“Event-log standards lack semantic ontologies” is outdated.** Semantic OCED/OCEDO and gOCED (E30–E31), plus SHACL validation (E40), now provide semantic/formal layers. Their remaining gap is upstream domain extraction and failure semantics.
4. **“Intervals must always be reconstructed from event sequences” is too broad.** gOCED expressly supports defining intervals directly. The paper should distinguish directly asserted intervals from intervals derived by a declared construction rule.
5. **“Provenance makes a result reproducible” is too strong.** PROV-O alone records lineage; rerunnability generally also needs the plan, exact implementation, parameters, dependencies/environment, and inputs, as highlighted by P-Plan/OPMW/ProvONE/Workflow Run RO-Crate.

## Expected absences and residual gap matrix

| Capability | Strong precedents | Residual absence after inspection |
|---|---|---|
| Instants, intervals, duration, temporal relations | OWL-Time, UFO-B, Allen ontology, TEO, HED | These assume or annotate boundaries; they do not specify how Android/app events produce them. |
| First-class rule/method | GSIM, DDI/SDTL, SOSA/OMS, OBOE, DQD | Generic method slots do not supply screen/app-specific pairing semantics. |
| Inputs/outputs/parameters | GSIM, DDI/SDTL, IoT-Stream, P-Plan/OPMW, OBCS | No inspected source jointly declares app opener/closer types, ordering, thresholds, and failure branches. |
| Provenance/version/execution | PROV-O family, Workflow Run RO-Crate, NIDM, ML-Schema/MEX | A domain implementation and environment still need to be attached; ontology alone is not rerunnability. |
| Smartphone/digital-wellbeing concepts | OntoKratos, SmartOntoSensor, mobile-context ontologies, Screenomics | No inspected model makes screen/app session reconstruction a reusable ontological object. |
| Event abstraction/extraction | van Zelst et al., Liu et al., Fahland, OnProm/VKG | Methods remain heterogeneous/application-specific; missing-close behavior is not standardized. |
| Missing boundary event handling | MIMU-Wear has sensor-failure rules; HED requires matching onset/offset | No inspected source specifies timeout, censoring, synthetic close, discard, or other fallback as part of a phone episode-construction object. |

The expected and defensible absence is therefore not a missing upper ontology, time vocabulary, provenance standard, or generic derivation language. It is the lack of a **domain-grounded, executable and versioned construction specification** that binds all of these pieces for screen/app-usage events and explicitly treats failure cases.

## Query and dead-end log

### Neutral baseline query families

- `ontology event interval temporal extent start end duration`
- `formal event model interval construction raw events ontology`
- `smartphone use ontology app usage ontology screen time vocabulary`
- `mobile context ontology smartphone behavior semantic model`
- `digital wellbeing ontology screenomics ontology`
- `event log metamodel event abstraction extraction preprocessing ontology`
- `object centric event data ontology lifecycle timestamp duration`
- `derived measurement ontology rule method input output provenance`
- `data transformation vocabulary executable derivation rule ontology`
- `sensor observation procedure algorithm process chain standard`
- `workflow provenance parameters execution ontology reproducibility`
- `time series segment ontology stream analytics derivedFrom window`

### Synonym and competing-formalism expansions

- Episode synonyms: `session`, `interval`, `temporal scope`, `state`, `fluent`, `segment`, `case notion`, `high-level event`, `event abstraction`, `activity instance`.
- Raw-input synonyms: `sensor event`, `lifecycle transition`, `stream observation`, `screen state`, `application used`, `low-level event`, `audit log`, `legacy data`.
- Rule synonyms: `generation instruction`, `process method`, `plan specification`, `protocol`, `algorithm`, `command code`, `mapping`, `shape`, `metric`, `measurement method`, `analytics service`.
- Failure synonyms: `missing event`, `incomplete lifecycle`, `unmatched onset offset`, `sensor failure`, `censoring`, `timeout`, `fallback`, `imputation`, `synthetic close`.
- Independent literature strata were searched separately: foundational ontology/time; smartphone/context/behavior; process mining/event logs; sensor/observation; statistics/data-quality/workflow provenance.

### Limitation/negation probes

- `limitations OWL Time event boundaries reconstruction`
- `event abstraction process mining ad hoc raw event data`
- `missing lifecycle event start complete event log`
- `unmatched onset offset ontology`
- `ontology smartphone use no ontology problematic smartphone use`
- `derived measurement provenance not reproducible algorithm parameters`
- `object centric event data duration point in time limitation`

### Dead ends and why they were stopped

- `ontology screen time` was dominated by philosophical “ontology of cinema/time,” psychology papers using “ontology” colloquially, and SEO pages. Results were retained only when the source actually defined a vocabulary/ontology.
- `ontology app usage` mostly returned software dependency/usage ontologies or generic mobile-context work. Repeated variants did not reveal a formal app-session construction model, so the search moved to screen state, digital wellbeing, and smartphone behavior synonyms.
- Citation trails around SSN/IoT-Stream repeatedly cycled through SAO, IoT-Lite, and the same Surrey/CityPulse group. The search was capped there and expanded to DDI/GSIM, data quality, biomedical workflow provenance, process mining, and foundational time ontologies.
- Event knowledge graphs generally model reported real-world events (people, places, dates) rather than low-level device signals. They were sampled to establish category boundaries, not mined exhaustively.
- Wearable/activity ontologies often classify activities or choose sensors; they rarely specify temporal episode construction. MIMU-Wear was retained because its explicit failure rules are a useful contrast.
- XES and IEEE 1752 normative texts were not openly accessible. No unverified normative wording was inferred from secondary summaries; both remain `UNDETERMINED` for exact formal requirements.
- The 2024 digital-wellbeing chapter had only abstract-level access; it corrects an existence claim but cannot support a claim about exact OWL axioms or algorithms.
- No evidence was accepted merely because a paper cited a target source. Each counted entry is a distinct primary paper, specification, or artifact.

## Deduplicated bibliography (DOI/stable-key index)

1. OWL-Time — https://www.w3.org/TR/owl-time/
2. UFO-B — https://ceur-ws.org/Vol-2050/FOUST_paper_7.pdf
3. gUFO — 10.48550/arXiv.2603.20948
4. Allen time ontology — 10.4230/LIPIcs.TIME.2017.16
5. TEO — 10.1093/jamia/ocaa058
6. HuTO — 10.48550/arXiv.1506.05969
7. Temporally Enhanced Ontologies — 10.1007/978-3-319-26190-4_3
8. NdFluents — chapter DOI unconfirmed; use arXiv 1609.07102
9. Temporal Representation and Reasoning in OWL 2 — 10.3233/SW-150210
10. Quality Changes of Cells — 10.1186/s13326-019-0206-4
11. Ontology of Occurrents survey — 10.3233/AO-190217
12. HED temporal scope — https://www.hedtags.org/hed-specification/05_Advanced_annotation.html
13. EventKG — 10.1007/978-3-030-00668-6_18
14. OEKG — 10.48550/arXiv.2302.14688
15. OntoKratos — 10.3897/jucs.147898
16. SmartOntoSensor — 10.1155/2017/8790198
17. User Context Ontology — 10.1109/ACCESS.2021.3095300
18. COCCC — https://e-journal.uum.edu.my/index.php/jict/article/view/12347
19. CAMeOnto — 10.1016/j.aci.2017.08.001
20. High-Level Context Inference — 10.3390/s16101617
21. HBOnto/geo-located activity — 10.1016/j.knosys.2017.11.038
22. HASNetO — 10.48550/arXiv.1704.01806
23. MIMU-Wear — 10.1016/j.neucom.2016.09.125
24. Digital Well-Being Ontological Inquiry — 10.1007/978-3-031-61063-9_10
25. Screenomics project — https://mediax.stanford.edu/research-projects/screenomics-a-venue-for-developing-an-ontology-of-informal-learning-through-everyday-digital-media/
26. IEEE 1849 XES — 10.1109/IEEESTD.2016.7740858
27. OCEL 1.0 — 10.1007/978-3-030-85082-1_16
28. OCEL 2.0 — 10.5281/zenodo.8412919
29. OCED core — 10.48550/arXiv.2410.14495
30. Semantic OCED/OCEDO — 10.48550/arXiv.2511.03351
31. gOCED — 10.48550/arXiv.2512.14425
32. Event Abstraction review — 10.1007/s41066-020-00226-2
33. Turning Logs into Lumber — 10.1007/978-3-031-56107-8_8
34. Foundations of Process Event Data — 10.1007/978-3-031-08848-3_6
35. Extracting and Pre-Processing Event Logs — 10.48550/arXiv.2211.04338
36. OnProm — https://www.inf.unibz.it/~montali/papers/calvanese-etal-BIS2017-onprom.pdf
37. VKG OCEL extraction — 10.1007/978-3-031-27815-0_34
38. Databases and process mining — 10.1007/s10270-018-0664-7
39. Event-log preprocessing review — 10.3390/app112210556
40. Semantic validation of event logs — https://ceur-ws.org/Vol-4171/paper_68.pdf
41. Event knowledge graphs for process mining — 10.1007/978-3-031-08848-3_9
42. Advanced case notions — 10.1007/978-3-031-82225-4_30
43. PROV-O — https://www.w3.org/TR/prov-o/
44. SOSA/SSN — https://www.w3.org/TR/vocab-ssn/
45. OMS/ISO 19156 — https://docs.ogc.org/as/20-082r4/20-082r4.html
46. OBOE — 10.48550/arXiv.1009.0585
47. IAO/OBI — 10.1038/nbt.1622
48. IoT-Stream — 10.3390/s20040953
49. SAO — 10.1109/iThings.2014.39
50. SemTS — https://semts-ontology.github.io/SemTS/ontology/current/index.html
51. DDI GenerationInstruction — https://docs.ddialliance.org/DDI-Lifecycle/3.3/model/item-types/GenerationInstruction/
52. SDTL — https://docs.ddialliance.org/SDTL/1.0/model/use-cases/
53. GSIM 1.2 — https://statswiki.unece.org/spaces/gsim/pages/260407605/GSIM+v1.2+Glossary
54. P-Plan — 10.1007/978-3-642-38288-8_49
55. OPMW — 10.1145/2457317.2457375
56. ProvONE — https://jenkins-1.dataone.org/jenkins/job/ProvONE-Documentation-1.0.0/ws/provenance/ProvONE/v1/provone.html
57. Workflow Run RO-Crate — 10.48550/arXiv.2312.07852
58. REPRODUCE-ME — 10.1186/s13326-021-00253-1
59. ProvCaRe — 10.1186/s13326-017-0127-z
60. NIDM-Results — 10.1038/sdata.2016.102
61. DQV — https://www.w3.org/TR/vocab-dqv/
62. DQD — 10.1007/978-3-031-65990-4_27
63. EHR DQ ontology — https://pmc.ncbi.nlm.nih.gov/articles/PMC4765682/
64. Applied EHR DQ ontology — 10.4338/ACI-2015-08-RA-0107
65. OBCS — 10.1186/s13326-016-0100-2
66. IEEE 1752 — https://standards.ieee.org/ieee/1752.2/10610/
67. Open mHealth — https://github.com/openmhealth/schemas
68. ML-Schema — 10.48550/arXiv.1807.05351
69. MEX — 10.1007/978-3-319-25007-6_14
70. Metadata4Ing — 10.5281/zenodo.5957104
71. VQA execution-record ontology — 10.48550/arXiv.2607.03982
72. V3 framework — 10.1038/s41746-020-0260-4
73. Reference data model for process-related UI logs — 10.1007/978-3-031-16103-2_7
74. Activity Streams 2.0 — https://www.w3.org/TR/activitystreams-core/
75. OGC SensorThings API Part 1 v1.1 — https://docs.ogc.org/is/18-088/18-088.html
76. OpenTelemetry session semantic conventions — https://opentelemetry.io/docs/specs/semconv/general/session/

## Bottom-line language suitable for the paper

> Prior standards and ontologies separately formalize temporal intervals, observation procedures, transformation rules, stream analytics, workflow execution, and provenance, and recent ontologies also cover smartphone-use and digital-wellbeing concepts. We did not identify a model that integrates these elements into a reusable, executable specification for constructing screen/app-usage episodes from raw device events, including explicit opener/closer semantics, parameterized thresholds, and declared handling of missing or inconsistent boundary events.

This wording is supported by the searched corpus while avoiding an overbroad “first ontology” or “no prior formalism” claim.

<!-- chatgpt-pro-delta-20260805:E -->

## Independently reviewed additions — Slice E

### E73. Abb & Rehse (2022) — *A Reference Data Model for Process-Related User Interaction Logs*

- **Stable source.** [DOI 10.1007/978-3-031-16103-2_7](https://doi.org/10.1007/978-3-031-16103-2_7); [preprint](https://doi.org/10.48550/arXiv.2207.12054). The 2024 Information Systems article at DOI `10.1016/j.is.2024.102386` is an expanded version and is not counted separately.
- **Why it matters here.** **Closest representation-level threat:** it models raw user-interaction logs while deliberately leaving the case/episode notion outside the base schema.
- **Instrument and ladder rung.** Desktop user-interaction log schema; **N/A**.
- **Episode reconstruction rule.** **DELEGATED to the instantiator.** Reviewed logs are “initially unlabeled,” and “the case notion needs to be defined at the point of instantiation” (design requirements/data-model discussion).
- **Session threshold.** No threshold; the model represents events and context without prescribing a case-construction algorithm.
- **Availability.** XES extension/reference implementation and supplementary GitLab materials are described. Representation is rerunnable; episode construction is not standardized.
- **Access.** Full arXiv manuscript plus Springer metadata; **full text**.

### E74. World Wide Web Consortium (2017) — *Activity Streams 2.0*

- **Stable source.** [W3C Recommendation](https://www.w3.org/TR/activitystreams-core/).
- **Why it matters here.** An authoritative event/activity representation provides optional starts, ends, durations, actors, objects, targets, origins, results, and instruments but no normative raw-event→episode policy.
- **Instrument and ladder rung.** **N/A**.
- **Episode reconstruction rule.** **N/A / ABSENT as a derivation standard.** Activity objects can describe actions occurring in time, but the Recommendation does not say how punctual device logs become one activity interval.
- **Session threshold.** No threshold.
- **Availability.** Open Recommendation, JSON-LD context, implementation report, and examples. Representation is independently implementable; boundary derivation remains external.
- **Access.** Full authoritative specification; **full text**.

### E75. Open Geospatial Consortium (2021) — *OGC SensorThings API Part 1: Sensing, Version 1.1* (OGC 18-088)

- **Stable source.** [OGC 18-088](https://docs.ogc.org/is/18-088/18-088.html).
- **Why it matters here.** It distinguishes occurrence/phenomenon time, result time, valid time, and interval-valued phenomena, preventing conflation of source-event time with derived-episode time.
- **Instrument and ladder rung.** **N/A**.
- **Episode reconstruction rule.** **N/A / ABSENT as a builder.** `phenomenonTime` is “the time instant or period of when the Observation happens,” but the standard does not infer intervals from punctual observations.
- **Session threshold.** No threshold.
- **Availability.** Open normative standard and schemas/API conformance material. Serialization/query is independently implementable; episode construction is external.
- **Access.** Full authoritative specification; **full text**.

### E76. OpenTelemetry (live specification, accessed 2026) — *Semantic Conventions for Session*

- **Stable source.** [OpenTelemetry session conventions](https://opentelemetry.io/docs/specs/semconv/general/session/).
- **Why it matters here.** It represents sessions across logs, events, and spans with explicit identifiers and lifecycle events while delegating timeout/inactivity policy to the application.
- **Instrument and ladder rung.** **N/A**.
- **Episode reconstruction rule.** **DELEGATED to the instrumented application.** A session is “the period of time encompassing all activities performed by the application”; end of life is typically caused by inactivity or timeout (session overview/lifecycle).
- **Session threshold.** No numeric threshold; a new identifier follows timeout/end-of-life, but the convention does not choose the duration.
- **Availability.** Open specification and GitHub-maintained convention sources. Representation is independently implementable; boundary selection remains external. Status was **Development** at access time.
- **Access.** Full authoritative specification; **full text**.

---

## Executable-rule and direct-device ontology expansion (2026-08-06)

All 18 records below were absent by exact identifier/title scan across the repository before retention. Generic metadata catalogs and web/clickstream formalisms were excluded unless they contributed a directly transferable event→interval rule, validation/error semantics, or device-sensor implementation.

### E77. Xu, Gallifant, Johnson & McDermott (2025) — *ACES: Automatic Cohort Extraction System for Event-Stream Datasets*

- **Stable source.** [arXiv DOI 10.48550/arXiv.2406.19653](https://doi.org/10.48550/arXiv.2406.19653); [ICLR paper](https://proceedings.iclr.cc/paper_files/paper/2025/hash/d8542126cd3e0dd6c0a44e0aa1957072-Abstract-Conference.html); [code](https://github.com/justin13601/ACES).
- **Why / rung.** **Major formalism threat:** human-readable executable YAML converts typed punctual streams into temporal windows/labels; **N/A** mobile rung.
- **Formal rule.** Separates plain/derived predicates, triggers, nested time/event-bounded windows, offsets, next/previous predicates, record boundaries, endpoint inclusivity, occurrence constraints, labels, and index time.
- **Thresholds/failure/provenance.** Value ranges, offsets, minimum durations, and counts are parameters; illegal definitions raise errors and logs report exclusions, but per-output provenance/acquisition-failure taxonomy is limited.
- **Availability.** MIT package, samples, tests, CLI, docs, and MEDS/ESGPT adapters; rerunnable.
- **Access.** Open paper/code/docs, checked 2026-08-06.

### E78. Digital Medicine Society (2024; updated 2026) — *Ontology of Number of Walking Bouts at Specified Bout Durations*

- **Stable source.** [Official DiMe resource](https://dimesociety.org/resources/ontology-walking-bout/) and downloadable ontology PDF; no DOI located.
- **Why / rung.** **Closest domain analogue:** walking bouts and screen-use episodes both require start/end, minimum duration, inter-bout gap, qualifying evidence, and aggregation; **N/A** rung.
- **Formal rule.** Represents bout start/end, minimum duration/gap, step/stride/cadence criteria, bounded duration classes, and count/average/min/max summaries.
- **Thresholds/failure/provenance.** Examples include **≥30 s**, 3- or 20-second gaps, two strides/six steps; records model, algorithm, form factor, GPS, wear location, person/environment. No malformed-sequence branches.
- **Availability.** Conceptual PDF only; no OWL/RDF artifact, engine, validation suite, or code found.
- **Access.** Official artifact inspected 2026-08-06.

### E79. Polo-Rodríguez et al. (2025) — *Modelling Key Health Indicators from Sensor Data Using Knowledge Graphs and Fuzzy Logic*

- **Stable source.** [DOI 10.3390/electronics14122459](https://doi.org/10.3390/electronics14122459); [data/notebooks](https://github.com/AuroraPR/Fuzzy-Health-KPI).
- **Why / rung.** Executable wearable/ambient stream→behavioral interval/indicator system with public raw data; **Rung 3 analogue**.
- **Formal rule.** Fuzzy streams and protoforms `[Q] V [T] [L]` combine quantifier, value, temporal window, and location; fuzzy rules create knowledge-graph edges and higher-level sleep/toileting/walking/caregiver indicators.
- **Thresholds/failure/provenance.** Includes sleep 6–8 h/day, nocturnal and 2–4-minute toileting windows, distance thresholds, and alpha-cut defuzzification; graded membership handles uncertainty, but per-output provenance is limited.
- **Availability.** Raw data and notebooks public; rerunnable.
- **Access.** Full open text/repository, checked 2026-08-06.

### E80. Stavropoulos et al. (2021) — *Detection of Health-Related Events and Behaviours from Wearable Sensor Lifestyle Data Using Symbolic Intelligence*

- **Stable source.** [DOI 10.3390/s21186230](https://doi.org/10.3390/s21186230); [PMC8470200](https://pmc.ncbi.nlm.nih.gov/articles/PMC8470200/).
- **Why / rung.** OWL 2 plus executable SHACL/SPARQL derives high-level events from wearable lifestyle observations; **Rung 3 analogue**.
- **Formal rule.** SHACL rules use daily aggregation, temporal relations, counts, ratios, conjunctions, and duration constraints to materialize RDF triples.
- **Thresholds/failure/provenance.** Examples: sleep latency **>1800 s**, interruptions **>10/day**, sleep **>480 or <300 min**, efficiency **<85%**; SHACL exposes violations but lacks complete result provenance/raw failure recovery.
- **Availability.** Ontology axioms/rules in paper; maintained public code/artifact not located.
- **Access.** Full open article, checked 2026-08-06.

### E81. Sejdiu, Mazrekaj & Ahmedi (2026) — *Real-Time Semantic Interpretation of IoT Sensor Data for Patient Health Monitoring*

- **Stable source.** [DOI 10.1016/j.websem.2026.100880](https://doi.org/10.1016/j.websem.2026.100880).
- **Why / rung.** Real-time raw wearable/IoT observation→ontology status/composite-condition pipeline; **Rung 3 analogue**.
- **Formal rule.** Deterministic range classification materializes one status per observation; co-occurrence within defined windows derives composite conditions over >100 ontology classes.
- **Thresholds/failure/provenance.** Guideline thresholds for vitals/sleep/activity; null-safe delayed/missing/corrupt handling, checkpoint recovery, replication, authentication. No personalized or per-output provenance graph.
- **Availability.** Hybrid Apple Watch/simulated data; no public ontology/code/data located.
- **Access.** Full open publisher article, checked 2026-08-06.

### E82. Kawu, O’Sullivan & Hederman (2025) — *WearPGHDProvO: An Extension of PGHDProvO for Wearables*

- **Stable source.** [DOI 10.3233/SHTI251545](https://doi.org/10.3233/SHTI251545); [ontology](https://w3id.org/wearpghdprovo#).
- **Why / rung.** Wearable-specific provenance ontology for daily activity, sleep sessions/stages, stress, and vital signs; **N/A** rung.
- **Formal rule.** Extends PROV-O/PGHDProvO/SAREF with device/vendor concepts, activity/sleep/stress classes, stages/levels, source/platform annotations, and vendor-equivalence mappings.
- **Thresholds/failure/provenance.** Strong `prov:wasDerivedFrom`, agents, context, device/source/protocol; weak on executable rules, threshold semantics, and missing-boundary branches.
- **Availability.** Versioned OWL/docs public; HermiT/OOPS evaluation; empirical validation pending.
- **Access.** Open paper and ontology, checked 2026-08-06.

### E83. Dragoni & García-Castro / ETSI (2024–2025) — *SAREF4WEAR v2.1.1*

- **Stable source.** [Official ontology](https://saref.etsi.org/saref4wear/) and [ETSI TS 103 410-9](https://www.etsi.org/deliver/etsi_ts/103400_103499/10341009/02.01.01_60/ts_10341009v020101p.pdf); no DOI located.
- **Why / rung.** Current formal wearable device/observation ontology with wearer, interaction, sensing, occurrence, and health-monitoring concepts; **N/A** rung.
- **Formal rule.** Modular OWL-DL models device types/components/functions, wearer placement, sensors, measurements, occurrences, detection, notification, transmission, and health examples.
- **Thresholds/failure/provenance.** Carries device/observation context but no pairing algorithm, thresholds, boundary failures, or transformation lineage.
- **Availability.** Versioned RDF/Turtle, requirements, tests, examples, and ETSI Forge history public.
- **Access.** Open standard/artifacts, checked 2026-08-06.

### E84. Marfoglia, Jhee & Coulet (2026) — *Clinical Data Goes MEDS? Let’s OWL Make Sense of It*

- **Stable source.** [arXiv DOI 10.48550/arXiv.2601.04164](https://doi.org/10.48550/arXiv.2601.04164); ontology [10.5281/zenodo.17953576](https://doi.org/10.5281/zenodo.17953576); converter [10.5281/zenodo.17953580](https://doi.org/10.5281/zenodo.17953580).
- **Why / rung.** Semantic typed-event representation with ETL provenance, time/value modalities, splits, and cutoffs; **N/A** rung.
- **Formal rule.** MEDS-OWL has 13 classes, 10 object properties, 20 data properties, 24 axioms; SHACL validates records and `meds2rdf` deterministically converts tables.
- **Thresholds/failure/provenance.** Strong structural validation and `prov:wasDerivedFrom`; no episode builder/gap/failure branches. Authors name interval/episode boundaries as future work.
- **Availability.** Ontology, converter, fixed-seed notebooks, synthetic/MIMIC demos public; rerunnable.
- **Access.** Open preprint/artifacts/code, checked 2026-08-06.

### E85. Gilani et al. (2026) — *Towards a Digital Biomarker Ontology: A Heart Failure Health Markers Application*

- **Stable source.** [SWAT4HCLS accepted-submission record](https://www.swat4ls.org/workshops/amsterdam2026/programme/accepted-submissions/#towards-a-digital-biomarker-ontology-a-heart-failure-health-markers-application); no DOI/artifact located.
- **Why / rung.** New ontology aligns wearable/home monitoring with clinically meaningful digital biomarkers; **N/A** rung.
- **Formal rule.** Competency-question model reuses SAREF, SNOMED, LOINC, QUDT, and FOAF; evaluated through SPARQL and transformed heart-failure data.
- **Thresholds/failure/provenance.** Public abstract does not expose derivation rules, intervals, thresholds, failure branches, or algorithm lineage.
- **Availability.** No serialization, code, data, or poster PDF located.
- **Access.** Accepted abstract only, checked 2026-08-06.

### E86. Huang, Li, Cui & Zhang (2026) — *A Logic-Based Temporal Cohort Discovery Engine*

- **Stable source.** [arXiv DOI 10.48550/arXiv.2607.21377](https://doi.org/10.48550/arXiv.2607.21377).
- **Why / rung.** **Major temporal-semantics threat:** dense-time raw physiological signal/annotation→duration-bounded event definitions and reusable phenotypes; **N/A** mobile rung.
- **Formal rule.** BEST maps labels to non-overlapping rational interval ensembles; QEL supplies exact displacement, bounded existence/universality, duration, co-occurrence, four `before` variants, bounded delay, stage restrictions, and washout/absence windows.
- **Thresholds/failure/provenance.** Demonstrates AASM-style **≥10 s** events and adjustable delays/exclusions. Requires normalized nonoverlapping intervals; templates are limited and arbitrary-QEL compilation is not yet available.
- **Availability.** Python/MongoDB prototype evaluated on synthetic data and NSRR CCSHS; no public code/query package located.
- **Access.** Full open preprint, checked 2026-08-06.

### E87. OHDSI (current through 2026) — *ATLAS/Circe Cohort Definitions and Cohort Eras*

- **Stable source.** [Book of OHDSI cohort chapter](https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html), [ATLAS](https://github.com/OHDSI/Atlas), and [CirceR](https://ohdsi.github.io/CirceR/); no single suite DOI.
- **Why / rung.** **Major mature event→interval threat:** explicit entry, inclusion/exclusion, exit, persistence/gap, and censoring policies compiled to SQL; **N/A** mobile rung.
- **Formal rule.** Any OMOP event can trigger entry; temporal criteria/exclusions define windows; exit may be observation end, offset, last related event, or censoring; exposure eras merge under a configurable gap.
- **Thresholds/failure/provenance.** Official example uses 365-day observation/history, exposure within seven days, and a **30-day permissible gap**. Validators check start≤end, overlap, duplicates, and observation bounds; JSON/SQL and inclusion statistics aid audit.
- **Availability.** Apache-licensed ATLAS/Circe/CohortGenerator, demo data, JSON import/export, SQL generation, and validation are public; rerunnable.
- **Access.** Open docs/code, checked 2026-08-06.

### E88. HL7 (FHIR R5 / current CQL) — *FHIR Measure plus Clinical Quality Language/ELM*

- **Stable source.** [FHIR R5 Measure](https://hl7.org/fhir/R5/measure.html), [CQL specification](https://cql.hl7.org/), and [open runtime/translator](https://github.com/cqframework/clinical_quality_language); no DOI.
- **Why / rung.** Versioned computable measure definitions can derive intervals/aggregates from events with explicit missing-data semantics; **N/A** rung.
- **Formal rule.** Canonical versioned Measure metadata references CQL/ELM libraries with typed expressions, functions/parameters, queries, inclusive/exclusive intervals, before/after/meets/overlaps, duration, aggregation, and null/uncertainty semantics.
- **Thresholds/failure/provenance.** Arbitrary thresholds/branches expressible; unknown bounds and illegal operations have specified behavior. Metadata carries version/authorship/effective period, but not full execution lineage.
- **Availability.** Open schemas/examples and Apache CQL translator/runtime; multiple FHIR implementations.
- **Access.** Open authoritative specs/code, checked 2026-08-06.

### E89. Chapman, Rasmussen, Pacheco & Curcin (2021) — *Phenoflow: A Microservice Architecture for Portable Workflow-Based Phenotype Definitions*

- **Stable source.** [PMC8378606](https://pmc.ncbi.nlm.nih.gov/articles/PMC8378606/); preprint [DOI 10.1101/2020.07.01.20144196](https://doi.org/10.1101/2020.07.01.20144196); [code](https://github.com/kclhi/phenoflow).
- **Why / rung.** Converts prose phenotypes into layered, portable executable definitions; **N/A** rung.
- **Formal rule.** Abstract ordered/nested `load`/`logic`/`boolean`/`output` steps; functional I/O semantics; computational bindings/environments; generator emits CWL with swappable Python/JavaScript/KNIME modules.
- **Thresholds/failure/provenance.** Thresholds live in implementation units; explicit step→code/environment/I/O linkage is auditable but not row-level lineage.
- **Availability.** Public CWL packages/source; evaluated on COVID/diabetes phenotypes; rerunnable.
- **Access.** Full open article/code, checked 2026-08-06.

### E90. Calbimonte et al. (2017) — *Semantic Representation and Processing of Hypoglycemic Events Derived from Wearable Sensor Data*

- **Stable source.** [DOI 10.3233/AIS-160420](https://doi.org/10.3233/AIS-160420); [author record](https://infoscience.epfl.ch/entities/publication/5257177f-286f-47de-b5af-9ff1d9ebd642); [ontology link](https://github.com/jpcik/d1namo/blob/master/d1namo.owl).
- **Why / rung.** Layered raw wearable measurement→semantic event→continuous query/notification pipeline; **Rung 3 analogue**.
- **Formal rule.** D1namo OWL models sensor observations; ECG/accelerometer/breathing/activity/meals/insulin transform to features and high-level glycemic/activity events processed as RDF streams.
- **Thresholds/failure/provenance.** Links derived data to source/method provenance, but lacks a general declarative gap/duration language and prominent failure branches.
- **Availability.** Ontology/dataset reported; current end-to-end executability undetermined.
- **Access.** Author manuscript/record and artifact inspected 2026-08-06.

### E91. DDI Alliance (2025) — *DDI Cross-Domain Integration 1.0*

- **Stable source.** [DDI-CDI 1.0](https://ddialliance.org/ddi-cdi), [model specification](https://ddialliance.org/Specification/DDI-CDI/1.0/DDI-CDI_Model_Specification.pdf), and [source](https://github.com/ddi-cdi/ddi-cdi); no DOI.
- **Why / rung.** **Major metadata-model threat:** punctual events, bounded spells, temporal control, rules, and datum-level lineage in one cross-domain model; **N/A** rung.
- **Formal rule.** UML/XML/JSON-LD/OWL represents Event Data and Spell Data; process agents/activities/steps/I/O/parameters, deterministic/nondeterministic control, Allen relations, rule scheduling, and linked commands/scripts.
- **Thresholds/failure/provenance.** Can package thresholds/conditions and datum lineage, but v1.0 emphasizes retrospective provenance; runtime/prospective provenance often remains external.
- **Availability.** Complete schemas, ontologies, examples, docs, and source public; representation rerunnable, not itself a runtime.
- **Access.** Open specification/artifacts, checked 2026-08-06.

### E92. SDMX Secretariat VTL Task Force (2024) — *Validation and Transformation Language 2.1*

- **Stable source.** [VTL 2.1 page](https://sdmx.org/validation-and-transformation-language-vtl/) and [reference manual](https://sdmx.org/wp-content/uploads/VTL-2.1-Reference-Manual.pdf); no DOI.
- **Why / rung.** Technology-neutral executable/versionable transformation language expressive enough for many event→interval rules; **N/A** rung.
- **Formal rule.** Assignments, joins, filters, aggregation, conditionals, rulesets, analytic windows, `lag`/`lead`, first/last, `between`, date arithmetic, and time aggregation can pair neighbors, compute gaps, and emit episodes.
- **Thresholds/failure/provenance.** Named rules carry antecedent/consequent, error code/severity; `check` emits failures; null and I/O semantics specified. Run lineage needs a surrounding catalog/provenance model.
- **Availability.** Open syntax/semantics/EBNF/examples and multiple engines; exchangeable/rerunnable.
- **Access.** Open official manuals/docs, checked 2026-08-06.

### E93. Wehr, Freund & Harth (2024) — *Taking Control of Your Health Data: A Solid-Based Mobile App for Wearable Data Collection and RDF Visualization*

- **Stable source.** [DOI 10.1007/978-3-031-78952-6_53](https://doi.org/10.1007/978-3-031-78952-6_53); [paper](https://2024.eswc-conferences.org/wp-content/uploads/2024/05/77770325.pdf); [code/APK](https://github.com/derwehr/WoT-Solid/).
- **Why / rung.** Concrete Android semantic sensor pipeline from heterogeneous wearables through RDF/SOSA-SSN to user-controlled Solid storage; **Rung 3 analogue**.
- **Formal rule.** WoT Thing Descriptions expose device interfaces; observations become SOSA/SSN RDF and are stored/queryable in Solid.
- **Thresholds/failure/provenance.** Good source/device semantics, but no episode DSL, threshold vocabulary, or formal failure branches.
- **Availability.** Public code, demos, APK; implementation rerunnable.
- **Access.** Conference paper/code, checked 2026-08-06.

### E94. IEEE P2791 BioCompute Working Group (2020) — *IEEE 2791-2020 BioCompute Object*

- **Stable source.** [DOI 10.1109/IEEESTD.2020.9094416](https://doi.org/10.1109/IEEESTD.2020.9094416); [open docs/schema](https://docs.biocomputeobject.org/); [source](https://github.com/biocompute-objects/BCO_Specification).
- **Why / rung.** Parameter/error-rich versioned envelope for exact preprocessing code, inputs/outputs, environment, provenance, and rerun expectations; **N/A** rung.
- **Formal rule.** JSON Schema object has provenance, usability, ordered steps, execution, parameters, I/O, error, and extension domains with identifiers, etags, and signatures.
- **Thresholds/failure/provenance.** Strong for threshold parameters, expected error ranges, code/environment, authors/review/version/integrity; event pairing semantics remain in referenced workflow.
- **Availability.** Open schemas/examples/validators/builders and Galaxy/CWL integrations; IEEE prose access may vary.
- **Access.** Authoritative supporting specification/artifacts, checked 2026-08-06.

### Slice E expansion count

- **New records:** E77–E94 = **18**.
- **Authoritative Slice E total:** **94** sources.
- **Residual gap:** no retained item combines mobile-specific typed events, versioned executable pairing/repair policy, thresholds/inclusivity, malformed/unpaired/duplicate/out-of-order branches, clock assumptions, per-episode provenance, and validation fixtures in one artifact.

# Results — SLICE C: sessionization outside mobile

> **Independent expansion (2026-08-05):** A balanced pass plus the independently reviewed delta retained **66 distinct items** across web/clickstream, process-mining correlation/abstraction, and CDR/network/staypoint analogues, versus 17 numbered items in the initial concurrent pass. The appended ledger is the authoritative coverage/count audit; overlapping citations across passes are not additive.

Scope executed: web-analytics / server-log session reconstruction, clickstream and query-log
segmentation, process mining (event → case, event abstraction), telephony/CDR and mobile-phone
location processing, GPS staypoint detection, wearable/actigraphy epoch and bout definition.
One adjacent field was added deliberately (eye-tracking event detection) because it is the only
place found where the event→episode step has a *shared public benchmark with human ground truth*.

Access rules followed: `WebFetch` and `curl` only. No browser automation. Where a PDF could not be
parsed by `WebFetch`, it was downloaded with `curl` and converted with `pdftotext -layout`, then
read directly. Anything not read is marked UNDETERMINED and listed in §Not read.

---

## Headline

**The borrowable formulation exists and it is 24 years old.** Berendt/Mobasher/Nakagawa/Spiliopoulou
formalised exactly our step — a *sessionization heuristic* `h` maps a per-user activity log to
constructed sessions `C_h`, which are scored against a ground-truth set `R` of real sessions using
named categorical (recall/precision) and gradual (overlap/similarity) measures. It transfers to
Android `UsageEvents` essentially unchanged. See §1.

**The strongest citation threat is not in mobile at all.** Mehrzadi & Feitelson (2012) demonstrate,
with a figure, that the chosen threshold leaves a *visible fingerprint in the derived measure* —
"the distribution of resulting session durations reflects the threshold used to derive the
sessions" — and conclude the derived data is therefore "tainted". That is our thesis, in web search
logs, in 2012. See §3.

**The 30-minute number has a traceable and broken provenance chain.** Catledge & Pitkow → mean
inter-event gap 9.3 min + 1.5 SD = 25.5 min → "gradually been smoothed out to 30 minutes" → Google
Analytics 4 default → everything downstream. Three independent papers say the number does not
survive contact with data. Two of them disagree about the *year* of the source. See §Threshold
provenance.

---

## 1. Berendt, Mobasher, Nakagawa & Spiliopoulou (2002) — The Impact of Site Structure and User Environment on Session Reconstruction in Web Usage Analysis

WEBKDD 2002; also LNCS 2703 (Springer 2003).

- **Why it matters here.** This is the solved formulation. It defines the event→episode step as a
  first-class object with a name (`sessionization heuristic`), a ground truth (`R`), a constructed
  output (`C_h`), and six named quality measures. Nothing in the mobile screen-time literature we
  are writing against has this apparatus; we can adopt it wholesale.
- **Instrument and ladder rung.** N/A (HTTP server logs). Closest analogue: Rung 4 — raw platform
  event log, with the platform's own session identifiers available as ground truth.
- **Episode reconstruction rule.** DECLARED, three of them, §2.2 verbatim:
  - "**h1: Time-oriented heuristic:** The duration of a session may not exceed a threshold θ. This
    heuristic has its origins in research on the mean inactivity time within a site [CP95]."
  - "**h2: Time-oriented heuristic:** The time spent on a page may not exceed a threshold δ.
    Heuristics of this type are used in [CMS99, SF99]."
  - "**href: Referrer-based heuristic:** Let p and q be two consecutive page requests, with p
    belonging to a session S. Let t_p and t_q denote the timestamps for p and q, respectively.
    Then, q will be added to S if the referrer for q was previously invoked in S, or if the referrer
    is undefined and (t_q − t_p) ≤ Δ, for a specified time delay Δ. Otherwise, q is added to a new
    constructed session."
  - Framing, §2: "A *sessionization heuristic* is a method for performing such a segmentation on the
    basis of assumption about users' behavior or the site characteristics." And: "The goal of a
    heuristic is the faithful reconstruction of the *real sessions* … We denote the dataset of real
    sessions as R. … The result is a dataset of *constructed sessions*, which we denote as C ≡ C_h.
    For the ideal heuristic, C ≡ C_h = R."
- **Session threshold.** §2.2, verbatim: "In both settings, we have used the standard values
  **θ = 30 minutes maximum total duration for h1**, and **δ = 10 minutes maximum page stay time for
  h2** (see [CP95, CMS99, SF99])." And for `href`: "we have used a **default value of 10 seconds**
  for href's Δ, and also investigated the effect of varying this value."
  Kind: h1 = maximum session-length cutoff (not an inactivity gap); h2 = per-page dwell cutoff;
  href = structural rule with a small gap tolerance. Justification is *by citation only* —
  [CP95] = Catledge & Pitkow. Verbatim justification of the values themselves: "Previous
  experiments indicate a high robustness of these heuristics with respect to variations in the
  threshold parameters, and superior performance for the two values chosen."
- **The measures (this is the part to borrow), §3 verbatim.**
  - "The **complete reconstruction** measure M_cr(h) returns the number of real sessions contained
    in some constructed session, divided by the total number of real sessions. A session r is
    contained in a session c if and only if all its elements are in c, in their correct order, with
    no intervening foreign elements."
  - "complete reconstruction with correct entry page – recall", "…correct exit page – recall",
    "**identical reconstruction – recall**: M^recall_cr,entry−exit(h) is the number of real sessions
    that appear in C_h, i.e. the intersection of R and C_h, divided by the number of real sessions."
    Plus the three matching precision variants, divided by the number of *constructed* sessions.
  - Gradual: "**average maximal degree of overlap** M_o(h)" — for each real session take the
    constructed session with the maximum number of common elements, normalise by the length of the
    real session, average. And "**average maximal degree of similarity**" — same but divided by the
    size of the *union* (i.e. a Jaccard).
- **Result worth quoting against ourselves.** The three heuristics do not merely differ at the
  margin; they produce different *counts of episodes* from identical raw data. Table 1: real
  sessions in the frame-based log = 13,829; h1 → 14,234; h2 → 15,971; **href → 41,117**. §4.1: "It
  produces more than three times as many sessions as there actually are." Average session duration:
  real 31:56, h1 7:05, h2 3:49, href 7:12. This is the cleanest published demonstration in any field
  that the rule, not the data, sets the number.
- **Availability.** No data, no code. The evaluation *is* re-runnable in principle because R was
  obtained by a proactive mechanism: §4, "In the analyzed site, a cookie-based mechanism was used for
  user identification, and session IDs for splitting a users activities into sessions. This
  combination defined the reference set R of real sessions. The session identifiers were then
  removed, and each of the heuristics h … was employed to produce a set of constructed sessions C_h."
  **That ablation design is directly copyable for Android**: instrument a device to emit true episode
  boundaries, strip them, run each candidate rule, score with M_cr/M_o/M_s.
- **Access.** Full text, read in full (10 pp.), via `curl -k` on
  `facweb.cs.depaul.edu/mobasher/research/papers/webkdd02.pdf` (note: `WebFetch` failed this host
  with "unable to verify the first certificate"; `curl -k` succeeded).

## 2. Spiliopoulou, Mobasher, Berendt & Nakagawa (2003) — A Framework for the Evaluation of Session Reconstruction Heuristics in Web-Usage Analysis

INFORMS Journal on Computing 15(2):171–190.

- **Why it matters here.** The journal version of the framework in §1 above, and the canonical
  citation for it. Listed separately because it is the one a reviewer will expect us to cite.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** UNDETERMINED — not read. §1's own text refers to the
  companion/earlier papers ([BMSW01], [SMBN02]) as the source of the four categorical and two
  gradual measures, so the definitions quoted in §1 above are from a source I *did* read; do not
  attribute them to this paper without reading it.
- **Session threshold.** UNDETERMINED.
- **Availability.** UNDETERMINED.
- **Access.** **Metadata only.** `pubsonline.informs.org` not fetched (paywall).

## 3. Mehrzadi & Feitelson (2012) — On Extracting Session Data from Activity Logs

SYSTOR 2012, Haifa.

- **Why it matters here. CITATION THREAT — rank 1.** This paper already makes the core argument we
  intend to make, in a different data domain: that the choice of reconstruction parameter propagates
  into the derived measure and contaminates every downstream result. It is not a mobile paper and it
  does not treat the missing-close-event problem, so it does not preempt us — but any reviewer who
  knows it will ask why we did not cite it, and it must be cited prominently.
- **Instrument and ladder rung.** N/A (AOL 2006 web-search query log; timestamps for queries only,
  not clicks).
- **Episode reconstruction rule.** DECLARED, twice — once for the criticised baseline and once for
  their replacement.
  - Baseline, §3: "the dominant methodology to extract session data from activity logs is to
    postulate a certain threshold value, and assume that breaks in activity longer than this
    threshold represent sessions breaks."
  - Their algorithm, §4, with full pseudocode in Fig. 4: log-scale histogram with "bin boundaries at
    powers of 2"; "we only consider the bins ranging from **512 seconds** (slightly less than 10
    minutes) to **8192 seconds** (around 2¼ hours)"; "Each candidate bin is given a score, based on
    how much lower it is than the maxima on its two sides. Empty bins get a bonus."; "The threshold is
    placed in the highest-scoring bin."; "In case of a tie, the bin closest to **1200 seconds** (20
    minutes) is selected." The scoring is eight comparisons against 2/3, 1/2, 1/3, 1/6 of the left
    and right maxima, with `if (hist[bin] == 0) score = 5`.
- **Session threshold.** *Rejects* a global one. The load-bearing verbatim, §1: "we find that the
  distribution of derived session durations reflects the threshold used to derive the sessions. This
  is highly undesirable, because it implies that any research using the data about the sessions is
  also tainted and its results may depend on the precise threshold that was used." §3: "The
  distribution of resulting session durations has a pronounced break at the point of the threshold
  used to create it, with a sharp reduction in the number of sessions longer than the threshold
  value". Conclusion, §7: "the global distribution of inter-activity intervals is typically smooth,
  with no natural threshold value. Worse, using a global threshold may lead to artifacts that
  directly reflect the chosen threshold value … As a result it is nearly guaranteed that long
  sessions will not be identified correctly."
- **Threshold-provenance table.** Their Table 1 is a ready-made inheritance map and we should cite it
  as prior art for our own: general web surfing 10–15 min [10] / 30 min [20] / 2 hr [17]; web search
  5 min [24] / 30 min [6,7,13] / 1 hr [23]; e-commerce 30 min [16]; parallel supercomputers 20 min
  [21,27]. Plus §3: "global thresholds are also used by on-line utilities. For example, Google
  analytics uses a timeout of 30 minutes to define sessions."
- **Evaluation.** Honest and weak, and they say so, §5: "Regrettably, we do not have any ground-truth
  regarding real session breaks in the AOL log." Human labelling of 50 random users, 4,992 intervals:
  "there was consensus that 1334 constitute session breaks and 3384 are intervals within a session.
  There were only 4 gaps judged to be breaks by the human but not by the algorithm, leading to very
  high recall. However, the algorithm also identified 270 intervals as session breaks that were not
  considered breaks by the human, leading to only **83% precision**." Second, independent check §6:
  semantic agreement via query 4-gram Jaccard similarity — "Only about 7% of sequences of related
  queries were cut by a session boundary" and "79% of the sessions had only one topic in them."
- **Availability.** No code, no data release. AOL log is (notoriously) public, so the analysis is
  re-runnable by a third party; the labelling is not.
- **Access.** Full text, read in full (7 pp.), `curl` from `cs.huji.ac.il/w~feit/papers/Ses12SYSTOR.pdf`.

## 4. Halfaker, Keyes, Kluver, Thebault-Spieker, Nguyen, Shores, Uduwage & Warncke-Wang (2015) — User Session Identification Based on Strong Regularities in Inter-activity Time

WWW 2015 (ACM); read via arXiv:1411.2878v2.

- **Why it matters here.** The best available *method for deriving* a threshold rather than asserting
  one, evaluated across ten datasets from seven systems. If we want to argue that a screen-time
  threshold should be estimated from the data rather than inherited, this is the citation — and it is
  the one that supplies the per-domain spread showing a single constant cannot be right.
- **Instrument and ladder rung.** N/A (server request logs, edit logs, game logs).
- **Episode reconstruction rule.** DECLARED, §3.1: "Once we have generated per-user inter-activity
  times, we plot a histogram based on the logarithmically scaled inter-activity time and look for
  evidence of a valley." Then: "we try to fit a two component gaussian mixture model using expectation
  maximization and visually inspect the results"; and the threshold is "a theoretically optimal
  inter-activity threshold for identifying sessions by finding the point where inter-activity time is
  equally likely to be within the gaussians fit with sub-hour means (within-session) and gaussians fit
  with means beyond an hour (between-session)."
  Note the honest admission in fn. 3: "we tried several strategies for statistically confirming the
  most appropriate fit – of which we found Davies–Bouldin index(DBI) to be most reasonable – but none
  were as good as a simple visual inspection, so we employ and recommend the same."
- **Session threshold.** Recommended value 1 hour, kind = inactivity gap. Verbatim, §5: "our analysis
  suggests that setting an inactivity threshold to demarcate the end of a session at *one hour* will
  be appropropriate for most kinds of activity log analysis." [sic]. Justification is empirical, §4.1:
  "Each fit intersects at approximately one hour – with Wikimedia app views displaying the lowest
  intersection at 29 minutes while AOL searches display the highest intersect at 115 minutes – nearly
  two hours."
  **Their own Table 1 undercuts the rule of thumb and is the more useful artifact for us** — fitted
  thresholds in minutes: aol search 115, cyclopath route 89, wiki app 29, wiki mobile 50, wiki desktop
  46, osm changeset 101, wiki edit 80, movielens rating 33, movielens search 52, **league of legends
  14**, stack overflow answer 91, **stack overflow question 335**. A 24× spread across activity types
  on the same continent of "user-initiated events". §4.4 concedes: "the other datasets we observed
  suggest that the this strategy for identifying session thresholds is not universally suitable for
  all user-iniated events."
- **Availability.** No data or code availability statement in the preprint. A "Activity Sessions
  datasets" figshare record surfaced in search (figshare.com/articles/dataset/…/1291033) but was not
  fetched or verified — UNDETERMINED.
- **Access.** Full text, read in full (6 pp.), `curl` from `arxiv.org/pdf/1411.2878`. Note: passing
  an arXiv `/pdf/` URL to `WebFetch` returns unparsed PDF bytes; `curl` + local read is required.

## 5. Jones & Klinkner (2008) — Beyond the Session Timeout: Automatic Hierarchical Segmentation of Search Topics in Query Logs

CIKM 2008, pp. 699–708.

- **Why it matters here.** Two things. (a) It replaces the threshold with a *supervised classifier*
  over a labelled corpus and gets far better numbers — the strongest existence proof that the
  event→episode step can be posed as a learning problem with ground truth. (b) It introduces the
  **interleaving** formulation, which is the single most transferable idea in this slice: Android
  app episodes interleave constantly (foreground/background churn, split-screen, notification
  detours), and a pure boundary-detection framing cannot represent that.
- **Instrument and ladder rung.** N/A (Yahoo! Search query log).
- **Episode reconstruction rule.** DECLARED, and notable for *refusing* to conflate "session" with
  "episode of intent". §3 verbatim:
  - "**Definition 1.** A search session is all user activity within a fixed time window." Followed by:
    "A session, for us, is just a slice of user time. … ours does not, since we will be more specific
    with the terms goals and missions, defined below, and use inactivity as a *predictor*, rather than
    as a *definition*."
  - "**Definition 2.** A search goal is an atomic information need, resulting in one or more queries."
  - "**Definition 3.** A search mission is a related set of information needs, resulting in one or more
    goals."
  - Two learning tasks, §4.1: *task boundary detection* over consecutive pairs
    `{⟨q_i,q_j⟩ : (t(q_i) < t(q_j)) ∧ (∄q_k : t(q_i) < t(q_k) < t(q_j))} → {0,1}`, and
    *same-task identification* over **all** pairs `{⟨q_i,q_j⟩ : t(q_i) < t(q_j)} → {0,1}`.
- **Session threshold.** Evaluated, then rejected as a sole feature. §3.3 Table 3, goal-boundary
  accuracy: baseline 54.2%, 5 min 71.2%, **30 min 66.5%**, 60 min 64.2%, 120 min 62.0%, trained time
  71.2%. Mission-boundary: baseline 70.9%, 5 min 75.6%, 30 min 78.6%, 60 min 77.6%, 120 min 76.1%.
  Trained thresholds were "5 mins and 13 minutes, respectively". Verbatim §3.3: "in general there is
  no ideal choice of threshold, and using time the precision is capped at 70-80% … **The 30-minute
  standard receives no support from our results.**"
  **Flag a discrepancy for our own provenance section:** §2 asserts "We will show in Section 3.3 that
  this threshold is no better than random for identifying boundaries between user search tasks", and
  Halfaker et al. repeat it as "Jones & Klinkner found the 25.5 minute threshold performed 'no better
  than random.'" But §3.3's own Table 3 shows 30 min at 66.5% against a 54.2% baseline, and the text
  there says the opposite: "a 30-minute threshold on inter-query interval is more accurate than the
  baseline". The famous soundbite is not supported by the paper's own table. That is a threshold-lore
  inheritance failure of exactly the kind we are documenting.
- **Best results.** Table 9: goal boundary 87.3% (93.0% folding in repeats), mission boundary 84.4%
  (90.8%), vs. best prior published feature set `commonw+prisma+time` at 84%/82.1%. Table 10:
  same-goal 97.09%, same-mission 88.36%. Table 12 is quietly damning for time features: adding
  inter-query interval to edit-distance features moves goal-boundary accuracy from 85.0% to 85.0% —
  "The latter does not appear to help."
- **Corpus and prevalence figures worth reusing.** "312 user sessions, with 1820 missions, 2922 goals
  and 8226 queries", 3-day windows, exhaustive human annotation. "17% of tasks are interleaved, and
  20% are hierarchically organized." And the direct measurement-error statement, §3.2: "63% of goals
  are under one minute, but **15% spanned 30-minute periods of inactivity. This means that a 30 minute
  time-out will break up 15% of goals.**"
- **Availability.** No data (proprietary Yahoo! log), no code. Not re-runnable by a third party.
- **Access.** Full text, read in full (6 pp. extracted), `curl` from
  `dmice.ohsu.edu/bedricks/courses/cs606-ir/papers/jones_2008.pdf`.

## 6. Jin, Okamoto, Harada, Shibata & Karube (2024) — Similarity-Based Supervised User Session Segmentation Method for Behavior Logs

ISCIIA & ITCA 2024; arXiv:2508.16106v1.

- **Why it matters here.** The most recent named-algorithm-with-annotated-ground-truth in the
  clickstream lane, and evidence that the field's current framing is supervised binary classification
  over candidate boundaries — not thresholds. Useful as "here is what 2024 looks like" against a
  screen-time literature still quoting a 1995 constant.
- **Instrument and ladder rung.** N/A (Amazon M2 e-commerce behaviour logs, Japanese locale).
- **Episode reconstruction rule.** DECLARED: "each potential segmentation point is evaluated by
  computing the similarities within a local window centered on that point", with four similarity
  families (Item2Vec behaviour embedding, brand, title, price) fed to LightGBM/XGBoost/CatBoost/SVM/LR.
- **Session threshold.** None — no time threshold is used or compared. Baseline is an unsupervised
  cosine-similarity split between adjacent items. Window size 3 was best.
- **Ground truth.** "2,400 sessions were annotated" by "eight participants from the authors'
  laboratory"; 1,230 positive (boundary) and 9,674 negative examples. Agreement reported only as
  distributional similarity across annotators — no kappa.
- **Results.** LightGBM F1 0.806, PR-AUC 0.831; +10.71% F1 and +30.61% PR-AUC over baseline.
- **Availability.** Amazon M2 is public; the annotation labels have no stated release. No code
  statement found.
- **Access.** Full text via arXiv HTML (`arxiv.org/html/2508.16106v1`), read via `WebFetch`.

## 7. van Zelst, Mannhardt, de Leoni & Koschmider (2021) — Event abstraction in process mining: literature review and taxonomy

Granular Computing 6:719–736. Open Access.

- **Why it matters here.** Process mining has a *name* for our step and a taxonomy for classifying
  rules that implement it. "Event abstraction" = translating fine-granular events into coarse-granular
  activity instances. This gives us a vocabulary and a ready-made classification scheme for the
  Android reconstruction rules we are cataloguing, from a field that has been at it for a decade.
- **Instrument and ladder rung.** N/A (business-process event logs).
- **Episode reconstruction rule.** DECLARED as a general formalism, §3.1: "Typically, given a sequence
  of fine-granular events r, after applying an event abstraction technique a, we obtain a sequence r′
  of events, i.e., a(r) = r′, at a coarser granularity". And §2.4/§3.1 framing: low-level events from
  the physical world → high-level events by abstraction/aggregation → activity instances, which then
  still need *correlation* to process instances. Note the explicit scope exclusion, §3.1: "in this
  paper, we do not consider such event correlation challenges" — i.e. the "which episode does this
  event belong to" question is treated as a *separate* problem from "what episode type is this",
  which is a distinction our paper should adopt.
- **Taxonomy (7 dimensions), §3.3.** supervision strategy (supervised / unsupervised); fine-granular
  event interleaving (strictly sequential / interleaved); probabilistic nature of outcome
  (deterministic / probabilistic); data nature (discrete event data / continuous sensor data); use of
  alternative perspectives (control-flow only / exploits time, resource, cost, …); event class /
  activity class relation; event instance / activity instance relation.
  The *interleaving* dimension is the same distinction Jones & Klinkner (§5) drew independently in IR.
- **Session threshold.** N/A — no time constant is asserted anywhere; the field does not frame the
  problem that way.
- **Evaluation.** Weak spot, and it is a finding: the survey does not report a common benchmark or a
  shared ground truth for abstraction quality. The nearest remark located in text: an approach's
  behaviour "is not extensively evaluated nor further discussed" (§4 discussion of one technique).
  There is no cross-technique quantitative comparison table.
- **Availability.** Survey; no data/code. Open Access (CC BY).
- **Access.** Full text, read via `curl` + `pdftotext` from `d-nb.info/1238523943/34` (author copy at
  `sebastiaanvanzelst.com` exceeded `WebFetch`'s 10 MB content limit).

## 8. Bayomie, Di Ciccio & Mendling (2022) — Event-Case Correlation for Process Mining using Probabilistic Optimization (EC-SA-Data)

arXiv:2206.10009 (journal submission version).

- **Why it matters here.** A named algorithm for exactly "these timestamped events have no episode
  identifier — assign one", with an optimisation objective and quantitative evaluation. This is the
  process-mining answer to our problem, and the closest thing in this slice to a *principled* (not
  heuristic) event→episode assignment.
- **Instrument and ladder rung.** N/A (business-process logs, incl. BPIC17).
- **Episode reconstruction rule.** DECLARED, Abstract: "we propose a new technique called
  **EC-SA-Data** based on probabilistic optimization. The technique takes as inputs a sequence of
  timestamped events (the log without case IDs), a process model describing the underlying business
  process, and constraints over the event attributes. Our approach returns an event log in which
  every event is associated with a case identifier."
  Mechanism: multi-level simulated annealing (§3.3, §4), extending the earlier "EC-SA (Events
  Correlation by Simulated Annealing)" (§1), minimising an energy function combining model-log
  alignment fitness with a data-constraint violation cost (`rule cost, f_r(x)`, §5).
  Assumption lifted vs prior work, Abstract: "some assume the generative processes to be acyclic,
  while others require heuristic information or user input. Moreover, they abstract the log to
  activities and timestamps, and miss the opportunity to use data attributes."
- **Session threshold.** N/A — no time threshold. **This is important for us**: the process-mining
  formulation shows the event→episode assignment can be driven by a declared *model of the process*
  plus attribute constraints, with no inactivity constant anywhere. Android has such a model (the
  documented lifecycle transitions), so this is a live design option, not just an analogy.
- **Evaluation.** Log-to-log similarity measures `L2L_trace`, `L2L_2gram`, `L2L_3gram`, `L2L_case`
  and time-deviation `SMAPE_ET` / `SMAPE_CT`, over synthetic logs varied by size and work-in-progress
  plus real-life logs. Results §6: with data constraints, "L2L_trace, L2L_2gram and L2L_case increase
  by around 6%, 15% and 28% on average"; on BPIC17 "L2L_case increases by 46%". Degradation with
  ambiguity is quantified: "L2L_case falls by around 19% when cases increase from 100 to 1000". Cost:
  "EC-SA-Data ran for 13 h to complete the execution with the BPIC17 event log using 10 constraints".
- **Availability.** BPIC logs are public. No code URL located in the portion read — UNDETERMINED.
- **Access.** Full text PDF (`curl` from `arxiv.org/pdf/2206.10009`, 2,959 lines of extracted text);
  abstract, §1, §3–4 framing and §6 results read; the formal definitions in §4–5 were skimmed, not
  read line-by-line.

## 9. Pegoraro, Uysal, Hülsmann & van der Aalst (2022) — Uncertain Case Identifiers in Process Mining: A User Study of the Event-Case Correlation Problem on Click Data

arXiv:2204.04164; CAiSE 2022 Forum (LNBIP 13585 / Springer 10.1007/978-3-031-07475-2_12).

- **Why it matters here.** The event-case correlation problem applied to *user interaction / click
  data* — i.e. the closest process-mining instance to app-usage logs. Confirms the framing transfers
  from business processes to consumer UI telemetry.
- **Instrument and ladder rung.** Rung 3 analogue — app-level interaction events from a mobility-
  sharing company's own application instrumentation.
- **Episode reconstruction rule.** DECLARED at the level of mechanism, Abstract: "we apply a novel
  method to aggregate user interaction data in separate user sessions—interpreted as cases—based on
  neural networks." Keywords list "Neural Networks · word2vec". §7: "technique based on the word2vec
  neural network architecture, which can obtain [case identifiers]"; the model is trained on normative
  traces sampled from a process model, with low-weight transitions pruned "by deleting transitions
  with ω(t) < ε, for a small threshold ε" (§3). Exact ε not read.
- **Session threshold.** No time threshold; sessions are the *output*, not the input. Note §3's
  statement of the practical situation, which mirrors ours: the case notion is "by the open session in
  the app during the interaction", and §5 concedes evaluation happens "in an area where the ground
  truth is not available (i.e., there are no [labels])" — hence the qualitative expert-interview
  validation rather than a metric.
- **Availability.** Proprietary industrial log. Not re-runnable by a third party.
- **Access.** Abstract read verbatim via arXiv abs page; PDF downloaded and text-searched, but the
  method section was scanned rather than read in full. Treat the ε value and full architecture as
  UNDETERMINED.

## 10. Wang & Chen (2018) — On data processing required to derive mobility patterns from passively-generated mobile phone data

Transportation Research Part C 87:58–74.

- **Why it matters here. CITATION THREAT — rank 4, and the CDR-lane equivalent of our complaint.**
  They state outright that the processing step is undocumented across the literature that uses this
  data. That is our sentence, in telephony, in 2018.
- **Instrument and ladder rung.** Rung 4 analogue — raw carrier "sightings" (~1M users, Buffalo metro,
  April 2014), i.e. the platform's own event stream rather than a vendor aggregate.
- **Episode reconstruction rule.** DECLARED. Two stages: (a) locational-uncertainty clustering with
  spatial constraint `Rc = 1 km` and temporal constraint `Tc = 5 minutes` — "an activity location is
  identified if its duration exceeds Tc. We set Tc as five minutes"; (b) oscillation ("ping-pong")
  detection over `L0–L1–L0–L1` sequences with time window `Tw = 5 minutes`.
- **Session threshold.** `Tc = 5 min` (minimum stay duration, i.e. a *minimum-episode-length* filter,
  the direct analogue of a minimum-usage-duration option) and `Tw = 5 min` (oscillation window).
  Justification for `Rc` is verbatim "determined via trial-and-error"; for `Tw`, "five minutes as a
  reasonable choice to separate oscillation cases from real trips".
- **How much the choice moves the answer.** "before removing oscillation sequences, the number of
  abnormal trajectories is high – about 12% of the total number of trajectories. After oscillation
  traces are removed, this value drops to about 0.7%". And a derived index ξ moves from 1.02 to 0.88.
- **The quotable indictment.** "among the many studies that have used mobile phone data, only a few
  have reported the properties and issues associated with such data, and documented how they have
  processed the data".
- **Availability.** No data or code statement. Proprietary carrier data. Not re-runnable.
- **Access.** Full text via PMC (`pmc.ncbi.nlm.nih.gov/articles/PMC5789780/`), read via `WebFetch`.

## 11. Kennedy, Amiri, Liu, Bao, Chen, Hashemi, Kong, Liu, Kim, Tang, Zhao & Züfle (2026) — Staypoint Detection from Noisy Trajectory Data [Experiment Paper]

arXiv:2607.19312v1, submitted 2026-07-21. Emory University. CC BY-NC-ND 4.0.

- **Why it matters here. CITATION THREAT — rank 5, and a direct precedent for the paper we want to
  write.** This is a 2026 benchmark paper whose entire premise is that the event→episode step in GPS
  "lacks standard benchmarks, and existing algorithms have never been systematically evaluated". If
  that gap was still open in GPS in 2026, our claim that it is open in Android screen time is
  credible — and this paper is the template for closing it.
- **Instrument and ladder rung.** N/A (simulated GPS trajectories with annotated ground truth).
- **Episode reconstruction rule.** DECLARED across nine compared algorithms: Hybrid Stay Window,
  Temporal DBSCAN (T-DBSCAN), Sequential Stay Point Extraction (SSPE), 3-Step HMM-GEM, Centroid-Based
  Sliding Window, Trackintel baseline, Trackintel with dropout filter, Adaptive-Radius Sliding Window
  (ASW), Trackintel Hyperband Search (parameter-optimised), Histogram Gradient Boosting (supervised).
- **Session threshold.** Parameters are *searched*, not asserted. Hyperband ranges: distance 50–200 m,
  time 5–20 min, **gap 30–180 min**. Justification verbatim: "After several exploratory runs, we
  settled with the following setting in an attempt to balance exploration and the discovery of good
  parameter combinations". Evaluation-metric thresholds: spatial τ_s = 0.001° (≈111 m), temporal
  τ_t = 5 min.
- **Evaluation.** 16 simulated datasets across noise levels; ground truth from a Patterns-of-Life
  simulation, 500 agents × 30 days at 1-min sampling → 65,873 annotated staypoints. Metrics:
  spatio-temporal similarity hit-matching on 4-tuples (arrival, departure, lat, lon); temporal IoU;
  mean spatial offset.
- **Findings that matter to us.** Abstract: "existing state-of-the-art algorithms perform poorly under
  realistic noise conditions." §5.3: the tuned Trackintel variant "is extremely sensitive to its
  parameters, and will return nearly useless results without these parameters being properly set",
  while SSPE and HMM "seem more robust to noise and dropout than others … meaning they are also less
  sensitive to parameters".
- **Availability.** Datasets released as part of the benchmark; code at
  `https://github.com/amirih/staypoint`. **Fully re-runnable by a third party** — the only entry in
  this slice for which that is true of the event→episode step end to end.
- **Access.** Full text via arXiv HTML, read via `WebFetch`; metadata and abstract independently
  verified verbatim via `curl` on the abs page.

## 12. Martin, Hong, Wiedemann, Bucher & Raubal — Trackintel (Python library)

arXiv:2206.03593; published in Computers, Environment and Urban Systems.

- **Why it matters here.** A maintained, installable implementation whose **declared defaults are
  the operative rule for anyone who uses it** — and those defaults differ from the paper it cites.
  This is the "package registry" finding for the GPS lane: the rule that actually runs is in a
  docstring, not in a paper.
- **Instrument and ladder rung.** N/A (library over raw positionfixes = Rung 4 input).
- **Episode reconstruction rule.** DECLARED in source, `trackintel/preprocessing/positionfixes.py`,
  `generate_staypoints(...)`, verbatim signature: `method="sliding"`, `distance_metric="haversine"`,
  `dist_threshold=100`, `time_threshold=5.0`, `gap_threshold=15.0`, `include_last=False`.
  Docstring: "`dist_threshold : float, default 100` — The distance threshold for the 'sliding' method,
  i.e., how far someone has to travel to generate a new staypoint … the unit is in meters";
  "`time_threshold : float, default 5.0 (minutes)`"; "`gap_threshold : float, default 15.0 (minutes)`
  — The time threshold of determine whether a gap exists between consecutive pfs. Consecutive pfs with
  temporal gaps larger than 'gap_threshold' will be excluded from staypoints generation."
- **The missing-close-event note — the single most on-point sentence found in the entire GPS lane.**
  Docstring Notes, verbatim: "The 'sliding' method is adapted from Li et al. (2008). In the original
  algorithm, the 'finished_at' time for the current staypoint lasts until the 'tracked_at' time of the
  first positionfix outside this staypoint. **Users are assumed to be stationary during this missing
  period and potential tracking gaps may be included in staypoints.** To avoid including too large
  missing signal gaps, set 'gap_threshold' to a small value, e.g., 15 min." And:
  "`include_last`: … The algorithm in Li et al. (2008) only detects staypoint if the user steps out of
  that staypoint. **This will omit the last staypoint (if any).**"
  That is *exactly* our End-of-Usage-Missing problem: no closing observation ⇒ either assume
  continuation across the gap, or drop the episode. GPS solved it with a named, defaulted
  `gap_threshold` plus an explicit `include_last` switch. We should say so.
- **Session threshold.** 100 m / 5 min / 15 min gap, defaults, with no in-code justification beyond
  the "e.g., 15 min" suggestion. Justified by citation to Li et al. (2008) and Zheng (2015).
- **Availability.** Open source, installable, versioned. **Fully re-runnable.**
- **Access.** Source read verbatim via `curl` on
  `raw.githubusercontent.com/mie-lab/trackintel/master/trackintel/preprocessing/positionfixes.py`.
  Paper abstract read via arXiv abs page; the paper's own conceptual-model definitions of
  staypoint/tripleg/trip were **not** read — UNDETERMINED. The readthedocs page returned HTTP 429.

## 13. Banda, Haydel, Davila, Desai, Bryson, Haskell, Matheson & Robinson (2016) — Effects of Varying Epoch Lengths, Wear Time Algorithms, and Activity Cut-Points on Estimates of Child Sedentary Behavior and Physical Activity from Accelerometer Data

PLOS ONE 11(3):e0150534.

- **Why it matters here. CITATION THREAT — rank 2, and it is a multiverse.** A full factorial over the
  preprocessing decision space of a wearable sensor stream, reporting how far the *derived behavioural
  measure* moves, and concluding with a reporting-standards recommendation. Substitute "epoch length"
  for "gap tolerance" and "cut-point" for "minimum usage duration" and this is the paper we want to
  write, in accelerometry, ten years early. It must be cited and it must be distinguished.
- **Instrument and ladder rung.** Rung 4 analogue — raw accelerometer counts with declared derivation.
- **Episode reconstruction rule.** DECLARED, and enumerated as a grid:
  - Epoch lengths: **1, 5, 10, 15, 30, 60 s**.
  - Wear-time algorithms: **≥20 min consecutive zero vertical-axis counts**; **NHANES** (60 s derived
    epoch); **Choi et al.** (60 s derived epoch).
  - Activity cut-points: **Evenson** (15 s), **Treuth** (30 s), **Puyau** (60 s), **Mattocks** (60 s),
    **Romanzini** (15 s, vector magnitude).
  - 6 × 3 × 5 = **90 analytical combinations**.
- **Session threshold.** The wear-time algorithms *are* gap-tolerance rules (≥20 min of zeros = not
  wearing). No single value is endorsed; the point is the spread.
- **How far the answer moves.** Verbatim: "the mean percent of time spent in SB when calculated with
  the Evenson cut-points and Choi WT algorithm was **80% with a 1-second epoch, 65% with a 15-second
  epoch (the validated epoch), and 55% with a 60-second epoch**." And: "minutes/day spent in MVPA was
  **17% greater with a 1-second epoch and 21% less with a 60-second epoch** when compared to a
  15-second epoch". And across cut-points: "Minutes/day spent in MVPA ranged from **15.2 minutes/day
  to 59.9 minutes/day** for the four activity cut-points developed with vertical-axis counts. The
  upper limit of the MVPA range increases to **107.6 minutes/day** when including the Romanzini
  activity cut-point." Wear time itself: "ranging from 1030.33 minutes/day (1-second epoch) to 966.44
  minutes/day (60-second epoch)."
- **The normative claim — quote it, it is nearly our thesis statement.** Conclusion: "At the very
  least, the specific epoch length, WT algorithm, and activity cut-points used should always be
  reported in studies to help readers interpret the results, and to avoid making direct comparisons
  between studies that use different methods." Discussion: "Clinical and public health research and
  surveillance studies using different epoch lengths, WT algorithms and/or activity cut-points will
  produce different estimates of individual and/or sample activity levels, potentially misleading
  policy makers."
- **Availability.** "Public sharing of data is restricted to preserve the confidentiality of study
  participants. SAS code, a data dictionary, and a de-identified, ethically compliant data set
  underlying the study findings will be made available upon request." Not re-runnable without a
  request.
- **Access.** Full text via PMC4777377, read via `WebFetch`.

## 14. Jaeschke, Luzak, Steinbrecher, Jeran, Ferland, Linkohr, Schulz & Pischon (2017) — 24 h-accelerometry in epidemiological studies: automated detection of non-wear time in comparison to diary information

Scientific Reports 7:2227.

- **Why it matters here.** The wearable analogue of "how long a gap is still the same episode",
  validated against a self-report reference — and a demonstration that the answer is a compromise, not
  a fact.
- **Instrument and ladder rung.** Rung 4 analogue (ActiGraph GT3X+/GT3X raw, 30–100 Hz → 60 s epochs).
- **Episode reconstruction rule.** DECLARED: five gap rules, ">60", ">90", ">120", ">150", ">180
  minutes of consecutive zero-counts" as non-wear.
- **Session threshold.** No single value endorsed. Verbatim conclusion: "Our data indicate that the
  60-min algorithm is less suitable for NWT detection in 24 h-accelerometry because of low
  sensitivity, specificity, and small overlap with reported NWT minutes. Longer algorithms perform
  better but detect lower proportions of reported NWT minutes." And: "applying the **120-min
  algorithm** seems to be a compromise between accuracy and detection of as much NWT as possible".
- **Directional error statement, directly transferable to screen-off handling.** "When NWT periods are
  unknowingly included in activity estimates, they lead to an overestimation of the time spent in the
  lowest physical activity intensity. Conversely, when true wear periods without movements are
  classified as NWT, the subsequent exclusion of this time leads to an underestimation of sedentary
  behavior and overestimation of relative time in physical activity."
- **Evaluation.** Diary as reference; sensitivity, specificity, minute-by-minute overlap, ≥50% overlap
  = true positive. Note: the paper does **not** itself report how sedentary/MVPA totals shift across
  the five algorithms — that number (30% and 3.7%) appeared in search-result text attributed elsewhere
  and is **not** verified here. Do not cite it to this paper.
- **Availability.** Not stated in what was read. UNDETERMINED.
- **Access.** Full text via PMC5440390, read via `WebFetch` (note: `ncbi.nlm.nih.gov/pmc/...` 301s to
  `pmc.ncbi.nlm.nih.gov/...`; refetch at the redirect).

## 15. van Hees, Sabia, Jones, Wood, Anderson, Kivimäki, Frayling, Pack, Bucan, Trenell, Mazzotti, Gehrman, Singh-Manoux & Weedon (2018) — Estimating sleep parameters using an accelerometer without sleep diary (HDCZA)

Scientific Reports 8:12975.

- **Why it matters here.** The cleanest example in this slice of a *fully specified, versioned,
  open-source, externally validated* episode-detection rule for a continuous sensor stream. It is the
  standard we should hold screen-time reconstruction to: every constant stated, algorithm shipped in a
  named package version, validated against an independent instrument.
- **Instrument and ladder rung.** Rung 4 analogue (raw wrist accelerometer).
- **Episode reconstruction rule.** DECLARED, step-by-step, Methods "Heuristic algorithm to detect the
  SPT-window": "Calculate the z-angle per 5 seconds"; "Calculate a 5-minute rolling median of the
  absolute differences between successive 5 second averages"; "Calculate the 10th percentile from the
  output of step 5 over an individual day (noon-noon), and multiply by 15"; retain observation blocks
  "longer than 30 minutes"; "Evaluate the length of the time gaps between the observation blocks
  identified by step 7, if the duration is less than 60 minutes then count these gaps towards the
  identified blocks"; "The longest block in the day (noon-noon) will be the main SPT-window".
- **Session threshold.** Multiple, all declared: 5 s angle resolution; 5-min rolling median; 10th
  percentile × 15 as the adaptive threshold (note: **data-derived, not a constant** — the same move
  Mehrzadi and Halfaker make); 30-min minimum block; **60-min bridge tolerance** for interruptions
  (the exact analogue of a screen-off blip bridge); noon-to-noon day boundary.
- **Evaluation.** Against sleep diary in 3,752 participants (aged 60–82) and against polysomnography
  in 28 sleep-clinic patients and 22 healthy sleepers. "Mean C-statistic to detect the SPT-window
  compared to polysomnography was 0.86 and 0.83 in clinic-based and healthy sleepers, respectively."
  SPT-window "10.9 and 2.9 minutes longer compared with sleep diary in men and women".
- **Availability.** "Both SPT-window detection algorithms are implemented and available in open source
  R package **GGIR version 1.5-23**." PSG validation data on zenodo.org; Whitehall II via data-sharing
  policy. **Re-runnable.**
- **Access.** Full text via PMC6113241, read via `WebFetch`. (Direct `nature.com` article URLs 303 to
  `idp.nature.com` — use PMC.)

## 16. Birawo & Kasprowski (2022) — Review and Evaluation of Eye Movement Event Detection Algorithms

Sensors 22(22):8810. *(Adjacent field, included deliberately — see note.)*

- **Why it matters here.** Eye tracking is the one field found where (a) the event→episode step has a
  *public benchmark with two human coders*, (b) inter-coder disagreement is quantified, and (c) the
  paper states plainly that the algorithm choice changes the derived summary statistics by a factor of
  ~3. If we need a single "look what a mature version of this looks like" exemplar, this is it.
- **Instrument and ladder rung.** N/A (SMI HiSpeed 1250 at 500 Hz).
- **Episode reconstruction rule.** DECLARED: I-VT (velocity threshold), I-DT (dispersion threshold),
  Random Forest (40-sample sequences), CNN (100-sample window, 32/64/128 filters).
- **Session threshold.** "optimum velocity threshold value for I-VT is 0.5 px/ms"; "optimum dispersion
  threshold value … is 3.5 px" — both *tuned on the data*, not inherited. The paper's own caveat:
  "threshold values critically affect the classification results … finding the optimum threshold is
  challenging in threshold-based algorithms."
- **The number that transfers.** "I-VT algorithm found **189 fixations with an average duration of
  121 ms** while the RF algorithm found only **64 fixations with an average duration of 264 ms**.
  Considering that the manual coder found **91 fixations with average duration 222 ms**…" — three
  rules, one recording, a 3× spread in episode count and a 2× spread in mean episode duration. This is
  the single most compact demonstration in this slice of "the rule sets the number".
- **Ground truth.** "two human coders, MN and RA" over 4,988 samples; inter-coder "Cohen's kappa was
  90%", with PSO events worst ("F1-score as low as 85%").
- **Availability.** Code at `github.com/mebirtukan/EyeMovementEventDetectionAlgorithms`; dataset at
  `github.com/richardandersson/EyeMovementDetectorEvaluation`. **Fully re-runnable.**
- **Access.** Full text via PMC9699548, read via `WebFetch`.

## 17. Google Analytics 4 — session definition (vendor documentation)

`support.google.com/analytics/answer/9191807`

- **Why it matters here.** Rung 1 analogue: the vendor aggregate whose construction rule *is*
  published, unlike Apple Screen Time or Digital Wellbeing. It shows the counterfactual — a vendor
  *can* state the rule — and it is the terminal node of the 30-minute inheritance chain.
- **Instrument and ladder rung.** Rung 1 (vendor aggregate).
- **Episode reconstruction rule.** DECLARED, verbatim: "A session is a period of time during which a
  user interacts with your website or app." "In Analytics, a session initiates when a user either
  opens your app in the foreground or views a page or screen and no session is currently active."
- **Session threshold.** Verbatim: "**By default, a session ends or times out after 30 minutes of user
  inactivity. There is no limit to how long a session can last.**" Kind: inactivity gap. Justification:
  **none given** — the number is stated, never argued. Configurable via the Admin panel (web) and
  `setSessionTimeoutDuration` (app); the page read did not state min/max bounds, and did not address
  midnight or campaign-change restarts — both UNDETERMINED, do not assert either.
- **Availability.** N/A. The rule is declared; the implementation is not inspectable.
- **Access.** Full text of the support page, read via `WebFetch`.

---

## Threshold provenance — the inheritance chain, as traced

This is the finding the brief asked for explicitly, and it is clean.

1. **Catledge & Pitkow** (client-side tracking study) report a mean inter-event gap and add 1.5 SD.
   Halfaker et al. §2.2, verbatim: "Both threshold and approach appear to originate in a 1995 paper by
   Catledge & Pitkow [4] that used client-side tracking to identify browsing behavior. In their work,
   they reported the mean time between user observed user events in their data was **9.3 minutes**.
   They choose to add **1.5 standard deviations** to that mean to achieve a **25.5 minutes inactivity
   threshold. Over time this proposed inactivity threshold has gradually been smoothed out to 30
   minutes.**"
2. **Year disagreement in the citing literature.** Halfaker et al. say "a 1995 paper"; Jones & Klinkner
   §2 say "apparently following Catledge and Pitkow's **1994** work, which claimed to find a 25.5
   minute timeout based on user experiments[4]". Two papers, two years, same reference number, neither
   read the discrepancy. **I did not read Catledge & Pitkow directly — the correct year is
   UNDETERMINED here.** This is itself an exhibit.
3. **Propagation into method.** Berendt et al. §2.2 adopt θ = 30 min for `h1` justified only by the
   citation [CP95]. Mehrzadi & Feitelson Table 1 shows the constant spreading across four unrelated
   domains at four different values (10–15 min, 30 min, 2 hr, 5 min, 1 hr, 20 min).
4. **Propagation into tooling.** Mehrzadi & Feitelson §3: "Google analytics uses a timeout of 30
   minutes to define sessions." Confirmed still true in GA4 in 2026 (§17).
5. **Three independent refutations, none of which stopped it.** Jones & Klinkner 2008: "The 30-minute
   standard receives no support from our results." Mehrzadi & Feitelson 2012: "it is not practical to
   find a suitable global threshold". Halfaker et al. 2015: fitted thresholds span 14–335 min across
   ten datasets.
6. **A soundbite that outran its source.** The widely repeated "25.5 minutes performs no better than
   random" is asserted in Jones & Klinkner's §2 and repeated by Halfaker et al., but Jones & Klinkner's
   own Table 3 reports 66.5% goal-boundary accuracy at 30 min against a 54.2% baseline and says in
   §3.3 that it "is more accurate than the baseline". See §5.

---

## Report

**Totals.** 17 sources kept. **Read in full: 8** (Berendt 2002, Mehrzadi 2012, Halfaker 2015, Jones &
Klinkner 2008, Banda 2016, Jaeschke 2017, van Hees 2018, Birawo 2022 — plus the trackintel source file,
read verbatim, which I count with the eight as primary-source reading). **Read substantially but not
line-by-line: 4** (van Zelst 2021, Bayomie 2022, Kennedy 2026, Wang & Chen 2018). **Abstract or
metadata only: 4** (Spiliopoulou 2003, Infostop 2020, Trackintel paper 2022, Pegoraro 2022 method
details). **Vendor doc read in full: 1** (GA4).

### Citation threats, ranked

1. **Mehrzadi & Feitelson (2012).** Already argues that the reconstruction parameter contaminates the
   derived measure, with a figure showing the fingerprint. Domain is web search, not device logs; no
   treatment of missing close events, no lifecycle semantics, no multi-rule comparison. Does not
   preempt us. Must be cited as the origin of the argument.
2. **Banda et al. (2016).** A 90-cell multiverse over a sensor stream's preprocessing decisions with an
   explicit reporting recommendation. Domain is accelerometry; the decisions are epoch/cut-point, not
   event-pairing. Does not preempt us. Must be cited, and we should be explicit that our contribution
   is the same *move* applied to a discrete lifecycle event stream where the decision space is
   combinatorial rather than a product of three lists.
3. **Berendt et al. (2002) / Spiliopoulou et al. (2003).** Not a threat to novelty — a gift. They
   supply the formal apparatus (R, C_h, M_cr, M_o, M_s) we should adopt rather than reinvent. The
   threat is only that a reviewer says "this is Spiliopoulou's framework applied to Android", which is
   fine if we say it first.
4. **Wang & Chen (2018).** Same complaint about the same silence, in CDR.
5. **Kennedy et al. (2026).** Proof that the "no benchmark, never systematically evaluated" gap was
   still open in a much older and better-funded field last month. Strengthens us; also raises the bar,
   because they closed their gap with a released benchmark and code and a reviewer may ask why we did
   not.

### Anything that contradicts us — papers that DO declare their rule

Not softening this: **declaration is the norm in every field in this slice, not the exception.** Web
analytics (h1/h2/href, verbatim, with parameter values), process mining (formal `a(r) = r′`, model plus
constraints), GPS (trackintel defaults in the function signature; nine algorithms named and
parameterised in the 2026 benchmark), accelerometry (nine numbered algorithm steps with every constant),
eye tracking (tuned thresholds reported to one decimal place), and even the vendor (GA4 states its 30
minutes plainly). The strongest single counter-example is **van Hees et al. (2018)**: every threshold
stated, algorithm shipped in a *named package version* (GGIR 1.5-23), validated against
polysomnography, validation data on Zenodo.

**The consequence for our framing.** "The field almost never says which rule it used" cannot be
defended as a claim about behavioural-log research in general — it is defensible only as a claim about
*mobile screen-time research specifically*, and it needs the contrast drawn against these fields rather
than asserted in a vacuum. The interesting question we can still own is why the same community that
would never publish an accelerometry paper without stating its epoch length routinely publishes a
screen-time paper without stating its episode rule.

### Three things expected and not found

1. **No sessionization work outside mobile treats the missing *close* event as the central problem.**
   Every formalism in this slice assumes punctual observations and asks only where to cut. Nothing
   found handles "an open episode whose closing event never arrived". The single nearest thing in the
   entire slice is a **docstring**: trackintel's note that in Li et al. (2008) "Users are assumed to be
   stationary during this missing period and potential tracking gaps may be included in staypoints",
   mitigated by `gap_threshold`, plus `include_last` for the episode that never closes. That the best
   available treatment of our central problem is a Python docstring is a finding, and arguably the
   most useful sentence in this whole report.
2. **No multiverse / specification-curve analysis over sessionization thresholds anywhere in web
   analytics, clickstream, or process mining.** Mehrzadi shows the artifact but does not enumerate the
   space; Halfaker fits a threshold but does not report downstream sensitivity; Jones & Klinkner
   compare five timeouts on *boundary accuracy*, never on a substantive research conclusion. Banda
   (accelerometry) is the only true multiverse found in this slice. The web/clickstream lane has the
   formal apparatus and never ran the experiment.
3. **No named CDR/telephony session-inference algorithm with evaluation.** Searched repeatedly. What
   exists is (a) network-engineering flow timeouts (15–30 s / 60–120 s), which fragment application
   sessions as an *accepted artifact* of the measurement infrastructure, and (b) mobility-processing
   pipelines like Wang & Chen. Nobody has framed "infer the user session from a CDR stream" as a named
   problem with a benchmark, the way GPS and process mining have. Real absence.

Bonus absence: **no shared ground-truth corpus exists for web sessionization.** Berendt got R by
ablating a cookie+session-ID mechanism (elegant, unpublished dataset); Jones & Klinkner hand-annotated
312 users (proprietary); Jin et al. hand-annotated 2,400 sessions (labels unreleased); Mehrzadi
labelled 50 users and admits "we do not have any ground-truth". Twenty-four years, no corpus. GPS got
one in July 2026.

### Dead ends — do not repeat

**Queries that returned nothing usable:**
- `"how to segment a clickstream into sessions algorithm comparison"` → vendor marketing blogs, USPTO
  patents, one unrelated Springer chapter on temporal decay weighting. Zero methodology.
- `"arbitrary preprocessing choices change results sensor time series segmentation reproducibility"` →
  generic time-series-segmentation ML papers (ClaSS, etc.), nothing about preprocessing degrees of
  freedom.
- `"sensitivity of conclusions to session definition threshold user behavior analytics robustness
  check"` → generic sensitivity-analysis tutorials and security-vendor UBA content. Complete miss.
- `"call detail records inferring user sessions mobile network traffic inactivity threshold"` → USPTO
  patents on billing-session timeouts and CDR traffic-prediction papers. The CDR *sessionization*
  problem as such does not appear to be named in the literature.
- `"smartphone data session inference network flow records timeout choice effect on measured usage"` →
  network-engineering flow-timeout material only.

**Access failures (record as unavailable, per brief):**
- **ScienceDirect returns HTTP 403 to `WebFetch`, consistently.** Two papers lost this way and left
  UNDETERMINED: "A simple heuristic for the identification of the case ID attribute in unlabelled
  process mining event logs" (S2590005626000858, 2026) and "Evaluating and Validating Stay Point
  Detection Algorithms with different GPS Log Intervals" (S1877050924013310, Procedia CS 2024, likely
  gold OA but still 403). Do not retry via `WebFetch`.
- **`nature.com` article URLs 303-redirect to `idp.nature.com` (auth).** Always go via PMC instead.
- **`ncbi.nlm.nih.gov/pmc/articles/...` 301s to `pmc.ncbi.nlm.nih.gov/articles/...`** — one wasted
  round trip each time; use the `pmc.` host directly.
- **`arxiv.org/pdf/...` via `WebFetch` returns raw compressed PDF bytes the fetch model cannot read.**
  Use `arxiv.org/abs/...` or `arxiv.org/html/...` for `WebFetch`, or `curl` the PDF and run
  `pdftotext -layout`. Same applies to any `.pdf` on any host.
- **`facweb.cs.depaul.edu` fails TLS chain verification in `WebFetch`** ("unable to verify the first
  certificate"). `curl -k` works.
- **`sebastiaanvanzelst.com` PDF exceeds `WebFetch`'s 10 MB limit.** The `d-nb.info/1238523943/34`
  copy of the same paper is 1.1 MB and works.
- **`trackintel.readthedocs.io` returned HTTP 429.** Read the library source on
  `raw.githubusercontent.com` instead — better anyway, since the defaults live in the signature.
- **INFORMS (`pubsonline.informs.org`), Tandfonline, Springer chapter pages, ResearchGate and
  Academia.edu were not attempted** (paywall / known-hostile). The Springer-only items left
  UNDETERMINED are: Bayomie et al. "Deducing Case IDs for Unlabeled Event Logs" (2016/2015),
  "Attribute-Driven Case Notion Discovery for Unlabeled Event Logs" (2022), "CaseID Detection for
  Process Mining: A Heuristic-Based Methodology" (2024), and the IJGIS temporal-sampling-interval paper
  (Tandfonline, 2019).

### Not read — status UNDETERMINED, listed so nobody cites them from this document

- Spiliopoulou, Mobasher, Berendt & Nakagawa (2003), INFORMS JoC 15(2) — metadata only.
- Catledge & Pitkow (1994 or 1995 — the year itself is disputed between two sources I did read).
- Li, Zheng, Xie, Chen, Liu & Ma (2008), ACM SIGSPATIAL — the origin of the sliding staypoint
  algorithm. Known only through trackintel's docstring and the 2026 benchmark. **Its original
  `distThreh`/`timeThreh` values were not read and must not be quoted.**
- Hariharan & Toyama (2004), Project Lachesis — named as the state of the art in Infostop's abstract;
  not read.
- Aslak & Alessandretti (2020), Infostop, arXiv:2003.14370 — **abstract read verbatim only.** It is a
  named algorithm (Infomap-based stop-location detection) with an open-source Python/C++
  implementation and an explicit critique of the prior standard; it deserves a full read in a follow-up
  and is the obvious next target in the GPS lane.
- Martin et al., Trackintel paper — abstract only; the source code was read instead.
- Murray, Lin & Chowdhury (2006), hierarchical agglomerative clustering for session identification —
  the per-user-threshold precursor Mehrzadi builds on and reports precision/recall for; not read
  directly.
- Gayo-Avello (2009), "A survey on session detection methods in query logs and a proposal for future
  evaluation", Information Sciences 179(12):1822–1843 — named by Mehrzadi as "an extensive survey".
  **This is the highest-value unread item in the slice** and should be the first fetch of any
  follow-up: it is a whole survey of session-detection methods *plus a proposed evaluation protocol*.
- He & Göker (2000); He, Göker & Harper (2002) "Combining evidence for automatic web session
  identification", IP&M 38(5):727–742; Huynh & Miller (2009) "Empirical observations on the session
  timeout threshold", IP&M 45(5):513–528 — three more threshold-derivation methods named in Mehrzadi's
  §3, none read.

<!-- independent-expansion-20260805:C -->

---

# Independent expansion ledger — Slice C (66 internally deduplicated sources)


Search date: 2026-08-05 (America/Chicago). Scope: web analytics, clickstream/search-log segmentation, process-mining event-to-case correlation and event abstraction, telephony CDR/mobile-network inference, and close formal analogues. The existing Chronicle paper dossier and all citation-chase lanes were checked first. Previously known anchors (Zhu et al.; Suriadi et al.; van der Aalst on case notions; De Weerdt & Wynn) were treated as lineage seeds rather than repeatedly rediscovered endpoints.

## Bottom line

The adjacent literature sharply contradicts any broad claim that sessionization is only an undocumented 30-minute timeout. Multiple fields explicitly formulate event grouping as an inference or optimization problem, name algorithms, compare against ground truth, quantify sensitivity, or release executable implementations. The closest transfers are: Pegoraro et al.'s neural click-event-to-case segmentation, de Leoni & Dündar's session-based low-level-event abstraction, Bayomie et al.'s EC-SA family, Román et al.'s optimization against real sessions, Meiss et al.'s logical referrer-tree sessions, and Li et al.'s lifecycle-aware activity-instance matching. None of the checked works, however, provides an ontology that records a screen-time reconstruction rule as assertion-level measurement provenance or carries a multiverse of plausible rules through to screen-time estimates.

## Evidence conventions

- **Instrument/rung:** `N/A` means the Android/iOS screen-time ladder does not apply. CDR/GPS/network-signal sources are described but not forced onto that ladder. Pegoraro et al.'s app click stream is marked Rung 3-equivalent.
- **Rule:** `DECLARED` is used only when rule text was visible. `UNDETERMINED` means the accessible abstract/metadata was insufficient to verify the exact implementation. Quotation locations refer to the linked HTML/PDF section/page where available.
- **Threshold:** “none” means the method is structural/model-based rather than a single inactivity cutoff; it does not mean the method has no hyperparameters.
- **Availability:** “not located” is not a claim of nonexistence; it records this search's result.
- **Access:** “full text—relevant sections inspected” is not a claim of cover-to-cover reading.

## A. Web analytics, web usage, and click/search-log segmentation (22)

## 1. Spiliopoulou, Mobasher, Berendt & Nakagawa (2003) — A Framework for the Evaluation of Session Reconstruction Heuristics in Web-Usage Analysis

- **Why it matters here.** Foundational direct analogue: evaluates competing reconstruction heuristics rather than treating preprocessing as neutral.
- **Primary/full text and DOI.** [DOI record](https://doi.org/10.1287/ijoc.15.2.171.14445); author/full-text copy surfaced through the title search.
- **Instrument and ladder rung.** Web access logs; N/A.
- **Episode reconstruction rule.** DECLARED in Table 1/method: total-session-duration, page-stay-time, and referrer heuristics; visible text states settings `30 min`, `10 min`, and `10 sec` respectively.
- **Session threshold.** 30 min total-duration cap is described as empirically derived; 10 min page-stay is a conservative maximum; 10 sec permits frameset-loading overhead (Method/Table 1 and following paragraph).
- **Availability.** Experimental configurations are published; no code/data deposit located, so exact rerun is not established.
- **Access.** Full text—relevant method text inspected via indexed author copy.

## 2. Jones & Klinkner (2008) — Beyond the Session Timeout: Automatic Hierarchical Segmentation of Search Topics in Query Logs

- **Why it matters here.** Citation threat/transfer: shows that one temporal partition is insufficient when tasks are interleaved and hierarchical.
- **Primary/full text and DOI.** [Author PDF](https://www.cs.cmu.edu/afs/cs.cmu.edu/user/rosie/www/papers/jonesKlinknerCIKM2008.pdf); [DOI](https://doi.org/10.1145/1458082.1458176).
- **Instrument and ladder rung.** Human-annotated search-engine query logs; N/A.
- **Episode reconstruction rule.** DECLARED: supervised boundary classification plus hierarchical task segmentation; the paper reports that timeouts alone max out near 70% precision and that 17% of tasks are interleaved.
- **Session threshold.** The 30-minute timeout is a baseline, not the proposed rule; provenance is common search-log practice.
- **Availability.** Ground-truth annotation is described; public code/data deposit not located.
- **Access.** Full text—author manuscript.

## 3. Gayo-Avello (2009) — A Survey on Session Detection Methods in Query Logs and a Proposal for Future Evaluation

- **Why it matters here.** Systematic counterexample to a single default: surveys definitions and proposes an evaluation framework plus a time/semantic geometric heuristic.
- **Primary/full text and DOI.** [Publisher record](https://doi.org/10.1016/j.ins.2009.01.026).
- **Instrument and ladder rung.** Search query logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED at implementation level; abstract declares a heuristic using “a geometric interpretation of both the time gap between queries and the similarity between them.”
- **Session threshold.** Not recoverable from accessible abstract; no value guessed.
- **Availability.** Evaluation framework reported; code/data not determined.
- **Access.** Abstract only.

## 4. Meiss, Duncan, Gonçalves, Ramasco & Menczer (2009) — What's in a Session: Tracking Individual Behavior on the Web

- **Why it matters here.** Major transfer: explicitly finds timeout statistics unstable and replaces one serial session with concurrent logical sessions.
- **Primary/full text and DOI.** [arXiv full text](https://arxiv.org/abs/1003.5325); [DOI](https://doi.org/10.1145/1557914.1557946).
- **Instrument and ladder rung.** 400M+ HTTP requests from about 1,000 users over two months; N/A.
- **Episode reconstruction rule.** DECLARED, §6: “This algorithm assembles requests into sessions based on the referring URL of a request matching the target URL of a previous request”; empty referrer opens a new logical session and attachment uses the most recent matching referrer.
- **Session threshold.** None in the logical definition. Adding a timeout makes statistics depend on the chosen value; ~15 min is offered only as a compromise (§6, final experiment), not a universal truth.
- **Availability.** Algorithm fully stated; dataset/code not publicly deposited in the checked route.
- **Access.** Full text—arXiv HTML/PDF, relevant sections inspected.

## 5. Lucchese, Orlando, Perego, Silvestri & Tolomei (2011) — Identifying Task-Based Sessions in Search Engine Query Logs

- **Why it matters here.** Defines Task-based Session Discovery as clustering possibly non-contiguous events; 75% of annotated activity involved multitasking.
- **Primary/full text and DOI.** [Author PDF](https://www.dsi.unive.it/~orlando/PUB/wsdm2011.pdf); [DOI](https://doi.org/10.1145/1935826.1935875).
- **Instrument and ladder rung.** Manually annotated query logs; N/A.
- **Episode reconstruction rule.** DECLARED: variants of clustering algorithms plus a purpose-built heuristic use lexical/semantic relatedness from Wiktionary/Wikipedia to group non-contiguous queries (Abstract/Method).
- **Session threshold.** No single inactivity threshold; temporal proximity is one feature and multitasking permits overlap.
- **Availability.** Ground truth constructed and evaluation specified; code/data deposit not located.
- **Access.** Full text—author manuscript.

## 6. Román, Dell, Velásquez & Loyola (2014) — Identifying User Sessions from Web Server Logs with Integer Programming

- **Why it matters here.** High-value citation threat: bipartite matching and integer programming are evaluated against 15 months of known real sessions and dominate timeout heuristics.
- **Primary/full text and DOI.** [Institutional manuscript](https://calhoun.nps.edu/server/api/core/bitstreams/bd2aa137-e0d3-4bb1-9167-4725d74493cc/content); [DOI](https://doi.org/10.3233/IDA-130627).
- **Instrument and ladder rung.** Web server logs plus corresponding real sessions; N/A.
- **Episode reconstruction rule.** DECLARED: “We use bipartite cardinality matching and a more general integer program to construct sessions” (publisher abstract); the full formulation optimizes compatible request assignments.
- **Session threshold.** Timeout is only a comparator; proposed rules are optimization constraints/objectives.
- **Availability.** Models and comparison measures published; no maintained code repository located.
- **Access.** Full text—accepted/institutional manuscript.

## 7. Halfaker et al. (2015) — User Session Identification Based on Strong Regularities in Inter-activity Time

- **Why it matters here.** Cross-domain empirical threshold derivation over gaming, search, page views, and volunteer work, rather than inheritance of 30 min.
- **Primary/full text and DOI.** [arXiv](https://arxiv.org/abs/1411.2878); [DOI](https://doi.org/10.1145/2736277.2741117).
- **Instrument and ladder rung.** Timestamped user actions from six systems/ten action types; N/A.
- **Episode reconstruction rule.** DECLARED: identify clusters/regularities in inter-activity time, then split when the inactivity interval crosses the empirically located between-session regime (Methods).
- **Session threshold.** About 1 hour; abstract justification: “regularity with which these activity clusters appear implies a good rule-of-thumb inactivity threshold of about 1 hour.”
- **Availability.** Method and datasets described; no single executable package/deposit confirmed.
- **Access.** Full text—arXiv.

## 8. Fatima, Ramzan & Asghar (2016) — Session Identification Techniques Used in Web Usage Mining

- **Why it matters here.** Systematic review (2005–2015) that classifies limitations and concludes the area was still immature.
- **Primary/full text and DOI.** [Publisher record](https://doi.org/10.1108/OIR-08-2015-0274).
- **Instrument and ladder rung.** Review; N/A.
- **Episode reconstruction rule.** N/A (review); exact included-algorithm coding is UNDETERMINED without full text.
- **Session threshold.** Multiple practices reviewed; no single endorsed value recoverable from abstract.
- **Availability.** Review protocol reported; extraction sheet/code not located.
- **Access.** Abstract only.

## 9. Munk & Benko (2018) — Using Entropy in Web Usage Data Preprocessing

- **Why it matters here.** Uses information entropy to choose/reference-length session identification, explicitly treating preprocessing quality as an evaluable decision.
- **Primary/full text and DOI.** [Open article](https://doi.org/10.3390/e20010067).
- **Instrument and ladder rung.** Virtual-learning-environment and anonymous portal logs; N/A.
- **Episode reconstruction rule.** DECLARED: entropy-guided Reference Length method; the paper supplies an “Algorithm of Reference Length method using Entropy” (§Methods).
- **Session threshold.** Structural reference-length/page-time parameters, not an unexamined global inactivity timeout; exact values are dataset-specific in the experiments.
- **Availability.** Algorithm and evaluation visible; no code/data repository located.
- **Access.** Full text—open access, relevant sections inspected.

## 10. Khabsa, El Kholy, Awadallah, Zitouni & Shokouhi (2018) — Identifying Task Boundaries in Digital Assistants

- **Why it matters here.** Learns sub-session/task boundaries from crowd-labeled sequences and beats rule baselines.
- **Primary/full text and DOI.** [Microsoft Research record](https://www.microsoft.com/en-us/research/publication/identifying-task-boundaries-digital-assistants/); [DOI](https://doi.org/10.1145/3184558.3186952).
- **Instrument and ladder rung.** Commercial digital-assistant interaction logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; abstract states “we use a machine learned model to identify task boundaries,” but exact feature/decision rule was not verified in full.
- **Session threshold.** No numeric inactivity value visible; learned boundary classification.
- **Availability.** Proprietary logs; no public code/data located.
- **Access.** Abstract only.

## 11. Du, Shu & Li (2018) — CA-LSTM: Search Task Identification with Context Attention Based LSTM

- **Why it matters here.** Sequential neural segmentation uses temporal, word, and character context instead of a lone time gap.
- **Primary/full text and DOI.** [IR Anthology metadata](https://ir.webis.de/anthology/2018.sigirconf_conference-2018.146/); [DOI](https://doi.org/10.1145/3209978.3210087).
- **Instrument and ladder rung.** Search query sessions; N/A.
- **Episode reconstruction rule.** UNDETERMINED; available abstract says context-attention LSTM predicts segment boundaries, followed by clustering.
- **Session threshold.** None reported in accessible text; temporal information is an input feature.
- **Availability.** Code/data not located.
- **Access.** Abstract/metadata only.

## 12. Sun, Zhang, Nie & Nie (2018) — Research on Session Segmentation of Web Search Query Logs Based on Naive Bayes

- **Why it matters here.** Explicitly casts each adjacent-query position as a boundary-classification decision.
- **Primary/full text and DOI.** [Journal page](https://jns.nju.edu.cn/EN/abstract/article/0469-5097/1023); [DOI](https://doi.org/10.13232/j.cnki.jnju.2018.06.009).
- **Instrument and ladder rung.** Web-search query logs; N/A.
- **Episode reconstruction rule.** DECLARED in abstract: Query2Vector semantics + query time gap + neighboring queries feed a Naive Bayes classifier deciding “whether the query item is a session boundary.”
- **Session threshold.** No standalone value; time interval is one classifier feature.
- **Availability.** Experiments reported; code/data not located.
- **Access.** English abstract plus bibliographic/full Chinese route; exact implementation UNDETERMINED beyond abstract.

## 13. Gomes, Martins & Cruz (2019) — Segmenting User Sessions in Search Engine Query Logs Leveraging Word Embeddings

- **Why it matters here.** Unsupervised FastText-enhanced segmentation outperforms a large baseline set on annotated AOL sessions.
- **Primary/full text and DOI.** [Institutional record](https://researchportal.ulisboa.pt/en/publications/segmenting-user-sessions-in-search-engine-query-logs-leveraging-w/); [DOI](https://doi.org/10.1007/978-3-030-30760-8_17).
- **Instrument and ladder rung.** AOL subset: 10,235 queries, 4,253 sessions, 215 users; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact form; abstract declares temporal + lexical + pretrained FastText semantic similarities and additional heuristics.
- **Session threshold.** Global thresholds are criticized; exact learned/heuristic cutoffs not accessible.
- **Availability.** Evaluation dataset named; code not located.
- **Access.** Abstract only through primary institutional record.

## 14. Kapusta, Munk, Halvoník & Drlík (2019) — User Identification in the Process of Web Usage Data Preprocessing

- **Why it matters here.** Directly compares session-time-threshold identification with cookies, testing the measurement consequence of identification strategy.
- **Primary/full text and DOI.** [Open journal](https://doi.org/10.3991/ijet.v14i09.9854).
- **Instrument and ladder rung.** Web/VLE logs and cookies; N/A.
- **Episode reconstruction rule.** DECLARED as comparative STT versus cookie-based user/session assignment; exact pseudocode is in Methods.
- **Session threshold.** Values are experiment-specific; the abstract does not justify a universal timeout and no value is inferred here.
- **Availability.** Full paper open; no code/data deposit located.
- **Access.** Full text—open access, relevant sections inspected.

## 15. Lugo, Moreno & Hubert (2020) — Segmenting Search Query Logs by Learning to Detect Search Task Boundaries

- **Why it matters here.** A neural sequential boundary model uses adjacent queries and their time span, suitable for real-time use.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1145/3397271.3401257); method chapter available in the author's dissertation route.
- **Instrument and ladder rung.** Annotated search logs; N/A.
- **Episode reconstruction rule.** DECLARED at high level: a neural model classifies whether adjacent queries cross a task boundary using the pair and elapsed time; full architectural rule is in the paper.
- **Session threshold.** No fixed inactivity cutoff; time span is a learned feature.
- **Availability.** Small annotated collection described; public code/data not located.
- **Access.** Full method chapter/accepted-paper text inspected through author thesis; publisher paper abstract otherwise.

## 16. Lugo, Moreno & Hubert (2020) — A Multilingual Approach for Unsupervised Search Task Identification

- **Why it matters here.** Demonstrates unsupervised, language-agnostic task grouping, reducing reliance on global temporal rules and English-specific semantics.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1145/3397271.3401258).
- **Instrument and ladder rung.** Multilingual query logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; accessible digest confirms an unsupervised multilingual task-identification model, but exact graph/clustering rule was not read.
- **Session threshold.** Not determined; no value guessed.
- **Availability.** Code/data not located.
- **Access.** Abstract/metadata only.

## 17. Sowmya & Anandhi (2022) — An Efficient and Scalable Dynamic Session Identification Framework for Web Usage Mining

- **Why it matters here.** Online dynamic alternative evaluated at one-million-log scale rather than merely asserting a timeout.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/s41870-022-00867-3); [publisher/author metadata](https://www.researchgate.net/publication/378941101_An_efficient_and_scalable_dynamic_session_identification_framework_for_web_usage_mining).
- **Instrument and ladder rung.** Web trace logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; abstract says user-defined schema plus scalable association-rule mining over unique IP, URL, number of sessions, and average session length.
- **Session threshold.** No exact value/justification accessible.
- **Availability.** Reports MAPE/RMSE; full text, code, and data not available in checked route.
- **Access.** Abstract only.

## 18. Bayir & Toroslu (2022) — Maximal Paths Recipe for Constructing Web User Sessions

- **Why it matters here.** Graph-theoretic construction enumerates all possible maximal navigation paths and beats greedy methods in next-page prediction.
- **Primary/full text and DOI.** [Institutional record](https://avesis.metu.edu.tr/yayin/4a266cd4-2042-4c41-ae87-9dddc7240b1f/maximal-paths-recipe-for-constructing-web-user-sessions); [DOI](https://doi.org/10.1007/s11280-022-01024-3).
- **Instrument and ladder rung.** Real web-log/navigation graph; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact pseudocode; abstract declares sessions as sets of all possible maximal paths in the Web graph.
- **Session threshold.** Structural graph rule; no inactivity value in abstract.
- **Availability.** Real-data evaluation; code/data not located.
- **Access.** Abstract only.

## 19. Sowmya & Anandhi (2022) — Semantic Based Weighted Web Session Clustering Using Adapted K-Means and Hierarchical Agglomerative Algorithms

- **Why it matters here.** Explicitly reports 84% session-identification accuracy and evaluates weighted downstream clusters.
- **Primary/full text and DOI.** [Open journal page](https://journals.riverpublishers.com/index.php/JWE/article/view/6577); [DOI](https://doi.org/10.13052/jwe1540-9589.2125).
- **Instrument and ladder rung.** Web server logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact code; abstract declares enhanced semantic-distance session identification, then adapted k-means/agglomerative clustering using page and session weights.
- **Session threshold.** Critiques page-stay/session-time thresholds; exact alternative cut point not visible.
- **Availability.** No downloadable data/code shown on article page.
- **Access.** Abstract/full article route open; only abstract/method summary inspected.

## 20. Jin & Okamoto (2024) — Evaluation of Session Segmentation Methods Using Item Embedding

- **Why it matters here.** Current annotated comparison of cosine similarity, k-means, LightGBM, SVM, and logistic regression; best F1 0.714 and PR-AUC 0.794.
- **Primary/full text and DOI.** [J-STAGE](https://www.jstage.jst.go.jp/article/pjsai/JSAI2024/0/JSAI2024_3Xin234/_article/-char/en); [DOI](https://doi.org/10.11517/pjsai.JSAI2024.0_3Xin234).
- **Instrument and ladder rung.** Annotated behavioral sessions; N/A.
- **Episode reconstruction rule.** DECLARED at model-family level: cosine similarity or classifiers over Item2Vec/Word2Vec/OpenAI embeddings predict segment points; exact selected cutoff is UNDETERMINED from the accessible short paper text.
- **Session threshold.** No inactivity timeout; model/score boundary.
- **Availability.** Annotated dataset not linked; no code located.
- **Access.** Full short paper available; abstract/results inspected.

## 21. Jin & Okamoto (2025) — Evaluation of Session Segmentation Methods Using Behavior and Text Embeddings

- **Why it matters here.** Extends the item-embedding lineage with combined behavioral/text representations and formal segmentation metrics.
- **Primary/full text and DOI.** [Springer chapter](https://doi.org/10.1007/978-981-96-4756-9_6).
- **Instrument and ladder rung.** Annotated behavioral sessions; N/A.
- **Episode reconstruction rule.** UNDETERMINED; title/abstract establish embedding-based segment evaluation, exact classifier/cutoffs not verified.
- **Session threshold.** No fixed inactivity value established.
- **Availability.** Code/data not located.
- **Access.** Abstract only.

## 22. Jin, Okamoto, Harada, Shibata & Karube (2026) — Similarity-Based Supervised User Session Segmentation Method for Behavior Logs

- **Why it matters here.** Very recent direct counterexample: supervised boundary detection on manually annotated real browsing histories, LightGBM F1 0.806/PR-AUC 0.831.
- **Primary/full text and DOI.** [J-STAGE full paper](https://www.jstage.jst.go.jp/article/jsoft/38/2/38_615/_article/-char/en); [DOI](https://doi.org/10.3156/jsoft.38.2_615).
- **Instrument and ladder rung.** E-commerce behavior logs; N/A.
- **Episode reconstruction rule.** DECLARED in abstract/Methods: compute co-occurrence, title/brand text, and price similarities in a fixed-size window around every candidate boundary; supervised classifiers predict boundaries.
- **Session threshold.** Model decision boundary/window hyperparameter, not inactivity gap; exact tuned values are in full paper and not transcribed here.
- **Availability.** Paper downloadable; annotation/code/data deposits not linked.
- **Access.** Full text—open PDF, relevant methods/results inspected.

## B. Process mining: event-to-case correlation and event abstraction (27)

## 23. Pourmirza, Dijkman & Grefen (2017) — Correlation Miner: Mining Business Process Models and Event Correlations Without Case Identifiers

- **Why it matters here.** Names the exact analogue—the “correlation challenge”—and jointly infers causal relations and case membership.
- **Primary/full text and DOI.** [Institutional record](https://research.tue.nl/en/publications/correlation-miner-mining-business-process-models-and-causal-relat/); [DOI](https://doi.org/10.1142/S0218843017420023).
- **Instrument and ladder rung.** Synthetic and real service-oriented event logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact formulation; abstract identifies Correlation Miner and quadratic-programming lineage, with high-accuracy request/response correlation.
- **Session threshold.** None; causal/model constraints replace inactivity gaps.
- **Availability.** Prototype/evaluation reported; code/data deposit not located.
- **Access.** Abstract plus institutional manuscript route.

## 24. Bayomie, Di Ciccio, La Rosa & Mendling (2019) — A Probabilistic Approach to Event-Case Correlation for Process Mining

- **Why it matters here.** EC-SA casts assignment of every event to a case as probabilistic global optimization against a process model.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-030-33223-5_12); author manuscript available via institutional/RG route.
- **Instrument and ladder rung.** Timestamped unlabeled event sequences + process models; N/A.
- **Episode reconstruction rule.** DECLARED: simulated annealing generates candidate correlated logs and minimizes model/log misalignment and timing dispersion.
- **Session threshold.** No global timeout; optimization temperature/cooling and process-model constraints.
- **Availability.** Prototype/evaluation described; this version's exact code deposit not confirmed.
- **Access.** Full text—author copy, relevant methods inspected.

## 25. Bayomie, Revoredo, Di Ciccio & Mendling (2022) — Improving Accuracy and Explainability in Event-Case Correlation via Rule Mining

- **Why it matters here.** EC-SA-RM learns association rules while correlating, making the grouping decision explainable rather than hidden.
- **Primary/full text and DOI.** [Conference PDF](https://icpmconference.org/2022/wp-content/uploads/sites/7/2022/10/paper_40.pdf); [DOI](https://doi.org/10.1109/ICPM57379.2022.9980684).
- **Instrument and ladder rung.** Four real-life event logs with case IDs removed for evaluation; N/A.
- **Episode reconstruction rule.** DECLARED in abstract/Method: simulated annealing proposes a correlated log; association rules learned from it enrich the next iteration; output is cases plus explanatory rules.
- **Session threshold.** None; model and learned-rule objective.
- **Availability.** Four datasets identified; code not located in checked primary route.
- **Access.** Full text—conference PDF.

## 26. Bayomie, Di Ciccio & Mendling (2023) — Event-Case Correlation for Process Mining Using Probabilistic Optimization

- **Why it matters here.** Strongest reproducible transfer: EC-SA-Data formally partitions every event exactly once and publishes code/data plus eight accuracy measures.
- **Primary/full text and DOI.** [arXiv](https://arxiv.org/abs/2206.10009); [DOI](https://doi.org/10.1016/j.is.2023.102167); [code](https://github.com/DinaBayomie/EC-SA-Data/releases/tag/EC-SA-Data).
- **Instrument and ladder rung.** Synthetic and real process logs, including BPIC17; N/A.
- **Episode reconstruction rule.** DECLARED, §4: start activities open cases; enabled cases become candidate assignments; data equality/IF–THEN/event-time constraints rank candidates; simulated annealing minimizes alignment, rule-violation, and duration-variance costs.
- **Session threshold.** No single gap. Event-time constraints can encode domain bounds (example §4.3: B duration 30–120 min), explicitly as supplied constraints.
- **Availability.** Code and evaluation project/data public; rerunnable.
- **Access.** Full text—OA article/arXiv, method/results inspected.

## 27. Bayomie, Helal, Awad, Ezat & ElBastawissi (2016) — Deducing Case IDs for Unlabeled Event Logs

- **Why it matters here.** Produces multiple ranked reconstructions rather than falsely presenting one case assignment as certain.
- **Primary/full text and DOI.** [Author PDF](https://scholar.cu.edu.eg/sites/default/files/ahmedawad/files/bplabellingeventlog.pdf); [DOI](https://doi.org/10.1007/978-3-319-42887-1_20).
- **Instrument and ladder rung.** Labeled logs with case IDs removed; N/A.
- **Episode reconstruction rule.** DECLARED: a case decision tree plus behavioral profiles and heuristic activity-execution data build/rank candidate labeled logs (Algorithms 3.1–3.4).
- **Session threshold.** Domain execution-time heuristics, not universal inactivity.
- **Availability.** Prototype evaluated against E-Max; no maintained repository located.
- **Access.** Full text—author PDF.

## 28. Helal & Awad (2020) — Correlating Unlabeled Events at Runtime

- **Why it matters here.** Online rule for missing case IDs returns trust percentages and explicitly accommodates cyclic processes.
- **Primary/full text and DOI.** [arXiv](https://arxiv.org/abs/2004.09971); [DOI](https://doi.org/10.48550/arXiv.2004.09971); [REC code](https://github.com/ImanHelal/REC).
- **Instrument and ladder rung.** Real and synthetic event streams + Petri-net model; N/A.
- **Episode reconstruction rule.** DECLARED, Algorithms 1–3: derive task dependencies/loops, enumerate compatible open cases, filter by min/max execution durations, assign with a confidence/trust value.
- **Session threshold.** Per-activity `(Min_a, Max_a)` execution heuristics; user/domain supplied, not inherited global gap.
- **Availability.** Public implementation and named BPIC/Sepsis evaluation logs; rerunnable in principle.
- **Access.** Full text—arXiv.

## 29. Lichtenstein, Bano & Weske (2022) — Attribute-Driven Case Notion Discovery for Unlabeled Event Logs

- **Why it matters here.** Infers case membership from attribute completeness/partitioning and transition probabilities, supporting cyclic behavior without a known process model.
- **Primary/full text and DOI.** [Author PDF](https://feb.kuleuven.be/drc/LIRIS/misc/bpiworkshop/papers/bpm-2021-paper-151.pdf); [DOI](https://doi.org/10.1007/978-3-030-94343-1_9); [code](https://github.com/tom-lichtenstein/attribute-driven-case-notion-discovery).
- **Instrument and ladder rung.** MIMIC-IV and Road Traffic Fine event logs with case IDs removed; N/A.
- **Episode reconstruction rule.** DECLARED, §4: event-log subdivision → entity-class instance estimation using weighted attribute similarity → iterative trace generation using activity-transition probabilities until assignments stabilize.
- **Session threshold.** No temporal inactivity threshold; attribute weights use completeness × partitioning (Eq. 1).
- **Availability.** Implementation public; evaluation logs public/available under their original conditions.
- **Access.** Full text—author PDF.

## 30. González López de Murillas, Reijers & van der Aalst (2020) — Case Notion Discovery and Recommendation: Automated Event Log Building on Databases

- **Why it matters here.** Formalizes event-log construction as projection of a database onto a chosen case notion and ranks candidate perspectives.
- **Primary/full text and DOI.** [Open article](https://link.springer.com/article/10.1007/s10115-019-01430-6); [DOI](https://doi.org/10.1007/s10115-019-01430-6).
- **Instrument and ladder rung.** Relational/object-centric databases; N/A.
- **Episode reconstruction rule.** DECLARED formally through a connected meta-model and candidate case-notion discovery/recommendation pipeline (§Definitions/Algorithms).
- **Session threshold.** None; database relations/object classes define candidates.
- **Availability.** Implemented research technique reported; exact code/data route not verified in this search.
- **Access.** Full text—open access.

## 31. Andrews et al. (2020) — Quality-Informed Semi-Automated Event Log Generation for Process Mining

- **Why it matters here.** RDB2Log makes event/case extraction a quality-scored analyst decision rather than invisible preprocessing.
- **Primary/full text and DOI.** [Publisher record](https://doi.org/10.1016/j.dss.2020.113265).
- **Instrument and ladder rung.** Relational databases; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact implementation; accessible text says primary/foreign-key constraints plus data-quality metrics guide selection of case, event, timestamp, and activity columns, outputting XES.
- **Session threshold.** N/A—relational correlation, no gap.
- **Availability.** Prototype applied in laboratory and real case study; public repository not located.
- **Access.** Abstract and detailed section snippets only.

## 32. Djedović, Karabegović, Žunić & Alić (2019) — A Rule Based Events Correlation Algorithm for Process Mining

- **Why it matters here.** Directly names rule-based assignment of missing case identifiers.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-030-24986-1_47).
- **Instrument and ladder rung.** Process events from systems lacking reliable case IDs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; metadata/abstract establish a rule-based correlation algorithm but exact rules were not accessible.
- **Session threshold.** Not determined; no value guessed.
- **Availability.** Code/data not located.
- **Access.** Abstract/metadata only.

## 33. Diba, Batoulis, Weidlich & Weske (2020) — Extraction, Correlation, and Abstraction of Event Data for Process Mining

- **Why it matters here.** Review establishes the three-stage vocabulary that most cleanly locates screen-time event→episode work.
- **Primary/full text and DOI.** [Publisher record](https://doi.org/10.1002/widm.1346).
- **Instrument and ladder rung.** Review; N/A.
- **Episode reconstruction rule.** N/A (review); it classifies techniques for identification/extraction, event correlation, and abstraction.
- **Session threshold.** N/A.
- **Availability.** Review, no executable artifact expected/located.
- **Access.** Abstract only.

## 34. De Weerdt & Wynn (2022) — Foundations of Process Event Data

- **Why it matters here.** Formal tutorial anchor for how raw observations become process event data and why the overarching case dimension prevents biased analyses.
- **Primary/full text and DOI.** [Open book PDF](https://library.oapen.org/bitstream/id/e9c5f431-eb92-45dc-a4ab-3f7ecbf91426/978-3-031-08848-3.pdf); [DOI](https://doi.org/10.1007/978-3-031-08848-3_6).
- **Instrument and ladder rung.** Tutorial/review; N/A.
- **Episode reconstruction rule.** N/A; chapter surveys extraction, correlation and abstraction formalisms.
- **Session threshold.** N/A.
- **Availability.** Open instructional source, not an implementation.
- **Access.** Full text—open book chapter.

## 35. de Leoni & Dündar (2020) — Event-Log Abstraction Using Batch Session Identification and Clustering

- **Why it matters here.** Citation threat/transfer: explicitly divides low-level traces into sessions and makes each session one high-level activity execution.
- **Primary/full text and DOI.** [arXiv extended version](https://arxiv.org/abs/1903.03993); [DOI](https://doi.org/10.1145/3341105.3373861).
- **Instrument and ladder rung.** Two real high-variability process logs; N/A.
- **Episode reconstruction rule.** DECLARED at pipeline level: traces are divided into batch sessions; sessions are clustered/visualized and each becomes one activity execution. Exact segmentation-list/batch parameters are in Methods.
- **Session threshold.** Not a universal 30-min rule; limited domain knowledge and learned clustering govern boundaries.
- **Availability.** Two case studies; public code/data not located.
- **Access.** Full text—arXiv/author version.

## 36. van Zelst, Mannhardt, de Leoni & Koschmider (2021) — Event Abstraction in Process Mining: Literature Review and Taxonomy

- **Why it matters here.** Systematically identifies 21 abstraction techniques and seven decision dimensions, proving the adjacent field treats event grouping as methodologically heterogeneous.
- **Primary/full text and DOI.** [Open article](https://link.springer.com/article/10.1007/s41066-020-00226-2); [DOI](https://doi.org/10.1007/s41066-020-00226-2).
- **Instrument and ladder rung.** Review; N/A.
- **Episode reconstruction rule.** N/A; taxonomy dimensions include supervision, interleaving, probabilistic output, data type, perspectives, event/activity class relation, and event/activity-instance relation (§4.1).
- **Session threshold.** N/A; supervised time windows are only one family among many.
- **Availability.** Open review; extraction data not located.
- **Access.** Full text—open access.

## 37. Folino, Guarascio & Pontieri (2015) — Mining Multi-Variant Process Models from Low-Level Logs

- **Why it matters here.** Unsupervised predictive-clustering trees group low-level event attribute sets into activity types and evaluate resulting process quality.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-319-19027-3_14).
- **Instrument and ladder rung.** Low-level process logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact tree criteria; the 2021 taxonomy states clustering repeatedly tests whether the induced workflow schema improves two quality measures.
- **Session threshold.** None; cluster/model quality governs grouping.
- **Availability.** Code/data not located.
- **Access.** Abstract plus secondary full-review characterization; primary full text not read.

## 38. Sánchez-Charles, Carmona, Muntés-Mulero & Solé (2018) — Reducing Event Variability in Logs by Clustering of Word Embeddings

- **Why it matters here.** Groups semantically similar low-level event names using learned embeddings rather than time gaps.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-319-74030-0_14).
- **Instrument and ladder rung.** Process event logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; primary metadata and review identify word-embedding clustering of fine-grained events into coarse event types.
- **Session threshold.** None; semantic/clustering similarity.
- **Availability.** Code/data not located.
- **Access.** Abstract only.

## 39. van Eck, Sidorova & van der Aalst (2016) — Enabling Process Mining on Sensor Data from Smart Products

- **Why it matters here.** Direct sensor analogue: segments continuous measurements into windows, clusters them, and emits higher-level discrete events.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1109/RCIS.2016.7549355).
- **Instrument and ladder rung.** Continuous smart-product sensor data; N/A.
- **Episode reconstruction rule.** DECLARED at pipeline level in review/abstract: segment by a minimum window size, cluster segments, generate implicit activity labels, optionally refine with domain expert.
- **Session threshold.** Minimum window size is a declared input; numeric value/provenance UNDETERMINED without full primary text.
- **Availability.** Prototype/evaluation reported; code/data not located.
- **Access.** Abstract only.

## 40. Senderovich, Rogge-Solti, Gal, Mendling & Mandelbaum (2016) — The ROAD from Sensor Data to Process Instances via Interaction Mining

- **Why it matters here.** Strong formal transfer: turns discrete location interactions into activity instances via patterns plus physical impossibility constraints encoded as ILP.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-319-39696-5_16).
- **Instrument and ladder rung.** Discrete location/sensor interactions; N/A.
- **Episode reconstruction rule.** UNDETERMINED in full detail; taxonomy describes matching interaction patterns and solving an ILP with constraints such as one person cannot occupy two locations simultaneously.
- **Session threshold.** Structural/physical constraints; no global inactivity value.
- **Availability.** Evaluation reported; code/data not located.
- **Access.** Abstract plus review characterization.

## 41. Tax, Sidorova, Haakma & van der Aalst (2017) — Event Abstraction for Process Mining Using Supervised Learning Techniques

- **Why it matters here.** Learns sensor/low-level-to-human-activity episode mappings from paired labeled traces.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-319-56994-9_18); [related arXiv framework](https://arxiv.org/abs/1705.10202).
- **Instrument and ladder rung.** Sensor-level event logs paired with human activity labels; N/A.
- **Episode reconstruction rule.** DECLARED at pipeline level: XES feature extraction + supervised learning predicts high-level event/activity labels and intervals.
- **Session threshold.** Model-based; no global gap documented in accessible text.
- **Availability.** Training/evaluation framework described; public code/data not confirmed.
- **Access.** Full related preprint and primary abstract.

## 42. Tello, Gianini, Mizouni & Damiani (2019) — Machine Learning-Based Framework for Log-Lifting in Business Process Mining Applications

- **Why it matters here.** Treats low-level-to-high-level transformation as learned “log lifting,” close to event→episode abstraction.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-030-26619-6_16).
- **Instrument and ladder rung.** Business-process low-level logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; metadata/review identify a machine-learning framework for mapping fine-grained log events to coarse activities.
- **Session threshold.** Not determined; no value guessed.
- **Availability.** Code/data not located.
- **Access.** Abstract only.

## 43. Fazzinga, Flesca, Furfaro, Masciari & Pontieri (2015) — A Probabilistic Unified Framework for Event Abstraction and Process Detection from Log Data

- **Why it matters here.** Probabilistic simultaneous abstraction/process detection acknowledges uncertain mappings rather than deterministic pairings.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1007/978-3-319-26148-5_20).
- **Instrument and ladder rung.** Low-level event logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; title/abstract establish probabilistic joint event abstraction and process detection.
- **Session threshold.** None reported; probabilistic model.
- **Availability.** Code/data not located.
- **Access.** Abstract only.

## 44. Fazzinga, Flesca, Furfaro, Masciari & Pontieri (2018) — Efficiently Interpreting Traces of Low Level Events in Business Process Logs

- **Why it matters here.** Maps event subsequences to high-level activity interpretations and evaluates efficiency/accuracy.
- **Primary/full text and DOI.** [Publisher record](https://doi.org/10.1016/j.is.2017.11.001).
- **Instrument and ladder rung.** Low-level business process traces; N/A.
- **Episode reconstruction rule.** UNDETERMINED; full exact interpretation algorithm was not accessible.
- **Session threshold.** No fixed inactivity gap identified.
- **Availability.** Evaluation reported; code/data not located.
- **Access.** Abstract only.

## 45. Fazzinga, Flesca, Furfaro & Pontieri (2022) — Process Mining Meets Argumentation: Explainable Interpretations of Low-Level Event Logs via Abstract Argumentation

- **Why it matters here.** Formalizes competing event→activity-instance interpretations and explanations for rejecting alternatives.
- **Primary/full text and DOI.** [Publisher full-text route](https://doi.org/10.1016/j.is.2022.101987).
- **Instrument and ladder rung.** Synthetic and real low-level logs; N/A.
- **Episode reconstruction rule.** DECLARED at formal level: interpretations become arguments/attacks in an Abstract Argumentation Framework; accepted extensions are valid high-level activity-instance assignments (§Approach).
- **Session threshold.** None; logical acceptance semantics.
- **Availability.** Empirical analysis reported; code/data not located.
- **Access.** Full article text/section snippets inspected.

## 46. Mannhardt, de Leoni, Reijers, van der Aalst & Toussaint (2018) — Guided Process Discovery: A Pattern-Based Approach

- **Why it matters here.** Uses reusable activity patterns/alignment to combine multiple low-level events into business-level instances, including concurrency.
- **Primary/full text and DOI.** [DOI](https://doi.org/10.1016/j.is.2018.01.009).
- **Instrument and ladder rung.** Low-level process event logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact alignment cost; primary metadata and taxonomy identify pattern-based supervised abstraction.
- **Session threshold.** Pattern/model alignment, no global inactivity value.
- **Availability.** Implementation/evaluation reported; repository not located.
- **Access.** Abstract only.

## 47. Li, van Zelst & van der Aalst (2021) — An Activity Instance Based Hierarchical Framework for Event Abstraction

- **Why it matters here.** Treats an activity instance—not merely a label—as the unit of hierarchical abstraction, matching usage-episode composition.
- **Primary/full text and DOI.** [Conference PDF](https://icpmconference.org/2021/wp-content/uploads/sites/5/2021/09/An-Activity-Instance-Based-Hierarchical-Framework-for-Event-Abstraction.pdf); [DOI](https://doi.org/10.1109/ICPM53251.2021.9576868).
- **Instrument and ladder rung.** Partially ordered process event logs; N/A.
- **Episode reconstruction rule.** DECLARED at framework level: abstract-concept identification followed by abstract-entity extraction over activity instances, repeatable hierarchically.
- **Session threshold.** No inactivity cutoff; entity/concept functions.
- **Availability.** Quantitative and qualitative experiments; code/data not located.
- **Access.** Full text—conference PDF.

## 48. Li, van Zelst & van der Aalst (2023) — A Framework for Automated Abstraction Class Detection for Event Abstraction

- **Why it matters here.** Fully unsupervised discovery of abstraction classes permits arbitrary abstraction depths and avoids hand-written episode types.
- **Primary/full text and DOI.** [Institutional record](https://publica.fraunhofer.de/entities/publication/85718dd1-d1fa-4ba5-a517-789b479a8110); [DOI](https://doi.org/10.1007/978-3-031-35507-3_13).
- **Instrument and ladder rung.** Partially ordered process logs; N/A.
- **Episode reconstruction rule.** UNDETERMINED; abstract declares fully unsupervised class detection and hierarchical abstraction, exact objective not inspected.
- **Session threshold.** None reported.
- **Availability.** Scalability/precision evaluation; code/data not located.
- **Access.** Abstract only.

## 49. Li, Antonov & van der Aalst (2025) — Activity Instance Identification Using Bipartite Graph Matching

- **Why it matters here.** Very close formal analogue: pairs lifecycle events into activity instances and tests robustness to noise/missing events.
- **Primary/full text and DOI.** [Fraunhofer record](https://publica.fraunhofer.de/entities/publication/bfc70df2-dce2-44cf-b60a-af96b14a1e97); [DOI](https://doi.org/10.1007/978-981-96-7238-7_7).
- **Instrument and ladder rung.** Event logs with activity lifecycle transitions; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact matching weights; abstract declares bipartite-graph matching plus alignment to correlate lifecycle events into conformant activity instances.
- **Session threshold.** None; lifecycle/alignment constraints.
- **Availability.** Multi-domain experiments with missing/noisy events; code/data not located.
- **Access.** Abstract only.

## C. CDR/mobile-network and stay/trip episode inference (13)

## 50. Quadri, Zignani, Capra, Gaito & Rossi (2014) — Multidimensional Human Dynamics in Mobile Phone Communications

- **Why it matters here.** Defines and evaluates communication bursts over calls+SMS with DBSCAN, explicitly showing simple inter-event chaining fails in multiple dimensions.
- **Primary/full text and DOI.** [PLOS full text](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0103183); [DOI](https://doi.org/10.1371/journal.pone.0103183).
- **Instrument and ladder rung.** CDR calls/SMS for ~1M people over three months; N/A (network records).
- **Episode reconstruction rule.** DECLARED, Methods “Burstiness”: events are points; DBSCAN finds maximal density-connected components with distance threshold and minimum event count, avoiding single-linkage chaining.
- **Session threshold.** Distance/time neighborhood varied 1–60 min; 10 min highlighted as tight sensitivity point. Threshold is explored, not inherited silently.
- **Availability.** Proprietary CDR; method/formulas public, raw data/code not deposited.
- **Access.** Full text—open access.

## 51. Jiang, Ferreira & González (2017) — Activity-Based Human Mobility Patterns Inferred from Mobile Phone Data: A Case Study of Singapore

- **Why it matters here.** Exact CDR point→stay→daily-network pipeline with declared spatial/time thresholds and noise handling.
- **Primary/full text and DOI.** [Accepted manuscript](https://studylib.net/doc/27944689/ieee-tbd-2015-12-0163-author-version--1-); [DOI](https://doi.org/10.1109/TBDATA.2016.2631141).
- **Instrument and ladder rung.** Tower-based CDR trajectories; N/A.
- **Episode reconstruction rule.** DECLARED, §4.1: cluster temporally adjacent locations within `Δd1`, recluster within `Δd2`, retain clusters whose duration exceeds `Δt`, and represent each by tower/start/duration.
- **Session threshold.** Examples `Δd1=300 m`, `Δd2=300 m`, `Δt=10 min`; explicitly adapted from Hariharan–Toyama and prior mobile-positioning work (§4.1).
- **Availability.** Operator CDR not public; algorithm prose available, no code located.
- **Access.** Full text—accepted manuscript, relevant section inspected.

## 52. Chen, Hoteit, Viana, Fiore & Sarraute (2018) — Enriching Sparse Mobility Information in Call Detail Records

- **Why it matters here.** Demonstrates that sparse event logs bias mobility metrics and evaluates adaptive completion against GPS ground truth.
- **Primary/full text and DOI.** [Author manuscript](https://chengs.github.io/version1/papers/comcom.pdf); [DOI](https://doi.org/10.1016/j.comcom.2018.03.012).
- **Instrument and ladder rung.** Operator CDR + GPS validation; N/A.
- **Episode reconstruction rule.** DECLARED in Methods: several literature completions plus adaptive regularity-based temporal completion infer unobserved locations between CDR events.
- **Session threshold.** Adaptive/user-history rules rather than one fixed global gap; exact equations and night/day regimes are in §§6–7.
- **Availability.** Real CDR/GPS restricted; paper is rerunnable only with equivalent data; no code repository located.
- **Access.** Full text—author manuscript.

## 53. Chen, Viana, Fiore & Sarraute (2019) — Complete Trajectory Reconstruction from Sparse Mobile Phone Data

- **Why it matters here.** Context-enhanced trajectory reconstruction explicitly fills missing intervals from sparse events rather than assuming direct transitions.
- **Primary/full text and DOI.** [Open DOI](https://doi.org/10.1140/EPJDS/S13688-019-0206-8); [DBLP record](https://dblp.org/rec/journals/epjds/ChenVFS19.html).
- **Instrument and ladder rung.** Sparse CDR/mobile-phone trajectories; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact tensor objective here; abstract/metadata identify context-enhanced/tensor-factorization reconstruction of full individual trajectories.
- **Session threshold.** Model-based, not a fixed inactivity gap.
- **Availability.** Evaluation data subject to operator/privacy restrictions; code not located.
- **Access.** Full open article route; only abstract/method summaries inspected.

## 54. Zhao, Koutsopoulos & Zhao (2022) — Identifying Hidden Visits from Sparse Call Detail Record Data

- **Why it matters here.** Major transfer: makes missing-between-events episodes explicit, labels them using denser records, and quantifies downstream bias (11.4% of displacements).
- **Primary/full text and DOI.** [arXiv](https://arxiv.org/abs/2106.12885); [DOI](https://doi.org/10.1177/27541231221124164).
- **Instrument and ladder rung.** 2B transactions/3M users; voice CDR plus denser data-access records; N/A.
- **Episode reconstruction rule.** DECLARED, §2.3: hidden visit exists when a recoverable inter-event interval contains a denser-data stay `s'` different from both endpoint stays; classifiers estimate `P(hidden visit)`.
- **Session threshold.** `τ=1 h` minimum inter-event interval for this dataset; §3.1 justifies it from a one-hour spike in data-access inter-event times and calls it the analysis temporal resolution.
- **Availability.** Operator data restricted; four standard classifiers specified, no code deposit located.
- **Access.** Full text—arXiv.

## 55. Veres, Gray, Harrison & Lefebvre (2023) — Correcting Measurement Biases in the Detection of Long and Short Stay Locations in Sparse CDRs

- **Why it matters here.** The title and method directly frame stay detection as measurement-bias correction under sparse, compute-constrained operator data.
- **Primary/full text and DOI.** [Flowminder PDF](https://www.flowminder.org/media/e3fjfh5r/final-netmob_2023_-correcting-measurement-biases-in-the-detection-of-long-and-short-stay-locations.pdf); [Zenodo DOI](https://doi.org/10.5281/zenodo.8414389).
- **Instrument and ladder rung.** Sparse LMIC operator CDR; N/A.
- **Episode reconstruction rule.** DECLARED in conference paper at high level: detect long/short stays and relocations while correcting sparse-observation biases; exact algorithm parameters were not fully transcribed.
- **Session threshold.** Multiple long/short-stay parameters; values/provenance UNDETERMINED from indexed text.
- **Availability.** Paper/deposit public; raw CDR restricted; code not located.
- **Access.** Full short paper—relevant text inspected.

## 56. Bonnetain et al. (2021) — TRANSIT: Fine-Grained Human Mobility Trajectory Inference at Scale with Mobile Network Signaling Data

- **Why it matters here.** Separates movement intervals from stationary episodes at scale and validates against GPS (80% precision, 96% recall).
- **Primary/full text and DOI.** [Accepted manuscript](https://dspace.networks.imdea.org/bitstream/handle/20.500.12761/1501/trc21_transit.pdf?sequence=1); [DOI](https://doi.org/10.1016/j.trc.2021.103257).
- **Instrument and ladder rung.** Network-signaling data for >10M individuals + GPS ground truth; N/A.
- **Episode reconstruction rule.** DECLARED at pipeline level: DBSCAN-based clustering exploits recurrent signaling locations, classifies stationary versus movement phases, then map-matches movement segments.
- **Session threshold.** Density/spatial/duration parameters tuned/evaluated; no universal inactivity timeout.
- **Availability.** Operator data restricted; manuscript available; code not located.
- **Access.** Full text—accepted manuscript.

## 57. Yang, Dash & Teo (2021) — PPTPF: Privacy-Preserving Trajectory Publication Framework for CDR Mobile Trajectories

- **Why it matters here.** Gives an exact trip boundary ontology: a trajectory is a trip beginning and ending in inferred stay regions.
- **Primary/full text and DOI.** [Open article](https://www.mdpi.com/2220-9964/10/4/224); [DOI](https://doi.org/10.3390/ijgi10040224).
- **Instrument and ladder rung.** CDR mobile trajectories and taxi validation data; N/A.
- **Episode reconstruction rule.** DECLARED, §3.1: “a trajectory is a trip that starts and ends with a stay region”; stays require events within spatial threshold SPT for at least temporal threshold TMT.
- **Session threshold.** SPT/TMT are user-defined, explicitly acknowledged as framework parameters rather than universal values.
- **Availability.** DataSpark/taxi evaluation described; privacy limits raw CDR; no code repository located.
- **Access.** Full text—open access.

## 58. Smolak, Rohm & Sila-Nowicka (2022) — Explaining Human Mobility Predictions Through a Pattern Matching Algorithm

- **Why it matters here.** Fully states sequential point→stay episode construction and carries it into an interpretable prediction pipeline.
- **Primary/full text and DOI.** [Open article](https://link.springer.com/article/10.1140/epjds/s13688-022-00356-4); [DOI](https://doi.org/10.1140/epjds/s13688-022-00356-4).
- **Instrument and ladder rung.** GNSS mobility trajectories; N/A.
- **Episode reconstruction rule.** DECLARED, §2.3.1: iterate from first point; accumulate while distance < δ; when exceeded, keep cluster if first-to-last duration > τ, otherwise discard; restart at first unassigned point.
- **Session threshold.** `δ=300 m`, `τ=10 min`, explicitly “following the guidelines from Jiang et al.”; a clear inheritance chain.
- **Availability.** Method/formulas public; dataset/code availability not confirmed.
- **Access.** Full text—open access.

## 59. Stylianou (2017) — Stay-Point Identification as Curve Extrema

- **Why it matters here.** Threshold-critique analogue: replaces empirically fine-tuned time/distance cutoffs with geometric extrema and evaluates on noisy raw data.
- **Primary/full text and DOI.** [arXiv](https://arxiv.org/abs/1701.06276); [DOI](https://doi.org/10.48550/arXiv.1701.06276).
- **Instrument and ladder rung.** Raw noisy trajectories over 28 days; N/A.
- **Episode reconstruction rule.** DECLARED in paper: transform path into a 2-D discrete time-series curve; local minima of its first derivative identify stays.
- **Session threshold.** No tuned stay-duration/distance threshold in the core geometric detector; this is the paper's stated alternative to threshold methods.
- **Availability.** Evaluation across four tracking techniques; code/data not located.
- **Access.** Full text—arXiv.

## 60. Nishida, Toda & Koike (2015) — Extracting Arbitrary-Shaped Stay Regions from Geospatial Trajectories with Outliers and Missing Points

- **Why it matters here.** Online duration-aware density clustering explicitly handles outliers and missing closing/within-episode points.
- **Primary/full text and DOI.** [ACM record](https://doi.org/10.1145/2834882.2834884).
- **Instrument and ladder rung.** Real GPS trajectories from 13 users for three weeks; N/A.
- **Episode reconstruction rule.** UNDETERMINED in exact pseudocode; abstract declares an online, duration-based extension of density clustering robust to missing points/outliers.
- **Session threshold.** A stay must exceed a time threshold, but the numeric value/provenance was not accessible.
- **Availability.** Compared with five algorithms; data/code not located.
- **Access.** Abstract only.

## 61. Schneider, Gröchenig, Venek, Leitner & Reich (2017) — A Framework for Evaluating Stay Detection Approaches

- **Why it matters here.** Explicit evaluation framework spans acquisition, preprocessing, parameterization, ground truth, and downstream application data.
- **Primary/full text and DOI.** [Open article](https://www.mdpi.com/2220-9964/6/10/315); [DOI](https://doi.org/10.3390/ijgi6100315).
- **Instrument and ladder rung.** GNSS/mobile sensor ground truth and assisted-living field data; N/A.
- **Episode reconstruction rule.** DECLARED as three compared families: time-based/incremental clustering, extended density clustering, and mixed method; a stay is `(lat, lon, t_in, t_out)` and duration is `t_out-t_in` (§2).
- **Session threshold.** Multiple spatial/temporal parameters evaluated; no universal value endorsed.
- **Availability.** Framework and evaluation measures open; code/data not linked.
- **Access.** Full text—open access.

## 62. Kato et al. (2024) — Evaluating and Validating Stay Point Detection Algorithms with Different GPS Log Intervals

- **Why it matters here.** Directly measures how sampling interval and algorithm alter derived stay duration/trip frequency; ST-DBSCAN remains accurate to 5-min sampling while conventional rules are biased.
- **Primary/full text and DOI.** [Open article](https://doi.org/10.1016/j.procs.2024.06.095).
- **Instrument and ladder rung.** Ground-truthed Hiroshima GPS trajectories downsampled to varied log intervals; N/A.
- **Episode reconstruction rule.** DECLARED at comparison-family level: ST-DBSCAN versus distance-duration sequential rule and DBSCAN; exact implementation parameters are in Methods.
- **Session threshold.** Sampling intervals systematically varied; 5 min is an observed robustness boundary for ST-DBSCAN, not an inactivity timeout.
- **Availability.** Ground-truth study described; code/data deposit not located.
- **Access.** Full text—open access.

## Ranked citation threats and transfer candidates

1. **Pegoraro et al. (reported in the existing dossier and not duplicated as a separate count here)** — *Uncertain Case Identifiers in Process Mining* is the closest direct click-event→user-session rule: word2vec boundary scores with explicit peak inequalities and expert evaluation. It must be cited alongside the present ledger even though it was already in local evidence.
2. **de Leoni & Dündar (2020), item 35** — explicitly turns low-level event sessions into activity instances; closest conceptual competitor to event→episode abstraction.
3. **Bayomie et al. (2023), item 26** — most reproducible formal analogue: code, data, one-event/one-case invariant, constraints, objective functions, and eight evaluation measures.
4. **Román et al. (2014), item 6** — direct evaluation against real sessions and a timeout baseline; proves sessionization can be validated when ground truth exists.
5. **Meiss et al. (2009), item 4** — exact logical algorithm and strong empirical demonstration that session statistics depend continuously on timeout choice.
6. **Li et al. (2025), item 49** — lifecycle-event pairing into robust activity instances under noise/missing events; near-isomorphic to open/close pairing.
7. **Jin et al. (2026), item 22** — recent, annotated, supervised behavioral-log boundary detector with strong metrics.
8. **Halfaker et al. (2015), item 7** — data-derived inter-activity regime across diverse platforms; directly undermines inherited 30-min defaults.
9. **Bayir & Toroslu (2022), item 18** — graph/path formalism preserves branching that serial timeouts destroy.
10. **Zhao et al. (2022), item 54** — missing-event intervals are modeled probabilistically and shown to bias >10% of derived trips, the best CDR analogy for missing close events.

## Contradictions and qualifications

- **Contradiction:** Adjacent fields do not universally hide the session rule. Several publish algorithms, pseudocode/formulas, sensitivity tests, and ground-truth comparisons.
- **Contradiction:** “30 minutes” is not the only evidence-based candidate. Meiss finds no intrinsic temporal scale; Halfaker argues ~1 hour from cross-domain regularities; multiple search/click papers learn boundaries; process-mining approaches use model/attribute constraints with no inactivity gap.
- **Contradiction:** Reproducible event-to-case software exists. EC-SA-Data, REC, and attribute-driven case-notion discovery expose implementations.
- **Qualification:** Almost all formal methods optimize a domain proxy (process-model alignment, semantic coherence, annotated task boundary, GPS truth). Screen-time reconstruction lacks an equivalent gold standard, so these methods transfer as formalisms/evaluation designs, not as plug-in rules.
- **Qualification:** CDR mobility papers often infer stays/trips, not phone-use sessions. They are retained because their sparse point→durative episode problem, missing-event treatment, and threshold provenance are formally close.

## Three expected absences

1. No checked work attaches a machine-readable declaration of the chosen sessionization algorithm and parameters to each derived behavioral measure as provenance.
2. No checked study runs a screen-time-style multiverse of plausible event→episode rules and propagates it into final behavioral effect estimates; adjacent work usually selects/ranks one reconstruction.
3. No CDR/telephony paper found a general method for inferring *human communication-use sessions* from call/SMS events while distinguishing device/network-initiated events; CDR “session” searches mostly returned already-identified billing/data sessions or mobility stays.

## Search/query and dead-end log

### Neutral/problem queries used

- `web user session identification algorithm evaluation adaptive timeout`
- `clickstream session segmentation changepoint clustering`
- `web log sessionization limitations 30 minute timeout empirical evaluation`
- `browsing session boundary detection machine learning personalized timeout`
- `process mining event correlation case identification algorithm evaluation`
- `event log case correlation unlabeled events`
- `case notion discovery process mining correlation algorithm`
- `process event correlation missing case identifier clustering optimization`
- `call detail records session inference algorithm`
- `CDR inter-event time activity episodes temporal clustering`
- `CDR stay location inference temporal threshold evaluation`

### Negation/limitation queries used

- `web sessionization limitations timeout arbitrary`
- `why clickstream sessions fail global threshold`
- `process mining missing case identifier limitations loops`
- `CDR sparse hidden visits measurement bias`
- `stay point threshold sensitivity biased results`

### Alternative-vocabulary queries used

- `task boundary`, `search mission`, `logical session`, `maximal navigation path`, `inter-activity rhythm`
- `event-case correlation`, `case notion discovery`, `unlabeled event log`, `activity instance identification`, `event abstraction`, `log lifting`
- `communication burst`, `hidden visit`, `stay region`, `movement phase`, `trajectory completion`

### Dead ends / exclusions

- Modern session-based recommender papers overwhelmingly assume vendor/session IDs already exist; they model next-item prediction, not boundary construction.
- `CDR sessionization` was dominated by billing/3GPP/VoIP records that already contain a call/session ID; useful as standards context, not inference evidence.
- `event correlation` without `process mining` was dominated by cybersecurity alert aggregation/root-cause analysis, a different target.
- Google Analytics/vendor documentation gives configurable defaults but rarely an evaluated reconstruction algorithm; excluded from the paper count.
- “Clickstream segmentation” often meant image/object segmentation from mouse clicks; excluded.
- Search-query “segmentation” often meant token/phrase segmentation within one query; excluded unless it segmented sequences into tasks.
- GPS-only staypoint papers were capped after several strong evaluation/threshold exemplars to avoid crowding out CDR and process-mining lineages.
- No Chronicle, Parry/Toth, or already-known solution-name query was used.

## Totals and access ledger

- **Distinct retained items:** 66 (22 web/click/search; 31 process correlation/abstraction and adjacent sensor-stream activity detection; 13 CDR/network/stay analogues).
- **2015–Aug 2026:** 56. Foundational pre-2015 exceptions retained: items 1–7 and 50 because later literature directly inherits or contests them.
- **2020+:** 35.
- **Full text available and relevant method/results sections inspected:** 39.
- **Abstract/metadata-level only:** 27.
- **Cover-to-cover full-paper reads:** 0; the search optimized breadth and exact method extraction, and does not represent otherwise.
- **Explicit named/formal algorithm families:** 50.
- **Public code located:** 6 (EC-SA-Data, REC, attribute-driven case-notion discovery, RPM Segmentator, task recognition from UI data, and the Radiant IoT activity DSL).
- **Public raw evaluation data or standard public logs clearly usable:** at least 5; most industrial click/CDR data are restricted.
- **Episode/session rule exact enough to mark DECLARED:** 39; **UNDETERMINED:** 22; **N/A review/framework:** 5.

## Deduplicated bibliography

The 66 numbered entries above and below are the deduplicated bibliography. DOI/title matching was checked against Crossref/DBLP/publisher metadata and the full local corpus. Preprint and version-of-record pairs (Halfaker; de Leoni & Dündar; Bayomie EC-SA-Data; Zhao; Chen; TRANSIT; Seiger et al.) are one item each, not double-counted. Pegoraro et al. is discussed in threat ranking but excluded from the 66 count because it was already fully captured in the local dossier; add its version-of-record DOI `10.1007/978-3-031-07475-2_12` when assembling the paper bibliography.

<!-- chatgpt-pro-delta-20260805:C -->

## Independently reviewed additions — Slice C

### 63. Leno et al. (2020) — *Identifying Candidate Routines for Robotic Process Automation from Unsegmented UI Logs*

- **Stable source.** [DOI 10.1109/ICPM49681.2020.00031](https://doi.org/10.1109/ICPM49681.2020.00031); [code](https://github.com/volodymyrLeno/RPM_Segmentator); [data](https://doi.org/10.6084/m9.figshare.12543587).
- **Why it matters here.** **Citation threat/transfer candidate:** it treats a chronological UI-event stream as unsegmented and publishes an algorithm that recovers task episodes without a generic inactivity timeout.
- **Instrument and ladder rung.** Desktop UI interaction log; **N/A**.
- **Episode reconstruction rule.** **DECLARED.** “Each UI that is the target of a back-edge is an eligible segment starting point”; the back-edge source is an eligible ending point (§III-B, printed pp. 4–5, Algorithm 3). Graph structure, strongly connected components, and dominance identify repeated routines.
- **Session threshold.** No elapsed-time threshold; boundaries are graph-structural.
- **Availability.** Public segmentation code and Figshare evaluation data; **independently rerunnable**.
- **Access.** Full conference paper/preprint, code, and data; **full text**.

### 64. Rebmann & van der Aa (2024) — *Recognizing Task-Level Events from User Interaction Data*

- **Stable source.** [DOI 10.1016/j.is.2024.102404](https://doi.org/10.1016/j.is.2024.102404); [code/data](https://gitlab.com/processanalytics/task-recognition-from-user-interaction-data).
- **Why it matters here.** **Citation threat/transfer candidate:** it supplies an explicit, evaluated predicate for whether adjacent low-level interaction chunks belong to one task or two.
- **Instrument and ladder rung.** Desktop user-interaction events; **N/A**.
- **Episode reconstruction rule.** **DECLARED.** A boundary is proposed when adjacent chunks are contextually unrelated, share no data values, the first is not overhead, and subsequent control flow is nondeterministic; otherwise, “c_i and c_i+1 are considered to belong to the same task” (§4.2.2, printed p. 6).
- **Session threshold.** **0.3 cosine-relatedness threshold**, configurable: “we set it to 0.3 by default” (§4.2). This is a semantic-similarity classifier, not an inactivity gap; timestamps are left to future work.
- **Availability.** Public implementation and evaluation data; **independently rerunnable**.
- **Access.** Full open-access Information Systems article and repository; **full text**.

### 65. Brzychczy, Pełech-Pilichowski & Dworakowski (2024) — *Case ID Detection Based on Time Series Data—the Mining Use Case*

- **Stable source.** [arXiv DOI 10.48550/arXiv.2410.23846](https://doi.org/10.48550/arXiv.2410.23846); [data](https://doi.org/10.17632/7cghj7fffp.1).
- **Why it matters here.** It exposes expert-selected segmentation parameters in industrial event-log construction and validates inferred cases against process knowledge and another dataset.
- **Instrument and ladder rung.** Industrial sensor time series transformed into process cases; **N/A**.
- **Episode reconstruction rule.** **DECLARED.** Candidate boundaries are a local minimum, a fixed-length window with a marked short-term mean change, and a rapid-change pattern; the method describes a “fixed length … significant change in short-term mean value.”
- **Session threshold.** Mining case: `Yth = 10.3`, `Lwzth = 100`; CNC example: `Yth = 0.7`, `Lwzth = 100`; a 300 m location/outlier criterion is also used. The authors state that “the main parameters are determined arbitrarily,” using expert/process knowledge rather than inherited empirical provenance.
- **Availability.** Public data; MATLAB implementation described but no public code repository located. **Partly rerunnable, not independently complete.**
- **Access.** Full arXiv paper and dataset record; **full text**.

### 66. Seiger, Locher, Kaufmann & Kurz (2026; preprint 2025) — *A Domain-Specific Language and Architecture for Detecting Process Activities from Sensor Streams in IoT*

- **Stable source.** [DOI 10.1016/j.iot.2025.101870](https://doi.org/10.1016/j.iot.2025.101870); [preprint](https://doi.org/10.48550/arXiv.2507.00686); [code](https://github.com/ics-unisg/radiant-iot-activity-dsl).
- **Why it matters here.** **Transfer candidate:** an inspectable DSL compiles declared start, intermediate, and end patterns into complex-event processing.
- **Instrument and ladder rung.** IoT sensor streams; **N/A**.
- **Episode reconstruction rule.** **DECLARED.** A `startPattern` and an `endPattern` “are both mandatory”; intermediate patterns are optional (DSL metamodel/grammar and activity-pattern definitions).
- **Session threshold.** In the `Sanitize_hands` example, low→high start and high→low end conditions must occur within **30 seconds**, justified by possible repeated dispenser use during one activity. This is a condition-window parameter, not a universal inactivity timeout.
- **Availability.** Public DSL/compiler repository, prototype, and example/evaluation assets; **independently rerunnable**.
- **Access.** Full preprint, final DOI metadata, and GitHub source; **full text**.

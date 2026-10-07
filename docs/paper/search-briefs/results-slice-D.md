# Results — SLICE D: measurement theory and multiverse

> **Independent expansions (2026-08-05 and 2026-08-06):** The appended passes retain **105 locally deduplicated works** balanced across psychometrics/meta-research, direct smartphone sensing, digital traces, neurophysiology, actigraphy, and wearables. D73–D95 are 23 repo-wide-new records from a second direct-field pass, D96–D103 are the first Pro-reconciled delta, and D104–D105 are the fresh Pro-discovery delta; do not infer coverage from the shorter initial heading count.

Scope executed: researcher degrees of freedom in preprocessing; multiverse / specification-curve
analysis applied **below** the analysis layer; reliability of derived behavioural measures;
validity of vendor-supplied aggregates; anyone arguing a preprocessing choice should be reported
as a measurement decision.

Method note: `WebSearch` + `WebFetch` + `curl` only. No browser automation was used. Two PDFs
(Muise et al. 2023; Shaw et al. 2020) were fetched as binaries and read page-by-page; quotes from
those two carry page numbers I verified visually. Where I could only reach an abstract or a search
snippet, the entry says so and the reconstruction rule is recorded as **UNDETERMINED**, never
guessed.

---

## HEADLINE — the sharpest citation threat exists, and it is not in the screen-time literature

**Someone has already run a multiverse over a preprocessing/reconstruction step on raw device
event traces, including the session-gap threshold itself.** Two of them, in fact, from the same
research programme (survey methodology / web-tracking, not psychology): **Ochoa & Revilla (2025)**
and **Bosch (2023)**. Neither touches Android `UsageEvents` and neither addresses missing close
events, but both establish the *method* — vary the measurement-construction rules, not the model —
on passively logged digital traces. Entry 1 and Entry 2 below. Read them before writing the
contribution claim.

The second-sharpest is **Muise, Ram, Robinson & Reeves (2023)**, who name the aggregation step as
a measurement error class ("bundling"), *declare* their own session rule verbatim, and explicitly
flag log sources that record arrival times but not exit times. Entry 3.

---

## 1. Ochoa, C., & Revilla, M. (2025) — Variability of a job search indicator induced by operationalization decisions when using digital traces from a meter

*PLOS ONE*, 10.1371/journal.pone.0338894 (published 22 December 2025).

- **Why it matters here. CITATION THREAT — RANK 1.** This is a 10,080-cell multiverse run entirely
  over *measurement-construction* decisions on passively logged device traces — including the
  session-gap threshold, the minimum visit duration, and outlier handling — with **no statistical
  model variation at all**. It is the closest published thing to "a multiverse below the analysis
  layer on device logs," and it is on a meter stream rather than survey items.
- **Instrument and ladder rung.** Rung 3-equivalent for the web domain: Wakoopa meter installed by
  Netquest panellists on PCs and mobile, recording URLs/visits with timestamps. Not a platform
  event log with declared semantics (Rung 4) and not a vendor aggregate (Rung 1).
- **Episode reconstruction rule. DECLARED, and systematically varied.** Abstract, verbatim: "By
  varying metrics—combinations of measurement targets (such as sessions on job platforms or job
  offer pages) and measurement types (such as visit counts or time spent)—along with other factors
  (e.g., methods for separating search activity into spells or handling outliers), the study
  explores 10,080 operationalizations." Also verbatim, on the maximum-duration case: "options
  include discarding the visit entirely, capping the recorded time at the maximum considered an
  outlier, or replacing it with the mean or median time."
- **Session threshold.** Three values tested — **10, 30, 60 minutes** — inactivity-gap kind.
  Verbatim justification: "Session time follows the 30-minute standard used in Google Analytics
  that is also commonly applied in studies using metered data (e.g., [46]), with 10- and 60-minute
  alternatives used to capture shorter or longer sessions." **This is a pure provenance
  inheritance: the 30 minutes is justified by Google Analytics convention, not by data.** Two other
  thresholds carry their own inherited provenance: search-spell separation of 0/30/60/90 days,
  where the 30-day choice is traced to Faberman & Kudlyak's 5-week threshold in prior job-search
  work; and minimum visit duration of 2/5/10 seconds, "adapted from Bosch's media exposure study."
  Headline result: "correlations between measurement pairs ranging from 0.14 to 0.91," and
  "operationalization decisions can affect substantive findings."
- **Availability.** Data and materials at `https://doi.org/10.17605/OSF.IO/SK4A5`. Analyses in R
  4.2.3; a separate code-availability statement was not found in the sections I read. The
  operationalization step is re-runnable in principle from the OSF deposit — I did not open the
  deposit to confirm.
- **Access.** Full text read via PLOS article page and the PMC mirror (PMC12721509); quotes above
  are verbatim from those. Not read cover-to-cover — extraction was targeted at the
  operationalization, threshold, and availability sections.

## 2. Bosch, O. J. (2023) — Validity and Reliability of Digital Trace Data in Media Exposure Measures: A Multiverse of Measurements Analysis

SocArXiv / OSF Preprints, 10.31235/osf.io/fyr2z, posted 24 November 2023.

- **Why it matters here. CITATION THREAT — RANK 2.** Coins and names the "multiverse of
  measurements" approach: applying multiverse logic to the *construction of a measure from traces*
  rather than to the analysis. Explicitly frames design choices in trace-to-measure conversion as
  the object of study, and reports reliability across the whole space.
- **Instrument and ladder rung.** Rung 3-equivalent for web: cross-national three-wave survey
  combined with web tracking (metered data).
- **Episode reconstruction rule. DECLARED, and systematically varied.** Abstract, verbatim: "this
  paper conducts a multiverse analysis to assess the validity and reliability of +2,500 measures of
  media exposure... Additionally, results suggest that design choices impact the quality of web
  tracking measures. Methodologically, the paper presents a multiverse of measurements approach,
  improving the transparency of web tracking research."
- **Session threshold.** A minimum-visit-duration threshold is one of the varied choices — a
  downstream citation reports it as: "a visit definition of any opened URL/app lasting one second
  or more has been shown to produce more reliable media exposure measures than other stricter
  thresholds (Bosch, 2023)." I read that characterisation in a secondary source, **not** in the
  preprint body; treat the "one second" figure as UNDETERMINED until the PDF is read. Reported
  overall reliability in the abstract: "an overall high reliability (0.86)."
- **Availability.** Not determined — I retrieved the record through the OSF API, not the file.
- **Access.** **Abstract only** (verbatim, via `api.osf.io/v2/preprints/fyr2z/`). The
  human-facing OSF page returns a JavaScript shell to WebFetch with no content; recorded as
  unavailable by the brief's rule. A peer-reviewed version may exist — Bosch has related work in
  *Communication Methods and Measures* — but I could not confirm that this specific paper was
  published, so its venue is **UNDETERMINED**.

## 3. Muise, D., Ram, N., Robinson, T., & Reeves, B. (2023) — Identification, Impacts, and Opportunities of Three Common Measurement Considerations when using Digital Trace Data

arXiv:2310.00197 (cs.HC), Stanford University, 2023. Framed by the authors as a "commentary"/
"research note"; no journal venue stated on the manuscript.

- **Why it matters here. CITATION THREAT — RANK 3, and simultaneously the single most useful
  *contradicting* paper in this slice.** They (a) name the event→duration aggregation step as a
  distinct measurement-error class, (b) *declare their own session rule verbatim*, (c) explicitly
  identify the "arrival time but no exit time" log pathology that is the whole reason a
  reconstruction rule is needed, and (d) argue aggregation decisions must be documented and
  justified. That is four-fifths of the argument, on screenshot data rather than platform events.
- **Instrument and ladder rung.** Rung 3, unusually rich: 115 participants, Human Screenome
  Project, screen-recording software capturing "all visual screen-content every five seconds, as
  well as foreground-application logs," 4,907,091 screenshots over two weeks (p.2).
- **Episode reconstruction rule. DECLARED.** p.2, verbatim: "We identified *sessions* of screen
  activity (defined as the time between screen on and off) by identifying gaps in the timestamp
  chronology of length >5s." And on segment duration, p.4: "content segments, with duration equal
  to five times the screenshot count (as we used a frame rate of 0.2 fps)."
- **Session threshold.** **>5 s gap in timestamp chronology**, kind = inactivity gap in the capture
  stream. Justification is mechanical rather than behavioural — 5 s is the screenshot sampling
  period, so a >5 s gap is a missing frame. No behavioural justification is offered and none is
  claimed. Separately, p.5: "Almost half of all political content segments lasted just five
  seconds, the minimum segment duration detectable in our data."
- **The three error classes, verbatim (p.2 and p.7).** "(1) *entangling* – the common measurement
  error introduced by proxying exposure to content by exposure to format; (2) *flattening* –
  aggregating unique segments of media interaction without incorporating temporal information, most
  commonly intraindividually and (3) *bundling* –summation of the durations of segments of media
  interaction, indiscriminate with respect to variations across media segments." Expanded, p.7:
  "*bundling* occurs when researchers indiscriminately sum the temporal information associated with
  multiple segments into a single aggregate duration metric... *Bundling* creates synthetic
  aggregates of experience that do not reflect the fragmented experiences of the individuals who
  experienced them."
- **The missing-exit-event problem, named. p.6, verbatim:** "We note that some otherwise rich log
  data sources contain only partial temporal information, such as *arrival* times at a URL but not
  *exit* times, subtly complicating the robust computation of durations when there may be breaks in
  an individual's media usage in the middle of a logging period." This is the closest published
  statement I found to "the closing event never arrives" as a *measurement* problem — but they
  raise it as a reason to prefer screenshot capture, and do not propose or evaluate a rule.
- **"Report it as a measurement decision," verbatim. p.8:** "We concede that the continuous nature
  of time itself demands that some level of aggregation is inevitable in any media measurement. We
  argue that bundling is essentially the practice of temporal aggregation done wrong... Our own
  aggregation decisions in this work are not infallible, but they are also far from arbitrary, and
  their determination is documented and justified plainly. In research making use of DTD, we
  suggest that the way to 'unbundle' media measures is to ensure that aggregate temporal units are
  considered not just in reference to the granularity or the ease with which overall totals can be
  computed, but also in reference to theoretical and conceptual goals of research."
- **Availability.** No data or code availability statement appears in the manuscript. Screenome
  data are not openly available; the paper itself concedes "Given the difficulty of obtaining such
  data, it is unlikely that it can be collected at cross-sectional scales familiar to those making
  use of DTD" (p.8). The event→episode step is **not** re-runnable by a third party.
- **Access.** **Full text read** (arXiv PDF, pages 1–8 of the manuscript body read as images).

## 4. Clayson, P. E., Baldwin, S. A., Rocha, H. A., & Larson, M. J. (2021) — The data-processing multiverse of event-related potentials (ERPs): A roadmap for the optimization and standardization of ERP processing and reduction pipelines

*NeuroImage*, 245:118712. DOI 10.1016/j.neuroimage.2021.118712.

- **Why it matters here. CITATION THREAT — RANK 4 (methodological precedent, different domain).**
  This is the canonical demonstration that a multiverse can be run over a *signal-to-score
  reconstruction pipeline* rather than over analysis choices, and that the reconstruction step
  materially changes both the derived measure and its reliability. It is the strongest available
  precedent for the claim "the rule that turns raw signal into a scored episode is itself the
  object of study." The exact structural analogue of what a screen-time preprocessing multiverse
  would be.
- **Instrument and ladder rung.** N/A (EEG, not device logs). The analogue of "Rung 4" holds:
  continuous raw signal with declared acquisition semantics.
- **Episode reconstruction rule. DECLARED and systematically varied.** Abstract, verbatim: "ERN and
  Pe data from 298 healthy young adults were used to determine the impact of different
  methodological choices on data quality and experimental effects (correct vs. error trials) at
  several key stages: highpass filtering, lowpass filtering, ocular artifact correction, reference,
  baseline adjustment, scoring sensors, and measurement procedure. This multiverse analysis yielded
  3,456 ERN scores and 576 Pe scores per person."
- **Session threshold.** N/A. The nearest analogue — the scoring/measurement window — is one of the
  varied dimensions; the optimised Pe pipeline used "a -200 to 0 ms baseline adjustment window."
- **Availability.** Not determined from the abstract.
- **Access.** **Abstract only**, verbatim via PubMed (PMID 34800661). Full text is behind
  ScienceDirect.
- **Related, same lineage, worth citing together (all abstract/metadata only):** Clayson (2024),
  "Beyond single paradigms, pipelines, and outcomes: Embracing multiverse analyses in
  psychophysiology," *Int. J. Psychophysiology* (PMID 38296000); Šoškić et al. commentary, "Bring a
  map when exploring the ERP data processing multiverse" (PMID 35792288); Huang, Moffa, Loo &
  Nikolin (2025), "No Single Best Pipeline: Multiverse Analysis of EEG Preprocessing for N-Back
  Working Memory Tasks," *Psychophysiology*, DOI 10.1111/psyp.70197 — 43 preprocessing pipelines,
  164 participants, conclusion "No preprocessing pipeline performed optimally across all assessment
  dimensions"; Jacobsen et al. (2025), "Preprocessing choices for P3 analyses with mobile EEG,"
  *Psychophysiology*, DOI 10.1111/psyp.14743.

## 5. Niemeijer, K., Mestdagh, M., & Kuppens, P. (2022) — Tracking Subjective Sleep Quality and Mood With Mobile Sensing: Multiverse Study

*Journal of Medical Internet Research*, 24(3):e25643. DOI 10.2196/25643.

- **Why it matters here. CITATION THREAT — RANK 5, and the only multiverse I found that includes
  smartphone *screen-state* data as an input.** It varies preprocessing options alongside features
  and models on passively sensed smartphone streams. Crucially for us: it *fixes* the screen-state
  reconstruction rule and varies everything downstream — i.e. it stops exactly where our
  contribution starts.
- **Instrument and ladder rung.** Rung 2 for the screen stream (screen on/off software sensor),
  alongside accelerometer, charging status, light, physical activity, Wi-Fi. 2-week trial, 60
  participants recruited, 50 retained.
- **Episode reconstruction rule. DECLARED but not varied.** Verbatim: "The screen state software
  sensor was preprocessed in such a way that interactions of less than 12 seconds were ignored."
  No justification for the 12 s value is given in the text I read; treat its provenance as
  **UNDETERMINED**.
- **Session threshold.** 12 s minimum-interaction filter (kind = minimum-duration floor, not an
  inactivity gap). The multiverse dimensions were, verbatim: "sensors," "features," "outcome
  variables," "models," "outlier removal," and "feature thresholds" — **12,600 combinations**.
  Outlier-removal options verbatim: "None," "median(x) ± 3σx per participant," "median(x) ± 3 ×
  mad(x) per participant," and "Isolation forests."
- **Availability.** No data or code availability statement was present in the full text I fetched.
- **Access.** Full text via PMC8976254; abstract quoted is partial (the fetched extraction elided a
  middle portion, marked with an ellipsis above — do not cite the abstract as continuous prose
  without re-reading it).

## 6. Shaw, H., Ellis, D. A., Geyer, K., Davidson, B. I., Ziegler, F. V., & Smith, A. (2020) — Quantifying Smartphone "Use": Choice of Measurement Impacts Relationships Between "Usage" and Health

*Technology, Mind, and Behavior*, 1(2). DOI 10.1037/tmb0000022.

- **Why it matters here.** The clearest published demonstration *in the smartphone domain* that the
  choice of use-measure changes the substantive conclusion — but it varies the **instrument**
  (PSU scale vs. self-estimate vs. objective log vs. vendor aggregate), **not the reconstruction
  rule**. It is therefore a supporting citation and a demonstration of the gap, not a threat. It
  also, incidentally, documents the missing-close-event problem and works around it with a robust
  statistic rather than a rule.
- **Instrument and ladder rung.** **Study 1: Rung 2.** Custom Android app, p.3 verbatim: "Objective
  smartphone data were collected using an application developed specifically for the project called
  Activity Logger (Geyer, 2018). This ran on Android devices and collected data to the resolution
  of 1 s. Activity logger was set up to listen to three events: the phone being turned on, the
  screen being activated, and the screen being turned off... This data file was then exported via
  the application and contained a list of records where a UNIX time stamp was paired with an event
  stating whether the screen was turning 'ON' or 'OFF'." **Study 2: Rung 1 (vendor aggregate),
  transcribed by hand.** p.7 verbatim: "Objective smartphone usage data were retrieved by utilizing
  the Apple Screen Time feature that resides in modern iPhones. We used the same methodology as
  reported in the study by Ellis et al. (2019) and extracted data retrospectively from the previous
  7 days. In short, participants were prompted to find the 'Screen Time' graph and the 'Pickups'
  graph in Apple Screen Time settings and record for each day the number of pickups and screen time
  (in hours and minutes)."
- **Episode reconstruction rule. Study 1: PARTIAL — episodes are screen-ON to screen-OFF pairs, and
  the failure mode is acknowledged but handled statistically rather than by a rule.** p.4 verbatim:
  "The median daily hours-of-use was calculated across days 2–8 for each person to remove the
  influence of any extreme 'Screen On' events that occurred if the phone battery depleted and the
  application did not log a 'Screen Off' event." Footnote 1, p.4 verbatim: "Finally, median daily
  screen time was calculated instead of average daily screen time to control for any long 'ON'
  durations. These could occur if a smartphone was unable to record an 'OFF' log until power is
  restored following battery depletion." **Study 2: DELEGATED — to Apple.** No rule is stated
  because none is available.
- **Session threshold.** A **15 s** classifier appears and is then abandoned. Footnote 1, p.4
  verbatim: "Third, we now report daily pickups (any smartphone use) instead of daily checks (uses
  under 15 s) to again ensure parity between the two studies." Kind = length classifier (check vs.
  use), no justification given for 15 s. Supporting distributional fact, p.4 verbatim: "smartphone
  use was highly skewed, as 54.44% of uses were under 30 s in duration, and 43.54% of uses were
  under 15 s in duration."
- **Availability.** Strong. Data `https://osf.io/sw38c/`; materials and Activity Logger source code
  `https://osf.io/a4p78/`; preregistrations `https://osf.io/92ebz` (Study 2) and
  `https://osf.io/5g9v6` (Study 1). The Study 1 screen-on/off → duration step is re-runnable by a
  third party from the deposit. The Study 2 Apple Screen Time step is **not** re-runnable by
  anyone, including the authors.
- **Access.** **Full text read** (version of record, CC BY-NC-ND, University of Bristol repository
  PDF, pages 1–10 read as images; General Discussion partially read).

## 7. Steegen, S., Tuerlinckx, F., Gelman, A., & Vanpaemel, W. (2016) — Increasing Transparency Through a Multiverse Analysis

*Perspectives on Psychological Science*, 11(5), 702–712. DOI 10.1177/1745691616658637.

- **Why it matters here.** The origin of the argument, and — important for the framing — the
  original multiverse was **explicitly a data-processing multiverse**, not an analysis multiverse.
  The field then drifted toward varying models and covariates. Our contribution can be positioned
  as returning the multiverse to where Steegen et al. put it.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Key quotes, verbatim with page numbers.** p.707: "A multiverse analysis involves performing the
  analysis of interest across the whole set of data sets that arise from different reasonable
  choices for data processing." p.706: "However, choosing among the possibilities during data
  processing is often arbitrary, and justifications for the choices are typically lacking." p.706:
  "Transparency could be increased by performing, for each research question, the same analysis for
  all possible data sets, defined by the reasonable choices for data processing." p.707: "These
  processing steps typically come with many researcher degrees of freedom (Simmons, Nelson, &
  Simonsohn, 2011)."
- **Availability.** N/A (methodological paper; supplemental materials exist at
  `sites.stat.columbia.edu/gelman/research/published/multiverse_sup.pdf`).
- **Access.** Targeted verbatim extraction from the open PDF; not read cover-to-cover.

## 8. Del Giudice, M., & Gangestad, S. W. (2021) — A Traveler's Guide to the Multiverse: Promises, Pitfalls, and a Framework for the Evaluation of Analytic Decisions

*Advances in Methods and Practices in Psychological Science*, 4(1). DOI 10.1177/2515245920954925.

- **Why it matters here.** The necessary counterweight, and a defence we will need. Their framework
  classifies candidate pipelines as **equivalent, nonequivalent, or uncertain**, and warns that a
  multiverse over non-arbitrary alternatives is misleading. Reconstruction rules are almost
  certainly *nonequivalent* (they answer different questions about what an episode is), so a naive
  screen-time multiverse would be exactly the failure mode they describe. Cite it to justify
  treating rules as declared alternatives rather than as an undifferentiated cloud.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** Code, data, and analysis script on figshare (DOI 10.6084/... record
  "12089736"); I did not open it.
- **Access.** Abstract and secondary summary only; an open PDF exists at the psicostat winter-school
  site. Verbatim quotes **not** captured — do not attribute wording to them without reading it.

## 9. Flake, J. K., & Fried, E. I. (2020) — Measurement Schmeasurement: Questionable Measurement Practices and How to Avoid Them

*Advances in Methods and Practices in Psychological Science*, 3(4). DOI 10.1177/2515245920952393.

- **Why it matters here.** The canonical statement that undisclosed measurement decisions are a
  distinct research-integrity failure, separate from analysis flexibility. This is the paper to
  cite for "a preprocessing choice should be reported as a measurement decision" — it makes the
  *general* case; nobody has made the *specific* case for event→episode reconstruction.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** N/A.
- **Access.** **Abstract/summary only.** Their definition — QMPs as "decisions researchers make
  that raise doubts about the validity of the measures, and ultimately the validity of study
  conclusions, arising from a lack of transparency, ignorance, negligence, or misrepresentation of
  the evidence" — is quoted from a secondary summary, not from the article; verify before quoting.
  Open copy at `scholarlypublications.universiteitleiden.nl/access/item:4256421/view`.

## 10. Langener, A. M., Siepe, B. S., Elsherif, M., Niemeijer, K., Andresen, P. K., Akre, S., Bringmann, L. F., Cohen, Z. D., Choukas, N. R., Drexl, K., Fassi, L., Green, J., Hoffmann, T., Jagesar, R. R., Kas, M. J. H., Kurten, S., Schoedel, R., Stulp, G., Turner, G., & Jacobson, N. C. (2024) — A template and tutorial for preregistering studies using passive smartphone measures

*Behavior Research Methods*. DOI 10.3758/s13428-024-02474-5.

- **Why it matters here.** The most direct "preprocessing is a decision that must be declared in
  advance" argument aimed at passive smartphone data specifically. Twenty authors including
  Niemeijer (entry 5) and Schoedel. This is a strong ally and a partial threat: it *asks* for the
  rule to be specified, but supplies no taxonomy of rules and never mentions event pairing.
- **Instrument and ladder rung.** N/A (methodological template covering Rung 2–3 studies).
- **Episode reconstruction rule. ABSENT** — the template names the decision category without
  enumerating options for it.
- **Session threshold.** None specified. Named decision categories, verbatim: "Aggregation choices
  to compute features" (Textbox 3); "time scale chosen to summarize variables can affect the
  results" (Data processing section); "strategy chosen to label missing data has been shown to
  affect the outcome" (Quality control); "researchers often come up with strategies to exclude
  data...such as to include a day's data only if at least half of that day's data are recorded"
  (Quality control).
- **Key claims, verbatim.** Abstract: "researchers must make multiple decisions when working with
  such measures, which can result in different conclusions." Data processing section: "we argue for
  specifying as many decisions as possible in the preregistration." They frame the decision space
  with Gelman & Loken's "garden of forking paths" metaphor and with a "known knowns / known
  unknowns / unknown unknowns" split (Discussion).
- **Availability.** Not determined.
- **Access.** Full text via PMC11525430; targeted verbatim extraction.

## 11. Sen, I., Flöck, F., Weller, K., Weiß, B., & Wagner, C. (2021) — A Total Error Framework for Digital Traces of Human Behavior on Online Platforms (TED-On)

*Public Opinion Quarterly*, 85(S1), 399–422. Preprint arXiv:1907.08228 (2019).

- **Why it matters here.** Provides the vocabulary for locating the event→episode rule inside a
  named error taxonomy, adapted from Total Survey Error. If we want to say "reconstruction error is
  a distinct error class," this is the framework to slot it into. Muise et al. (entry 3) cite it
  approvingly.
- **Instrument and ladder rung.** N/A (framework).
- **Episode reconstruction rule. N/A.**
- **Session threshold.** N/A.
- **Availability.** N/A.
- **Access.** **Abstract/metadata only.** I did not read the framework's error-class list, so I
  cannot state whether it contains a measurement/construction error class that covers episode
  reconstruction. **UNDETERMINED — this is the highest-value unread item in the slice.**

## 12. Bosch, O. J., & Revilla, M. (2022) — When Survey Science Met Web Tracking: Presenting an Error Framework for Metered Data

*Journal of the Royal Statistical Society Series A*, 185(Supplement 2), S408–…

- **Why it matters here.** The metered-data-specific error framework underpinning entries 1 and 2.
  Reported to contain a three-step operationalization procedure for turning traces into
  measurements — i.e. an explicit account of the trace→measure construction step as a source of
  error.
- **Instrument and ladder rung.** N/A (framework, web-tracking domain).
- **Episode reconstruction rule. UNDETERMINED** (not read in full).
- **Session threshold.** UNDETERMINED.
- **Availability.** N/A. Open working-paper version at
  `https://www.upf.edu/documents/3966940/6839730/WP62.pdf/...`.
- **Access.** **Metadata plus secondary summary only.**

## 13. Orben, A., & Przybylski, A. K. (2019) — The association between adolescent well-being and digital technology use

*Nature Human Behaviour*, 3, 173–182. DOI 10.1038/s41562-018-0506-1.

- **Why it matters here. NOT a threat — it is the proof of the gap, and should be used that way.**
  This is the field's canonical multiverse on screen time, and **every varied specification sits at
  or above the analysis layer**. There is no raw event stream anywhere in it, so no reconstruction
  rule could have been varied. It is the best available evidence that the screen-time multiverse
  literature has never gone below the analysis layer.
- **Instrument and ladder rung.** **N/A — self-report only.** Three secondary datasets: Monitoring
  the Future (MTF), Youth Risk and Behaviour Survey (YRBS), Millennium Cohort Study (MCS); total
  n = 355,358.
- **Episode reconstruction rule. N/A** (no device data).
- **Session threshold.** N/A. The four varied decision families, verbatim from Table 1: "*Operationalizing
  adolescent well-being*", "*Operationalizing technology use*", "*Which co-variates to include*",
  "*Other specifications*" — where "operationalizing technology use" means *which self-report
  questionnaire items to average*, e.g. for MCS "Five questions concerning TV use, electronic games,
  social media use, owning a computer and using the Internet at home, or the mean of these
  questions." Specification counts, verbatim: "Three hundred and seventy-two justifiable
  specifications for the YRBS, 40,966 plausible specifications for the MTF and a total of
  603,979,752 defensible specifications for the MCS were identified," of which "we selected 20,004
  specifications for the MCS." Headline: "explaining at most 0.4% of the variation in well-being."
- **Availability.** Not determined — I did not reach the data-availability statement. **UNDETERMINED.**
- **Access.** **Full text read** for pages 1–6 (Introduction through Discussion) via the open PDF
  at gwern.net; supplementary methods not read.

## 14. Kaye, L. K., Orben, A., Ellis, D. A., Hunter, S. C., & Houghton, S. (2020) — The Conceptual and Methodological Mayhem of "Screen Time"

*International Journal of Environmental Research and Public Health*, 17(10), 3661. PMID 32456054.

- **Why it matters here.** The standard citation for "the construct is incoherent and the measures
  are non-standardised." Supports the framing but attributes the mayhem to *conceptualisation and
  self-report*, not to processing — which is precisely the attribution gap our paper fills.
- **Instrument and ladder rung.** N/A (review).
- **Episode reconstruction rule. ABSENT** — from the abstract, the identified shortcomings are
  "poor conceptualization, the use of non-standardized measures that are predominantly self-report,
  and issues with measuring screen time over time and context." Processing is not named.
- **Session threshold.** N/A.
- **Availability.** Open access (PMC7277381).
- **Access.** **Abstract/summary only.**

## 15. Botvinik-Nezer, R., Holzmeister, F., Camerer, C. F., et al. (2020) — Variability in the analysis of a single neuroimaging dataset by many teams

*Nature*, 582, 84–88. DOI 10.1038/s41586-020-2314-9. (NARPS.)

- **Why it matters here.** The many-analysts counterpart to the multiverse: 70 teams, one dataset,
  no two identical workflows, materially different hypothesis conclusions. Establishes that
  pipeline variability is real in practice and not just in a simulated grid — the argument for why
  a declared rule matters.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A. Reported verbatim from the summary: "no two teams chose
  identical workflows to analyze the data, and this flexibility resulted in sizeable variation in
  hypothesis test results, even for teams whose statistical maps were highly correlated at
  intermediate stages of their analysis pipeline."
- **Session threshold.** N/A.
- **Availability.** NARPS materials at `narps.info`; not opened.
- **Access.** **Abstract/summary only** (search snippets plus the bioRxiv/Nature landing metadata).

## 16. Patel, C. J., Burford, B., & Ioannidis, J. P. A. (2015) — Assessment of vibration of effects due to model specification can demonstrate the instability of observational associations

*Journal of Clinical Epidemiology*. PMID 26279400. Plus the follow-on: Klau et al. / Ioannidis
group, "Examining the robustness of observational associations to model, measurement and sampling
uncertainty with the vibration of effects framework," *International Journal of Epidemiology*,
50(1), 266–… (2021).

- **Why it matters here.** "Vibration of effects" is the parallel vocabulary to multiverse, and the
  2021 IJE extension explicitly separates **measurement uncertainty** from model and sampling
  uncertainty — which is the decomposition our paper needs. There is also a Meta-Psychology paper
  titled "Comparing the vibration of effects due to model, data pre-processing..." that I surfaced
  but did not read.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** N/A.
- **Access.** **Abstract/snippet only** for all three. The Meta-Psychology item's full citation is
  **UNDETERMINED** — I have only the URL `open.lnu.se/index.php/metapsychology/article/view/2556`.

## 17. Short, C. A., Breznau, N., Bruntsch, M., Burkhardt, M., Busch, N. A., Cesnaite, E., Frank, M., Gießing, C., Krähmer, D., Kristanto, D., Lonsdorf, T., Neuendorf, C., Nguyen, H. H. V., Rausch, M., Schmalz, X., Schneck, A., Tabakci, C., & Hildebrandt, A. (2026) — Multicurious: A Multidisciplinary Guide to Multiverse Analysis

*Advances in Methods and Practices in Psychological Science*, 9(2). DOI 10.1177/25152459261434881.

- **Why it matters here.** The current state-of-the-art practical guide, published 2026 — the most
  recent thing in the slice, and it frames the multiverse explicitly around **data-processing**
  pipelines. Cite for currency and for the mapping-and-computing procedure.
- **Instrument and ladder rung.** N/A.
- **Episode reconstruction rule.** N/A.
- **Session threshold.** N/A.
- **Availability.** Not determined.
- **Access.** **Abstract/summary only.** Summary wording: multiverse analysis "offers a response to
  uncertainty in scientific conclusions from flexible data-processing decisions, by systematically
  mapping and computing plausible data-processing pipelines."

## 18. Validity of vendor-supplied aggregates — cluster

Grouped because none of these was read in full and the fields are the same shape.

**18a. Sewall, C. J. R., Bear, T. M., Merranko, J., & Rosen, D. (2020) — How psychosocial
well-being and usage amount predict inaccuracies in retrospective estimates of digital technology
use.** *Mobile Media & Communication*, 8(3), 379–399.
- **Why it matters.** The most-cited use of Apple Screen Time as *ground truth*. It treats a vendor
  aggregate whose construction rule Apple has never published as the criterion against which human
  recall is scored. That inversion is directly quotable as the field's blind spot.
- **Rung 1** (Apple Screen Time, participant-transcribed). **Rule: DELEGATED to Apple**, no rule
  recoverable. **Threshold: none stated.** Availability not determined.
- **Access: abstract/summary only.** Reported finding: "participants misestimated their weekly
  overall iPhone and social media use by 19.1 and 12.2 hours, respectively."

**18b. Andrews, S., Ellis, D. A., Shaw, H., & Piwek, L. (2015) — Beyond Self-Report: Tools to
Compare Estimated and Real-World Smartphone Use.** *PLoS ONE*, 10(10), e0139004.
- **Why it matters.** The origin point of the "logs beat estimates" line that later work inherits;
  n = 23, two weeks. Small, and the reconstruction rule behind "actual use" is not visible from the
  abstract.
- **Rung 2 or 3 — UNDETERMINED.** **Rule: UNDETERMINED.** **Threshold: UNDETERMINED.**
- **Access: abstract/summary only.** Open access at PLOS; Lancaster eprints copy exists.

**18c. Criterion validity of a research-based application for tracking screen time on Android and
iOS smartphones and tablets** (SDU DeviceTracker), *Journal of Sport and Health Science* /
ScienceDirect S2451958821001123, 2021/2022. Authors **UNDETERMINED** — I did not open the article.
- **Why it matters.** The one direct measurement of vendor-aggregate agreement I found:
  a research app validated against **Apple Screen Time (iOS)** and **ActionDash (Android)** as
  reference, n = 40. Reported: Android mean bias −0.8 min/day, r = 0.99; iOS mean bias
  **+19.3 min/day**, r = 0.88, with "a correction method for systematic error in the assessment of
  screen time on iOS devices" provided. A ~19 min/day systematic iOS discrepancy between two
  measurement stacks on the same device is exactly the kind of number our paper needs — but note
  that here the *vendor aggregate is the reference*, so the direction of the error is undetermined.
- **Rung 1 as reference, Rung 2/3 as index.** **Rule: UNDETERMINED** for both sides.
- **Access: abstract/summary only.**

**18d. Bosch Jover, O., Sturgis, P., Kuha, J., & Revilla, M. (2025) — Uncovering Digital Trace Data
Biases: Tracking Undercoverage in Web Tracking Data.** *Communication Methods and Measures*,
DOI 10.1080/19312458.2024.2393165.
- **Why it matters.** Coverage error, not reconstruction error — but it establishes that "the trace
  is the truth" is false even before any rule is applied. Reported: undercoverage affects "more
  than 70% of participants" in commercial panels.
- **Rung 3-equivalent (web).** **Rule: N/A.** **Threshold: N/A.**
- **Access: abstract/summary plus an open LSE Research Online PDF at
  `researchonline.lse.ac.uk/id/eprint/124537/`, not read.**

## 19. Accelerometry and actigraphy — the closest solved analogue outside media research

Grouped; all abstract/summary only. The value here is that **physical-activity research already
treats the raw-signal→bout conversion as a reportable measurement decision, and has done so for a
decade.** That is a borrowed formulation worth citing.

**19a. Wrist-worn accelerometers: Influence of decisions during data collection and processing: A
cross-sectional study**, 2023/2024, PMC10782047. Authors **UNDETERMINED**. Verbatim from the
abstract as surfaced: "Accelerometers collect data in an objective way, however, a number of
decisions must be done during data collection, processing and output-interpretation. The influence
of those decisions is seldom investigated, reported, or discussed." That sentence is almost exactly
our thesis, transposed to accelerometry.

**19b. Impact of accelerometer data processing decisions on the sample size, wear time and physical
activity level of a large cohort study**, *BMC Public Health*, 14:1210, 2014. Authors
**UNDETERMINED**. Pre-2015 so outside the brief's window, but it is the provenance root: wear-time
algorithm (logs / Troiano / Choi) changed sedentary time by ~30–60 min/day; axis choice (V-axis vs
vector magnitude) changed sedentary time by ~60 min/day and MVPA by ~10 min/day. Concrete evidence
that a preprocessing rule swing produces a clinically meaningful measure swing on identical raw
data.

**19c. Actigraphy sleep/wake scoring algorithm comparisons** (Cole-Kripke vs Sadeh vs Actiware vs
UCSD; e.g. PMID 29403321, and PMC12697920 "Comparison and Validation of Actigraphy Algorithms Using
a Large Community Dataset"). Reported sensitivity/specificity trade-offs: Cole-Kripke sensitivity
0.88–0.96 / specificity 0.35–0.64 vs Sadeh 0.82–0.91 / 0.47–0.68. **No multiverse; these are
pairwise algorithm comparisons.** Rule for each algorithm is DECLARED in its own source paper.

**19d. Consumer-wearable proprietary algorithms.** From an *npj Digital Medicine* piece on wearable
sleep-staging reliability (`nature.com/articles/s41746-024-01016-9`) and an *SLEEP* commentary
(`academic.oup.com/sleep/article/48/4/zsaf011/...`), both abstract/summary only: manufacturers can
change an algorithm mid-study — the reported example is Apple changing its heart-rate-variability
algorithm in 2021 such that "the same data from the same collection period could be markedly
different when pulled from the device at two time points." **This is the strongest available
argument that a vendor aggregate is not a measurement at all, because it is not stable under
re-derivation.** I have not verified the Apple HRV claim against a primary source — treat as
**UNDETERMINED** until confirmed.

## 20. Cross-slice pointers (not developed here — belong to A and C)

- **Mehrzadi, D., & Feitelson, D. G. — On Extracting Session Data from Activity Logs** (SYSTOR).
  Belongs to SLICE C, but carries the measurement-theoretic sentence this slice needs, verbatim
  from the paper as surfaced in search: "The analysis of sessions is sensitive to the selected
  threshold... This is highly undesirable because it implies that any research using the data about
  the sessions is also tainted and its results may depend on the precise threshold chosen." Also
  reports that "the global distribution of inter-activity intervals is typically smooth, with no
  natural threshold value." **Abstract/snippet only — I did not read the PDF.** Flagged so SLICE C
  does not miss it.
- **"How to Measure Sessions of Mobile Device Use?"** arXiv:1711.09408 — SLICE A/C. Not read.
- **van Berkel et al., "A Systematic Assessment of Smartphone Usage Gaps"** (CHI) — SLICE A. Not read.
- **Parry et al. (2025), "Extracting Meaningful Measures of Smartphone Usage from Android Event Log
  Data: A Methodological Primer," *Computational Communication Research*, 7(1), 1–32** — this is
  SLICE A's core target and is already known to this project (the brief names "Parry Toth forward
  pairing" as a do-not-search term). Confirmed to exist and to be open access via
  `journal.computationalcommunication.org/article/view/8682`; the AUP PDF endpoint returns **403 to
  WebFetch** and is recorded as unavailable by this route.

---

# Report

## Totals

- **Distinct works recorded: 34** (19 numbered entries, several of which group 2–4 related works).
- **Read in full or near-full: 3** — Muise et al. 2023; Shaw et al. 2020; Orben & Przybylski 2019
  (main text pp. 1–6).
- **Read via targeted verbatim extraction of the full text (not cover-to-cover): 5** — Ochoa &
  Revilla 2025; Steegen et al. 2016; Langener et al. 2024; Niemeijer et al. 2022; and the PMC
  mirror of Ochoa & Revilla.
- **Abstract-only (verbatim abstract secured): 2** — Bosch 2023; Clayson et al. 2021.
- **Abstract/summary or metadata only, no verbatim abstract secured: 24.**
- **Recorded unavailable by route: 3** — `tmb.apaopen.org` (403 to both WebFetch and curl; resolved
  via the Bristol repository copy instead), `aup-online.com` PDF endpoint (403), `osf.io` preprint
  HTML (JavaScript shell; resolved via the OSF API instead).

## Citation threats, ranked

1. **Ochoa & Revilla (2025), PLOS ONE.** A 10,080-specification multiverse whose varied dimensions
   are *exclusively* measurement-construction decisions on passively logged traces — session gap
   (10/30/60 min), minimum visit duration (2/5/10 s), maximum-duration outlier handling, spell
   separation. No model variation. If our claim is "nobody has run a multiverse over the
   preprocessing step of a device trace," **that claim is false as stated** and must be narrowed.
   What survives: they never confront a *missing* close event, their thresholds are inherited from
   Google Analytics rather than derived, and the domain is browser URL visits, not an OS event
   stream with ~46 typed constants.
2. **Bosch (2023), SocArXiv.** Names the method — "a multiverse of measurements approach" — and
   runs 2,500+ measures varying trace→measure design choices including a minimum-exposure duration.
   Prior art for the *framing*, published two years before Ochoa & Revilla.
3. **Muise, Ram, Robinson & Reeves (2023).** Does not run a multiverse, but does three things we
   intend to do: names aggregation as a measurement-error class ("bundling"), declares its own
   session rule (">5s" gap), and identifies the arrival-without-exit log pathology. The passage on
   p.8 — "their determination is documented and justified plainly" — is a direct assertion that
   aggregation choices are reportable measurement decisions.
4. **Clayson et al. (2021) + the ERP multiverse lineage.** Not our domain, but it is the
   methodological precedent for treating a signal→score reconstruction pipeline as the object of a
   multiverse, and it will be the first thing a reviewer names. Cite it before they do.
5. **Niemeijer, Mestdagh & Kuppens (2022).** A 12,600-combination multiverse that ingests
   smartphone screen state — and *fixes* the screen reconstruction rule at "interactions of less
   than 12 seconds were ignored" while varying everything downstream. Close enough to be a threat,
   and useful because it demonstrates the exact boundary the field stops at.
6. **Langener et al. (2024).** Twenty authors asking for passive-smartphone preprocessing decisions
   to be preregistered. Same normative claim, no taxonomy, no event semantics.

## Anything that contradicts us

Reporting these without softening:

- **Muise et al. (2023) DO declare their rule**, verbatim and unprompted: "We identified *sessions*
  of screen activity (defined as the time between screen on and off) by identifying gaps in the
  timestamp chronology of length >5s." (p.2). They also declare the derived-duration arithmetic
  (p.4) and defend their aggregation choices as "documented and justified plainly" (p.8). A blanket
  "the field almost never says which rule it used" claim has at least one clean counterexample in
  the highest-granularity corpus available.
- **Niemeijer et al. (2022) DO declare their rule**: "The screen state software sensor was
  preprocessed in such a way that interactions of less than 12 seconds were ignored."
- **Ochoa & Revilla (2025) DO declare their rules and their provenance** — including admitting the
  30-minute session gap comes from Google Analytics convention. They are more transparent about
  threshold inheritance than our framing assumes is typical.
- **Shaw et al. (2020) DO document the failure mode** — the un-closed "Screen On" event after
  battery depletion — in the article body and again in a footnote, and change their summary
  statistic because of it. They do not state a rule, but they are not silent about the pathology.
- **Del Giudice & Gangestad (2021) directly threaten the multiverse framing itself.** If
  reconstruction rules are *nonequivalent* (and they are — they encode different definitions of an
  episode), then averaging over them is the exact error their framework exists to prevent. Any
  multiverse we run must classify rules, not pool them.

## Three things I expected and did not find

1. **A multiverse, specification curve, or vibration-of-effects analysis over Android
   `UsageEvents` / `UsageStats` reconstruction rules — or over any OS-level app-usage event stream.**
   The technique exists (entries 1, 2, 4, 5), the data exist, and the two never meet. Every
   multiverse I found on mobile data either fixes the reconstruction rule (Niemeijer) or operates on
   browser URL visits (Ochoa & Revilla, Bosch). **This is the gap, and it is intact.**
2. **A peer-reviewed validation of Apple Screen Time or Android Digital Wellbeing against a
   ground-truth event log.** I searched for one directly and found the reverse: Screen Time is used
   *as* the criterion (Sewall et al. 2020; Shaw et al. 2020 Study 2; SDU DeviceTracker's iOS arm).
   The nearest thing is entry 18c, which reports a ~19 min/day systematic iOS discrepancy but takes
   the vendor aggregate as reference. No study I found asks what rule Apple or Google applies. The
   non-peer-reviewed sources claiming Digital Wellbeing "exceeds 95% accuracy" are marketing/blog
   content with no method — **do not cite them**.
3. **A reliability study of derived screen-time measures in the psychometric sense** — ICCs,
   test-retest, or generalisability coefficients for logged usage metrics, with the reconstruction
   rule held fixed or varied. Searches returned test-retest reliability of *questionnaires*
   (PUMP, QueST, HBSC items) and of smartphone-delivered *tasks*, not of derived log measures. The
   one adjacent finding was step-count-specific (days-of-measurement needed for ICC > 0.80,
   n = 212,048, *Scientific Reports* 2021). Bosch (2023) reports a single reliability figure (0.86)
   across a measurement multiverse, which appears to be the state of the art for this question in
   any trace domain — and it is a web-tracking paper.

A fourth, worth flagging: **nobody frames the missing close event as a measurement decision.** Muise
et al. come closest (p.6) and treat it as a reason to use richer capture. Shaw et al. hit it in
practice and route around it with a median. No one enumerates the options.

## Dead ends — do not repeat these

- `"data processing" decisions should be reported as measurement decisions behavioral logs
  transparency argument` — returns GDPR/consent-logging and privacy-compliance literature
  exclusively. The word "log" collapses the query into data-protection space. Useless.
- `reliability of logged smartphone use metrics test-retest derived behavioural measures` — returns
  questionnaire psychometrics (PUMP scale, problematic-use scales) and smartphone-delivered
  cognitive tasks. "Reliability" + "smartphone" is owned by scale-validation literature.
- `accuracy of Apple Screen Time and Digital Wellbeing vendor reported app usage validation study` —
  returns consumer blog content and app-store listings. No peer-reviewed hit. Reformulating around
  "criterion validity" + a named research app (entry 18c) was what finally worked.
- `how accurate is Android Digital Wellbeing screen time compared with logged app events undercount
  study` — same failure, plus a digital-forensics blog. No academic result.
- `multiverse analysis digital phenotyping passive sensing feature extraction choices` — returns
  depression-prediction ML reviews that discuss heterogeneity of methods but run no multiverse. The
  productive query was `multiverse analysis mobile sensing features depression outcomes robustness
  preprocessing decisions study`, which surfaced Niemeijer et al.
- `"screen time" measurement problems why aggregate duration is a poor measure critique 2023 2024` —
  returns questionnaire-development papers. The critique literature is indexed under
  "conceptualization," not "measurement problems."
- **Access dead ends:** `tmb.apaopen.org` returns 403 to WebFetch *and* to curl with a browser
  user-agent — use the Bristol (`research-information.bris.ac.uk`) or Bath repository copy instead.
  `aup-online.com` PDF endpoint returns 403. `osf.io` preprint pages return an empty JavaScript
  shell — **use `https://api.osf.io/v2/preprints/<id>/` instead, which returns title, abstract, DOI
  and date as plain JSON.** `semanticscholar.org/search` returns an unrendered shell and is useless
  without JavaScript.

<!-- independent-expansion-20260805:D -->

---

# Independent expansion ledger — Slice D (72 new DOI-keyed works)


**Run date:** 2026-08-05  
**Scope:** psychometrics/meta-science; digital phenotyping and computational social science; neuroimaging/EEG/fNIRS; wearables/actigraphy. The search targeted transformations from trace/signal to a reported measure, with multiverses, specification curves, reliability/validity, vendor algorithms, version drift, and reporting norms.  
**Dedup boundary:** all DOI strings below were checked case-insensitively against `docs/paper`, `docs/superpowers/specs`, and the existing 34-work Slice D result. No DOI match was found. Ochoa & Revilla (2025), Bosch (2023), Muise et al. (2023), Clayson et al. (2021), Niemeijer et al. (2022), Langener et al. (2024), Steegen et al. (2016), Shaw et al. (2020), and the existing vendor-aggregate papers are therefore boundary anchors, not recounted as new discoveries.

## Decision vocabulary

- **Rung 4:** raw OS/platform event log; **rung 3:** research app logger; **rung 2:** screen-state stream; **rung 1:** vendor aggregate. `N/A` means the work does not construct an app-usage episode at any rung.
- **Rule quote/location:** an exact episode-reconstruction statement where one exists. `N/A` is substantive: the work does not reconstruct OS app-use episodes. `UNDETERMINED` means a potentially analogous transformation is present but the exact rule was not recoverable from the material read.
- **Threshold/provenance:** records numeric or categorical transformation thresholds and where they came from. Absence is not imputed.
- **Access class:** `FT-OA` = publisher/repository full text surfaced in this run; `AM/P` = accepted manuscript or preprint surfaced; `ABS` = abstract/metadata route only. These labels describe this run, not perpetual legal availability.
- **Re-runnable:** `yes` only when a reusable implementation/data product was positively located. Otherwise the ledger says `not established`; it does not infer availability from a transparency statement.

## Corpus totals

- **72 new, DOI-identified works retained**: 20 psychometrics/meta-science and measurement-quality works; 19 digital phenotyping/computational social science/measurement theory; 17 neuroimaging/EEG/fNIRS; 16 wearables/actigraphy.
- **Access:** 42 FT-OA; 5 AM/P; 25 ABS.
- **Reading depth:** 0 of the 72 new records is claimed as a cover-to-cover read; abstracts/metadata were inspected for all 72, and searchable full-text or manuscript routes were surfaced for 47. The access labels deliberately distinguish retrievability from reading depth. Exact rules and thresholds are `UNDETERMINED` whenever the inspected material did not state them.
- **Episode-rung distribution:** 72 N/A for the Android app-usage ladder. This is an important negative result: the close analogues vary transformations below their own modeling layers, but none operates on typed Android `UsageEvents` to reconstruct foreground-app episodes.
- **Source diversity:** the 72 works span psychology, statistics, HCI, information systems, survey methodology, digital medicine, psychiatry, neurology, neuroimaging, sleep, sports medicine, and sensor-methods venues. No single author contributes more than four retained records.

## Ranked citation threats and claim implications

1. **Ochoa & Revilla (2025), existing boundary anchor.** A 10,080-specification multiverse made entirely from web-trace measurement-construction choices. It falsifies any broad claim that trace-to-measure multiverses do not exist. Surviving novelty: typed OS events, missing closes, app-state semantics, and an explicit episode-rule ontology.
2. **Bosch (2023), existing boundary anchor.** Uses the phrase “multiverse of measurements” and constructs 2,500+ exposure measures. It is prior art for framing preprocessing as a measurement multiverse.
3. **Muise et al. (2023), existing boundary anchor.** Names “bundling,” documents arrival-without-exit pathology, and declares a session rule. It contradicts blanket claims of universal reporting silence.
4. **Niemeijer et al. (2022), existing boundary anchor.** Runs 12,600 downstream specifications using smartphone screen-state data while fixing a less-than-12-second preprocessing rule. It sharply supports the proposed boundary between reconstruction and modeling.
5. **D01 Parsons (2022).** Direct evidence that preprocessing choices unpredictably alter reliability, not just point estimates.
6. **D02 Kahveci et al. (2023).** Simulations plus six datasets show preprocessing can change both reliability and validity.
7. **D07 Lawson et al. (2026).** An empirical audit of measurement-reporting practices makes opaque operationalization a demonstrated reporting problem rather than rhetoric.
8. **D08 Carpentras (2024) plus D09 Haucke et al. (2021).** Researchers disagree about operationalizations; multi-operationalization is already an explicit remedy.
9. **D20 Winne (2020), D23 Amaya et al. (2020), D24 Lazer et al. (2021).** Trace data are measurement instruments with construct, consequential, and total-error obligations. These works require the paper to specify what the derived duration means.
10. **D39 Carp (2012), D45 Pauli et al. (2016), D47 Bowring et al. (2021), D48 Germani et al. (2025).** Neuroimaging already treats pipeline-induced result spaces as first-class scientific objects.
11. **D49 Ozenne et al. (2025).** A direct preprocessing-pipeline sensitivity/multiverse method; reviewers can use it as a mature neighboring precedent.
12. **D57 Burchartz et al. (2023), D58 Lee (2015), D68 Migueles et al. (2019).** Epoch length, non-wear definitions, cut-points, and aggregation metrics materially define accelerometer outcomes.
13. **D59 Collins et al. (2019) and D66 Sturrock et al. (2025).** Hardware/software version is part of measurement provenance; a vendor metric cannot safely be treated as timeless.
14. **D61 Shcherbina et al. (2017), D62 Bent et al. (2020), D65 Fuller et al. (2020).** Commercial devices can be useful while having measure-, activity-, skin-, and device-dependent error. “Validated” is not a scalar property.
15. **D44 Esteban et al. (2018) and D67 Migueles et al. (2021).** Standardized/open workflows are feasible and improve rerunnability, but standardization alone does not identify a construct-valid rule.

## A. Psychometrics, multiverses, and measurement reporting (18)

### D01 — Parsons (2022)

- **Citation:** Sam Parsons (2022), “Exploring reliability heterogeneity with multiverse analyses: Data processing decisions unpredictably influence measurement reliability.” [Primary](https://open.lnu.se/index.php/metapsychology/article/view/2577) · [DOI](https://doi.org/10.15626/mp.2020.2577).
- **Why retained:** Directly moves the multiverse from estimates to psychometric reliability; a close methodological precedent for testing whether episode rules change repeatability.
- **Rung / rule quote:** N/A; cognitive-task preprocessing, not app-usage episode reconstruction. **Threshold/provenance:** multiple preprocessing decisions; exact numeric grid UNDETERMINED from the abstract/material inspected.
- **Availability / rerun / access:** paper and worked materials surfaced; exact end-to-end rerun not established. **FT-OA.**

### D02 — Kahveci, Rinck, van Alebeek & Blechert (2023)

- **Citation:** Sercan Kahveci, Mike Rinck, Hannah van Alebeek & Jens Blechert (2023), “How pre-processing decisions affect the reliability and validity of the approach–avoidance task: Evidence from simulations and multiverse analyses with six datasets.” [Primary](https://link.springer.com/article/10.3758/s13428-023-02109-1) · [DOI](https://doi.org/10.3758/s13428-023-02109-1).
- **Why retained:** Strongest psychometric analogue: preprocessing affects both reliability and validity across simulated and empirical data.
- **Rung / rule quote:** N/A. **Threshold/provenance:** response-time/error preprocessing grid; exact values UNDETERMINED here.
- **Availability / rerun / access:** full article surfaced; data/code rerun not established. **FT-OA.**

### D03 — Garre-Frutos, Vadillo, González & Lupiáñez (2024)

- **Citation:** Francisco Garre-Frutos, Miguel A. Vadillo, Felisa González & Juan Lupiáñez (2024), “On the reliability of value-modulated attentional capture: An online replication and multiverse analysis.” [Primary](https://link.springer.com/article/10.3758/s13428-023-02329-5) · [DOI](https://doi.org/10.3758/s13428-023-02329-5).
- **Why retained:** Reliability varies across a large operational/preprocessing space; useful for a reliability-focused episode-rule supplement.
- **Rung / rule quote:** N/A. **Threshold/provenance:** 288 specifications reported by the study; exact factor levels UNDETERMINED in this ledger.
- **Availability / rerun / access:** full article surfaced; exact rerun not established. **FT-OA.**

### D04 — Webb & Demeyere (2022)

- **Citation:** Sam S. Webb & Nele Demeyere (2022), “Using Multiverse Analysis to Highlight Differences in Convergent Correlation Outcomes Due to Data Analytical and Study Design Choices.” [Primary](https://journals.sagepub.com/doi/10.1177/10731911221127904) · [DOI](https://doi.org/10.1177/10731911221127904).
- **Why retained:** Shows that convergent-validity conclusions themselves are specification-dependent.
- **Rung / rule quote:** N/A. **Threshold/provenance:** analytic/design variants; exact grid UNDETERMINED from abstract.
- **Availability / rerun / access:** data/code not established. **ABS.**

### D05 — Short, Inceler, Frank & Hildebrandt (2025)

- **Citation:** Cassie Ann Short, Yusuf Coşku Inceler, Maximilian Frank & Andrea Hildebrandt (2025), “The Systematic Multiverse Analysis Registration Tool for defining multiverse analyses.” [Primary](https://royalsocietypublishing.org/doi/10.1098/rsos.250800) · [DOI](https://doi.org/10.1098/rsos.250800).
- **Why retained:** Operational tool for declaring decision nodes before analysis; directly usable when preregistering episode-rule families.
- **Rung / rule quote:** N/A. **Threshold/provenance:** user-defined decision tree; no domain threshold.
- **Availability / rerun / access:** reusable SMART materials positively located; **re-runnable: yes** for registration construction. **FT-OA.**

### D06 — Sarma et al. (2023)

- **Citation:** Abhraneel Sarma, Alex Kale, Michael Jongho Moon, Nathan Taback, Fanny Chevalier, Jessica Hullman & Matthew Kay (2023), “multiverse: Multiplexing Alternative Data Analyses in R Notebooks.” [Primary](https://dl.acm.org/doi/10.1145/3544548.3580726) · [DOI](https://doi.org/10.1145/3544548.3580726).
- **Why retained:** Executable-notebook infrastructure for keeping alternatives aligned and inspectable.
- **Rung / rule quote:** N/A. **Threshold/provenance:** user-specified branches; no episode rule.
- **Availability / rerun / access:** author manuscript/software surfaced; **re-runnable: yes** for notebook framework. **AM/P.**

### D07 — Lawson, Bottesini, Khong & Vazire (2026)

- **Citation:** Katherine M. Lawson, Julia G. Bottesini, Linh D. Khong & Simine Vazire (2026), “Measurement-Reporting Practices in Social-and-Personality-Psychology Articles.” [Primary](https://journals.sagepub.com/doi/10.1177/25152459251407612) · [DOI](https://doi.org/10.1177/25152459251407612).
- **Why retained:** Direct empirical audit of whether articles report enough about measure selection, scoring, reliability, and validity.
- **Rung / rule quote:** N/A. **Threshold/provenance:** audit coding rules, not signal thresholds.
- **Availability / rerun / access:** full article surfaced; audit-data rerun not established here. **FT-OA.**

### D08 — Carpentras (2024)

- **Citation:** Dino Carpentras (2024), “We urgently need a culture of multi-operationalization in psychological research.” [Primary](https://www.nature.com/articles/s44271-024-00084-7) · [DOI](https://doi.org/10.1038/s44271-024-00084-7).
- **Why retained:** Makes the normative case for evaluating multiple defensible operationalizations rather than silently selecting one.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; conceptual proposal.
- **Availability / rerun / access:** no dataset expected; article surfaced. **FT-OA.**

### D09 — Haucke, Hoekstra & van Ravenzwaaij (2021)

- **Citation:** Matthias Haucke, Rink Hoekstra & Don van Ravenzwaaij (2021), “When numbers fail: do researchers agree on operationalization of published research?” [Primary](https://royalsocietypublishing.org/doi/10.1098/rsos.191354) · [DOI](https://doi.org/10.1098/rsos.191354).
- **Why retained:** Empirically demonstrates disagreement in converting constructs into numerical variables.
- **Rung / rule quote:** N/A. **Threshold/provenance:** operationalization comparison; no event threshold.
- **Availability / rerun / access:** full article surfaced; exact materials rerun not established. **FT-OA.**

### D10 — Jacobs & Wallach (2021)

- **Citation:** Abigail Z. Jacobs & Hanna Wallach (2021), “Measurement and Fairness.” [Primary](https://dl.acm.org/doi/10.1145/3442188.3445901) · [DOI](https://doi.org/10.1145/3442188.3445901).
- **Why retained:** Treats computational variables as measurement models and links construct validity to downstream fairness.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; conceptual framework.
- **Availability / rerun / access:** author manuscript surfaced; no empirical rerun expected. **AM/P.**

### D11 — Flake, Pek & Hehman (2017)

- **Citation:** Jessica K. Flake, Jolynn Pek & Eric Hehman (2017), “Construct Validation in Social and Personality Research.” [Primary](https://journals.sagepub.com/doi/10.1177/1948550617693063) · [DOI](https://doi.org/10.1177/1948550617693063).
- **Why retained:** Foundational practical warning that unvalidated operationalizations threaten cumulative inference.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; construct-validation review.
- **Availability / rerun / access:** no reusable dataset established. **ABS.**

### D12 — Hussey & Hughes (2020)

- **Citation:** Ian Hussey & Sean Hughes (2020), “Hidden Invalidity Among 15 Commonly Used Measures in Social and Personality Psychology.” [Primary](https://journals.sagepub.com/doi/10.1177/2515245919882903) · [DOI](https://doi.org/10.1177/2515245919882903).
- **Why retained:** Shows that routine use and apparent familiarity do not guarantee structural validity.
- **Rung / rule quote:** N/A. **Threshold/provenance:** 15 measures; scoring details are measure-specific, not app-event rules.
- **Availability / rerun / access:** full article surfaced; exact rerun not established here. **FT-OA.**

### D13 — Simonsohn, Simmons & Nelson (2020)

- **Citation:** Uri Simonsohn, Joseph P. Simmons & Leif D. Nelson (2020), “Specification curve analysis.” [Primary](https://www.nature.com/articles/s41562-020-0912-z) · [DOI](https://doi.org/10.1038/s41562-020-0912-z).
- **Why retained:** Canonical method for enumerating reasonable specifications and displaying their joint result distribution.
- **Rung / rule quote:** N/A. **Threshold/provenance:** analyst-declared reasonable specifications.
- **Availability / rerun / access:** abstract and metadata inspected; materials rerun not established. **ABS.**

### D14 — Silberzahn et al. (2018)

- **Citation:** Raphael Silberzahn et al. (2018), “Many Analysts, One Data Set: Making Transparent How Variations in Analytic Choices Affect Results.” [Primary](https://journals.sagepub.com/doi/10.1177/2515245917747646) · [DOI](https://doi.org/10.1177/2515245917747646).
- **Why retained:** Canonical many-analyst demonstration of decision-induced dispersion; downstream rather than measurement-layer, so useful chiefly as a boundary comparison.
- **Rung / rule quote:** N/A. **Threshold/provenance:** analyst-chosen models; no trace reconstruction.
- **Availability / rerun / access:** full article surfaced; end-to-end rerun not established. **FT-OA.**

### D15 — Breznau et al. (2022)

- **Citation:** Nate Breznau et al. (2022), “Observing many researchers using the same data and hypothesis reveals a hidden universe of uncertainty.” [Primary](https://www.pnas.org/doi/10.1073/pnas.2203150119) · [DOI](https://doi.org/10.1073/pnas.2203150119).
- **Why retained:** Large many-researcher result demonstrating uncertainty that conventional single-analysis reporting hides.
- **Rung / rule quote:** N/A. **Threshold/provenance:** researcher-chosen analyses; no event rule.
- **Availability / rerun / access:** full article and project materials surfaced; exact rerun not independently executed. **FT-OA.**

### D16 — Hoffmann et al. (2021)

- **Citation:** Sabine Hoffmann, Felix Schönbrodt, Ralf Elsas, Rory Wilson, Ulrich Strasser & Anne-Laure Boulesteix (2021), “The multiplicity of analysis strategies jeopardizes replicability: lessons learned across disciplines.” [Primary](https://royalsocietypublishing.org/doi/10.1098/rsos.201925) · [DOI](https://doi.org/10.1098/rsos.201925).
- **Why retained:** Cross-disciplinary synthesis of multiplicity and reporting remedies; supports an ontology plus sensitivity analysis.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; synthesis.
- **Availability / rerun / access:** full article surfaced; no single rerun target. **FT-OA.**

### D17 — Dutilh et al. (2018)

- **Citation:** Gilles Dutilh et al. (2018), “The Quality of Response Time Data Inference: A Blinded, Collaborative Assessment of the Validity of Cognitive Models.” [Primary](https://link.springer.com/article/10.3758/s13423-017-1417-2) · [DOI](https://doi.org/10.3758/s13423-017-1417-2).
- **Why retained:** Blinded collaborative comparison separates data-derived conclusions from preferred modeling traditions.
- **Rung / rule quote:** N/A. **Threshold/provenance:** shared response-time data with independent modeling; no app episode reconstruction.
- **Availability / rerun / access:** full article surfaced; exact code/data rerun not established. **FT-OA.**

### D18 — Bell, Kampman, Dodge & Lawrence (2022)

- **Citation:** Samuel J. Bell, Onno P. Kampman, Jesse Dodge & Neil D. Lawrence (2022), “Modeling the Machine Learning Multiverse.” [Primary preprint](https://arxiv.org/abs/2206.05985) · [DOI](https://doi.org/10.48550/arXiv.2206.05985).
- **Why retained:** Extends multiverse reasoning to ML workflow decisions and their consequences; retained as a downstream boundary, not direct reconstruction prior art.
- **Rung / rule quote:** N/A. **Threshold/provenance:** ML workflow variants; no app-use event rule.
- **Availability / rerun / access:** full preprint surfaced; data/code rerun not established. **AM/P.**

## B. Digital traces, phenotyping, and measurement theory (19)

### D19 — Elmer (2023)

- **Citation:** Timon Elmer (2023), “Computational social science is growing up: why puberty consists of embracing measurement validation, theory development, and open science practices.” [Primary](https://epjdatascience.springeropen.com/articles/10.1140/epjds/s13688-023-00434-1) · [DOI](https://doi.org/10.1140/epjds/s13688-023-00434-1).
- **Why retained:** Directly argues that computational traces need measurement validation, not only predictive performance.
- **Rung / rule quote:** N/A; broad CSS framework. **Threshold/provenance:** N/A.
- **Availability / rerun / access:** full article surfaced; no empirical rerun target. **FT-OA.**

### D20 — Winne (2020)

- **Citation:** Philip H. Winne (2020), “Construct and consequential validity for learning analytics based on trace data.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S0747563220302090) · [DOI](https://doi.org/10.1016/j.chb.2020.106457).
- **Why retained:** Explicitly applies construct and consequential validity to trace-derived analytics.
- **Rung / rule quote:** N/A; educational trace framework. **Threshold/provenance:** N/A.
- **Availability / rerun / access:** abstract/metadata inspected; no dataset expected. **ABS.**

### D21 — Hüllmann (2026)

- **Citation:** Joschka Andreas Hüllmann (2026), “Digital Trace Data as Measurement Instruments for Variance-Theoretic Research in Information Systems.” [Primary](https://link.springer.com/chapter/10.1007/978-3-032-05497-5_10) · [DOI](https://doi.org/10.1007/978-3-032-05497-5_10).
- **Why retained:** Treats digital traces explicitly as instruments whose construction requires a measurement model.
- **Rung / rule quote:** N/A. **Threshold/provenance:** conceptual; no numeric event rule.
- **Availability / rerun / access:** chapter metadata/abstract inspected. **ABS.**

### D22 — Jansson & Japec (2026)

- **Citation:** Ingegerd Jansson & Lilli Japec (2026), “A Total Error Framework with a Special Focus on Digital Data.” [Primary](https://onlinelibrary.wiley.com/doi/10.1111/insr.70020) · [DOI](https://doi.org/10.1111/insr.70020).
- **Why retained:** Updates total-error reasoning for digital data; supplies vocabulary for coverage, representation, processing, and measurement errors.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; framework.
- **Availability / rerun / access:** abstract/metadata route; no empirical rerun expected. **ABS.**

### D23 — Amaya, Biemer & Kinyon (2020)

- **Citation:** Ashley Amaya, Paul P. Biemer & David Kinyon (2020), “Total Error in a Big Data World: Adapting the TSE Framework to Big Data.” [Primary](https://academic.oup.com/jssam/article/8/1/89/5716393) · [DOI](https://doi.org/10.1093/jssam/smz056).
- **Why retained:** Translates survey total-error logic to found/big data, including processing and linkage errors.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; framework.
- **Availability / rerun / access:** abstract/metadata inspected. **ABS.**

### D24 — Lazer et al. (2021)

- **Citation:** David Lazer, Eszter Hargittai, Deen Freelon, Sandra González-Bailón, Kevin Munger, Katherine Ognyanova & Jason Radford (2021), “Meaningful measures of human society in the twenty-first century.” [Primary](https://www.nature.com/articles/s41586-021-03660-7) · [DOI](https://doi.org/10.1038/s41586-021-03660-7).
- **Why retained:** High-level statement that digital trace abundance does not remove the need for valid, interpretable measures.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; perspective.
- **Availability / rerun / access:** abstract/metadata route used; no empirical rerun expected. **ABS.**

### D25 — Tonti, Marzolini & Bulgheroni (2021)

- **Citation:** Simone Tonti, Brunella Marzolini & Maria Bulgheroni (2021), “Smartphone-Based Passive Sensing for Behavioral and Physical Monitoring in Free-Life Conditions: Technical Usability Study.” [Primary](https://mhealth.jmir.org/2021/1/e15417) · [DOI](https://doi.org/10.2196/15417).
- **Why retained:** Empirical attention to sensor availability, continuity, battery, and technical usability before modeling.
- **Rung / rule quote:** N/A for app-use episodes; passive phone-sensor study. **Threshold/provenance:** sensor-specific collection settings; exact grid UNDETERMINED here.
- **Availability / rerun / access:** full article surfaced; code/data rerun not established. **FT-OA.**

### D26 — Kiang et al. (2021)

- **Citation:** Mathew V. Kiang et al. (2021), “Sociodemographic characteristics of missing data in digital phenotyping.” [Primary](https://www.nature.com/articles/s41598-021-94516-7) · [DOI](https://doi.org/10.1038/s41598-021-94516-7).
- **Why retained:** Missing passive-sensing data are socially patterned; repair/exclusion rules can therefore change representation, not merely precision.
- **Rung / rule quote:** N/A for app episodes. **Threshold/provenance:** missingness definitions are study-specific; exact rules UNDETERMINED here.
- **Availability / rerun / access:** full article surfaced; exact rerun not established. **FT-OA.**

### D27 — Onnela (2020)

- **Citation:** Jukka-Pekka Onnela (2020), “Opportunities and challenges in the collection and analysis of digital phenotyping data.” [Primary](https://www.nature.com/articles/s41386-020-0771-3) · [DOI](https://doi.org/10.1038/s41386-020-0771-3).
- **Why retained:** Separates collection/coverage challenges from analysis and interpretation in digital phenotyping.
- **Rung / rule quote:** N/A; perspective. **Threshold/provenance:** N/A.
- **Availability / rerun / access:** abstract/metadata inspected; no single dataset. **ABS.**

### D28 — Mohr, Zhang & Schueller (2017)

- **Citation:** David C. Mohr, Mi Zhang & Stephen M. Schueller (2017), “Personal Sensing: Understanding Mental Health Using Ubiquitous Sensors and Machine Learning.” [Primary](https://www.annualreviews.org/doi/10.1146/annurev-clinpsy-032816-044949) · [DOI](https://doi.org/10.1146/annurev-clinpsy-032816-044949).
- **Why retained:** Defines the sensor-to-behavior-to-clinical-inference stack, making clear that derived behaviors precede ML.
- **Rung / rule quote:** N/A for app-use episodes. **Threshold/provenance:** review-level, varies across studies.
- **Availability / rerun / access:** author manuscript surfaced; no single rerun target. **AM/P.**

### D29 — Lipsmeier et al. (2018)

- **Citation:** Florian Lipsmeier et al. (2018), “Evaluation of smartphone-based testing to generate exploratory outcome measures in a phase 1 Parkinson’s disease clinical trial.” [Primary](https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.27376) · [DOI](https://doi.org/10.1002/mds.27376).
- **Why retained:** Reports reliability of smartphone-derived motor measures (abstract reports average ICC 0.84), demonstrating psychometric evaluation of digital outcomes.
- **Rung / rule quote:** N/A; active motor tasks, not usage episodes. **Threshold/provenance:** feature algorithms proprietary/study-defined; exact transforms UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata route; code/data not established. **ABS.**

### D30 — Montalban et al. (2021)

- **Citation:** Xavier Montalban et al. (2021), “A smartphone sensor-based digital outcome assessment of multiple sclerosis.” [Primary](https://journals.sagepub.com/doi/10.1177/13524585211028561) · [DOI](https://doi.org/10.1177/13524585211028561).
- **Why retained:** Evaluates reliability and clinical validity of derived smartphone measures; abstract-reported ICCs span approximately 0.61–0.85.
- **Rung / rule quote:** N/A; sensor-derived clinical outcomes. **Threshold/provenance:** algorithms/task rules not extracted; UNDETERMINED.
- **Availability / rerun / access:** abstract/metadata route; code/data not established. **ABS.**

### D31 — Burq et al. (2022)

- **Citation:** Maximilien Burq et al. (2022), “Virtual exam for Parkinson’s disease enables frequent and reliable remote measurements of motor function.” [Primary](https://www.nature.com/articles/s41746-022-00607-8) · [DOI](https://doi.org/10.1038/s41746-022-00607-8).
- **Why retained:** Positive counterexample: a derived digital measure can show reliability when task and algorithm are explicitly validated.
- **Rung / rule quote:** N/A; virtual motor examination. **Threshold/provenance:** task/feature transforms are study-defined; no Android event rule.
- **Availability / rerun / access:** full article surfaced; proprietary elements/data availability limit exact rerun; rerun not established. **FT-OA.**

### D32 — Mathews et al. (2019)

- **Citation:** Simon C. Mathews, Michael J. McShea, Casey L. Hanley, Alan Ravitz, Alain B. Labrique & Adam B. Cohen (2019), “Digital health: a path to validation.” [Primary](https://www.nature.com/articles/s41746-019-0111-3) · [DOI](https://doi.org/10.1038/s41746-019-0111-3).
- **Why retained:** Framework for technical, clinical, and system validation of digital measures.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; validation framework.
- **Availability / rerun / access:** full article surfaced; no empirical rerun target. **FT-OA.**

### D33 — Linardon et al. (2025)

- **Citation:** Jake Linardon et al. (2025), “Smartphone digital phenotyping in mental health disorders: A review of raw sensors utilized, machine learning processing pipelines, and derived behavioral features.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S0165178125001313) · [DOI](https://doi.org/10.1016/j.psychres.2025.116483).
- **Why retained:** Maps raw sensors, processing pipelines, and derived behavioral features; helps position reconstruction as distinct from ML.
- **Rung / rule quote:** N/A for app episodes; review. **Threshold/provenance:** heterogeneous across included studies.
- **Availability / rerun / access:** abstract/metadata inspected; review extraction rerun not established. **ABS.**

### D34 — Calvert et al. (2026)

- **Citation:** Elombe Calvert, Erlend Lane, Matthew Flathers & John Torous (2026), “LINC: a framework for maintaining high-quality passive data in digital phenotyping studies.” [Primary](https://www.nature.com/articles/s41598-026-41435-0) · [DOI](https://doi.org/10.1038/s41598-026-41435-0).
- **Why retained:** Recent operational framework for monitoring passive-data completeness/quality before feature modeling.
- **Rung / rule quote:** N/A for app-use episodes. **Threshold/provenance:** framework-specific quality checks; exact thresholds UNDETERMINED here.
- **Availability / rerun / access:** full article surfaced; implementation rerun not independently verified. **FT-OA.**

### D35 — Huckvale, Venkatesh & Christensen (2019)

- **Citation:** Kit Huckvale, Svetha Venkatesh & Helen Christensen (2019), “Toward clinical digital phenotyping: a timely opportunity to consider purpose, quality, and safety.” [Primary](https://www.nature.com/articles/s41746-019-0166-1) · [DOI](https://doi.org/10.1038/s41746-019-0166-1).
- **Why retained:** Warns that quality and intended use must be specified before clinical interpretation.
- **Rung / rule quote:** N/A. **Threshold/provenance:** N/A; perspective.
- **Availability / rerun / access:** full article surfaced; no empirical rerun target. **FT-OA.**

### D36 — Cornet & Holden (2018)

- **Citation:** Victor P. Cornet & Richard J. Holden (2018), “Systematic review of smartphone-based passive sensing for health and wellbeing.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S1532046417302782) · [DOI](https://doi.org/10.1016/j.jbi.2017.12.008).
- **Why retained:** Broad review of passive-sensing study designs and derived constructs; establishes cross-study heterogeneity.
- **Rung / rule quote:** N/A for app-use episodes. **Threshold/provenance:** varies across reviewed studies.
- **Availability / rerun / access:** abstract/metadata route; extraction reproducibility not established. **ABS.**

### D37 — Zhao et al. (2026)

- **Citation:** Xiaochang Zhao, Artemis Stefani, Jannis Kraiss, Zeynep Koyuncu, Peter M. ten Klooster & Matthijs L. Noordzij (2026), “Evidence on the validity, reliability and usability of active and passive sensing of cognition for use in ambulatory studies: A systematic scoping review.” [Primary preprint](https://osf.io/preprints/psyarxiv/4r3jm_v2) · [DOI](https://doi.org/10.31234/osf.io/4r3jm_v2).
- **Why retained:** Direct synthesis of psychometric evidence for ambulatory digital cognition, including negative/insufficient evidence.
- **Rung / rule quote:** N/A. **Threshold/provenance:** review-level heterogeneity.
- **Availability / rerun / access:** full preprint surfaced; review materials rerun not established. **AM/P.**

## C. Neuroimaging, EEG, fNIRS, and pupillometry (17)

### D38 — Carp (2012)

- **Citation:** Joshua Carp (2012), “On the Plurality of (Methodological) Worlds: Estimating the Analytic Flexibility of fMRI Experiments.” [Primary](https://www.frontiersin.org/articles/10.3389/fnins.2012.00149/full) · [DOI](https://doi.org/10.3389/fnins.2012.00149).
- **Why retained:** Early direct enumeration of preprocessing/analysis flexibility in a signal-to-map pipeline.
- **Rung / rule quote:** N/A. **Threshold/provenance:** fMRI pipeline variants; exact decision matrix in article, no app-event analogue.
- **Availability / rerun / access:** full article surfaced; historical software rerun not established. **FT-OA.**

### D39 — Churchill et al. (2015)

- **Citation:** Nathan W. Churchill, Robyn Spring, Babak Afshin-Pour, Fan Dong & Stephen C. Strother (2015), “An Automated, Adaptive Framework for Optimizing Preprocessing Pipelines in Task-Based Functional MRI.” [Primary](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0131520) · [DOI](https://doi.org/10.1371/journal.pone.0131520).
- **Why retained:** Treats preprocessing pipeline selection as an empirical optimization problem.
- **Rung / rule quote:** N/A. **Threshold/provenance:** adaptive fMRI preprocessing; no app-event rule.
- **Availability / rerun / access:** full article surfaced; exact environment rerun not established. **FT-OA.**

### D40 — Ciric et al. (2017)

- **Citation:** Rastko Ciric et al. (2017), “Benchmarking of participant-level confound regression strategies for the control of motion artifact in studies of functional connectivity.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S1053811917302288) · [DOI](https://doi.org/10.1016/j.neuroimage.2017.03.020).
- **Why retained:** Benchmarks alternative preprocessing strategies against multiple quality criteria; shows no single criterion is sufficient.
- **Rung / rule quote:** N/A. **Threshold/provenance:** motion-regression strategies; exact censoring thresholds UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata inspected; code/data rerun not established. **ABS.**

### D41 — Parkes et al. (2018)

- **Citation:** Linden Parkes, Ben Fulcher, Murat Yücel & Alex Fornito (2018), “An evaluation of the efficacy, reliability, and sensitivity of motion correction strategies for resting-state functional MRI.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S1053811917310972) · [DOI](https://doi.org/10.1016/j.neuroimage.2017.12.073).
- **Why retained:** Explicitly evaluates efficacy, reliability, and sensitivity across correction strategies.
- **Rung / rule quote:** N/A. **Threshold/provenance:** motion-correction/censoring settings; exact values UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata route; rerun not established. **ABS.**

### D42 — Esteban et al. (2018)

- **Citation:** Oscar Esteban et al. (2018), “fMRIPrep: a robust preprocessing pipeline for functional MRI.” [Primary](https://www.nature.com/articles/s41592-018-0235-4) · [DOI](https://doi.org/10.1038/s41592-018-0235-4).
- **Why retained:** Mature example of standardizing, documenting, and versioning preprocessing before modeling.
- **Rung / rule quote:** N/A. **Threshold/provenance:** pipeline defaults/version are the provenance object.
- **Availability / rerun / access:** source code and containers positively located; **re-runnable: yes**, subject to data/version. **FT-OA.**

### D43 — Lindquist et al. (2019)

- **Citation:** Martin A. Lindquist, Stephan Geuter, Tor D. Wager & Brian S. Caffo (2019), “Modular preprocessing pipelines can reintroduce artifacts into fMRI data.” [Primary](https://onlinelibrary.wiley.com/doi/10.1002/hbm.24528) · [DOI](https://doi.org/10.1002/hbm.24528).
- **Why retained:** Negative finding: composing individually familiar steps can create new artifacts.
- **Rung / rule quote:** N/A. **Threshold/provenance:** module ordering/interactions; exact grid UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata route; rerun not established. **ABS.**

### D44 — Bowring, Maumet & Nichols (2019)

- **Citation:** Alexander Bowring, Camille Maumet & Thomas E. Nichols (2019), “Exploring the impact of analysis software on task fMRI results.” [Primary](https://onlinelibrary.wiley.com/doi/10.1002/hbm.24603) · [DOI](https://doi.org/10.1002/hbm.24603).
- **Why retained:** Software implementation alone can alter derived results even under nominally comparable workflows.
- **Rung / rule quote:** N/A. **Threshold/provenance:** software/package workflow; version provenance is central.
- **Availability / rerun / access:** abstract/metadata route; rerun not established. **ABS.**

### D45 — Pauli et al. (2016)

- **Citation:** Ruth Pauli, Alexander Bowring, Richard Reynolds, Gang Chen, Thomas E. Nichols & Camille Maumet (2016), “Exploring fMRI Results Space: 31 Variants of an fMRI Analysis in AFNI, FSL, and SPM.” [Primary](https://www.frontiersin.org/articles/10.3389/fninf.2016.00024/full) · [DOI](https://doi.org/10.3389/fninf.2016.00024).
- **Why retained:** Concrete 31-variant results-space analysis across three major packages.
- **Rung / rule quote:** N/A. **Threshold/provenance:** 31 software/workflow variants; no event reconstruction.
- **Availability / rerun / access:** full article and workflow descriptions surfaced; exact rerun not executed. **FT-OA.**

### D46 — Bowring, Nichols & Maumet (2021)

- **Citation:** Alexander Bowring, Thomas E. Nichols & Camille Maumet (2021), “Isolating the sources of pipeline-variability in group-level task-fMRI results.” [Primary](https://onlinelibrary.wiley.com/doi/10.1002/hbm.25713) · [DOI](https://doi.org/10.1002/hbm.25713).
- **Why retained:** Decomposes which pipeline stages generate between-pipeline differences, close to a generalizability decomposition over reconstruction rules.
- **Rung / rule quote:** N/A. **Threshold/provenance:** pipeline-stage factors; exact levels UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata route; rerun not established. **ABS.**

### D47 — Germani et al. (2025)

- **Citation:** Elodie Germani, Elisa Fromont, Pierre Maurel & Camille Maumet (2025), “HCP Multi-Pipeline: a derived dataset to investigate analytical variability in fMRI.” [Primary](https://www.nature.com/articles/s41597-025-05247-7) · [DOI](https://doi.org/10.1038/s41597-025-05247-7).
- **Why retained:** Publishes a multi-pipeline derived dataset specifically for analytical-variability research.
- **Rung / rule quote:** N/A. **Threshold/provenance:** pipeline variants documented in dataset metadata.
- **Availability / rerun / access:** derived dataset positively located; **re-runnable: yes** for documented comparisons. **FT-OA.**

### D48 — Ozenne et al. (2025)

- **Citation:** Brice Ozenne, Martin Nørgaard, Cyril Pernet & Melanie Ganz (2025), “A sensitivity analysis of preprocessing pipelines: Toward a solution for multiverse analyses.” [Primary](https://direct.mit.edu/imag/article/doi/10.1162/imag_a_00523/127274/) · [DOI](https://doi.org/10.1162/imag_a_00523).
- **Why retained:** Explicit preprocessing multiverse/sensitivity solution in neuroimaging; one of the closest cross-domain precedents.
- **Rung / rule quote:** N/A. **Threshold/provenance:** preprocessing-pipeline grid; exact levels reside in article/supplement.
- **Availability / rerun / access:** full article surfaced; precise code rerun not established. **FT-OA.**

### D49 — Kessler, Enge & Skeide (2025)

- **Citation:** Roman Kessler, Alexander Enge & Michael A. Skeide (2025), “How EEG preprocessing shapes decoding performance.” [Primary](https://www.nature.com/articles/s42003-025-08464-3) · [DOI](https://doi.org/10.1038/s42003-025-08464-3).
- **Why retained:** Directly links preprocessing alternatives to predictive/decoding performance.
- **Rung / rule quote:** N/A. **Threshold/provenance:** EEG preprocessing variants; exact numeric settings UNDETERMINED here.
- **Availability / rerun / access:** full article surfaced; exact rerun not established. **FT-OA.**

### D50 — Schilling et al. (2021)

- **Citation:** Kurt G. Schilling et al. (2021), “Tractography dissection variability: What happens when 42 groups dissect 14 white matter bundles on the same dataset?” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S1053811921007758) · [DOI](https://doi.org/10.1016/j.neuroimage.2021.118502).
- **Why retained:** Many-team measurement-construction comparison over identical raw data; derived anatomy varies by dissection practice.
- **Rung / rule quote:** N/A. **Threshold/provenance:** 42 group-specific workflows; no app events.
- **Availability / rerun / access:** abstract/metadata route; consolidated workflow rerun not established. **ABS.**

### D51 — Yücel et al. (2025)

- **Citation:** Meryem A. Yücel et al. (2025), “fNIRS reproducibility varies with data quality, analysis pipelines, and researcher experience.” [Primary](https://www.nature.com/articles/s42003-025-08412-1) · [DOI](https://doi.org/10.1038/s42003-025-08412-1).
- **Why retained:** Large collaborative evidence that quality, pipeline, and analyst experience jointly affect reproducibility.
- **Rung / rule quote:** N/A. **Threshold/provenance:** analyst/pipeline conditions; exact factor levels in full article.
- **Availability / rerun / access:** full article surfaced; shared-data rerun not independently executed. **FT-OA.**

### D52 — Gemignani & Gervain (2021)

- **Citation:** Jessica Gemignani & Judit Gervain (2021), “Comparing different pre-processing routines for infant fNIRS data.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S1878929321000347) · [DOI](https://doi.org/10.1016/j.dcn.2021.100943).
- **Why retained:** Direct head-to-head comparison of preprocessing routines for a noisy behavioral signal.
- **Rung / rule quote:** N/A. **Threshold/provenance:** fNIRS routine variants; exact settings in article.
- **Availability / rerun / access:** full article surfaced; code/data rerun not established. **FT-OA.**

### D53 — Calignano, Girardi & Altoè (2023)

- **Citation:** Giulia Calignano, Paolo Girardi & Gianmarco Altoè (2023), “First steps into the pupillometry multiverse of developmental science.” [Primary](https://link.springer.com/article/10.3758/s13428-023-02172-8) · [DOI](https://doi.org/10.3758/s13428-023-02172-8).
- **Why retained:** Signal-to-measure multiverse in a field where cleaning, baseline, aggregation, and exclusion define the outcome.
- **Rung / rule quote:** N/A. **Threshold/provenance:** pupillometry preprocessing choices; exact grid in article.
- **Availability / rerun / access:** full article surfaced; exact rerun not established. **FT-OA.**

### D54 — Delorme (2023)

- **Citation:** Arnaud Delorme (2023), “EEG is better left alone.” [Primary](https://www.nature.com/articles/s41598-023-27528-0) · [DOI](https://doi.org/10.1038/s41598-023-27528-0).
- **Why retained:** Deliberately contrary evidence: more preprocessing can reduce rather than improve information/replicability.
- **Rung / rule quote:** N/A. **Threshold/provenance:** comparative EEG preprocessing; exact settings in article.
- **Availability / rerun / access:** full article surfaced; rerun not independently executed. **FT-OA.**

## D. Wearables, actigraphy, vendor algorithms, and version drift (16)

### D55 — Arvidsson et al. (2023)

- **Citation:** Daniel Arvidsson et al. (2023), “Fundament for a methodological standard to process hip accelerometer data to a measure of physical activity intensity in middle-aged individuals.” [Primary](https://onlinelibrary.wiley.com/doi/10.1111/sms.14541) · [DOI](https://doi.org/10.1111/sms.14541).
- **Why retained:** Explicit attempt to standardize raw-signal-to-intensity construction.
- **Rung / rule quote:** N/A for app episodes. **Threshold/provenance:** hip-accelerometer processing/cut-points; exact numeric rules UNDETERMINED from abstract.
- **Availability / rerun / access:** code/data not established. **ABS.**

### D56 — Burchartz et al. (2023)

- **Citation:** Alexander Burchartz, Simon Kolb, Leon Klos, Steffen C. E. Schmidt, Birte von Haaren-Mack, Claudia Niessner & Alexander Woll (2023), “How specific combinations of epoch length, non-wear time and cut-points influence physical activity.” [Primary](https://link.springer.com/article/10.1007/s12662-023-00892-9) · [DOI](https://doi.org/10.1007/s12662-023-00892-9).
- **Why retained:** Near-isomorphic analogue: multiple below-modeling choices jointly determine an aggregate duration/intensity measure.
- **Rung / rule quote:** N/A. **Threshold/provenance:** epoch, non-wear, and cut-point grid; exact levels UNDETERMINED here.
- **Availability / rerun / access:** abstract/metadata inspected; rerun not established. **ABS.**

### D57 — Lee (2015)

- **Citation:** Paul H. Lee (2015), “A sensitivity analysis on the variability in accelerometer data processing for monitoring physical activity.” [Primary](https://linkinghub.elsevier.com/retrieve/pii/S0966636214007917) · [DOI](https://doi.org/10.1016/j.gaitpost.2014.12.008).
- **Why retained:** Direct sensitivity analysis over accelerometer processing decisions.
- **Rung / rule quote:** N/A. **Threshold/provenance:** accelerometer processing variants; exact grid UNDETERMINED from abstract.
- **Availability / rerun / access:** data/code not established. **ABS.**

### D58 — Collins et al. (2019)

- **Citation:** Tim Collins et al. (2019), “Version Reporting and Assessment Approaches for New and Updated Activity and Heart Rate Monitors.” [Primary](https://www.mdpi.com/1424-8220/19/7/1705) · [DOI](https://doi.org/10.3390/s19071705).
- **Why retained:** Directly argues that hardware/firmware/software version belongs in measurement reporting.
- **Rung / rule quote:** N/A for app episodes. **Threshold/provenance:** version is provenance; algorithms are vendor-defined.
- **Availability / rerun / access:** full article surfaced; vendor algorithm rerun unavailable/not established. **FT-OA.**

### D59 — Lee, Neishabouri, Tse & Guo (2024)

- **Citation:** Paul H. Lee, Ali Neishabouri, Andy C. Y. Tse & Christine C. Guo (2024), “Comparative Analysis and Conversion Between Actiwatch and ActiGraph Open-Source Counts.” [Primary](https://journals.humankinetics.com/view/journals/jmpb/7/1/article-jmpb.2022-0054.xml) · [DOI](https://doi.org/10.1123/jmpb.2022-0054).
- **Why retained:** Device-specific count construction is not automatically comparable; conversion itself is a measurement model.
- **Rung / rule quote:** N/A. **Threshold/provenance:** device count algorithms/conversion; exact rule UNDETERMINED from abstract.
- **Availability / rerun / access:** abstract/metadata route; exact rerun not established. **ABS.**

### D60 — Shcherbina et al. (2017)

- **Citation:** Anna Shcherbina et al. (2017), “Accuracy in Wrist-Worn, Sensor-Based Measurements of Heart Rate and Energy Expenditure in a Diverse Cohort.” [Primary](https://www.mdpi.com/2075-4426/7/2/3) · [DOI](https://doi.org/10.3390/jpm7020003).
- **Why retained:** Positive/negative validation split: heart rate can be reasonably accurate while energy expenditure is substantially less accurate.
- **Rung / rule quote:** N/A. **Threshold/provenance:** vendor algorithms undisclosed; criterion devices documented in methods.
- **Availability / rerun / access:** full article surfaced; commercial transformation not re-runnable. **FT-OA.**

### D61 — Bent, Goldstein, Kibbe & Dunn (2020)

- **Citation:** Brinnae Bent, Benjamin A. Goldstein, Warren A. Kibbe & Jessilyn P. Dunn (2020), “Investigating sources of inaccuracy in wearable optical heart rate sensors.” [Primary](https://www.nature.com/articles/s41746-020-0226-6) · [DOI](https://doi.org/10.1038/s41746-020-0226-6).
- **Why retained:** Error depends on device, activity, skin tone, and other conditions; validation must be conditional.
- **Rung / rule quote:** N/A. **Threshold/provenance:** vendor HR algorithms undisclosed; stratification factors reported.
- **Availability / rerun / access:** full article surfaced; vendor transforms not re-runnable. **FT-OA.**

### D62 — Chinoy et al. (2020)

- **Citation:** Evan D. Chinoy et al. (2020), “Performance of seven consumer sleep-tracking devices compared with polysomnography.” [Primary](https://academic.oup.com/sleep/article/44/5/zsaa291/6055610) · [DOI](https://doi.org/10.1093/sleep/zsaa291).
- **Why retained:** Head-to-head criterion validation shows device/measure-specific performance, not a universal “sleep accuracy.”
- **Rung / rule quote:** N/A. **Threshold/provenance:** vendor sleep-stage algorithms are undisclosed; PSG is criterion.
- **Availability / rerun / access:** abstract/metadata route; vendor processing not re-runnable. **ABS.**

### D63 — Lee et al. (2023)

- **Citation:** Taeyoung Lee et al. (2023), “Accuracy of 11 Wearable, Nearable, and Airable Consumer Sleep Trackers: Prospective Multicenter Validation Study.” [Primary](https://www.jmir.org/2023/1/e50983) · [DOI](https://doi.org/10.2196/50983).
- **Why retained:** Broad multi-device validation; strong evidence against treating one vendor aggregate as a transparent measurement standard.
- **Rung / rule quote:** N/A. **Threshold/provenance:** proprietary algorithms; PSG criterion and device models reported.
- **Availability / rerun / access:** full article surfaced; vendor algorithms not re-runnable. **FT-OA.**

### D64 — Fuller et al. (2020)

- **Citation:** Daniel Fuller et al. (2020), “Reliability and Validity of Commercially Available Wearable Devices for Measuring Steps, Energy Expenditure, and Heart Rate: Systematic Review.” [Primary](https://mhealth.jmir.org/2020/9/e18694) · [DOI](https://doi.org/10.2196/18694).
- **Why retained:** Systematic evidence that reliability/validity vary by outcome and device; vendor aggregates require measure-specific qualification.
- **Rung / rule quote:** N/A. **Threshold/provenance:** heterogeneous and often proprietary across studies.
- **Availability / rerun / access:** full review surfaced; extraction rerun not established. **FT-OA.**

### D65 — Sturrock et al. (2025)

- **Citation:** Shelby L. Sturrock, Rahim Moineddin, Dionne Gesink, Sarah Woodruff & Daniel Fuller (2025), “The effect of software and hardware version on Apple Watch activity measurement: A secondary analysis of the COVFIT retrospective cohort study.” [Primary](https://journals.plos.org/digitalhealth/article?id=10.1371/journal.pdig.0000727) · [DOI](https://doi.org/10.1371/journal.pdig.0000727).
- **Why retained:** Direct empirical version-drift evidence for a vendor activity measure.
- **Rung / rule quote:** N/A for app-use episodes. **Threshold/provenance:** hardware/software version is the exposure; Apple’s aggregation algorithm remains undisclosed.
- **Availability / rerun / access:** full article surfaced; vendor algorithm not re-runnable; secondary data rerun not established. **FT-OA.**

### D66 — Migueles et al. (2021)

- **Citation:** Jairo H. Migueles et al. (2021), “GRANADA consensus on analytical approaches to assess associations with accelerometer-determined physical behaviours (physical activity, sedentary behaviour and sleep) in epidemiological studies.” [Primary](https://bjsm.bmj.com/content/56/7/376) · [DOI](https://doi.org/10.1136/bjsports-2020-103604).
- **Why retained:** Reporting/analysis consensus for accelerometer-derived behaviors; model for an episode-rule reporting checklist.
- **Rung / rule quote:** N/A. **Threshold/provenance:** consensus covers accelerometer processing/analysis decisions; no single universal threshold.
- **Availability / rerun / access:** full article surfaced; no single rerun target. **FT-OA.**

### D67 — van Hees et al. (2015)

- **Citation:** Vincent T. van Hees et al. (2015), “A Novel, Open Access Method to Assess Sleep Duration Using a Wrist-Worn Accelerometer.” [Primary](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0142533) · [DOI](https://doi.org/10.1371/journal.pone.0142533).
- **Why retained:** Positive analogue: publishes an open raw-signal-to-sleep-duration algorithm rather than only a vendor aggregate.
- **Rung / rule quote:** N/A for app-use episodes. **Threshold/provenance:** algorithmic sleep-window rules documented in methods/source.
- **Availability / rerun / access:** implementation positively located; **re-runnable: yes** subject to raw accelerometry. **FT-OA.**

### D68 — Migueles et al. (2019a)

- **Citation:** Jairo H. Migueles et al. (2019), “Comparability of published cut-points for the assessment of physical activity: Implications for data harmonization.” [Primary](https://onlinelibrary.wiley.com/doi/10.1111/sms.13356) · [DOI](https://doi.org/10.1111/sms.13356).
- **Why retained:** Tests whether published cut-points are interchangeable; directly relevant to threshold provenance and harmonization.
- **Rung / rule quote:** N/A. **Threshold/provenance:** published cut-points are the compared rules; origins reside in source calibration studies.
- **Availability / rerun / access:** abstract/metadata route; exact rerun not established. **ABS.**

### D69 — Migueles et al. (2019b)

- **Citation:** Jairo H. Migueles et al. (2019), “Comparability of accelerometer signal aggregation metrics across placements and dominant wrist cut points for the assessment of physical activity in adults.” [Primary](https://www.nature.com/articles/s41598-019-54267-y) · [DOI](https://doi.org/10.1038/s41598-019-54267-y).
- **Why retained:** Shows aggregation metric, placement, and cut-point jointly define physical-activity measures.
- **Rung / rule quote:** N/A. **Threshold/provenance:** published aggregation metrics and dominant-wrist cut-points; exact numeric grid in article.
- **Availability / rerun / access:** full article surfaced; exact rerun not established. **FT-OA.**

### D70 — White et al. (2024)

- **Citation:** James W. White et al. (2024), “Comparison of raw accelerometry data from ActiGraph, Apple Watch, Garmin, and Fitbit using a mechanical shaker table.” [Primary](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0286898) · [DOI](https://doi.org/10.1371/journal.pone.0286898).
- **Why retained:** Compares raw device signals under controlled motion, separating sensor comparability from proprietary derived aggregates.
- **Rung / rule quote:** N/A for app episodes. **Threshold/provenance:** mechanical input is controlled; raw export and device configuration are provenance-critical.
- **Availability / rerun / access:** full article surfaced; experiment is conceptually rerunnable, but exact dataset/code rerun not established. **FT-OA.**

## Contradictions, nulls, and limiting evidence

1. **The broad “nobody varies preprocessing” claim is false.** Web-tracking, psychology, fMRI, EEG/fNIRS, pupillometry, and accelerometry all have measurement/preprocessing multiverses or sensitivity analyses.
2. **The broad “researchers never report rules” claim is false.** Muise, Niemeijer, Ochoa & Revilla, fMRIPrep, GRANADA, and open actigraphy algorithms explicitly document at least important parts of their rules and provenance.
3. **More preprocessing is not monotonically better.** Delorme (D54) argues/presents evidence that EEG may be better minimally processed; Lindquist et al. (D43) show modular pipelines can reintroduce artifacts.
4. **Some variation is small for a particular outcome.** Accelerometer studies sometimes find closely similar group averages under subsets of cut-points/epochs, while individual classification or harmonization still changes. The paper must report both absolute and rank/individual sensitivity, not only dramatic maxima.
5. **Commercial devices can perform well for some measures.** Burq (D31), Shcherbina (D60), and sleep-tracker validations show that a derived measure may be reliable/valid under specified conditions. The defensible claim is opacity and conditional validity, not universal invalidity.
6. **Standardization is a partial remedy.** fMRIPrep and open actigraphy methods improve reproducibility, but a stable pipeline can reproducibly operationalize the wrong construct. Validity and reproducibility remain separate.
7. **A multiverse cannot legitimate mutually incompatible constructs.** Decision branches need semantic labels and admissibility constraints; simply averaging all rules would erase the ontology the paper is trying to expose.
8. **Downstream multiverse precedents are not the same contribution.** Many-analyst and ML works vary models after variables exist. They support motivation and presentation, but do not occupy the typed-event-to-episode gap.

## Expected absences after neutral, negation, and contradiction searches

1. **No retained study runs a multiverse/specification curve over Android `UsageEvents`/`UsageStats` foreground-episode reconstruction.** Searches combining Android, UsageEvents, reconstruction, sessionization, multiverse, sensitivity, robustness, preprocessing, and specification curve returned SDK documentation, forensic utilities, app-use correlational studies, or downstream ML.
2. **No peer-reviewed Apple Screen Time or Android Digital Wellbeing validation against a raw OS event log with a disclosed matching rule was located.** Studies usually use the vendor aggregate as criterion or compare it with self-report/research loggers.
3. **No generalizability-theory decomposition of logged screen-time reliability across person × day × reconstruction rule × OS/version was located.** Reliability searches were dominated by self-report scales and smartphone-delivered tasks.
4. **No reporting standard requires the exact primitives needed here:** event-type allowlist, open/close pairing, duplicate handling, missing-close repair, overlap resolution, short-gap bridging, truncation, and threshold provenance.
5. **No evidence that vendor aggregate semantics are invariant across OS/app/firmware versions was located.** The wearable literature instead supplies positive version-drift precedents.
6. **No study was found that frames an unmatched app-close/open event as a measurement decision with multiple defensible repair rules.** Existing work describes the pathology or routes around it.

## Query and dead-end log

### Productive neutral query families

- `preprocessing decisions reliability multiverse measurement`; `measurement multiverse validity operationalization`; `specification curve preprocessing psychometrics`.
- `digital trace construct validity measurement instrument`; `total error digital data`; `passive sensing data quality missingness reliability`; `digital phenotyping derived feature validation`.
- `fMRI preprocessing pipeline variability sensitivity`; `EEG preprocessing multiverse reliability`; `fNIRS preprocessing reproducibility`; `pupillometry multiverse`.
- `accelerometer epoch nonwear cutpoint combinations`; `actigraphy processing sensitivity reliability`; `wearable firmware software version measurement`; `vendor algorithm drift validation`.
- `measurement reporting practices operationalization`; `multi-operationalization psychology`; `negative effect preprocessing reliability`; `preprocessing little effect null sensitivity`.

### Contradiction/negation probes

- `preprocessing choices do not affect results`, `minimal preprocessing better EEG`, `wearable accurate validation`, `vendor measure reliable`, `standard pipeline reproducible`, and `researchers report preprocessing rules` were used to avoid one-sided threat inflation.
- These probes produced D31, D42, D54, D60–D64, D67, and the explicit-reporting counterexamples in the existing Slice D boundary.

### Dead ends not worth repeating unchanged

- `reliability smartphone measure` → predominantly questionnaire/test psychometrics, not logged behavior.
- `screen time accuracy Digital Wellbeing` → blogs, marketing, support pages, and apps; no disclosed ground-truth rule.
- `multiverse digital phenotyping` → mostly downstream feature/model sweeps; Niemeijer is the known close result but fixes reconstruction.
- `data processing decisions should be reported behavioral logs` → privacy, GDPR, and compliance logging.
- `screen time measurement problems` → self-report scale development unless paired with `trace`, `passive sensing`, `criterion validity`, or a named logger.
- `wearable algorithm update validation` → product news and support pages unless paired with `firmware`, `software version`, `criterion`, and a named device family.
- Broad `neuroimaging multiverse` → many downstream statistical pipelines; adding `preprocessing`, `derived measure`, `reproducibility`, or `pipeline variability` recovered the closer analogues.

### Access failures and route substitutions

- JavaScript-only publisher/search shells were not treated as evidence. DOI/Crossref metadata, PubMed/Europe PMC, publisher full text, and stable repositories were used instead.
- Paywalled full text was not silently inferred from abstracts. Those records are labeled `ABS`, and exact rules/thresholds remain `UNDETERMINED` where the abstract did not state them.
- No automated browser control was used. Search and source retrieval were performed through direct web/index routes and DOI resolution.

## Deduplicated bibliography and provenance note

The numbered records **D01–D72 are the deduplicated bibliography**: one record per normalized DOI, with title and author metadata reconciled against live DOI/Crossref/publisher records on 2026-08-05. The DOI is the deduplication key; titles were normalized only for comparison, not silently rewritten. Long consortium author lists are represented by the first author plus `et al.` in this ledger, while the DOI record is the authoritative complete author list. None of the 72 DOI strings occurred in the local paper corpus after the final full-boundary check.

## Recommended claim after this slice

> Measurement/preprocessing multiverses are established across web tracking, psychometrics, neuroimaging, electrophysiology, and accelerometry. What remains unlocated is a systematic multiverse over the typed-event reconstruction layer of OS-level app-usage logs—especially missing-close repair, event allowlists, pairing, overlap resolution, and gap/threshold provenance—followed by psychometric and substantive sensitivity analyses.

This wording cites neighboring precedents, concedes reporting counterexamples and successful vendor validations, and confines novelty to the event-semantics layer actually absent from the retained literature.

<!-- chatgpt-pro-delta-20260805:D -->

## Independently reviewed additions — Slice D

The review also returned Wenz et al. and Cernat et al.; both were rejected as net-new because they already occur in the local Winklbauer reference inventory and citation-chase lanes.

### D71 — Weiß, Leitgöb & Wagner (2025)

- **Citation.** Bernd Weiß, Heinz Leitgöb & Claudia Wagner, “Conceptualizing, Assessing, and Improving the Quality of Digital Behavioral Data.” [DOI 10.1177/08944393251367041](https://doi.org/10.1177/08944393251367041).
- **Why it matters here.** It makes undocumented event builders and unstable collection software measurement-quality defects rather than merely implementation details.
- **Instrument and ladder rung.** Conceptual/editorial quality framework; **N/A**.
- **Episode reconstruction rule.** **N/A**; it does not construct episodes.
- **Session threshold.** **N/A**.
- **Availability.** No data/code is required. The article identifies a “lack of data models, measurement theories, and quality standards” and discusses opacity/instability in recording systems.
- **Access.** Full SAGE article; **full text / FT-OA route inspected**.

### D72 — Schneck & Przepiorka (2024 online; 2025 issue)

- **Citation.** Andreas Schneck & Wojtek Przepiorka, “Meta-Dominance Analysis—A Tool for the Assessment of the Quality of Digital Behavioural Data.” [DOI 10.1177/08944393241261958](https://doi.org/10.1177/08944393241261958).
- **Why it matters here.** The method quantifies how platform, collection mode, operationalization, and transformation choices dominate observed research variation.
- **Instrument and ladder rung.** Methodological contribution; **N/A**.
- **Episode reconstruction rule.** **N/A**.
- **Session threshold.** **N/A**.
- **Availability.** No complete public replication package was located. In the motivating application, approximately **85%** of effect-size heterogeneity is attributed to measurement-process characteristics rather than substantive moderators.
- **Access.** Full SAGE article; **full text / FT-OA route inspected**.

---

## Direct-device and preprocessing-measurement expansion (2026-08-06)

These 23 works were absent by DOI and distinctive-title scan across the local paper/specification corpus. They prioritize direct smartphone/wearable transformations, missingness rules, validity gates, and current reporting standards; generic downstream model sweeps were excluded.

### D73 — Burns et al. (2024), Cortex tutorial

- **Citation.** *Transforming Digital Phenotyping Raw Data Into Actionable Biomarkers, Quality Metrics, and Data Visualizations Using Cortex Software Package: Tutorial*. [DOI 10.2196/58502](https://doi.org/10.2196/58502).
- **Why / rung.** Direct open raw-smartphone→feature pipeline; **Rung 3**.
- **Rule.** Data quality is the percentage of fixed bins containing at least one GPS/accelerometer point; the example uses **3,600,000-ms (1-hour) bins**. Screen-duration zeros are changed to `NaN` before correlations.
- **Threshold provenance.** Declared in “Checking Engagement and Data Quality” and final-cleanup sections; no app-session rule.
- **Availability.** Cortex and examples are open; participant data are request-only. The transformation layer is substantially rerunnable.
- **Access.** Full JMIR/PMC text (PMC11380059), checked 2026-08-06.

### D74 — Gonsalves et al. (2026), actigraphy preprocessing scoping review

- **Citation.** *Cleaning and Pre-Processing of Actigraphy Data for Physical Activity and Sleep Research: A Scoping Review*. [DOI 10.1088/1361-6579/ae3b96](https://doi.org/10.1088/1361-6579/ae3b96).
- **Why / rung.** Current systematic evidence that nonwear, invalid-period removal, re-epoching, aggregation, and feature extraction are measurement decisions; **N/A** rung.
- **Rule.** Among 102 studies, nonwear detection was unreported in **37%**, daily-wear criteria in **51%**, and cleaning in **24%**; 31 used custom methods and 25 did not report a method.
- **Threshold provenance.** Review result, not one universal threshold; supplies a decision tree and reproducibility checklist.
- **Availability.** Extraction tables and supplement are public; no new raw data.
- **Access.** Full IOP/PMC text (PMC12955727), checked 2026-08-06.

### D75 — Carrier et al. (2026), WEAR-BOT checklist

- **Citation.** *The WEAR-BOT Checklist: A Risk of Bias Tool for Evaluating Validity and Reliability Research in Wearable Technology*. [DOI 10.1371/journal.pone.0338014](https://doi.org/10.1371/journal.pone.0338014).
- **Why / rung.** Direct reporting standard for derived wearable measures; **N/A** rung.
- **Rule.** Requires reproducible processing descriptions, amount/reason for cleaned data, prespecified reliability thresholds, firmware/OS versions, and update handling; generally discourages imputation without strong justification.
- **Threshold provenance.** Checklist validity/reliability items, not a domain cutoff.
- **Availability.** Open Excel checklist at [10.7910/DVN/VJ9D2X](https://doi.org/10.7910/DVN/VJ9D2X).
- **Access.** Full PLOS/PMC text and checklist (PMC12885281), checked 2026-08-06.

### D76 — Shen et al. (2026), multimodal passive smartphone sensing guide

- **Citation.** *Multimodal Passive Smartphone Sensing in Older Adults: A Guide for Clinical Scientists Based Upon an Ongoing Cohort Study*. [DOI 10.1093/geroni/igag007](https://doi.org/10.1093/geroni/igag007).
- **Why / rung.** Direct iOS SensorKit/research-app preprocessing of raw activity, gait, location, device-use, typing, and communication into 145 daily features; **Rung 3**.
- **Rule.** Discard days without timezone and days crossing timezones; require **14 h during 06:00–24:00** for most daytime features and **1 h during 00:00–06:00** for home/full-day location; zero-impute only selected empty event streams on sufficiently sensed days; require **30 nonmissing days** per modeled feature.
- **Threshold provenance.** Declared in data preprocessing, sufficiency, imputation, and statistical-analysis sections; not an app-session timeout.
- **Availability.** Data/code unavailable; SensorKit approval was study-specific.
- **Access.** Full Oxford/PMC text (PMC12995428), checked 2026-08-06.

### D77 — Slade et al. (2025), active/passive mobile-health collection review

- **Citation.** *Current Challenges and Opportunities in Active and Passive Data Collection for Mobile Health Sensing: A Scoping Review*. [DOI 10.1093/jamiaopen/ooaf025](https://doi.org/10.1093/jamiaopen/ooaf025).
- **Why / rung.** Direct synthesis of authorization, background execution, syncing, battery, nonwear, timestamps, and OS updates as pre-model measurement failures; **N/A** review rung.
- **Rule.** Across 77 studies, reported failures included disabled permissions, export/sync failure—especially iOS background tasks—nonwear, timestamp synchronization, and OS updates.
- **Threshold provenance.** No universal episode threshold; mitigations include dashboards, native health stores, sync prompts, imputation, and duty-cycle changes.
- **Availability.** Extraction data and online supplement are public.
- **Access.** Full JAMIA Open/PMC text (PMC12274063), checked 2026-08-06.

### D78 — Leimhofer et al. (2025), cross-platform sensor availability

- **Citation.** *Cross-Platform Availability of Smartphone Sensors for Depression Indication Systems: Mixed-Methods Umbrella Review*. [DOI 10.2196/69686](https://doi.org/10.2196/69686).
- **Why / rung.** Shows nominally identical features depend on changing hardware, OS access, and derived sensor fusion; spans **Rungs 1 and 3**.
- **Rule.** Nine reviews yielded 16 hardware and three software streams; PhoneDB was queried annually for Android/iOS component availability during **2014–2024**. App use, calls/messages, and screen status are software streams; step counts are derived.
- **Threshold provenance.** Annual device-availability window, not a session cutoff.
- **Availability.** Supplement contains extraction/PhoneDB results; generated data request-only.
- **Access.** Full JMIR/PMC text (PMC12371283), checked 2026-08-06.

### D79 — Barron et al. (2026), TRIM missingness framework

- **Citation.** *Data Missingness in Digital Phenotyping and Its Implications for Clinical Inference and Decision Making: The TRIM Framework*. [Current preprint DOI 10.2196/preprints.95468](https://doi.org/10.2196/preprints.95468); same work as medRxiv 10.1101/2024.10.03.24314808.
- **Why / rung.** Direct Beiwe missingness study showing that timescale and imputation can change a clinical conclusion; **Rung 3**.
- **Rule.** Completeness is computed at day/hour/minute levels; median accelerometer completeness was **60%/37%/26%**, GPS **57%/34%/5%**. A cadence–depression association changed from P=.01 complete-case to P=.13 after imputation. TRIM separates Technology Failure, Clinically Relevant events, and Extraneous life events.
- **Threshold provenance.** Timescales and 100 imputations are declared; no app-session rule.
- **Availability.** Public data/code not established from accessible records.
- **Access.** Current JMIR/Crossref structured preprint plus earlier medRxiv abstract, checked 2026-08-06.

### D80 — Leaning et al. (2025), point-process imputation

- **Citation.** *Did You Miss Me? Making the Most of Digital Phenotyping Data by Imputing Missingness with Point Process Models*. [DOI 10.1101/2025.05.13.25327521](https://doi.org/10.1101/2025.05.13.25327521).
- **Why / rung.** Direct smartphone-event imputation models activities as points rather than ordinary missing cells; **Rung 3**.
- **Rule.** Personalized nonhomogeneous Poisson processes were compared with time-varying covariates; **hour-of-day one-hot encoding** had the highest out-of-sample likelihood and preserved HMM daily rhythms.
- **Threshold provenance.** Hourly encoding is declared in the abstract; exact full pipeline remains undetermined.
- **Availability.** Code/data statement not located.
- **Access.** Abstract/preprint record only; PDF returned 403, checked 2026-08-06.

### D81 — Olcan (2026), missingness-as-biomarker falsification

- **Citation.** *Smartphone Missingness as a Depression Biomarker: A Baseline-Controlled Re-Analysis of StudentLife*. [DOI 10.64898/2026.04.30.26351977](https://doi.org/10.64898/2026.04.30.26351977).
- **Why / rung.** Direct counterexample: missingness did not add depression prediction after baseline control; public **Rung 3** StudentLife streams.
- **Rule.** Creates **89 missingness features** from nine continuous streams, five phone logs, and 27 EMAs; leave-one-out CV, nested tuning, omnibus F-test, and Benjamini–Hochberg correction. Baseline PHQ-9 explained 59% out-of-sample variance; missingness added none (F(9,27)=0.43, P=.91).
- **Threshold provenance.** Feature grid and inferential correction declared; no episode rule.
- **Availability.** Public StudentLife source, supplementary presence tensor/feature table, and Python analysis code; rerunnable.
- **Access.** Full medRxiv preprint plus Crossref, checked 2026-08-06.

### D82 — Dumas et al. (2026), smartphone phenotyping reporting audit

- **Citation.** *Smartphone-Based Digital Phenotyping Across Health Conditions: Scoping Review*. [DOI 10.2196/84146](https://doi.org/10.2196/84146).
- **Why / rung.** Direct audit of operationalization/reporting across 65 smartphone-sensing studies; **Rung 3** field evidence.
- **Rule.** Ten studies lacked clear stream descriptions; only six quantified stream-level missingness, four reported sampling/duty cycle, 22 stated OS, and seven discussed compliance/attrition.
- **Threshold provenance.** Reporting census, not a session threshold.
- **Availability.** Public review supplement; field data mostly unavailable.
- **Access.** Full JMIR/PMC text (PMC13013828), checked 2026-08-06.

### D83 — Amin et al. (2025), longitudinal depression mobile-sensing review

- **Citation.** *Use of Mobile Sensing Data for Longitudinal Monitoring and Prediction of Depression Severity: Systematic Review*. [DOI 10.2196/57418](https://doi.org/10.2196/57418).
- **Why / rung.** Direct review of smartphone/wearable preprocessing, missingness, and derived-feature use; **Rung 3** field evidence.
- **Rule.** Missingness handling was rarely reported: examples deleted days missing any of 53 features (retaining **950/2694**), required **>85% completion**, or required **≥30 wearable days** (retaining 54.5%).
- **Threshold provenance.** Study-specific inclusion gates; no common episode rule.
- **Availability.** Supplement public; generated data request-only.
- **Access.** Full JMIR/PMC text (PMC12411791), checked 2026-08-06.

### D84 — Jung et al. (2025), device-specific feature importance

- **Citation.** *Key Features of Digital Phenotyping for Monitoring Mental Disorders: Systematic Review*. [DOI 10.2196/77331](https://doi.org/10.2196/77331).
- **Why / rung.** Same named feature has different accessibility and importance across Actiwatch, band, and smartwatch platforms; **Rungs 1/3**.
- **Rule.** Features are mapped by coverage and “importance among those used,” with **50%** defining high/high; raw physiology is often inaccessible and sleep definitions differ by device/algorithm.
- **Threshold provenance.** Review classification cutoff, not session construction.
- **Availability.** OSF materials at [osf.io/nz7k8](https://osf.io/nz7k8/); exact rerun completeness undetermined.
- **Access.** Full JMIR/PMC text (PMC12588392), checked 2026-08-06.

### D85 — Busshart et al. (2026), parameter-centered depression review

- **Citation.** *Distinguishing Common Digital Phenotyping and Self-Report Parameters for Monitoring and Predicting Depression: Scoping Review*. [DOI 10.2196/70840](https://doi.org/10.2196/70840).
- **Why / rung.** Parameter-first synthesis makes operationalization comparability the object; **Rungs 1/3** field evidence.
- **Rule.** Substantial heterogeneity in sampling, duration, devices, and missingness; only **6/19** studies built/evaluated predictive models.
- **Threshold provenance.** No universal episode threshold.
- **Availability.** Generated datasets request-only.
- **Access.** Full JMIR/PMC text (PMC12954677), checked 2026-08-06.

### D86 — Jiménez Rama et al. (2026), discrepancy as sleep signal

- **Citation.** *Full-Day Sleep Pattern Analysis in Common Mental Disorders: Leveraging Highly Discrepant Recordings from Two Consumer Tracking Devices*. [DOI 10.1371/journal.pone.0346876](https://doi.org/10.1371/journal.pone.0346876).
- **Why / rung.** Direct vendor-aggregate comparison treats disagreement as behavioral signal and admits arbitrary thresholds; **Rung 1**.
- **Rule.** Of 10,487 days, 4,824 had both devices. Start-time discrepancy zones are **<1 h**, **1–5 h**, and **>5 h**; paired days only; features min–max scaled.
- **Threshold provenance.** Authors explicitly call the 1 h/5 h zones arbitrary but rational; no usage-session rule.
- **Availability.** Data in paper/supporting files; no separate code deposit located.
- **Access.** Full PLOS/PMC text (PMC13065001), checked 2026-08-06.

### D87 — Miwa et al. (2026), consumer versus research physical-activity measures

- **Citation.** *Comparison of Consumer-Grade Wearable Devices with a Research-Grade Instrument for Measuring Physical Activity in a Free-Living Setting*. [DOI 10.1371/journal.pone.0342543](https://doi.org/10.1371/journal.pone.0342543).
- **Why / rung.** Substituting proxy metrics changes the construct; **Rung 1** vendor aggregate versus ActiGraph.
- **Rule.** Retain ActiGraph days with **≥10 h** wear; exclude consumer-zero days. Apple Exercise minutes is an explicitly nonequivalent MVPA proxy; Fitbit PAEE=TDEE−basal. Apple MVPA differed −46.22%, Fitbit PAEE +139.19%.
- **Threshold provenance.** Declared validity/proxy rules; no session threshold.
- **Availability.** Proprietary/request-only data; Python environment reported, code not public.
- **Access.** Full PLOS/PMC text (PMC12928483), checked 2026-08-06.

### D88 — Carson et al. (2025), cut points and Fitbit agreement

- **Citation.** *Agreement Between Consumer and Research-Grade Physical Activity Monitors in a Public Health Intervention for Adolescent Latinas*. [DOI 10.3390/ijerph22111663](https://doi.org/10.3390/ijerph22111663).
- **Why / rung.** Isolates cut-point and epoch effects in Fitbit versus ActiGraph comparison; **Rung 1**.
- **Rule.** Valid day: ActiGraph **>600 wear minutes**; Fitbit **>600 heart-rate minutes or >6000 steps**. Freedson exceeded Treuth by 14.7 MVPA min/day and Fitbit by 14.2.
- **Threshold provenance.** Declared in §2.3; these are validity/cut-point choices, not sessions.
- **Availability.** Data request-only; transformation conceptually rerunnable.
- **Access.** Full MDPI/PMC text (PMC12652026), checked 2026-08-06.

### D89 — Ravanelli et al. (2025), open-source smartwatch validation

- **Citation.** *Validation of an Open-Source Smartwatch for Continuous Monitoring of Physical Activity and Heart Rate in Adults*. [DOI 10.3390/s25092926](https://doi.org/10.3390/s25092926).
- **Why / rung.** Open raw-wearable alternative to opaque vendor summaries; **Rung 3 analogue**.
- **Rule.** Exclude nonwear; valid day **≥16 h**; align devices to nearest minute. Prespecified acceptable MAPE/MdAPE **≤10%**, with 11% wrist/15% free-living alternatives discussed.
- **Threshold provenance.** Declared validation criteria.
- **Availability.** Dataset/code [OSF 8MZG5](https://doi.org/10.17605/OSF.IO/8MZG5); watch app open via Espruino; strongly rerunnable.
- **Access.** Full Sensors/PMC text (PMC12074211), checked 2026-08-06.

### D90 — Wei et al. (2025), BMI-inclusive energy-expenditure algorithm

- **Citation.** *Developing and Comparing a New BMI Inclusive Energy Expenditure Algorithm on Wrist-Worn Wearables*. [DOI 10.1038/s41598-025-99963-0](https://doi.org/10.1038/s41598-025-99963-0).
- **Why / rung.** Explicit raw inertial-signal→MET construction; **Rung 3 analogue**.
- **Rule.** Tests **5–90 s windows with 50% overlap**; drops first two minutes/activity; sedentary windows and predictions below 1.0 set to 1.0 MET; extracts 42 statistics across six axes.
- **Threshold provenance.** Fully declared in data-analysis section.
- **Availability.** [Zenodo data](https://zenodo.org/records/14858226) and [GitHub code](https://github.com/HAbitsLab/WristBased-EE-Estimation); rerunnable.
- **Access.** Full Scientific Reports/PMC text (PMC12179259), checked 2026-08-06.

### D91 — Finnegan et al. (2025), harmonizing raw accelerometry units

- **Citation.** *The Ability of Monitor-Independent Movement Summary Units, Euclidean Norm Minus One, and Mean Amplitude Deviation to Harmonize Accelerometry Data…*. [DOI 10.1123/jmpb.2025-0002](https://doi.org/10.1123/jmpb.2025-0002).
- **Why / rung.** Positive counterexample: suitable raw-stream preprocessing can harmonize devices; **Rung 3 analogue**.
- **Rule.** Compares second-level ENMO, MAD, and MIMS; MAD had lowest cross-device z-score SD (0.13), LCCC .89–.96, ICC .88.
- **Threshold provenance.** Second-level summary declared; detailed full-text pipeline undetermined.
- **Availability.** Not stated in abstract.
- **Access.** PubMed abstract (PMID 41909497); full XML unavailable, checked 2026-08-06.

### D92 — Ghosal et al. (2025), device-agnostic PAEE model

- **Citation.** *Leveraging Accelerometry and Heart Rate Data from Consumer Wearables to Predict Physical Activity in Children: A Device Agnostic Approach*. [DOI 10.1249/mss.0000000000003721](https://doi.org/10.1249/mss.0000000000003721).
- **Why / rung.** Counterexample: shared raw features support comparable Apple/Garmin estimates, while Fitbit remains worse; **Rung 3 analogue**.
- **Rule.** Minute-level accelerometry/heart-rate features; R² .74–.76 research, .76–.78 Apple, .73–.75 Garmin, .63–.67 Fitbit.
- **Threshold provenance.** Minute aggregation declared in abstract; complete algorithm undetermined.
- **Availability.** Not stated in accessible abstract.
- **Access.** PubMed abstract (PMID 40197719), checked 2026-08-06.

### D93 — Zhang et al. (2026), Apple Watch versus ActiGraph rhythms

- **Citation.** *Comparison of Rest–Activity Rhythm Metrics from Apple Watch and ActiGraph Devices*. [DOI 10.1093/sleep/zsaf359](https://doi.org/10.1093/sleep/zsaf359).
- **Why / rung.** High rank agreement does not imply absolute interchangeability; **Rung 3 analogue**.
- **Rule.** One-week activity-count series, n=23; most rank correlations .7–.9 and agreement ICCs .74–.85, but scale-dependent amplitude ICC **.01**.
- **Threshold provenance.** Observation window/model declared; no session threshold.
- **Availability.** Not stated in accessible abstract.
- **Access.** PubMed abstract (PMID 41217178), checked 2026-08-06.

### D94 — Hu et al. (2025), consumer sleep measurement agreement

- **Citation.** *Quantification of Differences in Sleep Measurement by a Wrist-Worn Consumer Wearable Compared to Research-Grade Accelerometry and Sleep Diaries…*. [DOI 10.2147/nss.s530812](https://doi.org/10.2147/nss.s530812).
- **Why / rung.** Modest mean bias coexists with wide individual limits; **Rung 1** consumer aggregates versus research actigraphy/diary.
- **Rule.** ActiGraph 30 Hz/60-s epochs, diary-defined intervals, Cole–Kripke scoring; concurrent periods only. Fitbit TST bias −16.0 min/ICC .79; efficiency ICC .39; <4% of >3-hour differences retained.
- **Threshold provenance.** Declared methods; no device-use session rule.
- **Availability.** Data/code require external-collaborator request; vendor algorithm/firmware opaque.
- **Access.** Full PMC text (PMC12399887), checked 2026-08-06.

### D95 — Langford et al. (2026), GENEAcore preprocessing

- **Citation.** *Validation and Optimisation of Wearable Accelerometer Data Pre-Processing for Digital Measure Implementation and Development*. [DOI 10.64898/2026.03.21.713324](https://doi.org/10.64898/2026.03.21.713324).
- **Why / rung.** **Major direct analogue:** validates calibration, nonwear, transition detection, bout creation, and activity-intensity construction as a modular measurement layer; **Rung 3 analogue**.
- **Rule.** Validates the **13 mg acceleration-SD** nonwear threshold (balanced accuracy 92.3%); detects 99% transitions within 2 s; variable-duration bouts yield **31% more daily activity duration** than one-second epochs.
- **Threshold provenance.** Empirically evaluated in the preprint; low-movement outputs still diverge despite >99% movement-period concordance.
- **Availability.** GPL-3.0 [GENEAcore manuscript repository](https://github.com/JossLangford/geneacore-manuscript) with R scripts, results, sample `.bin` files; full study data request-only.
- **Access.** Structured bioRxiv/Crossref record and repository; PDF rate-limited, checked 2026-08-06.

### Slice D expansion count

- **New records:** D73–D95 = **23**.
- **Authoritative Slice D total:** **95** works.
- **Direct conclusion:** current research already treats preprocessing, completeness, proxy substitution, firmware/device context, and validity gates as measurement decisions. The unoccupied contribution is narrower: a systematic multiverse at the typed mobile event→episode layer.

## Direct-mobile sensitivity additions from Pro reconciliation — 2026-08-06

These eight records survived independent primary-source checking and are directly tied to mobile-use
construction, selection, measurement reactivity, or validation. Network-traffic proxies, generic
passive-sensing protocols without a screen/app builder, and non-screen platform analogues were
excluded. Detailed accept/reject decisions are in
[`../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md`](../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md).

### D96 — Yang et al. (2023), screen-session features and level-of-analysis divergence

- **Citation.** *Association Between the Severity of Depressive Symptoms and Human-Smartphone Interactions: Longitudinal Study*. [DOI 10.2196/42935](https://doi.org/10.2196/42935).
- **Why / rung.** Direct Android screen-session construction feeding clinical longitudinal models; **Rung 2/3**.
- **Rule.** Session=screen on→next screen off; hourly features include median duration, app count/entropy, and midnight–6 a.m. active time; typing interkey gaps are capped at five seconds.
- **Threshold provenance.** Session boundary declared; the midnight window and typing cap are feature choices, not inactivity gaps. Within-person and between-person symptom associations differ, so construction effects cannot be assumed to propagate identically across levels.
- **Availability.** Full article public; proprietary Mindstrong collector and raw traces unavailable.
- **Access.** [Full JMIR article](https://formative.jmir.org/2023/1/e42935), checked 2026-08-06.

### D97 — Ahmed et al. (2026), intention–duration non-equivalence in regretful sessions

- **Citation.** *Before You Scroll Again: Predicting Regretful Social Media Sessions From In-the-Wild Contextual and Wearable Sensing*. [arXiv 2606.08965](https://arxiv.org/html/2606.08965).
- **Why / rung.** Direct app-session study showing that a contextual/intentional construct can dominate raw duration; **Rung 3/4**.
- **Rule.** UsageStatsManager start/stop records plus AccessibilityService exit detection for 12 apps; transient overlays/system packages filtered; a per-app cooldown suppresses triggers.
- **Threshold provenance.** Cooldown and missing-exit policy are not disclosed. Wearable one-minute-on/four-minute-off scheduling is acquisition duty cycling. The intention–actual-use gap predicts regret more strongly than duration, whose effect contracts in the joint model.
- **Availability.** Full preprint; promised code link is still a placeholder.
- **Access.** arXiv HTML, checked 2026-08-06.

### D98 — Meinhardt et al. (2025), threshold-selected infinite-scrolling contexts

- **Citation.** *Scrolling in the Deep: Analysing Contextual Influences on Intervention Effectiveness During Infinite Scrolling on Social Media*. [DOI 10.1145/3706598.3713187](https://doi.org/10.1145/3706598.3713187); [arXiv 2501.11814](https://arxiv.org/abs/2501.11814).
- **Why / rung.** Feature-level mobile-use construction whose **15-minute** gate defines the sampled behavioral universe; **Rung 3**.
- **Rule.** Continuous infinite-scroll activity in the Android `InfiniteScape` environment ends when the app closes or behavior changes away from scrolling.
- **Threshold provenance.** Fifteen minutes is an intervention eligibility/trigger, not a validated general session gap. Results therefore concern prolonged scrolling contexts rather than all scrolling episodes.
- **Availability.** Paper/preprint public; no general Android event-repair implementation.
- **Access.** Primary preprint and DOI record, checked 2026-08-06.

### D99 — Meinhardt et al. (2026), explicit feature-session selection and open materials

- **Citation.** *Can't Stop: How Context and Individual Traits Influence Effectiveness of Different Gradual Interventions for Infinite Scrolling on Short-Form Video Platforms*. [DOI 10.1145/3831979](https://doi.org/10.1145/3831979); [arXiv 2607.15818](https://arxiv.org/html/2607.15818).
  - *Title corrected 2026-08-07.* The ledgers previously read “…Progressively Intensifying **Haptic** Interventions Against Infinite Scrolling”; the actual title is the one above. Authors match exactly, so this is a title error, not a different work. `10.1145/3831979` is **author-declared for a forthcoming PACM IMWUT article and does not resolve today** — fine to cite, but it is not a resolvable identifier yet; the arXiv id is the working route.
- **Why / rung.** Follow-up with an explicit AccessibilityService-derived scrolling-session definition and public analysis artifacts; **Rung 3**.
- **Rule.** Session=uninterrupted passive feed consumption until non-scrolling activity or app close; active engagement is excluded.
- **Threshold provenance.** Recording/intervention begins after 15 minutes, creating over-threshold selection; intervention maximum 3 minutes 31 seconds and its haptic schedule are declared.
- **Availability.** [App/data/R scripts public](https://github.com/luca-maxim/Cant_Stop).
- **Access.** Full arXiv and repository, checked 2026-08-06.

### D100 — Reiter & Schoedel (2024), screen-conditioned ESM compliance

- **Citation.** *Never Miss a Beep: Using Mobile Sensing to Investigate (Non-)Compliance in Experience Sampling Studies*. [DOI 10.3758/s13428-023-02252-9](https://doi.org/10.3758/s13428-023-02252-9); [open repository record](https://epub.ub.uni-muenchen.de/116336/).
- **Why / rung.** Direct demonstration that observation/response eligibility is conditioned on phone state; **Rung 3**.
- **Rule.** PhoneStudy/SSPS screen and app features are computed in the 60 minutes before a beep. Values outside ±4 SD become missing; features with >90% missingness are removed; near-zero-variance features are removed; imputation is performed inside resampling.
- **Threshold provenance.** Prompts were pseudo-randomly scheduled but notified only on the first active smartphone use after scheduled time. The screen-on gate selects contexts before downstream compliance modeling begins.
- **Availability.** Full open article plus dataset/codebook/materials; upstream mobile session builder delegated.
- **Access.** Primary open manuscript, checked 2026-08-06.

### D101 — Toth, Parry & Klingelhoefer (2025), measurement reactivity to logging and ESM

- **Citation.** *Somebody's (Still) Watching Me: Reactivity to Smartphone Logging and Experience Sampling*. [DOI 10.31235/osf.io/xt24p_v3](https://doi.org/10.31235/osf.io/xt24p_v3); [OSF preprint](https://osf.io/preprints/socarxiv/xt24p_v3/).
- **Why / rung.** Direct evidence that the measurement apparatus changes the behavior being reconstructed; **Rung 3**.
- **Rule.** N=815 German Android users, seven days, up to seven surveys/day; raw reconstruction delegates to the Parry–Toth algorithm. The paper distinguishes glances, sessions, and episodes, removes sessions/glances >5 SD and sessions <0.5 s, uses five-minute windows, and splits sessions across windows.
- **Threshold provenance.** Logging effects are small/transient, while ESM prompts change use for roughly two to three hours. Those are reactivity horizons, not reconstruction gaps.
- **Availability.** Preprint and study artifacts public; raw event builder inherited rather than newly disclosed.
- **Access.** Primary OSF preprint/PDF, checked 2026-08-06.

### D102 — Toth, Parry, Pourafshari & Bayer (2025), habit indicators depend on episode unit

- **Citation.** *Zooming in on Smartphone Habits: Identifying Behavioral Indicators of Perceived Automaticity*. [DOI 10.31234/osf.io/bqfne_v3](https://doi.org/10.31234/osf.io/bqfne_v3); [OSF preprint](https://osf.io/preprints/psyarxiv/bqfne_v3/).
- **Why / rung.** Tests competing behavioral units—glances, sessions, episodes, frequency, duration—rather than a monolithic screen-time total; **Rung 3**.
- **Rule.** N=889 and about 70 million events yield about 6.5 million derived glances/sessions/episodes using the delegated Parry–Toth algorithm; Android versions below 9 are excluded because lock/unlock evidence is unavailable; features use 30-minute pre-ESM windows.
- **Threshold provenance.** Duration is a more consistent automaticity correlate than frequency; session/episode duration relates to automaticity while glances and gateway/home-screen explanations are null.
- **Availability.** Primary preprint public; no new event-builder implementation.
- **Access.** OSF preprint/PDF, checked 2026-08-06.

### D103 — Krüger, Sachdeva & Sobolev (2025), synthetic session fixtures expose structural failures

- **Citation.** *Synthetic Data Generation for Screen Time and App Usage*. [arXiv 2509.13892](https://arxiv.org/abs/2509.13892).
- **Why / rung.** Directly relevant synthetic-fixture/null work: a plausible record schema does not guarantee plausible temporal behavior; **N/A synthetic analogue**.
- **Rule.** Synthetic records contain timestamp, app, and duration. Evaluation segments logs into distinct usage blocks at gaps of at least one minute with no use and checks for 1–20 hours of daily use plus at least five hours of non-use.
- **Threshold provenance.** The plausibility limits are declared validation criteria, not learned reconstruction parameters. Generated outputs include impossible totals above 42 hours/day and outputs with no long inactivity.
- **Availability.** Full preprint; OSF data are stated in the paper.
- **Access.** arXiv full text, checked 2026-08-06.

### Slice D Pro-reconciliation count

- **New records:** D96–D103 = **8**.
- **Authoritative Slice D total:** **103** works.
- **Direct conclusion:** direct mobile studies add four distinct sensitivity mechanisms—feature-unit choice, threshold-selected observation, screen-conditioned response eligibility, and measurement reactivity—without relying on web or network-traffic proxies.

## Fresh measurement/construct additions from Pro discovery — 2026-08-06

### D104 — Winbush et al. (2025), “session length” without reconstructed sessions

- **Citation.** *Smartphone Use in a Large US Adult Population: Temporal Associations Between Objective Measures of Usage and Mental Well-Being*. [DOI 10.1073/pnas.2427311122](https://doi.org/10.1073/pnas.2427311122).
- **Why / rung.** Large-population hourly category-use minutes and screen-unlock counts; **Rung 2/3 aggregates**.
- **Rule.** “Total session length” is category minutes in hours where that category was used; “average session length” divides those minutes by unlock count. Neither quantity identifies reconstructed app or screen sessions.
- **Threshold/selection.** Participant-weeks require ≥48 complete hours, then use weekly means.
- **Availability.** Full open article; participant telemetry not public and upstream event construction delegated.
- **Implication.** Construct labels must be audited independently of formulas: “session length” can be an algebraic ratio rather than an episode duration.

### D105 — Lin et al. (2024), notification-management state changes and study-period selection

- **Citation.** *Pinning, Sorting, and Categorizing Notifications: A Mixed-Methods Usage and Experience Study of Mobile Notification-Management Features*. [DOI 10.1145/3678579](https://doi.org/10.1145/3678579); [author PDF](https://pjwang.info/assets/papers/pinning-sorting-and-categorizing-notification.pdf).
- **Why / rung.** NotiManager observes arrival/features and changes where notifications remain visible; **Rung 4**.
- **Rule.** Notifications remain in the native drawer for 5 s, after which non-ongoing records move to the study center while ongoing notifications remain. The five seconds are an acquisition/design rule, not a response threshold.
- **Threshold/selection.** Of 109,253 notifications, 36,756 default-week records are excluded; default-mode ESM/diaries and 38 “do not remember” diaries are also removed.
- **Availability.** Full paper public; raw corpus/complete app source not verified.
- **Implication.** Interface instrumentation and analytic selection jointly define the retained notification measure before participant experience is modeled.

### Slice D fresh-discovery count

- **New records:** D104–D105 = **2**.
- **Authoritative Slice D total:** **105** works.
- **Direct conclusion:** measurement audits must inspect whether a named session is an actual interval, an unlock-normalized ratio, an intervention state, or an inclusion-filtered notification record.

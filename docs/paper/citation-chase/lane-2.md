# Citation chase — Lane 2 (Winklbauer & Batinic reference-list entries 11–20)

Audit target: what each cited study **actually declares** about turning raw device events into
usage numbers. "NOT STATED" is a finding, not a lookup failure. Nothing below is inferred from a
different paper by the same group.

Ladder rungs used throughout: **Rung 4** = raw platform event log with declared semantics (e.g.
Android `UsageEvents`); **Rung 3** = app-level event logging research app; **Rung 2** = screen
on/off logging only; **Rung 1** = vendor aggregate (iOS Screen Time, Android Digital Wellbeing,
battery stats).

---

## 11. Deng, Kanthawala, Meng, Peng, Kononova, Hao, Zhang & David — Measuring smartphone usage and task switching with log tracking and self-reports

*Mobile Media & Communication* 7(1), 3–23. doi:10.1177/2050157918761491

**Transcription note:** the preprint's list dates this 2018; Crossref/SAGE place the issue in
**2019** (online-first 2018). Same DOI, same paper — a year-of-record difference, not an error in
the DOI.

- **Instrument and ladder rung** — NOT DETERMINABLE from what I could read. The abstract says only
  "comparing self-reports with **log data from the smartphone**" and reports "101 app switches per
  day", which requires app-level (Rung 3-style) event logging, but **the logging software is not
  named in the abstract** and I could not reach the Method section. Recorded as unresolved rather
  than guessed.
- **Session threshold** — NOT ESTABLISHED (not addressed in the abstract; Method not read).
- **Episode reconstruction rule** — NOT ESTABLISHED (Method not read).
- **System-app / launcher filtering** — NOT ESTABLISHED (Method not read).
- **Window, exclusions, aggregation** — window is stated in the abstract: "Data were collected from
  50 participants over **1 week**." Reported quantities are averages ("on average participants spent
  2 hours 39 minutes on their smartphone and made 101 app switches per day"). Exclusion criteria and
  mean-vs-median choice: NOT ESTABLISHED.
- **Availability** — NOT ESTABLISHED.

**Access: abstract only** (OpenAlex `abstract_inverted_index` for the DOI). The article is recorded
as hybrid open access with a `public-domain` license by both Unpaywall and Semantic Scholar, and the
only OA location either service lists is `journals.sagepub.com/doi/pdf/10.1177/2050157918761491`.
That host is behind a Cloudflare JavaScript interstitial ("Just a moment…"); `curl` receives the
challenge page and `WebFetch` receives HTTP 403 on both `/doi/full/` and `/doi/pdf/`. No repository
copy exists in OpenAlex, Unpaywall, OpenAIRE, or the corresponding author's own publications page.
**This is an openly licensed paper that is nonetheless unreadable by non-browser retrieval** — worth
recording as its own small finding about the field's access surface.

---

## 12. Ejaz, Altay & Naeem (2023) — Smartphone use and well-being in Pakistan

*DIGITAL HEALTH* 9. doi:10.1177/20552076231186075

- **Instrument and ladder rung** — **Rung 1 (vendor aggregate), collected as photographs.** Both
  vendor dashboards, transcribed by hand: "participants were asked to provide the **screenshots of
  their Screen Time and Digital Well-being applications** […] Upon receiving the requested
  screenshots (see Figure 1 for examples), **we manually logged the data in a spreadsheet**"
  (Methods → Independent variables). No research logger, no event stream, no device access. Sample
  is ~90% Android per the paper's own note on Pakistani smartphone ownership.
- **Session threshold** — NOT STATED. The construct is a daily total; sessions never appear.
- **Episode reconstruction rule** — **NOT STATED, and structurally unavailable.** The authors never
  hold an event log, so no rule exists to declare; whatever Apple and Google each do internally to
  produce a "screen time" number is inherited unexamined, and the paper pools the two vendors'
  numbers into one variable without discussing their comparability.
- **System-app / launcher filtering** — NOT STATED (not applicable at this rung — the vendor decides).
- **Window, exclusions, aggregation** — Window: the vendor apps' 7-day view; the matching self-report
  asks "Over the past 7 days, including today, about how much time per day (on average)…". Exclusions
  are unusually well documented: from 714 clicks → removal of incomplete responses and those
  "who reported unrealistically high daily smartphone usage (18 h or more)" → 427; minus 181 who had
  never enabled Screen Time / Well-being → 246; minus 33 who shared nothing, 9 who uploaded
  irrelevant images, and 25 who "donated data but not the ones requested (e.g. providing a screenshot
  of battery usage or their network data usage)" → **final N = 179**. Aggregation: means (logged
  M = 5.95 h/day, SD = 2.45).
- **Availability** — Pre-registration only: `https://osf.io/hmfcy/` (view-only link in the paper).
  A supplemental `.docx` is deposited. No processed data and no processing code, which is consistent
  with there being no processing code — the pipeline was a person reading a screenshot.

**Access: full text** (PubMed Central `PMC10345932`, EuropePMC full-text XML; CC BY-NC-ND).

---

## 13. Ellis, D. A. (2019) — Are smartphones really that bad? Improving the psychological measurement of technology-related behaviors

*Computers in Human Behavior* 97, 60–66. doi:10.1016/j.chb.2019.03.006

**This is a conceptual / measurement-critique paper, not a log study.** It collects no smartphone
data of its own; its empirical content is Table 1 (a census of self-report instruments published
2004–2018) and Table 2 (a summary of studies that validated self-reports against objective
behaviour). Fields 1–5 below are therefore *not applicable* rather than *not stated*, and it would
be a category error to score it as a study that failed to declare a reconstruction rule.

- **Instrument and ladder rung** — N/A (no data collection). The paper *discusses* instruments across
  rungs, and notes the vendor-aggregate turn then underway: "Apple and Google are now providing more
  objective data that can be used directly by researchers, but these approaches alone will not
  capture the complexity of psychological processes associated with everyday technology use" (§4.2).
- **Session threshold** — N/A.
- **Episode reconstruction rule** — N/A. Worth noting for our argument that the paper's own
  vocabulary for what gets measured stays at the level of aggregates and counts — "exposure to
  general (e.g., hours of smartphone use) or specific use (e.g., hours of Facebook use on a device)"
  (§3) — and the intermediate step from events to episodes is never named as a decision at all, even
  in a paper whose subject is measurement decisions.
- **System-app / launcher filtering** — N/A.
- **Window, exclusions, aggregation** — N/A. Table 2 does record the measurement window of each
  validation study it reviews (e.g. Andrews et al. 2015, N = 23, 14 days).
- **Availability** — N/A for data. The paper does argue for it: "it is essential that results and
  research materials are openly available for all researchers to scrutinize and build upon. Generally,
  research that focuses on the effects of technology are single studies that do not engage with
  pre-registration or the sharing of data" (§4.2). It also flags instrument decay — "the smartphone
  framework originally used to collect data is no longer actively maintained" (§4.2).

**Access: full text** (Lancaster EPrints `131808`, submitted/author version, `manuscript_2_.pdf`;
29 pp. including tables and references). Note this is the **submitted** version, not the version of
record, so pagination and any copy-edited wording differ from the CHB article.

---

## 14. Ellis, Davidson, Shaw & Geyer (2019) — Do smartphone usage scales predict behavior?

*International Journal of Human-Computer Studies* 130, 86–92. doi:10.1016/j.ijhcs.2019.05.004

**Also primarily a measurement-critique paper**, but unlike entry 13 it *does* collect behavioural
data — so the six fields apply, and the answers are almost uniformly "vendor decides".

- **Instrument and ladder rung** — **Rung 1 (vendor aggregate).** "This takes advantage of a recent
  iOS update from Apple, which automatically logs a series of behavioral metrics related to 'screen
  time' over a period of seven days. Data available includes the length of time users spend on their
  devices, the number of times the phone is picked up, alongside the number of notifications received
  daily" (§1). Delivery was participant-mediated: "participants **transferred their latest Screen
  Time capture data** from Apple's Screen Time app" (§2.3). iPhone 5 or above, latest iOS, N = 238.
  Android users were excluded by design, a limitation the paper acknowledges in §4.1.
- **Session threshold** — NOT STATED. The three metrics (screen time, pickups, notifications) are
  vendor-defined daily totals and counts; the paper does not ask what a "pickup" is, or what interval
  separates two of them.
- **Episode reconstruction rule** — **NOT STATED.** The word "screen time" is used as a primitive
  throughout. The closest the paper comes to acknowledging the layer is a limitation about temporal
  granularity, not about construction: "this study uses daily tracking rather than finer grain
  temporal measurements based on hourly patterns of usage" (§4.1).
- **System-app / launcher filtering** — NOT STATED (not applicable at this rung).
- **Window, exclusions, aggregation** — Window: seven days, reduced to six by an explicit and
  well-reasoned rule — "Data were available for the previous seven days, however, the day of data
  collection is naturally incomplete, so **all behavioral metrics are based on an average from six
  complete days** of data from each participant" (§3.2). The choice is justified by citation
  (Wilcockson et al. 2018: five days for typical usage, two for pickups) and checked with one-way
  ANOVAs for weekday effects (all *p* > .2). Aggregation: **means** (per-participant daily averages,
  then sample means; plus *k*-means clustering into high/low usage groups).
- **Availability** — No data-availability statement appears in the accepted manuscript I read; §6 is
  a funding disclaimer only. Supplementary materials are referenced in-text (§3.4, cluster
  membership). A PsyArXiv preprint of the work is recorded against the article in OpenAlex
  (doi:10.31234/osf.io/6fjr7). No processing code — again consistent with there being none.

**Access: full text** (University of Bath research portal / `purehost.bath.ac.uk`,
`manuscript_final.pdf`, 10 pp.; OpenAlex flags this location as the published version). A second
copy exists at Lancaster EPrints `133310`.

---

## 15. Festic, Büchi & Latzer (2021) — How Long and What For? Tracking a Nationally Representative Sample to Quantify Internet Use

*Journal of Quantitative Description: Digital Media* 1. doi:10.51685/jqd.2021.018

The single most informative entry in this lane about *where the reconstruction rule goes when nobody
owns it*: durations arrive pre-computed from a commercial panel vendor.

- **Instrument and ladder rung** — **Rung 3 in kind (app/URL-level event logging with per-event
  durations), but the durations are vendor-computed, not researcher-computed.** Desktop/laptop
  vendor is named: "For the desktop and laptop tracking data, we relied on a **passive metering
  solution by Wakoopa**" (Sample). The **mobile** vendor is *not* named — participants "were already
  part of a mobile (smartphone or tablet) tracking panel" recruited via LINK. Logged fields are
  enumerated: "The collected variables were the URL of a visited webpage (desktop and mobile) or name
  of a used app (mobile only), **duration** and time of the visit, device, and operating system used"
  (Data collection). Note that *duration is an input field, not a derived one*.
- **Session threshold** — NOT STATED. There is no session construct anywhere in the paper; the unit
  is the "tracked event (i.e., a site visit)".
- **Episode reconstruction rule** — **NOT STATED for how a visit's duration was produced** — that
  belongs to Wakoopa and to the unnamed mobile vendor. What *is* declared is a foreground criterion
  and a zero-duration filter, both quotable and both load-bearing:
  > "It is important to note that the tracking software measured **active use** of applications or
  > websites, meaning the app or browser window was **in the foreground**. Therefore, our use data
  > corresponds to the time that users spent on these respective apps or websites but does not
  > reflect, for example, the time the participants were available to receive a message or a call on
  > WhatsApp." (Measures)

  > "At the level of tracked events (i.e., a site visit), we **removed all events with 0 seconds of
  > usage time** (N<sub>tracked events</sub> = 233'675) because these reflect automatic redirects and
  > were not part of the participants' actual internet usage; the passive metering software recorded
  > any visited URL regardless of the time spent on it." (Sample)

  233,675 discarded events out of a final 13,252,235 — a preprocessing decision with a reported
  magnitude, which is more than most entries in this lane manage.
- **System-app / launcher filtering** — NOT STATED. No app-exclusion list; conversely the "major
  services" measure is built by **inclusion**: "The measure for the use of major services was
  calculated by **filtering the tracking data for the occurrence of these apps and websites**"
  (Google Search, YouTube, WhatsApp, 20 Minuten, Facebook, Instagram).
- **Window, exclusions, aggregation** — Window: field phase November 2018 – January 2019; per-participant
  tracking "varied between 30 and 120 days", and each participant's total is normalised by their own
  tracked-day count. Exclusions: 51 participants "who were tracked for fewer than the thirty days
  planned in the study design"; 2 "extreme outliers who reported more than 17 hours of internet usage
  per day for reasons of plausibility". Final N = 923 participants / 13,252,235 events, from an
  initial 1,202-respondent sample representative of Swiss internet users 16+. Aggregation: **means** —
  "Data analysis relied on descriptive statistics and particularly on **mean score comparisons**
  between different social groups in R."
- **Availability** — Analysis code only, and only the R script: "The R script for the analysis and the
  detailed results are available at: `https://osf.io/j5mhn/?view_only=7e82e560f19945d4bbbae168cbbcde3e`"
  (footnote 1). The raw traces are panel-vendor data and are not shared. **The step that would matter
  most for reproducing the numbers — Wakoopa's event-to-duration logic — is neither published nor
  publishable.**

**Access: full text, published version** (diamond OA; `journalqd.org/article/download/2553/1804`).

---

## 16. Hamilton, Dreier, Caproni, Fedor, Durica & Low (2024) — Improving the Science of Adolescent Social Media and Mental Health

*Journal of Technology in Behavioral Science* 10(2), 301–319. doi:10.1007/s41347-024-00443-5

A methods paper about processing decisions in mobile sensing — which makes what it omits the
sharpest finding in this lane.

- **Instrument and ladder rung** — **Rung 3 (app-level event logging research app): AWARE, Android
  only, `applications foreground` sensor; processed with RAPIDS.** "we chose to use the **AWARE app**,
  an open-source mobile sensing application, because there is reproducible pipeline for processing
  AWARE data" and "AWARE passively collects multiple sensors (e.g., accelerometer, communication
  (messages/calls), and screen (on/off)), but **'applications foreground' is the primary sensor used
  to sense application usage patterns** (Ferreira et al., 2015)" (Participants and Procedure).
  Processing: "Mobile sensing data collected using AWARE was processed using the **Reproducible
  Analysis Pipeline for Data Streams (RAPIDS**; Vega et al., 2021)" (Behavioral Feature Extraction).
- **Session threshold** — NOT STATED. No inactivity timeout, no session concept. The temporal
  primitive is an **hourly bin**, chosen and defended: "hourly bins were selected to capture
  behavioral features of application use (and other sensors) in any given hour across the entire
  study period per participant […] However, different time bins may yield different results, and
  warrants further examination in future research."
- **Episode reconstruction rule** — **NOT STATED. This is the finding.** The paper selects a
  *derived feature* by name and delegates its definition to an external URL:
  > "Our team examined the **'sum duration'** and **'count event'** features; these two features most
  > closely align with prior literature on social media (i.e., 'social media screen time/duration'
  > and frequency of checking). Importantly, 'count event' is more appropriate than count episode.
  > Specifically, **count event features count the unique number of times an adolescent opened an
  > application in each time bin** (e.g., each hour). On the other hand, count episode features
  > detects only whether or not an adolescent opened a given application during a given time bin."
  > (Behavioral Feature Extraction of Social Media)

  The paper distinguishes *event* from *episode* — it is aware the distinction exists — and then
  points to `https://www.rapids.science/1.9/features/phone-applications-foreground/` rather than
  stating how a foreground event stream becomes a summed duration. A paper explicitly devoted to
  "decision points that must be made about how to process and extract the behavioral data"
  (Discussion) enumerates binning, missingness, and app categorisation, and never enumerates this one.
- **System-app / launcher filtering** — NOT DECLARED as an exclusion. The analysis instead proceeds by
  **inclusion** into social-media categories, and the paper turns the categorisation choice into a
  result: 645 unique apps observed; four competing definitions (research-coded Social Networking = 20
  apps; research-coded Broad Social Media = 41; Google Play Store's own "social" category = 26;
  Pew "popular social media" = 9). The Play Store category diverges materially — "Play Store-defined
  social media category was the lowest in daily sum duration (60 min) and checking frequency (123
  checks), and least similar to the other three domains by about 30 min per day". No statement about
  home screens, system UI, or launchers.
- **Window, exclusions, aggregation** — Window: "The study length was approximately one month (31
  days)"; March–November 2020; N = 19 adolescents (13–18), all Android by requirement. Data-validity
  rule is declared precisely and is the paper's best contribution to our argument:
  > "For this study, we considered **any hour with at least 30 min of AWARE data to be a valid hour**
  > in which 0.00 min of application use was considered to reflect actual app use; app use was marked
  > as 'NA' for hours during which AWARE was running for less than 50% and for which no app usage was
  > captured." (Application Data Extraction and Processing)

  And, candidly: "**No matter the threshold researchers set, this necessarily introduces some bias.**"
  (Discussion). Aggregation: means at three levels — between-person (N = 19), daily (N = 564), hourly
  (N = 10,038) — plus ICCs and `rmcorr` within-person correlations. Attrition: one participant
  withdrew at day 15; AWARE captured data 74% of enrolled time.
- **Availability** — Code on request, data never: "Participants did not consent to data availability;
  however, **data analysis code are available upon request**." (Data Availability). RAPIDS itself is
  public, so the reconstruction rule is *discoverable* — but it is discoverable in a third-party
  pipeline's documentation at a pinned version, not in the paper.

**Access: full text** (PubMed Central `PMC12144053`, EuropePMC full-text XML; hybrid OA, Springer).

---

## 17. Hartanto, Lee, Chua, Quek & Majeed (2022) — Smartphone use and daily cognitive failures

*British Journal of Psychology* 114(1), 70–85. doi:10.1111/bjop.12597

**Transcription/record notes.** (a) The preprint's list dates this 2022; Crossref's online-publication
date is 2022-09-14 and the SMU repository record labels it 2-2023 for the 114(1) issue. Same paper.
(b) **OpenAlex returns the wrong record for this DOI** — `api.openalex.org/works/doi:10.1111/bjop.12597`
resolves to a 2014 materials-science paper about PbTe nanocrystal superlattices. Crossref and
Semantic Scholar both resolve it correctly. Anyone re-running this chase through OpenAlex alone will
mis-score this entry.

- **Instrument and ladder rung** — **Rung 1 (vendor aggregate), delivered as daily screenshots.**
  "Objective smartphone screen time and smartphone checking for seven days were assessed and tracked
  via the **inbuilt iOS Screen Time Application Programming Interface** (Apple Inc., 2019), which has
  been shown to be reliable and valid (Ohme et al., 2021). During the daily diary study, participants
  were required to provide screenshots of (i) total screen time, (ii) screen time for each category,
  and (iii) smartphone checking" (Method → Objective Smartphone Use). iPhone-only by design: "In
  order to standardize the screen time tracking system across all participants, we used data from a
  subset of 183 participants who used an iPhone."
- **Session threshold** — NOT STATED. "Smartphone checking" is taken directly from Apple's pickup
  count; what interval Apple requires between two pickups is never asked.
- **Episode reconstruction rule** — **NOT STATED.** No event log exists in this design. The nearest
  thing to a processing rule is a *category* rule, and it is declared: "Based on the application, we
  collected screen time for 11 categories […] Applications were **by default classified into these
  categories when developed and uploaded in the App Store**. All of our participants were required to
  use the default categorization to ensure comparability." Eleven Apple categories were then collapsed
  by the authors into six (entertainment+games → one; four productivity-ish categories → "tools"). So
  the taxonomy is App Store developer self-declaration, re-binned by the researchers — an explicit
  decision, well documented, sitting on top of an undocumented one.
- **System-app / launcher filtering** — NOT STATED (not applicable at this rung; "Others" catches
  the remainder, e.g. Safari).
- **Window, exclusions, aggregation** — Window: 7 daily-diary days, with screenshots collected across
  **eight** days so that a full week of complete days is captured (participants scroll back one or two
  days in Screen Time depending on when they answered). N = 261 recruited → 183 iPhone users → 181
  after two exclusions (one withdrawal; one participant "reported sharing his smartphone with friends
  and family"), giving 1,230 daily observations, M = 6.80 days per participant, 97.08% response rate.
  Aggregation: **multilevel modelling** with within-person centring — notably *not* a
  collapse-to-a-mean design, which puts this entry ahead of most of the lane on the analysis side
  while being at the bottom rung on the measurement side.
- **Availability** — Declared and real: "Data and analytic code have been made publicly available on
  **Researchbox (#628; https://researchbox.org/628)**." (Data Availability Statement). The shared
  code operates on hand-transcribed vendor totals, so it cannot document a reconstruction rule either.

**Access: full text** (Singapore Management University institutional repository,
`ink.library.smu.edu.sg/soss_research/3667`, author final version PDF; CC BY-NC-ND). The publisher
version at Wiley is closed — Unpaywall and Semantic Scholar both report `closed`/`green`, and the
SMU host serves the accepted manuscript.

---

## 18. Hodes & Thomas (2021) — Smartphone Screen Time: Inaccuracy of self-reports and influence of psychological and contextual factors

*Computers in Human Behavior* 115, 106616. doi:10.1016/j.chb.2020.106616

**Paywalled.** Unpaywall: `is_oa: false`, `oa_status: closed`, zero OA locations. OpenAlex: one
location, the closed publisher landing page. Semantic Scholar: `CLOSED`, empty PDF URL. OpenAIRE
returns no full-text link. No repository copy at any of the four services. This is a normal outcome
and I did not attempt to route around it.

- **Instrument and ladder rung** — **Rung 1 (vendor aggregate), two different vendor surfaces,**
  per the abstract: participants "shared screenshots of their **battery use (BUS)** and **iPhone
  screen time (iOS STT)** data". iPhone-only. Battery-use statistics and Screen Time are two distinct
  Apple aggregations with different construction rules, and the abstract reports that they disagree
  in *direction*: "Whereas the BUS data […] indicated that self-reports **underestimated** actual use,
  the iOS STT data […] indicated that self-reports **overestimated** actual use (ps < .007)". That
  disagreement — same participants, same phones, two vendor aggregates, opposite conclusions about
  the paper's headline question — is a Lane 2 finding worth citing on its own, and it is visible
  from the abstract alone.
- **Session threshold** — NOT ESTABLISHED (Method not read).
- **Episode reconstruction rule** — NOT ESTABLISHED (Method not read). At this rung the rule belongs
  to Apple in both cases and differs between the two surfaces, which is precisely why the two
  measures diverge; the abstract does not say the authors investigated why.
- **System-app / launcher filtering** — NOT ESTABLISHED (Method not read).
- **Window, exclusions, aggregation** — From the abstract: N = 267, aged 18–25; "the BUS data
  (**10-day average, including two weekends**)" versus "the iOS STT data (**7-day average**)"; a
  subsample (n = 24) re-shared BUS data during COVID-19 lockdown. Aggregation: averages. Exclusion
  criteria: NOT ESTABLISHED.
- **Availability** — NOT ESTABLISHED.

**Access: abstract only** (Semantic Scholar `abstract` field for the DOI; Crossref carries no
abstract for this record). Publisher full text is paywalled; recorded as closed.

---

## 19. Horwood, Anglim & Mallawaarachchi (2021) — Problematic smartphone use in a large nationally representative sample

*Computers in Human Behavior* 122, 106848. doi:10.1016/j.chb.2021.106848

**Effectively paywalled, despite a green-OA flag.** Unpaywall and Semantic Scholar both point to a
single "repository" location: figshare item `20669448`, which is the Deakin University DRO record.
Querying that item through the figshare API returns `"files": null` — **the record is metadata-only,
with no deposited manuscript** (its `description` field is just the article title). The DRO landing
page returned an empty body to `curl`. So the green-OA status in the aggregators is a false positive:
there is no readable copy at the advertised location.

- **Instrument and ladder rung** — **Rung 1 (vendor aggregate), both platforms**, per the abstract:
  "amount of smartphone use was self-rated and objectively measured using smartphone screen time
  reporting tools (**Screen Time for iOS and Digital Wellbeing for Android**)". As with entry 12,
  two vendors' numbers are combined into one variable; whether the paper addresses their
  comparability is NOT ESTABLISHED.
- **Session threshold** — NOT ESTABLISHED (Method not read).
- **Episode reconstruction rule** — NOT ESTABLISHED (Method not read); structurally vendor-owned at
  this rung.
- **System-app / launcher filtering** — NOT ESTABLISHED (Method not read).
- **Window, exclusions, aggregation** — From the abstract: n = 1164 Australian adults, 50.7% female,
  age M = 44.9 (SD = 16.3), described as nationally representative. Measurement window length,
  exclusions, and mean-vs-median: NOT ESTABLISHED. The design appears cross-sectional (a single
  survey with a screen-time reading), but I did not read the Method and am not asserting it.
- **Availability** — NOT ESTABLISHED. The one advertised OA deposit contains no file.

**Access: abstract only** (Semantic Scholar `abstract` field for the DOI). Publisher full text is
paywalled; the repository record is empty. Recorded as closed.

---

## 20. Jones, Ferreira, Hosio, Goncalves & Kostakos (2015) — Revisitation analysis of smartphone app use

*UbiComp '15*, 1197–1208. doi:10.1145/2750858.2807542

The AWARE authors' own app-level study, and the entry the brief flagged for extra care. It rewards
it: **this dataset contains no durations at all**, and the paper says so plainly enough that you can
reconstruct exactly what was and wasn't measured.

- **Instrument and ladder rung** — **Rung 3 (app-level event logging research app): AWARE, wrapped in
  a public Play Store app called Securacy.** "We built a free application, **Securacy**, that allowed
  participants to monitor overall network activity on their mobile phones" and, decisively:
  > "For our purposes, the application used the **AWARE** framework to log a new record **every time
  > a user launched an application**. The entry included a timestamp (in the time zone of the
  > participant), a unique ID for the participant, a unique package name assigned to the application
  > by the developer, and the localized application name." (Method)

  A launch timestamp, a participant ID, a package name, a label. **No stop event, no end timestamp,
  no duration field.** Android only; tablets excluded. Recruited in the wild via the Play Store,
  Facebook and Twitter, with no compensation — 165 participants, 41% Europe / 53% North America /
  6% other.
- **Session threshold** — **Two thresholds are stated, and neither is an inactivity timeout.**
  (a) A *session boundary* defined by screen state, not by a gap: "This analysis focuses on single
  'sessions' of use: for each session we only consider the set of applications that were used
  **between unlocking and locking the phone**." (b) A *pop-up suppression* threshold with an explicit
  empirical justification:
  > "any return to an app from a recognized pop-up app **within 30 seconds** is not treated as a
  > revisit when constructing the revisitation curve. Pop-ups that appear for longer than 30 seconds
  > are treated as significant switches away from an application, given that 50% of smartphone
  > engagement itself lasts less than 30 seconds [36]." (Deriving Revisitation Curves)

  Thirty seconds is *cited* to prior work (Yan et al.), which is more justification than any other
  entry in this lane offers for any threshold.
- **Episode reconstruction rule** — **NOT STATED, because none was needed — and that is the point.**
  The entire analysis is built on **inter-launch intervals**, never on episode durations:
  "We construct a revisitation curve for a certain application by considering the **duration between
  revisits** to that application by users" — i.e. the gap between two launches, not the length of a
  use. The 15 exponentially spaced bins (1, 2, 4, 8, 16, 32 minutes; 1, 2, 4, 8, 16, 32, 64, 128, 256+
  hours) are all inter-visit intervals. The in-session analysis encodes each session as a string of
  F (forward, first visit) and B (backtracking, revisit) characters and reports *counts of app
  launches per phase*, never minutes. **A Rung 3 instrument, run by the authors of the logging
  framework, that never produces an episode duration at all** — so the field's most-cited early
  app-level paper contributes zero evidence about the event-to-episode step.
- **System-app / launcher filtering** — **DECLARED, but no list is published.** Two rules, both
  quotable:
  > "In our analysis we **ignore apps that are core to Android OS (e.g. the home screen and system
  > UI), or a means to launch other applications**. We found that many of the participants had
  > installed skinned UIs and application launchers to replace parts of the standard Android OS.
  > **For these users we also ignore such system-wide applications.**" (Method)

  Per-user launcher detection, no enumeration of which packages were dropped, no criterion for
  "core to Android OS", and no reproducible list — so the filter cannot be re-applied by anyone else.
  The Discussion confirms the filter changed what could be compared to prior web work: "the UI or a
  popular application launcher, however we decided to **filter these applications from our analysis**
  due to their peculiar functionality."
- **Window, exclusions, aggregation** — Window: **3 months**; 199,859 launch events across 1,527
  unique applications. Exclusions, all declared: "we **removed the users with fewer than 10 days of
  logged activity**"; "we also only analyse the revisitation patterns for **apps that are installed
  by more than a single participant**" (≈1,400 apps); and separately "we excluded **36 users** because
  they did not have enough revisits (fewer than 10 app revisits in total) or did not participate in
  the study for longer than the maximum bin (10 days)". Aggregation: normalised 15-bin histograms
  (revisitation curves) as feature vectors, *k*-means clustering with an elbow criterion on
  within-groups sum of squares, χ² for the user×app-cluster association, and **means** for phase
  lengths in launch counts.
- **Availability** — NOT STATED. No data-availability statement, no repository, no code link in the
  version I read. The AWARE framework itself is cited at `www.awareframework.com`; Securacy is cited
  to a separate paper. Neither substitutes for the analysis code, and the F/B string encoding plus the
  "recognized pop-up app" list are both unreproducible without it.

**Access: full text** (University of Bath research portal / `purehost.bath.ac.uk`,
`file505_1.pdf`, 10 pp.). The version is explicitly the accepted manuscript — the PDF states "This is
a **pre-copy-editing, author-produced PDF** of an article accepted for publication in UbiComp '15" —
so wording may differ trivially from the ACM DL version of record, which is not open access.

---

## Lane 2 summary

**Full text obtained: 7 of 10.** Entries 12, 13, 14, 15, 16, 17, 20. Routes: PubMed Central /
EuropePMC (12, 16), institutional repositories — Lancaster, Bath ×2, SMU (13, 14, 17, 20), diamond-OA
publisher (15). Of these, 4 are accepted manuscripts rather than versions of record (13, 14, 17, 20).

**Abstract only: 3 of 10.** Entries 11, 18, 19.
- 18 and 19 are ordinary paywalls at Elsevier — a normal outcome.
- **11 is not.** It is flagged open access with a `public-domain` license by Unpaywall, OpenAlex and
  Semantic Scholar, and the *only* location any of them lists is a SAGE URL behind a Cloudflare
  JavaScript challenge. No repository copy exists anywhere. An openly licensed paper that no
  non-browser client can read is, functionally, closed.
- **19's green-OA flag is a false positive:** the figshare/Deakin DRO item that Unpaywall and
  Semantic Scholar both point to has `"files": null` — a metadata stub with no manuscript.

**Session threshold declared: 1 of 10 — and it is not an inactivity timeout.** Only entry 20 states
any threshold: a screen-state session boundary (unlock → lock) plus a **30-second** pop-up
suppression rule, the latter justified by citation. Entry 16 states an *hourly bin* and a **50%
data-yield** validity threshold, which are missingness rules, not session rules. The other eight
state nothing.

**Episode reconstruction rule declared: 0 of 10.** Not one entry in this lane states how raw device
events become episodes with durations. The ways of not stating it are distinct and worth separating
in the paper:
- **Rungs 1 (five entries: 12, 14, 17, 18, 19)** — no event log is ever held, so the rule is Apple's
  or Google's and is not merely undeclared but unavailable. Three of these five (12, 18, 19) combine
  *two different vendor surfaces* into one variable, and entry 18's abstract reports that the two
  surfaces disagree about the direction of the self-report bias.
- **Rung 3, vendor-metered (15)** — the researchers hold per-event durations but did not compute
  them; Wakoopa did, and the mobile vendor is not even named. They declare what they *did* do
  (foreground-only, drop 0-second events, N reported) and nothing about the step that produced the
  seconds.
- **Rung 3, researcher-pipelined (16)** — the rule exists, is open source, and is delegated by URL to
  RAPIDS rather than stated.
- **Rung 3, no durations at all (20)** — the question never arises, because the instrument logs only
  launch timestamps.

**Ladder rungs.** Rung 4: **0**. Rung 3: **3** (15 vendor-metered, 16 AWARE+RAPIDS, 20 AWARE/Securacy).
Rung 2: **0**. Rung 1: **5** (12, 14, 17, 18, 19). Not applicable — conceptual/critique paper with no
data collection: **1** (13). Undetermined: **1** (11, blocked at the abstract). Half of this lane is
vendor aggregates, and the vendor-aggregate share is concentrated in the psychology journals
(*Digital Health*, *IJHCS*, *BJP*, *CHB* ×2), while all three event-logging studies come from HCI /
digital-phenotyping venues.

**What surprised me.**

1. **Entry 16 (Hamilton et al. 2024) is the strongest single data point for the thesis.** It is a
   paper *whose explicit subject is processing decisions* in adolescent mobile sensing. It devotes
   sections to time-bin choice, to the NA-versus-zero missingness decision, to a 50% data-yield
   threshold, and to four competing definitions of "social media" that it shows move the headline
   estimate by ~30 min/day. It even distinguishes "count event" from "count episode" in so many
   words — so the authors know episodes are a construct. And then it takes "sum duration" from
   RAPIDS by name and never says what a duration is. If a methods paper that self-consciously
   enumerates its degrees of freedom still doesn't see this one, "undeclared" is not an oversight
   by careless authors — it is a blind spot in what the field counts as a decision.

2. **Entry 20 (Jones et al. 2015) has no durations in it whatsoever.** I expected the AWARE authors'
   own study to be the one entry that documented the event-to-episode step. Instead their logger
   writes one row per app launch — timestamp, participant, package, label — with no stop event, and
   the whole paper is built on inter-launch *gaps*. The oldest, most methodologically self-aware
   app-level paper in this lane sidesteps the question entirely by choosing a metric that doesn't
   need it. It also declares a system-app/launcher filter, per-user, with **no published list** — the
   filtering degree of freedom is visible and still unreproducible.

3. **Entry 18 (Hodes & Thomas 2021) gives us a natural experiment for free, from its abstract alone.**
   Same participants, same iPhones, two Apple aggregates (battery use vs Screen Time), two different
   measurement windows (10-day vs 7-day) — and the two produce *opposite* answers to the paper's
   central question of whether people over- or under-report. That is the multiverse operating one
   rung below where Winklbauer & Batinic started, observed accidentally in 2021.

4. **Entry 11 is open access and unreadable.** Worth one sentence in the paper: the field's access
   metadata (Unpaywall, OpenAlex, Semantic Scholar) can assert `is_oa: true` with a `public-domain`
   license for an article that no programmatic client can retrieve, and can assert green OA (entry
   19) for a repository record containing no file. Anyone auditing this literature at scale will
   silently mis-score both cases.

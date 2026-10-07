# SLICE F — self-report vs logged discrepancy

> **Independent expansions (2026-08-05 and 2026-08-06):** The appended passes retain **90 sources**—the prior 68, F69–F84 from the second direct-field pass, F85–F89 from the first Pro reconciliation, and F90 from the fresh Pro-discovery delta. The expanded evidence shows that inclusion, completeness, device universe, temporal window, vendor category coverage, transcription, selective missingness, and trigger/outcome observability can change the discrepancy itself.

**Agent scope.** Slice F only: the self-report/log discrepancy literature, filtered hard for work that
attributes part of the discrepancy to the **processing of the log** rather than to human recall.
Papers that only measure the gap and blame memory are counted in §3, not written up.

**Hard-rule compliance.** No browser automation was used. All retrieval was `WebFetch`, `WebSearch`,
and `curl` (plus local `pdftotext` on PDFs that `curl` returned). Publisher blocks are recorded in §6
as findings. No value below is inferred: every quoted string was read in a retrieved document, and
every paper I could not open in full is marked UNDETERMINED with the access route that failed.

---

## 1. Papers kept — the processing-attribution finds

### 1. Ernala, Burke, Leavitt & Ellison (2020) — *How Well Do People Report Time Spent on Facebook? An Evaluation of Established Survey Questions with Recommendations*, CHI 2020

- **Why it matters here.** **Citation threat, rank 1 for this slice, and the single most useful paper
  I found.** This is a self-report/log discrepancy study that (a) states its event→episode rule in
  full, (b) runs a *sensitivity analysis over the session threshold*, and (c) explicitly names log
  processing as one source of the discrepancy — then estimates its share. It is the closest thing in
  this literature to the thing our paper says nobody does. It is also a proof that the practice is
  possible: it is a first-party industry log, which is exactly why the rule could be stated.
- **Instrument and ladder rung.** Facebook first-party **server** event logs (click / scroll / type /
  navigation events, foreground state), N = 49,934 across 15 countries, July 2019. Not a device
  platform log, so the ladder does not map cleanly: it is a **Rung-4 analogue** — a raw event stream
  with *declared* semantics — rather than a device API. Comparison measures are ten self-report survey
  items.
- **Episode reconstruction rule.** **DECLARED, in full, in the running text.** METHODS §"Server Log
  Data of Time Spent":
  > "Time spent was calculated as follows: when a person scrolled, clicked, typed, or navigated on the
  > Facebook app or website, that timestamp was logged. When a person switched to a different app or
  > browser tab or more than 30 seconds passed without a click, scroll, type, or navigation event, time
  > logging stopped at the last event. For each of the 30 days, two data points were included: daily
  > minutes, the number of minutes they spent in the foreground of the desktop or mobile versions of
  > Facebook.com or the Facebook mobile app, and daily sessions, the number of distinct times they
  > logged in or opened one of those surfaces, at least 60 seconds after a prior session."

  Note the structure: an **opening event class**, a **closing event class** (app/tab switch), an
  **idle timeout** (30 s) that closes the episode *retroactively at the last event* rather than at the
  timeout instant, and a **separate, larger session-merge gap** (60 s). Two different thresholds for
  two different derived quantities, both stated.
- **Session threshold.** Two, both stated, and the second is *tested*:
  - Duration timeout: **30 seconds** of no click/scroll/type/navigation (inactivity gap).
  - Session-count gap: **60 seconds** since the prior session (inactivity gap).
  - Verbatim sensitivity check, same section: *"Accuracy results were qualitatively similar using
    sessions at least 300 seconds apart."*
  - A second inclusion decision is likewise tested: *"Daily minutes and sessions did not include the
    use of the chat client, Facebook Messenger… We repeated the analyses with and without Messenger
    time and determined that including Messenger did not qualitatively change results."*
  - **Justification for the specific values: none given.** No citation, no derivation, no reference to
    a prior threshold. The values are asserted; only their *robustness* is tested. That asymmetry
    (robustness reported, provenance absent) is itself a finding for our paper.
- **Processing attribution — the rare thing, verbatim.** §"Limitations and Future Work":
  > "Second, server logging can be technically complex. Because people may use different devices
  > throughout a day, aggregating at the user level is complicated and may miss use occurring on other
  > people's phones (e.g., borrowing) or when people jump between multiple devices connected at the
  > same time. Operating system and device-specific differences may slightly impact time and session
  > logging as well. Thus, some of the discrepancies between self-reports and server-log data may be
  > the result of logging, though this is likely small in proportion to errors due to human recall."

  The final clause is the field's default posture stated out loud, and it is asserted without a
  quantity — they do not measure the share they are dismissing.
- **Second attribution, to the *construct* rather than the pipeline.** §"Sources of Error in
  Self-Reported Time Spent" / "Mental Models of Time Spent" — participants and researchers do not
  agree on what the rule *should* be:
  > "…from Facebook while others might only count time they actively scrolled through posts or typed
  > comments. Some may include the time spent on messaging, depending on whether they are on a device
  > that incorporates it as a separate application or not. For people who do not use Facebook every
  > day, some may estimate their average use across the past week by including only days in which they
  > opened the app; others may include zeros for days of non-use."

  This is the human-side mirror of the machine-side rule: the respondent is also running an
  undeclared reconstruction rule.
- **Availability.** Data: no. Server-log data are proprietary and de-identified in aggregate; there is
  no third-party re-run path. Code: none published. The event→episode step is **not** re-runnable by a
  third party — the rule is legible but the substrate is not. There is an OSF record (`osf.io/c5yu9`,
  not retrieved).
- **Access.** **Full text read**, via the authors' hosted PDF at
  `thoughtcrumbs.com/publications/ernala_burke_leavitt_ellison_how_well_can_people_report_CHI2020.pdf`
  (curl + pdftotext). ACM DL (`dl.acm.org/doi/fullHtml/10.1145/3313831.3376435`) returned **HTTP 403**
  to WebFetch.

---

### 2. Parry, Davidson, Sewall, Fisher, Mieczkowski & Quintana (2021) — *A systematic review and meta-analysis of discrepancies between logged and self-reported digital media use*, Nature Human Behaviour 5, 1535–1547

- **Why it matters here.** The field's anchor meta-analysis (106 effect sizes, 47 records). Two things
  matter for us. First, it *does* name a processing mechanism — background activity being logged as
  active use. Second, and more usefully, it **tested whether the logging method explains the
  heterogeneity and found that it does not** — which we should read carefully, because their moderator
  is "log collection method," a coarse instrument-class variable, **not** the event→episode rule. The
  null result is on a variable that could not detect our effect.
- **Instrument and ladder rung.** N/A — meta-analysis. It codes primary studies but does not extract
  their reconstruction rules; the coded moderator is the collection method only.
- **Episode reconstruction rule.** **ABSENT — and absent as a review category.** The eligibility
  criteria (Methods, §"Eligibility criteria") define the logged side purely by *what quantity* is
  reported, never by how it was derived from events:
  > "For general usage measures, we only considered comparisons between self-report measures that
  > concerned either the total or average duration (for example, minutes or hours) or volume (for
  > example, number of pickups, number of logins, number of phone calls, etc.) of media use and
  > equivalent logged measures for the same period (for example, daily, weekly, etc.)."

  "Equivalent logged measures" is doing enormous unexamined work. Nothing in the extraction scheme
  asks what a "pickup" or a "minute" was constructed from.
- **Session threshold.** N/A — none extracted, none discussed anywhere in the paper.
- **Processing attribution, verbatim.** Discussion:
  > "A particular concern with such methods is the possibility that some forms of usage tracking may
  > inadvertently log background activities as instances of active usage, thereby overestimating
  > active usage."

  And, immediately after, the field's posture again — the same move Ernala makes:
  > "Despite these potential biases and concerns with logging techniques, we share the belief that,
  > while 'client logs may not be perfect, they should be more reliable and less biased than
  > self-reports'."

  And an explicit call that our paper answers:
  > "…there is a need to further understand the validity of logged measures and continually develop
  > improved tools for quantifying media use."
- **The null moderator — quote and its exact scope.** Discussion:
  > "The results, however, indicate that both the reporting accuracy and the pooled correlation were
  > not moderated by the category of use, the population involved, the sampling approach or the log
  > collection method."

  Test statistics, Results: for the pooled correlation, *"nor the logging method adopted (F(3, 16.9) =
  1.4, P = 0.279)"*; for the ratio of means, *"nor the logging method (F(3, 14.5) = 2.85, P = 0.074)."*
  Four levels, k small. Residual heterogeneity stayed at *"T2 = 0.015, I2 = 89.78%"* (correlations) and
  *"T2 = 0.015, I2 = 91.22%"* (ratio of means). They say so themselves:
  > "Although moderator analyses were conducted to investigate this heterogeneity, they were largely
  > inconclusive—probably owing to the small number of studies present within each moderator level."

  **Read for our purposes:** ~90% of the between-study variance in this literature is unexplained, and
  the only processing-adjacent moderator anyone has tried is a four-level instrument-class variable
  that was underpowered. This is a hole shaped like our contribution, not a refutation of it.
- **Availability.** Data: **yes** — *"The raw and processed data are available on the Open Science
  Framework website (https://osf.io/dhx48/). These data include all extracted effect sizes,
  study-[level data]"*. Code: yes, R/tidyverse, on OSF and GitHub per the reporting summary. The
  *meta-analysis* is fully re-runnable; the primary studies' event→episode steps are not, because they
  were never extracted.
- **Access.** **Full text read** (including Methods and the Nature reporting summary), via the PDF
  mirrored at `gwern.net/doc/psychology/2021-parry.pdf`. `nature.com` bounced WebFetch through an
  `idp.nature.com` cookie-consent redirect loop and never served the article.

---

### 3. Verbeij, Pouwels, Beyens & Valkenburg (2021) — *The accuracy and validity of self-reported social media use measures among adolescents*, Computers in Human Behavior Reports 3, 100090

- **Why it matters here.** A discrepancy study on **Android platform logs** that (a) declares a
  screen-state gating rule applied to the app-usage stream — the same manoeuvre as our screen-gated
  crediting layer — and (b) attributes differential accuracy across platforms to the **temporal
  structure of the episodes** (fragmented vs. sustained use), which is an episode-level explanation,
  not a memory one.
- **Instrument and ladder rung.** **Rung 4.** Ethica App Usage Stream on 125 Android devices, three
  weeks, polling the OS log every 5 minutes, capturing **both** foreground app time **and** a separate
  timestamped screen-state stream. Compared against retrospective survey and ESM self-reports.
- **Episode reconstruction rule.** **DECLARED in outline, DELEGATED for the detail.** §4 Method,
  "Digital trace data":
  > "Every 5 min, this application retrieved the Android log data on adolescents' personal devices.
  > This data represented the foreground time of all applications, including Instagram, WhatsApp, and
  > Snapchat, which could be defined as the usage of the applications when the adolescents' phone was
  > unlocked. We also measured adolescents' screen state data throughout the day. This time-stamped
  > data showed us when adolescents had their phone screen turned on or off. To control for the
  > possibility that adolescents' phones still recorded app usage when apps were running in the
  > background while their phone screen was turned off, we excluded records of app use when
  > adolescents' screen was turned off (i.e., roughly 2% of app usage estimates). More details about
  > the cleaning process of the digital trace data can be found on OSF (https://osf.io/jkre2)."

  This is a **cross-stream gating rule**: the app-usage record is intersected with the screen-state
  record, and app time outside screen-on is dropped. It is stated, quantified (2%), and the remainder
  is delegated to an OSF page. That is materially better than the field norm and is the closest
  published relative of our `enable_screen_gated_crediting` path that this slice turned up.
- **Session threshold.** **None for episode construction.** No inactivity gap, no minimum duration, no
  maximum cutoff is reported. The only "threshold" in the paper is a *statistical* one — the convergent
  validity criterion *"we set the threshold for minimum acceptable convergent validity at r ¼ .50"*,
  justified by citation to **Carlson and Herdman (2012)**. (Recording it because the brief asks for
  threshold provenance chains, and this is an inheritance chain — just not of an episode threshold.)
- **Processing/structure attribution, verbatim.** Abstract:
  > "…they more accurately estimated their time spent on platforms that are used in a less fragmented
  > way (Instagram) than on platforms that are used in a more fragmented way (Snapchat)."

  Discussion, the mechanism:
  > "Adolescents typically use Instagram less frequently than Snapchat or WhatsApp, but when they use
  > Instagram, they use it for a longer time (van Driel et al., 2019). Consequently, it may be easier
  > for adolescents to accurately remember their time spent on Instagram than their time spent on
  > WhatsApp and Snapchat."

  This is halfway to our claim: they identify the **episode-length distribution** as the moderator of
  the discrepancy, then route the causal story back through recall. They do not take the next step —
  that the same fragmentation is exactly what makes the reconstruction rule bite hardest, since a
  fragmented stream is where gap thresholds and missing-close-event handling change the total most.
  **That unclaimed step is our contribution's clearest opening in this slice.**
- **Also relevant.** Discussion notes their convergent validity exceeded Ernala et al.'s (r = .24) and
  Burke et al.'s (r = .45), and attributes the difference to measurement design: *"which used a
  different approach to measure adolescents' time spent on social media than the present study."*
- **Availability.** Preregistration `osf.io/j8mzq`; cleaning procedure `osf.io/jkre2`; the companion
  Scientific Reports paper (below) publishes the dataset on Figshare and scripts on OSF. The
  event→episode step is **partially** re-runnable — the gating rule is stated and the cleaning detail is
  posted, but the raw Ethica event stream is not the published artefact.
- **Access.** **Full text read** — accepted-manuscript/preprint PDF via PsyArXiv
  (`doi 10.31234/osf.io/p4yb2`, downloaded from `osf.io/download/p4yb2/`). The published Elsevier PDF
  (`sciencedirect.com/.../S2451958821000385/pdf`) is flagged open access by Unpaywall but returned an
  HTML interstitial, not the PDF, to curl; ScienceDirect returned **HTTP 403** to WebFetch.

---

### 4. Verbeij, Pouwels, Beyens & Valkenburg (2021/2022) — *Experience sampling self-reports of social media use have comparable predictive validity to digital trace measures*, Scientific Reports 12, 7611

- **Why it matters here.** Same pipeline as #3, one year on, and it restates the screen-gating rule in
  the published record. Independent confirmation that this group treats screen-state gating as a
  required preprocessing step rather than an option — and, notably, still without a name for it.
- **Instrument and ladder rung.** **Rung 4.** Ethica App Usage Stream, Android, foreground app time
  plus screen-state stream, aligned to ESM windows.
- **Episode reconstruction rule.** **DECLARED (screen-state gating) + DELEGATED (rest).** Method:
  > "excluded records of app use when adolescents' screen was turned off (based on the screen state
  > data; 2.6% of the data of the digital trace measure was excluded)"

  and
  > "The digital trace measure was cleaned based on the procedure of Verbeij et al."

  Also stated: *"retrieved the Android log data that were stored on adolescents' smartphone"* every
  five minutes, recording *"the foreground time of all applications … which can be defined as time
  spent on the applications when the adolescents' smartphone was unlocked"*; and the alignment rule
  *"Per social media platform, we determined TSM in the hour before each ESM self-report according to
  the digital trace measure."*
- **Session threshold.** **ABSENT.** No gap, minimum, or cap reported. The temporal unit is the ESM
  hour window, not a reconstructed episode.
- **Processing attribution, verbatim.** Limitations name two log-side failure modes:
  > "app crashes and bugs in either the tracking software or the individual smartphones"

  and
  > "digital trace measures typically record app usage on a single device (e.g., a smartphone). Yet, a
  > considerable number of participants also access social media platforms through other devices or via
  > web-based versions of the apps."

  Both are *coverage* attributions (the log missed events), not *rule* attributions (the log's events
  were assembled wrongly). Worth distinguishing sharply in our paper: coverage error is widely
  acknowledged; reconstruction error is not.
- **Availability.** Data: **yes** — anonymised dataset on Figshare, `doi 10.21942/uva.16780204`.
  Code: **yes** — analysis scripts at `osf.io/4gaqk`. Best availability posture of any discrepancy
  study in this slice.
- **Access.** **Full text read** via PubMed Central, `PMC9084269`.

---

### 5. Radesky, Weeks, Ball, Schaller, Yeo, Durnez, Tamayo-Rios, Epstein, Kirkorian, Coyne & Barr (2020) — *Young Children's Use of Smartphones and Tablets*, Pediatrics 146(1)

- **Why it matters here.** This is the parent-report-vs-passive-sensing study built on the **exact
  instrument our repository preprocesses** (Chronicle over `UsageStatsManager`), and it is a textbook
  case of the pattern our paper describes: the reconstruction step exists, is acknowledged to exist,
  is named — and is then **pushed out of the main text into supplemental material**, with the code
  language mentioned but the rule never stated.
- **Instrument and ladder rung.** **Rung 4 for Android** (n = 126: 91 smartphones, 35 tablets) —
  verbatim: *"It queries the Google UsageStatsManager application programming interface (API), which
  provides data about app usage on all…"*. **Rung 1 for iOS** (n = 220) — parents screenshot the
  device's Settings→Battery page. The two rungs are then **pooled into one "mobile device sampling
  output"** against which parent report is scored. Two entirely different construction rules, one
  accuracy statistic.
- **Episode reconstruction rule.** **DELEGATED** — to a supplement, by name:
  > "…conducted data cleaning and processing steps as described in the Chronicle Data Cleaning Methods
  > section of the Supplemental Information."

  and
  > "All processing of raw timestamped data into user logs was performed in Python, all mobile device
  > sampling analyses were conducted by using data.table in R 3.5.2…"

  "Processing of raw timestamped data into user logs" **is** the event→episode step, named in one
  clause and then handed off. The main text states the language it was written in but not what it did.
- **Session threshold.** **UNDETERMINED.** No threshold appears in the main text. Any value lives in
  the Supplemental Information, which I did not retrieve (the Georgetown-hosted PDF is the main
  article only). I am not guessing it.
- **Discrepancy result and its attribution.** Verbatim: *"Compared with mobile device sampling output,
  most parents underestimated (35.7%) or overestimated (34.8%) their child's use"*; *"For inaccurate
  reporters, actual usage was on average 69.7 minutes (SD 67.5) above or below the parent-reported
  category bounds (median 50.7; range 0.86–332.5 minutes)."* The attribution is to the reporter and to
  device sharing, not to processing: *"A main limitation of our current app is that it cannot identify
  the user of shared devices…"*. Note the accuracy criterion is itself a processing choice — parent
  report is scored as accurate if sampling output *"fell within the weighted parent-reported time
  category"*, so the width of the reported categories partly determines the measured discrepancy.
- **Availability.** Data: not published (consortium/IRB-held; the paper notes device data were
  destroyed after processing). Code: not published as a repository in the main text. The event→episode
  step is **not** re-runnable by a third party from this paper alone.
- **Access.** **Full text of the main article read** (author-hosted PDF,
  `elp.georgetown.edu/wp-content/uploads/2021/06/Radesky-et-al-2020.pdf`). **Supplemental Information
  NOT retrieved — the reconstruction rule is therefore UNDETERMINED, not absent.**

---

### 6. Zhao, Han, Bagot, Tapert, Potenza & Paulus (2025) — *Examining measurement discrepancies in adolescent screen media activity with insights from the ABCD study*, npj Mental Health Research 3

- **Why it matters here.** A 2025 discrepancy study that partitions the gap **by app category** and
  finds the direction of the discrepancy reverses between categories — then attributes the reversal to
  what the instrument can and cannot see, not to recall. That is a processing/coverage attribution
  with an empirical handle on it.
- **Instrument and ladder rung.** **Rung 3/4** — the Effortless Assessment of Risk States (EARS) app on
  Android only. Verbatim on the platform restriction: *"Apple blocked app-scrapping programs at
  data-collection time."*
- **Episode reconstruction rule.** **DECLARED at the aggregation level, ABSENT at the event level.**
  Verbatim: *"Total EARS-logged time was calculated as the sum of the foreground app usage times across
  all apps averaged over days with at least one upload during the tracking period. System operational
  app usage times were excluded."* How a "foreground app usage time" was assembled from events is not
  stated — that is inside EARS/Ksana Health. Note two undocumented-but-consequential inclusion rules
  in one sentence: the system-app exclusion, and the "days with at least one upload" denominator.
- **Session threshold.** **ABSENT** at the event level; the only stated temporal rule is the
  day-inclusion criterion above. A separate declared classification decision: *"Snapchat was labeled as
  a social media app in this study due to its multifunctionality, despite being listed as a
  communication app by Google Play."*
- **Processing attribution, verbatim.** On the gaming discrepancy:
  > "Only one-third of gaming time appeared to occur on smartphones, suggesting that adolescents often
  > use various devices for gaming. The limitation of EARS in capturing gaming solely on smartphones
  > likely generated this underestimation."

  A further one reported in the paper: EARS-logged data are *foreground* usage, which may miss
  multitasking or background activity such as music playback. Both are coverage attributions; neither
  is a rule attribution.
- **Availability.** Data: ABCD repository, `nda.nih.gov/abcd`, with approved certification. Code:
  **yes**, `github.com/ZhaoCUMC/ABCD_EARS`. The *analysis* is re-runnable; the event→episode step is not,
  because it is inside the vendor app.
- **Access.** **Full text read** via PubMed Central, `PMC12064680`.

---

### 7. Wade, Ortigara, Sullivan, Tomko, Breslin, Baker, Fuemmeler, Delfel, Kwon, Tapert, Bagot, Lisdahl (2021) — *Passive Sensing of Preteens' Smartphone Use: An Adolescent Brain Cognitive Development (ABCD) Cohort Substudy*, JMIR Mental Health 8(10):e29426

- **Why it matters here.** The EARS pipeline's own methods paper, and the clearest instance of the
  vendor-black-box pattern: the raw event capture is described precisely, the conversion to durations
  is not described at all, and the discrepancy is then attributed to participant behaviour.
- **Instrument and ladder rung.** **Rung 3/4** — EARS, customised by Ksana Health, Android 6.0+.
  Verbatim: the app *"ran continuously in the background…scraping the operating system every few
  minutes to collect information on (1) screen on and off and (2) which app was in the foreground."*
- **Episode reconstruction rule.** **ABSENT.** The paper states only that the app logged *"date and
  time…for each app use instance"* and that *"Ksana Health reviewed each individual app used by a
  participant and computed summaries across composite app categories."* What defines an "app use
  instance" — the boundary rule — is nowhere in the paper. This is the single most quotable
  instance in the slice of the step being skipped entirely.
- **Session threshold.** **ABSENT.** No gap, minimum, or cap reported.
- **Discrepancy and attribution.** *"79% (53/66) of children reported less smartphone screen use than
  indicated by passive sensing"*; self-report/passive correlation r = 0.49, P < .001. Attribution is to
  reactivity — *"any type of monitoring could influence behavior"*, invoking a Hawthorne effect — not to
  processing.
- **Availability.** Data: NIMH Data Archive (NDA); processed summaries in ABCD Release 3.0. Code: none.
  The event→episode step is **not** re-runnable and is not even inspectable.
- **Access.** **Full text read** via PubMed Central, `PMC8561413`.

---

### 8. Mahalingham, McEvoy & Clarke (2023) — *Assessing the validity of self-report social media use: Evidence of no relationship with objective smartphone use*, Computers in Human Behavior 140, 107567

- **Why it matters here.** A headline null (r = −.04 between self-estimate and "objective" use) whose
  "objective" measure is a **mixture of two different vendor aggregates with two different, undeclared
  construction rules**, silently summed. The paper is a strong exhibit for our argument precisely
  because it never notices this.
- **Instrument and ladder rung.** **Rung 1, twice over, pooled.** iOS participants: the *"social
  networking"* category of the built-in Screen Time function, read off the device by the researcher in
  a lab session. Android participants: a third-party Play Store app, *"App Usage"*. N = 209.
- **Episode reconstruction rule.** **ABSENT.** Verbatim, §1.2: *"Usage data for these platforms was
  automatically recorded by participants' smartphones. For iPhone users this was done via the
  screentime function in settings (available from iOS 12 onward)… Participants who used Android
  smartphones were directed to download the application 'App Usage'… The final measure was then
  calculated as the combined minutes spent using Facebook, Instagram, Snapchat, Twitter and Tik Tok via
  smartphone across the past 7 days."* Neither vendor's rule is stated, questioned, or compared. One
  declared control: iOS users were *"instructed to disable the 'share across devices' function one week
  prior to their data collection session to ensure only smartphone data was recorded"* — i.e. they
  managed the *aggregation scope* while leaving the *episode rule* untouched.
- **Session threshold.** **ABSENT / UNDETERMINED** — neither Apple nor the "App Usage" developer
  documents one, and the paper does not ask.
- **Processing attribution, verbatim.** One sentence, in limitations, generic and unquantified:
  > "It must also be acknowledged that objective measures may not always be accurate due to various
  > factors that could potentially compromise or skew data (eg. bugs, operating system
  > inconsistencies, software updates, etc.)"

  "Operating system inconsistencies" is as close as this paper gets. There is no examination of whether
  the iOS and Android halves of the dependent variable are the same quantity. They also report *"more
  Twitter and Facebook use occurred via Android devices"* without treating the platform split as a
  measurement confound.
- **Availability.** Data: not stated in the retrieved text. Code: none. The event→episode step is
  **not** re-runnable — it happened inside two closed vendor products and was transcribed by hand.
- **Access.** **Full text read** via the PDF at `gwern.net/doc/sociology/technology/2022-mahalingham.pdf`.
  ScienceDirect returned **HTTP 403**.

---

### 9. Kaye, Orben, Ellis, Hunter & Houghton (2020) — *The Conceptual and Methodological Mayhem of "Screen Time"*, Int. J. Environ. Res. Public Health 17(10):3661

- **Why it matters here.** The standard citation for "the construct is undefined." It is a **definition**
  argument, not a **processing** argument, and our paper needs to say so: Kaye et al. establish that the
  field does not agree on *what to count*; nobody in this slice has made the separate argument that the
  field does not state *how it counted*. That gap is our slot, and this paper is the right thing to
  position against.
- **Instrument and ladder rung.** N/A — commentary/critical review, no data.
- **Episode reconstruction rule.** N/A. The rule is not discussed; the paper operates one level above
  it, at the construct.
- **Session threshold.** N/A.
- **Verbatim, §2 "Issue 1—Conceptual Chaos".**
  > "Definitions of screen time vary, which poses a myriad of issues relating to harmonisation,
  > measurement and comparison."

  > "Despite this, there is a tendency to assume that screen time is a largely unidimensional or
  > homogeneous construct, with little work to unify definitions or ensure that conceptualisations are
  > agreed upon."

  > "Whereas some studies have probed largely universal 'total screen time' in respect of a certain
  > time-frame (e.g., in the last week), others ask participants to estimate the amount of screen time
  > on a typical day, and sometimes split this by weekday and weekend day, or school day and non-school
  > day."

  Note the third quote: the variation they enumerate is variation in **survey framing**. Even the
  field's flagship "our measures are chaos" paper locates the chaos on the self-report side.
- **§3 "Issue 2"**, on where inaccuracy concentrates:
  > "This appears to become even more problematic when estimating short, habitual screen time
  > behaviours like smartphone checking, as highlighted in recent work showing that iPhone users'
  > estimates of daily social media use are less accurate than their reports of overall daily iPhone
  > use."

  Same signal as Verbeij: the error concentrates where the episode structure is finest.
- **Caveat I must flag.** A search-engine summary attributed to this literature a specific claim that
  two tools are non-comparable because *"one tool takes an average over the previous 10 days of use,
  whereas another takes an average over the previous 7 days"*. **I could not locate that sentence in
  the Kaye et al. full text I retrieved.** It is therefore **UNVERIFIED** and must not be cited to this
  paper without confirmation. Recording it rather than dropping it, so the next agent can chase the
  real source.
- **Availability.** N/A — no data or code.
- **Access.** **Full text read** via PubMed Central, `PMC7277381`.

---

## 2. Cross-slice finds — outside slice F, too important to leave in my notes

These belong to slices A/C/D. I am not writing them up to the full field schema — the owning agent
should — but each is a live citation threat and none of them surfaced through a slice-F-shaped query,
so they may otherwise be missed.

### T1. Zhu, Chen, Peng, Liu & Dai (2018) — *How to measure sessions of mobile phone use? Quantification, evaluation, and applications*, Mobile Media & Communication (doi 10.1177/2050157917748351)

**This is the strongest citation threat I encountered in any direction.** It is a named-algorithm
paper whose entire subject is the event→episode step for mobile device logs. It sets up exactly our
framing — that an "equal-length" measure (total time) and a "variable-length" measure (sessions) are
different objects, and that the second requires a rule. Verbatim from the retrieved PDF:

> "A session is defined as a variable-length measure. A threshold-based approach is widely [used]…
> studies have adopted a global threshold (e.g., 30 [minutes/seconds])… global threshold makes a
> strong (but generally [untested]) [assumption]…"

> "…two [approaches to extracting] sessions of mobile phone use: threshold-based versus screen-based.
> The threshold approach is defined a session based on a threshold determined by the duration of
> inactiveness, such as 30 seconds… The threshold is arbitrarily [chosen]…"

They propose a **per-user** threshold derived by network community detection over session-clusters
instead of a global constant, and they state the key negative claim we also want to make — that the
conventional threshold has *"never been empirically verified."* Full text read
(`cluo29.github.io`-adjacent arXiv copy, 1711.09408, curl + pdftotext). **Slice C/A agent must read
this.** It does not do our thing — it does not survey whether the field *declares* its rule, and it is
threshold-selection rather than an ontology of the event→episode step — but it is the nearest prior
art on the object itself.

### T2. Muise, Ram, Robinson & Reeves (2023) — *Identification, Impacts, and Opportunities of Three Common Measurement Considerations when using Digital Trace Data*, arXiv:2310.00197

Names three preprocessing error types in digital-trace media measurement, one of which is precisely
our object. Abstract, verbatim:

> "(1) entangling - the common measurement error introduced by proxying exposure to content by
> exposure to format; (2) flattening - aggregating unique segments of media interaction without
> incorporating temporal information, most commonly intraindividually and (3) bundling - summation of
> the durations of segments of media interaction, indiscriminate with respect to variations across
> media segments."

"Bundling" is the summation step; "flattening" is the loss of temporal structure in aggregation. From
the Screenomics group (screenshots every few seconds). **Abstract read in full; body not retrieved.**
Slice D should read the body. Citation threat: they have named the failure modes, though at the
aggregation layer rather than the episode-construction layer.

### T3. Ochoa & Revilla (2025) — *Variability of a job search indicator induced by operationalization decisions when using digital traces from a meter*, PLOS One (doi 10.1371/journal.pone.0338894)

A **multiverse over exactly our kind of decision**, in an adjacent domain. From the retrieved article:
six varied factors including *"Session time gap: 10, 30, or 60 minutes between consecutive visits"*,
*"Minimum visit duration: 0, 2, 5, or 10 seconds"*, *"Maximum visit duration: no cap, 10, 20, or 30
minutes"*, and outlier treatment — **10,080 operationalizations**. Result: correlations between
operationalization pairs span −1 to +1, IQR 0.22–0.71, *only 26.4% exceeded 0.70*, per-metric
coefficients of variation 24.5%–83.9%. Data and materials at `doi 10.17605/OSF.IO/SK4A5`.

This is the empirical demonstration that our claim is not hypothetical — done on browsing meters, not
on mobile OS event logs. **If our paper needs a "the choice actually moves the number" citation, this
is it.** Slice C/D should own it. Retrieved via PMC (`PMC12721509`).

### T4. Ellis-lab Usage Logger open-source paper (2022), PMC8863755 — *Open-source smartphone app and tools for measuring, quantifying, and visualizing technology use*

Declares its (very thin) rule verbatim — *"Unix time stamps can be compared between a 'Screen On' event
and 'Screen Off' event to calculate the duration of smartphone use"* and, for apps, *"calculating the
time differences between consecutive events and summing those durations independently"* — with **no
timeout or gap threshold specified**, and then does something rare: it measures the OS's own timestamp
fidelity. Verbatim, §Validity:

> "It is possible that Android will let Usage Logger know the event has happened before it lets another
> app deal with the event itself…There are no guarantees about what happens first and so the 'screen
> on' event could be recorded before the screen actually turns on, or vice versa."

Reported discrepancies range from milliseconds to several seconds across devices. *"All source code,
materials, and data are freely available."* **Slice A should own this** — it is the AOSP-behaviour /
declared-semantics item.

---

## 3. Counted, not written up — the gap-measured-blame-memory bulk

Per instructions these are tallied, not detailed. Split by how much I actually read.

**3a. Read in full or in substantial part; confirmed to contain no processing attribution (7)**

| # | Paper | Instrument / rung | Rule | Attribution given |
|---|---|---|---|---|
| 1 | Júdice, Sousa-Sá & Palmeira (2023), *J Prevention* — lockdown discrepancy | unstated; participants ran *"specific scripts for the iOS and Android operating systems"*; rung indeterminate | **ABSENT** — tool never named | recall + time perception under lockdown |
| 2 | Yuan et al. (2019), *Pediatric Research* — parents' smartphone use | Moment (iOS) / Minuku (Android, *"query the Android UsageStatsManager library every 5 seconds"*) — rung 4/1 mixed | partial: *"We calculated the difference between each timestamp and summed all instances when the screen was on"*; no gap rule | *"Underreporting may be due to the more intermittent or immersive experiences users have with mobile technology, whose duration may be more difficult to recall."* |
| 3 | Gower & Moreno (2018), *JMIR mHealth uHealth* — iPhone battery-screen screenshots | **Rung 1**; notable that the vendor screen itself splits *"onscreen"* and *"background"* time | ABSENT | self-report bias |
| 4 | Burnell, George, Kurup, Underwood & Ackerman (2021), *Communication Methods and Measures* — truth-and-bias model | **Rung 1**, iOS Screen Time read by the participant | ABSENT | *"Smartphone use is habitual…and habitual behaviors are more difficult to estimate."* Data at `osf.io/t5bjx` |
| 5 | Saraceni, Migliorelli, Frontoni & Stacchio (2026), *Frontiers in Computer Science* — objective vs perceived, adolescents | **Rung 1**, *"Digital Wellbeing (Android) and Screen Time (iOS)"* pooled | ABSENT; has a 4-step "preprocessing pipeline" that is entirely recoding/imputation/statistics, **no episode step** | *"psychological factors, such as anxiety or impulsivity"*; metacognition. Data on request only |
| 6 | Brossette et al. (2026), *PLOS One* — logged vs self-reported **reading** time | not a device event log — a parent-operated FlutterFlow timer app | has minimum-duration and outlier rules (<1 min excluded, 1.36%; timer-failure sessions replaced, 3.68%) | compliance/coverage. Data + code at `osf.io/5ky7w`. Included only as a near-miss from an adjacent domain |
| 7 | Vanden Abeele, Beullens & Roe (2013), *Mobile Media & Communication* | carrier/network provider data | not read in full — pre-2015 anyway | recall; over-report at low use, under-report at high use |

**3b. Identified and confirmed relevant, abstract or metadata only — UNDETERMINED on the rule (12)**

Each of these is a genuine slice-F paper I located but could not open in full through WebFetch/curl.
None is silently dropped; each is an open item.

1. **Ohme, Araujo, de Vreese & Piotrowski (2021)**, *Mobile data donations: Assessing self-report accuracy and sample biases with the iOS Screen Time function*, Mobile Media & Communication 9(2):293–313, doi 10.1177/2050157920959106. **Abstract read in full** via the Semantic Scholar API. Rung 1 (iOS Screen Time via donated screenshots), n = 404 Dutch adults; *"there is a strong tendency for underreporting of smartphone usage duration and frequency."* **Rule UNDETERMINED.** This is the highest-priority unresolved item in the slice — a whole method built on a vendor aggregate whose construction rule Apple has never published. Unpaywall reports it CC-BY at `journals.sagepub.com/doi/pdf/10.1177/2050157920959106`; SAGE served an HTML block to both curl and WebFetch (403). A route with journal access should retrieve it.
2. **Sewall, Bear, Merranko & Rosen (2020)**, *How psychosocial well-being and usage amount predict inaccuracies in retrospective estimates of digital technology use*, MMC 8(3):379–399, doi 10.1177/2050157920902830. **Abstract read in full** (Semantic Scholar). Rung 1, Apple Screen Time, n = 325; misestimation of 19.1 h (overall) and 12.2 h (social media) per week. Their conclusion is construct-level, not processing-level, and is worth quoting in our paper: *"We propose that retrospective estimates of digital technology use may be capturing the construct of perceived use rather than actual use."* Not OA per Unpaywall. **Rule UNDETERMINED.**
3. **Scharkow (2016)**, *The Accuracy of Self-Reported Internet Use — A Validation Study Using Client Log Data*, Communication Methods and Measures. Metadata only. **UNDETERMINED.**
4. **Deng, Kanthawala, Meng, Peng, Kononova, Hao, Zhang & David (2019)**, *Measuring smartphone usage and task switching with log tracking and self-reports*, MMC. Metadata + a secondary quote about logging limits (*"logging cannot distinguish if the user is really paying attention or not"* — attributed to this work by a search summary, **not verified in source**). **UNDETERMINED.**
5. **Andrews, Ellis, Shaw & Piwek (2015)**, *Beyond Self-Report: Tools to Compare Estimated and Real-World Smartphone Use*, PLOS ONE 10(10):e0139004, PMC4625000. Metadata only; a secondary source describes the app as recording *"a timestamp when a use starts and ends"* from screen on/off via Funf. Open access — **should be read**; I ran out of budget. **UNDETERMINED.**
6. **Rozgonjuk et al. / "Smartphone Screen Time: Inaccuracy of self-reports and influence of psychological and contextual factors"**, Computers in Human Behavior 116 (2021), doi 10.1016/j.chb.2020.106616. Not OA per Unpaywall; ScienceDirect 403. **UNDETERMINED.**
7. **Verbeij et al. (2024)**, *(In)accuracy and convergent validity of daily end-of-day and single-time self-reported estimations of smartphone use among adolescents*, CHB (S0747563224001493). ScienceDirect 403. Reported ~55 min average single-time discrepancy ≈ 18% of daily screen time. **UNDETERMINED.**
8. **Griffiths et al. (2026)**, *Self-Reported Versus Objectively Logged Social Media Use: Implications for Measurement in Eating Disorder Research*, Int. J. Eating Disorders, doi 10.1002/eat.70135. Wiley returned **403**. **UNDETERMINED.**
9. **Shaleha, Roque, Andrews, Calfee & Lee (2026)**, *Screen Use Measurement Tools: A Mapping of Instruments, Gaps, and Future Directions*, doi 10.1177/21522715261417288. SAGE **403**. A 36-tool mapping published this year — **most likely place in the current literature for someone to have already made our observation.** High priority to retrieve.
10. **Kristensen et al. (2021)**, *Criterion validity of a research-based application for tracking screen time on android and iOS smartphones and tablets* (SDU DeviceTracker), Computers in Human Behavior Reports (S2451958821001123). ScienceDirect 403. Reported: Android vs ActionDash bias −0.8 min/day, r = 0.99; **iOS vs Apple Screen Time bias +19.3 min/day, r = 0.88, with a published correction factor.** That iOS/Android asymmetry is a *construction-rule* difference measured but, as far as the abstract shows, not diagnosed as one. **Worth chasing.** **UNDETERMINED.**
11. **Naab, Karnowski & Schlütz (2019)**; **Araujo, Wonneberger, Neijens & de Vreese (2017)**; **Boase & Ling (2013)** — the survey-methodology lineage. Metadata only. **UNDETERMINED.**
12. **"Good News! Communication Findings May be Underestimated"**, JCMC 25(5):346 (2020); **Sewall, Goldstein, Wright & Rosen (2022)**, Clinical Psychological Science; **"The Surprise of Underestimation"** (2022), Springer HCII; **Marciano & Camerini**; **Zeitschrift für Psychologie 231(4)** children's subjective/objective comparison; **J Psychopathology & Behavioral Assessment (2022)** concurrent validity. Metadata only. **UNDETERMINED.**

**Slice F running total: 9 written up + 4 cross-slice + 7 read-and-counted + ~20 identified
abstract/metadata-only.**

---

## 4. Report

### Totals
- **Papers written up in full detail: 9** (§1) plus **4** cross-slice items (§2).
- **Read in full: 13** — Ernala 2020; Parry 2021 (incl. Methods + reporting summary); Verbeij 2021 CHBR (preprint); Verbeij 2021/22 Sci Rep; Radesky 2020 (main article only); Zhao 2025; Wade 2021; Mahalingham 2023; Kaye 2020; Zhu 2018; Ochoa & Revilla 2025; PMC8863755 Usage Logger; Júdice 2023.
- **Read in substantial part: 6** — Yuan 2019; Gower & Moreno 2018; Burnell 2021; Saraceni 2026; Brossette 2026; Muise 2023 (abstract complete, body not retrieved).
- **Abstract only: 2 confirmed** (Ohme 2021; Sewall 2020 — both abstracts read complete via Semantic Scholar API).
- **Metadata only / not opened: ~18** (§3b items 3–12).
- **Papers that attribute any part of the discrepancy to log processing: 5 of ~39** — Ernala 2020, Parry 2021, Verbeij 2021 (structural, via fragmentation), Zhao 2025 (coverage), Mahalingham 2023 (one generic sentence). **The brief's premise holds: the attribution is rare.** More precisely, it is rare *and* shallow — four of the five are coverage claims ("the log missed events"), not rule claims ("the log assembled its events wrongly"). **Ernala et al. 2020 is the only one that is a rule claim, and it is the only paper in the slice that states its rule.** That is not a coincidence and it is the paper's thesis in miniature: you can only attribute error to a rule you have written down.

### Citation threats, ranked

1. **Zhu, Chen, Peng, Liu & Dai (2018), MMC** (§2/T1). Highest threat overall. A dedicated
   event→episode paper for mobile logs, with a named algorithm, an evaluation, and the explicit charge
   that the conventional threshold has *"never been empirically verified."* Our contribution must be
   stated as *distinct from* threshold selection: they optimise the threshold, we argue the whole rule
   is undeclared and must be reported as a measurement decision. If our framing is "someone should
   pick a better session gap," this paper already did it in 2018.
2. **Ernala, Burke, Leavitt & Ellison (2020), CHI** (§1.1). Highest threat *within* slice F. A
   discrepancy paper that declares a full rule, tests its sensitivity, and names logging as a source of
   the discrepancy. It is a counterexample to any unqualified claim that "the field never says which
   rule it used." Our claim must be scoped: *published academic device-log studies* — Ernala's rule was
   declarable because Facebook owns the log and the authors work there.
3. **Ochoa & Revilla (2025), PLOS One** (§2/T3). Threat to the *novelty of the demonstration*, not the
   framing: 10,080 operationalizations, and the numbers move enormously. If our paper's core empirical
   move is "vary the rule, watch the measure move," this did it first, on browsing meters.
4. **Muise, Ram, Robinson & Reeves (2023)** (§2/T2). Threat to the *vocabulary*: "flattening" and
   "bundling" already name parts of what we are naming. Read the body before finalising our terms.
5. **Shaleha, Roque, Andrews, Calfee & Lee (2026)** (§3b.9). **Unassessed threat.** A 2026 mapping of
   36 screen-use measurement instruments is the single most likely place for someone to have already
   catalogued whether tools document their reconstruction. **Could not retrieve — SAGE 403. This is the
   open risk in this slice and should be resolved before we claim priority.**

### Anything that contradicts us — stated plainly, not softened

**Yes. Three things.**

1. **Ernala et al. (2020) declares its rule in full, in the running text, with two thresholds, and
   reports a sensitivity analysis on one of them and on an inclusion decision.** This is a
   discrepancy paper doing everything we say the field does not do. Any sentence in our paper of the
   form "the field never reports the rule" is false as written. The defensible claims are narrower and
   still worth making: (a) it is the exception, 1 of ~39 papers here; (b) it is an industry server log,
   not a consumer-device platform log; (c) the *thresholds themselves have no stated provenance* — only
   their robustness is checked; and (d) even Ernala et al. assert without measurement that the
   log-processing share of the discrepancy is *"likely small in proportion to errors due to human
   recall."* That last sentence is the field's whole posture in one clause, and it is unevidenced.

2. **Verbeij et al. (2021, 2022) declare a cross-stream screen-state gating rule and quantify its
   effect** (2%, 2.6% of app-usage records dropped). That is a real, named, quantified preprocessing
   decision, on Android platform logs, applied for exactly the reason our screen-gated crediting layer
   exists — *"To control for the possibility that adolescents' phones still recorded app usage when
   apps were running in the background while their phone screen was turned off."* We are not first to
   intersect app usage with screen state. We should cite them as prior art for the *operation* and
   position our contribution on the *reporting* and *option-space* side.

3. **Parry et al. (2021) tested a logging-method moderator and found nothing** — twice (P = 0.279 and
   P = 0.074). Taken at face value this says the log side does not explain the heterogeneity. It should
   not be taken at face value, and I would rather we meet it head-on than not cite it: the moderator has
   four levels of *instrument class*, k is tiny, the authors themselves call the moderator analyses
   *"largely inconclusive—probably owing to the small number of studies present within each moderator
   level,"* and residual I² stayed near 90%. Crucially, **"log collection method" is not "episode
   reconstruction rule"** — two studies using the same collection method can use opposite gap rules and
   would be pooled into the same level. The null is on a variable that cannot see our effect. But a
   reviewer will cite this at us, so we should quote it and say exactly this.

### Three things I expected and did not find

1. **A study that recomputes the same raw log under two or more reconstruction rules and reports how
   the self-report/log discrepancy changes.** I expected at least one, given how cheap it is once you
   hold the raw events. Nothing in this slice does it. Ernala comes closest (60 s vs 300 s) but reports
   only that results were *"qualitatively similar"* — no numbers for the alternative. Ochoa & Revilla
   do the multiverse but on browsing meters and **without a self-report comparison**. The intersection —
   *multiverse over episode rules × self-report discrepancy, on device event logs* — is empty. That is
   a clean, unoccupied experiment.
2. **Any paper asking whether the *self-reporter* is running a different reconstruction rule than the
   *pipeline*.** Ernala's "Mental Models of Time Spent" section gets within one sentence of it — noting
   respondents disagree about whether messaging counts, whether zero-days count, whether background
   counts. But nobody frames the discrepancy as *two competing reconstruction rules applied to the same
   behaviour*, one implemented in code and one in the respondent's head. Every paper treats the log's
   rule as the referent and the human as the error term. Reframing the discrepancy as rule-vs-rule
   rather than truth-vs-error is, as far as this slice shows, unclaimed — and it makes Verbeij's
   fragmentation result and Kaye's "short habitual behaviours" result fall out naturally.
3. **A reporting checklist or reproducibility guideline that includes the event→episode rule as a
   required item.** I expected this from the open-science-adjacent wing (Parry, Kaye, the Q-SSP
   checklist Parry et al. use for study quality). Parry et al. recommend *"researchers should use
   tracking or logging services to measure media usage"* and that variables *"should be clearly
   indicated as self-reported"* — but there is no corresponding recommendation to state how logged
   variables were constructed. The Q-SSP quality items they applied are about sample size and sampling
   method. Nobody has written the checklist line. Writing it is a concrete deliverable for our paper.

*(Bonus absence: no paper in this slice cites `UsageEvents` constants by name. Radesky et al. name the
`UsageStatsManager` API — the closest anyone gets — and then send the rule to a supplement.)*

### Dead ends — do not repeat these

**Queries that returned nothing usable:**
- `"what counts as time spent on an app server logs versus user perception"` — collapsed entirely into
  commercial employee-monitoring and APM/server-latency vendor content. The words "app", "time", and
  "monitoring" are owned by the productivity-software SEO space.
- `"self-report may be closer to active attentive use while logs count foreground app time not
  attention"` — same failure mode; returned time-tracking product pages plus unrelated arXiv attention
  papers.
- `"screen time" estimate error partly artifact of "how the data are processed"` — the quoted phrase
  routed straight to **EEG/MNE/FieldTrip signal-preprocessing documentation.** "Preprocessing artifact"
  is a claimed term of art in neuro; avoid it in queries unless you also constrain the domain. (The
  *second-pass* rephrasing of this query is what surfaced Muise et al. and Ochoa & Revilla, so the
  concept was right and only the phrasing was poisoned.)
- `Screen Time app aggregation rule unknown how Apple computes daily total validation study` —
  returned Apple support forums and consumer blog listicles. Apple's rule is genuinely undocumented and
  no academic paper indexes on this phrasing. Slice B will need a different route (forensics
  literature, not measurement literature).
- `two smartphone tracking apps disagree same device different screen time totals` — consumer
  "best screen time app" affiliate content. Only the SDU DeviceTracker criterion-validity paper
  survived, and it surfaced better via the direct tool name.

**Publisher blocks encountered (WebFetch and curl, no browser used):**
| Host | Result | Papers affected |
|---|---|---|
| `dl.acm.org` | **403** on both `/doi/` and `/doi/fullHtml/` | Ernala 2020 — **worked around** via author-hosted PDF at `thoughtcrumbs.com` |
| `nature.com` | **303 → `idp.nature.com` cookie-consent loop, never resolves** | Parry 2021 — **worked around** via `gwern.net` PDF. **N.B. PMC and `nature.com`-hosted npj/SciRep articles are fine; it is the flagship Nature-family journals that loop.** |
| `journals.sagepub.com` | **403** to WebFetch; HTML block page to curl even for CC-BY content | Ohme 2021 (**unresolved**), Shaleha 2026 (**unresolved**), Sewall 2020, Zhu 2018 (**worked around** via arXiv 1711.09408) |
| `sciencedirect.com` | **403** on `/article/`, `/pii/`, and `/pdf` | Verbeij 2021 (**worked around** via PsyArXiv), Mahalingham 2023 (**worked around** via gwern), Kristensen 2021 + CHB 2021 + CHB 2024 (**unresolved**) |
| `onlinelibrary.wiley.com` | **403** | Griffiths 2026 (**unresolved**) |
| `osf.io/<id>/overview` | serves an empty SPA shell to WebFetch — **useless** | — but `osf.io/download/<id>/` **works** for preprint PDFs via curl. Use the download path. |
| `semanticscholar.org` **web page** | returns empty content to WebFetch | — but `api.semanticscholar.org/graph/v1/paper/DOI:<doi>?fields=abstract,openAccessPdf` **works** and returns full abstracts |

**Routes that worked and are worth reusing:**
- `api.crossref.org/works?query.bibliographic=<title>` → authoritative DOI/authors/year. Fixed two
  attributions I would otherwise have had to leave uncertain.
- `api.unpaywall.org/v2/<doi>?email=…` → OA status + best PDF location. Warning: it reported the SAGE
  and Elsevier PDFs as OA, and both still blocked. **OA status is not access.**
- `api.semanticscholar.org/graph/v1/paper/DOI:<doi>?fields=abstract,openAccessPdf` → full abstracts for
  paywalled work. This is how Ohme 2021 and Sewall 2020 became abstract-read rather than metadata-only.
- `pmc.ncbi.nlm.nih.gov/articles/PMC…` → reliable. Note `www.ncbi.nlm.nih.gov/pmc/…` **301-redirects** and
  WebFetch will not follow it across hosts; go straight to `pmc.ncbi.nlm.nih.gov`.
- **`gwern.net/doc/...` mirrors two of the paywalled papers in this slice** (Parry 2021, Mahalingham
  2023). Worth a targeted check for other blocked titles.
- Author/lab-hosted PDFs (`thoughtcrumbs.com`, `elp.georgetown.edu`) beat every publisher route.
- For PDFs: `curl -sL -A "Mozilla/5.0 …"` then local `pdftotext`. **Use `-raw`, not `-layout`, for
  two-column ACM/IEEE papers** — `-layout` interleaves the columns and scrambled the Ernala methods
  paragraph until I re-extracted it. `-layout` is right for single-column journal PDFs.

<!-- independent-expansion-20260805:F -->

---

# Independent expansion ledger — Slice F (68 retained; 65 net-new)


Search date: 2026-08-05 (America/Chicago)  
Scope: broad, discipline-neutral discovery across psychology, communication, HCI, epidemiology, youth/parent research, passive/mobile sensing, digital-trace error frameworks, and data donation.  
Local dedup boundary read before searching: `docs/paper/search-briefs/results-slice-F.md`, `docs/paper/literature-dossier.md`, all five `docs/paper/citation-chase/lane-*.md` files, and `docs/paper/citation-chase/census-reconciliation.md`. Existing items were used to avoid rediscovery, not as a seed set.  
Method: neutral/synonym, negation, contradiction, platform-comparison, adjacent-method, and citation-chain searches; primary publisher/repository pages preferred; Crossref and Europe PMC used only for metadata/retrieval. No browser automation. No citation was guessed or padded.

## Reading key

- **Rung 1**: vendor/platform aggregate or provider record; **Rung 2**: device/screen on-off; **Rung 3**: app-level logs with event semantics not fully exposed; **Rung 4**: raw event stream with named semantics; **N/A**: framework/review or no event-to-episode quantity.
- Reconstruction status is **DECLARED**, **DELEGATED**, **ABSENT**, **N/A**, or **UNDETERMINED**. `UNDETERMINED` means the full method was not available/read; it never means silence.
- **EXPLICIT CONSTRUCTION ATTRIBUTION** marks a source that assigns discrepancy/error to preprocessing, aggregation, coverage, operating-system/vendor/platform behavior, app design, device differences, or trace construction—not merely recall.
- “Available/re-runnable” is conservative. If code/data availability was not verified, it says so.

## Executive census

- **68 retained citations**: **65 net-new by DOI/title audit** beyond the local boundary, plus **3 previously mentioned boundary records re-audited here** because they directly bear on coverage/method choice (F49, F62, F67).
- Domain balance: 22 direct smartphone/social-media/parent-youth/HCI validations; 11 communication, web-meter, news, and TV validations; 13 epidemiologic operator/log validations; 13 trace/sensor/platform quality papers; 9 data-donation papers.
- Access at search time: **41 peer-reviewed full texts**, **7 author manuscripts/preprints**, **20 abstract/metadata-only**. (A DOI landing page alone is not counted as full text.)
- **17 explicit construction/platform-attribution records** in the retained set: F01, F03, F06, F28, F47–F59. Several more donation papers document coverage/nonresponse/omission on the trace side but are separated as collection-quality rather than event-processing attribution.
- Across the combined local-plus-new boundary, only **two direct discrepancy studies expose a sensitivity grid over the logged quantity itself**: F01 (notification and long-session cut-points) and the already-local Ernala study in the dedup appendix. The broader trace-error literature is much more explicit about construction error than the direct discrepancy literature.

## A. Direct smartphone, social-media, family/youth, and HCI discrepancy studies (22)

### F01 — Katapally & Chu (2019), *Methodology to Derive Objective Screen-State from Smartphones: A SMART Platform Study*

- **DOI / primary full text:** https://doi.org/10.3390/ijerph16132275 ; https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6651165/fullTextXML
- **Why it matters / rung:** direct prospective objective-versus-subjective comparison across citizen-owned Android and iOS phones; **Rung 2**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** It demonstrates that the “objective” discrepancy depends on preprocessing cut-points.
- **Reconstruction rule (DECLARED; Methods §2.3–2.4):** “Objective time-stamped smartphone screen-state was captured through the screen-state sensor that recorded every ON and OFF screen notification”; ON-state notification cut-points were **5, 10, 15, and 20 s**, continuous-use caps were **1–6 h or no threshold**, plus a **10 h/day** split. Provenance is pragmatic: auto-notifications and implausibly long ON states, not a fitted optimum.
- **Availability / rerunnability:** peer-reviewed OA full text; no public code/data deposit verified. The parameter grid is reproducible in prose but the exact pipeline is not independently rerunnable from deposited raw data.
- **Access class:** peer-reviewed full text (CC BY).

### F02 — Lee, Ahn, Nguyen, Choi & Kim (2017), *Comparing the Self-Report and Measured Smartphone Usage of College Students: A Pilot Study*

- **DOI / primary full text:** https://doi.org/10.4306/pi.2017.14.2.198 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC5355019/
- **Why / rung:** 35 college students; self-reported patterns compared with an author-built Android monitoring app; broad psychology/clinical validation; **Rung 3**.
- **Reconstruction:** **UNDETERMINED** at event-to-episode level; the accessible paper says real usage logs were collected but the search did not recover a source-level start/stop pairing quotation. Threshold/provenance: none verified.
- **Availability:** peer-reviewed OA full text; code/data deposit not verified, so preprocessing is not independently rerunnable.
- **Access class:** peer-reviewed full text.

### F03 — Lee, Tse, Wu, Mak & Lee (2021), *Validation of Self-Reported Smartphone Usage Against Objectively-Measured Smartphone Usage in Hong Kong Chinese Adolescents and Young Adults*

- **DOI / primary full text:** https://doi.org/10.30773/pi.2020.0197 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC7960745/
- **Why / rung:** 11–25-year-olds, seven-day Android monitoring, app-category discrepancies; youth/epidemiology; **Rung 3**. **EXPLICIT CONSTRUCTION ATTRIBUTION** because coverage exclusions are platform-produced.
- **Reconstruction (DECLARED in Data collection):** “We define that an app was being used when it was running in the graphical interface, and an opening of an app will trigger the closure of the app currently being used, if any.” Coverage quote: “Due to the limitation of the Android operating system, all system default built-in apps could not be captured.” No inactivity threshold stated.
- **Availability:** peer-reviewed OA full text; custom logger and Firebase collection described, but source/data deposit not verified.
- **Access class:** peer-reviewed full text.

### F04 — Hitcham, Jackson & James (2023), *The Relationship Between Smartphone Use and Smartphone Addiction: An Examination of Logged and Self-Reported Behavior in a Pre-Registered, Two-Wave Sample*

- **DOI / stable manuscript:** https://doi.org/10.1016/j.chb.2023.107822 ; https://nottingham-repository.worktribe.com/OutputFile/21895882
- **Why / rung:** preregistered two-wave comparison of logged and self-reported use and notifications; psychology/addiction; pooled iOS/Android vendor summaries; **Rung 1**.
- **Reconstruction:** **DELEGATED** to OS-provided usage summaries; no episode rule or threshold exposed in the retrieved manuscript snippet. Platform recorded in the study, but construction was not independently audited.
- **Availability:** accepted/author manuscript and OSF record (`https://osf.io/2bw4q/`) found; raw vendor construction cannot be rerun.
- **Access class:** author manuscript.

### F05 — Molaib, Sun, Ram, Reeves & Robinson (2025; online 2024), *Agreement Between Self-Reported and Objectively Measured Smartphone Use Among Adolescents and Adults*

- **DOI / primary page:** https://doi.org/10.1016/j.chbr.2024.100569
- **Why / rung:** 41 adolescents and 40 parents with past-month recall versus continuous traces, with app-type agreement; youth/parent study; instrument details not fully recovered; **rung UNDETERMINED**.
- **Reconstruction:** **UNDETERMINED**; publisher abstract reports continuous objective digital traces but no episode construction or threshold. Data are stated confidential.
- **Availability:** OA publisher article, but full method was not retrieved in this pass; no rerunnable public data.
- **Access class:** abstract/metadata-only.

### F06 — Teo, Chionh, Bin Shaul Hamed & Lai (2023), *Problematic Smartphone Usage in Singaporean University Students: An Analysis of Self-Reported Versus Objectively Measured Smartphone Usage Patterns*

- **DOI / primary full text:** https://doi.org/10.3390/healthcare11233033 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10705925/
- **Why / rung:** university-student clinical/behavioral comparison of objective use with self-reported problematic-use constructs; **Rung 1** (participant-transcribed iOS usage output). **EXPLICIT CONSTRUCTION ATTRIBUTION:** the study excludes non-iOS users to standardize the platform-defined app categories and says Android tracking “typically relies on third-party applications” while its built-in function “may vary between smartphone brands.”
- **Reconstruction (DELEGATED; Methods §2.1 and §2.1.6):** objective time was entered “with reference to the usage time measured by the built-in ‘Screen Time’ application in iOS.” No raw-event episode rule or session threshold is exposed. The self-report asks for the preceding seven days; the OS output is treated as the reference rather than independently reconstructed.
- **Availability:** peer-reviewed OA full text; no raw platform events or reconstruction code available.
- **Access class:** peer-reviewed full text.

### F07 — Boyle, Baez, Trager & LaBrie (2022), *Systematic Bias in Self-Reported Social Media Use in the Age of Platform Swinging*

- **DOI / primary full text:** https://doi.org/10.3390/ijerph19169847 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC9408042/
- **Why / rung:** adolescent/young-adult health behavior; explicitly studies multi-platform “platform swinging” as a determinant of reporting bias; **Rung 1** vendor summaries.
- **Reconstruction:** **DELEGATED** to participants’ device/platform records; no event-to-episode rule or threshold exposed. It is valuable because platform multiplicity affects the self-report task, not because it diagnoses preprocessing.
- **Availability:** peer-reviewed OA full text; platform aggregates are not rerunnable from raw events.
- **Access class:** peer-reviewed full text.

### F08 — Wang, Goetzen, Redmiles, Zannettou & Ayalon (2026; preprint first posted 2023), *Self-Reported and Logged Time Spent on TikTok: The Role of Engagement and Use Fragmentation*

- **DOI / full text:** final article https://doi.org/10.1016/j.teler.2026.100353 ; preprint https://doi.org/10.48550/arXiv.2303.02041 and https://arxiv.org/abs/2303.02041
- **Why / rung:** HCI/platform-specific comparison of self-reported and server-logged TikTok use (n=255), explicitly diversifying beyond phone-total studies; **Rung 1** server aggregate.
- **Reconstruction:** **DELEGATED** to TikTok server logs; no event-to-session rule recovered from the accessible abstract. No threshold verified.
- **Availability:** full preprint/source and final peer-reviewed metadata are available; no raw server-log construction code was verified.
- **Access class:** full preprint plus final journal record.

### F09 — Wu-Ouyang & Chan (2023; online 2022), *Overestimating or Underestimating Communication Findings? Comparing Self-Reported With Log Mobile Data by Data Donation Method*

- **DOI / primary page:** https://doi.org/10.1177/20501579221137162
- **Why / rung:** n=777; simplified mobile data donation and communication outcomes; **Rung 1** donated OS log summaries.
- **Reconstruction:** **DELEGATED** to the phone’s prior-seven-day log display; exact event construction and threshold are not exposed. The study is important because the direction of inferential distortion, not just mean discrepancy, changes.
- **Availability:** publisher abstract/full page found; raw platform events unavailable; data/code status not verified.
- **Access class:** abstract/metadata-only.

### F10 — Saponova (2024), *Assessing the Validity of Self-Reported Data on Smartphone Usage: Comparing Subjective and Objective Data*

- **DOI / primary page:** https://doi.org/10.19181/socjour.2024.30.4.4
- **Why / rung:** sociology validation of subjective estimates against objective smartphone usage; **rung UNDETERMINED** pending full instrument text.
- **Reconstruction:** **UNDETERMINED**; no exact event-to-episode rule or threshold retrieved from the primary page.
- **Availability:** primary journal DOI record found; code/data and full-text rerunnability not verified.
- **Access class:** abstract/metadata-only.

### F11 — Chakraborty, Gui, Gerosa & Marciano (2024), *Testing the Validity of the Smartphone Pervasiveness Scale for Adolescents With Self-Reported Objective Smartphone Use Data*

- **DOI / primary full text:** https://doi.org/10.1177/20552076241234744 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10981259/
- **Why / rung:** 1,396 Swiss adolescents; duration, unlocks, and notifications read from settings while completing the survey; **Rung 1**.
- **Reconstruction:** **DELEGATED** to iOS/Android settings. Exact source description: participants “go into their smartphone Settings” and report last-week averages. No episode rule or threshold available.
- **Availability:** peer-reviewed OA full text; vendor aggregates only, so event reconstruction cannot be rerun.
- **Access class:** peer-reviewed full text.

### F12 — Geyer, Carbonell, Beranuy & Calvo (2021), *Absence of Objective Differences Between Self-Identified Addicted and Healthy Smartphone Users?*

- **DOI / primary full text:** https://doi.org/10.3390/ijerph18073702 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC8037484/
- **Why / rung:** contradiction paper: self-identification/problematic-use labels need not correspond to objective use; **Rung 1** device records.
- **Reconstruction:** **DELEGATED/ABSENT** at event level; objective summaries are used, but no raw-event pairing rule or session threshold is stated.
- **Availability:** peer-reviewed OA full text; no rerunnable raw events verified.
- **Access class:** peer-reviewed full text.

### F13 — Khoo & Yang (2021), *Smartphone Addiction and Checking Behaviors Predict Aggression: A Structural Equation Modeling Approach*

- **DOI / primary full text:** https://doi.org/10.3390/ijerph182413020 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC8700868/
- **Why / rung:** psychological scale/objective checking-behavior comparison; helps separate a problematic-use construct from actual frequency; **Rung 1**.
- **Reconstruction:** **DELEGATED** to device summaries; no event reconstruction or checking threshold was recovered from the method fields.
- **Availability:** peer-reviewed OA full text; no raw event/code deposit verified.
- **Access class:** peer-reviewed full text.

### F14 — Lin et al. (2015), *Time Distortion Associated With Smartphone Addiction: Identifying Smartphone Addiction via a Mobile Application*

- **DOI / primary record:** https://doi.org/10.1016/j.jpsychires.2015.04.003 ; https://pubmed.ncbi.nlm.nih.gov/25935253/
- **Why / rung:** early psychiatry study contrasting app-recorded use with clinician-assisted self-report and theorizing time distortion; **Rung 3**.
- **Reconstruction:** **UNDETERMINED**; abstract confirms app-recorded total use, but no session rule/threshold is visible without full text.
- **Availability:** abstract only in this pass; code/data not verified.
- **Access class:** abstract/metadata-only.

### F15 — Lin et al. (2017), *Incorporation of Mobile Application (App) Measures Into the Diagnosis of Smartphone Addiction*

- **DOI / primary page:** https://doi.org/10.4088/JCP.15m10310
- **Why / rung:** clinical diagnostic validation integrating app measures with self-report; **Rung 3**.
- **Reconstruction:** **UNDETERMINED**; no accessible source-level rule or threshold recovered.
- **Availability:** publisher record/abstract; app code/data not verified.
- **Access class:** abstract/metadata-only.

### F16 — Montag et al. (2015), *Recorded Behavior as a Valuable Resource for Diagnostics in Mobile Phone Addiction: Evidence From Psychoinformatics*

- **DOI / primary full text:** https://doi.org/10.3390/bs5040434
- **Why / rung:** early psychoinformatics comparison of recorded behavior and self-report addiction constructs; **Rung 3** (research app).
- **Reconstruction:** **ABSENT** at the event-to-episode level in the audited article fields; no inactivity threshold verified.
- **Availability:** peer-reviewed OA full text; research app named, but a public raw-log reconstruction package was not verified.
- **Access class:** peer-reviewed full text.

### F17 — Elhai et al. (2018), *Depression and Emotion Regulation Predict Objective Smartphone Use Measured Over One Week*

- **DOI / primary page:** https://doi.org/10.1016/j.paid.2017.04.051
- **Why / rung:** tests whether psychological variables relate to objective rather than merely perceived use; **Rung 3**.
- **Reconstruction:** **UNDETERMINED**; abstract confirms one-week objective measurement but not how raw events became duration.
- **Availability:** abstract/metadata; code/data not verified.
- **Access class:** abstract/metadata-only.

### F18 — Prasad et al. (2018), *A Study of Magnitude and Psychological Correlates of Smartphone Use in Medical Students: A Pilot Study With a Novel Telemetric Approach*

- **DOI / primary full text:** https://doi.org/10.4103/IJPSYM.IJPSYM_133_18 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC6129009/
- **Why / rung:** medical-student behavioral telemetry versus questionnaire constructs; **Rung 3**.
- **Reconstruction:** **UNDETERMINED**; telemetry is described, but no verified event-pairing rule/threshold was recovered.
- **Availability:** peer-reviewed OA full text; no code/raw event deposit verified.
- **Access class:** peer-reviewed full text.

### F19 — Bhat, Shi, Song, Yoo & Saha (2026), *“In My Defense, Only Three Hours on Instagram”: Designing Toward Digital Self-Awareness and Wellbeing*

- **DOI / full text:** https://doi.org/10.1145/3772318.3790263 ; https://arxiv.org/abs/2509.21860
- **Why / rung:** CHI HCI probe turns the estimated–actual gap itself into a reflection intervention; app-category disagreement is central; **Rung 1** vendor usage summary.
- **Reconstruction:** **DELEGATED** to default Android/iOS app-category summaries; no raw-event rule or threshold. The paper defines signed estimated-minus-actual gaps, SMAPE, and paired tests rather than reconstructing episodes.
- **Availability:** peer-reviewed ACM paper plus author preprint; study materials/raw vendor events not verified.
- **Access class:** author preprint/full manuscript.

### F20 — Ventura et al. (2025), *Objective vs. Perceived Maternal Smartphone Use and Observed Mother-Infant Interaction Quality*

- **DOI / primary full text:** https://doi.org/10.3389/fdpys.2025.1686250
- **Why / rung:** maternal/infant study combining passive sensing, perceived use, EMA, and observation; **Rung 3**.
- **Reconstruction:** **UNDETERMINED** for event-to-episode processing; the full article is open, but no source-level rule was recovered during this pass. Threshold not verified.
- **Availability:** peer-reviewed OA full text; public code/data not verified.
- **Access class:** peer-reviewed full text.

### F21 — McDaniel et al. (2024), *Heavy Users, Mobile Gamers, and Social Networkers: Patterns of Objective Smartphone Use in Parents of Infants…*

- **DOI / primary full text:** https://doi.org/10.1155/2024/3601969
- **Why / rung:** parent/infant sample; objective app-use profiles supplement parent self-report over eight days; **Rung 3**.
- **Reconstruction:** **UNDETERMINED**; no exact raw-event episode rule or threshold retrieved.
- **Availability:** OA article; code/data deposit not verified.
- **Access class:** peer-reviewed full text.

### F22 — Parker et al. (2022), *Feasibility of Measuring Screen Time, Activity, and Context Among Families With Preschoolers: Intensive Longitudinal Pilot Study*

- **DOI / primary full text:** https://doi.org/10.2196/40572 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC9562053/
- **Why / rung:** family/preschool intensive longitudinal methods across passive measurement and self-report context; mixed platform instruments; **Rung 1/3**.
- **Reconstruction:** **UNDETERMINED** at event-to-episode level; no verified global gap threshold. Platform-specific acquisition prevents treating the logged side as a single homogeneous referent.
- **Availability:** peer-reviewed OA full text; public reconstruction code/data not verified.
- **Access class:** peer-reviewed full text.

## B. Communication, web-meter, news, and media-exposure validation (11)

### F23 — Kobayashi & Boase (2012), *No Such Effect? The Implications of Measurement Error in Self-Report Measures of Mobile Communication Use*

- **DOI / author manuscript:** https://doi.org/10.1080/19312458.2012.679243 ; https://jboase.com/wp-content/uploads/2023/08/No-such-effect-The-implications-of-non-random-error-in-self-report-measures-of-mediated-communication.pdf
- **Why / rung:** n=310 Android users; self-reported call/SMS/Gmail frequency versus automatically collected logs; shows nonrandom error can create spurious effects; **Rung 4 for call/message event counts** (no episode durations needed).
- **Reconstruction:** **N/A** for duration episodes; counts are direct call/message records. No threshold. The manuscript describes “voice call, SMS, and Gmail logs” merged with surveys.
- **Availability:** author manuscript; app/data/code deposit not verified.
- **Access class:** author manuscript.

### F24 — Junco (2013), *Comparing Actual and Self-Reported Measures of Facebook Use*

- **DOI / primary page:** https://doi.org/10.1016/j.chb.2012.11.007
- **Why / rung:** one-month computer monitoring versus time and login self-reports; foundational platform-specific validation; **Rung 3** vendor monitoring software.
- **Reconstruction:** **DELEGATED/UNDETERMINED**; the abstract confirms monitoring but not the active-window/session construction.
- **Availability:** publisher abstract; monitoring software and data not verified.
- **Access class:** abstract/metadata-only.

### F25 — Henderson, Jiang, Johnson & Porter (2021; online 2019), *Measuring Twitter Use: Validating Survey-Based Measures*

- **DOI / primary page:** https://doi.org/10.1177/0894439319896244
- **Why / rung:** survey frequency versus observed Twitter activities over 1–114 months; behavior-specific discrepancies; **Rung 4** platform action records, not duration episodes.
- **Reconstruction:** **N/A** for sessions; observed posts/retweets/media/DM counts. Data statement: anonymized monthly activity counts available on request; no episode threshold.
- **Availability:** publisher full page; replication data on request, excluding identifiers/content.
- **Access class:** abstract/metadata-only.

### F26 — Cardenal, Victoria-Mas, Majó-Vázquez & Lacasa-Mas (2022), *Assessing the Validity of Survey Measures for News Exposure Through Digital Footprints: Evidence From Spain and the UK*

- **DOI / primary page:** https://doi.org/10.1080/10584609.2022.2090038
- **Why / rung:** cross-national survey-versus-digital-footprint validation; **Rung 3** web tracking.
- **Reconstruction:** **UNDETERMINED**; no verified visit/session rule or threshold recovered from accessible metadata.
- **Availability:** publisher record; code/data status not verified.
- **Access class:** abstract/metadata-only.

### F27 — González-Bailón & Xenos (2022), *The Blind Spots of Measuring Online News Exposure: A Comparison of Self-Reported and Observational Data in Nine Countries*

- **DOI / stable full text:** https://doi.org/10.1080/1369118X.2022.2072750 ; https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3522774
- **Why / rung:** nine-country, five-year comparison; directly rejects the idea that observational measures are error-free; **Rung 3** tracking panels.
- **Reconstruction:** **DELEGATED/UNDETERMINED** to observational panel instrumentation. No source-level session rule recovered.
- **Availability:** peer-reviewed article plus SSRN manuscript; underlying commercial panel data not publicly rerunnable.
- **Access class:** author preprint/manuscript.

### F28 — Vraga & Tully (2018), *Who Is Exposed to News? It Depends on How You Measure: Examining Self-Reported Versus Behavioral News Exposure Measures*

- **DOI / primary page:** https://doi.org/10.1177/0894439318812050
- **Why / rung:** compares immediate self-reports with behavior on a news aggregator; **Rung 4** page/story actions. **EXPLICIT CONSTRUCTION/INSTRUMENT ATTRIBUTION** at the measure-definition level: inferred exposure differs by measurement implementation.
- **Reconstruction:** **N/A** for sessions; story selection is an event. No threshold.
- **Availability:** publisher page; code/data not verified.
- **Access class:** abstract/metadata-only.

### F29 — Lovett & Peres (2018), *Mobile Diaries—Benchmark Against Metered Measurements: An Empirical Investigation*

- **DOI / author full text:** https://doi.org/10.1016/j.ijresmar.2018.01.002 ; https://openscholar.huji.ac.il/sites/default/files/businesshe/files/2018_mobile_diaries_ijrm_2018_35_2.pdf
- **Why / rung:** mobile diary television reports benchmarked against Nielsen People Meter records; demonstrates both diary omissions and non-metered-device/out-of-home omissions; **Rung 1** commercial meter.
- **Reconstruction:** **DELEGATED** to Nielsen; no meter episode rule exposed. Mismatches were attributed to short viewing, no-alarm periods, reporting inactivity, out-of-home viewing, and non-metered devices.
- **Availability:** author full text; Nielsen data proprietary, not rerunnable.
- **Access class:** author manuscript/full text.

### F30 — Shalev, Naab & Tsfati (2025), *Self-Reporting News Use in Situ and in Retrospect*

- **DOI / primary full text:** https://doi.org/10.1093/ijpor/edaf027 ; https://madoc.bib.uni-mannheim.de/71897/1/edaf027.pdf
- **Why / rung:** adjacent contrast—retrospective versus repeated in-situ self-report across TV, sites, and social media; useful control showing discrepancy without any logger; **N/A**.
- **Reconstruction:** **N/A**; aggregated ESM versus retrospective reports, no device events or threshold.
- **Availability:** peer-reviewed OA full text; analysis materials not verified.
- **Access class:** peer-reviewed full text.

### F31 — Prior (2009), *The Immensely Inflated News Audience: Assessing Bias in Self-Reported News Exposure*

- **DOI / author full text:** https://doi.org/10.1093/poq/nfp002 ; https://mprior.scholar.princeton.edu/document/41
- **Why / rung:** survey estimates benchmarked to Nielsen audience estimates; classic contradiction/validation anchor; **Rung 1** aggregate meter.
- **Reconstruction:** **DELEGATED** to Nielsen; no audience-construction rule or session threshold in the validation paper.
- **Availability:** author full text; underlying Nielsen data proprietary.
- **Access class:** author manuscript/full text.

### F32 — de Vreese & Neijens (2016), *Measuring Media Exposure in a Changing Communications Environment*

- **DOI / repository full text:** https://doi.org/10.1080/19312458.2016.1150441 ; https://pure.uva.nl/ws/files/2746803/178756_542408.pdf
- **Why / rung:** field-level communication methods review balancing self-report and passive measurement; **N/A**.
- **Reconstruction:** **N/A**; conceptual review, no empirical event stream or threshold.
- **Availability:** peer-reviewed repository full text; not a rerunnable study.
- **Access class:** peer-reviewed full text.

### F33 — Dvir-Gvirsman, Tsfati & Menchen-Trevino (2016; online 2014), *The Extent and Nature of Ideological Selective Exposure Online: Combining Survey Responses With Actual Web Log Data From the 2013 Israeli Elections*

- **DOI / primary record:** https://doi.org/10.1177/1461444814549041
- **Why / rung:** combines surveys with actual web logs and explicitly notes surveys are less reliable for media preferences; **Rung 3** web logs.
- **Reconstruction:** **UNDETERMINED**; no verified page-visit/session rule or threshold recovered.
- **Availability:** publisher record; data/code availability not verified.
- **Access class:** abstract/metadata-only.

## C. Epidemiology and operator-record validation (13)

### F34 — Samkange-Zeeb, Berg & Blettner (2004), *Validation of Self-Reported Cellular Phone Use*

- **DOI / primary page:** https://doi.org/10.1038/sj.jea.7500321
- **Why / rung:** Interphone questionnaire validation against network-provider records for 68 participants; **Rung 1** provider records.
- **Reconstruction:** **N/A** for inferred episodes: number and cumulative duration of calls came from provider records. No session threshold; provider billing semantics are delegated.
- **Availability:** publisher full page/abstract; underlying operator data and processing code unavailable.
- **Access class:** abstract/metadata-only.

### F35 — Inyang, Benke, Morrissey, McKenzie & Abramson (2009), *How Well Do Adolescents Recall Use of Mobile Telephones? Results of a Validation Study*

- **DOI / primary full text:** https://doi.org/10.1186/1471-2288-9-36 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC2702336/
- **Why / rung:** adolescent recall validated using software-modified phones recording number and duration of calls; **Rung 4** call events.
- **Reconstruction (DECLARED at acquisition level, Methods):** software-modified phones “logged data such as number and duration of calls using a 2.5 second data collection rate.” Call boundaries are telephony events, not inferred sessions; no inactivity threshold.
- **Availability:** peer-reviewed OA full text; modified-phone software/data not deposited.
- **Access class:** peer-reviewed full text.

### F36 — Mireku et al. (2018), *Total Recall in the SCAMP Cohort: Validation of Self-Reported Mobile Phone Use in the Smartphone Era*

- **DOI / primary full text:** https://doi.org/10.1016/j.envres.2017.10.034 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC5773244/
- **Why / rung:** adolescents, operator traffic versus weekday/weekend recall for calls/text/data; crucial contradiction that operator records are incomplete for Wi-Fi smartphone use; **Rung 1**.
- **Reconstruction:** **N/A** for call sessions; provider traffic measures are supplied. No gap threshold. Coverage limitation is explicit in Conclusions: operator data “are not the gold standard” for adolescents because use over Wi-Fi is missed.
- **Availability:** peer-reviewed OA manuscript/full text; confidential operator data not rerunnable.
- **Access class:** peer-reviewed full text.

### F37 — Shum, Kelsh, Sheppard & Zhao (2011; online 2010), *An Evaluation of Self-Reported Mobile Phone Use Compared to Billing Records Among a Group of Engineers and Scientists*

- **DOI / primary record:** https://doi.org/10.1002/bem.20613 ; https://pubmed.ncbi.nlm.nih.gov/20857456/
- **Why / rung:** adult occupational sample, billing records versus self-report; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED** to provider billing events; no inferred episode threshold.
- **Availability:** abstract only; billing records and code unavailable.
- **Access class:** abstract/metadata-only.

### F38 — Heinävaara, Tokola, Kurttio & Auvinen (2011), *Validation of Exposure Assessment and Assessment of Recruitment Methods for a Prospective Cohort Study of Mobile Phone Users (COSMOS) in Finland: A Pilot Study*

- **DOI / primary full text:** https://doi.org/10.1186/1476-069X-10-14 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC3060859/
- **Why / rung:** large operator/self-report comparison and cohort recruitment assessment; **Rung 1**.
- **Reconstruction:** **N/A** for episodes; monthly call duration/count were operator-derived. No session threshold.
- **Availability:** peer-reviewed OA full text; operator records not public, analysis not fully rerunnable.
- **Access class:** peer-reviewed full text.

### F39 — Vrijheid et al., Interphone Study Group (2006), *Validation of Short Term Recall of Mobile Phone Use for the Interphone Study*

- **DOI / primary full text:** https://doi.org/10.1136/oem.2004.019281 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC2078087/
- **Why / rung:** 672 volunteers in 11 countries, recalled calls versus operator/software-modified-phone records; **Rung 4** call events / **Rung 1** provider records.
- **Reconstruction (DECLARED, Methods “Actual phone use”):** operators recorded “date, time, and duration of each call”; modified phones recorded “date, starting time, and duration of each call.” Monthly count and duration were direct aggregates; no session threshold.
- **Availability:** peer-reviewed OA full text; operator/SMP records not deposited.
- **Access class:** peer-reviewed full text.

### F40 — Vrijheid, Deltour, Krewski, Sanchez & Cardis (2006), *The Effects of Recall Errors and of Selection Bias in Epidemiologic Studies of Mobile Phone Use and Cancer Risk*

- **DOI / primary page:** https://doi.org/10.1038/sj.jes.7500509
- **Why / rung:** simulation/meta-method paper propagating empirically observed recall and selection errors into risk estimates; **N/A**.
- **Reconstruction:** **N/A**; no new device episodes. Error distributions are inputs to simulations, not usage reconstruction thresholds.
- **Availability:** publisher page; simulation code/data not verified.
- **Access class:** abstract/metadata-only.

### F41 — Vrijheid et al. (2009; online 2008), *Recall Bias in the Assessment of Exposure to Mobile Phones*

- **DOI / primary page:** https://doi.org/10.1038/jes.2008.27
- **Why / rung:** case/control validation against operator records; tests differential recall, not just average inaccuracy; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED** to operator records; no inferred-session threshold.
- **Availability:** publisher article record; underlying operator data unavailable.
- **Access class:** abstract/metadata-only.

### F42 — Reedijk et al. (2024), *Regression Calibration of Self-Reported Mobile Phone Use to Optimize Quantitative Risk Estimation in the COSMOS Study*

- **DOI / primary record:** https://doi.org/10.1093/aje/kwae039 ; https://pubmed.ncbi.nlm.nih.gov/38751312/
- **Why / rung:** modern epidemiologic correction using repeated self-report and operator data; **Rung 1** plus statistical calibration.
- **Reconstruction:** **N/A** for episodes; provider usage is the validation measure. Threshold/provenance applies to calibration models, not sessions.
- **Availability:** primary abstract; simulation/data/code availability not verified.
- **Access class:** abstract/metadata-only.

### F43 — Tokola, Kurttio, Salminen & Auvinen (2008), *Reducing Overestimation in Reported Mobile Phone Use Associated With Epidemiological Studies*

- **DOI / primary record:** https://doi.org/10.1002/bem.20424 ; https://pubmed.ncbi.nlm.nih.gov/18521851/
- **Why / rung:** self-report versus operator records, then bias-correction model; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED**; average calling time comes from operator records, no session threshold.
- **Availability:** abstract only; operator data/model code not public.
- **Access class:** abstract/metadata-only.

### F44 — Timotijevic, Barnett, Shepherd & Senior (2009), *Factors Influencing Self-Report of Mobile Phone Use: The Role of Response Prompt, Time Reference and Mobile Phone Use in Recall*

- **DOI / primary metadata:** https://doi.org/10.1002/acp.1496 ; https://researchportal.bath.ac.uk/en/publications/factors-influencing-self-report-of-mobile-phone-use-the-role-of-r/
- **Why / rung:** experimental manipulation of recall prompt/reference window matched to actual calls; **Rung 4** direct call records.
- **Reconstruction:** **N/A**; actual call number/duration are telephony records, not reconstructed sessions. No inactivity threshold.
- **Availability:** institutional metadata/abstract; full text, call records, and code not verified.
- **Access class:** abstract/metadata-only.

### F45 — Aydin et al. (2011), *Impact of Random and Systematic Recall Errors and Selection Bias in Case-Control Studies on Mobile Phone Use and Brain Tumors in Adolescents (CEFALO Study)*

- **DOI / primary page:** https://doi.org/10.1002/bem.20651
- **Why / rung:** adolescent-specific epidemiologic measurement-error propagation; **N/A/Rung 1** operator-validation inputs.
- **Reconstruction:** **N/A** for episodes; no session threshold.
- **Availability:** publisher abstract; data/code not verified.
- **Access class:** abstract/metadata-only.

### F46 — Vergnaud et al. (2016), *Validation of Objective Records and Misreporting of Personal Radio Use in a Cohort of British Police Forces (Airwave Health Monitoring Study)*

- **DOI / primary page:** https://doi.org/10.1016/j.envres.2016.04.018
- **Why / rung:** adjacent occupational epidemiology showing record/self-report misclassification; **Rung 1** administrative records.
- **Reconstruction:** **N/A**; recorded radio usage is not inferred from foreground app episodes. No threshold.
- **Availability:** publisher record; cohort records not public, code not verified.
- **Access class:** abstract/metadata-only.

## D. Digital-trace, mobile-sensing, platform, and preprocessing error (13)

### F47 — Sen, Flöck, Weller, Weiß & Wagner (2021), *A Total Error Framework for Digital Traces of Human Behavior on Online Platforms*

- **DOI / primary full text:** https://doi.org/10.1093/poq/nfab018 ; https://academic.oup.com/poq/article/85/S1/399/6359490
- **Why / rung:** general error framework; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** This is the cleanest theoretical citation for preprocessing-created measurement error.
- **Reconstruction:** **N/A**; exact quote, §Data Preprocessing: “Although the goal of trace preprocessing is to improve measurement, it can inadvertently introduce a type of measurement error.” No session threshold because the paper is a framework.
- **Availability:** peer-reviewed OA full text; framework, not rerunnable empirical pipeline.
- **Access class:** peer-reviewed full text.

### F48 — Bosch & Revilla (2022), *When Survey Science Met Web Tracking: Presenting an Error Framework for Metered Data*

- **DOI / primary full text:** https://doi.org/10.1111/rssa.12956 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10100245/
- **Why / rung:** metered-data total-error framework covering processing, devices, browsers, and linkage; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** It prevents treating the tracker as a gold standard by default.
- **Reconstruction:** **N/A**; the framework explicitly includes processing as a measurement-error stage. Session thresholds are study-specific, not prescribed.
- **Availability:** peer-reviewed OA full text; conceptual framework and examples, not a single rerunnable pipeline.
- **Access class:** peer-reviewed full text.

### F49 — [BOUNDARY RE-AUDIT] Bosch, Sturgis, Kuha & Revilla (2024), *Uncovering Digital Trace Data Biases: Tracking Undercoverage in Web Tracking Data*

- **DOI / primary full text:** https://doi.org/10.1080/19312458.2024.2393165
- **Why / rung:** empirically measures missing devices/browsers in standard web tracking; **Rung 3** commercial meter. **EXPLICIT CONSTRUCTION ATTRIBUTION.** It shows a self-report/meter mismatch can arise because the meter did not cover the behavior.
- **Reconstruction:** **DELEGATED** to Wakoopa for URL/app/timestamp capture; no visit-session rule central to the paper. Coverage rule is explicit: relevant devices/browsers not tracked create incomplete individual measures.
- **Availability:** peer-reviewed OA publisher full text; commercial raw meter implementation is not fully rerunnable.
- **Access class:** peer-reviewed full text.

### F50 — Bähr, Haas, Keusch, Kreuter & Trappmann (2022; online 2020), *Missing Data and Other Measurement Quality Issues in Mobile Geolocation Sensor Data*

- **DOI / primary full text:** https://doi.org/10.1177/0894439320944118
- **Why / rung:** stage model of mobile sensor missingness; **Rung 4** raw sensor collection. **EXPLICIT CONSTRUCTION ATTRIBUTION.** Manufacturer, OS settings, research-app design, third-party apps, and participant handling interfere with measurement.
- **Reconstruction:** **N/A** for usage episodes. Exact quote, opening framework: “device-related error sources, such as the manufacturer and operating system settings, design decisions of the research app, third-party apps, and the participant, can interfere with the measurement.”
- **Availability:** peer-reviewed publisher full text; app/data availability not verified here.
- **Access class:** peer-reviewed full text.

### F51 — Currey & Torous (2023), *Increasing the Value of Digital Phenotyping Through Reducing Missingness: A Retrospective Review and Analysis of Prior Studies*

- **DOI / primary full text:** https://doi.org/10.1136/bmjment-2023-300718 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10231441/
- **Why / rung:** 1,178 participants across mindLAMP studies; quantifies OS/app-engagement effects on coverage; **Rung 4** sensors. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A** for usage episodes. Exact result: after three days without app engagement, average GPS/accelerometer coverage decreased **19%**; paper notes an OS may halt collection after non-use.
- **Availability:** peer-reviewed OA full text; combined retrospective cohorts, public raw data/code not verified.
- **Access class:** peer-reviewed full text.

### F52 — Tonti, Marzolini & Bulgheroni (2021), *Smartphone-Based Passive Sensing for Behavioral and Physical Monitoring in Free-Life Conditions: Technical Usability Study*

- **DOI / primary full text:** https://doi.org/10.2196/15417 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC11041439/
- **Why / rung:** technical validation under Android fragmentation and power-saving policies; **Rung 4** sensors. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A** for app-use episodes; missingness is attributed to OS power-saving behavior. No session threshold.
- **Availability:** peer-reviewed OA full text; platform/app source and data availability not verified.
- **Access class:** peer-reviewed full text.

### F53 — Onnela (2020), *Opportunities and Challenges in the Collection and Analysis of Digital Phenotyping Data*

- **DOI / primary full text:** https://doi.org/10.1038/s41386-020-0771-3 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC7688649/
- **Why / rung:** distinguishes sensors from logs and explains temporal/permission coverage; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A**; exact methodological point: a research app must request sensor access and collection starts only once it runs, while some logs predate installation. This defines what can and cannot be present before preprocessing.
- **Availability:** peer-reviewed OA full text; conceptual/methods review.
- **Access class:** peer-reviewed full text.

### F54 — Kiang et al. (2021), *Sociodemographic Characteristics of Missing Data in Digital Phenotyping*

- **DOI / primary full text:** https://doi.org/10.1038/s41598-021-94516-7 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC8322366/
- **Why / rung:** six-study Beiwe meta-study; OS-related GPS noncollection and longitudinal decay; **Rung 4**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A** for usage episodes. Missingness is divided into “missingness by design” and “sensor non-collection”; iOS had lower GPS noncollection than Android.
- **Availability:** peer-reviewed OA full text; Beiwe and Forest are open source, but participant sensor data are not stated as public.
- **Access class:** peer-reviewed full text.

### F55 — Halabi et al. (2024), *Comparative Assessment of Multimodal Sensor Data Quality Collected Using Android and iOS Smartphones in Real-World Settings*

- **DOI / primary full text:** https://doi.org/10.3390/s24196246 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC11478693/
- **Why / rung:** direct Android/iOS sensor-quality comparison; **Rung 4**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** Data completeness/noise/sampling differ by OS and sensor.
- **Reconstruction:** **N/A** for usage episodes; quote-level result from the article: combined sensor data had lower missingness for iOS than Android, with battery/memory management and OS constraints among causes.
- **Availability:** peer-reviewed OA full text; raw WASH data/code availability not verified.
- **Access class:** peer-reviewed full text.

### F56 — Trifan, Oliveira & Oliveira (2019), *Passive Sensing of Health Outcomes Through Smartphones: Systematic Review of Current Solutions and Possible Limitations*

- **DOI / primary full text:** https://doi.org/10.2196/12649 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC6729117/
- **Why / rung:** systematic review of 118 systems; documents Android/iOS capability asymmetry; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A**; exact platform limitation: iOS “hampers third-party apps to run endlessly in background,” affecting collection. Only 6/118 systems supported both Android and iOS.
- **Availability:** peer-reviewed OA full text; review extraction rather than rerunnable usage processing.
- **Access class:** peer-reviewed full text.

### F57 — Teh, Kempa-Liehr & Wang (2020), *Sensor Data Quality: A Systematic Review*

- **DOI / primary full text:** https://doi.org/10.1186/s40537-020-0285-1
- **Why / rung:** cross-domain taxonomy of sensor data-quality problems and processing; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION** at the generic sensor-processing layer.
- **Reconstruction:** **N/A**; no smartphone usage sessions or threshold. Retained as adjacent methods vocabulary for completeness, accuracy, consistency, and preprocessing.
- **Availability:** peer-reviewed OA full text; review methods reproducibility depends on reported search, not event logs.
- **Access class:** peer-reviewed full text.

### F58 — Boonstra et al. (2018), *Using Mobile Phone Sensor Technology for Mental Health Research: Integrated Analysis to Identify Hidden Challenges and Potential Solutions*

- **DOI / primary full text:** https://doi.org/10.2196/10131 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC6552406/
- **Why / rung:** integrated technical/user analysis of a mental-health sensing app; **Rung 4**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** Hidden technical failures shape apparently behavioral data.
- **Reconstruction:** **N/A** for app-use episodes; sensor gaps/technical challenges are the object. No session threshold.
- **Availability:** peer-reviewed OA full text plus arXiv manuscript (`https://arxiv.org/abs/1805.09158`); app/raw data deposit not verified.
- **Access class:** peer-reviewed full text.

### F59 — Alam et al. (2025), *Challenges and Standardisation Strategies for Sensor-Based Data Collection for Digital Phenotyping*

- **DOI / primary full text:** https://doi.org/10.1038/s43856-025-01013-3
- **Why / rung:** current standardization review; device/OS/app-development heterogeneity and provenance; **N/A**. **EXPLICIT CONSTRUCTION ATTRIBUTION.** 
- **Reconstruction:** **N/A**; the review states that devices/OSs have different hardware/software ecosystems and that cross-platform versus native development changes collection reliability.
- **Availability:** peer-reviewed OA full text; review, no single rerunnable pipeline.
- **Access class:** peer-reviewed full text.

## E. Data donation, omission, compliance, and platform-specific trace bias (9)

### F60 — Boeschoten, Ausloos, Möller, Araujo & Oberski (2022), *A Framework for Privacy Preserving Digital Trace Data Collection Through Data Donation*

- **DOI / repository full text:** https://doi.org/10.5117/CCR2022.2.002.BOES ; https://dspace.library.uu.nl/handle/1874/425114
- **Why / rung:** total-error framework and blueprint for DDP donation; **N/A/Rung 1** platform packages.
- **Reconstruction:** **DELEGATED** to the platform’s DDP schema; no session threshold. The framework treats representativeness and measurement quality as trace-side error sources rather than assuming DDP completeness.
- **Availability:** peer-reviewed OA full text; framework/checklist available, no single empirical raw dataset.
- **Access class:** peer-reviewed full text.

### F61 — Ohme & Araujo (2022), *Digital Data Donations: A Quest for Best Practices*

- **DOI / primary full text:** https://doi.org/10.1016/j.patter.2022.100467 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC9023895/
- **Why / rung:** methods commentary on privacy protection, meaningful extraction, and user agency; **N/A**.
- **Reconstruction:** **N/A/DELEGATED**; it reviews DDP extraction rather than defining usage episodes. No threshold.
- **Availability:** peer-reviewed OA full text; PORT tools are discussed, but this is not a rerunnable empirical study.
- **Access class:** peer-reviewed full text.

### F62 — [BOUNDARY RE-AUDIT] Ohme et al. (2024; online 2023), *Digital Trace Data Collection for Social Media Effects Research: APIs, Data Donation, and (Screen) Tracking*

- **DOI / primary full text:** https://doi.org/10.1080/19312458.2023.2181319 ; https://research-portal.uu.nl/files/225006779/Digital_Trace_Data_Collection_for_Social_Media_Effects_Research_APIs_Data_Donation_and_Screen_Tracking.pdf
- **Why / rung:** compares platform-centric APIs with user-centric DDP and screen tracking; **N/A/mixed rungs**.
- **Reconstruction:** **N/A/DELEGATED**; method comparison, no universal session rule. Crucial for identifying which collection route can observe content versus duration.
- **Availability:** peer-reviewed repository full text; illustrative workflow, not a single public dataset.
- **Access class:** peer-reviewed full text.

### F63 — de León et al. (2026), *How Much Data Should I Request? Balancing Richness and Compliance in Digital Trace Data Donations*

- **DOI / primary full text:** https://doi.org/10.1177/08944393261435088
- **Why / rung:** randomized Facebook/Instagram experiment comparing a default one-year versus all-time DDP request; demonstrates requested temporal scope changes compliance and dataset characteristics; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED** to platform DDPs; temporal request window is the declared construction parameter. No episode threshold.
- **Availability:** peer-reviewed OA publisher full text; supplementary materials linked by publisher, raw personal DDPs appropriately restricted.
- **Access class:** peer-reviewed full text.

### F64 — Wedel & Ohme (2026), *Longitudinal Data Donation Behavior and Data Omission Across Four Social Media Platforms*

- **DOI / primary full text:** https://doi.org/10.5117/CCR2026.1.3.WEDE
- **Why / rung:** two-wave TikTok/YouTube/Facebook/Instagram donation; participant deletion materially compromises completeness; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED**; omission is a declared trace-selection rule, not an episode threshold.
- **Availability:** peer-reviewed OA full text and supplement links; personal DDP data not assumed public.
- **Access class:** peer-reviewed full text.

### F65 — Wedel, Ohme, Mayer, Gaisbauer & Fan (2026; online 2025), *The Platform Matters: Cross-Platform Differences in Data Donation Willingness, Behavior, and Bias*

- **DOI / primary full text:** https://doi.org/10.1080/19312458.2025.2605946
- **Why / rung:** n=2,296 across YouTube/Facebook/Instagram/TikTok; platform-specific donation and nonresponse biases; **Rung 1**.
- **Reconstruction:** **N/A/DELEGATED**; DDP schemas are platform-defined. No episode threshold.
- **Availability:** peer-reviewed OA full text with supplement link; donated packages not assumed public.
- **Access class:** peer-reviewed full text.

### F66 — Hase & Haim (2024), *Can We Get Rid of Bias? Mitigating Systematic Error in Data Donation Studies Through Survey Design Strategies*

- **DOI / primary full text:** https://doi.org/10.5117/CCR2024.2.2.HASE
- **Why / rung:** directly frames data-donation bias and correction; **N/A/Rung 1**.
- **Reconstruction:** **N/A** for usage episodes; survey-design strategies target donor/nonresponse error, not event thresholds.
- **Availability:** peer-reviewed OA full text; materials availability not verified.
- **Access class:** peer-reviewed full text.

### F67 — [BOUNDARY RE-AUDIT] Asensio, Bosch & Roberts (2025), *What Is the Best Way of Collecting Data Donations? An Experiment Assessing the Feasibility of Different Data Donation Approaches to Measure Mobile and App Usage*

- **DOI / primary full text:** https://doi.org/10.1080/1369118X.2025.2570738
- **Why / rung:** directly compares screenshot, video, and enhanced-recall approaches; valid compliance depends strongly on acquisition design; **Rung 1** vendor screens/donations.
- **Reconstruction:** **DELEGATED** to vendor usage displays; acquisition route is experimentally varied, no raw event rule or session threshold.
- **Availability:** peer-reviewed OA publisher full text; experimental materials/supplement linked, raw donations restricted.
- **Access class:** peer-reviewed full text.

### F68 — Keusch, Pankowska, Cernat & Bach (2024), *Do You Have Two Minutes to Talk About Your Data? Willingness to Participate and Nonparticipation Bias in Facebook Data Donation*

- **DOI / primary full text:** https://doi.org/10.1177/1525822X231225907
- **Why / rung:** >900 German Facebook users; actual donation/nonparticipation rather than hypothetical willingness; **Rung 1** DDP.
- **Reconstruction:** **N/A/DELEGATED**; Facebook package construction is outside the study and no session threshold is used.
- **Availability:** peer-reviewed publisher full text; data availability statement present, but public raw DDP access not verified.
- **Access class:** peer-reviewed full text.

## Ranked citation threats / strongest additions

1. **F01 Katapally & Chu (2019)** — strongest net-new direct threat. It does not merely compare self-report with a log: it constructs the log under a grid of 5 notification filters × 7 long-session caps × a 10-hour/day rule, then reports that agreement/difference changes across those choices. Any novelty claim that no direct discrepancy paper varies objective-log preprocessing is false without acknowledging this study.
2. **Existing Ernala et al. (2020)** — remains the strongest direct app/server-log precedent because it declares its rule and sensitivity test. F01 now shows it is not the only direct-discrepancy study to expose a construction grid.
3. **F47 Sen et al. (2021) + F48 Bosch & Revilla (2022)** — make a broad theoretical claim that preprocessing can introduce measurement error. Novelty must lie in the mobile usage event→episode demonstration/reporting audit, not in first stating that trace processing can err.
4. **F49 Bosch et al. (2024)** — strongest empirical “the log is incomplete” counterweight: device/browser undercoverage can explain some self-report–meter mismatch.
5. **F03 Lee et al. (2021)** — a direct validation study states that Android cannot capture default built-in apps. Its objective total is definitionally undercovered.
6. **F36 Mireku et al. (2018)** — operator traffic is explicitly not a gold standard for adolescents because Wi-Fi use is absent. This is an unusually clear epidemiologic precedent for rejecting the logged side as complete.
7. **F50–F59 sensing-quality cluster** — multiple independent groups show OS, model, power management, app engagement, permissions, and app architecture affect capture. These are adjacent sensors rather than app-use episodes, so they support plausibility and methods framing, not a direct claim about Chronicle totals.
8. **F64/F65 data-donation papers** — participant omission and platform-specific donor bias can materially alter the observable trace population; essential if screenshots/DDPs are described as an unproblematic alternative.

## Contradictions and boundary conditions

- The discrepancy direction is not universal. Direct studies report underestimation, overestimation, null mean differences, app-category reversals, and population/context effects. F12 is especially useful: perceived “addiction” did not map cleanly onto objective differences.
- A high correlation does not imply agreement; the epidemiologic studies repeatedly show moderate/high rank correlation alongside large systematic and random error.
- Logs are not a universal gold standard. F03 misses system apps; F36 misses Wi-Fi traffic; F49 misses devices/browsers; F50–F59 document OS/app/device noncollection; F64 allows deliberate trace deletion.
- Some discrepancies are genuinely recall/mental-model effects. The broader literature on time distortion, habitual checking, fragmented use, platform swinging, and retrospective versus in-situ reports remains necessary. The construction argument should supplement, not replace, those explanations.
- F01 contradicts any claim that sensitivity analysis over logged-use construction is absent from the direct validation literature. The defensible gap is narrower: it is rare, heterogeneous, and almost never reaches app-level Android event→episode semantics.

## Expected absences / negative findings

1. No net-new study was found that takes the **same raw Android app event stream**, reconstructs episodes under several plausible event-pairing/launcher/system-app/idle-time rules, and reports how the **self-report discrepancy** changes under each rule.
2. No direct discrepancy paper was found that independently reconstructs or validates Apple Screen Time’s hidden event→aggregate rule. iOS studies delegate the referent to Apple.
3. No study was found that formalizes the human estimate and the software pipeline as two competing episode ontologies and experimentally aligns/misaligns them.
4. Exact system-app/launcher inclusion lists remain rare even when papers acknowledge coverage limits.

## Query and dead-end log

All queries were run broadly; result lists were screened for primary studies and adjacent methods, then deduplicated by DOI/title.

### Direct/synonym families

- `smartphone self-report objective logged use validation screen time discrepancy`
- `self-reported objectively measured smartphone use parents adolescents`
- `estimated actual smartphone use validation adolescents`
- `self-report logged social media use children parents`
- `actual perceived maternal smartphone use passive sensing`
- `smartphone addiction logged self-reported behavior`
- `TikTok perceived time spent server logged`
- `Twitter use validating survey observed behavior`
- `mobile communication self-report log data measurement error`

### Communication/media and adjacent benchmark families

- `self-reported tracking data media use measurement accuracy`
- `self-report digital trace media exposure validation`
- `news exposure survey digital footprints validity`
- `observational self-report online news nine countries`
- `mobile diary metered measurements`
- `Nielsen people meter self-reported exposure bias`
- `retrospective versus in situ news use`

### Epidemiology/operator-record families

- `epidemiology validation self reported mobile phone use operator records recall`
- `adolescents mobile phone calls network operator validation`
- `Interphone short-term recall operator software modified phone`
- `COSMOS self-reported operator recorded calibration`
- `billing records self reported mobile phone engineers scientists`
- `recall error selection bias mobile phone exposure`

### Construction, contradiction, negation, and platform families

- `self-report discrepancy preprocessing smartphone usage log`
- `logged use discrepancy operating system smartphone`
- `self-report vendor aggregate screen time discrepancy`
- `episode reconstruction self-report smartphone use discrepancy`
- `Android iOS self-reported objective screen time platform comparison`
- `Screen Time Digital Wellbeing agreement validation`
- `system apps self-report logged smartphone use discrepancy`
- `digital trace preprocessing measurement error`
- `web tracking undercoverage devices browsers`
- `mobile sensing missing data operating system manufacturer app design`
- `digital phenotyping Android iOS data quality missingness`

### Data-donation families

- `data donation validation self-report platform logs discrepancy`
- `social media data donation screenshot self-report accuracy`
- `data donation omissions platform logs measurement error`
- `cross-platform data donation behavior bias`
- `screenshot video enhanced recall mobile app usage donation`

### Dead ends / do not repeat unchanged

- Generic combinations of `episode reconstruction` + `self-report smartphone` were dominated by personal-memory reconstruction and unrelated clinical episode work; no qualifying direct multiverse emerged.
- `vendor aggregate` language is rarely used by discrepancy authors. Searching product names (`Screen Time`, `Digital Wellbeing`, `Battery Usage`) is more productive.
- `system apps` queries mostly return consumer support/Reddit pages; the useful scholarly hits came through Android-coverage and instrument-validation terms.
- Publisher search pages for several Elsevier/Wiley/SAGE records expose only abstracts or return access challenges. Stable author manuscripts/PMC/Europe PMC were used where available; access failure was never treated as an absent method.
- Data-donation searches can drift into willingness/privacy-only work. Only papers bearing on completeness, omission, compliance, platform differences, or mobile/app measurement were retained.
- Sensor-missingness papers do not establish smartphone-use episode error directly. They are retained as adjacent construction evidence and labeled accordingly.

## Dedup bibliography — relevant local items not counted in the 65 net-new records

The following were already itemized or explicitly identified in the local slice-F/citation-chase/dossier boundary and therefore are **not** included in the 65 net-new count: Andrews et al. (2015); Araujo et al. (2017); Baumgartner et al. (2022/2023); Boase & Ling (2013); Burnell et al. (2021); Cernat et al. (2024/2025); Coyne et al. (2023); Deng et al. (2019); Ellis et al. (2019); Ernala et al. (2020); Gower & Moreno (2018); Hodes & Thomas (2021); Irmer & Schmiedek (2023); Jones-Jang et al. (2020); Júdice et al. (2023); Kaye et al. (2020); Kristensen et al. (2022); Mahalingham et al. (2023); Marciano & Camerini; Ohme et al. (2021 mobile Screen Time donation); Parry et al. (2021); Radesky et al. (2020); Rozgonjuk et al.; Saraceni et al. (2026); Scharkow (2016); Sewall & Parry (2021); Sewall et al. (2020/2022); Shaw et al. (2020); Tkaczyk et al. (2024); Vanden Abeele et al. (2013); Verbeij et al. (2021/2022); Wade et al. (2021); Wenz et al. (2024); Zhao et al. (2025); Zhu et al. (2018). Cross-slice known items Muise et al. (2023), Ochoa & Revilla (2025), the Usage Logger paper, Jansen (2026), Parry & Toth (2025), and Winklbauer & Batinic (2026) were likewise excluded. F49 (Bosch et al. undercoverage), F62 (Ohme et al. collection-method comparison), and F67 (Asensio et al. donation-method experiment) had prior local DOI mentions; they remain in the 68-record ledger as clearly labeled re-audits but are excluded from the 65 net-new total. Wu-Ouyang & Chan was not locally itemized and is counted as net-new above.

## Bottom line for the paper

The broad literature strongly supports a two-sided measurement-error framing. Most direct discrepancy papers still attribute differences to memory, habits, time perception, or construct mismatch, but the “objective” side is visibly constructed: a direct validation study varies screen-state cut-points (F01); another excludes Android system apps (F03); operator data miss Wi-Fi (F36); web meters miss devices/browsers (F49); mobile sensors vary by OS, device, permissions, app design, power management, and engagement (F50–F59); and donations introduce platform-specific nonresponse and participant omission (F63–F68). The unoccupied empirical intersection remains narrow and clear: **a multiverse over Android app-event reconstruction rules, evaluated by how each rule changes self-report agreement and downstream conclusions.**

<!-- chatgpt-pro-delta-20260805:F -->

## Independent-review deduplication and correction note

- The independent review returned Araujo et al. (2017), Jürgens et al. (2019/2020), and Scharkow (2016). All three already occur in the repository boundary: Araujo and Scharkow are explicitly listed in this ledger’s known-item appendix, and Jürgens is item 22 in `docs/paper/citation-chase/lane-3.md` and the Winklbauer–Batinic reference inventory. They are **re-audit evidence, not net-new citations**, so the Slice F count remains **68 retained / 65 net-new**.
- The re-audit strengthens the processing-attribution reading of Araujo et al.: active-URL logic, a 120-second tablet gap, and missing-end handling make the tracked criterion operationally constructed. This does not change the count.
- F08 is corrected above to its final 2026 publication: Wang, Goetzen, Redmiles, Zannettou & Ayalon, *Self-Reported and Logged Time Spent on TikTok: The Role of Engagement and Use Fragmentation*, *Telematics and Informatics Reports* 23, 100353, [DOI 10.1016/j.teler.2026.100353](https://doi.org/10.1016/j.teler.2026.100353). The preprint and final article are one work, not two citations.

---

## Direct discrepancy and construction expansion (2026-08-06)

All 16 entries below were absent by exact stable identifier/title scan across the repository before retention. Generic clickstream/web work, questionnaire-only “addiction” studies, and device-outcome papers without a comparison or decision-relevant construction mechanism were excluded.

### F69. Li, Patel & Katapally (2025) — *Towards Ethical Surveillance of Smartphone Use Among Youth*

- **Stable source.** [DOI 10.1016/j.techsoc.2025.103012](https://doi.org/10.1016/j.techsoc.2025.103012); earlier [SSRN 4868398](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4868398); [Figshare data](https://doi.org/10.6084/m9.figshare.25999960).
- **Why / rung.** **Major construction threat:** youth self-report versus custom iOS/Android binary screen-state tracking; **Rung 2**.
- **Construction.** Smart Platform samples ON/OFF about every 24 s; published version includes ≥1 day from either source and excludes objective values **≥24 h/day**. Pairing is delegated to the app.
- **Discrepancy/threshold.** N=76 paired: self-report 4.074 vs objective 2.615 h/day; mean +1.39 h, LoA −6.99 to 9.76. Earlier version reports that stricter completeness criteria reverse the discrepancy direction, but exact cutpoints remain inaccessible.
- **Availability.** Derived data public; analysis code/raw app builder not located; partial rerun only.
- **Access.** Indexed full article/metadata and SSRN abstract, checked 2026-08-06.

### F70. Balhara et al. (2024) — *Do Personality Traits Predict Mental Well-Being in the Context of Erroneous Subjective Estimation of Smartphone Screen Time?*

- **Stable source.** [DOI 10.2174/2666082219666230801155210](https://doi.org/10.2174/2666082219666230801155210).
- **Why / rung.** Direct screenshot/function comparison in 202 Indian college students; **Rung 1**.
- **Construction.** Participant-mediated vendor summary; OS mix, averaging window, screenshot validation, multi-device handling, and vendor builder are **UNDETERMINED/DELEGATED**.
- **Discrepancy/threshold.** 71.8% underestimated and 27.7% overestimated; overestimators had larger magnitude. No episode threshold available.
- **Availability.** No public data/code/preregistration located.
- **Access.** Primary abstract only; full text paywalled, checked 2026-08-06.

### F71. Gefei Li et al. (2024) — *What Influences Our Recall of the Use of Social Media and Smartphones?*

- **Stable source.** [DOI 10.1504/IJMC.2024.135696](https://doi.org/10.1504/IJMC.2024.135696).
- **Why / rung.** Direct yesterday/week iPhone recall-versus-Screen-Time study, N=315; **Rung 1**.
- **Construction.** Participant transcription from iOS 13+; 12 records with reported social time > total phone time excluded; discrepancy=`|estimate−actual|`; Apple Social Networking category manually checked for common Chinese apps. Apple episode/category builder delegated.
- **Discrepancy/threshold.** Underreported yesterday/weekly phone and weekly social use but overreported yesterday social use; authors flag `Share Across Devices` as an uncontrolled aggregation threat.
- **Availability.** No public data/code located.
- **Access.** Publisher primary record plus indexed manuscript text, checked 2026-08-06.

### F72. Drews et al. (2024) — *Tracked and Self-Reported Nighttime Smartphone Use…: SmartSleep Study*

- **Stable source.** [DOI 10.1093/sleep/zsae024](https://doi.org/10.1093/sleep/zsae024); [SmartSleep source](https://github.com/smartsleepku).
- **Why / rung.** Population study contrasts three-month recall with ≤14 nights of app-tracked screen activations; **Rung 2**.
- **Construction.** Mean activations/night plus four temporal clusters; missingness handled with imputation/weights. Cluster implementation delegated; category contrasts **>4 activations** versus none.
- **Discrepancy/threshold.** Self-report was more strongly related to health/utilization than tracked activations. Authors explicitly attribute divergence partly to non-equivalent temporal windows/constructs; justification for >4 cutoff not located.
- **Availability.** Tracking app open; sensitive linked data controlled/requestable.
- **Access.** Full open primary article, checked 2026-08-06.

### F73. Walsh (2021) — *Does Your Smartphone Make You Unhappy?*

- **Stable source.** [UC dissertation record](https://escholarship.org/uc/item/6pm025cx); [OSF data/materials/R code](https://osf.io/vpekx/); no DOI.
- **Why / rung.** Direct iPhone comparison with RA screenshot capture/coding, N=414; **Rung 1**.
- **Construction.** iOS 12→13 update changed available objective window from ~3 to 13 days. Phone self-report is iPhone-only; social-media self-report covers all devices while objective social use is iPhone-only. Apple categories delegated.
- **Discrepancy/threshold.** Similar mean phone time but absolute error 91.52 min/day; 54.5% missed by ≥1 h. Social self-report exceeded iPhone log under a known universe mismatch.
- **Availability.** Data, materials, and R code public; downstream rerunnable.
- **Access.** Full open dissertation, checked 2026-08-06.

### F74. Johannes, Nguyen, Weinstein & Przybylski (2021) — *Objective, Subjective, and Accurate Reporting of Social Media Use*

- **Stable source.** [DOI 10.1037/tmb0000035](https://doi.org/10.1037/tmb0000035); [OSF](https://doi.org/10.17605/OSF.IO/7BYVT); [processing/code](https://digital-wellbeing.github.io/smartphone-use/).
- **Why / rung.** Five-day daily comparison with RA-observed iOS Social Networking values, 96 users/435 days; **Rung 1**.
- **Construction.** Apple category delegated; percentage error used instead of raw difference; 11 zero self-reports set missing because percentage error is undefined.
- **Discrepancy/threshold.** Objective/subjective r=.57; systematic overestimate about **71 min/day**. No traits/daily states explained error.
- **Availability.** Public data/materials/code; high rerunnability.
- **Access.** Full open manuscript/repository, checked 2026-08-06.

### F75. Keith, Nokes & Spruill (2021) — *What Can Mental Health Teach Us About Social Media Screen Time Misestimation?*

- **Stable source.** [BYU repository 9487](https://scholarsarchive.byu.edu/facpub/9487); no DOI located.
- **Why / rung.** Platform-specific self-estimate versus provider/device totals in 1,005 students; **Rung 1**.
- **Construction.** OS mix, window, screenshot verification, category allocation, cleaning, and vendor rule are **UNDETERMINED** from available conference record.
- **Discrepancy/threshold.** Mental-health associations vary across Facebook/Instagram/Twitter/YouTube, arguing against a single person-level error constant; exact magnitude not recoverable.
- **Availability.** No public data/code/preregistration located.
- **Access.** Repository metadata/abstract only, checked 2026-08-06.

### F76. Anand, Chen, Khemlani & Desai (2025) — *Discrepancies Between Parent and Child Reports of Social Media Use Among 8- to 12-Year-Olds*

- **Stable source.** [DOI 10.1542/pedsos.2025-000699](https://doi.org/10.1542/pedsos.2025-000699).
- **Why / rung.** Current parent–child reporter-discrepancy evidence, 221 dyads; **N/A** log rung.
- **Construction.** Parallel multilingual questionnaires; McNemar/paired tests and logistic agreement models. Income “prefer not” (67%) is formally complete but substantively unavailable SES.
- **Discrepancy/threshold.** Children vs parents: account ownership 74.5% vs 44.3%, nighttime use 61.5% vs 32.1%; lowest agreement age 11; parent education/income predicted awareness.
- **Availability.** No public data/code located.
- **Access.** Full open AAP article, checked 2026-08-06.

### F77. Geurts et al. (2023) — *Adolescents’ Problematic Social Media Use: Agreement and Discrepancies Between Self- Versus Mother- and Father-Reports*

- **Stable source.** [DOI 10.1037/tmb0000110](https://doi.org/10.1037/tmb0000110); [OSF materials/data](https://osf.io/ra2wt/).
- **Why / rung.** Multi-informant adolescent/mother/father measurement study; **N/A** log rung.
- **Construction.** Compares classification, symptom count, and items; configural but only partial scalar invariance because one of nine thresholds differs; low prevalence depresses positive agreement.
- **Discrepancy/threshold.** Overall agreement poor; least observable symptoms lowest. Parent over/underreporting related to level, gender, and maternal worry.
- **Availability.** Public data/materials/preregistration; high rerunnability.
- **Access.** Full open publisher/repository version, checked 2026-08-06.

### F78. Kosola, Mörö & Holopainen (2024) — *Smartphone Use and Well-Being of Adolescent Girls*

- **Stable source.** [DOI 10.1136/archdischild-2023-326521](https://doi.org/10.1136/archdischild-2023-326521); [PMC11228213](https://pmc.ncbi.nlm.nih.gov/articles/PMC11228213/).
- **Why / rung.** Direct cross-vendor screenshot/self-report study in 1,164 girls; 564 screenshots; **Rung 1**.
- **Construction.** Total and manually classified top-app minutes divided by available days; median 6 days/7 apps; iOS Screen Time, Huawei Digital Balance, Android Digital Wellbeing harmonized manually. Top-app detail covers median **84.1%** of total; screenshot uploaders had higher GPA.
- **Discrepancy/threshold.** Estimated social 312 versus screenshot-derived 231 min/day; objective total 350. Difference combines recall with top-app undercoverage/platform taxonomy and selective participation.
- **Availability.** Pseudonymous data requestable within EU; no public code.
- **Access.** Full open article/supplement, checked 2026-08-06. The distinct 2026 follow-up is B81.

### F79. Bild et al. (2025) — *Effects of Smartphone Use on Sleep and Mental Health in Young Adults: Going Beyond Self-Report*

- **Stable source.** [DOI 10.1155/da/3249012](https://doi.org/10.1155/da/3249012); [PMC12662671](https://pmc.ncbi.nlm.nih.gov/articles/PMC12662671/).
- **Why / rung.** RA-supervised seven-day native-dashboard transcription contrasted with self-report literature; **Rung 1**.
- **Construction.** Mean of seven iOS/Android daily totals; foreground active-screen time excludes passive audio and lacks content/timing. Vendor builder delegated; actigraphy separately requires ≥3 valid nights.
- **Discrepancy/threshold.** No same-use estimate; objective use was unrelated to sleep/mental health, unlike much self-report literature. Cause of cross-paper divergence is undetermined.
- **Availability.** Data requestable; no public smartphone processing code.
- **Access.** Full open text, checked 2026-08-06.

### F80. Jacobucci, Blacutt, Ram & Ammerman (2025) — *Smartphone Screen Time and Suicide Risk in Daily Life Captured Through High-Resolution Screenshot Data*

- **Stable source.** [DOI 10.1038/s41746-025-01740-w](https://doi.org/10.1038/s41746-025-01740-w); [OSF data/scripts](https://doi.org/10.17605/OSF.IO/CJAST).
- **Why / rung.** **Direct construction threat:** Screenlife five-second screenshots become a modeled exposure through multiple explicit decisions; **Rung 3**.
- **Construction.** Screen time=screenshot count; session gap ≤**30 s**; 10-minute bins; proportion of nominal 120 images. Android pre-execution caused >120 images in 0.58% bins, so <5-s duplicates removed and values capped at 120; app can be toggled off; missed EMA listwise deleted.
- **Discrepancy/threshold.** Not a recall comparison. 75.3% of bins had zero images; EMA compliance 68.8%; phone use predicts both risk reports and response probability.
- **Availability.** Derived data/R scripts public, raw screenshots private; downstream highly rerunnable.
- **Access.** Full open article, checked 2026-08-06.

### F81. Somasundaram, Zimmermann & Pham (2025) — *Leveraging Rational Addiction Theory to Reduce Mobile Usage*

- **Stable source.** [DOI 10.1177/00222429251405841](https://doi.org/10.1177/00222429251405841); [accepted manuscript](https://repositorio.ie.edu/server/api/core/bitstreams/39ad5f0b-708a-45d7-b75f-f820e41c85f1/content); [OSF](https://doi.org/10.17605/OSF.IO/EBGV9).
- **Why / rung.** Shows verified transcription removes one error layer while leaving cross-platform semantics; **Rung 1**.
- **Construction.** iOS native Screen Time versus Android third-party Screen Time app; participants enter seven daily values and upload `Last 7 Days` screenshot; researchers verify graph/mean/name. Android deactivation deletes history and is detectable/excluded.
- **Discrepancy/threshold.** Not a recall comparison. Native iOS versus third-party Android equivalence is assumed, not validated; no session threshold disclosed.
- **Availability.** Surveys/data/R code public; high downstream rerunnability.
- **Access.** Open accepted manuscript, checked 2026-08-06.

### F82. Nygaard et al. (2025) — *The Digital Child Study Protocol*

- **Stable source.** [DOI 10.1136/bmjopen-2025-103198](https://doi.org/10.1136/bmjopen-2025-103198).
- **Why / rung.** National preschool cohort exposes ownership/sharing as a log-availability gate; **Rung 1** for device fields.
- **Construction.** Parent report covers smartphone/tablet/computer/TV/console, but native-setting values exist only for child-owned phone/tablet; duration report binned into 14 categories; only top three apps transcribed; Android allows unspecified other monitors.
- **Discrepancy/threshold.** Protocol: no result yet. All-device parent report and child-owned-mobile vendor summary are structurally non-coextensive; shared caregiver devices/nonmobile screens absent.
- **Availability.** Exact questionnaire in supplements; data controlled under Danish protections; no analysis code yet.
- **Access.** Full open protocol/supplements, checked 2026-08-06.

### F83. Islambouli, Ingram & Gillet (2024) — *Understanding Digital Wellbeing Through Smartphone Usage Intentions and Regrettable Patterns*

- **Stable source.** [DOI 10.1109/ICHI61247.2024.00061](https://doi.org/10.1109/ICHI61247.2024.00061); [author postprint](https://arodes.hes-so.ch/record/14804?ln=en).
- **Why / rung.** Independent Android study directly links reconstruction and selective EMA labeling; **Rung 3**.
- **Construction.** UsageStats/Accessibility/AWARE; session=screen on→off; EMA only for sessions **≥15 s**, expires after **10 min**, cannot recur after submit/dismiss. 112,486 sessions but only 5,835 (5.19%) answered; apps reduced to categories; low wellbeing=bottom 30%.
- **Discrepancy/threshold.** Low-wellbeing group overestimated use, high group did not. The 15-s rule is citation-derived; intentional/regretted sessions are a highly selected subset.
- **Availability.** No public data/APK/code located.
- **Access.** Full open author postprint, checked 2026-08-06.

### F84. Galeotti et al. (2026) — *“I Do Not See Eye to Eye With My Parents”: Parent–Adolescent Discrepancies in Parental Phubbing…*

- **Stable source.** [DOI 10.1155/hbe2/2677322](https://doi.org/10.1155/hbe2/2677322); [institutional record](https://research-portal.uu.nl/en/publications/i-do-not-see-eye-to-eye-with-my-parents-parentadolescent-discrepa/).
- **Why / rung.** Current dyadic evidence that discrepancy direction carries substantive information; **N/A** log rung.
- **Construction.** Latent difference-score model under Operations Triad Model rather than raw subtraction; controls parental problematic use and models parent–adolescent connection as mediator.
- **Discrepancy/threshold.** Parents report more phubbing; adolescent-over-parent and adolescent-under-parent patterns relate differently to connection, life satisfaction, and problematic use.
- **Availability.** Public data/code not located; rerunnability undetermined.
- **Access.** CC BY article/institutional full-text route, checked 2026-08-06.

### Slice F expansion count

- **New records:** F69–F84 = **16**.
- **Authoritative Slice F total:** **84** records.
- **Direct conclusion:** discrepancy magnitude and direction depend on completeness eligibility, compared-device universe, time window, top-app/category coverage, transcription verification, selection/missingness, and the rule that creates the logged measure.

## Direct discrepancy and attribution additions from Pro reconciliation — 2026-08-06

These five records contribute actual phone/app-use comparison, response-selection, construction, or
reactivity evidence. Network-traffic proxies and generic sensing studies were rejected as outside the
requested direct scope. The complete audit is in
[`../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md`](../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md).

### F85. Okoshi et al. (2025) — *Cyberoception: Finding a Painlessly Measurable New Digital Phenotype*

- **Stable source.** [DOI 10.1145/3706598.3713638](https://doi.org/10.1145/3706598.3713638); [arXiv 2504.16378](https://arxiv.org/html/2504.16378).
- **Why / rung.** Direct Android logged-versus-subjective phenotype construction with explicit event pairing; **Rung 3/4**.
- **Construction.** Screen sessions pair interactive→non-interactive; app intervals pair resumed→paused; app use <5 seconds is labeled micro-use; outputs are aggregated in 30-minute windows around affect sampling.
- **Discrepancy/threshold.** Logged measures and subjective responses are not interchangeable constructs. The five-second micro-use label changes composition before their relationships are estimated.
- **Availability.** Full paper public; no participant data or reconstruction repository located.
- **Access.** arXiv HTML and canonical DOI record, checked 2026-08-06.

### F86. Ahmed et al. (2026) — *Before You Scroll Again: Predicting Regretful Social Media Sessions From In-the-Wild Contextual and Wearable Sensing*

- **Stable source.** [arXiv 2606.08965](https://arxiv.org/html/2606.08965); no publication DOI located at cutoff.
- **Why / rung.** Direct evidence against treating observed duration as the behavioral meaning of a session; **Rung 3/4**.
- **Construction.** UsageStatsManager start/stop plus AccessibilityService exits for 12 apps; transient overlays/system packages are removed; a per-app cooldown suppresses triggers, but its value and missing-exit policy are not stated.
- **Discrepancy/threshold.** The intention–actual-use gap is more predictive of regret than duration; duration shrinks when both enter the model. This is construct disagreement between intended and logged behavior, not evidence that long sessions are intrinsically harmful.
- **Availability.** Full preprint; promised open-source URL remains a placeholder.
- **Access.** arXiv HTML, checked 2026-08-06.

### F87. Reiter & Schoedel (2024) — *Never Miss a Beep: Using Mobile Sensing to Investigate (Non-)Compliance in Experience Sampling Studies*

- **Stable source.** [DOI 10.3758/s13428-023-02252-9](https://doi.org/10.3758/s13428-023-02252-9); [open LMU record](https://epub.ub.uni-muenchen.de/116336/).
- **Why / rung.** Shows that ESM response data are selected by phone-use opportunity before subjective/log relationships are estimated; **Rung 3**.
- **Construction.** App/screen features use 60-minute pre-beep windows; ±4-SD observations become missing, >90%-missing and near-zero-variance features are removed, and imputation occurs within resampling.
- **Discrepancy/threshold.** The system notifies a scheduled beep on the participant's first active phone use, so “compliance” is partly conditional on screen activation rather than only willingness or recall.
- **Availability.** Full open paper and supporting dataset/codebook/materials; upstream session builder delegated.
- **Access.** Primary open manuscript, checked 2026-08-06.

### F88. Toth, Parry & Klingelhoefer (2025) — *Somebody's (Still) Watching Me: Reactivity to Smartphone Logging and Experience Sampling*

- **Stable source.** [DOI 10.31235/osf.io/xt24p_v3](https://doi.org/10.31235/osf.io/xt24p_v3); [OSF preprint](https://osf.io/preprints/socarxiv/xt24p_v3/).
- **Why / rung.** Directly tests whether logging and self-report solicitation alter the behavior being treated as objective ground truth; **Rung 3**.
- **Construction.** N=815 Android users over seven days; inherited Parry–Toth reconstruction; glances, sessions, and episodes; >5-SD events and sessions <0.5 seconds excluded; five-minute windows split spanning sessions.
- **Discrepancy/threshold.** Logging reactivity is small and transient; ESM prompts shift behavior for roughly two to three hours. Logged behavior around prompts is therefore not a passive, treatment-free benchmark.
- **Availability.** Primary preprint/artifacts public; raw reconstruction implementation delegated.
- **Access.** OSF preprint/PDF, checked 2026-08-06.

### F89. Toth, Parry, Pourafshari & Bayer (2025) — *Zooming in on Smartphone Habits: Identifying Behavioral Indicators of Perceived Automaticity*

- **Stable source.** [DOI 10.31234/osf.io/bqfne_v3](https://doi.org/10.31234/osf.io/bqfne_v3); [OSF preprint](https://osf.io/preprints/psyarxiv/bqfne_v3/).
- **Why / rung.** Compares perceived automaticity with several explicitly distinct logged-use units; **Rung 3**.
- **Construction.** About 70 million Android events from 889 users become about 6.5 million glances, sessions, and episodes under an inherited event algorithm; Android <9 is excluded; metrics use 30-minute pre-ESM windows.
- **Discrepancy/threshold.** Duration is more consistent than frequency, session/episode but not glance metrics relate to automaticity, and gateway/home-screen explanations are null. The apparent subjective/log relationship depends on which logged unit is chosen.
- **Availability.** Full primary preprint; no new builder code.
- **Access.** OSF preprint/PDF, checked 2026-08-06.

### Slice F Pro-reconciliation count

- **New records:** F85–F89 = **5**.
- **Authoritative Slice F total:** **89** records.
- **Direct conclusion:** discrepancy work must model selection into observation, reactivity to prompts/logging, and the choice among glances, sessions, episodes, duration, and intention gaps—not just recall error against a supposedly neutral log.

## Fresh unlock-triggered discrepancy/reactivity addition from Pro discovery — 2026-08-06

### F90. Terzimehić et al. (2022) — *MindPhone: Mindful Reflection at Unlock Can Reduce Absentminded Smartphone Use*

- **Stable source.** [DOI 10.1145/3532106.3533575](https://doi.org/10.1145/3532106.3533575).
- **Why / rung.** Android unlock-triggered intervention with sticky-notification re-entry; **Rung 3 trigger**, while overall screen-time/unlock outcomes are platform/dashboard-derived.
- **Construction.** A reflection prompt appears at unlock. Passive mode can be swiped away or bypassed through home/back; active mode uses a persistent notification and permits re-entry.
- **Discrepancy implication.** Trigger, bypass, and re-entry are explicit, but outcome screen time and unlock counts come from survey/native dashboards rather than the custom event stream. Intervention exposure and outcome construction therefore have different observability depths.
- **Availability.** Primary paper available; no public app source or raw intervention log verified.
- **Access.** Canonical DOI record/full paper, checked 2026-08-06.

### Slice F fresh-discovery count

- **New records:** F90 = **1**.
- **Authoritative Slice F total:** **90** records.
- **Direct conclusion:** an intervention can expose its trigger/bypass logic while delegating the supposedly objective outcome to a closed vendor aggregate; disclosure must be evaluated measure by measure.

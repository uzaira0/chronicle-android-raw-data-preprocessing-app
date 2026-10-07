# Citation chase — Lane 3 (entries 21–31)

Source list: `docs/paper/winklbauer-batinic-references.md` (Winklbauer & Batinic 2026, refs 21–31).

Extraction target per entry: (1) instrument + ladder rung, (2) session threshold, (3) episode
reconstruction rule, (4) system-app / launcher filtering, (5) window / exclusions / aggregation,
(6) availability. **"NOT STATED" means the paper is silent** — it is a finding, not a lookup failure.

Ladder rungs used throughout: **Rung 4** = raw platform event log with declared semantics (Android
`UsageEvents`); **Rung 3** = app-level event-logging research app; **Rung 2** = screen-on/off logging
only; **Rung 1** = vendor aggregate (iOS Screen Time, Digital Wellbeing, battery stats).

Retrieval was limited to direct HTTP fetch of published/repository files. Four entries sit behind
JavaScript challenge pages (Cloudflare / Anubis) or a hard paywall and could not be read in full;
those are reported as abstract-only and their fields are left at what the abstract literally supports.

---

## 21. Jones-Jang, Heo, McKeever, Kim, Moscowitz & Moscowitz (2020) — "Good News! Communication Findings May be Underestimated"

*Journal of Computer-Mediated Communication* 25(5), 346–363. doi:10.1093/jcmc/zmaa009

- **Instrument and ladder rung. Rung 1 — vendor aggregate (Apple iOS Screen Time), read off the
  device screen by a researcher or uploaded as a screenshot by the participant.** No research app,
  no event log, no API. Study 1: *"With the respondents' consent, we asked them to show us their
  phone screen of Screen Time results. We recorded the minutes they spent daily on their smartphones
  and the daily number of screen pickups."* (Study 1, "Sample and procedure", p. 352). Study 2:
  *"To collect the Screen Time data from MTurk samples, we asked participants to self-upload the
  screenshots of their phone screens."* (Study 2, "Sample and procedures", p. 356). Under "Logged
  data": *"The iPhone logging application, Screen Time, measured participants' device use by
  recording their usage patterns. Specifically, we recorded the average amount of iPhone use time
  per day and iPhone pick-ups per day for the past seven days."* Android users were excluded by
  design (*"Android users were excluded (n = 18)"*); only iOS ≥ 12.1 qualified.
- **Session threshold: NOT STATED.** No threshold appears anywhere; the numbers are whatever iOS
  reports, and iOS's own rule is not discussed.
- **Episode reconstruction rule: NOT STATED.** The paper never asks how Apple derives "use time" or
  a "pick-up". The word "logged" is used throughout as if it denoted a raw, rule-free quantity —
  the article's whole framing ("logged" vs. "self-reported") depends on the logged side being
  treated as ground truth. This is the purest instance in the lane of an undeclared reconstruction
  rule being promoted to a criterion measure.
- **System-app / launcher filtering: NOT STATED.** (Not applicable in practice — device-level total
  only, no per-app breakdown was used.)
- **Window, exclusions, aggregation.** Seven days, retrospective, as displayed by Screen Time.
  Study 1 exclusions, verbatim: *"Data from students who did not turn on the Screen Time (n = 180),
  only had partial Screen Time data over the week (n = 71), did not complete the survey (n = 21),
  or provided insincere responses (n = 2, outliers) were excluded in our analysis because we could
  not obtain proper logged data."* Final n = 294 (Study 1), n = 291 MTurk (Study 2). Aggregation is
  the **mean** of daily minutes / daily pick-ups (M = 304.04 min, SD = 105.07; M = 160.93 pick-ups,
  SD = 60.28). The self-report/log gap is a ratio: `(Self-Reported − Logged) / Logged`.
- **Availability: NOT STATED.** No data-availability, OSF, or supplementary-materials statement
  appears in the article.

**Access:** Full text, via the OUP article PDF (`academic.oup.com/jcmc/article-pdf/25/5/346/…`,
bronze OA, followed through the Silverchair redirect).

---

## 22. Jürgens, Stark & Magin (2019) — "Two Half-Truths Make a Whole? On Bias in Self-Reports and Tracking Data"

*Social Science Computer Review* 38(5), 600–615. doi:10.1177/0894439319831643

- **Instrument and ladder rung: cannot be determined from the abstract.** The abstract says only
  *"Using data from a multimethod study, we show that tracking data from mobile devices is linked to
  systematic distortions in self-report biases."* No software is named at abstract level.
- **Session threshold:** not determinable (abstract only).
- **Episode reconstruction rule:** not determinable (abstract only). The abstract's own claim is
  adjacent to our thesis and worth recording verbatim: *"So far, however, little effort has been
  invested into assessing the specific biases of tracking methods themselves."*
- **System-app / launcher filtering:** not determinable (abstract only).
- **Window, exclusions, aggregation:** not determinable (abstract only).
- **Availability:** a green-OA copy exists at SSOAR
  (`ssoar.info/ssoar/bitstream/document/85288/1/ssoar-soccomprev-2020-5-jurgens_et_al-Two_Half-Truths_Make_a_Whole.pdf`)
  and at the University of Oslo archive (`hdl.handle.net/11250/2647484`). No processing-code or
  processed-data statement is visible at abstract level.

**Access:** Abstract only, from the OpenAlex record. Could not retrieve full text: the SSOAR green-OA
PDF and its landing page are behind an Anubis JavaScript challenge, and the Oslo handle redirects to
a JavaScript-rendered NVA record. Sage's own page is behind a Cloudflare challenge. Recorded as
**could not retrieve, JS-gated** — the paper is legally open, only mechanically unreachable here.

---

## 23. Kasturiratna, Chua & Hartanto (2025) — "A multifaceted nudge-based intervention to reduce smartphone use"

*Mobile Media & Communication* 13(3), 504–525. doi:10.1177/20501579251323246

- **Instrument and ladder rung: NOT STATED at abstract level.** The abstract says only
  *"A randomized within-subject cross-over trial with counterbalancing was conducted over a two-week
  period using a daily diary approach paired with objective smartphone usage data to track the impact
  of these interventions on both smartphone screentime and checking behavior."* "Objective smartphone
  usage data" names no software, no OS, and no API. Rung is therefore **indeterminate**; the intervention
  itself (disabling Face/Touch ID, longer passwords, grayscale, removing social apps from the home
  screen) tells us participants used their own phones, not a managed research device.
- **Session threshold:** not determinable (abstract only).
- **Episode reconstruction rule:** not determinable (abstract only). Note that the study's two
  dependent variables — "screentime" and "checking frequency" — are exactly the two quantities that
  a reconstruction rule produces, so this is a high-value target for a follow-up read.
- **System-app / launcher filtering:** not determinable (abstract only).
- **Window, exclusions, aggregation:** two-week crossover; multilevel modelling on 163 young adults
  with 1,508 observations (so day-level observations nested in persons, not a person-level mean).
- **Availability:** not determinable (abstract only).

**Access:** Abstract only, from the OpenAlex record plus the Singapore Management University InK
repository landing page. The InK full-text file (`ink.library.smu.edu.sg/cgi/viewcontent.cgi?article=5445`)
returns HTTP 403 to direct fetch, and the Sage page is behind a Cloudflare challenge. Recorded as
**could not retrieve**.

---

## 24. Keusch, Bähr, Haas, Kreuter & Trappmann (2020) — "Coverage Error in Data Collection Combining Mobile Surveys With Passive Measurement Using Apps"

*Sociological Methods & Research*. doi:10.1177/0049124120914924
**Transcription correction:** the preprint's list gives no volume/issue. The final record is
*Sociological Methods & Research* **52(2), 841–878, 2023** (running heads in the published PDF confirm
"Sociological Methods & Research 52(2)"). The 2020 date in the reference list is the online-first date.

**These six fields largely do not apply: this study collects no passive smartphone data at all.**
It is a survey-based coverage-error analysis. The passive-measurement content is entirely about *who
can be measured*, not about how logs become numbers.

- **Instrument and ladder rung: no logging instrument — Rung 0 / not applicable.** The measurement
  is two survey items in PASS Wave 11: *"P 298. Do you own a mobile phone with Internet access, a so
  called smartphone?"* and *"P299. Which of the following operating systems is installed on your
  smartphone? 1 Android / 2 Apple iOS / 3 Windows / 4 Another operating system"* (Figure 1, p. 849).
- **Session threshold: not applicable.**
- **Episode reconstruction rule: not applicable.**
- **System-app / launcher filtering: not applicable.**
- **Window, exclusions, aggregation.** *"Between February and September 2017, 13,703 individuals in
  9,420 households were interviewed as part of PASS Wave 11."* Estimates are produced under standard
  PASS survey weights and re-estimated on smartphone-owner, Android-owner and iPhone-owner subsets.
- **Availability.** PASS is a public scientific-use file: *"The exact wording for the original items
  can be found at http://fdz.iab.de/en/FDZ_Individual_Data/PASS.aspx."* No processing code is offered
  (none is needed).

**What it does contribute to the measurement-declaration question** — one sentence in the
introduction is the clearest statement in the whole lane of *why* the ladder rungs differ by platform:
*"For example, the architecture of the iOS and Windows systems currently do not allow mobile data,
such as geolocation, call and text logs, and online browsing behavior, to be passively collected from
smartphones with the same level of detail as Android."* (p. 842). It follows this with the
consequence: *"Thus, it is not surprising that many studies rely on the use of only a single OS."*
That is the structural reason a large share of the literature is Android-only — and therefore the
reason the Android `UsageEvents` reconstruction rule is load-bearing for the field.

**Access:** Full text, via the University of Mannheim MADOC deposit of the published Sage PDF
(CC BY), fetched and text-extracted.

---

## 25. Keusch, Bach & Cernat (2022) — "Reactivity in measuring sensitive online behavior"

*Internet Research* 33(3), 1031–1052. doi:10.1108/intr-01-2021-0053

- **Instrument and ladder rung: NOT STATED at abstract level.** The abstract says
  *"We analyzed data from a sample of 1,959 members of a German online panel who had consented to the
  collection of digital trace data about their online browsing and/or mobile app usage."* The tracker
  software is not named in the abstract. "Mobile app usage" implies Rung 3 or 4, but the abstract
  does not license a rung assignment.
- **Session threshold:** not determinable (abstract only).
- **Episode reconstruction rule:** not determinable (abstract only). The abstract's outcome variables
  are again reconstruction products: *"the frequency and duration with which individuals engage in
  sensitive behaviors online gradually increases during the first couple of days after the installation
  of a tracker."*
- **System-app / launcher filtering:** not determinable (abstract only).
- **Window, exclusions, aggregation:** the abstract states change is studied *"over time in five types
  of sensitive online behavior"* across days following tracker installation; no numbers at abstract level.
- **Availability:** not determinable (abstract only).

**Access:** Abstract only (OpenAlex / Emerald landing page). The Emerald full text is **paywalled**
(article purchase price displayed). The two "green" locations OpenAlex reports — the Manchester
Research Explorer record and the Mannheim MADOC record — are metadata-only pages that host no file.
Recorded as **closed**.

---

## 26. Kristensen, Olesen, Egebæk, Pedersen, Rasmussen & Grøntved (2022) — "Criterion validity of a research-based application for tracking screen time on android and iOS smartphones and tablets"

*Computers in Human Behavior Reports* 5, 100164. doi:10.1016/j.chbr.2021.100164

- **Instrument and ladder rung.** Named instrument: **SDU DeviceTracker**, a research application,
  validated against two reference applications — *"Apple Screen Time (iOS) or ActionDash (Android)"*.
  From the abstract alone the research app is a **screen-time measuring research app (Rung 2–3)** and
  the two references are a vendor aggregate (Apple Screen Time, Rung 1) and a third-party app that
  reads the Android usage-stats API (ActionDash). The abstract does not say which Android API
  DeviceTracker itself uses, so the **rung of the research app is declared only at the level of "it
  measures screen time"**.
- **Session threshold: not determinable (abstract only).**
- **Episode reconstruction rule: not determinable (abstract only).** This entry is the sharpest
  demonstration in the lane of *why* the rule matters: the abstract's own headline result is a
  platform-dependent systematic bias — *"A non-significant mean bias of −0.8 min/day and a correlation
  coefficient of 0.99 (95% CI: 0.98 to 0.99) was observed for the assessment of screen time on Android
  devices compared to the reference method. For iOS devices a significant mean bias of 19.3 min/day and
  a correlation coefficient of r = 0.88 (95% CI: 0.84 to 0.91) was observed."* A 19.3 min/day bias on iOS
  and ~0 on Android is a difference in reconstruction rule, expressed as a validity coefficient.
  The paper offers a correction: *"A correction method for systematic error in the assessment of screen
  time on iOS devices was provided."*
- **System-app / launcher filtering: not determinable (abstract only).**
- **Window, exclusions, aggregation.** From the abstract: *"A sample of adult Danes (n = 40; 40% female;
  median age = 42.0 years) … Each participant collected data for at least 6 days, adding up to a total of
  277 assessment days. Day-level analyses were performed and Bland-Altman limits of agreement for repeated
  measurements and repeated measurement correlation was calculated."*
- **Availability: not determinable (abstract only).**

**Access:** Abstract only, via the DOAJ API record and the University of Southern Denmark research-portal
record. The article is gold OA (CC BY-NC-ND) but every route to the file — ScienceDirect article page,
ScienceDirect `/pdf` and `/pdfft`, and the SDU Pure file mirror — returns a Cloudflare/robot challenge
or HTTP 403 to direct fetch. Recorded as **could not retrieve, JS-gated**, not as closed.

---

## 27. Langener, Stulp, Jacobson, Costanzo, Jagesar, Kas & Bringmann (2024) — "It's All About Timing"

*Advances in Methods and Practices in Psychological Science* 7(1). doi:10.1177/25152459231202677
Diamond OA, CC BY. **Read in full (22 pp.).**

### The six fields

- **Instrument and ladder rung. Rung 3 — an app-level event-logging research app, Behapp.**
  *"Alongside the ESM, participants installed Behapp (https://behapp.com) on their smartphones. Behapp
  collects data passively via the smartphone of the participant (Jagesar et al., 2021). In this study,
  we focus on the following sensors: GPS coordinates, calls, Wi-Fi scans, Bluetooth scans, and app
  usage."* (p. 2–3). **The operating system is NOT STATED** — the article never says Android or iOS.
  The underlying platform API is NOT STATED. Table 1 declares the raw app-usage field as, literally,
  the single column **"App name"**, and the screen field as **"Screen locked/unlocked"**.
- **Session threshold: NOT STATED for app usage.** No gap threshold, no minimum duration, no maximum
  session length is defined for app episodes anywhere in the article. Three time constants *are*
  declared, and none of them is a session rule: a **30-min / 350-m staypoint threshold for GPS**, the
  six **aggregation windows** (1, 3, 6, 9, 12, 24 hr), and the **missing-data thresholds** (12/18/24 hr).
- **Episode reconstruction rule: NOT STATED.** Table 1 maps raw *"App name"* directly to the derived
  variables *"Minutes spent on all apps, minutes spent on communication apps, minutes spent on social
  apps, minutes spent on WhatsApp, number of apps opened"* with no intervening rule. How an app-name
  stream becomes minutes is never described. Likewise, raw *"Screen locked/unlocked"* becomes only
  *"Times screen is locked, times screen is unlocked"* — counts, never durations. The one place the
  article does surface a pre-aggregation preprocessing window is for GPS, and the sentence is
  extraordinary given the paper's own thesis (p. 4, "Description of aggregated variables"):
  > *"A staypoint is defined as any location with a radius of 350 m where participants stayed for at
  > least 30 min. Thus, strictly speaking, in this algorithm, a time window (i.e., 30 min) is chosen
  > even before summarizing features to an aggregated data set. Because this choice is relatively
  > arbitrary, it could also be part of a multiverse analysis. In our examples, we do not vary this
  > time window because we focus on temporal resolutions to summarize and analyze all added variables
  > and not on the time window chosen to calculate staypoints from GPS coordinates."*

  That is the entire argument of our paper, stated by Langener et al. about GPS, acknowledged as
  arbitrary, and then explicitly excluded from their multiverse. For app usage the equivalent
  pre-aggregation window is not even acknowledged.
- **System-app / launcher filtering: NOT STATED.** No exclusion list, no launcher handling. There *is*
  a categorisation step, and its authority is a commercial store listing: *"To add features about app
  usage, we classified to which category an app belongs. For instance, if someone uses WhatsApp or
  other messenger apps, we categorize them as communication apps. The categorization was done based on
  how an app is specified in the Google Play Store (Google Play Store Team, 2020)."* (p. 4).
- **Window, exclusions, aggregation.** *"we use data from 10 students from a Dutch university …
  participants filled out ESM questionnaires and installed an app that collected data passively for 28
  days starting between October and December 2021."* ESM via m-Path (`https://m-path.io`), one semifixed
  morning + four semirandom daily + one semifixed evening questionnaire; *"We removed the morning
  questionnaires from all of our analyses because people do not typically use their phones during the
  night."* Exclusion is itself a treated degree of freedom: *"using a 24-hr time frame for GPS data
  exclusion resulted in 17% of being excluded, using an 18-hr time frame increased the exclusion to
  22%, and a 12-hr time frame resulted in 31% of data being excluded"*, rising to *"24-hr and 18-hr
  time frames excluded 32% of all data points, and a 12-hr time frame excluded 57% of the data"* under
  the multi-sensor strategy. No imputation: *"we did not impute missing data"*. Aggregation is the
  object of study, not a fixed choice: six resolutions (1, 3, 6, 9, 12, 24 hr) crossed with
  moving-window sizes of 6 to 42 ESM measures.
- **Availability: yes, unusually good — code public, raw data deliberately not.**
  *"We provide an example data set (https://github.com/AnnaLangener/TimeScaleAnalysis_Example) and code
  (https://annalangener.github.io/TimeScaleAnalysis_Example/, written in R) other researchers can use as
  a starting point to explore different temporal decisions. For privacy reasons, we do not share the raw
  data of the participant but, rather, a data set with a similar structure and noise added. The full code
  used in this article is available in the GitHub repository (https://github.com/AnnaLangener/TimeScaleAnalysis)."*
  Supplemental material at `http://journals.sagepub.com/doi/suppl/10.1177/25152459231202677`.

### Extended treatment: what the paper actually argues

**Which resolutions, on what data.** The article is a methodological walk-through, not a substantive
study. Its illustration data are 10 Dutch university students, 28 days, Behapp passive sensing (GPS,
calls, Wi-Fi, Bluetooth, app usage) paired with m-Path ESM measuring momentary positive affect on an
11-point scale. It compares **six levels of temporal aggregation — 1, 3, 6, 9, 12 and 24 hr — measured
backwards from the moment each ESM questionnaire was filled out** (Fig. 1), and crosses them with
**moving-window sizes from 6 to 42 ESM observations** (≈ 1 day to 1 week) in a cross-validated
random-forest prediction setup, plus **three missing-data thresholds** (12, 18, 24 hr) under two
exclusion strategies (GPS-only vs. any frequently sampled sensor). It calls the full crossing a
multiverse analysis after Steegen et al. (2016).

**What it concludes.** Resolution changes the answer, in both direction and significance. For time
spent at home vs. positive affect in one participant: *"passive measures aggregated 1 hr before the
ESM questionnaire was filled out led to a significant negative correlation of r = −.29, p < .01.
Likewise, a 3-hr time span resulted in a correlation of r = −.26, p = .01. Contrary to Hypothesis 1a,
this relationship becomes weaker and tends to zero over longer time spans (6 hr: r = −.15, p = .13;
9 hr: r = −.08, p = .45; 12 hr: r = −.01, p = .91). Note that even if not significant, the direction
of the relationship changes for a 24-hr time span (r = .12, p = .24)."* For minutes of calling the
pattern inverts — significant only at 6, 9 and 12 hr. Missing-data handling moves results just as
much: *"using a 24-hr time frame for exclusion led to a significant correlation of r = −.29 (p < .01;
N = 99) … whereas using a threshold of 12 hr resulted in a weaker correlation of r = −.19 (p = .09;
N = 82). Therefore, using a frequentist approach to evaluate the conclusion drawn would be different
for a 12-hr threshold compared to 18-hr and 24-hr thresholds."* In the prediction example, broader
aggregation won for that participant (24 hr: mean R² = .29; 1 hr: mean R² = .12), with the caveat that
*"those results do not directly translate to other participants."* The recommendation is explicit
choice plus multiverse: *"We recommend that researchers be explicit in their choice of temporal
resolution when designing a study."*

**Measurement validity, or analysis convenience?** — **Both, but the validity claim is asserted while
the convenience claim is the one they operationalise.** The validity language is present and
unambiguous, and it is anchored in Borsboom:

> *"Thus, researchers should consider the meaning of the variables (Borsboom et al., 2004), especially
> when measurements are summarized on different timescales, to ensure that the data captured reflect
> the behavior they intend to measure."* (p. 3)

and, more directly:

> *"Nevertheless, there has been a lack of clarity regarding what construct passive smartphone measures
> aim to capture (Langener et al., 2023). For example, passive measures like GPS and accelerometer data
> are frequently used to measure social behavior; however, it is not yet clear which social behaviors
> these measures capture and how accurately these measures capture the intended construct."* (p. 3)

and:

> *"It is also important to consider the meaning of the variables when measurements are summarized on
> different timescales because they may capture different behaviors and lead to different
> interpretations."* (p. 3)

But every demonstration in the paper is a **robustness-of-conclusions** demonstration — correlations
that flip sign, p-values that cross .05, R² that varies with window length. The stated payoff is
replicability, not construct validity: *"Failure to do so can result in false-positive findings and
difficulty in replicating the study's results (Simmons et al., 2011; Wakim et al., 2020)"* (p. 3), and
the conclusion is *"the timescale on which digital-phenotyping data is summarized and analyzed can lead
to significantly different conclusions"* (p. 18). Table 2, the practical checklist, is organised around
"Designing a study" and "Writing up the manuscript" — preregistration and transparency — not around
whether the derived variable measures the construct.

**The decisive point for our paper.** Langener et al. draw the line for their multiverse *above* the
event→episode boundary. Their unit of analysis is an already-derived variable ("minutes spent on all
apps"), and they vary the window over which that variable is summed. They know a rule exists below
that line — they say so for GPS staypoints, call the 30-min choice *"relatively arbitrary"*, and note
it *"could also be part of a multiverse analysis"* — and they decline to vary it. For app usage they
do not even name the corresponding rule. They also come within one sentence of the problem when
discussing app-usage missingness (p. 9):

> *"For example, a participant might not have used any apps throughout the day, so one would assume that
> the number of minutes the participant spent on apps was zero during that day. However, data on app
> usage could also be missing because of technical problems. … researchers do not always know whether a
> participant simply did not use apps or whether a participant used apps that were not recorded."*

That is a statement about the ambiguity of an app-usage event stream — the exact ambiguity a
reconstruction rule has to resolve — arriving in a paper whose subject is time-related researcher
degrees of freedom, and it is treated as a missing-data problem rather than a measurement-definition
problem. **This is a strong data point for the thesis: the field's most explicit treatment of temporal
researcher degrees of freedom still starts downstream of the reconstruction rule.**

**Access:** Full text (all 22 pages), read from the published Sage PDF supplied on local disk
(`/Users/u/Downloads/langener-et-al-2024-…pdf`). Direct fetch of the Sage and Groningen copies was
blocked by Cloudflare.

---

## 28. Lee, Park & Lee (2022) — "A Systematic Survey on Android API Usage for Data-driven Analytics with Smartphones"

*ACM Computing Surveys* 55(5), 1–38. doi:10.1145/3530814

**The six extraction fields do not apply — this is a survey of 109 studies, not an empirical study.**
What it contributes is the platform-side ground truth: what the Android APIs actually expose, and
therefore what a Rung 4 instrument can and cannot see.

### What it says the Usage Statistics API exposes

The survey splits Android data collection into two "representative" families — the **Accessibility
Service API (AS API)** and the **Usage Statistics API (US API)** — and treats the US API as the app-usage
workhorse:

> *"US API is provided mainly to obtain device and application usage history and statistics information
> [38]. The US API includes the representative APIs (e.g., UsageStatsManager, UsageEvents,
> StorageStatsManager, ConfigurationStats, and EventStats) for accessing the app, as well as device,
> network, storage, device configuration, event type usage history and statistic [38]."* (§2.2.2)

It records the API's origin precisely, which matters for dating the literature:

> *"Prior to Android 5.0 (API level 21), ActivityManager was used to obtain information about a currently
> running foreground application. However, as the method of getting the currently running application
> information using ActivityManager's methods (e.g., getRunningTask(), getRecentTasks(),
> getRunningServices()) have been deprecated since Android 5.0 (API level 21) [36]. Instead of
> ActivityManger, US API is used mainly to track device and application usage history and statistics
> information."* (§2.2.2)

and it fixes the release levels: *"NotificationListenerService API and US API (e.g., UsageStatsManager,
UsageStats, UsageEvent, UsageEvents.Event) were released in API 18 and 21."* (§7.4)

### Constants and accessors it names

The survey names two families of constants explicitly and defers the full enumeration to an appendix:

- **Query-interval constants:** *"by using the usage statistics constants (i.e., INTERVAL DAILY,
  INTERVAL WEEKLY, INTERVAL MONTHLY, and INTERVAL YEARLY), we can query the records to receive the
  classified results according to different periods (i.e., by the day, the week, the month, and the
  year)."*
- **Standby-bucket constants:** *"five types of bucket information (active, working set, frequent, rare,
  never) which define the usage status for each app according to how often the app was used recently can
  be obtained through UsageStatsManager as of Android 10 (API level 29)."*
- **Accessor methods:** *"app usage time (e.g., last time used, app foreground/background used time), app
  usage status history (e.g., the status of foreground/background/user interaction), and package name can
  be retrieved using the UsageStats object provided in the UsageEvents.Event class through methods such
  as getPackageName(), getLastTimeUsed(), and getTotalTimeInForegroud()."*
- It also notes new event types added later: *"In API level 32 of 2021, new events (e.g.,
  SPEECH_STATE_LISTENING/SPEAKING/CHANGED_START/END) associated with microphone's Listening and Speaking
  status were added."*

**Important caveat on completeness.** The full per-constant enumeration is deferred: *"we can check the
detailed information collected through UsageStatsManager [12] and UsageEvents.Event [11] in Table A4 in
Appendix C."* **Table A4 is not present in the version I read** — the accepted-manuscript arXiv PDF ends
at the reference list, and §9 confirms the appendices are supplementary material. So the survey does
*not*, in its main text, print the `UsageEvents.Event` type constants (`ACTIVITY_RESUMED` /
`MOVE_TO_FOREGROUND`, `ACTIVITY_PAUSED`, `SCREEN_INTERACTIVE`, `DEVICE_SHUTDOWN`, etc.) that a
reconstruction rule actually consumes. **A survey of the API, in the field's flagship survey venue, does
not enumerate the event constants in its body text.**

### What it says about unreliability

Three distinct reliability findings, all quoted verbatim:

1. **The US API cannot see interaction, only app identity and timing** — the ceiling on what any
   app-usage log can mean: *"Nevertheless, we cannot collect the information regarding interaction types
   (e.g., click, long click, scroll, focused, and typing) and interaction targets (UI elements and
   hierarchy) from the US API."* (§7.4, "Challenges of US/AS APIs")
2. **Device- and vendor-level unsupportedness, plus battery-induced loss** — reported through Khan et al.
   (2020): *"1) When tracking events that occur in smartphones through the app usage logger, data
   collection was impossible because Android built-in APIs were not supported in certain smartphone
   models. 2) Data accuracy (e.g., noise, outlier) deteriorated due to the poor quality of the sensor.
   3) When the app usage logger app was installed, the battery drained quickly and the smartphone turned
   off easily, causing many missing values."* (§7.5). The mitigation named is vendor selection:
   *"researchers selected the participants based on their smartphone model and Android OS version. Khan
   et al. (2020) selected participants with the most suitable manufacturer (e.g., Samsung) in
   consideration of factors to improve data quality."* (§7.5) — i.e. the field's answer to vendor
   variability has been to *recruit around it*, not to declare it.
3. **Attrition at collection time is large and routine**: *"Radesky et al. (2020) removed 13% of the
   collected data not properly collected due to server and app usage logger's problems."* (§7.5)

It also documents a **governance risk to the alternative instrument** (the AS API), which matters
because AS-based loggers are the main Rung-4-adjacent alternative: *"Google currently regulates the AS
API use. It can be used only to improve the accessibility for users with disabilities for apps registered
in the Google Play Store"*, and *"the Google Android policy regulation may become more severe due to
personal privacy and security issues. Hence, even when using AS API for future research purposes, other
alternatives are needed to prepare future restrictions."* (§7.4). And the platform asymmetry: *"On iOS,
it is not easy to use APIs to track app usage patterns, touch interaction types, and UI
components/hierarchies. … Due to these limitations, prior research mostly used Android rather than iOS."*
(§7.6)

**What it does not do.** The survey classifies studies by *research purpose* and by *data type collected*
— it builds a four-layer taxonomy of what data 109 studies used. It **never asks how any of those studies
turned `UsageEvents` into episodes.** Its own stated reproducibility contribution is terminological:
*"this study presented standardized terms and taxonomy with a four-layer hierarchical structure from 109
studies reviewed, and this taxonomy helps to improve reproducibility for researchers and to better
understand what data are used in the previous studies"* (§8). Standardising *what data were collected*
while leaving *how the data were reduced* unexamined is precisely the gap our paper is about — and it is
notable that the field's most thorough API survey reproduces it.

**Access:** Full text of the accepted manuscript, via the arXiv green-OA deposit (arXiv:2104.11271,
identical running heads to *ACM Comput. Surv.*, April 2022). **Appendices A–E, including Table A4 (the
`UsageStatsManager` / `UsageEvents.Event` constant tables) and Table A5 (API release history), are not in
this version** — they are ACM supplementary material. Everything above is from the main text.

---

## 29. Marciano & Camerini (2022) — "Duration, frequency, and time distortion"

*PLOS ONE* 17(2), e0263815. doi:10.1371/journal.pone.0263815

- **Instrument and ladder rung. Rung 3 as declared — a research app, Ethica**, described only at the
  level of what it produces: *"Ethica, was specially developed for public health research purposes for
  Android and iOS operating systems … automatically collects trace data, such as screen time and
  application usage."* The platform API is NOT STATED, and since the same app is claimed to work on both
  Android and iOS, the two data-generating processes are necessarily different and are not distinguished.
- **Session threshold: NOT STATED.** No gap, no minimum, no maximum.
- **Episode reconstruction rule: NOT STATED.** Duration arrives already formed and is only re-aggregated:
  *"The traced duration was divided into hours on weekdays and weekend days. All weekdays were averaged
  to obtain an aggregate measure for typical weekday use, and all weekend days were averaged to obtain an
  aggregate measure for typical weekend day use."* Frequency is defined operationally but not as an
  episode rule: *"The frequency of smartphone use, i.e., checking behavior, was assessed by automatically
  counting how many times participants activated their smartphone screen during a weekday and a weekend
  day."* — a screen-activation count, with no statement of what counts as an activation.
- **System-app / launcher filtering: NOT STATED.**
- **Window, exclusions, aggregation.** *"Duration of smartphone use was automatically collected through
  the Ethica application on participants' smartphones for 45 consecutive days from the enrollment date."*
  Attrition is described qualitatively (technical problems with Ethica caused dropouts; cases with missing
  self-report were dropped), leaving 84 matched participants at T1 and 80 at T2; **no day-level exclusion
  rule is stated.** Aggregation is the **mean** of daily values, split weekday/weekend; medians appear
  descriptively (*"adolescents activated the screen of their smartphones, on average, 57 times
  (median = 51)"*).
- **Availability: yes, data + instrument.** *"The dataset and the survey instrument are available in a
  repository at the following link: https://osf.io/hwr2u"*. Processing code is not mentioned.

**Access:** Full text, via PubMed Central (PMC8856513).

---

## 30. Marin-Dragu, Forbes, Sheikh, Iyer, Pereira dos Santos, Alda, Hajek, Uher, Wozney, Paulovich, Campbell, Yakovenko, Stewart, Corkum, Bagnell, Orji & Meier (2023) — "Associations of active and passive smartphone use with measures of youth mental health during the COVID-19 pandemic"

*Psychiatry Research* 326, 115298. doi:10.1016/j.psychres.2023.115298

- **Instrument and ladder rung. Rung 2 — screen-on/off logging.** The app is named: **PROSIT**
  (Predicting Risks and Outcomes of Social InTeractions), *"developed by the PROSIT lab … available for
  both Android and iOS operating systems"*. It collects much more (*"smartphone interactions,
  accelerometer, location, screen-time activity, ambient noise and light, and connectivity"*) but the two
  analysed measures are device-level screen duration and unlock count. No per-app data is used.
- **Session threshold: NOT STATED as a gap or merge threshold.** A **maximum-duration exclusion** exists
  and is the only numeric time constant in the paper (see exclusions below); it is a data-cleaning cut,
  not a session-definition rule.
- **Episode reconstruction rule: DECLARED — and this is the only explicit episode definition in the
  entire lane.** Verbatim:
  > *"Objective daily duration of screen-time can be calculated by summing up screen-time time periods –
  > the time window in which a participant is actively using the phone between turning on the display and
  > turning off the screen. The operating system logs screen-time and, with appropriate permissions by
  > the user, the mobile sensing app can access these logs."*

  Frequency likewise: *"we also calculated the frequency of checking the smartphone through daily number
  of unlocks (how many times the user locks and unlocks the smartphone)."* Note what the rule buys and
  what it costs: display-on → display-off is unambiguous and needs no threshold, but it is a *device*
  episode, not an *app* episode, and it silently equates "screen lit" with "actively using the phone".
- **System-app / launcher filtering: NOT STATED / not applicable** — no per-app analysis.
- **Window, exclusions, aggregation.** *"Participants then received instructions to download the mobile
  sensing app and use it continuously for at least 14 days"*; the analysed sample averaged 30.63 days
  (SD = 10.9). Exclusion, verbatim: *"10 participants with time windows that seemed to be caused by
  smartphone misuse or technical errors, such as any period of screen-time longer than 10 hours, were
  excluded."* Aggregation is the **mean** daily screen-time and mean daily unlocks per participant.
- **Availability: NOT STATED.** No data- or code-availability statement in the Methods.

**Access:** Full text, via PubMed Central (PMC10256630).

---

## 31. Meier & Reinecke (2020) — "Computer-Mediated Communication, Social Media, and Mental Health: A Conceptual and Empirical Meta-Review"

*Communication Research* 48(8), 1182–1209. doi:10.1177/0093650220958224

**The six extraction fields do not apply — this is a conceptual/empirical meta-review of 34 reviews.**
Its contribution to the measurement-declaration question is conceptual, and it is directly useful to us.

**What it contributes.** The paper builds a two-axis taxonomy: a **six-level hierarchy of analysis**
(device → application type → branded application → feature → interaction → message) crossed with two
**operational approaches**:

> *"Technology-centered operationalizations are descriptive measures that capture some aspect of technology
> usage, such as its volume (time spent, frequency) or message content, which can principally be observed
> (e.g., digitally tracked), though they are often measured via self-report. User-centered
> operationalizations, in contrast, have a psychological-perceptual component that qualifies how a person
> processes using a CMC technology or why he or she uses it."*

Its critique of "screen time" is a **level-of-analysis** critique, and it is repeated three times:

> *"Studying such types of applications is typically more precise than the device level, as it avoids
> conflating CMC and non-CMC device uses in a simplistic overall measure of 'screen time'."*

> *"The measures of CMC in this field show considerable conflation of analytical levels, thus potentially
> resulting in misattribution of effects to the wrong causes (e.g., to 'screen time' on a device rather
> than to a certain type of interaction)."*

> *"Instead of investigating 'screen time' monolithically, the new decade of research on CMC, social media,
> and MH should operationalize channels through their core features, tease apart the types of interactions
> users engage in across channels, and consider the characteristics of messages they send and receive."*

**What it does not do, and why that matters to us.** The paper puts "screen time" in scare quotes on
every appearance and argues at length that the field measures at the wrong *level*. It never argues that
the field fails to declare *how* the measure at any given level was constructed. Its remedy is to move
**down** the hierarchy (device → application → interaction → message) — but moving down the hierarchy
makes the reconstruction rule *more* load-bearing, not less: an application-level or feature-level
duration requires an event→episode rule that a device-level screen-on total does not. The meta-review
identifies the destination and is silent about the machinery needed to get there. **A methodological
critique of screen-time measurement that operates entirely above the reconstruction rule is itself
evidence for the thesis.**

**Access:** Full text of the author postprint (73 pp., "Meier_Reinecke_postprint_2020_CMC, Social Media,
and Mental Health"), via the PsyArXiv/OSF deposit `osf.io/download/7bhvj/`. The published Sage version is
closed (OpenAlex `oa_status: closed`).

---

## Lane 3 summary

**Full text obtained: 7 of 11.**
Entries 21 (OUP PDF), 24 (Mannheim MADOC deposit of the Sage PDF), 27 (published Sage PDF from local
disk), 28 (arXiv accepted manuscript, appendices absent), 29 (PMC), 30 (PMC), 31 (PsyArXiv postprint).

**Abstract- or metadata-only: 4 of 11.**
- 22 Jürgens et al. — legally green OA but the SSOAR PDF and the Oslo record are JS-gated; **could not
  retrieve**.
- 23 Kasturiratna et al. — SMU InK file returns 403, Sage is JS-gated; **could not retrieve**.
- 25 Keusch, Bach & Cernat — **genuinely paywalled** at Emerald; both "green" locations are metadata-only
  pages hosting no file. This is the lane's one true closed-access outcome.
- 26 Kristensen et al. — gold OA (CC BY-NC-ND) but every route to the file is JS-gated; **could not
  retrieve**.

**Session threshold declared: 0 of 11.** Not one entry in this lane states a gap threshold, a minimum
episode duration, or a merge rule for app episodes. The numeric time constants that *do* appear are all
something else: Langener's 30-min/350-m GPS staypoint radius, Langener's 12/18/24-hr missing-data
thresholds, and Marin-Dragu's 10-hr maximum-screen-period outlier cut.

**Episode reconstruction rule declared: 1 of 11** — entry 30 (Marin-Dragu et al.), and only at the
device level: *"the time window in which a participant is actively using the phone between turning on the
display and turning off the screen."* Zero of the app-level studies declare one. Entry 27, a paper whose
entire subject is time-related researcher degrees of freedom, maps raw *"App name"* straight to *"Minutes
spent on all apps"* with nothing in between.

**Ladder rungs (as declared, not as inferred):**
| Rung | Count | Entries |
|---|---|---|
| Rung 4 (raw platform event log, declared semantics) | **0** | — |
| Rung 3 (app-level event-logging research app) | 2 | 27 (Behapp), 29 (Ethica) |
| Rung 2 (screen on/off only) | 1 | 30 (PROSIT) |
| Rung 2–3, named but unresolved from abstract | 1 | 26 (SDU DeviceTracker) |
| Rung 1 (vendor aggregate) | 1 | 21 (iOS Screen Time) |
| Not applicable (survey / meta-review / no instrument) | 3 | 24, 28, 31 |
| Indeterminate (abstract only, no instrument named) | 3 | 22, 23, 25 |

**No study in this lane declares itself at Rung 4** — no entry states that it read Android `UsageEvents`
and says what it did with the constants. The one entry that documents Rung 4 in detail (28) is a survey
of other people's studies, and it defers the actual event-constant table to an appendix.

**What surprised me.**

1. **Entry 27 is the single most damaging entry for the field and the most supportive for our thesis.**
   Langener et al. explicitly identify a pre-aggregation preprocessing time window (the 30-min GPS
   staypoint threshold), call it *"relatively arbitrary"*, say it *"could also be part of a multiverse
   analysis"* — and then exclude it from their multiverse in the same sentence. For app usage they do not
   surface the corresponding rule at all. Their multiverse, like Winklbauer & Batinic's, begins one layer
   above the boundary that matters. This is not an oversight we have to infer; they wrote it down.

2. **Entry 21 uses iOS Screen Time as its criterion for "objective" measurement, read off the device by a
   researcher's eye in Study 1 and by participant screenshot in Study 2.** A vendor aggregate whose
   internal rule is undocumented and unauditable is being used as the ground truth against which
   self-report is judged "inaccurate". Entry 26 then measures how far that ground truth is from another
   one — 19.3 min/day systematic bias on iOS versus ~0 on Android — which is a reconstruction-rule
   disagreement reported as an instrument-validity coefficient. Entries 21 and 26 read together are a
   ready-made worked example for the paper.

3. **Entry 28 does not print the `UsageEvents.Event` constants in its body text.** The field's flagship
   survey of exactly this API names the query-interval constants and the standby buckets, then defers the
   event-type table to a supplementary appendix. If the survey does not put the event vocabulary in front
   of readers, it is not surprising that the empirical literature does not declare what it did with it.

4. **Entry 24 is not a measurement paper at all.** It collects no passive data — it is two survey items
   about smartphone ownership in PASS Wave 11. Its value to us is one sentence explaining *why* the field
   is Android-shaped: iOS *"do[es] not allow mobile data … to be passively collected from smartphones with
   the same level of detail as Android"*, and therefore *"many studies rely on the use of only a single
   OS."* Cite it for the structural claim, not as a measurement study.

5. **Entry 31 is a near miss that is worth quoting precisely because it is a near miss.** Meier & Reinecke
   scare-quote "screen time" on every appearance and argue the field measures at the wrong level — then
   prescribe moving *down* to applications, features, interactions and messages, which makes the
   undeclared reconstruction rule strictly more load-bearing. A prominent methodological critique of
   screen-time measurement that never reaches the event→episode step is itself the state of the field.

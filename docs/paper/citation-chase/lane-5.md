# Citation chase — Lane 5 (Winklbauer & Batinic 2026, reference-list entries 42–51)

Audit target: what each study **actually declares** about turning raw device events into
usage numbers. "NOT STATED" is a finding, not a lookup failure.

Retrieval was by `curl` (direct file download) and `WebFetch` only. No browser automation,
no paywall circumvention. Where a publisher blocked automated retrieval, that is recorded
plainly.

---

## 42. Shaw, Ellis, Geyer, Davidson, Ziegler & Smith (2020) — Quantifying smartphone "use"

*Technology, Mind, and Behavior* 1(2), 114–128. doi:10.1037/tmb0000022.
Two studies: Study 1 = Android screen logger; Study 2 = iOS Apple Screen Time transcription.

- **Instrument and ladder rung.**
  **Study 1 — Rung 2 (screen on/off only).** "Objective smartphone data was collected using
  an application developed specifically for the project called Activity Logger (Geyer, 2018).
  This ran on Android devices and collected data to the resolution of one second. Activity
  logger was set up to listen to three events: the phone being turned on, the screen being
  activated, and the screen being turned off. Background operations then took this
  information, retrieved the current time stamp, and stored this in internal memory. This
  data file was then exported via the application and contained a list of records where a
  UNIX time stamp was paired with an event stating whether the screen was turning 'ON' or
  'OFF'."
  **Study 2 — Rung 1 (vendor aggregate, manually transcribed).** "Objective smartphone usage
  data was retrieved by utilising the Apple Screen Time feature that resides in modern
  iPhones. We used the same methodology as reported in Ellis et al. (2019) and extracted data
  retrospectively from the previous 7 days. In short, participants were prompted to find the
  'Screen Time' graph and the 'Pickups' graph in Apple Screen Time settings and record for
  each day the number of pickups and screen time (in hours and minutes)."
- **Session threshold.** **NOT STATED.** No inactivity gap is used; there is nothing to
  bridge, because the logger emits only paired ON/OFF events. A 15-second *check* definition
  appears but was deliberately dropped: "we now report daily pickups (any smartphone use)
  instead of daily checks (uses under 15 seconds) to again ensure parity between the two
  studies." The paper reports the resulting skew without invoking a threshold: "smartphone
  use was highly skewed, as 54.44% of uses were under 30 seconds in duration, and 43.54% of
  uses were under 15 seconds in duration."
- **Episode reconstruction rule.** Implicit but unambiguous for Study 1: an episode is a
  screen-ON record to its paired screen-OFF record. The paper never writes that rule as a
  sentence; it becomes visible only through the stated failure mode and its remedy: "The
  median daily hours-of-use was calculated across days two to eight for each person to remove
  the influence of any extreme 'Screen On' events that occurred if the phone battery depleted
  and the application did not log a 'Screen Off' event." And: "median daily screen time was
  calculated instead of average daily screen time to control for any long 'ON' durations.
  These could occur if a smartphone was unable to record an 'OFF' log until power is
  restored following battery depletion." For Study 2 there is no reconstruction at all —
  Apple's own aggregate is the datum.
- **System-app / launcher filtering.** **NOT STATED** — and not applicable: no app-level data
  are collected in either study.
- **Window, exclusions, aggregation.** Study 1: nine-day protocol, seven full days of data
  (days 2–8), N = 46 (preregistered 84; shortfall attributed to "laboratory access and
  technical issues"); screen savers forced to 30 s and the app battery-whitelisted;
  **median** daily screen time, **mean** daily pickups. Study 2: N = 199 from 263 respondents
  after removing non-iOS12, pre-iPhone-5, <7 days of Screen Time, incomplete surveys, one
  multivariate outlier, seven typo cases; six of seven days averaged because "data from the
  seventh day did not represent a full day"; **means**.
- **Availability.** Yes. "Data and analysis scripts for study 1 can be found on the Open
  Science Framework (https://osf.io/a4p78/)"; the same OSF node holds Study 2 data and
  scripts. Logger source code: "Source code for the application is available to download
  (https://osf.io/a4p78/)." Preregistration: https://osf.io/5g9v6.

**Access:** Full text, **accepted (peer-reviewed) manuscript version**, via University of Bath
Pure (`purehost.bath.ac.uk/ws/portalfiles/portal/211823722/Revised_Manuscript.pdf`), reached
from the OpenAlex/Unpaywall location list. The publisher-typeset gold-OA PDF at
`tmb.apaopen.org` is behind Cloudflare and returned a challenge page to both curl and
WebFetch. Page numbers quoted from the manuscript may not match the published pagination.

---

## 43. Stachl et al. (2020) — Predicting personality from patterns of behavior collected with smartphones

*PNAS* 117(30), 17680–17687. doi:10.1073/pnas.1920484117.

- **Instrument and ladder rung.** **Rung 3 (app-level event-logging research app).** "We used
  the PhoneStudy smartphone research app for Android to collect behavioral data from the
  volunteers' privately owned smartphones. This app has been continuously developed at the
  Ludwig-Maximilians-Universität München since September 2013. Initially, activities were
  recorded in the form of time-stamped logs of events. Those events included calls, contact
  entries, texting, global positioning system (GPS) locations, **app starts/installations,
  screen de/activations**, flight mode de/activations, Bluetooth connections, booting events,
  played music, battery charging status, photo and video events, and connections to wireless
  networks (WiFi)." Note that only **app starts** are named — no app-stop or
  foreground/background pairing is described, and no Android API (UsageEvents,
  UsageStatsManager, AccessibilityService) is named anywhere in the article.
- **Session threshold.** **NOT STATED.**
- **Episode reconstruction rule.** **NOT STATED in the article.** The step is acknowledged and
  then deferred: "In a first step, we extracted 15,692 variables from the raw dataset. […]
  Details about the calculation of variables and the full set of extracted variables and a
  detailed overview of all sensed data are provided in the project repository (40)." The
  paper's own availability statement then rules out reproducing exactly this step: "We provide
  the dataset and the code for variable extraction, preprocessing, and modeling in the
  project's repository (40). **Raw data files cannot be provided (due to unsolved privacy
  implications); full reproducibility is possible for the analyses but not for preprocessing
  and variable extraction.**" This is the clearest statement in the lane that the
  event→episode step is outside the reproducible record — and the analysis nevertheless
  reports "app usage" as one of six behavioural classes and the second most important
  predictor of personality.
- **System-app / launcher filtering.** **NOT STATED** in the article. App categorisation is
  handled in a companion data paper (Schoedel, Oldemeier, Bonauer & Sust 2022, entry 36 of the
  same reference list), not here.
- **Window, exclusions, aggregation.** 30 days of logging per participant; recruitment
  Sep 2014 – Jan 2018 across three studies. "We excluded data from volunteers with less than
  15 d of logging data (29), no app usage (39), and missing questionnaire data (52)." Final
  N = 624 of 743. Aggregation: robust estimators rather than plain means — "The large amounts
  of data meant it was unfeasible to check for outliers manually, so we used robust estimators
  (e.g., Huber M Estimator; ref. 61) for most variables (except for call and messaging
  variables that were checked manually)."
- **Availability.** Partial. "Data deposition: Data and code for this paper have been
  deposited in the Open Science Framework: https://osf.io/kqjhr/." Project data:
  https://osf.io/ut42y/. Raw logs and the preprocessing that produced episodes are **not**
  available (quote above).

**Access:** Full text via Europe PMC machine-readable XML of the PMC deposit
(`ebi.ac.uk/europepmc/webservices/rest/PMC7395458/fullTextXML`). The SI Appendix was not
retrieved; anything that section may add about variable construction is unread and is not
claimed here.

---

## 44. Sust, Talaifar & Stachl (2023) — Mobile application usage in psychological research

Chapter in Mehl, Eid, Wrzus, Harari & Ebner-Priemer (Eds.), *Mobile Sensing in Psychology:
Methods and Applications*, Guilford Press, pp. 184–214. No DOI.

The six-field template does not apply: this is a methods handbook chapter, not an empirical
study, so it has no instrument, window, sample or availability statement of its own.

- **What it is, verified.** The publisher's own table of contents confirms the entry exactly:
  Part II ("Mobile Sensors: Technological Know-How and Methodological How-To"), **"8. Mobile
  Application Usage in Psychological Research, Larissa Sust, Sanaz Talaifar, & Clemens
  Stachl."** Book metadata: ISBN 9781462553105, 802 pages, hardcover 20 Nov 2023, PDF e-book
  6 Oct 2023, list price $136. Worth flagging for our paper: the immediately preceding chapter
  is **"7. Analysis of Phone Logs and Phone Usage Patterns, Sandrine R. Müller, Aaron Cohen,
  Marcel Enge, & John F. Rauthmann"** — i.e. the handbook splits "phone logs" from "app usage"
  into two separate chapters by different author teams.
- **Record checks.** Not present in Crossref, not present in OpenAlex (searched by title, by
  book title, and by author). Guilford chapters are not DOI-registered, so the absence is
  expected and is not a discrepancy with the transcription. OpenLibrary confirms the book
  ("Mobile Sensing in Psychology", 2023, editors Mehl, Eid, Wrzus, Harari, Ebner-Priemer).
- **Contents.** **Not read.** No open-access copy, no preprint, no repository deposit found.
  Commercial book; no legitimate free route exists.

**Access:** **Metadata only** — publisher table of contents (guilford.com) and OpenLibrary.
The chapter text was not obtained and nothing is asserted about what it says.

---

## 45. Tkaczyk, Tancoš, Šmahel, Elavsky & Plhák (2024) — (In)accuracy and convergent validity of daily end-of-day and single-time self-reports

*Computers in Human Behavior* 158, 108281. doi:10.1016/j.chb.2024.108281. CC-BY.

- **Instrument and ladder rung.** **Rung 2 (screen on/off only), polled rather than
  event-driven.** "Data, self-reports, and the digital trace of smartphone use were collected
  through a custom-built Android mobile app that was installed on the participants' own
  smartphones." And: "The tracking app ran continuously in the background on participants'
  smartphones and **tracked the screen status (i.e., on/off) every second**. Collected data
  were stored in the device's local database and synchronized regularly with a database on a
  dedicated secured server." No app identity is captured at all.
- **Session threshold.** **Declared, 15 seconds — but as a session-*length* classifier, not an
  inactivity gap.** Verbatim: "We operationalized phone-checking behavior as a screen-on
  session that lasts no longer than 15 s. **The 15-second period was based on prior studies
  (Andrews et al., 2015; Wilcockson et al., 2018).**" That is the entire justification: two
  citations, one of which (Wilcockson, entry 50 below) itself attributes the figure to the
  other (Andrews et al. 2015).
- **Episode reconstruction rule.** **Declared, verbatim:** "We operationalized screen time as
  screen-on time. **The screen-on session is the length of time between screen-on and
  subsequent screen-off (Pan et al., 2019).**" A pointer to further detail exists but sits
  outside the article: "More details on how we collected and preprocessed the digital trace
  data of smartphone use can be found in Appendix A." (Appendix A is Elsevier supplementary
  material and was not retrieved.)
- **System-app / launcher filtering.** **NOT STATED**, and not applicable — screen-level only.
- **Window, exclusions, aggregation.** 14 consecutive days (10 school, 4 non-school) in
  January 2022, Czech adolescents, Android 5+, N = 137 analysed (mean age 14.95). Day boundary
  for the trace is declared: "the digital trace included data for a given day from 4 a.m.
  until the time of the end-of-day questionnaire." Missingness is quantified and attributed:
  "On average, the ratio of missing digital trace data for each participant was 25.78% of the
  so-called typical waking day (8 a.m. – midnight). Findings of the analysis of the missing
  data showed that the vast majority of instances of screen-NA sessions (96.16%) were shorter
  than 10 min and were most-likely due to optimization processes on a device initiated by the
  Android OS." Sensitivity analyses at three NA thresholds; the 40% NA threshold sample is
  reported. Participant exclusion: "we excluded from the analysis participants who had less
  than two valid observations (out of 10) on school days and no valid observations (out of 4)
  on non-school days." Eleven participants (8%) dropped out. Extreme values winsorized
  (Verbeij et al. 2021 approach) but non-winsorized results reported; checking counts
  log-transformed; both means and medians reported.
- **Availability.** Data yes, code not stated: "We have shared the link to our data at the
  Attach File step: https://osf.io/rs9x8/."

**Access:** Full text of the **published CC-BY version**, via the Zenodo deposit of the
article (record 20625089, file
`Tkaczyk_M_InAccuracy_Computers in Human Behaviour_2024_05_01.pdf`). ScienceDirect returned
403 to both curl and WebFetch; the Masaryk repository page (is.muni.cz) is JS-rendered and
therefore unavailable by the allowed methods. Appendix A (preprocessing detail) is Elsevier
supplementary material and was **not** read.

---

## 46. Toth & Trifonova (2021) — Somebody's Watching Me: Smartphone Use Tracking and Reactivity

*Computers in Human Behavior Reports* 4, 100142. doi:10.1016/j.chbr.2021.100142. CC-BY-NC-ND.

The most fully declared study in this lane, and the one that documents its own reconstruction
failures.

- **Instrument and ladder rung.** **Rung 4 (raw platform event log with named event
  semantics).** "For answering our research questions, we developed an Android app, A Tricky
  Tracker (ATT), that collected data that were produced before as well as after its
  installation." And: "ATT accessed a log file implemented within the Android operating system
  which stores all actions occurring on the device, so-called events. Events are further
  categorized by event types, which are listed in the official Android documentation (Google,
  2019c)." Table 1 names the six event types used: **1 Activity resumed, 2 Activity paused,
  17 Keyguard shown, 18 Keyguard hidden, 26 Device shutdown, 27 Device booted**, with the
  footnote "Keyguard corresponds to the phone lock screen (Google, 2020b). In Android versions
  below 9, activity resumed corresponds to activity moved to the foreground and activity
  paused to activity moved to the background." Android 9 was required for the phone-level
  analysis because lock/unlock events are not logged below 9. Retrospective window: "The
  Android log file typically contains data from up to two weeks in the past."
- **Session threshold.** **No inactivity threshold. A maximum-duration cutoff of 5 hours is
  declared, and justified only by deference to a prior paper:** "In the end, we settled for a
  cutoff value of 5 h, **which Andrews et al. (2015) considered very long use.** Below that,
  there were still long use sessions – however, they took place in apps where long,
  uninterrupted use sessions are reasonable, e.g., Pokémon GO, YouTube, or Twitch."
- **Episode reconstruction rule.** **Declared, event by event.** Phone-level: "A use session
  indicated the time span between the first and the last events of a consistent use episode.
  With regard to smartphone use, event types 18 (keyguard hidden) and 27 (device booted) were
  considered first events, and event types 17 (keyguard shown) and 26 (device shutdown) last."
  App-level: "With regard to app use, event type 1 (activity resumed) was considered first
  events, and event types 2 (activity paused), 17 (keyguard shown), and 26 (device shutdown)
  last. As many apps feature multiple activities (Google, 2019a), **any consistent sequence of
  activities performed within a single app without interruption was considered part of the
  same app use session.**" Duration: "We represented the duration of use sessions by
  calculating the difference between the time stamps of the start and the end of a use
  session." The pipeline is also described: "We programmed a parser in Python that extracted
  all relevant data from the .json files and then transformed and merged them into a single
  data frame. Each row of this data frame represented a single event on one device […] We then
  iteratively aggregated and transformed the data frame such that each row represented one use
  session."
  Critically, the paper reports that the rule **failed** and says so: "Following this approach,
  even data generated after the installation of ATT contained (seemingly) uninterrupted app
  use sessions that lasted extremely long (e.g., 12 h). Further investigation showed that
  **interruptions of app uses through screen locks and shutdowns were probably not always
  captured properly.** Andrews et al. (2015) faced similar problems. […] Even then, there were
  very long, consistent app uses without interruptions (up to 9 h). Those were probably still
  instances where internal Android mechanisms failed to register screen locks."
- **System-app / launcher filtering.** **Declared, but the list is not:** "We excluded events
  regarding some system-related apps and functions as recommended in previous research (Jones,
  Ferreira, Hosio, Goncalves, & Kostakos, 2015)." Which apps and functions is never specified.
  App categorisation was automated: "We automatically assigned all apps a type according to the
  Google Play Store […] we used the Python library Google-Play-Scraper (JoMingyu, 2020). Apps
  that could not be categorized were assigned the type 'Other.'"
- **Window, exclusions, aggregation.** Two weeks of tracking plus up to two weeks of
  retrospective log; data collection 12 Dec 2019 – 11 Jan 2020; N = 25 Android 9 users.
  Exclusions, verbatim: "Data from four participants were excluded from the smartphone use
  data set. One did not provide pre-installation data at all. One accounted for most
  exceedingly long, seemingly uninterrupted smartphone use sessions (up to 12 h). Two
  participated only for (part of) the first day after having installed ATT. Finally, we
  excluded all data from the first and last days provided by each participant in order to omit
  incomplete data for these days, especially with regard to use frequency." Christmas/New Year
  days (23 Dec – 1 Jan) flagged and excluded from frequency analyses. Aggregation: **medians**,
  because "The distribution of session duration was strongly right-skewed (γphone = 10.35,
  γapps = 16.68) as a great majority of use sessions was fairly short (Mdn_phone = 46.04 s,
  Mdn_apps = 11.64 s). Therefore, we used median values for visualizing central tendencies";
  duration log-transformed for regression.
- **Availability.** Stated but not as a public repository URL: "All data, analysis code and a
  visualization of individual participants' smartphone and app use over time can be found in
  the online supplementary material (OSM)" — i.e. Elsevier-hosted supplementary data, not OSF
  or GitHub.

**Access:** Full text of the **published version**, via the Freie Universität Berlin Refubium
repository (`refubium.fu-berlin.de/bitstream/handle/fub188/33964/Somebody_is_watching_me.pdf`).
ScienceDirect and the Weizenbaum Library mirror both blocked automated retrieval. The
supplementary material (data + code) was not retrieved.

---

## 47. Toth, R. (2023) — One App to Assess Them All

*Publizistik* 68(2–3), 281–290. doi:10.1007/s11616-023-00788-6. Springer, CC-BY (hybrid OA).

**Record confirmed and it matches the transcription exactly** (Publizistik, vol. 68, issue 2–3,
pp. 281–290, 2023, single author Roland Toth). The earlier "unresolvable" status was almost
certainly a retrieval artefact — Springer serves this DOI a JS "Client Challenge" to
browser-like clients, but returns the OA PDF to a plain client.

- **Language.** **The article body, abstract, and all section headings are in English.** Only
  the parallel abstract is German ("Zusammenfassung … Schlüsselwörter: App · Datenerhebung ·
  Methodenkombination · Open Science"), plus the German subtitle "Kombination von Befragung,
  Experience Sampling und Logging/Datenspende in einer Android- und iOS-App". The journal is
  German-language; this article is not. It is typed **AUFSATZ** (article).
- **What the app is.** MART (Mobile Assessment Research Tool), a free/open-source Android +
  iOS research app combining survey, ESM, and logging/data donation. "MART was initially
  developed by nvii-media GmbH (2022) as part of a research project led by the author of this
  article. The project was funded by the German Research Foundation (DFG)." Configuration is
  driven from a WordPress backend over the WP REST API; data export as .csv.
- **Instrument and ladder rung.** **Rung 4 on Android; Rung 1 on iOS.** Android: "On Android
  devices, MART can access a log file containing all events that take place on the smartphone.
  Events are categorized into event types (for more details, see the official Android
  documentation, cf. Google 2022). They include activities like locking or unlocking the
  screen, opening or closing apps, and booting or shutting down the device. The log file
  'contains data from up to two weeks in the past' (Toth and Trifonova 2021, p. 3) up to the
  time it is accessed. The accessible information includes the event type, a time stamp, and
  additional information depending on the event type (e.g., app names). Please note that no
  information on contents received on the smartphone, such as texts or images, is captured."
  iOS: "On iOS devices, events cannot be assessed this way (cf. Apple Inc. 2022). MART still
  offers a way to gather aggregated phone and app use duration and frequency. This works by
  giving study participants detailed instructions on accessing the iOS feature Screen Time,
  describing which information to read there (e.g., daily average use duration and number of
  pickups during the current week), and asking them to enter these figures into designated
  fields. This approach is data donation, as the data are not logged passively in the
  background but manually transferred and curated by participants."
- **Session threshold.** **NOT STATED.**
- **Episode reconstruction rule.** **NOT STATED as a rule.** The nearest statement is a claim
  about what is *stored*, made in the data-protection section: "On Android, the logging
  function only collects the start and end points of phone and app uses." Which events count
  as a start and which as an end is never specified in this article; the reader is pointed at
  Toth & Trifonova (2021) (entry 46) for the log's properties. Since this is a tool paper with
  no dataset, the omission means an adopter of MART inherits an undeclared reconstruction.
- **System-app / launcher filtering.** **NOT STATED.**
- **Window, exclusions, aggregation.** **Not applicable** — no study, no sample, no analysis.
  The only window mentioned is the Android log's own ~2-week retrospective horizon.
- **Availability.** Yes, source code: "The source code is available on GitHub (cf. Toth 2023)"
  → reference entry "Toth, R. (2023). MART (Version 0.22.0)", **https://github.com/tothrol/MART**.
  Funding/APC: BMBF grant 16DII131 and the Weizenbaum Institute OA fund.

**Access:** Full text of the **published CC-BY version**, via the Springer OA PDF
(`link.springer.com/content/pdf/10.1007/s11616-023-00788-6.pdf`) fetched with a plain
(non-browser) client. The same URL returns a JS "Client Challenge" page to browser-like
clients, and WebFetch was bounced to a Springer IdP redirect.

---

## 48. Van Canneyt, Bron, Haines & Lalmas (2017) — Describing Patterns and Disruptions in Large Scale Mobile App Usage Data

*WWW '17 Companion*, 1579–1584. doi:10.1145/3041021.3051113. Nominally gold OA / CC-BY per
Unpaywall and Semantic Scholar — but see Access.

**I could not read this paper.** The fields below are marked accordingly; nothing is inferred
from the abstract to fill a blank.

- **Instrument and ladder rung.** **UNVERIFIED.** The abstract describes "a data set unique in
  its scale and coverage of user activity" collected in an advertising-industry context
  (authors were at Yahoo/Oath; OpenAIRE records Yahoo and Ghent University affiliations), so
  the instrument is almost certainly a proprietary vendor SDK — but I did not read the data
  section and will not assert a rung.
- **Session threshold.** **10 seconds — attested only at second hand.** The verbatim sentence
  that sets the threshold is the deliverable and **I did not obtain it.** What I did verify is
  the field's own record of it, from Zhu et al. (entry 51, read in full):
  > "The threshold approach is inherited from web browsing research that has defined a session
  > based on a threshold determined by the duration of inactiveness, such as 30 seconds in
  > Böhmer et al. (2011) or 10 seconds in Van Canneyt et al. (2017). **The threshold is
  > arbitrarily chosen.**"
  A sweep of all 100 Semantic Scholar citation contexts for this DOI turned up exactly one
  other source stating a numeric threshold for it — the same Zhu passage. No citing paper in
  that set reproduces Van Canneyt's own justification, which is itself informative.
- **Episode reconstruction rule.** **UNVERIFIED.** One thing is known from the other direction:
  Zhu et al. report that this dataset's structure defeats single-app sessions — "As such, the
  problem [multiple apps simultaneously in the foreground] makes the measurement of a
  single-app session impossible (Van Canneyt, Bron, & Haines, 2017)." Zhu et al.'s Table 3 also
  records Van Canneyt's mean session length as 5–7 minutes.
- **System-app / launcher filtering.** **UNVERIFIED.**
- **Window, exclusions, aggregation.** **UNVERIFIED.** Abstract only: "we study user app
  engagement patterns and disruptions of those patterns in a data set unique in its scale and
  coverage of user activity."
- **Availability.** **UNVERIFIED.** Proprietary advertising data; no repository deposit found.

**Access:** **Abstract and bibliographic metadata only** (Semantic Scholar Graph API + Crossref
+ DBLP). The ACM Digital Library returns **HTTP 403** for `/doi/`, `/doi/pdf/` and
`/doi/fullHtml/` to both curl and WebFetch. No OA mirror exists: Unpaywall lists only the ACM
landing page; OpenAIRE lists no full-text location; the WWW 2017 conference site
(`www2017.com.au`, `papers.www2017.com.au`) is dead and the Wayback CDX index holds only its
calls-for-papers, no proceedings PDFs; the corresponding author's own publications page
(mounia-lalmas.blog) lists this paper without a PDF link; Zenodo and CiteSeerX have nothing.
Bibliographic note: DBLP gives the second and third authors as **Marc** Bron and **Andy**
Haines, and Zhu et al.'s reference list omits Lalmas entirely ("Van Canneyt, S., Bron, M., &
Haines, A. (2017)"). The transcription's "Bron, M., Haines, A." is consistent with the record.

---

## 49. Wenz, Keusch & Bach (2024) — Measuring Smartphone Use: Survey Versus Digital Behavioral Data

*Social Science Computer Review* 43(5), 1030–1049. doi:10.1177/08944393231224540. CC-BY.

- **Instrument and ladder rung.** **Commercial third-party tracking SDK; durations arrive
  pre-computed. Nominally Rung 3, effectively Rung 1 for anything about episodes.** "To collect
  DBD from their devices, all panel members in this study had agreed to install a browser
  plug-in on their personal computers and/or download a research app on their mobile devices.
  **The tracking technology, developed by Wakoopa, was provided by the online panel**, and all
  participants had the technology already installed prior to the participation in this study."
  And: "the research app captured the names of the apps that panel members used on their
  smartphone, **including the date, time, and duration of any instance of use**." The duration
  is the vendor's output, not a quantity the authors derive; no Android API, event type, or
  foreground/background rule is named anywhere in the article.
- **Session threshold.** **NOT STATED.**
- **Episode reconstruction rule.** **NOT STATED.** The closest the paper comes is the sentence
  quoted above — the duration of "any instance of use" is simply received. What the authors do
  from there is aggregate: "To measure amount of use, the time spent on all apps across all
  tracked smartphones during the data collection period were aggregated for each participant.
  The aggregated time was then divided by the number of days for which the participants'
  devices were tracked to create a measure on the day level." The limitations section
  acknowledges a *different* limitation of the same data ("Since only the name of the app is
  recorded and not the type of activity carried out within the app, the classification of apps
  into activities…") without ever raising the question of how "duration" was computed.
- **System-app / launcher filtering.** **NOT STATED.** App classification into 13 activity
  types is declared: "For the classification of apps into types of activities, the original
  categories provided by the app stores were used as the starting point and were refined
  through manual coding" — but no system-app or launcher exclusion is mentioned, so launcher
  and system-UI time may or may not be inside the reported 112.1 min/day mean.
- **Window, exclusions, aggregation.** Tracking window 15 Jul – 7 Sep 2021, German opt-in
  online panel (Respondi/Bilendi), N = 1204 smartphone users; "participants provided DBD for a
  median of 47 days, with a range of 1–55 days"; 88.9% Android, 11.1% iOS; 4.2% contributed two
  devices. Only ~30% of invited panel members allowed DBD collection. Both **mean and median**
  reported (DBD amount of use: mean 112.1 min, median 84.8 min; survey: mean 229.1, median
  180.0). One explicit data-cleaning rule, in a footnote: "To account for outliers in the
  amount of smartphone use, values smaller than the first percentile (10 min) or larger than
  the 99th percentile (1200 min) were winsorized to the first percentile or 99th percentile
  values."
- **Availability.** Partial. "The survey data are available from the GESIS Data Archive for the
  Social Sciences at https://doi.org/10.7802/2524. **The digital behavioral data are available
  upon request** from Ruben Bach at r.bach@uni-mannheim.de." Also: "The scheme for classifying
  apps into categories and the analysis code are available at
  https://doi.org/10.17605/OSF.IO/RV4YX."

**Access:** Full text of the **published CC-BY version**, via the University of Mannheim MADOC
repository PDF, fetched with a plain (non-browser) client. SAGE returned 403 to WebFetch;
MADOC serves a JS anti-bot challenge to browser-like clients but the PDF to a plain one. The
Online Appendix (Table S1 etc.) was not retrieved.

---

## 50. Wilcockson, Ellis & Shaw (2018) — Determining Typical Smartphone Usage: What Data Do We Need?

*Cyberpsychology, Behavior, and Social Networking* 21(6), 395–398. doi:10.1089/cyber.2017.0652.

The 15-second "check" definition is confirmed from the source, and it is **asserted by citation,
not justified**.

- **Instrument and ladder rung.** **Rung 2 (device active/inactive only), and not strictly
  screen-based.** "We developed an Android smartphone app using the Funf in a Box framework 8.
  This resulted in a small app that recorded a timestamp when smartphone use started and ended.
  Data is encrypted and uploaded to a server over Wi-Fi (for more details see 8). The app
  provided a timestamp when the phone became active, and a second when this activity stopped
  and the phone was inactive. **This was primarily anything that involved screen use, but also
  included processor intensive activities (e.g., calls and playing music).**" That last clause
  matters: "active" is not identical to "screen on", and the paper does not say how the two
  were distinguished.
- **Session threshold.** **No inactivity threshold. A 15-second check threshold is used and is
  attributed, not derived.** The exact sentence: "Frequency of use (or checking) was measured
  in terms of number of smart phone checks, **which were defined by 6 as any usage lasting less
  than 15 seconds.**" Reference 6 is **Andrews, Ellis, Shaw & Piwek (2015), PLOS ONE 10(10),
  e0139004** — entry 1 of the same Winklbauer & Batinic reference list. **No justification for
  the 15-second figure appears anywhere in this paper.** The abstract carries it forward as a
  finding: "habitual checking behaviours (uses lasting less than 15 seconds) can be reliably
  inferred within two days." The nearest thing to a rationale is post hoc and about the
  measure's usefulness, not its cut point: "One may question why phone checking frequency
  provides a more efficient measure of usage? It is possible that this variable is a better
  measure of preoccupation with mobile phones."
- **Episode reconstruction rule.** Implicit but unambiguous, and never written as a rule: an
  episode runs from the "phone became active" timestamp to the paired "activity stopped"
  timestamp. Derived measures: "Two behavioural measures were generated at the end of each day:
  total hours of usage and frequency of use. Total hours of usage was determined by the amount
  of time that the phone was active."
- **System-app / launcher filtering.** **NOT STATED** — not applicable; no app-level data.
- **Window, exclusions, aggregation.** N = 27 University of Lincoln staff and students (17
  female, mean age 22.52, range 18–33). "Data was collected for 14 days, however, due to
  between-participant time differences when the app was installed, we removed data collected
  between application installation and midnight of day one. This left 13 complete days of data
  for analysis." Week 1 = weekend + 4 weekdays; week 2 = weekend + 5 weekdays. Daily totals;
  Pearson correlations between cumulative running means of week 1 and week-2 totals; MPPUS also
  analysed with Spearman rank-order. Headline conclusion: 5 days suffice for hours of use,
  2 days for checks.
- **Availability.** **NOT STATED.** No data, code, or preregistration statement in the
  manuscript. The dataset is a secondary analysis of Andrews et al. (2015): "The data obtained
  for this study has previously been described in 6."

**Access:** Full text, **accepted manuscript version**, via Lancaster University eprints
(`eprints.lancs.ac.uk/id/eprint/124444/1/CBSN_TW.pdf`), reached from the OpenAlex location
list. The publisher version at liebertpub.com (bronze OA) was not retrieved. Figures are
placeholders in this version ("[insert Figure 1 about here]"), but all Methods and Results
prose is present.

---

## 51. Zhu, Chen, Peng, Liu & Dai (2018) — How to measure sessions of mobile phone use?

*Mobile Media & Communication* 6(2), 215–232. doi:10.1177/2050157917748351. **Closed access at
SAGE.** Read via the authors' arXiv preprint — see Access, and read the version caveat there.

This is the origin of the threshold-based vs screen-based dichotomy, and the paper states the
dichotomy, evaluates it, and publishes its own algorithm.

### The dichotomy, exactly as stated

> "Previous studies have used two ways to measure sessions of mobile phone use:
> **threshold-based versus screen-based**. The threshold approach is inherited from web browsing
> research that has defined a session based on a threshold determined by the duration of
> inactiveness, such as 30 seconds in Böhmer et al. (2011) or 10 seconds in Van Canneyt et al.
> (2017). **The threshold is arbitrarily chosen. In addition, the approach does not distinguish
> user-initiated tasks from machine-operated tasks.** The screen-based approach has been adopted
> to overcome these problems. The approach defines a session based on the deactivation of the
> screen of the phone, **assuming that the screen status is a valid indicator of intentional
> human behavior**. Falaki et al. (2010) treated the duration whenever the screen is on, a voice
> call is active, or an app runs in the foreground as a session. Yan et al. (2012) followed the
> same logic by defining a session as a sequence of apps launched between the unlocking and
> relocking of the screen."

Its web-browsing ancestry is stated too: "A threshold-based approach is widely used to identify
sessions, which assumes the continuity of user browsing behavior. Therefore, a substantially
long break between two adjacent requests is considered evidence of the expiration of a session
(Mehrzadi & Feitelson, 2012). Certain studies have adopted a global threshold (e.g., 30 minutes)
to define the break between sessions for all users (Arlitt, 2000; Menasc et al., 1999). **The
global threshold makes a strong (but generally unrealistic) assumption about the homogeneity of
users.**"

Their own definition: "we define session as a continuous sequence of tasks initiated by a user on
a media device. The term 'sequence of tasks' indicates that we have adopted the **multi-app**
version of session. The emphasis on 'user initiation' excludes tasks that are activated by
machine."

### Their recommendation

They adopt the **screen-based** approach, for a stated reason: "The first problem is that many
log records are machine-activated by either an operating system or apps. Thus, these tasks should
not be counted as session time. Moreover, the dataset has no information that indicates whether
tasks are operated by machine or by human. **We have adopted a screen-based approach to address
the problem, i.e., treating screen unlocking and locking as the start and end time of a
human-operated session, respectively.**" They also record the constraint that forced multi-app
sessions: "The second problem involves the situations where multiple apps are simultaneously
running in the foreground, which defies the logic that only one foregrounded app should be
running at any given time. […] the problem makes the measurement of a single-app session
impossible (Van Canneyt, Bron, & Haines, 2017)." They call for single-app replication: "In future
research, we call for replications of the current study that will use probability samples and
single-app sessions." And they position session as additive, not a replacement: "session is not a
replacement but rather a complement of equal-length measures."

### How they evaluate competing definitions

Not by re-running rival thresholds on their own data. They evaluate by (a) **external validity**
against five benchmark studies, tabulating total time, mean session length and session count
against Winnick (2016), Falaki et al. (2010), Yang et al. (2015) and Van Canneyt et al. (2017),
with a stated caveat — "Conducting a significance test of the comparison is difficult for two
reasons: (i) the five studies under comparison are heterogeneous in many aspects and (ii) the
required information (e.g., standard deviations) for the significance test is unavailable. The
informal comparison is only indicative of the direction and range of observed differences." — and
they read the residual disagreement as a **definition** effect: "The reason why we obtained fewer
sessions but longer session length than what Falaki et al. obtained may be due to the different
definitions of session (multiple apps in ours but a single app in Falaki et al.)." (b)
**Discriminant validity** against equal-length time: squared semi-partial correlation of 0.018
raw / 0.284 logged, i.e. "the degree of redundancy between the number of sessions and the length
of time is weak (2%) or modest (28%)". (c) **Modularity** for the clustering steps (0.77–0.80 for
session-clusters, 0.83 for user-communities).

### Six fields

- **Instrument and ladder rung.** **Rung 4 (raw platform event log, secondary use of an open
  dataset).** "Our data were obtained from an open source provided by the Device Analyzer project
  at Cambridge University ('Cambridge data' hereafter) that has used an app to collect mobile
  phone logs from volunteer participants (Wagner, Rice, & Beresford, 2013). Over 31,000 users
  installed the app on their Android-based phones between December 2010 and February 2016." The
  log content: "the Cambridge data contain the start and end time of phone tasks (e.g., phone
  calls, short messages, and apps) in milliseconds."
- **Session threshold.** **None used, by design.** Thresholds are reported as prior practice
  (30 s Böhmer, 10 s Van Canneyt) and rejected: "The threshold is arbitrarily chosen."
- **Episode reconstruction rule.** **Declared, and published as pseudo-code** — the only paper in
  this lane to do so. Prose: "We develop an algorithm to identify and construct sessions from the
  log data. For each user, the algorithm iterates through each line of logs to capture the wake-up
  time, unlocked time, and locked/shutdown time of the phone. The algorithm then constructs
  sessions based on the unlocking and locking time (see the pseudo code in Appendix 1). The
  resulting dataset (called 'sessions') contains each session as a row, with user ID, session ID,
  start time, end time in the columns, and multiple rows per user." Appendix 1 gives the state
  machine: `screen_on` → `keyguard_removed` (else reset `screenon`) → `screen_off` **OR**
  `shutdown` closes the session; unlocked and locked lines are written out. Multi-app rule:
  "when a user performs several tasks (talking, texting, and using apps) between the unlocking and
  locking of the screen, we treat the multiple tasks as a continuous session (i.e., a multi-app
  session)."
- **System-app / launcher filtering.** **Not a list — a mechanism.** Machine-activated records are
  excluded structurally rather than by name-list, because only unlock→lock intervals count. No
  package-name exclusion list is given (and none is needed under a screen-bounded definition).
- **Window, exclusions, aggregation.** Device Analyzer collection Dec 2010 – Feb 2016; "Of the
  users in the current study, 4,017 are 'active' and have valid records on 10+ days (median = 130
  days)"; 18.2 million sessions. For the fragmentation-trend application a stricter rule:
  "we select users who had records on 10+ days per month for 3 consecutive months. Over 3,100
  users meet the criteria." Aggregation: **median preferred over mean, explicitly because of the
  power law** — "the amount of time is highly-uneven across users, following a power-law
  distribution (Fig. 3a) […] Therefore, it will be appropriate to describe the length of time in
  the median (= 97 minutes or 1.5 hours)". Headline numbers: 175 min/day mean, 97 median; 24
  sessions/day mean, 18 median; 17 min mean session length, **4 min median**. 22,000+ sessions
  (0.12%) could not be assigned to any cluster and were left out of the cluster analysis.
- **Availability.** Input data are public (Device Analyzer, Cambridge). The session-construction
  algorithm is published as pseudo-code in Appendix 1 and the community-detection distance
  functions in Appendix 2. **No code repository or derived-data deposit is stated.**

**Access:** **Full text of the authors' arXiv preprint**, arXiv:1711.09408v1, submitted
26 Nov 2017, PDF from `arxiv.org/pdf/1711.09408`. The arXiv page carries the comment "Preprint of
forthcoming article in Mobile Media & Communication" and the PDF's own footer reads "Preprint for
forthcoming in Mobile Media & Communication". **The published SAGE version is closed access**
(OpenAlex `oa_status: closed`, no OA location; Unpaywall lists none; journals.sagepub.com returns
403 to WebFetch), so I could not diff preprint against published text — every quotation above is
from the preprint and may have been edited in production. **Title discrepancy to note:** the
preprint is titled "How to Measure Sessions of Mobile **Device** Use?"; the published article and
the Winklbauer & Batinic transcription both say "mobile **phone** use". Author list, affiliations
(CityU HK / Michigan State / Southeast University) and Crossref metadata (MMC 6(2), 215–232, May
2018) otherwise match the transcription exactly.

---

## Lane 5 summary

**Full text obtained: 8 of 10.** Seven of those are the published or accepted-manuscript version
(42, 43, 45, 46, 47, 49, 50); the eighth (51) is the authors' arXiv preprint of a paywalled
article. **One abstract/metadata only** (48, ACM Digital Library blocks automated retrieval and no
OA mirror exists). **One not read at all** (44, commercial Guilford handbook chapter; the record
itself was verified against the publisher's table of contents).

**Session threshold declared: 3 of 10** — and none of the three is an inactivity-gap threshold of
the kind that Winklbauer & Batinic's multiverse held fixed:
- 45 Tkaczyk — 15 s, a session-*length* classifier for "checks"
- 50 Wilcockson — 15 s, same classifier, same lineage
- 46 Toth & Trifonova — 5 h, a maximum-session *cutoff*, not a gap
Entry 48 carries the field's shortest inactivity threshold (10 s) but I could not verify it from
the source. Entry 51 reports thresholds only to reject them. Entries 42, 43, 47 and 49 state none.

**Episode reconstruction rule declared: 4 of 10 explicitly** (45, 46, 47-partially, 51), of which
only **1 publishes an algorithm** (51, pseudo-code in Appendix 1). Two more (42, 50) are implicit
but unambiguous because their instrument emits only one event pair. **Three state nothing at all**
(43, 49, and 47 as a rule rather than a storage claim) — and two of those three (43, 49) are
large-N studies whose headline quantity is an app-usage duration.

**Ladder rungs:**
- **Rung 4** (raw platform event log with declared semantics): 46 (Android UsageEvents, event
  types 1/2/17/18/26/27 named), 47 (Android event log, Android-side), 51 (Device Analyzer:
  `screen_on`/`keyguard_removed`/`screen_off`/`shutdown`). **3**
- **Rung 3** (app-level event-logging research app, semantics undeclared): 43 (PhoneStudy —
  "app starts", no API named), 49 (Wakoopa vendor SDK — app name + vendor-computed duration; for
  episode semantics this is effectively Rung 1). **2**
- **Rung 2** (screen/device on-off only): 42 Study 1 (Activity Logger), 45 (screen status polled
  every second), 50 (Funf, device active/inactive). **3**
- **Rung 1** (vendor aggregate): 42 Study 2 (Apple Screen Time, hand-transcribed), 47 iOS side
  (Screen Time data donation). **2 instances, both inside papers counted above.**
- **Unverified**: 48. **Not applicable**: 44.

**Surprises.**
1. **Entry 43 (Stachl, PNAS) says out loud that the reconstruction step is unreproducible**:
   "Raw data files cannot be provided (due to unsolved privacy implications); full reproducibility
   is possible for the analyses but not for preprocessing and variable extraction." The paper then
   reports app usage as the second most important predictor class for personality. This is the
   single strongest sentence in the lane for the thesis: the field's flagship demonstration of
   smartphone-based personality prediction concedes that the event→episode layer under its
   "app usage" features cannot be rerun by anyone else.
2. **Entry 46 (Toth & Trifonova) is the counter-example that proves the point.** It is the only
   empirical paper here that names its event types, states which open and close a session, admits
   the rule failed ("interruptions of app uses through screen locks and shutdowns were probably not
   always captured properly" — 12 h and 9 h phantom sessions), and then patches it with an
   arbitrary 5 h cutoff borrowed from Andrews et al. Full declaration did not make the problem go
   away; it made the problem *visible*. Every other app-level paper in the lane had the same
   failure mode available to it and simply never mentions it.
3. **Entry 49 (Wenz) shows the reconstruction escaping into a vendor.** "duration of any instance
   of use" arrives from the Wakoopa SDK already computed. The authors carefully caveat app→activity
   classification and never once ask how a "duration" was formed. N = 1204, a 55-day window, and a
   headline 112.1 min/day whose definition exists only inside a commercial SDK.
4. **Entry 51 (Zhu) already named the problem in 2018** — "The threshold is arbitrarily chosen" —
   and published a working algorithm as an appendix. Eight years later the field still cites the
   dichotomy and still does not declare which side of it a given paper is on.
5. **Entry 47 resolved cleanly.** The "previously unresolvable" citation is fine: Publizistik 68
   (2–3), 281–290, single author Roland Toth, English body text with a German abstract, CC-BY,
   MART source at github.com/tothrol/MART. Springer simply serves a JS challenge to browser-like
   clients and the OA PDF to a plain one.
6. **Entry 48 is the only genuinely unreachable primary source in the lane** — and it is nominally
   **CC-BY gold open access**. A CC-BY paper that no automated client can read, whose most-cited
   contribution to this literature is a number (10 s) now known to the field only through a
   secondary citation, is itself a finding about how thresholds propagate.

---

## Threshold provenance

Every session-related numeric threshold found in entries 42–51, with its verbatim justification
and how the value was obtained. "Inactivity gap" = the classic session-splitting threshold;
"length classifier" = a cut point that labels an already-bounded episode; "max cutoff" = an upper
bound on a single episode.

| Entry | Value | Kind | Verbatim justification in the source | How obtained |
|---|---|---|---|---|
| **50** Wilcockson, Ellis & Shaw (2018) | **15 s** | length classifier ("check") | "Frequency of use (or checking) was measured in terms of number of smart phone checks, **which were defined by 6 as any usage lasting less than 15 seconds.**" (ref. 6 = Andrews, Ellis, Shaw & Piwek 2015). **No further justification anywhere in the paper — inherited by citation.** | Full text read (Lancaster eprints accepted manuscript) |
| **45** Tkaczyk et al. (2024) | **15 s** | length classifier ("phone-checking") | "We operationalized phone-checking behavior as a screen-on session that lasts no longer than 15 s. **The 15-second period was based on prior studies (Andrews et al., 2015; Wilcockson et al., 2018).**" **Justification is two citations, one of which is row 1 of this table, which itself cites the other.** | Full text read (Zenodo copy of published CC-BY version) |
| **46** Toth & Trifonova (2021) | **5 h** | max cutoff on app sessions | "In the end, we settled for a cutoff value of 5 h, **which Andrews et al. (2015) considered very long use.** Below that, there were still long use sessions – however, they took place in apps where long, uninterrupted use sessions are reasonable, e.g., Pokémon GO, YouTube, or Twitch." Adopted *because the event-based rule demonstrably failed*: "interruptions of app uses through screen locks and shutdowns were probably not always captured properly." | Full text read (Refubium published version) |
| **48** Van Canneyt et al. (2017) | **10 s** | inactivity gap | **Not obtained from the source.** Attested only second hand, by Zhu et al.: "…such as 30 seconds in Böhmer et al. (2011) or **10 seconds in Van Canneyt et al. (2017)**. **The threshold is arbitrarily chosen.**" | **Secondary attestation only** — entry 51 read in full; ACM DL 403, no OA mirror. Semantic Scholar citation-context sweep (100 citing papers) surfaced no independent statement of the value. |
| **51** Zhu et al. (2018), reporting prior art: Böhmer et al. (2011) | **30 s** | inactivity gap | Reported, then rejected: "The threshold approach is inherited from web browsing research… such as **30 seconds in Böhmer et al. (2011)**… **The threshold is arbitrarily chosen. In addition, the approach does not distinguish user-initiated tasks from machine-operated tasks.**" | Read in entry 51 (arXiv preprint). **Not verified against Böhmer et al. itself** — that is entry 5, another lane. |
| **51** Zhu et al. (2018), reporting prior art: web-browsing literature | **30 min** | inactivity gap | "Certain studies have adopted a global threshold (e.g., 30 minutes) to define the break between sessions for all users (Arlitt, 2000; Menasc et al., 1999). **The global threshold makes a strong (but generally unrealistic) assumption about the homogeneity of users.**" | Read in entry 51 (arXiv preprint) |
| **51** Zhu et al. (2018), own choice | **none** | — | Screen-bounded instead of threshold-bounded: "**We have adopted a screen-based approach to address the problem, i.e., treating screen unlocking and locking as the start and end time of a human-operated session, respectively.**" Algorithm published as pseudo-code (Appendix 1). | Full text read (arXiv:1711.09408v1) |
| **42** Shaw et al. (2020) | **15 s** (mentioned, then dropped) | length classifier | Not used as a measure; reported only as a distributional fact — "43.54% of uses were under 15 seconds in duration" — and explicitly abandoned: "we now report daily pickups (any smartphone use) instead of daily checks (uses under 15 seconds) to again ensure parity between the two studies." | Full text read (Bath Pure accepted manuscript) |
| **43** Stachl et al. (2020) | **none stated** | — | No threshold, no gap, no cutoff appears in the article. Preprocessing is deferred to a repository and declared non-reproducible. | Full text read (Europe PMC XML) |
| **47** Toth (2023) | **none stated** | — | Tool paper; "On Android, the logging function only collects the start and end points of phone and app uses" is the only statement, and it names no events and no threshold. | Full text read (Springer OA PDF) |
| **49** Wenz et al. (2024) | **none stated** | — | Durations are received pre-computed from the Wakoopa SDK: "the research app captured the names of the apps that panel members used on their smartphone, including the date, time, and **duration of any instance of use**." (Separate, non-session cleaning rule: winsorize daily totals below the 1st percentile = 10 min and above the 99th = 1200 min.) | Full text read (Mannheim MADOC published version) |
| **44** Sust, Talaifar & Stachl (2023) | **not read** | — | Commercial book chapter, no access. | Metadata only |

**Pattern.** Of the three thresholds actually used by studies in this lane, **all three are
inherited rather than derived**: two 15-second figures both trace to Andrews et al. (2015) — with
entry 45 citing entry 50, which cites Andrews — and one 5-hour cutoff is set by what "Andrews et
al. (2015) considered very long use". Not one paper in the lane reports a sensitivity analysis
over its threshold, and not one derives a value from its own data. The only paper that
interrogates threshold choice at all (51) does so in order to abandon thresholds entirely, and
its verdict on the practice is four words long: **"The threshold is arbitrarily chosen."**

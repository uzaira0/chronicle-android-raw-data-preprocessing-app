# Citation chase — Lane 4 (entries 32–41)

Source list: `docs/paper/winklbauer-batinic-references.md` (Winklbauer & Batinic 2026, refs 32–41).

Retrieval was restricted to `WebFetch` and direct `curl` file downloads. No browser automation was
used. No paywall was bypassed; where a publisher or repository refused an unauthenticated request,
that is recorded as such and nothing further was attempted.

Ladder rungs used throughout (from dossier §7.1):
**Rung 4** = raw platform event log with declared semantics (e.g. Android `UsageEvents`);
**Rung 3** = app-level event-logging research app; **Rung 2** = screen-on/off logging only;
**Rung 1** = vendor aggregate (iOS Screen Time / Battery usage, Android Digital Wellbeing).

---

## 32. Parry, Davidson, Sewall, Fisher, Mieczkowski & Quintana (2021) — Logged vs self-reported media use (meta-analysis)

*Nature Human Behaviour* 5(11), 1535–1547. doi:10.1038/s41562-021-01117-5

This is a systematic review and meta-analysis, not a primary measurement study, so the six-field
template applies only to what it says about the studies it pooled — and I could not read that
section.

- **Instrument and ladder rung:** N/A (meta-analysis). The abstract describes the pooled inputs
  only as "log-based measures" and "usage logs" and names no instrument. **Instruments of the
  included studies: NOT ESTABLISHED from the material I could read.**
- **Session threshold:** NOT STATED in the abstract.
- **Episode reconstruction rule:** NOT STATED in the abstract.
- **System-app / launcher filtering:** NOT STATED in the abstract.
- **Window, exclusion rules, aggregation:** From the abstract only: "we conducted a pre-registered
  meta-analysis of this research. Based on 106 effect sizes, we found that self-reported media use
  correlates only moderately with logged measurements, that self-reports were rarely an accurate
  reflection of logged media use and that measures of problematic media use show an even weaker
  association with usage logs." No other detail available.
- **Availability:** NOT ESTABLISHED (the availability statement is in the full text).

**Access: ABSTRACT ONLY**, via NCBI E-utilities (`efetch`, PMID 34002052). The record matches the
transcription exactly (Nat Hum Behav 2021 Nov;5(11):1535-1547). The publisher version is paywalled
(© Springer Nature, "under exclusive licence"). Unpaywall and OpenAlex both flag a green OA
accepted manuscript at the University of Bath research portal
(`https://researchportal.bath.ac.uk/files/219658181/Final_Manuscript.pdf`, "post-peer-review,
pre-copyedit version", 3.34 MB); that file returned **HTTP 403 to both WebFetch and curl**, as did
the Bath portal generally, which appears to be bot protection rather than a paywall. The VU
Research Portal record carries no attached full text. PubMed Central holds only citing articles,
not this paper. An OSF/PsyArXiv preprint search returned no match. I did not attempt any other route.

**Note for the thesis:** this is the field's most-cited demonstration that self-report and logs
diverge — and it is the one paper in this lane whose own treatment of log *processing* I could not
verify. Worth a second attempt from an institutional network before the paper cites it on this point.

---

## 33. Parry & Toth (2025) — *Extracting Meaningful Measures of Smartphone Usage from Android Event Log Data: A Methodological Primer* — EXTENDED TREATMENT

*Computational Communication Research* 7(1), 1–32.

**DOI discrepancy — report this.** The transcription in `winklbauer-batinic-references.md` gives
`doi:10.5117/ccr2025.1.parr`. That string **does not resolve** (OpenAlex returns HTTP 404 for it).
The DOI printed on the article's own first page and used by the publisher is
**`10.5117/CCR2025.1.8.PARR`** (note the inserted `.8`). Winklbauer & Batinic's reference list has a
malformed DOI for the single most important methodological source they cite. Our paper should cite
the correct form.

**Access: FULL TEXT (32 pp.)**, via `curl` to the Amsterdam University Press open-access delivery
endpoint `https://www.aup-online.com/deliver/fulltext/26659085/7/1/CCR2025.1.8.PARR.pdf`
(HTTP 200, `application/pdf`), text extracted with `pdftotext`. The article is CC BY 4.0: "© The
authors. This is an open access article distributed under the CC BY 4.0 license". The OJS mirror
(`journal.computationalcommunication.org/article/view/8682`) 302-redirects its galley to the DOI.

### 33.1 Summary fields

- **Instrument and ladder rung: Rung 4.** This is a processing primer, not a study; it assumes the
  researcher already holds the complete raw Android event log. "We take as a point of departure that
  researchers have already collected or accessed raw Android event log data using either custom-built
  logging apps […], third-party, commercial tracking tools […], or frameworks/apps purpose-built to
  support research access to Android data (e.g., the AWARE framework Ferreira et al., 2015).
  Importantly, we assume that, rather than providing pre-processed or already summarized data, these
  data collection methods provide the complete, full Android event log from users' devices." The
  worked sample comes from Toth (2023)'s custom-built app.
- **Session threshold: NONE — and this is deliberate.** Parry & Toth define sessions by *event-type
  boundaries* (screen-interactive/unlock … lock/screen-non-interactive), **not** by a time-based
  inactivity timeout. No numeric threshold of any kind appears in the paper. See §33.5 below: this
  makes their session incommensurable with the 30 s-threshold session used by Siebers et al. (entry 39).
- **Episode reconstruction rule: STATED IN FULL**, verbally, visually (Figures 1–2), and as
  pseudo-code (Codes 1–9), with an R implementation. Full extraction in §33.3–33.4.
- **System-app / launcher filtering: DECLARED**, with an explicit rejection of the field's existing
  list. Full extraction in §33.6.
- **Window, exclusion rules, aggregation:** N/A for the primer itself. The sample dataset is
  "5,000 events from 10 devices", drawn from a study of "n = 1,226 Android-using Internet users in
  2023" logged for "seven days". The procedure was "successfully tested […] across Android versions
  10–14, covering 314 unique device models from 31 manufacturers without issue".
- **Availability: YES, fully open.** Online Supplementary Material at **https://osf.io/5bekx/**,
  containing: `sample_events.csv` (raw input), `rcode.R` (a dplyr implementation of the procedure),
  `sample_results.csv` (processed output), the full pseudo-code, the background-system package-name
  exclusion list (a single-column dataset), a Google Play web-scraping script, and "a file that
  provides the package and corresponding app names for the most popular 5700+ packages used by a
  sample of European smartphone users in 2023".

### 33.2 Conceptual definitions (Table 3 and body)

Verbatim:

> "Following Van Canneyt et al. (2017) and Zhu et al. (2018), smartphone usage **sessions** are
> continuous uninterrupted sequences of device use that occur between unlocking and locking the
> device. While these sessions can only be initiated by the unlocking of a device, they can end in
> various ways,(e.g., the user manually locking the phone, the device powering off or rebooting, or
> the screen timing out and locking automatically). In a similar manner, we define **application
> usage episodes** as continuous, uninterrupted sequences of app use that occur between launching
> and closing an app. A **glance** indicates that the smartphone screen was activated and then
> deactivated without the device being unlocked."

Table 3 renders these as: session = "A continuous uninterrupted sequence of smartphone use between
unlocking and locking the device"; application usage episode = "A continuous uninterrupted sequence
of app use between launching and closing an app"; glance = "Screen activation while the device is
locked."

On glances containing app use:

> "However, there are instances where a glance includes app usage. For instance, one can receive and
> accept a phone call without unlocking the device. […] Such glances may encompass an arbitrary
> number of app uses, meaning that any number of app events can occur during the interactivity phase
> before returning to non-interactivity."

Derived secondary metrics named: "total smartphone usage duration (comprising the sum of glance and
session durations), duration of usage for individual apps, sequences of app usage within specific
sessions, and app repertoires", plus application sequences and mobile trajectories (Peng & Zhu 2020).

### 33.3 Which event constants are kept, and which are discarded

Table 2 documents exactly seven event types, and Code 1 keeps exactly those seven:

| Type | Name | Their explanation |
|---|---|---|
| 1 | Activity resumed | "An activity (associated with a package and class) moved to the foreground" |
| 15 | Screen interactive | "The screen went into an interactive state (i.e., turned on for full user interaction, not ambient display or other non-interactive state)" |
| 16 | Screen non-interactive | "The screen went into a non-interactive state (i.e., completely turned off or turned on only in a non-interactive state)" |
| 17 | Keyguard shown | "The screen's keyguard was shown" |
| 18 | Keyguard hidden | "The screen's keyguard was hidden (i.e., the user unlocked the device)" |
| 26 | Device shutdown | "The Android runtime underwent a shutdown process (all started activities are also stopped, without explicit 'activity stopped' (23) events)" |
| 27 | Device startup | "The Android runtime launched" |

> "Specifically, only event types 1, 15, 16, 17, 18, 26, and 27 need to be retained for this purpose
> (l. 2)."

Everything else is discarded, including two constants they name and then deliberately drop:

- **Type 2 (activity paused)** and **type 23 (activity stopped)** — discussed at length (§33.4) and
  then excluded from the retained set. Type 23 is Android's *own* end-of-activity marker; they do
  not use it.
- **Type 11** — "other events not necessary for the identification of human smartphone use are also
  logged (e.g., 11 designates that the system-internal priority of an app has changed)."

Types 17 and 18 are retained through Step 1 only to classify screen transitions in Step 3, then
dropped: "After identifying these, locks and unlocks can be filtered out as they are not required
anymore (l. 17)."

They also note the constants are undocumented by Google: "Although these are not extensively detailed
in the public Android documentation, their interpretations are available in the Android source code
and various community efforts have documented key event types." And that older devices cannot support
the procedure: "Earlier versions of Android (e.g., version 9, API28, or lower) provide a much more
limited set of event types, preventing extraction of certain types of device usage."

Event attributes assumed present (Table 1): timestamp (Unix ms), event type, package name, class name
— plus a device/user ID. Class name may be `null` "for various reasons (e.g., intentional obfuscation
to deter reverse engineering, memory management issues, or dynamic class loading processes)". Time
zone is flagged as **not** an event attribute: "The time zone of the device is not stored as an event
attribute. If the local date and time of the events are of interest, the time zone (offset) therefore
has to be accessed separately."

### 33.4 The forward-pairing rule, and their justification for it

This is the load-bearing passage for our paper. Quoted in full:

> "Identifying app usage episodes involves the most assumptions and requires the most information out
> of all usage types. Generally, each package activity starts with an event of type 1 (activity
> resumed) and ends with an event of type 23 (activity stopped). However, between these events, there
> can be multiple instances where classes associated with the same package transition between the
> foreground and background. This produces prolonged sequences of event types 1 and 2 (activity
> paused), which eventually conclude with an event type 23. Complicating matters, **event type 23 can
> be delayed, causing the end of package activity to overlap with the start of activity of another
> package, even though the use of the first package effectively ceased. In the event log, this makes
> it seem like app episodes are frequently interrupted by other app episodes, although these are
> mostly artifacts of prior package activities. Therefore, it is more effective and accurate to define
> the start of a new app episode (or the end of a glance or session) as the end of the previous app
> episode, focusing solely on event type 1.** Another complicating factor in extracting app episodes
> is the occurrence of package activity not only within smartphone sessions and glances (as discussed
> earlier) but also outside of these contexts. Typically, such activity represents background
> processes rather than active user engagement."

So the justification is **not** that forward-pairing is semantically correct — it is that Android's
own `ACTIVITY_STOPPED` is *unreliably timed*, and that trusting it produces spurious overlapping
episodes. The stated benefit is "more effective and accurate"; no quantification or validation of that
claim is offered anywhere in the paper.

The rule is implemented identically for both levels of the hierarchy:

- Glances/sessions (Step 4, Code 4): "First, the end of each use is defined by the timestamp of the
  next row (l. 1). While this operation is only practically required for rows indicating a start, it
  is easiest to apply it to all events. The duration of each use can now be calculated as the
  difference between the timestamp of the event itself and the timestamp marking the end of the use
  that it represents (l. 2)."
  `DECLARE use_end_timestamp = event_timestamp[i + 1]; DECLARE use_duration = use_end_timestamp - event_timestamp;`
- Episodes (Step 7, Code 7): "Since an episode ends with the start of the next event, the timestamp
  from the subsequent row can be used to indicate the stop of the current episode (l. 1–2)."
  `IF use_type == "episode" THEN; use_end_timestamp = use_start_timestamp[i + 1]; use_duration = use_end_timestamp - use_start_timestamp; END IF;`

Same-package run-collapsing (Step 6, Code 6): "in the event log, the use of a single app is
represented as a sequence of multiple starts and stops of sub-processes within it. To remove this
redundancy and represent each app use through a single start event, it is necessary to filter out all
episode events that are preceded by an episode event with the same package name (l. 8). This
effectively retains only the first event within each app use episode, marking its start."

**Session delimitation (Step 3, Code 3)** — the rule that separates a session from a glance:

> "There are three scenarios that delimit sessions: 1) when screen interactivity (15) is either
> directly preceded ([i - 1]) or followed ([i + 1]) by unlocking, 2) when screen non-interactivity
> (16) is either directly preceded or followed by locking, and 3) when the device is started up (27)
> or shut down (26) (l. 5–8). Any other instance of screen (non-)interactivity indicates a glance
> (l. 9–10)."

They justify not simply bracketing 18→17: "First, actual smartphone use often begins before unlocking
occurs; once the screen becomes interactive (event type 15), users can start interacting with apps
[…]. This means that everything occurring between screen interactivity and unlocking should be
considered part of the session, too. Second, the locking may occur immediately after the screen
becomes non-interactive or right before it does so. Third, within a session, the screen may become
non-interactive and then interactive again — a scenario opposite to a glance. Fourth, smartphone usage
sessions consist of an arbitrary number of app usage episodes."

### 33.5 Caps, gaps, idle time, overlapping episodes

- **Duration cap / maximum session length: NOT STATED.** There is no cap, no long-session truncation,
  and no "end of usage missing" concept anywhere in the paper.
- **Idle / inactivity timeout: NOT STATED.** No time-based threshold is used at any level. Session and
  glance boundaries are purely event-driven.
- **Gaps in logging: PARTIALLY addressed, without a tolerance parameter.** Unpaired starts/stops are
  discarded rather than repaired: "after some time without activity, the device screen is dimmed. In
  the event logs, this is represented as screen non-interactivity. If the user then prevents the
  device from fully locking by tapping the screen, it becomes interactive again. This is the opposite
  order of events that are logged when a glance occurs. Likewise, a session start or end may not be
  logged successfully when the device is started up or shut down. To catch these exceptions, all
  1) glance/session starts that are not followed by glance/session stops and 2) glance/session stops
  that are not preceded by glance/session starts are filtered out (l. 18–21)."
- **Overlapping episodes: eliminated by construction.** Forward-pairing makes overlap impossible;
  §33.4 is precisely the argument that observed overlap is an artifact. No residual-overlap handling
  is described because none can arise.
- **Background (screen-off) app activity: dropped by default, with an explicit caveat.** Step 8: "If
  the latter applies, the respective episode lies outside of a glance or session. This means that the
  screen was not interactive during that time and thus, the episode can be considered background
  activity rather than use." Step 9: "Finally, all episodes that lie outside of glances or sessions
  (see Step 8) can be removed (l. 3)." Footnote 13: "Depending on the topic and scope of research,
  this type of background activity may be of interest, though. For example, activity of apps like
  Spotify or sleep tracking/health apps (e.g., Sleep Cycle) may indicate actual use despite not
  involving screen interactivity."
- **Final cleansing (Step 9, Code 9):** "Every episode should be followed either by the start of
  another episode or the stop of a glance or session. Any episode that does not meet this criterion is
  removed (l. 1)."

### 33.6 Launchers and system apps — CONFIRMED, and stronger than expected

**On launchers, they argue exactly as the brief anticipated — keep them.** Verbatim, in full:

> "A further consideration is the handling of the home screen. On Android devices the home screen is
> called a launcher and this is indicated in the event log by packages containing this term (e.g.
> `com.android.launcher`). **Since users interact with the home screen, these packages should not be
> filtered out in most cases.**"

This is borne out in their own worked output: Table 5 (`sample_results.csv`) shows
`com.sec.android.app.launcher` appearing as an `episode` row **nine times** across two sessions and
two glances, with durations of 2821, 862, 1441, 2670, 1790, 6897 and 1793 ms among others. Launcher
time is a first-class episode in their pipeline, not a discarded artifact.

**On system apps, they reject the field's canonical list** — i.e. entry 36, the other paper in this
lane. Verbatim, in full:

> "To identify these packages we first need to know which ones represent system/background activity.
> Schoedel et al. (2022) provide a categorization of 3,091 packages, with **1,232 categorized as
> 'System' packages**. However, while this categorization can be used for this purpose, it includes
> many packages already filtered out in l. 2. Additionally, as the categorization is based on data
> collected in 2020, it may not include all current system packages. **It is also apparent that many
> of the packages that Schoedel et al. (2022) labelled as system are not background system packages,
> but rather general system packages (e.g. `com.android.gallery3d` represents the default gallery
> app).** Therefore, we have created a new list of package names that only includes those that 1) have
> not been filtered out in l. 2 and 2) run in the background without any foreground interaction. This
> list of background system packages can be found in the OSM in the form of a dataset consisting of a
> single column and is represented in l. 3 by the object `excluded_package_names`. **However, the list
> of system/background packages to be removed should be adjusted based on the specific requirements of
> the research and we do not necessarily recommend blindly applying it.**"

Footnote 10 draws the distinction they are asserting:

> "Background system packages run in the background with no user interface elements displayed. For
> example, this can include packages that manage WiFi or Bluetooth connections, or packages that
> facilitate cellular signal or updates. In contrast, general system packages, like
> '`com.android.gallery3d`', provide user interface elements and, for all intents and purposes,
> function to the user like any other app."

Footnote 11 gives the provenance of their replacement list — and *only* the provenance:

> "We produced this list with an event log dataset collected in late 2023, n = 1,103"

**Size of their own list: NOT STATED.** The paper never reports how many packages
`excluded_package_names` contains. The count is recoverable only by downloading the OSM file. This is
worth flagging in our paper: the primer that criticises the field's system-app list for being
undocumented does not report the size of its own replacement.

Note the count discrepancy: Parry & Toth write "1,232 categorized as 'System' packages"; Schoedel et
al.'s own Table 2 reports **1231** apps assigned to the System category. One of the two is off by one.

One further package-level exclusion, in Step 2 (Code 2): "In the case of `episode_events`, the package
name `android` needs to be filtered out, as it indicates the launch of a system-internal process not
included in the list of package names filtered out earlier." (Note that `android` still carries the
`session` and `glance` rows in Table 5 — it is dropped only from the episode stream.)

### 33.7 Every place they flag a decision as arbitrary or under-determined

1. On the state of the field — the sentence that most directly supports our thesis:
   > "Regardless of the data collection method, researchers face significant challenges in
   > transforming raw Android event log data into meaningful, research-ready smartphone usage metrics.
   > One of the key issues is the sheer volume and complexity of the data, and **the lack of
   > standardized, transparent approaches for processing it. Although smartphone tracking has become
   > increasingly popular, data processing methods are often ad hoc, inconsistently applied, and
   > poorly documented — posing barriers to reproducibility and comparability across studies.**"
2. On the episode level specifically: "Identifying app usage episodes involves the most assumptions
   and requires the most information out of all usage types."
3. On their own system-app list: "the list of system/background packages to be removed should be
   adjusted based on the specific requirements of the research and **we do not necessarily recommend
   blindly applying it**."
4. On launchers: "these packages should not be filtered out **in most cases**" — hedged, with no
   statement of what the other cases are.
5. On dropping background episodes: footnote 13, quoted in §33.5, concedes the default is wrong for
   some research questions.
6. On sessions vs. lock/unlock: "several challenges complicate this approach" (four enumerated).
7. On third-party tools as an alternative: "the black-box nature of many third-party tools makes it
   difficult to verify how data were collected, processed, or transformed into higher-level usage
   metrics"; and later, "the methods used by third-party tools to extract and process smartphone log
   data are typically not disclosed or documented. This lack of transparency can make it challenging
   for researchers to understand how the data have been manipulated or transformed before analysis,
   making it difficult to replicate or validate findings."
8. On durability: "we recognize that the dynamic and constantly evolving nature of the Android
   operating system might render the procedure time-sensitive and subject to degradation with new
   Android releases."
9. **The sentence that names Winklbauer & Batinic's own gap:**
   > "Notably, **if researchers are in possession of pre-processed usage data, then such an extraction
   > procedure is likely not necessary.**"
   This is the primer conceding that everything it specifies is invisible to any researcher who starts
   from episodes — which is precisely the position Winklbauer & Batinic describe on their p.32.

### 33.8 Scope limits they declare

> "First, in this primer we did not consider how one might extract usage metrics from the information
> available in package classes, nor did we consider the ways in which other passive sensors (e.g.,
> GPS, accelerometers, etc.) embedded in a smartphone may be accessed."

Also flagged: iOS is out of reach entirely — "iPhones currently do not allow access to the event log
system. This means that any event logging procedure only works on Android phones, and that without
using burdensome forensic tools to access system databases (e.g., KnowledgeC, PowerLog, or Biome), it
is currently not possible to access fine-grained temporal data."

On naming/categorising packages: no OS or Play Store API exists for package→name or package→category
mapping, so web scraping of the Play Store is "the only scalable alternative to hand-coding"; it fails
for sideloaded apps, alternative marketplaces (Huawei, Xiaomi), OS-provided apps and OEM-skin apps
(they name "gallery, settings" and "Samsung versions of system apps like gallery or dialer"), for
which they point back to Schoedel et al. (2022) or to APKPure.

---

## 34. Salganik (2017) — *Bit by Bit: Social Research in the Digital Age*

Princeton University Press. **Not a smartphone study** — a general methods monograph on social
research with digital-age data. The six-field template does not apply; recorded here for what
Winklbauer & Batinic use it for (a generic warrant for digital trace data).

- Full text is freely readable online at **https://www.bitbybitbook.com/** (open-access web edition of
  the 1st edition).
- Relevant content is Chapter 2, "Observing Behavior", whose §2.3 enumerates ten characteristics of
  big data sources, including *nonrepresentative*, *drifting*, *algorithmically confounded*, and
  *dirty*.
- §2.3.9 "Dirty", verbatim:
  > "Big data sources, especially online sources, are frequently *dirty*. That is, they frequently
  > include data that do not reflect real actions of interest to researchers."

  and:
  > "I think the best way to avoid being fooled by dirty data is to understand as much as possible
  > about how your data were created."

  The worked cautionary example is Back et al. (2010)'s September 11 pager study, where automated
  system messages containing the word "CRITICAL" were scored as expressions of anger.
- The second quoted sentence is directly usable by our paper: the standard methods reference the field
  cites for digital trace data already states the principle that undeclared episode reconstruction
  violates.

**Access: FULL TEXT of the relevant sections (Chapter 2 landing page and §2.3.9)** via WebFetch to
bitbybitbook.com. I did not read the whole book.

---

## 35. Schulz van Endert & Mohr (2020) — Likes and impulsivity / delay discounting

*PLOS ONE* 15(11), e0241383. doi:10.1371/journal.pone.0241383

- **Instrument and ladder rung: Rung 1 (vendor aggregate), iOS — not Android at all.** The native
  Apple iOS "Battery usage" screen, captured by the experimenter photographing the participant's
  phone: "data provided by the iOS feature 'Battery usage' were collected. For every application this
  feature shows how long it was actively used on screen and how long it was running in the background
  without the user engaging with it, but still consuming battery life." And: "phone use data was
  collected by taking photographs of the battery use screens on the participants' phones. These data
  were entered into a spreadsheet after completion of each session."
- **Session threshold: NOT STATED.** No session concept exists in the paper.
- **Episode reconstruction rule: NOT STATED — and structurally impossible.** The vendor supplies
  per-app durations directly; no events are seen. The only processing declared is arithmetic:
  "In order to get an estimate of a subject's average daily phone use, the total active screen time
  was divided by the timeframe indicated on the phone."
- **System-app / launcher filtering: DECLARED but idiosyncratic and category-based, not system-based.**
  "in calculating net screen time we deducted screen time of applications related to music (e.g. Apple
  Music), TV (e.g. Netflix) and functionalities such as calling and GPS since these apps were
  characterized by passive usage, i.e. app running mostly in the background and/or requiring negligible
  interaction with the user. We assumed that inclusion of these usage patterns would distort the data".
  Also: "screen time of apps that were used by less than a quarter of participants or had identical
  purposes (e.g. Safari and Chrome, Apple Mail and Yahoo Mail) was cumulated. This resulted in 11
  distinct categories (see S1 Table for categorization)." No system-app list, no launcher discussion.
- **Window, exclusion rules, aggregation:** Window is whatever iOS retained: "These durations were
  mostly available for the timeframe of the last ten days, on older iOS versions of the last seven
  days" — i.e. **the measurement window varies between participants by OS version and is not
  standardised.** Exclusion: "participants had to report if their smartphone use was either unusually
  low, high or average within the last seven to ten days. If a subject indicated unusual usage and
  their self-reported usage differed from actual usage by more than 100%, participants were excluded
  from the analysis, which was not the case in our sample." N = 101. Means reported; a "grand total
  screen time" figure from the same screen "was used as a reliability check".
- **Availability:** "All relevant data are within the manuscript and its Supporting Information files"
  (S1/S2 Dataset, S1/S2 Table). No processing code — there is effectively none to share.

**Access: FULL TEXT**, PLOS ONE gold OA; landing page via WebFetch and the printable PDF via WebFetch
(`journals.plos.org/plosone/article/file?id=…&type=printable`), text extracted with `pdftotext`.

---

## 36. Schoedel, Oldemeier, Bonauer & Sust (2022) — Systematic Categorisation of 3,091 Smartphone Applications

*Journal of Open Psychology Data* 10(1), 7. doi:10.5334/jopd.59

This is a **data paper** describing an app→category mapping. It contains no usage analysis, so
several template fields are genuinely not applicable rather than merely absent.

- **Instrument and ladder rung: Rung 3** for the source data. The **PhoneStudy app**, "a custom
  research application developed at LMU Munich", deployed in the Smartphone Sensing Panel Study
  (SSPS, LMU Munich + ZPID, Android 5+): "the app retrieved a full list of all apps installed on
  participants' smartphones at the beginning of the study (i.e., app adoption) and, in addition,
  continuously collected timestamped app usage events (i.e., app usage)."
- **Session threshold: NOT STATED** (no session concept appears; the words "session"/"threshold" occur
  nowhere in the paper outside a reference title).
- **Episode reconstruction rule: NOT STATED.** The paper says only that "timestamped app usage events"
  were collected and that "We used both, the list of adopted apps and the app usage events to
  categorise apps as they both contained the official app names." How events become durations is never
  addressed — the paper does not need durations, only the set of distinct package names.
- **System-app / launcher filtering — the point at issue. What the source actually says:**
  System is category 21 of 26, defined as:
  > "**System** describes apps that enable the basic functionality of the phone and its apps. System
  > apps are not consciously accessed and actively interacted with. As they run in the background of
  > the device, they have no informative power for behavioural analyses. Oftentimes, removing System
  > apps facilitates further analyses of app usage."

  It is by far the largest category: **1231 apps assigned, 173 rater disagreements, Cohen's κ = 0.83
  [0.81; 0.85]** — i.e. roughly 40% of the 3,091 apps are labelled System.

  **Launchers and gallery apps are NOT mentioned anywhere in the paper.** I grepped the complete text:
  the strings "launcher", "gallery", and "home screen" do not occur. The nearest relevant categories
  are **Photo** ("apps for making, editing, or inspecting one's own photos and videos") and
  **Settings** ("Settings describe apps that are used to change the smartphone's settings […] **Unlike
  System apps, Settings apps involve active interactions (e.g., changes) made by the user**").

  So the honest finding is: **the published scheme's System definition ("run in the background", "not
  consciously accessed") would exclude both launchers and gallery apps, and the Photo category is
  clearly where a gallery app belongs — but the paper never says so, and the criticism made by Parry &
  Toth and by Winklbauer & Batinic is a criticism of the *CSV's actual row assignments*, not of the
  published definitions.** Parry & Toth's specific claim is that `com.android.gallery3d` is labelled
  System in the released dataset (see §33.6); their statement is verbatim evidence, and it is
  consistent with the 173 recorded rater disagreements in that category — but **I could not verify it
  against the dataset itself.** See Access below.
- **Window, exclusion rules, aggregation:** Data collected May–December 2020, Germany. N = 850 who
  installed the app for ≥1 week; group 1 (n = 191) M = 83 days (SD 20), group 2 (n = 659) M = 150 days
  (SD 57). Participant exclusion from the parent study: "Participants were excluded from the study, if
  they revoked permissions for smartphone logging for more than two (group 1)/three (group 2) times on
  seven consecutive study days or omitted two out of three monthly online surveys". **The
  categorisation's own inclusion rule is a frequency filter:** "The SSPS provided us with a collection
  of 19,361 apps used over all participants and the entire study period. […] the excessive total app
  count was practically infeasible for manual categorisation, so we filtered for apps used by at least
  1% of participants who had installed the PhoneStudy app. […] This restriction left us with 3,091
  apps to categorise." Aggregation: N/A. Reliability: two independent raters on 2,941 apps after two
  calibration rounds (50 then 100 apps), third rater resolving all disagreements; per-category Cohen's
  κ in Table 2.
- **Availability: YES.** Repository **http://doi.org/10.23668/psycharchives.5680**; files
  `app_categorisation_2020_v2.csv` plus `.Rmd`/`.pdf`/`.html` codebooks; **CC-BY 4.0, "No embargo"**.
  The dataset carries both the Android APK/package name and a manually annotated generic app name.

**Access: FULL TEXT**, JOPD gold OA; publisher PDF (Google Cloud Storage galley) via WebFetch, text
extracted with `pdftotext`. **The dataset itself I could NOT retrieve:** the PsychArchives record page
resolves and lists the bitstream URLs, but `https://pada.psycharchives.org/bitstream/…` returned
**HTTP 504 Gateway Time-out on every attempt** for both the CSV and the PDF codebook (server-side
failure, not an access restriction). The `com.android.gallery3d` classification therefore rests on
Parry & Toth's verbatim assertion, not on my own inspection.

---

## 37. Schoedel & Mehl (2024) — Mobile sensing methods

Chapter 13 in Reis, West & Judd (eds.), *Handbook of Research Methods in Social and Personality
Psychology* (Cambridge University Press), pp. 297–321. doi:10.1017/9781009170123.014

**This is a handbook chapter, not a study.** The six-field template does not apply.

- Bibliographic record confirmed against Cambridge Core and matches the transcription (authors, title,
  book, page range 297–321). Publication date shown as 12 December 2024; the transcription's "2024" is
  correct. The transcription omits the edition number in the DOI record but the entry is otherwise
  accurate.
- **Access: METADATA AND PUBLISHER SUMMARY ONLY. Closed.** Unpaywall reports `is_oa: false` with no OA
  locations. Cambridge Core states access "requires purchase/subscription". No repository copy exists
  in OpenAlex or Unpaywall. This is a normal paywalled outcome; no bypass was attempted.
- Publisher summary, as displayed: "This chapter provides an introduction to the use of mobile sensing
  in social and personality psychology… covers research questions of the kind that mobile sensing lends
  itself to, and provides a high-level summary of the current literature." Listed keywords: mobile
  sensing, smartphone sensing, ambulatory assessment, ecological momentary assessment, mobile
  measurement, daily life.
- Nothing about session thresholds, episode reconstruction, or system-app filtering can be asserted
  either way. **All six fields: NOT ESTABLISHED (no access).**

---

## 38. Sewall & Parry (2021) — Depression and the estimated/actual smartphone use discrepancy

*Technology, Mind, and Behavior* 2(2), 178–186. doi:10.1037/tmb0000036

- **Instrument and ladder rung: Rung 1 (vendor aggregate), iOS.** Apple Screen Time, a single number
  transcribed by the participant: "after navigating to their 'Screen Time' application — an Apple
  application that automatically tracks iPhone usage metrics — they manually entered the amount listed
  for 'Total Screen Time' (i.e., the total duration of active iPhone use over the past week) into the
  survey." Table 3 note: "active iPhone use over the past week logged by the 'Screen Time'
  application."
- **Session threshold: NOT STATED.** No session concept.
- **Episode reconstruction rule: NOT STATED — and structurally impossible.** The measurement is one
  scalar per participant, self-transcribed from a vendor UI. No event stream, no per-app data, no
  reconstruction of any kind is performed by the authors. Whatever Apple does to produce "Total Screen
  Time" is entirely undeclared and unknowable from this paper.
- **System-app / launcher filtering: NOT STATED** (not applicable — no per-app breakdown was collected).
- **Window, exclusion rules, aggregation:** Window = **the past 7 days**, one observation per
  participant. Recruited on MTurk, late Jan–early Feb 2019. Eligibility: "(a) used an iPhone with iOS
  version 12 or later, (b) spoke English, (c) resided in the United States, (d) were ≥ 18 years old,
  and, to help ensure quality responses, (e) had a task acceptance rate ≥ 95%". Exclusions:
  "participants were dropped if they failed one or more attention checks (n=57) or reported usage data
  > 3 standard deviations (SD) outside the mean (n=17), resulting in a final analytical sample of
  N=325"; straight-lining check yielded no further exclusions; "There were no missing data." Both mean
  and median reported (Table 3: actual total iPhone use M = 28.2 h (SD 22.1), Mdn = 22.3; estimated
  M = 31.5 (SD 30.4), Mdn = 20). Analysis by cubic response surface analysis with AICc model comparison.
- **Availability: YES.** "Data, code, and supplementary material are openly available on the Open
  Science Framework at **https://osf.io/mzywt/**." I confirmed via the OSF API that the node is public
  and contains `final_325_dat.dta` (https://osf.io/download/z75fx/) and `RSA_code.R`
  (https://osf.io/download/ube7k/), plus a Supplementary Materials folder.

**Access: FULL TEXT of the author's ACCEPTED MANUSCRIPT — not the copy of record.** The TMB publisher
version (`tmb.apaopen.org/pub/cubic-response-surface-analysis`, gold OA, CC-BY-NC-ND) returned
**HTTP 403 to both WebFetch and curl**. I retrieved the authors' own deposit instead: OSF preprint
`e9pfa_v1` attached to node `mzywt`, resolved through the public OSF API and downloaded as a `.docx`
(https://osf.io/download/9bgu8/), text extracted from `word/document.xml`. The file carries the
authors' own notice: "© 2021, The Authors. This paper is not the copy of record and may not exactly
replicate the final, authoritative version of the article." Everything quoted above is from that
accepted manuscript. The method section explicitly defers to a companion paper for fuller detail:
"A more detailed description of the data collection methodology used for this study is provided
elsewhere (Sewall et al., 2020)" — I did not chase that companion, which is outside this lane.

---

## 39. Siebers, Beyens & Valkenburg (2023) — Fragmented and sticky smartphone use

*Mobile Media & Communication* 12(1), 45–70. doi:10.1177/20501579231193941

**The one study in this lane that declares a session threshold — and it declares it well.**

- **Instrument and ladder rung: Rung 3 (app-level event-logging research app), Android only.** "To log
  their app usage, participants were asked to install the **Ethica App Usage Stream** app on their
  smartphones." Android was a hard eligibility requirement: "About half of them (i.e., 152
  participants) did not possess an Android smartphone, which was required for logging their app usage
  data." ESM was collected through the Ethica app in parallel. Ethica is a commercial platform: the
  raw Android event stream is processed by a third party, so what the authors received was app
  activities with foreground times, not the event log.
- **Session threshold: YES — 30 s, with a citation-based justification and a sensitivity analysis.**
  Verbatim:
  > "A smartphone session starts when the user's smartphone screen is turned on and ends when it is
  > turned off (Van Berkel et al., 2016). During one session, users can use one app (i.e., solo-app
  > session) or multiple apps (i.e., multi-app session; Peng & Zhu, 2020). When the screen is turned
  > off and on in quick succession, this is interpreted as one smartphone session. The maximal timeout
  > period that marks the end of a smartphone session is called a session 'threshold' (Van Berkel et
  > al., 2016, p. 4711). **We set the session threshold to 30 s, as this has been most often used in
  > previous research (Beierle et al., 2020; Böhmer et al., 2011; Carrascal & Church, 2015).** This
  > procedure resulted in 51,556 smartphone sessions."

  The justification is explicitly conventional ("most often used in previous research"), not
  substantive — an honest statement of an arbitrary choice. They then test it:
  > "In addition to our preregistered analyses, we conducted sensitivity analyses to examine the
  > robustness of the results when session thresholds were decreased (i.e., 0 and 10 s) and increased
  > (i.e., 60 and 90 s). All results remained virtually unchanged, except for the between-person
  > association of sticky smartphone use with distraction. Adolescents who used their smartphone in a
  > sticky way across the three-week study experienced less distraction than adolescents who used their
  > smartphone in a less sticky way when the session threshold was reduced to 0 s (β = −.18) and 10 s
  > (β = −.18)."

  This is a five-point multiverse over a single processing parameter — and **it flipped a
  between-person effect.** Directly usable evidence for our thesis.
- **Episode reconstruction rule: PARTIALLY STATED, and the interesting part is delegated.** What they
  declare: "The Ethica App Usage Stream app logged participants' smartphone app usage continuously.
  **App use was assessed as the foreground time of an app, that is, the time during which an app was
  active on a participant's screen while the screen was turned on. Hence, if an app was running in the
  background or while the screen was turned off, this was not recorded.** Although multiple apps can
  run in the foreground simultaneously via split screen mode, adolescents never used this possibility."
  What they do **not** declare: how Ethica turns Android `UsageEvents` into "foreground time" — which
  event constants it keeps, whether it forward-pairs or uses `ACTIVITY_STOPPED`, whether it caps long
  episodes. **The app-episode reconstruction rule is a black box supplied by a vendor**, exactly the
  black-box problem Parry & Toth describe in §33.7 item 7. The session-level rule they do own and
  state; the episode-level rule they do not.
- **System-app / launcher filtering: NOT STATED.** No system-app list, no launcher discussion, no
  package exclusions of any kind. The only package-level filtering mentioned is descriptive: of 733,359
  logged app activities, "21,565 (2.9%) represented Ethica app activities" — noted, but not said to be
  removed.
- **Window, exclusion rules, aggregation:** Three-week logging window, June 2020, one Dutch secondary
  school; 312 recruited → **160 analysed** (Android-only exclusion, n = 152 dropped). 733,359 app
  activities; the analytic subset is the 198,884 (27%) falling within one hour before an ESM survey.
  ESM: 6 surveys/day × 21 days; 12,723 of 20,160 completed (63% compliance). Derived measures:
  fragmentation = number of sessions × (total session duration / measurement duration), with
  measurement duration fixed at 60 min and the score set to 0 if fewer than two sessions; stickiness =
  ln(longest session duration). Descriptives report **both** mean and median (session M = 6.9 min,
  SD = 31.8, **Mdn = 1.5**; 4.2 app activities per session, SD = 8.4, **Mdn = 3**) and they note the
  distribution: "The duration of smartphone sessions followed a power-law distribution". Analysis:
  DSEM in Mplus.
- **Availability: YES, extensively.** "All materials of the current study, including the preregistration
  (https://osf.io/sgmj7/), the codebook (https://osf.io/tbk6u), and the syntaxes (https://osf.io/qezw3/),
  and all materials of the larger project (https://osf.io/327cx) can be found on the OSF. The anonymized
  dataset used in our analyses is publicly available on Figshare (Siebers et al., 2023)." Sample details
  at https://osf.io/2yjqp; ESM trigger scheme at https://osf.io/b8vsa.

**Access: FULL TEXT**, via the University of Amsterdam green OA copy
(`https://pure.uva.nl/ws/files/178485570/…pdf`, HTTP 200), located through Unpaywall; `pdftotext`.

---

## 40. Steegen, Tuerlinckx, Gelman & Vanpaemel (2016) — Increasing Transparency Through a Multiverse Analysis

*Perspectives on Psychological Science* 11(5), 702–712. doi:10.1177/1745691616658637

Methods paper; the six-field template does not apply. What the brief asked for:

**What a multiverse analysis IS.** From the abstract:
> "Empirical research inevitably includes constructing a data set by processing raw data into a form
> ready for statistical analysis. Data processing often involves choices among several reasonable
> options for excluding, transforming, and coding data. We suggest that instead of performing only one
> analysis, researchers could perform a multiverse analysis, which involves performing all analyses
> across the whole set of alternatively processed data sets corresponding to a large set of reasonable
> scenarios."

The mechanism, verbatim:
> "A multiverse analysis starts from the observation that data used in an analysis are usually not just
> passively recorded in an experiment or an observational study. Rather, **data are to a certain extent
> actively constructed.** Data construction occurs when the raw data are converted into a form ready
> for analysis. When preparing their data for analysis, researchers often take several processing
> steps, such as discretization of variables into categories, combination of variables, transformation
> of variables, data exclusion, and so on. These processing steps typically come with many researcher
> degrees of freedom (Simmons, Nelson, & Simonsohn, 2011), as there are often several options in each
> step. **As a result, raw data do not uniquely give rise to a single data set for analysis but rather
> to multiple alternatively processed data sets**, depending on the specific combination of choices —
> a many worlds or multiverse of data sets. As each data set in this data multiverse can lead to a
> different statistical result, the data multiverse directly implies a multiverse of statistical
> results."

And the key inheritance claim, which is the sentence our paper wants:
> "This multiplicity of reasonable processing steps gives rise to a multiverse of reasonable data sets,
> which directly implies that there are several reasonable statistical results. **Any arbitrariness
> that is present in the data construction is inherited by the statistical result.**"

**What it is FOR — two stated goals:**
> "Such a multiverse analysis has two goals: **It enhances transparency by providing a detailed picture
> of the robustness or fragility of statistical results, and it helps identifying the key choices that
> conclusions hinge on.**"

Scope: "A multiverse analysis displays the stability or robustness of a finding, **not only across
different options for exclusion criteria, but across different options for all steps in data
processing.**" Positioned as "a systematic and organized extension of outlier analysis" and "closely
related to the idea of a garden of forking paths in data analysis (Gelman & Loken, 2014) […] The
multiverse analysis focuses on one particular aspect of this multiple comparison issue, **related to
data processing.**"

**What it is NOT for — the explicit caveats:**
> "The primary goal of a multiverse analysis is to enhance research transparency. Unlike, for example,
> a p-curve analysis (Simonsohn, Nelson, & Simmons, 2014), **it is not a formal test of questionable
> research practices, such as selective reporting, or a method to estimate the strength of the evidence
> for an effect. The multiverse analysis does not produce a single value summarizing the evidential
> value of the data, nor does it imply a threshold for an effect to reach to be declared robustly
> significant.**"

And — important, and the opposite of how the technique is often invoked — preregistration is **not** a
substitute:
> "**Preregistration (e.g., Chambers, 2013; Wagenmakers et al., 2012) or blind analysis (e.g., MacCoun
> & Perlmutter, 2015) are not useful strategies for deflating the multiverse.** By preregistering a
> study, all analytical choices — including the arbitrary ones — are made ahead of time, before
> collecting the data. […] However, the considered results are still just the results given one choice
> combination, albeit preregistered or blindly made, and their robustness across other reasonable
> choice alternatives remains hidden from view. **Thus, preregistration or blind analysis do not
> preclude a multiverse analysis, as they do not annihilate the arbitrariness in data preparation.**"

They also insist the multiverse be complete, not curated: "However, a multiverse analysis should
involve all plausible [choice combinations]", and the way to shrink it is theory, not preference:
"deflating the multiverse involves developing a better and more complete theorizing".

**Worked example size — correcting a common misquotation.** The example re-analyses Durante, Rae &
Griskevicius (2013). Study 1: 3 × 5 × 3 × 2 × 2 = 180 combinations, "After excluding these inconsistent
combinations, we are left with 180 − 2 × (5 × 1 × 3 × 1 × 2) = 120 choice combinations." Study 2:
"there are 5 × 3 × 3 × 3 × 2 = 270 choice combinations, but after excluding inconsistent combinations,
270 − 2 × (5 × 1 × 3 × 1 × 2) = 210 choice combinations remain." So **120 and 210, not 1,440.** They
also concede their own multiverse is partial: "Our multiverse is only a subset [of the possible
choices]."

Result headline: for religiosity in Study 1, "7 out of the 120 choice combinations lead to a
significant interaction effect, whereas the remaining 94% lead to p values ranging from .05 to 1.0";
for fiscal political attitudes, "8% of the 210 choice combinations lead to a significant interaction
(p < .05)".

**Access: FULL TEXT**, via the authors' copy at
`https://sites.stat.columbia.edu/gelman/research/published/multiverse_published.pdf` (the published
version, Perspectives on Psychological Science 2016, Vol. 11(5) 702–712), `pdftotext`. The Sage PDF
(bronze OA per OpenAlex) returned HTTP 403 to WebFetch and the KU Leuven Lirias link in OpenAlex is a
dead 404.

---

## 41. Sumter, Baumgartner & Wiradhany (2024) — Beyond screentime: 7-day mobile tracking and sleep

*Behaviour & Information Technology* 44(6), 1260–1276. doi:10.1080/0144929X.2024.2350663

- **Instrument and ladder rung: Rung 1 (vendor aggregate), iOS — via participant-donated screen video
  and OCR.** Verbatim:
  > "Evening smartphone use was assessed by letting participants upload screen videos of their iOS
  > battery section every morning. These videos covered the battery section information from
  > participants' evening smartphone use (from 7pm onwards). **The battery section provides an account
  > of the minutes each app is used per hour.** These videos were automatically processed with a Python
  > script (see Baumgartner et al. 2023). This script processed iPhone screen recordings of the battery
  > section pages and provides a CSV file with the following information: which apps were used at each
  > hour of the day, time in minutes that each app was open on screen per hour, and time in minutes an
  > app was open in the background per hour."

  Recruitment was iPhone-only ("we recruited 125 students (iPhone users)"). The MyPanel research app
  (mobilemarketresearch.com) was used only to administer daily surveys, not to log usage. Sleep was
  measured by Fitbit flex plus daily diary.
- **Session threshold: NOT STATED.** No session or episode concept exists; the finest available
  resolution is app-minutes-per-hour, imposed by Apple's UI.
- **Episode reconstruction rule: NOT STATED at the event level — and impossible at that level.** What
  *is* declared is a *transcription* pipeline and its error rate, which is more than most papers offer:
  > "The script was validated by comparing the automatically obtained coding of 19 videos which included
  > over 1000 app entries with coding by a manual coder, which resulted in an **86% accuracy rate**. A
  > detailed account of this procedure, including validation of the script, is described elsewhere
  > (Baumgartner et al. 2023)."

  Note that the 14% error is in reading Apple's numbers, on top of whatever undeclared rule Apple used
  to produce them.
- **System-app / launcher filtering: NOT DECLARED as filtering — but launcher-equivalent time is
  explicitly RETAINED as its own category.** They "manually categorised each of the 773 unique apps
  that participants used during the 7-day study in one of the seven content categories". Table 1's
  generic (non-content) categories include **"Home Lock Screen — Unlocking of the phone"**, alongside
  "General top 100" and "Non top 100" ("frequently used apps which could not be categorised"). Home
  Lock Screen is carried through to the results as a predictor in its own right (Table 3: r = −0.13\*
  with sleep duration, −0.11\* with sleep quality). No system-app list is used or cited.
- **Window, exclusion rules, aggregation:** **7 consecutive days**, three-stage lab design at the
  University of Amsterdam. Attrition is steep and fully reported: 125 recruited → smartphone data from
  95 → 93 with accurate Fitbit data ("Fitbit data was missing due to malfunctioning of the Fitbit
  bracelet, forgetting to put it back on after removing it, or because the Fitbit ran out of battery")
  → **75 reported evening use (377 observations, M = 5.02 nights/participant)**; 71 reported
  pre-bedtime use (321 observations, M = 4.52 nights). Two exposure windows: "evening" = post-7pm, and
  "pre-bedtime" = the two hours before reported bedtime, with an hour-boundary rounding rule stated
  explicitly ("for participants who fell asleep at 23:30, we consider smartphone use from 21:00 to
  23:00, but for participants who fell asleep at 23:31, we consider smartphone use from 22:00 to
  00:00") — a genuine researcher degree of freedom, declared. Aggregation: means and SDs (Table 2);
  multilevel models in R (lme4/lmerTest) with within- and between-person centring; Gaussian for
  continuous outcomes, Poisson for counts.
- **Availability: YES.** "The data that support the findings of this study are openly available at
  **https://osf.io/scvta/?view_only=3ae25ae4dd024248a4f9efe31ec80aba**." (The accepted manuscript's
  Method section still carries the pre-unblinding placeholder "[link to be added after unblinding]" for
  the R script; the published Data availability statement supersedes it.)

**Access: FULL TEXT**, via the University of Amsterdam green OA copy
`https://pure.uva.nl/ws/files/228870909/Beyond_screentime.pdf` (HTTP 200, "final published version"),
located through the UvA-DARE record. Taylor & Francis is bronze OA per Unpaywall/OpenAlex but
`tandfonline.com` returned **HTTP 403 to both WebFetch and curl** on every PDF route tried
(`?download=true`, `?needAccess=true`, and `/doi/full/`).

---

## Lane 4 summary

**Full text obtained: 8 of 10.**
- Full text, publisher or repository version: 33, 35, 36, 39, 40, 41 (six).
- Full text, author's accepted manuscript rather than the copy of record: 38.
- Full text of the relevant sections of a free online book: 34.
- **Abstract only: 32** (Parry et al. 2021, *Nature Human Behaviour*) — publisher paywalled; the green
  OA accepted manuscript at the Bath repository returned HTTP 403 to every permitted route.
- **Metadata and publisher summary only: 37** (Schoedel & Mehl 2024, Cambridge handbook chapter) —
  genuinely closed, `is_oa: false`, no repository copy anywhere.

**Session threshold declared: 1 of 10.** Only entry 39 (Siebers et al.) states one: **30 s**, justified
as the modal value in prior work, plus a five-point sensitivity analysis (0/10/30/60/90 s) that flipped
one between-person effect. Entry 33 (Parry & Toth) has **no threshold by design** — it delimits sessions
by event-type boundaries, not by a timeout. Entries 35, 36, 38, 41 have no session concept at all.
Entries 32, 34, 37, 40 are not primary measurement studies.

**Episode reconstruction rule declared: 1 of 10, fully.** Only entry 33 states how raw events become
episodes with durations — and it states it exhaustively (nine steps, pseudo-code, R implementation,
open sample data). Entry 39 declares the *session* rule but delegates the *episode* rule to the Ethica
platform, which does not disclose it. Entry 41 declares a video-OCR transcription rule and its 86%
accuracy, which is not event reconstruction. Entries 35 and 38 read numbers straight off a vendor UI,
so no reconstruction rule can exist. Entry 36's source data are timestamped app-usage events, but the
paper says nothing about how they were turned into anything.

**Ladder rungs among the five entries that actually measure smartphone use:**
- **Rung 4** (raw platform event log, declared semantics): **1** — entry 33 (the primer; it is the only
  document in this lane that operates on `UsageEvents` and says what it does with each constant).
- **Rung 3** (app-level event-logging research app): **2** — entry 36 (PhoneStudy, LMU) and entry 39
  (Ethica App Usage Stream). Both Android.
- **Rung 2** (screen on/off only): **0**.
- **Rung 1** (vendor aggregate): **3** — entries 35 and 41 (iOS Battery usage, photographed and
  screen-recorded respectively) and entry 38 (Apple Screen Time, manually transcribed by the
  participant). All iOS.
- **Not applicable** (review, book, chapter, methods paper): **4** — entries 32, 34, 37, 40.

**System-app / launcher filtering declared: 2 of 10, and they disagree with each other.** Entry 33
declares a filter, publishes the list, and explicitly says launchers should be kept. Entry 36 defines a
"System" category and assigns 1231 of 3091 apps to it, but never mentions launchers or gallery apps at
all. Entry 35 declares a bespoke category-based deduction (music/TV/calling/GPS) that is not a
system-app filter. Entry 41 keeps launcher-equivalent time as an explicit "Home Lock Screen" predictor.
The remainder are silent.

### Things that surprised me

1. **The transcribed DOI for entry 33 is wrong and does not resolve.** `10.5117/ccr2025.1.parr` 404s;
   the real DOI is `10.5117/CCR2025.1.8.PARR`. Winklbauer & Batinic's reference list is malformed for
   the single most important methodological source in it.
2. **Parry & Toth throw away Android's own end-of-episode marker.** `ACTIVITY_STOPPED` (23) — the OS's
   explicit "this activity has stopped" signal — is named, analysed, and then *excluded from the
   retained event set*, because it fires late and produces apparent overlap. Every episode duration in
   the field's canonical primer is therefore an inferred forward-pair, not an observed interval. They
   assert this is "more effective and accurate" and offer no validation of that claim. This is exactly
   the undeclared degree of freedom our paper is about, sitting in plain sight inside the one document
   that *does* declare it.
3. **The field's canonical primer already says the field's canonical system-app list is wrong for this
   purpose.** Parry & Toth (2025) explicitly reject Schoedel et al. (2022)'s "System" category, name
   `com.android.gallery3d` as a misclassification, build a replacement list — and then decline to
   report its size, and warn readers not to apply it "blindly". Two open, well-regarded artefacts, three
   years apart, from adjacent research communities, disagree about which packages count as human usage.
4. **Schoedel et al. never mention launchers or gallery apps.** The criticism levelled at them by both
   Parry & Toth and Winklbauer & Batinic is about the released CSV's row assignments, not about the
   published scheme — whose System definition ("run in the background", "not consciously accessed")
   would in fact *exclude* launchers and gallery apps. That distinction matters for how our paper phrases
   the critique. I could not verify the CSV itself: PsychArchives' file server returned HTTP 504 on every
   attempt.
5. **Steegen et al. explicitly say preregistration does not deflate the multiverse.** This is the
   opposite of how the technique is usually invoked in this literature, and it strengthens our argument:
   a preregistered smartphone study that freezes one undeclared reconstruction rule has not escaped the
   problem, it has merely fixed one arbitrary point in it.
6. **Three of the five measurement studies in this lane are iOS vendor-aggregate studies, not Android
   event-log studies.** Entries 35, 38 and 41 read numbers off Apple's UI (photograph, manual
   transcription, and screen-video OCR respectively). For those studies the reconstruction rule is not
   merely undeclared — it is Apple's, proprietary, undocumented, and silently version-dependent. Entry
   35 makes this concrete: its measurement window is "mostly […] the last ten days, on older iOS
   versions of the last seven days", i.e. the observation window itself varies by participant according
   to an undocumented vendor policy, and the paper divides by it anyway.
7. **Siebers et al. accidentally ran a one-parameter multiverse and it changed a result.** Varying only
   the session threshold across 0/10/30/60/90 s flipped the between-person association between sticky
   use and distraction. That is a single knob, at the *session* level, in a study whose *episode*-level
   rule was never even visible to the authors. It is the best empirical hint in this lane of what a full
   reconstruction multiverse would do.

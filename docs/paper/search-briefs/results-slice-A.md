# SLICE A — Android event-log methodology

> **Independent expansion (2026-08-05 to 2026-08-06):** Source-diverse passes plus two independently reviewed Pro deltas retained **123 distinct items**, versus 22 numbered items in the initial concurrent pass. The appended ledger is the authoritative coverage/count audit; overlapping citations across passes must not be counted twice.

Agent run: 2026-08-05. Route restrictions honoured: **WebFetch, curl, `gh` API, StackExchange API,
OpenAlex API only.** No browser automation, no Playwright, no Chrome, no driver.

Exclusion list applied before searching: every item already recorded in `docs/paper/literature-dossier.md`
and `docs/paper/citation-chase/lane-{1..5}.md` (the 51 Winklbauer & Batinic reference entries, Parry & Toth 2025,
Zhu 2018, Van Canneyt 2017, Böhmer 2011, Lee/Park/Lee 2022, Stachl 2020, Tóth 2023, Jones 2015,
Wilcockson 2018, Shaw 2020, Tkaczyk 2024, Kristensen 2022, Langener 2024, ASTER, Hooshyar 2025).
Nothing below duplicates those entries except where an inheritance chain runs into one, which is
reported as a chain and marked.

---

## Headline

Three things in this slice change what the paper can claim.

1. **Android declares part of the reconstruction rule itself, in the SDK reference and in AOSP source.**
   `DEVICE_SHUTDOWN`, `DEVICE_STARTUP`, `END_OF_DAY` and `CONTINUE_PREVIOUS_DAY` carry explicit
   instructions on how to treat unmatched open events. `UsageStats.update()` in AOSP is Google's own
   complete event→duration algorithm, readable in source. Nobody in the reviewed literature cites either.

2. **Someone has already published a complete, named taxonomy of the event→episode edge cases** — an
   F-Droid app author, on a Codeberg wiki, in 2021. It is not academic, but it is public, dated,
   exhaustive, and implemented. Report it loudly (§2, item 6).

3. **Karas et al. (2024)** declared their rule, quantified in minutes/day how much a single
   preprocessing cap moves the estimate, published the code, and wrote "we do not have a definitive
   reason for choosing the 30-minute threshold." This is the strongest citation threat in the slice
   (§2, item 7). It is device level (rung 2), not app level, which is where the surviving gap sits.

Counts: **19 items kept.** Read in full or in authoritative source form: **14.**
Abstract/metadata only: **2.** Could not access at all: **3.**

---

## 1. Platform documentation and AOSP source — the rung-4 semantics, verified

### 1. Android SDK reference — `android.app.usage.UsageEvents.Event`

- **Why it matters here.** The platform vendor states a reconstruction instruction in the public API
  reference, in prose, for the exact failure the paper is about (the closing event that never arrives).
- **Instrument and ladder rung.** N/A (specification, not data). Defines rung 4.
- **Episode reconstruction rule.** **DECLARED, partially.** Verbatim, `DEVICE_SHUTDOWN` entry:

  > "A DEVICE_SHUTDOWN event should be treated as if all started activities and foreground services
  > are now stopped and no explicit ACTIVITY_STOPPED and FOREGROUND_SERVICE_STOP events will be
  > generated for them.
  > The DEVICE_SHUTDOWN timestamp is actually the last time UsageStats database is persisted before
  > the actual shutdown. Events (if there are any) between this timestamp and the actual shutdown is
  > not persisted in the database. So any open events without matching close events between
  > DEVICE_SHUTDOWN and DEVICE_STARTUP should be ignored because the closing time is unknown."

  And `DEVICE_STARTUP`:

  > "Any open events without matching close events between DEVICE_SHUTDOWN and DEVICE_STARTUP should
  > be ignored because the closing time is unknown."

  Note what this does *not* say: it gives no rule for an unmatched open event anywhere else in the
  log, no gap threshold, and no session concept at all.
- **Session threshold.** None. The word "session" does not appear in the constant definitions.
- **Availability.** Public specification.
- **Access.** Full text, fetched by curl 2026-08-05.
- **Verified count, correcting the brief.** The public reference page lists **18 constants**, of which
  `MOVE_TO_FOREGROUND` and `MOVE_TO_BACKGROUND` are deprecated aliases carrying the same integer values
  as `ACTIVITY_RESUMED` (1) and `ACTIVITY_PAUSED` (2) — so **16 distinct public integer values.**
  The brief's "~46 types total" is not what any AOSP source defines; see item 2.

### 2. AOSP `frameworks/base/core/java/android/app/usage/UsageEvents.java` (branch `main`)

- **Why it matters here.** The authoritative event vocabulary, including the `@hide` constants that
  appear in a real device's event stream but not in the public reference.
- **Ladder rung.** N/A (specification).
- **Episode reconstruction rule.** **DECLARED for two hidden constants.** Verbatim:

  > `END_OF_DAY = 3` — "An event type denoting that a component was in the foreground when the stats
  > rolled-over. This is effectively treated as a {@link #ACTIVITY_PAUSED}. This event has a non-null
  > packageName, and a null className. {@hide}"

  > `CONTINUE_PREVIOUS_DAY = 4` — "An event type denoting that a component was in the foreground the
  > previous day. This is effectively treated as a {@link #ACTIVITY_RESUMED}. {@hide}"

  Also relevant and hidden: `ACTIVITY_DESTROYED = 24`, `FLUSH_TO_DISK = 25`, `USER_UNLOCKED = 28`,
  `USER_STOPPED = 29`, `APP_COMPONENT_USED = 31`.
- **Verified vocabulary size.** Constants run **0 through 31**, with
  `public static final int MAX_EVENT_TYPE = 31;` and the comment "Keep in sync with the greatest event
  type value." That is **32 event types**, **16 of which are `@hide` or `@SystemApi`** and therefore
  invisible to any app-facing documentation.
- **Availability.** Source, Apache-2.0.
- **Access.** Full source, `android.googlesource.com` `?format=TEXT` base64, fetched 2026-08-05.

### 3. AOSP `frameworks/base/core/java/android/app/usage/UsageStats.java` — `update()` / `updateActivity()`

- **Why it matters here. This is Google's own event→duration algorithm, in source, and it is the
  definition of `getTotalTimeInForeground()`.** Any paper that reports "total time in foreground"
  from `queryUsageStats()` is reporting the output of *this* rule, unnamed and uncited. It is a
  fourth published method hiding in plain sight, and it is the rung-1/rung-4 bridge.
- **Ladder rung.** N/A (implementation). Produces the rung-1 aggregate from the rung-4 stream.
- **Episode reconstruction rule.** **DECLARED (source).** The load-bearing properties, each read
  directly from `updateActivity()`:
  - State is keyed on **`instanceId`** — "the hashCode of ActivityRecord's appToken" — i.e. per
    *Activity instance*, not per package. Multiple concurrent instances of one package each hold state.
  - Only `ACTIVITY_RESUMED`, `ACTIVITY_PAUSED`, `ACTIVITY_STOPPED`, `ACTIVITY_DESTROYED` reach
    `updateActivity()`; everything else returns immediately.
  - Time is accrued on the *arrival of the next event*, from the *previous* event's type:
    `case ACTIVITY_RESUMED: incrementTimeUsed(timeStamp); incrementTimeVisible(timeStamp);` and
    `case ACTIVITY_PAUSED: incrementTimeVisible(timeStamp);`. So a paused-but-visible activity keeps
    accruing *visible* time but not *foreground* time — the `getTotalTimeInForeground()` vs
    `getTotalTimeVisible()` split (both public, API 29+).
  - `ACTIVITY_STOPPED` and `ACTIVITY_DESTROYED` only `mActivities.delete(instanceId)`.
  - `END_OF_DAY` closes all foreground and visible activities.
  - `DEVICE_SHUTDOWN` and `FLUSH_TO_DISK` share a branch: close everything, activities and foreground
    services alike.
  - `USER_INTERACTION` **accrues foreground time** if an activity is foreground, else advances
    `mLastTimeUsed`. A non-lifecycle event therefore contributes to the vendor duration.
  - `incrementTimeUsed` guards with `if (timeStamp > mLastTimeUsed)`, so out-of-order events silently
    contribute zero rather than negative time.
- **Session threshold.** **None, anywhere.** No gap merging, no minimum duration, no cap. The vendor
  aggregate is a pure sum of instance-level intervals.
- **Availability.** Source, Apache-2.0. Fully re-runnable by a third party.
- **Access.** Full source, fetched 2026-08-05.

### 4. AOSP `services/usage/.../UserUsageStatsService.java` — `rolloverStats()` / `updateRolloverDeadline()`

- **Why it matters here.** It is the mechanism that manufactures the day boundary, and it explains why
  a session spanning midnight appears in the log as a close plus a re-open rather than one interval.
- **Episode reconstruction rule.** **DECLARED (source).** At rollover the service writes
  `Event.END_OF_DAY` at `mDailyExpiryDate.getTimeInMillis() - 1` for every package with open
  activities, and `Event.ROLLOVER_FOREGROUND_SERVICE` for open foreground services; then, after
  persisting and pruning, it re-injects the saved per-`instanceId` event map at the new interval's
  `beginTime`. The rollover deadline is `mCurrentStats[INTERVAL_DAILY].beginTime` plus one day
  (`updateRolloverDeadline()`), not a wall-clock local midnight constant.
- **Session threshold.** None.
- **Access.** Full source, fetched 2026-08-05.

---

## 2. Declared rules outside the journals — the part that threatens the "nobody declares it" framing

### 5. Stack Overflow, "Android: UsageStatsManager not returning correct daily results" (Q 36238481)

- **Why it matters here.** This is the de facto reconstruction rule of the Android app ecosystem —
  the answer that gets copied into consumer screen-time apps. It is a *fourth published method* with
  a readership larger than any of the papers, and its failure mode is exactly End-of-Usage-Missing.
- **Instrument and ladder rung.** Rung 4 source, no study.
- **Episode reconstruction rule.** **DECLARED (code).** Question posted 2016-03-26, score 22, 7 answers.
  Top answer (score 16, posted 2017-07-28, *not* accepted). Verbatim core:

  > ```java
  > if (currentEvent.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND ||
  >         currentEvent.getEventType() == UsageEvents.Event.MOVE_TO_BACKGROUND) {
  >     allEvents.add(currentEvent);
  > ```
  > ```java
  > if (E0.getEventType()==1 && E1.getEventType()==2
  >         && E0.getClassName().equals(E1.getClassName())){
  >     long diff = E1.getTimeStamp()-E0.getTimeStamp();
  > ```

  Read carefully, this rule is: keep only foreground/background events; walk **adjacent pairs only**;
  credit an interval only when the immediately-next event is a background event **of the same class
  name**. Consequences, all silent: an open episode with no matching close contributes **zero**; the
  final open episode of the query window is always dropped; `ACTIVITY_STOPPED`, `DEVICE_SHUTDOWN`,
  `END_OF_DAY` are never consulted; there is no threshold of any kind.
  Launch counting uses a different predicate in the same loop:
  `if (!E0.getPackageName().equals(E1.getPackageName()) && E1.getEventType()==1)`.
- **Second answer (score 11, 2018-06-01), verbatim, on the vendor aggregate:**

  > "I agree with what is said in that comment you mentioned about queryUsageStats not being a trusted
  > source. I've been with playing with the UsageStatsManager for a little while and it returns
  > inconsistent results based on the time of day. I have found that using the UsageEvents and manually
  > calculating the necessary info to be much more trustworthy (at least for daily stats), as they are
  > points in time and don't have any weird calculating errors that would produce different outputs for
  > the same input depending on the time of day."

- **Session threshold.** None declared; none exists in the code.
- **Availability.** Public. Re-runnable.
- **Access.** Full text, StackExchange API 2.3, 2026-08-05.
  https://stackoverflow.com/questions/36238481

### 6. usageDirect — "Event log wrapper scenarios" wiki (fynngodau, Codeberg) — **REPORT LOUDLY**

- **Why it matters here. This is a citation threat of a kind the brief asked to be flagged: it is a
  complete, named, dated taxonomy of every event→episode edge case, with the chosen handling stated
  for each.** It is grey literature, not a paper, and it is device-side rather than analytic, but the
  paper cannot write "nobody has enumerated these cases." Someone did, in 2021, and shipped it.
- **Instrument and ladder rung.** Rung 4 (`UsageStatsManager` event log).
- **Episode reconstruction rule.** **DECLARED.** Page header, verbatim:

  > "The usageDirect event log wrapper receives data from `UsageStatsManager`'s event log API. The data
  > format is a 'list' of events which are worked through in order. The process is tricky and requires
  > assumptions and workarounds, which are documented here."
  > "Rules apply top to bottom."

  The scenario table, verbatim (scenario / technical name / handled / current behavior):

  > App opens and closes within query time — "Open and close events in order" — Yes — "Count from open event until close event"
  > ––– — "Duplicate close event" — Yes — "Drop second close event"
  > ––– — "Duplicate open event" — Yes — "Drop first open event"
  > Device is powered off — "Shutdown event" — Yes — "Treat shutdown event as close event for all previous unmatched open events (per Android docs)"
  > Device is booted — "Startup event" — Yes — "Drop all previous unmatched open events (per Android docs)"
  > App opens before query time — "True unmatched close event" — Yes — "If open event is contained in logs of the preceeding 24 hours, count from start of query time until close event, drop otherwise (UnmatchedCloseEventGuardian)"
  > ––– — "Faulty unmatched close event" — Yes — "Drop event"
  > App closes after query time — "True unmatched open event" — Partially — "If query time ends in the future and if app contained in ActivityManager.getRunningAppProcesses()¹, count from open event until now, drop otherwise"
  > ––– — "Faulty unmatched open event" — Yes — "Drop event"
  > App open for whole query time — "No event" — Partially — "If query time ends in the future and if app contained in ActivityManager.getRunningAppProcesses()¹, count from start of query time until now, undetected otherwise"
  > Event log is emptied — "Data gone" — Yes — "Don't overwrite existing data, add new data incrementally"
  > Switch timezone — "Midnight moves in time" — Yes — "Add time that was not counted yet to the day it belongs assuming the timezone at query time"

  Scope statement, verbatim: "Query time is the time interval that the event log wrapper is queried
  for. It is currently at most spanning across one day (not across midnight) in the user's timezone."
  Footnote 1, verbatim: "Documented as not inteded for this purpose and does not work with the app set
  as launcher app." (typo in original).
- **Session threshold.** **None.** The taxonomy is entirely about matching and missingness. There is
  no gap threshold and no session concept — which is itself the point: a rule can be fully declared
  and still contain no threshold.
- **Availability.** Wiki page last edited **2021-07-02 16:10:52 +02:00**. Repo `fynngodau/usageDirect`,
  created 2020-04-07, last updated 2024-12-03, 28 stars, shipped on F-Droid as
  `godau.fynn.usagedirect`. README states it is "Forked from the Android sample called
  'AppUsageStatistics' (Copyright 2017 The Android Open Source Project, Inc)." Fully re-runnable.
- **Access.** Full text of the wiki page, curl 2026-08-05. Codeberg served static HTML.

### 7. Olauncher — `EventLogWrapper.kt` + `UnmatchedCloseEventGuardian.kt` (the implementation of item 6)

- **Why it matters here.** The taxonomy in item 6 exists as running code in a popular launcher, so
  the rule is inspectable rather than merely described. It is the most complete non-academic
  reconstruction implementation found in this slice.
- **Episode reconstruction rule.** **DECLARED (code, with the wiki cited in the source comments).**
  Salient verbatim fragments:
  - Opens: `UsageEvents.Event.ACTIVITY_RESUMED, 4 -> { moveToForegroundMap[appClass] = event.timeStamp }`
    with the comment "Store open timestamp in map, overwriting earlier timestamps in case of Duplicate
    open event". The bare `4` is `CONTINUE_PREVIOUS_DAY`, and the comment quotes the `@hide` javadoc.
  - Closes: `ACTIVITY_PAUSED, ACTIVITY_STOPPED, 3 ->` — the bare `3` is `END_OF_DAY`, again with the
    `@hide` javadoc quoted inline. **All three close events are treated identically.**
  - Shutdown: "// Per docs: iterate over remaining start events and treat them as closed".
  - Startup: "// Per docs: remove pending open events" plus `queryStart = event.timeStamp` with the
    comment "No package could be open longer than a reboot… It is not logical that this would happen
    but we can never know with this API."
  - Unmatched open at end of window: credited only if the package appears in
    `ActivityManager.runningAppProcesses`; otherwise "// If app is not in foreground, drop event
    (Assume Faulty unmatched open event)".
  - `UnmatchedCloseEventGuardian` re-queries the preceding `SCAN_INTERVAL = 1000L * 60 * 60 * 24`
    (24 h) hunting the missing open event, resetting `open = false` on `DEVICE_STARTUP`
    ("Consider all apps closed after startup according to docs").
- **Session threshold.** None.
- **Availability.** Public source, GitHub `tanujnotes/Olauncher`. Re-runnable.
- **Access.** Full source of both files, `gh api` contents 2026-08-05.

---

## 3. Papers

### 8. van Berkel, N., Luo, C., Anagnostopoulos, T., Ferreira, D., Goncalves, J., Hosio, S., & Kostakos, V. (2016) — *A Systematic Assessment of Smartphone Usage Gaps*

CHI '16, 4711–4721. doi:10.1145/2858036.2858348.

- **Why it matters here. This is the threshold-provenance paper the dossier does not yet have.** It
  is the only work found in this slice that (a) tabulates competing session definitions against their
  source citations, (b) says in print that the definitions are not empirically derived, and (c) runs a
  labelled ground-truth experiment to pick a threshold. It is a *supporting* citation, not a threat:
  it treats the threshold as a nuisance parameter to be optimised, never as a semantics that
  determines what is being measured.
- **Instrument and ladder rung.** **Rung 3.** AWARE plugin on participants' own Android phones:
  "We collected our data using a plugin developed for the AWARE framework [13], running continuously
  in the background of the participants' own Android phones." Logged: ESM answer, ESM status, "Phone
  status: various phone-related details (e.g., phone state: reboot, shutdown; screen state: on, off,
  locked, unlocked; battery state…)", "Application names: application launches and any notifications
  they trigger." No `UsageEvents` constants are named anywhere in the paper.
- **Episode reconstruction rule.** **DECLARED at device level, ABSENT at app level.** Analysis begins
  from "uninterrupted usage sessions (i.e., T=0), because for each such session we had an ESM label
  provided by participants." The paper defines a state model (their Figures 1–2) distinguishing locked
  and unlocked phone usage sessions and nesting application usage sessions inside phone usage sessions.
  How an application usage session is bounded from the logs is never stated.
- **Session threshold.** Value **T = 45 s**, kind **inactivity gap** (standby time between an unlock
  and the preceding lock), justification **empirical, and reported as weak by the authors**. Verbatim:

  > "The Constant Classifier performs best when the threshold is set to 45 seconds (accuracy=68%). For
  > values of T at 5, 30, or 60 seconds, the classifier performs worse."

  > "Given our findings, we believe that solely relying on the use of phone standby time analysis to
  > classify smartphone usage gaps is not reliable. However, if a researcher insists on using a
  > constant arbitrary threshold, we encourage fellow researchers to consider using a T=45 seconds
  > threshold (Figure 8) when analysing smartphone usage data. This threshold value minimises the
  > error based on our analysis. However, it still performs rather poorly in absolute terms (68%
  > accuracy) and, given the relative low number of 17 participants, is not generalizable."

  And the finding that damages every threshold rule:

  > "For instance, adopting a T=30 seconds threshold, as used in [4] and [5], actually only captures
  > 30.37% of all true continuous sessions in our dataset. Additionally, our results show that 50.85%
  > of gaps shorter than 30 seconds actually lead to a new session instead of a continuous session."

- **Threshold provenance, traced by the authors, verbatim.** This is the paragraph to lift:

  > "However, in previous work there is no consensus on what the threshold T should be. Soikkeli et al.
  > [31] use both T=0 and T=30 seconds, which lead to significantly different usage statistics: 20 vs
  > 13 sessions a day with an average length of 4:23 minutes and 7:09 minutes, respectively. This
  > highlights the main shortcoming of current literature, since using different thresholds results in
  > drastically different findings. Both Church et al. [6] and Banovic et al. [3] use T=5 seconds.
  > Böhmer et al. [4] define a session (or 'chain of app usage') as 'a sequence of apps that are used
  > without the device being in standby mode for longer than 30 seconds.' Carrascal & Church [5] state
  > 'we define a session as a sequence of interactions that occur without the device being in standby
  > mode, i.e. the display switching off, for longer than 30 seconds.' These definitions vary
  > substantially, but more critically their characteristics are not empirically derived: they are
  > simply intuitive."

  Their Table 1 additionally records, verbatim, against the 30-second rule: limitation = **"30 second
  delimiter not based on any actual evidence."** And it names two further definitions worth having:
  Rahmati & Zhong [29] — "A non-voice session is a series of consecutive screen-on time (two minutes or
  more)"; Oliver [24] — "[…] the duration that the LCD backlight was enabled less the time that the user
  was not interacting with the device (and resetting the idle time)"; Ferreira et al. [12] — micro app
  usage session = "Application usage that lasts up to 15 seconds."

  Reference resolution (from their own list, so the chain is authoritative):
  [3] Banovic, Brant, Mankoff & Dey 2014, MobileHCI, doi:10.1145/2628363.2628380 — T=5 s.
  [4] Böhmer et al. 2011, doi:10.1145/2037373.2037383 — 30 s *(already in dossier)*.
  [5] Carrascal & Church 2015, CHI, doi:10.1145/2628363.2628364 — 30 s.
  [6] Church, Ferreira, Banović & Lyons 2015, MobileHCI, doi:10.1145/2785830.2785891 — T=5 s.
  [10] Falaki, Mahajan, Kandula, Lymberopoulos, Govindan & Estrin 2010, MobiSys, doi:10.1145/1814433.1814453.
  [12] Ferreira, Goncalves, Kostakos, Barkhuus & Dey 2014, MobileHCI, doi:10.1145/2628363.2628367 — 15 s micro-usage.
  [16] Hintze, Findling, Muaaz, Scholz & Mayrhofer 2014, UbiComp Adjunct, doi:10.1145/2638728.2641697.
  [24] Oliver 2010, HotPlanet, doi:10.1145/1834616.1834623.
  [29] Rahmati & Zhong 2010, CoRR — 2-minute non-voice session.
  [31] Soikkeli, Karikoski & Hämmäinen 2011, NGMAST, doi:10.1109/NGMAST.2011.12 — T=0 vs T=30 s.
  Cross-field, cited by them and relevant to SLICE C: [18] Jansen, Spink, Blakely & Koshman 2007,
  *Defining a session on Web search engines*, JASIST 58(6):862–871, doi:10.1002/asi.20564;
  [20] Jones & Klinkner 2008, CIKM, doi:10.1145/1458082.1458176.
- **Availability.** N=17, 7 days. No data or code statement found in the paper.
- **Access.** **Full text**, author-hosted PDF, curl + `pdftotext`, 2026-08-05.
  https://cluo29.github.io/images/p4711-van-berkel.pdf

### 9. Karas, M., Huang, D., Clement, Z., Millner, A. J., Kleiman, E. M., Bentley, K. H., Zuromski, K. L., Fortgang, R. G., DeMarco, D., Haim, A., Donovan, A., Buonopane, R. J., Bird, S. A., Smoller, J. W., Nock, M. K., & Onnela, J.-P. (2024) — *Smartphone Screen Time Characteristics in People With Suicidal Thoughts*

JMIR mHealth and uHealth 12:e57439. doi:10.2196/57439.

- **Why it matters here. CITATION THREAT, ranked first.** They declare the rule, publish the code,
  run comparators, report the effect of one preprocessing choice **in minutes per day**, and state in
  print that the chosen value is not principled. Everything the paper wants to say about
  preprocessing-as-measurement-decision has a published precedent here — at **device level**.
- **Instrument and ladder rung.** **Rung 2.** Beiwe phone state logs. Verbatim: "For Android, the logs
  capture 'screen turned on' and 'screen turned off' events; for iOS, the logs capture 'locked' and
  unlocked' events. For iOS, the log also includes an event for each 1% change (positive or negative)
  in battery charge level." No app attribution at all.
- **Episode reconstruction rule.** **DECLARED.** Verbatim, Methods:

  > "We define a 'screen-on bout' for a smartphone as a period of consecutive screen use and a
  > 'screen-off bout' as a period of consecutive screen nonuse. Each screen-on bout is followed by a
  > screen-off bout, and vice versa. To estimate the timing and duration of screen-on bouts for iOS, we
  > used the time intervals between consecutive 'unlocked' and 'locked' event timestamps, while for
  > Android, we used the time intervals between consecutive 'screen turned on' and 'screen turned off'
  > event timestamps. During preprocessing, we imputed missing logs, removed bouts attributed to
  > notification arrivals (for Android only), and capped screen-on bouts that lasted longer than 30
  > minutes (which corresponds to approximately the 97th percentile). … Our preprocessing steps closely
  > resemble those previously presented by Kristensen et al [25]."

  Day boundary declared too: "We defined a day as the period from midnight to midnight in the
  Coordinated Universal Time (UTC) time zone. … we assumed the time zone choice would have no impact
  on the statistical analyses."
- **Session threshold.** Value **30 minutes**, kind **maximum bout cutoff** (not an inactivity gap).
  Justification, verbatim and unusually candid:

  > "Given the lack of a principled approach for selecting an optimal cap, researchers should be
  > mindful that this choice can substantially influence measure estimates. We do not have a definitive
  > reason for choosing the 30-minute threshold instead of other options. However, we believe this
  > choice strikes a good balance by indicating when a long screen time session has likely occurred
  > while minimizing the impact of outliers on our daily estimates."

  **Inheritance chain:** the rule is attributed to **Kristensen et al. [25]** — already in the dossier
  (§4.3, CHBR 5:100164, doi:10.1016/j.chbr.2021.100164) — and the acknowledgements confirm direct
  contact: "The authors thank Peter Lund Kristensen for providing us with further explanation and
  engaging in the discussion of the details of his paper, which we relied on in this work."
- **The multiverse result, verbatim.** This is the number that most threatens the contribution:

  > "Comparators 1 and 2 produced substantially higher estimates for daily total screen-on time, with
  > mean differences of −106.1 (range −502.6 to −1.3) minutes and −133.5 (range −666.4 to −2.4)
  > minutes, respectively. These methods used either a generous cap of 6 hours on an individual
  > screen-on bout duration (comparator 1) or no cap at all (comparator 2). In contrast, comparator 3
  > (no imputation, capping screen-on bout duration at 30 minutes) yielded results similar to our
  > proposed approach, with an average difference of −0.2 (range −11.8 to 7.3) minutes."

  And the priority claim to check before the paper makes any "first" claim of its own:

  > "Finally, to the best of our knowledge, this is the first presentation of freely available code for
  > preprocessing and analysis of raw phone state logs [24]."

- **Availability.** Code public: `onnela-lab/stb-beiwe-screen-time`, R, **BSD-3-Clause**, last pushed
  **2023-01-13** (verified via `gh api`; 0 stars). Data not public (clinical sample, n=50 adolescents,
  n=76 adults, median 169 monitoring days). The event→bout step **is** re-runnable by a third party on
  their own Beiwe logs.
- **Access.** **Full text**, PMC11488461, curl + local HTML→text, quotes verified against the fetched
  document rather than a summary.
- **What it does not do, and where the gap survives.** No app attribution, so no app-level episode
  rule; one pipeline varied by one parameter, not multiple independently authored methods; no
  `UsageEvents` constants; no ontology. The paper's app-level and multi-method claims survive intact.
  Its "preprocessing choices move the number and are unreported" claim does **not** survive as novel —
  cite Karas for it.

### 10. Kang, S., Choi, W., Park, C. Y., Cha, N., Kim, A., Khandoker, A. H., Hadjileontiadis, L. J., Kim, H., Jeong, Y., & Lee, U. (2023) — *K-EmoPhone: A Mobile and Wearable Dataset with In-Situ Emotion, Stress, and Attention Labels*

Scientific Data 10. doi:10.1038/s41597-023-02248-2.

- **Why it matters here.** A public, CC-BY, rung-4 Android event dataset that **names the event
  constants it recorded and then says nothing whatsoever about how to turn them into episodes.** It is
  the cleanest available demonstration of the paper's thesis: the raw material is published, the rule
  is not, and no third party can reproduce the authors' durations because the authors never state them.
- **Instrument and ladder rung.** **Rung 4.** Verbatim, the seven-plus event types recorded:
  "MOVE_TO_FOREGROUND (the app moves to the foreground)", "MOVE_TO_BACKGROUND (the app moves to the
  background)", "USER_INTERACTION (the app interacts with the user in some way)", "SCREEN_INTERACTIVE
  (the app become available for interaction)", "SCREEN_NON_INTERACTIVE (the app become unavailable for
  interaction)", "KEYGUARD_HIDDEN (the keyguard has been hidden)", "CONFIGURATION_CHANGE (the device's
  configuration has changed)", "SHORTCUT_INVOCATION (the app's shortcut is selected by the user)".
  Devices: Android ≥ 6.0, "Android API level of 21 or above."
- **Episode reconstruction rule.** **ABSENT.** No episode, session, or duration construction is
  described.
- **Session threshold.** **ABSENT.**
- **Availability.** Zenodo doi:10.5281/zenodo.7606611, CC-BY-4.0, CSV tables of raw event rows,
  collection app and supplementary code on GitHub. The event→episode step is **not** re-runnable
  against the authors' intent because no intent is recorded — but the raw stream is there, which makes
  this dataset a viable substrate for a four-method divergence demonstration on someone else's data.
- **Access.** Full text via PMC10238385. Fields extracted by WebFetch; the constant list is a direct
  quotation of the descriptor's own parenthetical glosses.

### 11. Yuan, N., Weeks, H. M., Ball, R., Newman, M. W., Chang, Y.-J., & Radesky, J. S. (2019) — *How much do parents actually use their smartphones? Pilot study comparing self-report to passive sensing*

Pediatric Research 86:416–418. doi:10.1038/s41390-019-0452-2.

- **Why it matters here.** The upstream instrument lineage of the sampling design this repo's data
  comes from, and a documented case of a **polling** architecture on top of a rung-4 API — which is a
  different instrument from reading the event log, and produces a different measurement, not merely a
  different threshold.
- **Instrument and ladder rung.** **Rung 3 built by polling rung 4.** Verbatim: "Minuku is a prototype
  passive sensing app developed at the University of Michigan (PI: Chang, Newman) designed to query the
  Android *UsageStatsManager* library", queried **every 5 seconds**. iOS arm used Moment, "a
  commercially available app… which records screen on/off status."
- **Episode reconstruction rule.** **DECLARED, and coarse.** Verbatim: "We calculated the difference
  between each timestamp and summed all instances when the screen was on to obtain overall duration of
  usage, and duration of each specific app, per day." Pickups: "Each time the screen status changed
  from off to on was considered a pickup, from which we calculated daily pickup counts." No handling of
  missing close events is possible in a polling design — the failure mode is sampling error, not
  unmatched events.
- **Session threshold.** **ABSENT.** No minimum duration, no gap, no cap.
- **Availability.** Code: https://github.com/minuku/minuku-android. Data: ABSENT.
- **Access.** Full text via PMC6764893.

### 12. Wade, N. E., Ortigara, J. M., Sullivan, R. M., et al. (2021) — *Passive Sensing of Preteens' Smartphone Use: An Adolescent Brain Cognitive Development (ABCD) Cohort Substudy*

JMIR Mental Health 8(10):e29426. doi:10.2196/29426.

- **Why it matters here.** The largest-profile cohort application of Android passive sensing found in
  this slice, and its rule is ABSENT. Useful precisely because of its prominence.
- **Instrument and ladder rung.** **Rung 3, polling.** Verbatim: "EARS app ran continuously in the
  background of the participant's phone, scraping the operating system every few minutes to collect
  information on (1) screen on and off and (2) which app was in the foreground." Android ≥ 6.0 only.
- **Episode reconstruction rule.** **ABSENT.** The manuscript records that "duration and time of day of
  specific apps' use" were collected, with no statement of how duration is derived from the polls.
- **Session threshold.** **ABSENT.**
- **Availability.** Raw data via NIMH Data Archive under DUC; summary data in ABCD release NDA 3.0.
  Not re-runnable without NDA access, and the rule is unstated in any case.
- **Access.** Full text via PMC8561413.

### 13. Zhao, Y., Han, X., Bagot, K. S., et al. (2025) — *Examining measurement discrepancies in adolescent screen media activity with insights from the ABCD study*

npj Mental Health Research 4:15. doi:10.1038/s44184-025-00131-z.

- **Why it matters here.** A 2025 paper whose entire subject is *measurement discrepancy* in screen
  media activity, which nonetheless leaves the event→episode step unstated. That combination is the
  paper's argument in miniature and should be cited as such.
- **Instrument and ladder rung.** **Rung 3.** EARS, Android only: "EARS-logged data were only available
  for 495 Android users, as Apple blocked app-scrapping programs at data-collection time."
- **Episode reconstruction rule.** **ABSENT beyond a summation statement.** Verbatim: "Total
  EARS-logged time was calculated as the sum of the foreground app usage times across all apps averaged
  over days with at least one upload during the tracking period." Also: "System operational app usage
  times were excluded." How a "foreground app usage time" is bounded is not stated.
- **Session threshold.** **ABSENT.** No cap, no gap, no minimum.
- **Availability.** Data via NDA DUC; **code public**: https://github.com/ZhaoCUMC/ABCD_EARS — verified
  to exist and to contain two R scripts (`EARS_Manu1_cleaned_v1.R`, `EARS_Manu1_revision_final.R`) and
  a 133-byte README. The scripts were **not** read; whether the reconstruction rule is recoverable from
  them is **UNDETERMINED** and is a cheap, high-value follow-up.
- **Access.** Full text via PMC12064680.

### 14. Geyer, K., Ellis, D. A., Shaw, H., & Davidson, B. I. (2022) — *Open-source smartphone app and tools for measuring, quantifying, and visualizing technology use*

Behavior Research Methods 54(1):1–12. doi:10.3758/s13428-021-01585-7.

- **Why it matters here.** A methods paper whose stated purpose is to give the field an open logging
  instrument, from the Ellis/Shaw lineage already in the dossier — and it stops at "compare the
  timestamps," with no episode rule.
- **Instrument and ladder rung.** **Rung 2–3.** Verbatim: "Usage Logger in this instance queries the
  appropriate database. Events documented include when a person turned their screen on/off, switched
  apps, switched their phone on/off, and how the operating system managed apps." No `UsageEvents`
  constant is named.
- **Episode reconstruction rule.** **ABSENT.** The only construction statement is: "Unix time stamps
  can be compared between a 'Screen On' event and 'Screen Off' event to calculate the duration of
  smartphone use."
- **Session threshold.** **ABSENT.**
- **Availability.** "All source code, materials, and data are freely available"; repository
  https://github.com/kris-geyer/UsageLoggerPublished; CC-BY-4.0. Re-runnable in principle; the rule is
  in the code, not the paper. **The repository was not read — UNDETERMINED whether it implements one.**
- **Access.** Full text via PMC8863755.

### 15. RADAR-base — `radar-android-phone-usage/…/PhoneUsageManager.kt`

- **Why it matters here.** The dominant EU open digital-phenotyping platform's Android usage plugin,
  and it is an explicit **delegation**: it exports the event stream, mapped to its own enum, and
  computes nothing.
- **Instrument and ladder rung.** **Rung 4, faithfully forwarded.**
- **Episode reconstruction rule.** **DELEGATED (to the downstream analyst; no downstream rule shipped
  in this repo).** It calls `usageStatsManager.queryEvents(lastTimestamp, System.currentTimeMillis())`,
  skips two classes of row — `if (event.eventType == CONFIGURATION_CHANGE || event.timeStamp <
  lastTimestamp)` — and maps the remainder one-to-one:
  `ACTIVITY_RESUMED -> FOREGROUND`, `ACTIVITY_PAUSED -> BACKGROUND`, `ACTIVITY_STOPPED -> STOPPED`,
  `FOREGROUND_SERVICE_START/STOP`, `KEYGUARD_SHOWN/HIDDEN`, `CONFIGURATION_CHANGE -> CONFIG`,
  `SHORTCUT_INVOCATION_COMPAT -> SHORTCUT`, `USER_INTERACTION -> INTERACTION`,
  `SCREEN_INTERACTIVE`, `SCREEN_NON_INTERACTIVE`, `STANDBY_BUCKET_CHANGED`, `else -> OTHER`.
  Note `DEVICE_SHUTDOWN`/`DEVICE_STARTUP`/`END_OF_DAY` fall into `OTHER` — the platform's own
  reconstruction instructions are collapsed into an unnamed bucket before any analyst sees them.
  It persists `lastEventType`/`lastTimestamp` across process restarts.
- **Session threshold.** None.
- **Availability.** Public source, `RADAR-base/radar-commons-android`, last pushed 2026-06-19.
- **Access.** Full source, `gh api` contents 2026-08-05.

### 16. mobileDNA — PyPI `mobiledna` 0.8.2 (Van Gaeveren, Perneel & Durnez, imec-mict, Ghent University)

- **Why it matters here.** The only research-grade smartphone-usage package found in **any** package
  registry, and it demonstrates two things at once: (a) the reconstruction has already happened
  upstream, inside the closed mobileDNA platform, before any researcher touches the data; (b) the
  package nonetheless carries a hard-coded, single-app, paper-invisible preprocessing rule.
  Same lab as ASTER (Van Gaeveren is a co-author), so this is one lab's whole pipeline.
- **Instrument and ladder rung.** **Rung 3−**: the analyst receives `startTime`/`endTime` rows from a
  vendor platform, not events.
- **Episode reconstruction rule.** **DELEGATED to the mobileDNA platform, which does not document it.**
  `help.add_duration()` computes duration from supplied `startTime`/`endTime`; it raises if either
  column is missing. There is no event handling in the package at all.
- **Undeclared preprocessing rule found in the code**, verbatim from `core/appevents.py`:

  > ```python
  > def preprocess(self):
  >     """
  >     Removes appevents from certain apps if longer than a certain duration (in minutes)
  >     """
  >     APP_DURATION_LIMIT = {
  >         "com.waze": 40,         # More than 40 minutes of Waze is not real screentime
  >     }
  > ```

  A per-app duration cap, applied by package name, justified by an inline comment.
- **Session threshold.** None in the package. `Sessions` objects are loaded pre-formed from the
  platform, and `get_session_sequences()` merely groups app events by an existing `session` column.
- **Availability.** PyPI `mobiledna` 0.8.2; public mirror `simonperneel/mobiledna_py` (last pushed
  2023-07-10); canonical version on UGent enterprise GitHub, **not publicly readable**. Data requires
  the mobileDNA platform.
- **Access.** Full source of `core/sessions.py`, `core/appevents.py`, `core/help.py` read via `gh api`;
  PyPI JSON metadata read via curl.

### 17. Murmuras platform — "Analyzing smartphone usage data with R, Part 1: App sessions" (Kasem, Q., 2022-06-09)

- **Why it matters here.** A commercial smartphone-usage research platform publishing a researcher
  tutorial *about app sessions* that never states what an app session is. Same shape as item 16:
  the rule is executed inside the vendor and shipped as a CSV.
- **Instrument and ladder rung.** **Rung 1–3 hybrid, undeclared.** "Download your data from the
  Murmuras Researcher Portal… Choose 'App sessions', then click download."
- **Episode reconstruction rule.** **ABSENT.** Columns `start_time`, `end_time`, `duration` arrive
  pre-computed. No event source named, no boundary rule, no threshold.
- **Session threshold.** **ABSENT.**
- **Availability.** Data behind a commercial portal. Not re-runnable.
- **Access.** Full text of the blog post.

### 18. Church, K., Ferreira, D., Banović, N., & Lyons, K. (2015) — *Understanding the Challenges of Mobile Phone Usage Data*

MobileHCI '15, 505–514. doi:10.1145/2785830.2785891. OpenAlex: 63 citations, `oa_status = closed`.

- **Why it matters here.** By title and authorship (the AWARE group) this is the most likely
  undiscovered rung-3/4 methods paper in this slice, and van Berkel et al. cite it as a T=5 s source.
- **Instrument and ladder rung.** **UNDETERMINED.**
- **Episode reconstruction rule.** **UNDETERMINED — not read in full.**
- **Session threshold.** Reported by van Berkel et al. (item 8) as **T = 5 seconds**; the value is
  quoted from their text, **not** from Church et al. themselves. Do not cite the number to Church until
  the original is read.
- **Availability.** Unknown.
- **Access.** **Metadata only.** No OA copy in OpenAlex; the only alternate location is a CiteSeerX
  summary page. `dl.acm.org` returns **HTTP 403** to WebFetch. **Highest-value unread item in this
  slice.**

### 19. Jung, G., Park, S., Ma, E.-Y., Kim, H., & Lee, U. (2024) — *Tutorial on Matching-based Causal Analysis of Human Behaviors Using Smartphone Sensor Data*

ACM Computing Surveys. doi:10.1145/3648356. OpenAlex `oa_status = bronze`.

- **Why it matters here.** One of only three works in all of OpenAlex whose indexed full text contains
  the string `MOVE_TO_FOREGROUND`, and it is a tutorial — so if it declares a rule, it declares one for
  a readership.
- **Everything else.** **UNDETERMINED — not read.**
- **Access.** `https://dl.acm.org/doi/pdf/10.1145/3648356` returns **HTTP 403** to WebFetch. No other
  OA location listed. Recorded as unavailable by the permitted routes, per the brief.

---

## Report

### Totals

- **Kept: 19.** Platform/AOSP artifacts 4, non-academic declared rules 3, papers 9, tools/packages 3.
- **Read in full (or in authoritative source form): 14** — items 1–8, 9, 10, 11, 12, 13, 14, 15, 16, 17.
  Items 1–4, 5, 6, 7, 15, 16 were read as primary source text, not summaries. Item 8 and item 9 were
  extracted to local text and quoted against the extracted file, not against a summarizer.
- **Abstract / metadata only: 2** — items 18 and 19.
- **Fetch-blocked: 3 routes** — `dl.acm.org` (403 twice), `nature.com` article page (IdP redirect;
  resolved via PMC), `ncbi.nlm.nih.gov/pmc` legacy host (301; resolved via `pmc.ncbi.nlm.nih.gov`).

### Citation threats, ranked

1. **Karas et al. 2024 (item 9).** Declares its rule, publishes code, quantifies the effect of one
   preprocessing choice at **−106.1** and **−133.5** minutes/day, and prints "we do not have a
   definitive reason for choosing the 30-minute threshold instead of other options." Also claims
   "the first presentation of freely available code for preprocessing and analysis of raw phone state
   logs." **The paper must cite this for the preprocessing-moves-the-number claim and must not present
   that claim as new.** What survives: it is rung 2 (no app attribution), one pipeline varied by one
   parameter, and no independently authored methods are compared.
2. **usageDirect wiki + Olauncher implementation (items 6, 7).** A complete, named, dated taxonomy of
   the unmatched-open / unmatched-close / duplicate / shutdown / startup / timezone cases, declared and
   implemented. Grey literature, so it is not a novelty threat in the publication sense, but any
   reviewer who finds it will ask why it is not cited. **Cite it, and use it: it is a fourth
   independently authored method, and a very good one.**
3. **van Berkel et al. 2016 (item 8).** Not a threat to the ontology contribution, but it pre-empts any
   claim that nobody has noticed thresholds are arbitrary or measured the consequence. They wrote
   "their characteristics are not empirically derived: they are simply intuitive" a decade ago.
4. **The Stack Overflow answer (item 5).** No academic priority, but it is the most-executed
   reconstruction rule in existence and it silently drops unmatched opens. It belongs in the paper as
   evidence, not as a threat.

### Anything that contradicts us — stated without softening

- **"The field almost never says which rule it used" is true of the journals and false of the platform
  and the FOSS ecosystem.** Google states a rule for shutdown/startup in the public SDK reference and
  ships its complete algorithm in `UsageStats.update()`. fynngodau published a scenario-by-scenario
  rule table in 2021. Olauncher implements it with source comments citing the wiki. The honest framing
  is not "nobody has declared a rule" but **"the declarations exist outside the literature that uses
  the measurements, and no published study cites any of them."** That is a sharper claim and it is
  defensible from this slice's evidence.
- **Karas et al. 2024 already did the parameter-multiverse demonstration** for device-level screen
  time, with public code and a candid limitations paragraph.
- **Section 3 item 4 of the dossier** ("No study treating the session/inactivity threshold as
  definitional rather than a nuisance parameter") **still holds** — van Berkel et al. optimise the
  threshold, Karas et al. sensitivity-test the cap. Neither treats the value as constitutive of what is
  measured. That distinction is now load-bearing and should be made explicitly, because two papers now
  come close.

### Three things expected and not found

1. **No R package anywhere for smartphone usage-log sessionization.** r-universe search across
   "smartphone usage", "screen time", "app usage log" returns only linters, logging utilities and time
   series packages. CRAN has nothing. Given how much of this literature is R-based (Karas et al. ship
   R; Zhao et al. ship R), the absence of a shared package is the mechanism by which every group
   re-implements the rule privately.
2. **No published paper that cites the AOSP `DEVICE_SHUTDOWN`/`DEVICE_STARTUP` instruction.** Across
   all of OpenAlex from 2015, indexed full text contains `UsageStatsManager` in **45** works,
   `UsageEvents` in **49** works (several of them false positives on unrelated senses of the word),
   and `MOVE_TO_FOREGROUND` in exactly **3**. None of the three is a methods paper about episode
   construction. The platform's own instruction is uncited in the searchable literature.
3. **No academic enumeration of the event-matching failure cases.** The only exhaustive taxonomy found
   is the FOSS wiki. Not one paper distinguishes a *true* unmatched close event (episode began before
   the query window) from a *faulty* one (the platform dropped a row) — a distinction that changes the
   attributed duration and that a 2021 hobbyist wiki handles explicitly.
4. (Bonus absence.) **GitHub repository search for `UsageStatsManager` returns 36 repositories total**,
   all consumer utilities, launchers and sample code. There is no research reconstruction library on
   GitHub under that name.

### Dead ends — do not repeat these

- `PyPI` search for Android usage-event parsers: returns `logcatframe`, `logcat-parser`, `android-bp`,
  `python-evtx` — all logcat/binary-log tooling, none usage-stats. Direct name probes:
  `appusage` → 404, `chronicle-preprocessing` → 404, `screentime` → an unrelated 2018 toy
  ("ScreenTime™ for non iOS devices", Daniel O'Connell), `usagestats` → an unrelated telemetry
  collector (Remi Rampin). Only `mobiledna` is real (item 16).
- `gh api search/repositories` for "app usage android event log analysis" → **1 result**;
  "smartphone usage logs preprocessing psychology" → **0**; "digital wellbeing usage events export"
  → **0**. Repository search is exhausted for this topic.
- StackExchange search for `queryEvents` and `"usage stats foreground time"` is polluted by unrelated
  hits; the productive query is the bare tag-adjacent term `UsageStatsManager` sorted by votes.
  Q36238481 and Q32825854 are the two canonical threads; the rest are permission-plumbing questions.
- WebSearch on "digital phenotyping app usage data quality missing events" returns the
  missingness/non-collection literature (Beiwe/RADAR uptime, sensor permissions), which is a different
  problem from event-pairing. Not worth another pass.
- `dl.acm.org` PDF endpoints return 403 to WebFetch. For ACM-only items use the author's institutional
  copy (this is how item 8 was obtained) or record as unavailable.
- `nature.com` article URLs bounce through `idp.nature.com`; go straight to the PMC mirror.
- **Two claims surfaced by search-engine summarisation that I could not source and that the next agent
  should not chase as fact:** (a) a "Carnegie Mellon Human-Computer Interaction Institute study" said
  to find Screen Time reports deviating "37–68% across 42 test users" — this appeared only in a
  content-farm page (`lifetips.alibaba.com`) with no citation and has every hallmark of fabrication;
  (b) "45 seconds has been suggested as more accurate" attributed loosely in a summary — the real
  source is van Berkel et al. 2016 (item 8) and the number should be cited there, with their own
  caveat that it achieves only 68% accuracy on n=17 and "is not generalizable."

### Leads deliberately left open (cross-slice or cheap follow-ups)

- **Pye, S. R., et al. (2018).** *Assumptions made when preparing drug exposure data for analysis have
  an impact on results: An unreported step in pharmacoepidemiology studies.* PMC6055712. Surfaced by a
  negation search. **Metadata only — not read.** A search summary reported "10 decision nodes and 54
  possible unique assumptions, over 11,000 possible pathways" and a hazard ratio moving from 1.77 to
  2.83; **those numbers are unverified and must not be quoted until the paper is read.** If they hold,
  this is the strongest adjacent-field precedent yet found for "preprocessing is a measurement
  decision" and belongs to SLICE D.
- `ZhaoCUMC/ABCD_EARS` R scripts (item 13) and `kris-geyer/UsageLoggerPublished` (item 14): both
  public, both unread. Reading them would convert two ABSENT rules into DECLARED-in-code rules.
- `onnela-lab/stb-beiwe-screen-time` (item 9): the imputation heuristic and the notification-bout
  removal live only in Multimedia Appendix 1 and in this code. Unread.
- **Soikkeli, Karikoski & Hämmäinen 2011** (doi:10.1109/NGMAST.2011.12) is the origin of the
  T=0-vs-T=30 divergence figures van Berkel et al. quote (20 vs 13 sessions/day; 4:23 vs 7:09 mean
  length). Those numbers are currently sourced **second-hand through van Berkel et al.** Worth reading
  the original before the paper uses them, since they are the earliest published head-to-head
  demonstration that two thresholds on one dataset give different answers.
- `K-EmoPhone` (item 10) Zenodo deposit is a ready-made public rung-4 Android event corpus for a
  four-method divergence demonstration on data that is not ours.

<!-- independent-expansion-20260805:A -->

---

# Independent expansion ledger — Slice A (90 internally deduplicated sources)


Research date: 2026-08-05  
Scope: Android `UsageStatsManager` / `UsageEvents`, screen-state and app-state event logs, event-to-episode reconstruction, missing-event handling, and session thresholds.  
Selection rule: retain sources that either (a) declare an event-to-episode/session rule, (b) expose executable logic, (c) document relevant Android event semantics, or (d) are a relevant expected absence whose preprocessing is delegated or not recoverable. `UNDETERMINED` means the accessible record did not support a defensible claim about the rule; it does not mean that no rule exists.

## Executive result

- **90 distinct citable source items retained**: 52 scholarly papers, 9 official Android/AOSP sources, 14 software/tutorial sources, 6 package-registry sources, and 9 practitioner failure reports.
- **Access accounting:** 85 items were inspected through a full paper/manuscript, official documentation/source, complete code/tutorial, or full practitioner page; 5 remain abstract/metadata/snippet-only (A09, A13, A28, F84, F85). Rule status can still be `UNDETERMINED` for a fully accessible source when the source itself omits the reconstruction rule.
- **Direct scholarly methods are not absent.** Several papers declare rules, but the choices diverge: next-event forwarding, matched foreground/background pairing, screen-on/off boundaries, lock/unlock state machines, vendor-supplied intervals, inactivity thresholds, and hybrid screenshot/accessibility rules all occur.
- **No canonical Android reconstruction algorithm exists in the official API documentation.** The platform defines event meanings and some lifecycle edge cases, including shutdown without emitted stop events, but leaves analytic reconstruction to clients.
- **The strongest independent executable challenge is ActivityWatch's Android parser.** It publishes explicit state-machine behavior for competing resumes, stale pauses, same-app resumes, and trailing open events. Usage Logger, DetoxDroid, and Olauncher publish materially different alternatives.
- **The key novelty space is narrower than “nobody declares a rule.”** A defensible claim is that raw-Android app-episode choices remain fragmented, are often delegated or incompletely reported, and rarely receive systematic sensitivity analysis across event constants, orphan policies, boundary caps, and competing state machines.

## Evidence legend

- **Rung 1:** vendor/OS aggregate only.
- **Rung 2:** screen-state or unlock/lock events; device-use episodes.
- **Rung 3:** already formed app intervals or custom active-app telemetry.
- **Rung 4:** raw or near-raw app/lifecycle event stream suitable for alternative reconstruction.
- **Rule status:** `DECLARED`, `DELEGATED`, `ABSENT`, or `UNDETERMINED`.
- **Availability:** whether another researcher can rerun reconstruction from the disclosed artifact or raw-enough data.

## A. Scholarly papers and proceedings (40)

### A01. Parry & Toth (2025), *Extracting Meaningful Measures of Smartphone Usage from Android Event Log Data: A Methodological Primer*

- Citation: [DOI 10.5117/CCR2025.1.8.PARR](https://doi.org/10.5117/CCR2025.1.8.PARR)
- Why it matters: closest published end-to-end preprocessing workflow for raw Android event logs.
- Rung / rule: **4 / DECLARED.** Retains event types 1, 15, 16, 17, 18, 26, and 27. An app episode begins at type 1 and ends at the next event row, constrained by reconstructed session/glance boundaries.
- Threshold provenance: no arbitrary inactivity-gap threshold in the core app rule; boundaries inherit device/session events and cleaning choices.
- Quote/location: methods and worked code: “calculate the duration between a foreground event and the subsequent event.”
- Availability/access: full article, sample data, and code available; reconstruction can be rerun.

### A02. Toth & Trifonova (2021), *Somebody’s Watching Me: Smartphone Use Tracking and Reactivity*

- Citation: [DOI 10.1016/j.chbr.2021.100142](https://doi.org/10.1016/j.chbr.2021.100142)
- Why it matters: early empirical event-by-event reconstruction with explicit failure discussion.
- Rung / rule: **4 / DECLARED.** Device use starts with events 18/27 and ends with 17/26; app use starts with 1 and ends with 2/17/26.
- Threshold provenance: applies a 5-hour maximum session cutoff, citing Andrews et al. (2015), after observing implausible 9–12-hour sessions caused by missing lock/shutdown events.
- Quote/location: methods: “application usage starts with a move-to-foreground event and ends with move-to-background, screen-off, or keyguard-shown.”
- Availability/access: full manuscript and supplementary materials available; code/data artifact reported.

### A03. Toth (2023), *One App to Assess Them All*

- Citation: [DOI 10.1007/s11616-023-00788-6](https://doi.org/10.1007/s11616-023-00788-6)
- Why it matters: describes MART, an open Android sensing app used in later methodology work.
- Rung / rule: **4 / ABSENT at paper level.** It states that Android logging collects start/end points, but does not fully specify pairing, orphan, collision, or truncation behavior.
- Threshold provenance: not stated for event-to-episode reconstruction.
- Quote/location: instrumentation section: “collects the start and end points of phone and app uses.”
- Availability/access: full article and source repository available; reconstruction logic is not sufficiently recoverable from the paper alone.

### A04. Geyer, Ellis, Shaw & Davidson (2021/2022), *Open-source smartphone app and tools for measuring, quantifying, and visualizing technology use*

- Citation: [DOI 10.3758/s13428-021-01585-7](https://doi.org/10.3758/s13428-021-01585-7)
- Why it matters: publishes both an Android logger and R preprocessing scripts.
- Rung / rule: **4 / DECLARED.** Important events are 1, 2, 7, 26, and 27; duration is the timestamp difference to the next row, summed by app/event context.
- Threshold provenance: code removes intervals longer than two hours (`tooLong=60*60*2`); the paper leaves relevance choices to researchers.
- Quote/location: methods: “calculating the time differences between consecutive events and summing those durations independently.”
- Availability/access: full article and Apache-licensed code available; fully rerunnable.

### A05. Beierle et al. (2020), *Frequency and Duration of Daily Smartphone Usage in Relation to Personality Traits*

- Citation: [DOI 10.24989/dp.v1i1.1821](https://doi.org/10.24989/dp.v1i1.1821)
- Why it matters: large-scale Android reconstruction and explicit acknowledgement of missing/background events.
- Rung / rule: **4 / DELEGATED.** The paper reports a heuristic with background-app removal, missing-event detection, and imputation, but omits its operational parameters.
- Threshold provenance: not stated.
- Quote/location: preprocessing: “a heuristic for estimating actual usage sessions, including background app removal, detection, and imputation of missing events.”
- Availability/access: full text available; 40,140,665 events became 1,826,060 sessions, but reconstruction is not independently rerunnable from the disclosure.

### A06. Lee, Park & Lee (2022), *A Systematic Survey on Android API Usage for Data-driven Analytics with Smartphones*

- Citation: [DOI 10.1145/3530814](https://doi.org/10.1145/3530814)
- Why it matters: maps Android usage APIs and research applications, making it useful for lineage and expected-absence checks.
- Rung / rule: **N/A / ABSENT.** It surveys data access and applications but does not provide a canonical event-to-episode algorithm.
- Threshold provenance: not applicable.
- Quote/location: main text API survey; no operational pairing rule located.
- Availability/access: main full text located; appendices/artifacts were not fully retrievable in this search.

### A07. Zhu et al. (2018), *How to Measure Sessions of Mobile Phone Use? Quantification, Evaluation, and Applications*

- Citation: [DOI 10.1177/2050157917748351](https://doi.org/10.1177/2050157917748351), [arXiv 1711.09408](https://arxiv.org/abs/1711.09408)
- Why it matters: explicit device-session algorithm and a direct critique of arbitrary gap thresholds.
- Rung / rule: **4 for source logs; 2 for reconstructed device sessions / DECLARED.** Sessions run from unlock to lock; pseudocode is published.
- Threshold provenance: rejects a fixed inter-event threshold because “The threshold is arbitrarily chosen.”
- Quote/location: session-identification subsection and pseudocode.
- Availability/access: full preprint available; reconstruction is reproducible from the description.

### A08. Peng & Zhu (2020), *Mobile Phone Use as Sequential Processes: From Discrete Behaviors to Sessions of Behaviors and Trajectories of Sessions*

- Citation: [DOI 10.1093/jcmc/zmz029](https://doi.org/10.1093/jcmc/zmz029)
- Why it matters: separates vendor-recorded active-app intervals from higher-level, user-specific mobile sessions.
- Rung / rule: **3 / DELEGATED for app intervals, DECLARED for mobile sessions.** Consecutive apps are grouped when the inter-app interval is below that user's median.
- Threshold provenance: empirical and individualized—the per-user median inter-app interval, not a universal constant.
- Quote/location: methods: “If the inter-app interval is smaller than the median… the two apps are grouped into a mobile session.”
- Availability/access: full open article; vendor's lower-level app interval construction is not rerunnable from raw events.

### A09. Van Canneyt et al. (2017), *Describing Patterns and Disruptions in Large Scale Mobile App Usage Data*

- Citation: [DOI 10.1145/3041021.3051113](https://doi.org/10.1145/3041021.3051113)
- Why it matters: cited by later work as using a 10-second session-separation threshold.
- Rung / rule: **UNDETERMINED.** The accessible abstract did not expose the raw data level or complete boundary algorithm.
- Threshold provenance: 10 seconds is reported second-hand by Zhu et al.; primary verification remains required.
- Quote/location: no primary full-text quotation retained.
- Availability/access: abstract/metadata only in this search; ACM full text was inaccessible.

### A10. Jones et al. (2015), *Revisitation Analysis of Smartphone App Use*

- Citation: [DOI 10.1145/2750858.2807542](https://doi.org/10.1145/2750858.2807542)
- Why it matters: AWARE-based usage research that distinguishes app launches from device-use sessions.
- Rung / rule: **2–3 / DECLARED for device sessions, ABSENT for app episodes.** Sessions lie between unlock and lock; applications are launch records rather than reconstructed durations.
- Threshold provenance: a 30-second pop-up suppression threshold is justified by prior notification-interruption work, not learned from these logs.
- Quote/location: accepted-manuscript methods.
- Availability/access: accepted manuscript available; AWARE source is separate.

### A11. Stachl et al. (2020), *Predicting personality from patterns of behavior collected with smartphones*

- Citation: [DOI 10.1073/pnas.1920484117](https://doi.org/10.1073/pnas.1920484117)
- Why it matters: influential PhoneStudy analysis using app-use duration features; exposes a reproducibility boundary.
- Rung / rule: **3 / ABSENT.** Feature extraction is not operationally specified as raw event reconstruction.
- Threshold provenance: not recoverable for app episodes.
- Quote/location: data statement says reproducibility covers analyses “but not preprocessing and variable extraction.”
- Availability/access: full article and analysis artifacts available; raw files and preprocessing pipeline are unavailable.

### A12. Schoedel et al. (2022), *Systematic Categorisation of 3,091 Smartphone Applications From a Large-Scale Smartphone Sensing Dataset*

- Citation: [DOI 10.5334/jopd.59](https://doi.org/10.5334/jopd.59)
- Why it matters: documents Android app categorization and exclusion of system packages, an adjacent preprocessing choice.
- Rung / rule: **3 / ABSENT for event-to-episode reconstruction.** The contribution operates on app-use features rather than disclosing lifecycle-event pairing.
- Threshold provenance: not applicable to episode creation.
- Quote/location: preprocessing and package-categorization sections.
- Availability/access: full open article and supporting material available.

### A13. Kristensen et al. (2022), *Criterion Validity of a Research-Based Application for Tracking Screen Time on Android and iOS Smartphones and Tablets*

- Citation: [DOI 10.1016/j.chbr.2021.100164](https://doi.org/10.1016/j.chbr.2021.100164)
- Why it matters: validation evidence for an Android measurement tool (reported bias about −0.8 min/day and correlation .99).
- Rung / rule: **UNDETERMINED.** The accessible record did not expose DeviceTracker's event-to-episode rule.
- Threshold provenance: not recoverable.
- Quote/location: abstract only; no rule quotation retained.
- Availability/access: abstract/metadata accessible; full methods were not mechanically retrievable.

### A14. Andrews et al. (2015), *Beyond self-report: Tools to compare estimated and real-world smartphone use*

- Citation: [DOI 10.1371/journal.pone.0139004](https://doi.org/10.1371/journal.pone.0139004)
- Why it matters: source of a durable device-use and “phone checking” threshold lineage.
- Rung / rule: **2 / DECLARED.** Activity Logger reconstructs use from screen-on/screen-off events; very short episodes define checks.
- Threshold provenance: 15 seconds operationalizes a check; later papers inherit it. The work also underlies later long-session plausibility cutoffs.
- Quote/location: measures/method section.
- Availability/access: full PLOS article available; logger artifact availability should be verified separately.

### A15. Wilcockson et al. (2018), *Determining Typical Smartphone Usage: What Data Do We Need?*

- Citation: [DOI 10.1089/cyber.2017.0652](https://doi.org/10.1089/cyber.2017.0652)
- Why it matters: propagates the 15-second “check” definition in objective smartphone-use research.
- Rung / rule: **2 / DECLARED.** Device-use episodes come from screen-state telemetry; checks are uses under 15 seconds.
- Threshold provenance: inherited from Andrews et al. rather than independently validated here.
- Quote/location: accepted-manuscript measures section: “uses lasting less than 15 seconds.”
- Availability/access: accepted manuscript available.

### A16. Shaw et al. (2020), *Quantifying Smartphone “Use”: Choice of Measurement Impacts Relationships Between “Usage” and Health*

- Citation: [DOI 10.1037/tmb0000022](https://doi.org/10.1037/tmb0000022)
- Why it matters: another Activity Logger lineage paper; helps separate measurement from later classification choices.
- Rung / rule: **2 / DECLARED for device episodes.** Screen on/off defines use; the authors discuss but do not make the 15-second check split central to their reported measure.
- Threshold provenance: historical threshold attributed to prior Activity Logger work.
- Quote/location: accepted-manuscript method section.
- Availability/access: accepted manuscript accessible.

### A17. Tkaczyk et al. (2024), *(In)accuracy and convergent validity of daily end-of-day and single-time self-reports of smartphone use*

- Citation: [Zenodo record/search](https://zenodo.org/search?q=%22Inaccuracy%20and%20convergent%20validity%22%20smartphone)
- Why it matters: contemporary validation paper retaining the inherited “check” duration rule.
- Rung / rule: **2 / DECLARED.** Objective device-use episodes support counts/durations; a phone check is at most 15 seconds.
- Threshold provenance: explicitly inherited from Andrews and Wilcockson.
- Quote/location: objective-measure methods.
- Availability/access: full manuscript located via Zenodo; DOI metadata should be normalized before bibliography import.

### A18. Pan et al. (2019), *Temporal Stability of Smartphone Use Data: Determining Fundamental Time Unit and Independent Cycle*

- Citation: [DOI 10.2196/12171](https://doi.org/10.2196/12171)
- Why it matters: explicit screen-state episode definition plus a notification-context boundary.
- Rung / rule: **2 / DECLARED.** A use episode runs from screen-on to the successive screen-off.
- Threshold provenance: “proactive” use means no notification in the preceding one minute; the minute threshold is conceptual, not an episode-gap threshold.
- Quote/location: methods: “screen-on event to the successive screen-off event.”
- Availability/access: full JMIR article available; authors note screen state cannot perfectly represent use.

### A19. Yuan et al. (2019), *How Much Do Parents Actually Use Their Smartphones? Pilot Study Comparing Self-Report to Passive Sensing*

- Citation: [DOI 10.1038/s41390-019-0452-2](https://doi.org/10.1038/s41390-019-0452-2)
- Why it matters: illustrates high-frequency polling as an alternative to lifecycle-event reconstruction.
- Rung / rule: **3–4 / DELEGATED.** Minuku polls `UsageStatsManager` every five seconds for screen status, foreground app, and last-use time; interval formation is not fully specified.
- Threshold provenance: five seconds is the sampling interval, not a validated episode boundary.
- Quote/location: digital-phenotyping methods.
- Availability/access: full PMC article; reconstruction code/data were not confirmed reusable.

### A20. Perez et al. (2022), *The Family Level Assessment of Screen Use–Mobile Approach: Development of an Approach to Measure Children’s Mobile Device Use*

- Citation: [DOI 10.2196/40452](https://doi.org/10.2196/40452)
- Why it matters: instrument paper that logs foreground/background entries and uses user-present signals for child attribution.
- Rung / rule: **4 / DELEGATED.** `UsageStats` event entries are collected, but exact pairing, collisions, orphans, and censoring logic are not completely specified.
- Threshold provenance: no event-gap rule located.
- Quote/location: technical description reports logging each app moved to foreground or background.
- Availability/access: full JMIR/PMC article; app/source availability described in the paper.

### A21. Ahmed & Ahmed (2023), *A Fast and Minimal System to Identify Depression Using Smartphones: Explainable Machine Learning–Based Approach*

- Citation: [DOI 10.2196/28848](https://doi.org/10.2196/28848)
- Why it matters: explicit Android raw-event aggregation and session-gap choice.
- Rung / rule: **4 / DECLARED for higher-level sessions.** It retrieves seven days of foreground/background events and groups app use when the gap to the next app is no more than 45 seconds.
- Threshold provenance: 45 seconds is justified by van Berkel et al.; durations are then labeled micro (≤15s), review (15–60s), and engage (>60s).
- Quote/location: methods: “no more than a 45-second gap.”
- Availability/access: full JMIR article; app artifact availability requires separate confirmation.

### A22. Hintze et al. (2017), *A large-scale, long-term analysis of mobile device usage characteristics*

- Citation: [DOI 10.1145/3090078](https://doi.org/10.1145/3090078)
- Why it matters: publishes a state machine showing why screen-power changes alone misidentify direct-interaction sessions.
- Rung / rule: **4 source telemetry; 2 device sessions / DECLARED.** State transitions combine screen, keyguard, calls, and shutdown.
- Threshold provenance: structural state machine, not a fixed inactivity threshold.
- Quote/location: session model/Figure 3; 12.7% of screen-power changes were call-related and not genuine boundaries.
- Availability/access: author full text accessible; algorithm and evaluation are disclosed.

### A23. Friedrichs, Turner & Allen (2021), *Discovering Types of Smartphone Usage Sessions from User-App Interactions*

- Citation: [DOI 10.1109/PerComWorkshops51409.2021.9431034](https://doi.org/10.1109/PerComWorkshops51409.2021.9431034)
- Why it matters: alternative physical-interaction telemetry and session dataset for validating inferred use.
- Rung / rule: **3–4 / UNDETERMINED.** The dataset is relevant, but this search did not extract a defensible complete boundary rule from the full author copy.
- Threshold provenance: UNDETERMINED.
- Quote/location: no rule quotation retained.
- Availability/access: author PDF and dataset description accessible via ORCA/IEEE metadata.

### A24. Choi et al. (2017), *Smartphone Dependence Classification Using Tensor Factorization*

- Citation: [DOI 10.1371/journal.pone.0177629](https://doi.org/10.1371/journal.pone.0177629)
- Why it matters: explicitly combines `UsageEvents`, `AppOps`, and `UsageStats` APIs in an Android behavioral study.
- Rung / rule: **4 / UNDETERMINED.** The full PLOS record is accessible, but a complete event-to-duration rule was not extracted during this pass.
- Threshold provenance: UNDETERMINED for episodes.
- Quote/location: Android data-collection methods; no reconstruction quotation retained.
- Availability/access: full open article.

### A25. Li et al. (2022), *Smartphone App Usage Analysis: Datasets, Methods, and Applications*

- Citation: [DOI 10.1109/COMST.2022.3163176](https://doi.org/10.1109/COMST.2022.3163176)
- Why it matters: broad dataset/methods map useful for countering venue or group hyperfocus.
- Rung / rule: **N/A / ABSENT.** No canonical Android lifecycle-event reconstruction recipe was located.
- Threshold provenance: not applicable.
- Quote/location: taxonomy and dataset tables.
- Availability/access: author manuscript accessible through the University of Helsinki repository.

### A26. Alexander et al. (2024), *Passively Sensing Smartphone Use in Teens with Rates of Use by Sex and Across Operating Systems*

- Citation: [DOI 10.1038/s41598-024-68467-8](https://doi.org/10.1038/s41598-024-68467-8)
- Why it matters: tests cross-platform harmonization; reported agreement between two passive measures is only moderate (approximately r=.33).
- Rung / rule: **3–4 / DELEGATED.** Android app-use reconstruction is supplied by EARS rather than specified as a general raw-event algorithm.
- Threshold provenance: not recoverable for Android episodes.
- Quote/location: sensing and harmonization methods.
- Availability/access: full PMC article; underlying platform pipeline is not fully rerunnable from the article.

### A27. Ferreira, Kostakos & Dey (2015), *AWARE: Mobile context instrumentation framework*

- Citation: [DOI 10.3389/fict.2015.00006](https://doi.org/10.3389/fict.2015.00006)
- Why it matters: foundational open instrumentation framework used by multiple Android behavior studies.
- Rung / rule: **3–4 collection / ABSENT as a universal reconstruction method.** AWARE records app and device events; downstream studies define their own sessions/features.
- Threshold provenance: not applicable at framework level.
- Quote/location: sensor/plugin architecture sections.
- Availability/access: full open article and source code available.

### A28. Deng et al. (2019), *Measuring Smartphone Usage and Task Switching with Log Tracking and Self-Reports*

- Citation: [DOI 10.1177/2050157918761491](https://doi.org/10.1177/2050157918761491)
- Why it matters: app-switching work is directly adjacent to consecutive-event reconstruction.
- Rung / rule: **UNDETERMINED.** Accessible search records did not expose whether intervals were vendor supplied or reconstructed from raw lifecycle events.
- Threshold provenance: UNDETERMINED.
- Quote/location: no full-text rule quotation retained.
- Availability/access: metadata/abstract located; full-method verification remains open.

### A29. Marin-Dragu et al. (2023), *Associations of Active and Passive Smartphone Use with Measures of Youth Mental Health During the COVID-19 Pandemic*

- Citation: [DOI 10.1016/j.psychres.2023.115298](https://doi.org/10.1016/j.psychres.2023.115298)
- Why it matters: contemporary clinical deployment of objective screen-time/unlock features.
- Rung / rule: **2 / UNDETERMINED.** Screen time and unlock counts are described, but this search did not recover the complete state-transition algorithm.
- Threshold provenance: no relevant app-episode threshold located.
- Quote/location: mobile-sensing methods.
- Availability/access: full PMC article available.

### A30. Jagesar et al. (2021), *Requirements and Operational Guidelines for Secure and Sustainable Digital Phenotyping: Design and Development Study*

- Citation: [DOI 10.2196/20996](https://doi.org/10.2196/20996)
- Why it matters: reusable sensing platform that supplies app-use features to later studies.
- Rung / rule: **3 / DELEGATED.** The platform reports app use, but raw lifecycle-event pairing and edge-case policy are not fully described.
- Threshold provenance: not recoverable.
- Quote/location: platform architecture and feature tables.
- Availability/access: full JMIR/PMC article; source/data access is governed by the platform.

### A31. Aalbers et al. (2026), *Using Smartphone-Tracked Behavioral Markers to Recognize Depression and Anxiety Symptoms: Cross-Sectional Digital Phenotyping Study*

- Citation: [DOI 10.2196/80765](https://doi.org/10.2196/80765)
- Why it matters: current BEHAPP application describing foreground app open/close logs and derived phone-use features.
- Rung / rule: **3 / DELEGATED.** Raw foreground app records are named, but collision/orphan/boundary reconstruction is not specified.
- Threshold provenance: not stated.
- Quote/location: methods describe logs “when the user opened and closed an app.”
- Availability/access: full JMIR article available.

### A32. Terzimehić et al. (2023), *A mixed-method exploration into the mobile phone rabbit hole*

- Citation: [DOI 10.1145/3604241](https://doi.org/10.1145/3604241)
- Why it matters: explicit logger state boundaries beyond raw screen power.
- Rung / rule: **2–3 / DECLARED.** Logging begins at `ACTION_USER_PRESENT` and ends on locked/unlocked screen-off or shutdown.
- Threshold provenance: event-defined, without a numeric inactivity gap.
- Quote/location: instrumentation subsection and event table.
- Availability/access: author full text available; implementation details are sufficiently concrete for device-session replication.

### A33. Hsu et al. (2026), *Does Longer Phone Use Always Feel Worse? Examining How Intention and Duration Shape Evaluations of Time Use*

- Citation: [DOI 10.1145/3772318.3790925](https://doi.org/10.1145/3772318.3790925)
- Why it matters: hybrid boundary algorithm using screen, screenshot similarity, and accessibility activity.
- Rung / rule: **3 / DECLARED.** A session ends at screen-off or 30 seconds of nearly identical screenshots with no accessibility events/actions; it restarts at unlock or detected activity.
- Threshold provenance: 30 seconds is an engineered inactivity rule; duration bins are 0–5, 5–30, 30–60, 60–180, 180–300, and >300 seconds.
- Quote/location: data-processing/session-boundary subsection.
- Availability/access: full author/OA paper accessible.

### A34. Schoedel, Sust, Sterner & Goretzko (2026), *From Digital Data to Psychological Insights: Making Sense of Mobile-Sensing Data through Integrative Preprocessing Pipelines*

- Citation: [DOI 10.1017/psy.2026.10083](https://doi.org/10.1017/psy.2026.10083)
- Why it matters: exceptionally close current methodology paper with explicit raw type-1 forward pairing.
- Rung / rule: **4 / DECLARED.** Smartphone sessions run from screen onset to offset; app sessions begin at a type-1 launch and end at the next app launch or screen-off.
- Threshold provenance: event-defined; cleaning occurs before session construction.
- Quote/location: preprocessing section: “from the launch… until either another application was launched or the screen was switched off.”
- Availability/access: full open article. It cites the Parry–Toth line, so it is a major citation threat but not wholly independent lineage.

### A35. Toth, Parry & Emmer (2025), *From screen time to daily rhythms: Event-log-derived patterns of smartphone use*

- Citation: [DOI 10.51685/jqd.2025.019](https://doi.org/10.51685/jqd.2025.019), [OSF DOI 10.31235/osf.io/k249t](https://doi.org/10.31235/osf.io/k249t)
- Why it matters: applies reconstructed events to temporal/rhythm measures and exposes the downstream importance of boundary decisions.
- Rung / rule: **4 / DECLARED by inheritance.** Preprocessing follows the Parry–Toth event-log workflow.
- Threshold provenance: inherited from that workflow; no independent sensitivity grid over alternative episode algorithms.
- Quote/location: data preparation and supplement.
- Availability/access: full Journal of Quantitative Description article/preprint accessible.

### A36. Christensen et al. (2016), *Direct measurements of smartphone screen-time: Relationships with demographics and sleep*

- Citation: [DOI 10.1371/journal.pone.0165331](https://doi.org/10.1371/journal.pone.0165331)
- Why it matters: early large objective screen-time measurement, useful as a device-level baseline distinct from app episodes.
- Rung / rule: **2 / DECLARED at screen-session level.** Screen-state telemetry is aggregated into use duration; app lifecycle reconstruction is not attempted.
- Threshold provenance: no app-gap threshold.
- Quote/location: objective smartphone measurement methods.
- Availability/access: full PLOS article available.

### A37. Zhao et al. (2016), *Discovering different kinds of smartphone users through their application usage behaviors*

- Citation: [DOI 10.1145/2971648.2971696](https://doi.org/10.1145/2971648.2971696)
- Why it matters: broad app-usage profiling outside the psychology-methods lineage.
- Rung / rule: **1–3 / DELEGATED.** App-use summaries are analyzed, but raw event-to-episode construction is not exposed.
- Threshold provenance: not recoverable.
- Quote/location: data and feature-extraction sections.
- Availability/access: author copy/ACM metadata located.

### A38. Siebers, Beyens & Valkenburg (2023), *The Effects of Fragmented and Sticky Smartphone Use on Distraction and Task Delay*

- Citation: [DOI 10.1177/20501579231193941](https://doi.org/10.1177/20501579231193941)
- Why it matters: rare threshold sensitivity analysis, although it begins from vendor-captured app use.
- Rung / rule: **3 / DELEGATED for episodes, DECLARED for inactivity grouping.** Ethica supplies app-use records; analyses compare 0, 10, 30, 60, and 90-second inactivity thresholds.
- Threshold provenance: deliberately multiverse/sensitivity based rather than asserted as one truth.
- Quote/location: operationalization and robustness sections.
- Availability/access: full accepted manuscript available.

### A39. Langener et al. (2024), *It’s All About Timing: Exploring Different Temporal Resolutions for Analyzing Digital-Phenotyping Data*

- Citation: [DOI 10.1177/25152459231202677](https://doi.org/10.1177/25152459231202677)
- Why it matters: large analytic multiverse showing extensive downstream choices while leaving lower-level reconstruction fixed.
- Rung / rule: **3 / DELEGATED.** Behapp supplies app-name/minute features; raw event constants, pairing, and orphan policy are not varied.
- Threshold provenance: many analytic decisions vary, but event-to-episode thresholds are outside the multiverse.
- Quote/location: data preprocessing and multiverse specification.
- Availability/access: full open article and analysis materials available.

### A40. Winklbauer & Batinic (2026), *From Logs to Metrics: The Impact of Researcher Degrees of Freedom on Smartphone Usage Metrics*

- Citation: [DOI 10.2139/ssrn.7008242](https://doi.org/10.2139/ssrn.7008242)
- Why it matters: strongest downstream multiverse threat and a clear boundary for raw-event novelty.
- Rung / rule: **3 / DELEGATED.** Wakoopa provides preprocessed app episodes; analyses vary session gaps (10, 30, 60, 300 seconds) and many filters/outcomes.
- Threshold provenance: explicitly sensitivity based, but after vendor episode formation.
- Quote/location: methods identify “preprocessed application episodes rather than raw event logs.”
- Availability/access: full SSRN preprint available; raw reconstruction cannot be rerun.

## B. Official Android and AOSP sources (8)

### B41. Android Developers, `UsageEvents.Event`

- Citation: [API reference](https://developer.android.com/reference/android/app/usage/UsageEvents.Event)
- Why it matters: authoritative semantics for foreground/background, screen, keyguard, foreground-service, startup, and shutdown constants.
- Rung / rule: **4 source semantics / no canonical episode rule.** `ACTIVITY_RESUMED` maps to foreground/onResume; paused/background and stopped/invisible are activity—not necessarily package—states.
- Threshold provenance: **N/A.** The platform defines event semantics and boundary caveats but prescribes no inactivity gap, duration cap, or scientific episode threshold.
- Boundary evidence: shutdown emits no explicit stop for every active component; the documentation says open activity between shutdown/startup must be ignored because its closing time is unknown.
- Availability/access: full public reference, last-updated marker 2026-02-26.

### B42. Android Developers, `UsageStatsManager`

- Citation: [API reference](https://developer.android.com/reference/android/app/usage/UsageStatsManager)
- Why it matters: authoritative query, aggregation, permission, and interval behavior.
- Rung / rule: **1 and 4 / ABSENT.** It exposes aggregate and event queries but does not prescribe episode pairing.
- Threshold provenance: query windows are caller-supplied; aggregate intervals may be expanded to system buckets.
- Availability/access: full public reference; requires `PACKAGE_USAGE_STATS` plus user-granted access in Settings.

### B43. Android Developers, `UsageEventsQuery`

- Citation: [API reference](https://developer.android.com/reference/android/app/usage/UsageEventsQuery)
- Why it matters: current typed query object for event retrieval, relevant to reproducible event selection.
- Rung / rule: **4 / ABSENT.** Selects raw event types/packages but provides no reconstruction semantics.
- Threshold provenance: caller chooses inclusive time bounds and event filters.
- Availability/access: full public reference.

### B44. Android Developers, `UsageEventsQuery.Builder`

- Citation: [API reference](https://developer.android.com/reference/android/app/usage/UsageEventsQuery.Builder)
- Why it matters: API 35 adds explicit event-type filtering; empty type arrays mean all types.
- Rung / rule: **4 / ABSENT.** The platform encourages supplying the desired event-type list but does not identify a scientifically correct list.
- Threshold provenance: not applicable.
- Availability/access: full public reference, including package/event filtering behavior.

### B45. Android API level 29 diff for `UsageEvents.Event`

- Citation: [API diff](https://developer.android.com/sdk/api_diff/29/changes/android.app.usage.UsageEvents.Event)
- Why it matters: dates the addition of activity resumed/paused/stopped, device startup/shutdown, and foreground-service constants and the deprecation of older move constants.
- Rung / rule: **4 / ABSENT.** It demonstrates platform-version drift that a preprocessing method must disclose.
- Threshold provenance: not applicable.
- Availability/access: full official API diff.

### B46. AOSP, `UsageEvents.java`

- Citation: [AOSP source](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/usage/UsageEvents.java)
- Why it matters: exposes public and hidden/internal event constants and their source-level comments.
- Rung / rule: **4 / ABSENT.** Hidden `END_OF_DAY` is treated like pause; `CONTINUE_PREVIOUS_DAY` like resume, creating semantic cases omitted by many published type lists.
- Threshold provenance: source-state semantics, not numeric thresholds.
- Availability/access: full versioned source; researchers should pin a commit, not only `main`.

### B47. AOSP, `UserUsageStatsService.java`

- Citation: [AOSP source](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/usage/java/com/android/server/usage/UserUsageStatsService.java)
- Why it matters: shows rollover/synthetic events and acknowledges malformed sequences.
- Rung / rule: **4 / platform internals.** Daily rollover creates end/continue events; historical source includes a TODO to recover from incorrect sequences such as double background events.
- Threshold provenance: system bucket/rollover behavior, not an analytic session threshold.
- Availability/access: full source; commit pinning required for exact-version claims.

### B48. AOSP, `UsageStatsService.java`

- Citation: [AOSP source](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/usage/java/com/android/server/usage/UsageStatsService.java)
- Why it matters: caller privileges affect what events/identifiers are visible.
- Rung / rule: **4 / platform filtering.** Instant-app identifiers are obfuscated and shortcut/locus/notification events may be hidden without privileges.
- Threshold provenance: not applicable.
- Availability/access: full source; behavior is Android-version dependent.

## C. Executable software and tutorials (10)

### C49. ActivityWatch, `aw-android`

- Citation: [GitHub repository](https://github.com/ActivityWatch/aw-android)
- Why it matters: strongest independent, executable app-episode state machine located.
- Rung / rule: **4 / DECLARED IN CODE.** `SessionParser.kt` keeps one foreground app, closes it on its own pause or another app's resume, ignores stale foreign pauses, preserves earliest start on same-app resume, and drops trailing open sessions.
- Threshold provenance: emitted sessions must exceed one second and remain below four hours; code comments—not external validation—claim close agreement with Digital Wellbeing.
- Availability/access: MPL-2.0 source, active in 2026; fully inspectable/rerunnable.

### C50. Olauncher, usage-event wrapper

- Citation: [GitHub repository](https://github.com/tanujnotes/Olauncher)
- Why it matters: production launcher implementing explicit unmatched-close and shutdown logic.
- Rung / rule: **4 / DECLARED IN CODE.** `EventLogWrapper.kt` uses resumed plus paused/stopped/end-of-day events; `UnmatchedCloseEventGuardian.kt` scans 24 hours backward and shutdown closes an open component.
- Threshold provenance: 24 hours is a repair lookback, not a behavioral session threshold.
- Availability/access: GPL-3.0 source, active in 2026.

### C51. DetoxDroid

- Citation: [GitHub repository](https://github.com/flxapps/DetoxDroid)
- Why it matters: independent digital-wellbeing implementation using raw usage events and higher-level grouping.
- Rung / rule: **4 / DECLARED IN CODE.** Raw sessions begin at resume and close at matching pause or the next resume; a trailing open session closes at query end.
- Threshold provenance: same-package phases separated by no more than five minutes are grouped.
- Availability/access: GPL-3.0 source; code can be rerun and compared.

### C52. Usage Logger Published

- Citation: [GitHub repository](https://github.com/davidaellis/UsageLoggerPublished)
- Why it matters: executable companion to Geyer et al.; a direct alternative implementation rather than only prose.
- Rung / rule: **4 / DECLARED IN CODE.** R scripts compute each retained event's duration to the next row and then aggregate.
- Threshold provenance: `tooLong=60*60*2` removes intervals over two hours.
- Availability/access: Apache-2.0 source, last substantive update visible in 2024.

### C53. PsychValidator

- Citation: [GitHub repository](https://github.com/kris-geyer/psychvalidaitor)
- Why it matters: tool for validating Android event collection around Usage Logger.
- Rung / rule: **4 collection validation / ABSENT for a general episode algorithm.** Useful for event-presence tests, not a complete reconstruction method.
- Threshold provenance: not applicable.
- Availability/access: public source; no clear license located and development appears inactive.

### C54. Chronicle Android collector

- Citation: [GitHub repository](https://github.com/methodic-labs/chronicle)
- Why it matters: preserves a broad raw Android event stream with timestamps/time-zone context, enabling downstream method comparison.
- Rung / rule: **4 / N/A at collector level.** Collection occurs periodically and retains event constants; it deliberately does not impose an episode algorithm.
- Threshold provenance: the polling cadence is collection infrastructure, not a behavioral boundary.
- Availability/access: GPL-3.0 source, active in 2026; downstream reconstruction is rerunnable from exported raw data.

### C55. MART

- Citation: [GitHub repository](https://github.com/tothrol/MART)
- Why it matters: source artifact for Toth's sensing app and the Parry–Toth lineage.
- Rung / rule: **4 collection / UNDETERMINED.** Sample events and collection code are public, but a complete standalone reconstruction implementation was not located in the repository pass.
- Threshold provenance: not recoverable from repository evidence inspected.
- Availability/access: public source; no license was clearly declared.

### C56. App Manager

- Citation: [GitHub repository](https://github.com/MuntashirAkon/AppManager)
- Why it matters: mature Android tool exposing usage information and illustrating reliance on OS aggregates.
- Rung / rule: **1 / DELEGATED.** Usage displays are derived principally from `UsageStats` aggregates rather than a documented scientific raw-event episode state machine.
- Threshold provenance: platform aggregation/buckets.
- Availability/access: public source; exact license and version should be pinned when cited.

### C57. GESIS Android App Logging Data tutorial

- Citation: [GitHub repository](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data)
- Why it matters: pedagogical uptake of Android app-log processing outside the originating articles.
- Rung / rule: **4 / UNDETERMINED.** Repository structure and documentation were located, but the exact independent-versus-inherited reconstruction rule requires a deeper tutorial audit.
- Threshold provenance: UNDETERMINED.
- Availability/access: MIT-licensed public repository, active in 2025–2026.

### C58. Android Usagestats Parser

- Citation: [GitHub repository](https://github.com/dgreen85/Android-Usagestats-Parser)
- Why it matters: parses Digital Wellbeing/ADB outputs and represents the vendor-aggregate alternative to raw lifecycle events.
- Rung / rule: **1 / DELEGATED.** It parses already produced usage statistics; it does not reconstruct episodes from `UsageEvents`.
- Threshold provenance: inherits Digital Wellbeing's undisclosed logic.
- Availability/access: MIT-licensed public repository, active in 2026.

## D. Package-registry ecosystem (6)

### D59. Dart/Flutter `usage_stats`

- Citation: [pub.dev package](https://pub.dev/packages/usage_stats), [source](https://github.com/Parassharmaa/usage_stats)
- Why it matters: widely reusable Flutter wrapper for Android usage events/aggregates.
- Rung / rule: **1 and 4 access / ABSENT.** It exposes OS data but does not define a canonical episode algorithm.
- Threshold provenance: caller supplied.
- Availability/access: public package/source; version 2.0.1 was current in the registry pass (2026-06-06 publish date).

### D60. Dart/Flutter `android_usage_stats`

- Citation: [pub.dev package](https://pub.dev/packages/android_usage_stats)
- Why it matters: independent wrapper and evidence that application authors repeatedly face the same lower-level API.
- Rung / rule: **1/4 access / ABSENT.** No scientific event-to-episode policy is part of the package contract.
- Threshold provenance: caller supplied.
- Availability/access: public package, version 1.0.0 in the 2024 registry record.

### D61. Dart/Flutter `usage_stats_new`

- Citation: [pub.dev package](https://pub.dev/packages/usage_stats_new)
- Why it matters: maintained fork/variant of Flutter usage-stat access.
- Rung / rule: **1/4 access / ABSENT.** Wrapper does not resolve pairing or missing-event choices.
- Threshold provenance: caller supplied.
- Availability/access: public package/source; version 2.0.6 in the 2025 registry record.

### D62. Dart/Flutter `flutter_app_usage_kit`

- Citation: [pub.dev package](https://pub.dev/packages/flutter_app_usage_kit)
- Why it matters: recent cross-app usage wrapper showing continuing demand for usage telemetry.
- Rung / rule: **1/4 access / ABSENT.** No disclosed raw-event episode reconstruction standard.
- Threshold provenance: caller/platform supplied.
- Availability/access: public package, version 0.1.0 in the 2026-05 registry record.

### D63. Dart/Flutter `screen_time_kit`

- Citation: [pub.dev package](https://pub.dev/packages/screen_time_kit)
- Why it matters: cross-platform screen-time abstraction over Android `UsageStatsManager` and iOS APIs.
- Rung / rule: **1 / DELEGATED.** Cross-platform API returns screen-time information; Android event pairing is not specified.
- Threshold provenance: inherits OS/platform behavior.
- Availability/access: public package, version 0.1.0 in the 2026-07 registry record.

### D64. npm `expo-android-usagestats`

- Citation: [npm package](https://www.npmjs.com/package/expo-android-usagestats)
- Why it matters: React Native/Expo access path broadens the implementation ecosystem beyond native Android and Flutter.
- Rung / rule: **1/4 access / ABSENT.** The bridge exposes usage-stat functionality but supplies no canonical scientific reconstruction.
- Threshold provenance: caller supplied.
- Availability/access: public npm package; version 1.2.0 in the 2025-05 registry record.

## E. Practitioner failure reports and implementation examples (8)

Community posts are retained as evidence of recurring API failure modes and folk algorithms, not as substitutes for scholarly or official authority.

### E65. Stack Overflow, *Using UsageStatsManager to get foreground app*

- Citation: [question 38971472](https://stackoverflow.com/questions/38971472/using-usagestatsmanager-to-get-foreground-app)
- Why it matters: a narrow query can be empty when the foreground activity began before the window; suggested code progressively widens the lookback.
- Rung / rule: **4 / practitioner heuristic.** Latest foreground event is selected after widening from minutes to hours.
- Threshold provenance: query-window fallback, not behavioral validation.
- Availability/access: full public Q&A (2016 onward).

### E66. Stack Overflow, *Getting foreground app not working on Android 14*

- Citation: [question 77410929](https://stackoverflow.com/questions/77410929/getting-foreground-app-not-working-on-android-14)
- Why it matters: documents lag/missing-latest-event behavior on a specific platform release and links it to a reported bug.
- Rung / rule: **4 / failure evidence.** A “latest event” algorithm can return stale state.
- Threshold provenance: no fix threshold established.
- Availability/access: full public Q&A (2023).

### E67. Stack Overflow, *How to use `queryUsageStats`?*

- Citation: [question 68538415](https://stackoverflow.com/questions/68538415/how-to-use-queryusagestats)
- Why it matters: shows confusion caused by aggregate bucket expansion and the practical switch to `queryEvents`.
- Rung / rule: **1 versus 4 / failure evidence.** Aggregate records should not be mistaken for exact requested-window episodes.
- Threshold provenance: system interval buckets.
- Availability/access: full public Q&A (2021).

### E68. Stack Overflow, *UsageStatsManager `queryEvents` incorrect screen time*

- Citation: [question 79272579](https://stackoverflow.com/questions/79272579/usagestatsmanager-queryevents-incorrect-screen-time)
- Why it matters: recent example where naive resumed-to-paused pairing produces overlaps and overnight sessions.
- Rung / rule: **4 / failed practitioner algorithm.** Demonstrates that same-app foreground/background pairing alone is insufficient under missing or misordered events.
- Threshold provenance: no accepted corrective threshold.
- Availability/access: full public Q&A (2024); unresolved at search time.

### E69. Stack Overflow, *Android usage stats returns weird results*

- Citation: [question 53509514](https://stackoverflow.com/questions/53509514/android-usage-stats-returns-weird-results)
- Why it matters: illustrates `queryUsageStats` interval expansion and recommends manual event summing for exactness.
- Rung / rule: **1/4 / practitioner guidance.** Exactness requires events, but a robust episode state machine is still left to the caller.
- Threshold provenance: system buckets, not a behavioral threshold.
- Availability/access: full public Q&A (2018–2020).

### E70. Stack Overflow, *How to count app usage time while foreground?*

- Citation: [question 61677505](https://stackoverflow.com/questions/61677505/how-to-count-app-usage-time-while-foreground)
- Why it matters: concrete folk algorithm pairing resumed and paused events by activity/class and closing an open interval at “now.”
- Rung / rule: **4 / DECLARED IN EXAMPLE.** Different treatment of trailing open intervals than ActivityWatch, which drops them.
- Threshold provenance: query end/current time is a censoring assumption.
- Availability/access: full public Q&A (2020).

### E71. Stack Overflow, *How do I track app usage time?*

- Citation: [question 62192785](https://stackoverflow.com/questions/62192785/how-do-i-track-app-usage-time)
- Why it matters: reports overlapping/wrong aggregate results and a move from `UsageStats` to `UsageEvents`.
- Rung / rule: **1→4 / practitioner evidence.** Again exposes the absence of a platform-provided episode answer after switching APIs.
- Threshold provenance: no validated threshold.
- Availability/access: full public Q&A (2020).

### E72. Stack Overflow, *How long are `UsageEvents` retained?*

- Citation: [question 79807878](https://stackoverflow.com/questions/79807878/how-long-are-usageevents-retained)
- Why it matters: recent unanswered request for an official retention guarantee, raising reproducibility/OEM-window risk.
- Rung / rule: **4 / expected absence.** No authoritative cross-device retention duration was established in the thread or official references searched.
- Threshold provenance: not applicable.
- Availability/access: full public Q&A (2025); unanswered at search time.

## F. High-value supplementary sources (13)

These sources were added after a final primary-source reconciliation because they materially sharpen the threat ranking or supply a distinct implementation lineage.

### F73. AOSP, `UsageStats.java` — `update()` / `updateActivity()`

- Citation: [AOSP source](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/usage/UsageStats.java)
- Why it matters: Google's own inspectable event-to-duration algorithm underlying `getTotalTimeInForeground()` and `getTotalTimeVisible()`.
- Rung / rule: **4→1 / DECLARED IN SOURCE.** State is keyed by activity `instanceId`; time is accrued on the next event according to the previous state; stop/destroy deletes instance state; end-of-day and shutdown close active state.
- Threshold provenance: none. Out-of-order events add zero because increments require a later timestamp.
- Availability/access: full Apache-2.0 AOSP source. This is a separate citable artifact from `UsageEvents.java`.

### F74. usageDirect, *Event log wrapper scenarios*

- Citation: [Codeberg repository/wiki root](https://codeberg.org/fynngodau/usageDirect)
- Why it matters: the most complete named public taxonomy located for duplicate opens/closes, shutdown/startup, unmatched events, query-boundary censoring, data loss, and time-zone switches.
- Rung / rule: **4 / DECLARED.** Rules are applied top-to-bottom; duplicate close drops the second, duplicate open drops the first, shutdown closes opens, startup drops prior opens, and orphan recovery searches a preceding 24-hour window.
- Threshold provenance: the 24-hour value is a repair lookback; there is no inactivity-session threshold.
- Availability/access: public implementation and dated wiki (2021); F-Droid app lineage, fully inspectable.

### F75. Stack Overflow, *Android: UsageStatsManager not returning correct daily results*

- Citation: [question 36238481](https://stackoverflow.com/questions/36238481/android-usagestatsmanager-not-returning-correct-daily-results)
- Why it matters: highly copied foreground/background pairing example and direct evidence of the folk algorithm's malformed/missing-event failures.
- Rung / rule: **4 / DECLARED IN CODE.** Filters move-to-foreground/background, then adds duration only for matching class foreground→background neighbors.
- Threshold provenance: no gap threshold; same-class adjacency is the structural assumption.
- Availability/access: full public Q&A, question 2016 and top implementation answer 2017.

### F76. van Berkel et al. (2016), *A Systematic Assessment of Smartphone Usage Gaps*

- Citation: [DOI 10.1145/2858036.2858348](https://doi.org/10.1145/2858036.2858348)
- Why it matters: core threshold-provenance paper comparing inherited constants to participant-labelled continuity.
- Rung / rule: **3 source; device-session analysis / DECLARED.** Starts from uninterrupted sessions and tests whether short standby gaps should merge them; app boundaries remain unstated.
- Threshold provenance: 45 seconds maximized a constant classifier at only 68% accuracy. The authors caution it is not generalizable; at 30 seconds, only 30.37% of true continuous sessions were captured and 50.85% of shorter gaps were actually new sessions.
- Availability/access: full author-hosted paper; no data/code release located.

### F77. Karas et al. (2024), *Smartphone Screen Time Characteristics in People With Suicidal Thoughts*

- Citation: [DOI 10.2196/57439](https://doi.org/10.2196/57439), [code](https://github.com/onnela-lab/stb-beiwe-screen-time)
- Why it matters: strongest device-level citation threat—declares raw phone-state preprocessing, publishes code, and quantifies large effects of a cap choice.
- Rung / rule: **2 / DECLARED.** Android bouts use consecutive screen-on/screen-off events; missing logs are imputed, notification-related bouts removed, and long bouts capped.
- Threshold provenance: 30-minute cap, about the 97th percentile; authors explicitly say no definitive reason selects 30 minutes. Six-hour and uncapped comparators changed daily estimates by roughly 106 and 134 minutes on average.
- Availability/access: full PMC article and BSD-3-Clause R code; clinical raw data unavailable.

### F78. Kang et al. (2023), *K-EmoPhone: A Mobile and Wearable Dataset with In-Situ Emotion, Stress, and Attention Labels*

- Citation: [DOI 10.1038/s41597-023-02248-2](https://doi.org/10.1038/s41597-023-02248-2), [dataset DOI](https://doi.org/10.5281/zenodo.7606611)
- Why it matters: public rung-4 dataset naming multiple Android event constants while specifying no event-to-episode rule.
- Rung / rule: **4 / ABSENT.** Includes foreground/background, user-interaction, screen, keyguard, configuration, and shortcut events.
- Threshold provenance: absent.
- Availability/access: full PMC data descriptor; CC-BY-4.0 event data and collection artifacts available, suitable for independent method comparison.

### F79. Wade et al. (2021), *Passive Sensing of Preteens’ Smartphone Use: An ABCD Cohort Substudy*

- Citation: [DOI 10.2196/29426](https://doi.org/10.2196/29426)
- Why it matters: prominent cohort deployment of EARS whose duration rule is not disclosed.
- Rung / rule: **3 polling / ABSENT.** EARS scrapes screen state and foreground app every few minutes; app-use interval formation is unstated.
- Threshold provenance: polling cadence is not a declared behavioral boundary.
- Availability/access: full PMC article; data through NIMH Data Archive under a data-use agreement.

### F80. Zhao et al. (2025), *Examining Measurement Discrepancies in Adolescent Screen Media Activity with Insights from the ABCD Study*

- Citation: [DOI 10.1038/s44184-025-00131-z](https://doi.org/10.1038/s44184-025-00131-z), [analysis code](https://github.com/ZhaoCUMC/ABCD_EARS)
- Why it matters: a measurement-discrepancy paper that sums EARS foreground app times but leaves their construction unstated.
- Rung / rule: **3 / DELEGATED.** System-app time is excluded; lower-level foreground interval creation is not reported.
- Threshold provenance: absent.
- Availability/access: full PMC article; R analysis scripts public; cohort data require NDA access.

### F81. RADAR-base, `PhoneUsageManager.kt`

- Citation: [RADAR Commons Android repository](https://github.com/RADAR-base/radar-commons-android)
- Why it matters: large open digital-phenotyping platform that forwards Android events rather than constructing episodes.
- Rung / rule: **4 / DELEGATED downstream.** Maps resumed, paused, stopped, services, keyguard, interaction, screen, standby, and shortcuts into its schema; shutdown/startup and hidden rollover types can collapse to `OTHER`.
- Threshold provenance: none.
- Availability/access: full public source, active in 2026.

### F82. mobileDNA Python package

- Citation: [PyPI package](https://pypi.org/project/mobiledna/), [public source mirror](https://github.com/simonperneel/mobiledna_py)
- Why it matters: research-grade package that receives preformed vendor intervals and embeds an app-specific cleaning rule.
- Rung / rule: **3 / DELEGATED.** Requires `startTime`/`endTime`; no Android event handling. Code removes Waze events longer than 40 minutes as unreal screen time.
- Threshold provenance: 40 minutes is justified only by an inline source comment.
- Availability/access: public PyPI/source mirror; underlying mobileDNA platform and raw reconstruction are closed.

### F83. Murmuras, *Analyzing Smartphone Usage Data with R, Part 1: App Sessions*

- Citation: [Murmuras site](https://www.murmuras.com/)
- Why it matters: commercial research-platform tutorial about app sessions where `start_time`, `end_time`, and duration arrive already computed.
- Rung / rule: **1–3 / ABSENT.** No event source, boundary rule, or threshold is disclosed in the tutorial.
- Threshold provenance: absent.
- Availability/access: public tutorial text; underlying data and processing require the commercial portal. The exact tutorial URL should be normalized before bibliography import.

### F84. Church, Ferreira, Banović & Lyons (2015), *Understanding the Challenges of Mobile Phone Usage Data*

- Citation: [DOI 10.1145/2785830.2785891](https://doi.org/10.1145/2785830.2785891)
- Why it matters: AWARE-group methods paper cited by van Berkel as using a five-second gap.
- Rung / rule: **UNDETERMINED.** Primary full text was inaccessible; do not attribute the operational rule directly without reading it.
- Threshold provenance: five seconds is secondary reporting from van Berkel et al.
- Availability/access: metadata only; ACM route returned 403 and no OA copy was located.

### F85. Jung et al. (2024), *Tutorial on Matching-Based Causal Analysis of Human Behaviors Using Smartphone Sensor Data*

- Citation: [DOI 10.1145/3648356](https://doi.org/10.1145/3648356)
- Why it matters: current tutorial whose indexed text contains Android foreground-event constants; possible methodological bridge to causal analysis.
- Rung / rule: **UNDETERMINED.** Full text was not accessible through the available route.
- Threshold provenance: UNDETERMINED.
- Availability/access: metadata/indexed snippet only; publisher PDF returned 403.

## Citation-threat ranking

1. **Karas et al. (2024)** — publishes raw phone-state code and shows a single cap can move daily estimates by more than 100 minutes; device-level rather than app-level.
2. **Schoedel et al. (2026), Psychometrika** — closest recent prose contribution: raw Android cleaning plus explicit app/session construction. High threat, but it cites the Parry–Toth lineage.
3. **Parry & Toth (2025)** — closest complete primer with event selection, reconstruction, code, and worked data.
4. **usageDirect + Olauncher** — a complete public edge-case taxonomy plus running code, dated to 2021.
5. **AOSP `UsageStats.update()`** — Google's inspectable event-to-duration method underlying vendor aggregates.
6. **ActivityWatch `aw-android`** — strongest independent executable research-oriented state machine; unusually explicit on collisions, stale pauses, repeat resumes, caps, and trailing opens.
7. **van Berkel et al. (2016)** — empirical comparison of gap thresholds; the best 45-second constant reaches only 68% accuracy.
8. **Geyer et al. + Usage Logger code** — published and runnable next-row alternative with a two-hour cap.
9. **Toth & Trifonova (2021)** — early explicit rule plus empirical failure cases and a five-hour cutoff.
10. **Hintze et al. (2017)** — rigorous device-session state machine and quantitative evidence that naive screen-state transitions misclassify boundaries.
11. **Ahmed & Ahmed (2023)** — direct 45-second gap rule with literature provenance and duration categories.
12. **Hsu et al. (2026)** — modern hybrid end rule using screenshots and accessibility inactivity, showing a distinct sensing lineage.
13. **Winklbauer & Batinic (2026)** — very large downstream multiverse, but it begins from preprocessed episodes rather than raw Android events.
14. **Peng & Zhu (2020)** — personalized median-gap sessionization; strong conceptual alternative, though vendor supplies app intervals.
15. **Siebers et al. (2023)** — explicit 0/10/30/60/90-second sensitivity analysis after vendor capture.
16. **DetoxDroid** — independent production code with materially different trailing-open and grouping decisions.

## Contradictions and claim corrections

1. **The broad claim that Android studies never declare reconstruction rules is false.** Parry–Toth, Toth–Trifonova, Geyer/Usage Logger, Hintze, Ahmed, Karas, and several executable projects state materially different rules.
2. **AOSP itself contains an inspectable event-to-duration implementation.** `UsageStats.update()` is not a canonical scientific rule, but it defeats any claim that every vendor-side transform is wholly unavailable on Android.
3. **Threshold sensitivity analysis already exists.** Van Berkel compares gap thresholds, Siebers varies 0/10/30/60/90 seconds, and Karas varies long-screen-on caps; the surviving gap is the absence of a joint multiverse over event selection, pairing, orphan/collision repair, boundary censoring, and duration caps on one raw log.
4. **Open tools are real prior art, not informal noise.** ActivityWatch, usageDirect/Olauncher, Usage Logger, DetoxDroid, and MART expose executable or inspectable choices that must be cited when claiming a new formal representation.

## Cross-source synthesis

### Recurrent reconstruction families

1. **Forward to the next retained event:** Parry–Toth, Schoedel et al. 2026, and Usage Logger. The result depends critically on which event types survive filtering.
2. **Matched lifecycle state machine:** ActivityWatch, DetoxDroid, Olauncher, and practitioner examples. These disagree on competing resumes, foreign pauses, stopped events, shutdown, and trailing opens.
3. **Device-state boundaries:** Andrews, Pan, Christensen, Jones, Zhu, Hintze, and Terzimehić. These range from simple screen on/off to multi-state keyguard/call/shutdown machines.
4. **Vendor/preformed intervals:** Peng–Zhu, Stachl, BEHAPP papers, Ethica studies, Wakoopa multiverses. These cannot answer raw event-constant or orphan-policy questions.
5. **Inactivity-gap grouping:** 10 seconds second-hand in Van Canneyt, 45 seconds in Mon Majhi, personalized median gaps in Peng–Zhu, five minutes in DetoxDroid, and sensitivity grids in Siebers/Winklbauer.
6. **Hybrid contextual boundaries:** Hsu et al. use screenshot stability plus absence of accessibility action; Hintze adds calls/keyguard/shutdown.

### Threshold provenance patterns

- **Inherited tradition:** 15-second phone checks and the five-hour plausibility cutoff.
- **Cited precedent:** Mon Majhi's 45 seconds.
- **Data derived:** Peng–Zhu's per-user median inter-app interval.
- **Engineering constant:** Usage Logger's two-hour cap, ActivityWatch's one-second/four-hour bounds, DetoxDroid's five-minute grouping, Olauncher's 24-hour repair lookback.
- **Sensitivity/multiverse:** Siebers (0/10/30/60/90 seconds) and Winklbauer–Batinic (10/30/60/300 seconds).
- **Event-defined/no numeric gap:** several screen/keyguard state-machine methods and the Parry–Toth core rule.

### Availability audit

- Full text, accepted manuscript, author manuscript, or preprint was located for **at least 45 of the 52 scholarly items**. Metadata-only and incomplete records are explicitly marked `UNDETERMINED`.
- **All 9 official sources** are publicly inspectable. AOSP claims must be pinned to an Android branch/commit because `main` changes.
- **All 14 software/tutorial records** have public descriptive material; some underlying vendor pipelines remain closed. Licenses range from GPL/MPL/Apache/MIT/BSD to unclear/no declared license.
- Re-runnable raw event reconstruction is strongest for Parry–Toth materials, Usage Logger, ActivityWatch, DetoxDroid, and Olauncher. Many high-impact empirical papers release analysis code only after vendor/preprocessing features have already been formed.

## Expected absences and negative searches

- No official Android source located prescribes a canonical scientific app-duration algorithm, canonical event-type set, orphan-event policy, or acceptable maximum duration.
- No source located provides a stable official, cross-version, cross-OEM raw `UsageEvents` retention guarantee.
- CRAN searches for Android/smartphone/screen-time/usage-event reconstruction returned no relevant package.
- PyPI searches returned telemetry packages and unrelated “usage statistics” tools, but no maintained Android raw-event reconstruction library.
- npm search produced wrappers and unrelated web/app telemetry; only `expo-android-usagestats` was retained as a relevant access bridge.
- The literature contains sensitivity analyses for inactivity/session thresholds, but this pass found no full multiverse that jointly varies Android event constants, next-event versus matched-event pairing, collision/orphan policy, boundary censoring, duration caps, and downstream outcomes from the same raw log.

## Search and dead-end log

The pass combined neutral problem queries, negation/absence queries, adjacent-domain queries, and implementation searches across scholarly indexes, official source, repositories, registries, and practitioner forums. Query families included:

- `Android UsageEvents foreground background reconstruct app session duration`
- `UsageStatsManager event log preprocessing missing background event orphan`
- `Android event-to-episode algorithm ACTIVITY_RESUMED ACTIVITY_PAUSED`
- `screen time event logs session threshold sensitivity analysis`
- `smartphone app session gap threshold median inter-app interval`
- `UsageEvents DEVICE_SHUTDOWN no stop event`
- `UsageStats Android 14 missing delayed foreground event`
- GitHub code searches for `ACTIVITY_RESUMED`, `ACTIVITY_PAUSED`, `MOVE_TO_FOREGROUND`, `DEVICE_SHUTDOWN`, `SessionParser`, and duration caps
- package searches across pub.dev, npm, PyPI, and CRAN
- Stack Overflow searches for incorrect, overlapping, empty, stale, and retained usage events

Dead ends were not promoted into evidence: generic JavaScript “app usage” packages, anonymous-telemetry PyPI projects, SEO reposts, vendor marketing pages without methods, inaccessible snippets that only repeated another paper, and duplicate repository redirects. Van Canneyt's 10-second claim is retained but explicitly marked second-hand pending primary full-text verification.

## Recommended novelty wording

Avoid: “prior work does not specify Android session rules.”

Prefer: **“Existing Android usage studies and tools implement several incompatible event-to-episode rules, while many empirical papers delegate preprocessing to platforms or vendors. We found no prior evaluation that systematically crosses event selection, pairing strategy, collision/orphan handling, boundary censoring, and duration caps on the same raw Android logs and quantifies the resulting downstream instability.”**

<!-- chatgpt-pro-delta-20260805:A -->

## Independently reviewed additions — Slice A

The following five records survived DOI/title/version deduplication against the full repository corpus after an independent broad-category review.

### A86. Ahmed, Rony, Hadi, Hossain & Ahmed (2023) — *A Minimalistic Approach to Predict and Understand the Relation of App Usage with Students’ Academic Performance*

- **Stable source.** [DOI 10.1145/3604240](https://doi.org/10.1145/3604240); [OSF project](https://doi.org/10.17605/OSF.IO/923HM).
- **Why it matters here.** **Citation threat:** it names the Android API, declares the pairing arithmetic and cross-app session gap, and publishes retrieval and raw-event processing code.
- **Instrument and ladder rung.** Android `UsageStatsManager.queryEvents`, using foreground and background app events; **Rung 4**.
- **Episode reconstruction rule.** **DECLARED.** “App usage duration was calculated by subtracting the background event's time from the foreground event's time” (§4.2, “Data Preprocessing,” printed p. 7).
- **Session threshold.** **45 seconds, inactivity gap:** “no more than 45 seconds gap” (§4.2, printed pp. 7–8). The choice is inherited from van Berkel et al. (2016), after contrasting 30-, 40-, and 60-second conventions; a separate duration classifier uses ≤15 seconds for “micro,” >15–60 for “review,” and >60 for “engage.”
- **Availability.** [Retrieval code](https://osf.io/7trk4), [raw-event processing code](https://osf.io/sxjp6), and [analysis code](https://osf.io/5xy6c) are public under Apache 2.0. The builder is rerunnable on compatible events; participant raw logs are not openly deposited.
- **Access.** Full author-uploaded article, ACM metadata, and OSF source inspected; **full text**.

### A87. Ahmed, Rony, Hasan & Ahmed (2020) — *Smartphone Usage Behavior Between Depressed and Non-Depressed Students: An Exploratory Study in the Context of Bangladesh*

- **Stable source.** [DOI 10.1145/3410530.3414441](https://doi.org/10.1145/3410530.3414441).
- **Why it matters here.** A clean reporting-negative case: the study calls its measures accurate and retrieves seven days of app use but does not disclose the lower-level event source or builder.
- **Instrument and ladder rung.** Custom Android research app using a Java package to retrieve app-use data; **Rung 3** because raw platform-event semantics are not exposed.
- **Episode reconstruction rule.** **ABSENT.** The app “retrieves past 7 days’ usage data using a Java Package,” but the paper gives no event constants, pairing, missing-close handling, overlap policy, or interval construction (§3.2, printed p. 2).
- **Session threshold.** No inactivity gap, minimum-use duration, or maximum cutoff is declared.
- **Availability.** No public raw data, collector source, or event-to-episode code was located; **not independently rerunnable**.
- **Access.** Full four-page ACM workshop paper/author copy; **full text**.

### A88. Winter et al. (2026) — *Longitudinal Mental Health Data Collected via the Corona Health Smartphone App During COVID-19*

- **Stable source.** [DOI 10.1038/s41597-026-07015-7](https://doi.org/10.1038/s41597-026-07015-7); [dataset](https://doi.org/10.23728/b2share.cgf63-kme28).
- **Why it matters here.** The study says Android `UsageEvents` were converted on-device into daily screen-time, per-app-duration, and activity/inactivity measures yet omits the event-pairing rule.
- **Instrument and ladder rung.** Android `UsageEvents`, including foreground/background events, before on-device aggregation; **Rung 4 at collection**, with only derived outputs released.
- **Episode reconstruction rule.** **ABSENT.** “These raw events were aggregated on the device into daily-level metrics” (Methods, “Mobile Sensing Data”), without an opening/closing event set, missing-event policy, overlap policy, or activity/inactivity construction.
- **Session threshold.** No value is declared; “activity/inactivity intervals” are named without threshold or provenance.
- **Availability.** The B2SHARE dataset omits the raw events and on-device builder. The event→episode step is **not independently rerunnable**.
- **Access.** Scientific Data full text and repository metadata; **full text**.

### A89. Lee, Park, Koh, Lee & Lee (2025) — *Leveraging Smartphone Human Interaction Routine Behavior Task Mining and Modeling for Daily Stress Monitoring*

- **Stable source.** [DOI 10.1145/3770644](https://doi.org/10.1145/3770644).
- **Why it matters here.** It explicitly bounds within-app UI-routine mining by device-use episodes so learned patterns cannot cross a screen-off boundary.
- **Instrument and ladder rung.** Android research collector using screen on/off signals and `AccessibilityService` window/UI events; **Rung 3**, with a Rung-2 screen-state boundary.
- **Episode reconstruction rule.** **DECLARED.** The authors define “app usage sequences between screen-on and screen-off events (screen on/off session)” in the smartphone-interaction/ML-SDB/ML-SPM method description.
- **Session threshold.** No inactivity threshold; boundaries are the screen-on→screen-off events. The three-day minimum support is a routine-mining parameter, not an episode threshold.
- **Availability.** No public participant logs or collector/episode-builder repository was located; **not independently rerunnable from raw events**.
- **Access.** Institutional author PDF and ACM metadata; **full text**.

### A90. Chen et al. (2026) — *24-h Smartphone Usage Patterns in University Students Using High-Granularity Tracking*

- **Stable source.** [DOI 10.1038/s41598-026-52696-0](https://doi.org/10.1038/s41598-026-52696-0).
- **Why it matters here.** **Citation threat:** it runs a preprocessing sensitivity analysis over screen-on cutoffs and acknowledges that threshold, aggregation-window, and categorization choices can change results.
- **Instrument and ladder rung.** Customized Avicenna app with Android/iOS screen-state ON/OFF and Android app name/time; **Rung 2** for screen-time construction and **Rung 3** for app-use collection.
- **Episode reconstruction rule.** **DECLARED** for short-activation exclusion and **DELEGATED** to Avicenna for lower-level capture/pairing; the complete ON→OFF matching implementation is not published.
- **Session threshold.** **10 seconds, minimum screen-on duration/notification-exclusion cutoff:** “We adopted a 10-second threshold for excluding brief screen activations” (Methods, data processing, accepted-manuscript p. 6). Candidate values were 5, 10, 15, and 20 seconds; the choice combines cited notification-duration evidence with in-house tests.
- **Availability.** Data are available on reasonable request, but no complete open collector/builder was located; the event→episode step is **not independently rerunnable** from an open raw stream.
- **Access.** Scientific Reports accepted manuscript/reference PDF; **full text**.

## Direct-field network gap recovery — 2026-08-06

This pass intentionally excluded web analytics, clickstream, generic process mining, and analogy-only
work. It searched recent mobile-use measurement through independent child/family measurement,
digital-phenotyping, commercial metering, regulator, and open-infrastructure networks. These records
were deduplicated by title and DOI against the full repository corpus before inclusion.

### A91. Finnegan et al. (2024) — *Advancing Objective Mobile Device Use Measurement in Children Ages 6–11 Through Built-In Device Sensors: A Proof-of-Concept Study*

- **Stable source.** [DOI 10.1155/2024/5860114](https://doi.org/10.1155/2024/5860114); [full author manuscript](https://pmc.ncbi.nlm.nih.gov/articles/PMC12710754/).
- **Why it matters here.** It tackles the shared-device attribution problem that sits immediately upstream of valid child-specific episode reconstruction, but its same-session random split is sharply qualified by A92.
- **Instrument and ladder rung.** SensorLog accelerometer, gyroscope, and magnetometer data from iPads; **N/A to the event-log ladder** because this is a user-attribution layer rather than a device/app-use log.
- **Episode reconstruction rule.** **N/A.** The paper classifies the child user from motion windows; it does not construct app or device-use episodes.
- **Session threshold.** No usage-session threshold. Its analysis window is **one second**, with windows removed below one quarter of the configured sampling rate: “< 25 samples per second (100 Hz), < 5 samples per second (20 Hz)” (Methods, “Data Preprocessing and Processing”).
- **Availability.** Data are available from the authors on reasonable request. No public end-to-end analysis repository was located; the narrative specifies CSV export, one-second mean aggregation, min-max normalization, 57 features, an 80/20 split, and three-fold grid search.
- **Access.** Full author manuscript and supplements; **full text**.

### A92. Finnegan et al. (2025) — *Applying Behavioral Biometrics to Mobile Device Use Measurement in Children: Evaluating the Impact of Training Data Size, Proximity, and Type on Model Performance*

- **Stable source.** [DOI 10.1007/s41347-025-00537-8](https://doi.org/10.1007/s41347-025-00537-8); [full author manuscript](https://pmc.ncbi.nlm.nih.gov/articles/PMC12782210/).
- **Why it matters here.** **Corrective result:** the 2024 F1≈0.94 does not survive modest temporal or postural separation. SwipeFormer fell to **F1=0** when training data were 11 minutes away and to **F1=0** across sitting-versus-laying transfer, while same-posture/immediately adjacent tests remained high.
- **Instrument and ladder rung.** SensorLog accelerometer and gyroscope data from 36 children; **N/A to the event-log ladder**, but directly relevant to shared-device user attribution.
- **Episode reconstruction rule.** **N/A.** This is a biometric-classification pipeline, not an app-duration builder.
- **Session threshold.** No usage-session threshold. Processing uses nonoverlapping one-second windows. The authors choose `accelerometerTimestamp_sinceReboot` because buffering and OS delays caused duplicate readings in SensorLog's logging-time field (Methods, “Data Pre-Processing & Processing”).
- **Availability.** Data are available on reasonable request. The paper specifies CSV-to-Python processing, Scikit-learn min-max normalization, the feature set, decoy users, training/test proximity, posture, and per-user evaluation; no public end-to-end code repository was located.
- **Access.** Full author manuscript and supplementary material; **full text**.

### A93. Munzer, Miller, Weeks, Kaciroti & Radesky (2024) — *Greater Mobile Device-Prompted Phone Pickups Are Associated With Daily Parent Stress*

- **Stable source.** [DOI 10.1111/apa.17260](https://doi.org/10.1111/apa.17260); [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11239283/); [accepted manuscript](https://deepblue.lib.umich.edu/items/e5dc3ad1-e8aa-4695-acbc-2bdbe946be15).
- **Why it matters here.** It is one of the clearest Chronicle papers about raw event semantics and day completeness, while simultaneously showing that its app-duration construction is still not reported.
- **Instrument and ladder rung.** Chronicle raw Android timestamps for `screen interactive`, `notification interruption`, and app foreground/background transitions; **Rung 4**.
- **Episode reconstruction rule.** **DECLARED for pickups; ABSENT for app duration.** A pickup is a screen-interactive event. A device-initiated pickup occurs “≤ 60 seconds after receiving a notification”; otherwise it is parent-initiated (Methods, “Predictor variables”). The paper says it calculated device-usage duration but does not state foreground/background pairing, orphan-event, overlap, shutdown, or boundary rules.
- **Session threshold.** **60 seconds, notification-to-pickup attribution window**, not a usage-session gap. A separate completeness rule excludes any day with an unexplained gap greater than seven hours during typical use.
- **Availability.** No public participant data or Chronicle duration-builder code is linked. Pickup construction is rerunnable from equivalent raw events; app-duration construction is not.
- **Access.** Full open article and accepted manuscript; **full text**.

### A94. O'Connor et al. (2025) — *The Feasibility of Passively Tracking Children's TV Viewing and Mobile Device Use in Naturalistic Settings*

- **Stable source.** [DOI 10.1080/0144929X.2025.2523452](https://doi.org/10.1080/0144929X.2025.2523452); [full author manuscript](https://pmc.ncbi.nlm.nih.gov/articles/PMC12330281/).
- **Why it matters here.** This is a current, independent child-measurement network confronting shared users and Android/iPhone/iPad resolution incompatibility in one protocol.
- **Instrument and ladder rung.** Android Chronicle OS event logs (**Rung 4**); iPhone SensorKit category/duration windows and iPad Screen Time bars (**Rung 1**).
- **Episode reconstruction rule.** **DELEGATED/ABSENT.** Android is described as capturing “the exact timestamps of when an app was opened and closed,” but the paper does not state the event constants, pairing, missing-close, overlap, or boundary rules. SensorKit supplies durations inside 15-minute windows; Arcascope converts iPad hourly bars to per-app minutes.
- **Session threshold.** No sessionization threshold. Shared-Android data have a **70% daily user-identification compliance threshold**: unlock prompts identify target child versus other, and only target-child use is retained.
- **Availability.** No public raw mobile dataset or Chronicle/Arcascope transformation code is linked. The user-attribution and platform-harmonization procedure is described, but raw-event reconstruction is not independently rerunnable.
- **Access.** Full author manuscript; **full text**.

### A95. Woods et al. (2026) — *YouTube Viewing and Content Quality in Toddlers*

- **Stable source.** [DOI 10.1111/infa.70082](https://doi.org/10.1111/infa.70082); [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC13002997/).
- **Why it matters here.** It shows a 2026 Chronicle analysis reporting meaningful cleaning operations without operational thresholds, a useful contemporary reporting-negative case from the Radesky–Barr–Coyne–Kirkorian collaboration.
- **Instrument and ladder rung.** Parent Android Chronicle timestamps (**Rung 4**) or iPhone Screen Time screenshots (**Rung 1**), collected for nine days.
- **Episode reconstruction rule.** **ABSENT.** The Methods say Chronicle output was cleaned by “inspection for data gaps or long-running apps; removal of first and last partial days,” then averaged after removing apps “likely child usage.” No gap threshold, long-running definition, child-use classifier, event pairing, orphan policy, or overlap handling is supplied.
- **Session threshold.** **UNDETERMINED/unstated.** Long-running apps and gaps are inspected, but no numerical rule or cited provenance is given.
- **Availability.** No public raw data or Chronicle cleaning code is linked; not independently rerunnable.
- **Access.** Full open article; **full text**.

### A96. Ofcom & Yonder (2025, updated 2026) — *Children's Passive Online Measurement*

- **Stable source.** [Official report and methodology](https://www.ofcom.org.uk/media-use-and-attitudes/media-habits-children/childrens-passive-online-measurement); [report PDF](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/research-statistics-and-data/protecting-children/ofcom-childrens-passive-online-measurement.pdf).
- **Why it matters here.** This nationally weighted UK study provides a different shared-device attribution strategy at scale: infer and remove predominantly adult-used devices from metered child data rather than prompting the user at every unlock.
- **Instrument and ladder rung.** Proprietary RealityMine app/VPN across Android, iOS, and Windows, providing website/app visits, frequency, and time; **Rung 1/3, exact raw semantics unavailable**.
- **Episode reconstruction rule.** **DELEGATED to RealityMine.** The report does not disclose how visits and time spent are constructed. It does disclose downstream attribution cleaning: approximately 30,000 services were categorized, red/amber/green adult-likelihood flags were applied, the top 5% of red-flag users were manually reviewed, and 19 devices were removed (Methods, pp. 6–8).
- **Session threshold.** No use-session threshold. **Top 5%** is a shared/adult-device review threshold, not an inactivity gap.
- **Availability.** The underlying proprietary meter and event-to-duration transformation are not public. The sample and adult-use cleaning flow are described; the duration builder is not rerunnable.
- **Access.** Official full report; **full text**.

### A97. Zhang, Camargo, Schmaal, Kostakos & D'Alfonso (2025) — *Nomophobia, Psychopathology, and Smartphone-Inferred Behaviors in Youth With Depression: Longitudinal Study*

- **Stable source.** [DOI 10.2196/57512](https://doi.org/10.2196/57512); [full text](https://formative.jmir.org/2025/1/e57512/).
- **Why it matters here.** A recent digital-phenotyping study states a device-use episode definition exactly, but delegates the lower-level feature extraction to AWARE-Light/RAPIDS.
- **Instrument and ladder rung.** Android AWARE-Light screen status, app use, touch, communication, and location; **Rung 3**, with a Rung-2 screen-state measure.
- **Episode reconstruction rule.** **DECLARED at device level:** “A screen use episode is defined as the period from when the phone is unlocked until the screen is turned off” (Methods, Textbox 2). App-use episode construction is not stated.
- **Session threshold.** No inactivity gap or maximum-duration cutoff; event-defined unlock→screen-off boundaries. Inclusion requires screen/location data on at least 27 of 55 days, which is a participant-availability rule.
- **Availability.** AWARE and RAPIDS are public, but this paper does not link an exact configuration or participant dataset sufficient to rerun its complete feature construction.
- **Access.** Full open article and appendices; **full text**.

### A98. Sharpe, Bowen & Lambiotte (2025) — *Quantifying Digital Habits*

- **Stable source.** [DOI 10.1140/epjds/s13688-025-00581-7](https://doi.org/10.1140/epjds/s13688-025-00581-7); [full text](https://link.springer.com/article/10.1140/epjds/s13688-025-00581-7).
- **Why it matters here.** A large cutting-edge observational study defines “session” as an app foregrounding and then treats proprietary tracker output as ground truth, exposing how substantive habit claims inherit an unseen vendor construction.
- **Instrument and ladder rung.** MFour SurveysOnTheGo iOS tracking software supplying sessions and durations for 6,816 participants; **Rung 1/3**, because only proprietary derived metadata are available to the researchers.
- **Episode reconstruction rule.** **DELEGATED.** The analysis defines “Sessions: Count of app foregroundings” and “Hours: Cumulative foreground time” (Methods §3.1), but MFour's foreground event, pairing, missingness, overlap, and duration rules are not disclosed.
- **Session threshold.** None reported. “Session” is a foregrounding count rather than an inactivity-grouped device-use interval.
- **Availability.** The article states that its analysis data and code are available from the authors on reasonable request. The proprietary raw meter and event-to-duration builder are unavailable; the measurement step is not independently rerunnable.
- **Access.** Full open article and supplementary analysis materials; **full text**.

### A99. Kim et al. (2026) — *An Open-Source Platform for Multimodal Digital Trace Data Collection From Smartphones*

- **Stable source.** [DOI 10.1038/s44360-026-00072-7](https://doi.org/10.1038/s44360-026-00072-7); [official repository](https://github.com/StanfordScreenomics/Platform); [event documentation](https://github.com/StanfordScreenomics/Platform/blob/main/Ch1_Firebase/04_Events.md).
- **Why it matters here.** **Citation threat at the acquisition layer:** Stanford Screenomics publishes a current Android collector, event vocabulary, sample data, configuration, and source. It does not, however, publish a canonical event→duration algorithm.
- **Instrument and ladder rung.** Android accessibility/polling platform capturing screenshots, foreground-app changes, interactions, screen state, location, activity, power, and other signals; **Rung 3**.
- **Episode reconstruction rule.** **DECLARED for acquisition; ABSENT for derived duration.** `NewForegroundAppEvent` is recorded when the periodically checked foreground app changes. The documented recommended check interval is 1,000 ms, so its timestamp may be late by up to one second. No normative rule states how successive foreground changes and screen-off events become app durations or how missing/duplicate events are handled.
- **Session threshold.** Configurable foreground-app polling interval; recommended **one second**. This is a sampling interval, not an inactivity-session threshold.
- **Availability.** Collector/dashboard source, documentation, releases, and illustrative 24-hour text data are public under the repository's CC BY-NC 4.0 terms. Raw screenshot examples are withheld for privacy. Acquisition is rerunnable; no canonical duration builder is supplied.
- **Access.** Full Nature Health article, source, documentation, and sample-data description; **full text/source**.

### Gap-recovery result

The new records span the University of South Carolina biometric group, Michigan family-media group,
Baylor/Rice child-measurement group, Melbourne digital-phenotyping group, Oxford/MFour habit group,
Ofcom/Yonder national metering program, and Stanford Screenomics. CAFE/Chronicle is therefore one
branch rather than the organizing center. The direct-field conclusion is unchanged but better
supported: exact acquisition and some downstream definitions are increasingly published, while the
raw event→episode rule is still frequently delegated, incomplete, proprietary, or absent.

## Direct-field methods expansion — 2026-08-06

This pass continued with neutral terminology and then followed instrument and author lineages. It
excluded web analytics, browser clickstream, generic process mining, and work connected only by
analogy. Every item below measures actual phone/app use, defines or consumes phone-use episodes, or
publishes a directly relevant transformation of passive smartphone telemetry. Titles and DOIs were
deduplicated against the full local paper corpus before inclusion.

### A100. Yamanaka (2025) — *On Factors Affecting the “Smartphone Addiction”: Self-Perception of Use or Actual Log Data?*

- **Stable source.** [DOI 10.14836/ssi.13.3_1](https://doi.org/10.14836/ssi.13.3_1); [full J-STAGE PDF](https://www.jstage.jst.go.jp/article/ssi/13/3/13_1/_pdf).
- **Why it matters here.** This large Japanese Android telemetry study discloses a concrete minimum-duration cleaning rule that was absent from the previously mapped networks: it removes uses shorter than two seconds before estimating launch frequency and time of use.
- **Instrument and ladder rung.** Fuller Corporation's Android research panel records the foreground app at **one-second** intervals; 602 users contributed 153 days and 13,060,890 retained observations; **Rung 3 polling**.
- **Episode reconstruction rule.** **DECLARED for artifact filtering; DELEGATED below the sampled intervals.** App launches and duration are supplied by the vendor's one-second foreground stream. The paper removes app-use records whose launch/use duration is under two seconds as mechanical or unintended switching; it does not disclose a lifecycle-event pairing state machine.
- **Session threshold.** **Two seconds, minimum-use exclusion.** This is an explicit artifact filter, not an inactivity-gap merger.
- **Availability.** Full methods are public. No reusable raw participant data, vendor interval builder, or analysis repository was located; the lower-level event→interval step is not independently rerunnable.

### A101. Orzikulova et al. (2023) — *FinerMe: Examining App-Level and Feature-Level Interventions to Regulate Mobile Social Media Use*

- **Stable source.** [DOI 10.1145/3610065](https://doi.org/10.1145/3610065); [author PDF](https://nmsl.kaist.ac.kr/pdf/CSCW23_FinerMe.pdf); [KAIST project](https://nmsl.kaist.ac.kr/projects/finerme/).
- **Why it matters here.** It moves objective measurement inside apps: 14 Instagram and 11 YouTube features are detected from UI events, making it a direct counterexample to work that treats the package name as the finest available behavioral unit.
- **Instrument and ladder rung.** Custom Android `AccessibilityService`, triggered by scroll, click, focus, window-change, and window-state-change events and matching resource IDs, content descriptions, bounds, and text; **Rung 3 with feature-level telemetry**. The field study included 56 users over 16 days.
- **Episode reconstruction rule.** **DECLARED at a high level.** A target-app session is the current use of Instagram or YouTube and ends when the participant leaves the app, such as by returning Home. The paper exposes feature recognition and app-exit logic but not a general Android lifecycle collision/orphan policy.
- **Session threshold.** Session-duration strata are **<30 seconds**, **30 seconds to five minutes**, and **>five minutes** for intervention sampling. These are intervention categories, not evidence-derived event-pairing thresholds.
- **Availability.** Full paper and project description are public. No public collector source, raw logs, or end-to-end feature/session repository was located.

### A102. Orzikulova et al. (2024) — *Time2Stop: Adaptive and Explainable Human-AI Loop for Smartphone Overuse Intervention*

- **Stable source.** [DOI 10.1145/3613904.3642747](https://doi.org/10.1145/3613904.3642747); [author PDF](https://nmsl.kaist.ac.kr/pdf/CHI24_Time2Stop.pdf).
- **Why it matters here.** This follow-on KAIST system combines device sessions, app sessions, notifications, and fine-grained UI actions in an eight-week field experiment, demonstrating a current intervention pipeline that depends on live session recognition.
- **Instrument and ladder rung.** AWARE for screen/activity/context streams plus a custom Android `AccessibilityService` tracker for app start/end, visits, notifications, scrolls, clicks, focus, and window-state changes; **Rung 3**, with device-level screen telemetry.
- **Episode reconstruction rule.** **DECLARED for device summaries; DELEGATED for app boundaries.** Unlock frequency and duration are calculated from screen-on/off events. The custom tracker is said to identify app-session starts and ends, but its event patterns, handling of Home/system UI, missing exits, overlaps, and censoring are not stated.
- **Session threshold.** No inactivity gap, minimum app duration, or maximum cap is declared for app sessions.
- **Availability.** Full paper is public. No public raw data or exact app-session implementation was located; the lower-level rule is not independently rerunnable.

### A103. Xuan, Chowdhury, Ding & Zhao (2025) — *Unlocking Mental Health: Exploring College Students’ Well-Being Through Smartphone Behaviors*

- **Stable source.** [DOI 10.1109/MOBILESoft66462.2025.00014](https://doi.org/10.1109/MOBILESoft66462.2025.00014); [arXiv 2502.08766](https://arxiv.org/abs/2502.08766); [analysis repository](https://github.com/bill-wei-xuan/Unlocking-MentalHealth).
- **Why it matters here.** It supplies unusually explicit downstream cleaning of multi-year Android/iOS unlock summaries and makes the analysis pipeline public, while clearly revealing that the raw unlock builder remains inherited from the College Experience Study.
- **Instrument and ladder rung.** Secondary analysis of the 2017–2022 CES mobile-sensing dataset: 215 students, 213,408 daily unlock-behavior entries; **Rung 1/2 derived device-use measures**.
- **Episode reconstruction rule.** **DELEGATED.** The study uses daily unlock count and total unlock duration, then creates duration per unlock and two-week moving averages. It does not state which raw state events or censoring rules generated an unlock duration in CES.
- **Session threshold.** **16 hours, maximum daily unlock-duration exclusion.** It also removes users whose maximum unlock count or duration is zero and users with zero variance in unlock count, duration, or PHQ-4. The final dataset is 214 students and 213,360 observations.
- **Availability.** Analysis code/artifacts are public; the upstream raw collection and unlock-episode construction are not reproduced in the repository.

### A104. Van Gaeveren, Murphy, de Segovia Vicente & Vanden Abeele (online 2025; issue 2026) — *Always On, Always Rushed for Time? Exploring Momentary Associations Between Passively Sensed Smartphone Use, Feeling Rushed, and Perceived Task Juggling*

- **Stable source.** [DOI 10.1177/20501579251377010](https://doi.org/10.1177/20501579251377010); [OSF project](https://osf.io/ztxmh/).
- **Why it matters here.** **Major citation threat:** its public notebook contains a runnable sessionization function, not merely prose. It also exposes a consequential implementation detail in the category-specific fragmentation calculation.
- **Instrument and ladder rung.** mobileDNA supplies app `start`/`stop` intervals, notifications, and categories for 774 adults; **Rung 3**, because Android event→interval construction remains vendor-side.
- **Episode reconstruction rule.** **DECLARED IN CODE for interval→session grouping.** `create_session_var(..., cutoff_seconds=30)` sorts by participant and start, computes next-start minus current-stop, begins a new session only when the gap is greater than 30 seconds, cumulatively assigns session IDs, and takes the first start/last stop within each session. It does not rebuild the input intervals from raw Android lifecycle events.
- **Session threshold.** **30 seconds, inactivity gap.** Frequency counts app rows and duration sums their `duration`. Fragmentation is `n_sessions × (app_duration / ESM_window_duration)` and is set to zero below two sessions. In the released function, `n_sessions` is computed **before** applying `cat_filter`; the category-specific calls therefore combine all-app session counts with category-filtered duration unless the input was filtered earlier (it was not in the published calls). The category outputs are then filtered to fragmentation values greater than zero.
- **Availability.** All materials, code, and analysis data except raw phone data are public on OSF. The 30-second grouping and feature calculations are rerunnable; mobileDNA's event→`start`/`stop` builder is not.

### A105. de Segovia Vicente, Van Gaeveren, Murphy & Vanden Abeele (2024) — *Does Mindless Scrolling Hamper Well-Being? Combining ESM and Log-Data to Examine the Link Between Mindless Scrolling, Goal Conflict, Guilt, and Daily Well-Being*

- **Stable source.** [DOI 10.1093/jcmc/zmad056](https://doi.org/10.1093/jcmc/zmad056); [OSF project](https://osf.io/d9u6g/?view_only=50d68441c6f74d2f86241b48aa2a4923).
- **Why it matters here.** This large direct measurement study separates a behavioral duration from a self-reported state rather than equating all screen time with one construct, but its objective-duration denominator still inherits an undocumented commercial/research tracker transformation.
- **Instrument and ladder rung.** A separate Android tracking app logs screen time, app activity, and notifications; 1,315 adults completed a 14-day study and 691 Android log contributors with at least eight usable reports entered the log-linked analyses; **Rung 3**.
- **Episode reconstruction rule.** **DELEGATED.** Logged social-media time between ESM beeps is multiplied by the participant's reported percentage of mindless scrolling. The paper and released analysis scripts do not state how Android events become per-app durations.
- **Session threshold.** No app-session gap or duration cutoff is declared. The eight-report rule is an analytic inclusion requirement, not an episode boundary.
- **Availability.** Preregistration, materials, data, and analysis scripts are available on OSF. No raw Android interval builder was located, so the event→duration step remains non-rerunnable.

### A106. Aalbers, Hendrickson, Vanden Abeele & Keijsers (2023) — *Smartphone-Tracked Digital Markers of Momentary Subjective Stress in College Students: Idiographic Machine Learning Analysis*

- **Stable source.** [DOI 10.2196/37469](https://doi.org/10.2196/37469); [full JMIR article](https://mhealth.jmir.org/2023/1/e37469).
- **Why it matters here.** It operationalizes app opening frequency and duration within precisely bounded pre-report windows across more than five million app events, while providing another clear example of a current paper that leaves episode formation to the logging platform.
- **Instrument and ladder rung.** Ethica ESM plus mobileDNA app-use logs for 224 Android users, up to 60 days, 44,381 stress reports, and 5,277,494 app events; **Rung 3**.
- **Episode reconstruction rule.** **DELEGATED.** For each 60-minute window before a stress report, the study sums time and opening frequency by app category; 18 categories cover 76.68% of events. The paper does not disclose mobileDNA's raw foreground/open-close semantics.
- **Session threshold.** **60 minutes is the feature-extraction window**, not a session gap. No episode minimum, gap merger, cap, or orphan-event rule is reported.
- **Availability.** Full article and supplements are public. No participant log release or raw event→interval code was located.

### A107. Ross, Bayer, Rhee, Potti & Chang (2023) — *Tracking the Temporal Flows of Mobile Communication in Daily Life*

- **Stable source.** [DOI 10.1177/14614448231158646](https://doi.org/10.1177/14614448231158646); [author PDF](https://people.cs.nycu.edu.tw/~armuro/pubs/ross-et-al-2023-new-media-society.pdf).
- **Why it matters here.** It uses a fundamentally different direct operationalization: foreground occupancy is represented by repeated samples rather than reconstructed duration episodes. That avoids lifecycle pairing while making sampling cadence and screen-state contamination central.
- **Instrument and ladder rung.** Custom Android study app logs the foreground app **up to every 10 seconds, regardless of whether the screen is on or off**; 132 participants contributed 8,876,821 app samples and 2,193,655 social-app samples; **Rung 3 polling**.
- **Episode reconstruction rule.** **N/A by design.** App-use measures are counts/proportions of foreground observations in prespecified windows, not start/stop episodes. Forty-one participants were removed for transmission problems (32) or low ESM completion (9); self-reported top-eight apps were cross-validated against packages, with 95.6% matched.
- **Session threshold.** No session threshold. The central acquisition interval is up to ten seconds; analyses use 10- and 60-minute pre-ESM windows.
- **Availability.** The paper says de-identifiable data and scripts are on its OSF project. Participant-identifying raw content is restricted; the sampled-observation analysis is more reproducible than a hidden duration builder because it does not claim reconstructed intervals.

### A108. Macchia, Löchner, Haag, Kannen, Montag & Abler (2026) — *Smartphone-Based Digital Markers and Clinical Symptoms During Therapy for Borderline Personality Disorder*

- **Stable source.** [DOI 10.1016/j.invent.2026.100952](https://doi.org/10.1016/j.invent.2026.100952); [full Europe PMC record](https://europepmc.org/article/MED/42281829); [preregistration/materials](https://osf.io/dfq9y/?view_only=4c19b891bb6448009b22f60b2552bd73).
- **Why it matters here.** This 2026 clinical study gives unusually clear construct-level definitions for unlocked use, locked-screen interaction, and app-session frequency, yet still omits the raw algorithm that distinguishes those states.
- **Instrument and ladder rung.** Android-only `Insights` app, continuously deployed during inpatient dialectical behavior therapy; 49 patients with at least three recorded days, mean 37.63 tracked days; **Rung 2/3**.
- **Episode reconstruction rule.** **DECLARED conceptually; DELEGATED computationally.** Usage time is any interaction while unlocked, including apps, communication, system interactions, and other foreground processes. Frequency is the count of individual active app sessions. Locked-screen time includes notification/time/message/quick-access interaction while locked. Exact event constants, start/end pairing, and overlap/censoring logic are absent and referred to the `Insights` platform lineage.
- **Session threshold.** No inactivity gap or duration cap. At least three tracked days is the participant-inclusion threshold.
- **Availability.** Study data are publicly linked from the article and procedures/measures are on OSF. No collector or raw session-builder source was located; public data do not make the event→session layer rerunnable.

### A109. Burnell, Maheux, Shapiro, Flannery, Telzer & Kollins (2025) — *Smartphone Engagement During School Hours Among US Youths*

- **Stable source.** [DOI 10.1001/jamanetworkopen.2025.23991](https://doi.org/10.1001/jamanetworkopen.2025.23991); [full article](https://pmc.ncbi.nlm.nih.gov/articles/PMC12317345/).
- **Why it matters here.** This 11,382-youth commercial-meter study makes a measurement decision with large numerical consequences: every zero-use day is treated as missing rather than as observed nonuse.
- **Instrument and ladder rung.** Proprietary Aura parental-monitoring app versions 3.27.0–3.32.0, supplying active minutes and app categories; **Rung 1/3** because the source events and duration builder are unavailable.
- **Episode reconstruction rule.** **DELEGATED.** School-hour activity is total active minutes from 8:00 a.m. to 2:30 p.m. on weekdays, averaged over available days. The paper does not state operating-system-specific telemetry, foreground pairing, or idle/lock handling.
- **Session threshold.** No session gap. A day with **zero active minutes anywhere in the full 24 hours is classified as missing and excluded**. Of 798,983 available user-days, 176,491 (22%) were excluded, leaving 622,492 analyzed user-days; users needed at least two school-hour weekdays.
- **Availability.** Data remained in Aura's secure commercial environment and analyses were run there. No public records or measurement code are supplied, so the active-minute transformation is not independently auditable.

### A110. große Deters, Reiter & Schoedel (2026) — *From Swipe to Sleep: An Experience Sampling Study Using Smartphone Sensing to Examine Evening Smartphone Usage and Sleep Outcomes*

- **Stable source.** [DOI 10.1016/j.chbr.2026.101114](https://doi.org/10.1016/j.chbr.2026.101114); [full open article](https://www.sciencedirect.com/science/article/pii/S2451958826001880); [OSF data/code](https://osf.io/ys8fk/?view_only=29039f458d444f5fba981a60968b0cda).
- **Why it matters here.** **Major citation threat:** this current PhoneStudy paper declares screen-event pairing, a gap merger, false-screen filtering, time-zone repair, and an exception that extends use beyond screen-off for continuing music/podcasts, with preprocessing code.
- **Instrument and ladder rung.** Android PhoneStudy timestamped screen on/off plus media events; 401 adults and 3,442 usable nights from a 14-day ESM period; **Rung 2**, with app/media context from **Rung 3**.
- **Episode reconstruction rule.** **DECLARED.** Use is the difference between paired screen-on and screen-off events. Automatically initiated screen events are filtered. Sessions within ten seconds are merged. If music/podcasts continue after screen-off, use extends to the media event's end; media started while locked is also counted. Timestamps are adjusted by recorded time zone.
- **Session threshold.** **10 seconds, inter-session merge.** Additional preregistered exclusions include fewer than five active days in the preceding week, days with no logs or time-zone change, sleep under two or over 16 hours, and implausible bedtime/wake windows.
- **Availability.** Aggregate variables and R preprocessing/feature/analysis code are public on OSF; raw sensing data are withheld under GDPR. The transformation is specified and code-auditable, but cannot be rerun on the original raw logs.

### A111. Ross, Rhee, Le, Mount, Chang & Bayer (2025) — *Smartphone Habits Are Stronger in Spaces Chosen Out of Habit*

- **Stable source.** [DOI 10.1038/s41598-025-25174-2](https://doi.org/10.1038/s41598-025-25174-2); [full article](https://www.nature.com/articles/s41598-025-25174-2); [OSF data and code](https://osf.io/bjh2m/).
- **Why it matters here.** **Major citation threat discovered through an independent habit/mobility network:** the article reports 27,446,977 GPS/app records from 419 users and the public preprocessing HTML exposes the exact sample→session heuristic and package exclusions.
- **Instrument and ladder rung.** Custom Android app repeatedly records `ScreenStatus` and `LatestUsedApp`, linked to GPS and map questionnaires; **Rung 3 polling**.
- **Episode reconstruction rule.** **DECLARED IN CODE.** The released preprocessing retains `ScreenStatus == "Interactive"`, excludes the study app, Android/System UI, and an explicit list of launcher packages, then treats a retained record as a session end/count when the next sample gap is **at least 15 seconds** or the next foreground package differs. The last row's gap is forced to 100 seconds so it is counted. The paper summarizes a session as one or more consecutive screen-on samples with an app foregrounded.
- **Session threshold.** **15 seconds, sampled-gap boundary**, against an acquisition lineage that previously reported foreground polling up to every ten seconds. This is an engineering rule embedded in code, not a validated behavioral cutoff.
- **Availability.** Public OSF materials include deidentified derived data, analysis scripts, and HTML code said to generate them from raw data; raw data are withheld for privacy. The reconstruction can be audited and rerun on equivalent input but not on the original raw records.

### A112. Cerit et al. (2025) — *Person-Specific Analyses of Smartphone Use and Mental Health: Intensive Longitudinal Study*

- **Stable source.** [DOI 10.2196/59875](https://doi.org/10.2196/59875); [full JMIR article](https://formative.jmir.org/2025/1/e59875).
- **Why it matters here.** This year-long Screenomics study operationalizes screen time as sampled screenshots and fragmentation as screen-state sessions/app switches, showing how a high-resolution trace creates different denominators and missingness choices from event-derived minutes.
- **Instrument and ladder rung.** Custom Android Screenomics app captures a screenshot, foreground package, battery state, and metadata every **five seconds while the screen is active**; **Rung 3 polling**. Five deeply observed participants contributed 6,744,013 screenshots.
- **Episode reconstruction rule.** **DECLARED at device level; DELEGATED below that.** Sessions are intervals between screen-on and screen-off events; duration is termination minus initiation. Screen time is screenshot count converted by the five-second cadence. App switches are successive foreground-package changes. Each fortnight's measures are divided by **active collection days**, not all calendar days.
- **Session threshold.** No inactivity gap. Selection required at least 800,000 screenshots (described as about three hours/day), at least 20 biweekly surveys, and at least one clinically significant symptom period among the larger eligible group.
- **Availability.** Deidentified analysis data and code are available only on reasonable request. The current Stanford Screenomics collector is now open (A99), but this paper does not link a frozen end-to-end session-builder artifact for its historical deployment.

### A113. Guo, Fu, Lin, Xu, Chang & Hiniker (2025) — *What Social Media Use Do People Regret? An Analysis of 34K Smartphone Screenshots With Multimodal LLM*

- **Stable source.** [DOI 10.1145/3706598.3713724](https://doi.org/10.1145/3706598.3713724); [author PDF](https://faculty.washington.edu/alexisr/regret.pdf).
- **Why it matters here.** This cutting-edge CHI study connects exact screen/app-session rules to within-app activity classification from five-second screenshots and validates GPT-4o labels against human consensus, going well beyond undifferentiated screen time.
- **Instrument and ladder rung.** Custom Android `MediaProjection` collector, screen state, foreground app, ESM, and screenshots every **five seconds**; **Rung 3**. Seventeen users generated 1,631 sampled screen sessions, 3,946 app sessions, and about 183 hours of use; the final social-media set contains 664 app sessions and 34,313 screenshots.
- **Episode reconstruction rule.** **DECLARED.** A screen session is screen-on→screen-off. An app session is the interval that one app remains foreground. ESM fires only after the app remains foreground more than five seconds. Screen sessions are probabilistically sampled: probability is zero within ten minutes of the last sample and increases to 100% at 120 minutes. Screenshot activity labels use the current image plus up to four preceding images; human-consensus versus GPT-4o agreement is reported (κ=.72 overall and .74 after dropping X).
- **Session threshold.** **Five seconds, minimum foreground duration for an app-session prompt.** Ten and 120 minutes define the screen-session sampling schedule, not behavioral session gaps.
- **Availability.** Full paper and prompts/codebook appendices are public. No public participant screenshots, raw session data, or collector source was located; privacy-sensitive original reconstruction is not independently rerunnable.

### Threat-ranking amendment from this pass

1. **Ross et al. (2025), smartphone habits** should enter near the top of the existing ranking: its public preprocessing code reveals an explicit 15-second sampled-gap rule, forced trailing-row closure, and a package-level launcher/System UI exclusion list.
2. **Van Gaeveren et al. (2025/2026), Always On** is a major downstream threat: the public notebook implements a 30-second interval→session rule and makes the exact fragmentation formula auditable; it also exposes an all-session-count/category-duration ordering that is invisible in the abstract.
3. **große Deters et al. (2026), From Swipe to Sleep** is a strong device-level threat: paired screen events, ten-second merging, automatic-event filtering, time-zone repair, media continuation beyond screen-off, and R code are all disclosed.
4. **Guo et al. (2025)** and **FinerMe/Time2Stop** establish a separate feature-level lineage based on screenshot/accessibility telemetry, not package-duration summaries.
5. **Yamanaka (2025)** supplies a concrete two-second minimum-use filter, while **Burnell et al. (2025)** shows that treating zero-use days as missing can remove 22% of otherwise available user-days.

### Updated cross-network conclusion

The missed literature was not one hidden CAFE cluster. It included at least five distinct technical
families: sampled foreground occupancy (Ohio State/NYCU), accessibility/UI-feature logging (KAIST),
screen-event and media-aware reconstruction (LMU PhoneStudy), preformed-interval sessionization
(Ghent mobileDNA), and screenshot-plus-foreground traces (Stanford/UW/NYCU Screenomics lineage),
plus clinical/commercial uses of `Insights`, CES, Aura, BEHAPP, and Japanese vendor telemetry. The
strongest surviving novelty claim is therefore narrower: no located work jointly varies raw Android
event selection, matching, collision/orphan repair, query-boundary censoring, system-package policy,
and duration/gap thresholds on one open raw corpus. Several recent papers already solve meaningful
subsets of that problem and must be treated as direct prior art.

## ChatGPT Pro deep-research reconciliation — 2026-08-06

The independent deep-research return associated with run marker
`codex-pro-run:5292bc15-e8fc-4717-964d-6be96333cec3` was checked record by record
against primary articles, repositories, or the underlying artifact pages. Thirteen direct Android
records survived. Network-traffic proxies, generic passive-sensing protocols, and a steps API
analogue were not imported merely because they used adjacent event terminology. The full decision
audit is in
[`../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md`](../consolidated-literature/chatgpt-pro-deep-research-2026-08-06.md).

### A114. Zerrer, Wieland & de Alwis (2026) — *How to Work With Android App Logging Data*

- **Stable source.** [DOI 10.71627/How-to-work-with-Android-App-Logging-Data.1](https://doi.org/10.71627/How-to-work-with-Android-App-Logging-Data.1); [GESIS Methods Hub tutorial](https://methodshub.gesis.org/library/tutorials/How-to-work-with-Android-App-Logging-Data/1/); [source repository](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data).
- **Why it matters here.** **Highest-priority new direct threat:** this independent GESIS network publishes executable R code for repairing and grouping Android app-log visits, including missing/implausible closes and output provenance for how each close was assigned.
- **Instrument and ladder rung.** Event-level Android app-logging panel data with Start, Stop, and Meta event families; **Rung 3/4**.
- **Episode reconstruction rule.** **DECLARED IN CODE.** For a Start, the code searches for the nearest same-app Stop, subject to a ten-intervening-event check and a **600-second maximum timeout**. When the Stop is missing or too remote, the next global event within 600 seconds can close the visit (`activity_based`); otherwise the visit is force-closed at 600 seconds (`timeout`). The output preserves `original`, `activity_based`, or `timeout` close provenance. The tutorial also filters background apps, converts timestamps to `Europe/Berlin`, and warns that OEM event type `100` is unknown and should receive sensitivity analysis.
- **Session threshold.** A later visit→session example groups across apps with a **60-second gap**. An optional five-second minimum visit filter is shown but not used in the main construction.
- **Availability.** Tutorial, code, and example data are public and rerunnable. This is substantially stronger than a prose-only Start→Stop description.

### A115. Yang, Knights, Bangieva & Kambhampati (2023) — *Association Between the Severity of Depressive Symptoms and Human-Smartphone Interactions: Longitudinal Study*

- **Stable source.** [DOI 10.2196/42935](https://doi.org/10.2196/42935); [full JMIR article](https://formative.jmir.org/2023/1/e42935).
- **Why it matters here.** It is a direct clinical counterexample that states a device-session rule and demonstrates that within-person and between-person associations from its derived features are not interchangeable.
- **Instrument and ladder rung.** Proprietary Android Mindstrong sensing of screen, app, and typing interactions; **Rung 2/3**.
- **Episode reconstruction rule.** **DECLARED for screen sessions; delegated upstream.** A human-smartphone interaction session begins at screen-on and ends at the next screen-off. Hourly features include median session duration, app count and entropy, and midnight–6 a.m. active time; typing interkey intervals are capped at five seconds.
- **Session threshold.** No inactivity merger is reported. Midnight–6 a.m. and hourly bins are analytic windows, while five seconds is a typing-gap cap rather than a phone-session threshold.
- **Availability.** Full methods are public; collector code and raw participant traces are not.

### A116. Okoshi et al. (2025) — *Cyberoception: Finding a Painlessly Measurable New Digital Phenotype*

- **Stable source.** [DOI 10.1145/3706598.3713638](https://doi.org/10.1145/3706598.3713638); [arXiv 2504.16378](https://arxiv.org/html/2504.16378).
- **Why it matters here.** It is a current CHI system that directly exposes Android `UsageEvents` pairing and separately labels brief foreground intervals as a behavioral construct.
- **Instrument and ladder rung.** `UsageStatsManager` events plus Accessibility sensing; **Rung 3/4**.
- **Episode reconstruction rule.** **DECLARED.** Screen sessions pair `SCREEN_INTERACTIVE` with `SCREEN_NON_INTERACTIVE`; app-use intervals pair `ACTIVITY_RESUMED` with `ACTIVITY_PAUSED`. App use shorter than five seconds is labeled micro-use, and values are aggregated inside 30-minute sampling windows.
- **Session threshold.** **Five seconds, micro-use classification.** Thirty minutes is a survey/feature window, not an inactivity gap.
- **Availability.** Full paper is public; reusable participant data and reconstruction code were not located.

### A117. Ahmed et al. (2026) — *Before You Scroll Again: Predicting Regretful Social Media Sessions From In-the-Wild Contextual and Wearable Sensing*

- **Stable source.** [arXiv 2606.08965](https://arxiv.org/html/2606.08965); no publication DOI located at the cutoff.
- **Why it matters here.** This current direct study combines OS usage events, explicit app-exit detection, and wearable sensing, while finding that the intention–actual-use gap is more informative for regret than duration alone.
- **Instrument and ladder rung.** Android `UsageStatsManager` queried hourly with WorkManager; `AccessibilityService` exit detection for 12 monitored apps; Bangle.js wearable; **Rung 3/4**.
- **Episode reconstruction rule.** **PARTLY DECLARED.** App start/stop records are collected hourly; transient overlays and system packages are filtered; per-app cooldown suppresses duplicate triggers. The cooldown value, missing-exit policy, and full collision logic are not specified.
- **Session threshold.** No behavioral inactivity gap is disclosed. The watch uses a one-minute-on/four-minute-off sensing duty cycle, which is acquisition scheduling rather than sessionization.
- **Availability.** Full preprint is public. Its promised code URL remains a placeholder, so the pipeline is not yet independently rerunnable.

### A118. Meinhardt et al. (2025) — *Scrolling in the Deep: Analysing Contextual Influences on Intervention Effectiveness During Infinite Scrolling on Social Media*

- **Stable source.** [DOI 10.1145/3706598.3713187](https://doi.org/10.1145/3706598.3713187); [arXiv 2501.11814](https://arxiv.org/abs/2501.11814).
- **Why it matters here.** It defines a feature-level behavioral session inside an infinite-scroll environment rather than treating a package foreground interval as the final unit.
- **Instrument and ladder rung.** Native Android `InfiniteScape` research app and contextual sensing; **Rung 3**.
- **Episode reconstruction rule.** **DECLARED for the experimental feature.** Continuous scrolling is monitored in the app; the episode terminates when the app is closed or the participant switches to non-scrolling activity.
- **Session threshold.** **15 minutes is an intervention trigger**, not a general screen/app inactivity threshold.
- **Availability.** Paper and preprint are public; this is a feature-session system rather than a reusable Android lifecycle repair engine.

### A119. Meinhardt, Dragic, Colley, Lukoff & Rukzio (2026) — *Can't Stop: How Context and Individual Traits Influence Effectiveness of Different Gradual Interventions for Infinite Scrolling on Short-Form Video Platforms*

- **Stable source.** [DOI 10.1145/3831979](https://doi.org/10.1145/3831979); [arXiv 2607.15818](https://arxiv.org/html/2607.15818); [open code/data/R repository](https://github.com/luca-maxim/Cant_Stop).
  - *Title corrected 2026-08-07.* The ledgers previously read “…Progressively Intensifying **Haptic** Interventions Against Infinite Scrolling”; the actual title is the one above. Authors match exactly, so this is a title error, not a different work. `10.1145/3831979` is **author-declared for a forthcoming PACM IMWUT article and does not resolve today** — fine to cite, but it is not a resolvable identifier yet; the arXiv id is the working route.
- **Why it matters here.** The follow-up makes the feature-session boundary and selection mechanism clearer and releases the study artifacts.
- **Instrument and ladder rung.** Android `AccessibilityService` inspection of content hierarchies and activity changes; **Rung 3**.
- **Episode reconstruction rule.** **DECLARED.** A scrolling session is uninterrupted feed consumption until the user changes to non-scrolling activity or closes the app; active engagement is excluded from the passive-scrolling state.
- **Session threshold.** **15 minutes is both the trigger and an observation gate.** The intervention can last at most 3 minutes 31 seconds; the paper also declares its escalating haptic schedule.
- **Availability.** Preprint, app materials, study data, and R scripts are public. The construction remains feature-specific rather than a general OS-event repair policy.

### A120. Abrignoni et al. (current through 2026) — *ALEAPP Android UsageStats Parser*

- **Stable source.** [ALEAPP repository](https://github.com/abrignoni/ALEAPP); [current `usagestats.py` artifact parser](https://github.com/abrignoni/ALEAPP/blob/main/scripts/artifacts/usagestats.py).
- **Why it matters here.** The open DFIR implementation exposes source-format and interpretation traps that are easily missed when social-science papers begin from already-clean app durations.
- **Instrument and ladder rung.** Android UsageStats XML and protobuf under daily/weekly/monthly/yearly interval stores; **Rung 4 extraction**.
- **Episode reconstruction rule.** **ABSENT for episodes; declared for extraction.** The parser handles XML and protobuf v1/v2, including token obfuscation. It warns that records repeated across interval folders are not separate occurrences, that `ACTIVITY_RESUMED` or `SCREEN_INTERACTIVE` does not prove a person acted, and that timestamps are UTC.
- **Session threshold.** None; this is an event/artifact extractor.
- **Availability.** Open source. The Pro return's paired `yogesh-khatri/Android_Usagestats` repository does not exist under either proposed owner spelling and was removed rather than cited.

### A121. Bortnik & Lavrenovs (2021) — *Android Dumpsys Analysis to Indicate Driver Distraction*

- **Stable source.** [DOI 10.1007/978-3-030-68734-2_8](https://doi.org/10.1007/978-3-030-68734-2_8); [NATO CCDCOE publication and PDF](https://ccdcoe.org/library/publications/android-dumpsys-analysis-to-indicate-driver-distraction/).
- **Why it matters here.** It is an independent forensic/timeline route for reconstructing device interaction from system services rather than a research logger.
- **Instrument and ladder rung.** Android `dumpsys` outputs and system-service artifacts; **Rung 4 forensic extraction**.
- **Episode reconstruction rule.** **UNDETERMINED as a reusable builder.** The paper develops a minimum system-level online/offline interaction timeline and demonstrates it on a synthetic driver-distraction case, but does not publish a general screen/app collision-orphan policy.
- **Session threshold.** No reusable behavioral gap was located.
- **Availability.** The full paper is publicly downloadable; no general implementation or test corpus was located.

### A122. Pagano (2022) — *Turbo Speed: Parsing Device Health Services From Google*

- **Stable source.** [DOI 10.21428/b0ac9c28.245fd6c6](https://doi.org/10.21428/b0ac9c28.245fd6c6); [full DFIR Review article](https://dfir.pubpub.org/pub/4can3p40/release/1).
- **Why it matters here.** Google Device Health Services supplies another package-use artifact with preformed boundaries, and the paper documents strong version/OEM coverage limits.
- **Instrument and ladder rung.** `com.google.android.apps.turbo` `app_usage_stats.xml` and related artifacts; **Rung 4/1**.
- **Episode reconstruction rule.** **ABSENT.** The artifact exposes package names and Unix start/end timestamps; the paper parses those records but does not show how Device Health Services produced the interval.
- **Session threshold.** None disclosed.
- **Availability.** Full article is public and points to ALEAPP support. Validation covered Android 9–11, mainly Pixel and newer Samsung devices.

### A123. The Binary Hick (2020) — *Walking the Android Timeline, Part 2: Device Personalization Services*

- **Stable source.** [Full forensic write-up](https://thebinaryhick.blog/2020/05/16/walking-the-android-timeline-part-2-using-androids-device-personalization-services-to-timeline-user-activity/); no DOI.
- **Why it matters here.** `reflection_gel_events.db` provides an independent Google system-app event stream while illustrating why artifact absence and ambiguous app transitions cannot be interpreted as non-use.
- **Instrument and ladder rung.** Device Personalization Services GEL event database with timestamps, package, and subpackage fields; **Rung 4**.
- **Episode reconstruction rule.** **PARTLY DECLARED.** Events can bookend app activity, but multitasking makes intervals ambiguous; lock, unlock, startup, and shutdown coverage is missing.
- **Session threshold.** None.
- **Availability.** Full grey literature is public; there is no reusable builder. Coverage differs across Pixel/OnePlus and Android versions, records can be deleted, and Takeout is less granular.

### A124. Belkasoft (2025/2026) — *Android System Artifacts: Forensic Analysis of Application Usage*

- **Stable source.** [Full vendor technical article](https://belkasoft.com/android-system-artifacts-forensic-analysis-of-application-usage); no publication DOI.
- **Why it matters here.** The article triangulates UsageStats, Digital Wellbeing, Samsung `dwbCommon.db`, and Device Personalization Services and supplies useful negative-evidence caveats.
- **Instrument and ladder rung.** Multiple Android/OEM system artifacts; **Rung 4/1**.
- **Episode reconstruction rule.** **DELEGATED/ABSENT.** It maps fields and sources, but notifications, internal events, shutdowns, and battery events may not denote active human use, and event absence does not prove non-use.
- **Session threshold.** None disclosed; retained as source-semantics evidence, not a scientific episode builder.
- **Availability.** Public vendor article. Parser internals and validation data are not fully open.

### A125. Forensafe (2025) — *Investigating Android App Usage History*

- **Stable source.** [Full ArtiFast technical article](https://forensafe.com/blogs/android-app-usage-history.html); no DOI.
- **Why it matters here.** It confirms the current commercial-DFIR interpretation of `/data/system_ce/<user_id>/usagestats/` and its interval stores.
- **Instrument and ladder rung.** Daily/weekly/monthly/yearly Android UsageStats files; **Rung 4**.
- **Episode reconstruction rule.** **DELEGATED.** The tool reports event/usage type, package, class/component, launches, and total active time, but publishes no pairing, overlap, or malformed-tail policy.
- **Session threshold.** None.
- **Availability.** Article is public; the parser is commercial and the reconstruction is not independently rerunnable.

### A126. Lee, Lee, Koh & Lee (2022) — *Supporting Fine-Grained User Interaction Analyses by Linking Smartphone Log and Recorded Video Data*

- **Stable source.** [Published DOI 10.1145/3526114.3558714](https://doi.org/10.1145/3526114.3558714); [author PDF](https://ic.kaist.ac.kr/publications/papers/lee2022lvlinker.pdf); earlier [arXiv 2205.14641](https://arxiv.org/abs/2205.14641).
- **Why it matters here.** LV-Linker is an audit/validation interface that aligns processed app logs with screen-recorded video, offering a practical route to inspect boundary errors even though it does not create the intervals.
- **Instrument and ladder rung.** Smartphone app logs plus synchronized screen video; **Rung 3 audit layer**.
- **Episode reconstruction rule.** **ABSENT.** The tool consumes existing log intervals and aligns them to video for fine-grained task/start/end/transition review.
- **Session threshold.** None.
- **Availability.** Full publication is public. No general raw-event builder or released validation corpus was located. The Pro return's arXiv-only identity was corrected to the canonical UIST 2022 publication and DOI.

### Slice A Pro-reconciliation count

- **New records:** A114–A126 = **13**.
- **Authoritative Slice A total:** **100** works — 81 A-numbered records with id ≤ A126,
  plus 19 bare-numbered source records. Corrected from 126 on 2026-08-07: this line had
  the same max-id-as-count error as the final total, and it is where the error entered.
  126 + 23 new records is exactly how the stale headline 149 was produced; the corrected
  chain is 100 + 23 = **123**, which is the final total below.
- **Direct conclusion:** the GESIS tutorial materially raises the prior-art floor because it publishes executable missing-close, timeout, grouping, timezone, background-app, and provenance decisions. The remaining gap is not “no one reconstructs visits,” but the absence of one reusable system that crosses competing typed-event policies and failure branches with per-episode lineage on the same open raw corpus.

## Fresh direct mobile-event additions from Pro discovery — 2026-08-06

The raw 84-candidate search and independent reconciliation are preserved in
[`../consolidated-literature/chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md`](../consolidated-literature/chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md).
The 23 records below are new to the supplied packet by normalized identifier and title. NAPsack/LongNAP
is not imported: it is a computer-I/O/screenshot annotation pipeline applied to a mobile screenshot
corpus, not a mobile-OS event reconstruction method.

### A127. Hsu et al. (2025) — *PULSE: A Screenshot-Based Labeling Tool for Investigating Smartphone Behavior, Intent, and Perception*

- **Stable source.** [DOI 10.1145/3714394.3754395](https://doi.org/10.1145/3714394.3754395); [author PDF](https://people.cs.nycu.edu.tw/~armuro/pubs/hsu-et-al-2025-ubicomp.pdf).
- **Why / rung.** Android screenshots plus screen, app, notification, Accessibility, and contextual streams; **Rung 3/4**.
- **Construction.** A session ends after screen-off >30 s, inactivity for 30 s, or entry into the labeling UI. Durations use six declared bins; ESM is capped at 15/day and spaced by at least one hour.
- **Failure/selection.** Requires ≥12 h/day in the 08:00–23:00 window. Orphan, overlap, duplicate, reboot, clock, and query-tail branches are absent; reported session-flow totals are not fully reconciled.
- **Availability.** Full paper/tool description; no public participant raw log or complete collector repository verified.

### A128. Chen et al. (2023) — *Are You Killing Time? Predicting Smartphone Users’ Time-Killing Moments via Fusion of Smartphone Sensor Data and Screenshots*

- **Stable source.** [DOI 10.1145/3544548.3580689](https://doi.org/10.1145/3544548.3580689); [code](https://github.com/johnsonkao0213/kill_time_detection).
- **Why / rung.** Android Accessibility, screen/app/notification/context streams and 5-s screenshots; **Rung 3/4**.
- **Construction.** Screen-off intervals ≤45 s remain in the same phone-use session; >45 s starts a new one. Prediction uses 30-s windows and excludes the first hour of each participant-day.
- **Failure/selection.** Expected ≥12 h/day; lifecycle collision, missing-close, reboot, clock, and query-boundary policies are not stated.
- **Availability.** MIT-licensed model code, weights, and examples; participant screenshots/logs remain private.

### A129. Tian, Zhou & Pelleg (2022/2023) — *Characterization and Prediction of Mobile Tasks*

- **Stable source.** [DOI 10.1145/3522711](https://doi.org/10.1145/3522711).
- **Why / rung.** UbiqLog app-use records with explicit separation of sessions and user tasks; **Rung 2/3**.
- **Construction.** Consecutive app uses form one session unless standby/inactivity exceeds 45 s. Tasks can span sessions and can be interleaved, so a session is not treated as a user goal.
- **Failure/selection.** The 45-s boundary is declared; upstream lifecycle pairing, missing-record, and clock handling are delegated to UbiqLog.
- **Availability.** Full article; no independently verified reusable raw-event reconstruction implementation.

### A130. Cho et al. (2021) — *Reflect, Not Regret: Understanding Regretful Smartphone Use with App Feature-Level Analysis*

- **Stable source.** [DOI 10.1145/3479600](https://doi.org/10.1145/3479600); [Finesse source](https://github.com/choch-o/Finesse).
- **Why / rung.** Open Android Accessibility/UI-tree feature telemetry for four target apps; **Rung 4**.
- **Construction.** App-specific detectors infer the current feature and executable start/during/end transitions; `checkSessionEnd` saves the final feature before ESM.
- **Failure/version semantics.** The implementation depends on period-specific app versions and Korean device language. General missing-end, overlap, reboot, clock, and malformed-tree policies remain incomplete.
- **Availability.** Android source, study APK, and version guidance public; participant logs private.

### A131. Arsan et al. (2025) — *On-Device Interaction Mining*

- **Stable source.** [DOI 10.1145/3743726](https://doi.org/10.1145/3743726); [ODIM Android source](https://github.com/datadrivendesign/odim-android).
- **Why / rung.** Screenshots, UI hierarchy JSON, package identity, and touch/gesture traces; **Rung 4 UI trace**.
- **Construction.** Package transitions delimit target-app traces; system UI/launcher transitions are excluded. A repair UI supports completing gestures, splitting traces, deleting, and uploading.
- **Failure semantics.** Boundary repair is inspectable, but there is no general screen/unlock session layer or crossed policy family.
- **Availability.** Paper and Android source public; no large open naturalistic raw corpus verified.

### A132. Fang et al. (2024) — *ScreenTK: Seamless Detection of Time-Killing Moments Using Continuous Mobile Screen Text and On-Device LLMs*

- **Stable source.** [DOI 10.1145/3675094.3677547](https://doi.org/10.1145/3675094.3677547); [arXiv 2407.03063](https://arxiv.org/abs/2407.03063).
- **Why / rung.** AWARE-Light Accessibility text/click/scroll plus screen and lock state; **Rung 3/4**.
- **Construction/validation.** Event-derived text is converted to timestamped intervals. Against 5-s screenshots, the sampled method missed 38% of active and 57% of passive events; ScreenTK missed one sensor-failure event.
- **Failure semantics.** Acquisition/interval derivation are described; session opener/closer and orphan/clock repair are absent or delegated.
- **Availability.** Paper/method public; complete collector and participant stream not verified as open.

### A133. Weber, Voit & Henze (2018) — *Notification Log: An Open-Source Framework for Notification Research on Mobile Devices*

- **Stable source.** [DOI 10.1145/3267305.3274118](https://doi.org/10.1145/3267305.3274118); [MIT-licensed source](https://github.com/interactionlab/android-notification-log).
- **Why / rung.** Android `NotificationListenerService` posted/removed callbacks plus notification and device context; **Rung 4**.
- **Construction.** Executable unified JSON records and private SQLite storage support immediate or batched synchronization; some Android versions expose removal reasons.
- **Failure semantics.** Grouping, replacement, application updates, and version differences mean callback counts are not human-visible notification episodes.
- **Availability.** Paper and collector source public; no single open participant corpus.

### A134. Stach et al. (2024) — *Call to Action: Investigating Interaction Delay in Smartphone Notifications*

- **Stable source.** [DOI 10.3390/s24082612](https://doi.org/10.3390/s24082612); [open article](https://www.mdpi.com/1424-8220/24/8/2612).
- **Why / rung.** Android notification appearance/removal telemetry joined to battery/category data; **Rung 3/4**.
- **Construction.** Deduplicates notification/battery update bursts; drops nonpositive or >1-day delays; joins battery within ±10 min; excludes OS-update-affected users, incomplete rows, and selected categories.
- **Failure semantics.** The final set contains 9,894,656 records from 922 users, but removal conflates click/consumption with dismissal.
- **Availability.** Full open article; raw participant telemetry and complete collector not verified as public.

### A135. Sramek et al. (2025) — *Beyond the Feature Level: A Cluster Analysis of Feature-Level Social Media Behaviour Patterns, Maladaptive Use, and Psychological Well-Being*

- **Stable source.** [DOI 10.1145/3770713](https://doi.org/10.1145/3770713).
- **Why / rung.** InstaReader exposes feature transitions through unique URLs in an instrumented Instagram-like WebView; **Rung 4 controlled UI telemetry**.
- **Construction.** Feature identity is directly observable rather than inferred from opaque package events.
- **Limitation.** This is a controlled clone/interface, not the publisher’s native-app lifecycle; episode close, gap, orphan, and tail rules remain undetermined.
- **Availability.** Peer-reviewed system description; no public code or raw trace located.

### A136. Monge Roffarello & De Russis (2021) — *Understanding, Discovering, and Mitigating Habitual Smartphone Use in Young Adults*

- **Stable source.** [DOI 10.1145/3447991](https://doi.org/10.1145/3447991).
- **Why / rung.** Android screen/app logger plus just-in-time Socialize intervention; **Rung 3**.
- **Construction.** A phone-use session is screen-on→screen-off; the study analyzed more than 130,000 sessions.
- **Failure semantics.** Missing screen-off, rapid off/on, reboot, system-app, and overlap handling are unstated.
- **Availability.** Article and intervention materials available; participant logs not public.

### A137. Harbach et al. (2014) — *It’s a Hard Lock Life: A Field Study of Smartphone (Un)Locking Behavior and Risk Perception*

- **Stable source.** [USENIX SOUPS 2014 record](https://www.usenix.org/conference/soups2014/proceedings/presentation/harbach); key `usenix-soups2014-harbach`.
- **Why / rung.** Android screen-on/off intents plus `KeyguardManager`; **Rung 4 device-state machine**.
- **Construction.** Four explicit states—off/unlocked, off/locked, on/unlocked, on/locked—are timestamped. ESM sampling depends on unlock rate and is capped at one prompt/hour.
- **Failure semantics.** Manual-clock-change records and post-reboot logger failures are excluded rather than repaired.
- **Identifier correction.** The Pro return’s `10.5555/3235838.3235857` string is a non-resolving alias, not a usable DOI.

### A138. Weber et al. (2019) — *Annotif: A System for Annotating Mobile Notifications in User Studies*

- **Stable source.** [DOI 10.1145/3365610.3365611](https://doi.org/10.1145/3365610.3365611); [base framework](https://github.com/interactionlab/android-notification-log).
- **Why / rung.** NotificationListenerService events plus participant annotation/censoring; **Rung 4**.
- **Construction.** Participants reviewed posted/removed records, producing 93.02% annotation coverage over 6,188 unique notifications.
- **Failure semantics.** Human review validates meaning but cannot reconstruct callbacks that were never observed; grouping/re-creation artifacts remain.
- **Availability.** Paper and base collector public; study raw corpus not located.

### A139. Pielot, Vradi & Park (2018) — *Dismissed! A Detailed Exploration of How Mobile Phone Users Handle Push Notifications*

- **Stable source.** [DOI 10.1145/3229434.3229445](https://doi.org/10.1145/3229434.3229445).
- **Why / rung.** Posted/removed notification events, screen/unlock, app launches, and drawer Accessibility evidence; **Rung 4**.
- **Construction.** Same-second posted bursts retain the last event. Consumption is inferred when the corresponding app opens before removal; arrivals while that app is already foreground are excluded.
- **Failure semantics.** Manual dismissal, timeout/replacement, and consumption on another device remain conflated; 794,525 notifications from 278 participants were analyzed.
- **Availability.** Full text public; collector and participant data not verified as open.

### A140. Mehrotra et al. (2016) — *My Phone and Me: Understanding People’s Receptivity to Mobile Notifications*

- **Stable source.** [DOI 10.1145/2858036.2858566](https://doi.org/10.1145/2858036.2858566).
- **Why / rung.** Android notification, screen, unlock, application, and context logger; **Rung 4**.
- **Construction.** “Seen” is the next unlock after arrival, or zero delay when already unlocked; acceptance is click or corresponding-app opening; swipe/removal is dismissal.
- **Failure/selection.** Exact visual exposure and ambiguous removals are unobservable. The retained sample required ≥14 ESM responses; prompts were capped at four/day.
- **Availability.** Full article; no open collector/raw log verified.

### A141. Harbach, De Luca & Egelman (2016) — *The Anatomy of Smartphone Unlocking: A Field Study of Android Lock Screens*

- **Stable source.** [DOI 10.1145/2858036.2858267](https://doi.org/10.1145/2858036.2858267).
- **Why / rung.** Custom AOSP/PhoneLab screen and unlock-attempt state instrumentation; **Rung 4**.
- **Construction.** Device-use sessions are screen-on→screen-off; unlock attempts retain typed key-entry, success, failure, too-short, abort, retry, dismissal, and lock-type states.
- **Failure semantics.** Context switching affected 9.8% of relevant events; very short out-of-order sequences were excluded rather than repaired.
- **Availability.** Paper public; reusable PhoneLab builder/raw logs not released.

### A142. Terzimehić et al. (2024) — *Real-World Winds: Micro Challenges to Promote Balance Post Smartphone Overload*

- **Stable source.** [DOI 10.1145/3613904.3642583](https://doi.org/10.1145/3613904.3642583); [app source](https://github.com/mimuc/chi24-rww).
- **Why / rung.** Kotlin foreground service logging lock/unlock, session duration, and apps per session; **Rung 3**.
- **Construction.** Intervention overload is either 12 min uninterrupted screen use or >5 unlocks within 30 min.
- **Failure semantics.** These are design triggers, not universal behavioral boundaries; comprehensive event-repair semantics are absent.
- **Availability.** Paper and repository public; participant logs private.

### A143. Lukoff et al. (2018) — *What Makes Smartphone Use Meaningful or Meaningless?*

- **Stable source.** [DOI 10.1145/3191754](https://doi.org/10.1145/3191754).
- **Why / rung.** Android app-usage intervals plus start/during/end ESM; **Rung 3**.
- **Construction.** Prompts occur at launch, 15–120 s into use, or at close after ≥15 s; a 30-min cooldown and one-prompt-per-app-use limit reduce reactivity.
- **Failure semantics.** Selection rules are declared, but upstream UsageStats interval creation and malformed/missing boundaries are delegated.
- **Availability.** Paper and collection code public; participant logs private.

### A144. Lu et al. (2026) — *Crepe: A Mobile Screen Data Collector Using Graph Query*

- **Stable source.** [DOI 10.1145/3772318.3791137](https://doi.org/10.1145/3772318.3791137); [source](https://github.com/ND-SaNDwichLAB/crepe); [preprint](https://arxiv.org/abs/2406.16173).
- **Why / rung.** Android 9+ Accessibility collector with researcher-authored Graph Query rules and participant controls; **Rung 4**.
- **Construction.** Events are HashSet-deduplicated and throttled for 4 s; the cache clears every 10 s. Hourly sync queues failures, and soft deletion stops new collection while retaining prior records.
- **Failure semantics.** Acquisition/sync/deletion rules are executable; no crossed opener/closer/gap family.
- **Availability.** Final paper/preprint and source public; participant traces private.

### A145. Teng, D’Alfonso & Kostakos (2024) — *A Tool for Capturing Smartphone Screen Text*

- **Stable source.** [DOI 10.1145/3613904.3642347](https://doi.org/10.1145/3613904.3642347); [author PDF](https://songyanteng.github.io/publications/chi2024.pdf).
- **Why / rung.** Continuous Android Accessibility screen-text sensor evaluated for two weeks with 21 participants; **Rung 4**.
- **Construction.** Captures and formats textual UI elements continuously rather than sampling screenshots/OCR, then integrates them into AWARE-Light.
- **Failure semantics.** Acquisition is described; app/session construction, missing-event repair, and clock policies are absent or delegated.
- **Availability.** Full paper public; complete collector/raw corpus not verified as public.

### A146. Deng et al. (2025) — *Walls Have Ears: Demystifying Notification Listener Usage in Android Apps*

- **Stable source.** [DOI 10.1145/3728898](https://doi.org/10.1145/3728898); [NLRadar source/data](https://github.com/security-pride/NLRadar).
- **Why / rung.** Static/source audit of Android `NotificationListenerService` data flows; **Rung 1/2 source semantics**.
- **Construction.** NLRadar maps notification origin/content/attributes to storage, transmission, dismissal, interaction, and automatic reply behaviors.
- **Limitation.** Directly relevant to collector observability/privacy, but it does not construct human phone-use episodes.
- **Availability.** Paper, analyzer/JAR, and supporting data public.

### A147. Draxler et al. (2021) — *Why Did You Stop? Investigating Origins and Effects of Interruptions during Mobile Language Learning*

- **Stable source.** [DOI 10.1145/3473856.3473881](https://doi.org/10.1145/3473856.3473881).
- **Why / rung.** LAIRA/AWARE logs apps, launcher/widgets, screen locks, calls, messages, and notifications; **Rung 3/4**.
- **Construction.** A learning session ends on background, screen-off, or 10-min inactivity. Return within 10 min is a suspending interruption; later return starts a new session. ESM expires after 3 h.
- **Failure semantics.** Session/resumption/prompt-tail rules are declared; Android collision and missing-event repair are not generalized.
- **Availability.** Primary article available; app and participant logs not verified as public.

### A148. Lee et al. (2024) — *S-ADL: Exploring Smartphone-Based Activities of Daily Living to Detect Blood Alcohol Concentration in a Controlled Environment*

- **Stable source.** [DOI 10.1145/3613904.3642832](https://doi.org/10.1145/3613904.3642832); [data/code](https://github.com/Kaist-ICLab/S-ADL_BAC_Detection).
- **Why / rung.** Scripted Android screen, notification, unlock, home, app, message, contact, and call traces; **Rung 4 controlled fixture analogue**.
- **Construction.** Known action sequences produce 57 measures, including completion time, response, transition, and unlock-attempt metrics.
- **Limitation.** Useful validation prior art, but not naturalistic usage or a reusable missing-event repair engine.
- **Availability.** Paper, supplementary data, and analysis code public.

### A149. Yee et al. (2022/2023) — *ScreenLife Capture: An Open-Source and User-Friendly Framework for Collecting Screenomes from Android Smartphones*

- **Stable source.** [DOI 10.3758/s13428-022-02006-z](https://doi.org/10.3758/s13428-022-02006-z); [collector source](https://github.com/ScreenLife-Capture-Team/screenlife-capture-collection).
- **Why / rung.** Android MediaProjection screenshot collection with configurable cadence, app/content/interaction time, pause, encryption, and transfer controls; **Rung 3/4 sampled screenome**.
- **Construction.** Default capture interval is 5 s; the pilot collected >740,000 screenshots from 20 students over two weeks.
- **Failure semantics.** A sample grid requires downstream policy for duplicate frames, sub-interval interactions, boundaries, privacy pauses, and missing frames.
- **Availability.** Paper and collection source public; pilot screenshots private.

### Slice A fresh-discovery count

- **New records:** A127–A149 = **23**.
- **Authoritative Slice A total:** **123** works — 104 A-numbered records plus 19
  bare-numbered source records. Corrected from 149 on 2026-08-07: 149 is the highest
  record id, not a count. Ids **A41–A85** — 45 contiguous — appear nowhere in this
  ledger, the signature of a bulk removal during deduplication that left the headline
  stale. Re-derive with `grep -oE '^### A[0-9]+\.' results-slice-A.md | sort -u | wc -l`
  rather than reading the largest id.
- **Direct conclusion:** direct mobile methods are broader than UsageStats duration papers: open feature detectors, UI traces, screen-text sensors, screenshot collectors, notification callback frameworks, unlock state machines, intervention triggers, and explicit session/resumption rules all matter. None crosses the full mobile lifecycle/failure policy space with per-output lineage and common raw validation fixtures.

# Results — SLICE B (iOS)

> **Freshness correction and expansion (2026-08-05; expanded 2026-08-06):** The earlier conclusion below that no iOS 26 export exists is superseded by Apple primary documentation: `DeviceActivityData.activityData(filteredBy:using:)` was introduced in **iOS/iPadOS 26.4**, released **2026-03-24**, for eligible EU devices/accounts. It exports hourly/daily/weekly aggregates, not raw `App.InFocus` episodes, and Apple still does not disclose the event→episode rule. Entries B72–B95 broaden the direct iOS/mobile-measurement field beyond the initially discovered networks. The **95-source ledger** is authoritative for current Slice B claims and counts.

Scope executed: `knowledgeC.db`, `App.InFocus` / `_DKEvent.App.InFocus`, SEGB/biome, the Screen Time
API (`DeviceActivity` / `FamilyControls` / `ManagedSettings`), Screen Time data-donation studies,
digital-forensics literature, and the iOS 26 export question.

Method constraint honoured: **no browser automation**. Everything below was obtained via `WebFetch`,
`curl`, the Crossref / OpenAlex / Semantic Scholar / Unpaywall / PubMed E-utilities / OSF REST APIs,
and raw source files from GitHub. Where a page 403'd or was JS-only it is recorded as unavailable.

---

## Headline

The iOS side of this problem is **worse than Android, and in a specific, quotable way**: on Android
the raw punctual events are public and the reconstruction rule is the researcher's to declare. On iOS
there are **three mutually inconsistent surfaces** —

1. `App.InFocus` (biome/SEGB): **punctual** foreground/background events, one timestamp each, whose
   state field's meaning is an *interpretation* by third parties, not Apple documentation.
2. `_DKEvent.App.InFocus` (biome/SEGB) and `knowledgeC.db` `/app/inFocus`, `/app/usage`:
   **intervals** (start + end) already closed by Apple, by an undocumented rule.
3. `DeviceActivity` (the only sanctioned API): **no intervals at all** — a single
   `totalActivityDuration` scalar per app per segment, produced by a closed implementation, inside a
   sandbox that is explicitly forbidden from emitting the data.

— and Apple's own two APIs return different totals for the same device, with the definitional
difference published **only in a developer-forum reply**, never in the documentation. That reply
(quoted verbatim in §B2) is the single strongest artefact this slice produced.

**No paper found does the event→episode step on iOS and declares the rule.** The closest thing to a
citation threat (ASTER, §1) builds a donation pipeline for Apple's *already-closed* intervals; its
abstract contains no reconstruction rule, and I could not read its full text.

---

## Part A — Papers

### 1. Martens, M. & Van Gaeveren, K. (2026) — *Making the impossible possible: Leveraging built-in features for non-intrusive and accurate Apple Screen Time tracking through ASTER*

*Behavior Research Methods* 58(7):179. DOI `10.3758/s13428-026-03065-2`. Published 2026-05-29.
Ghent University / imec-mict-UGent.

- **Why it matters here.** **CITATION THREAT — rank 1, but partial.** This is the only peer-reviewed
  paper found that builds a *tooling pipeline* from Apple's own system-level Screen Time files to a
  granular research dataset, i.e. it occupies the same pipeline position we do, on the other OS. It
  is a threat to a "nobody has built this for iOS" claim. It is **not** demonstrated to be a threat
  to the *rule-declaration* contribution, because the abstract contains no episode-reconstruction
  rule and I could not read the full text.
- **Instrument and ladder rung.** **Rung 1–2, ambiguous.** Verbatim: "The process involves donating
  system-level files used to generate Screen Time metrics on Mac, containing anonymized use data of
  all linked devices." (abstract, PubMed record, PMID 42215756). Those files are Apple's own
  already-aggregated Screen Time store — vendor-supplied intervals, not raw platform events. If they
  read `ZUSAGEBLOCK`/`ZUSAGETIMEDITEM` in `RMAdminStore-Local.sqlite` it is Rung 1; if they read
  `knowledgeC.db` `/app/usage` it is Rung 2-ish. **Not determinable from the abstract.**
- **Episode reconstruction rule.** **UNDETERMINED — full text not read.** The abstract states only
  "We developed a tool that enables researchers to process these files into a usable dataset (e.g.,
  JSON)." No rule, threshold, or gap-handling appears in the abstract.
- **Session threshold.** UNDETERMINED (full text not read).
- **Availability.** A tool is claimed ("We developed a tool that enables researchers to process these
  files"); no repository URL appears in the abstract or in the Crossref/Unpaywall/Semantic Scholar
  records. Ethics ref. Ghent University IRB 2022-37. Two abstract-level limitations are quotable and
  matter to us: "it is limited to users with a Mac and can only capture data from the previous 4
  weeks" and "the method is vulnerable to changes in Apple's software structure, echoing the moving
  target problem."
- **Access.** **Abstract only**, via PubMed E-utilities (`efetch`, PMID 42215756). Unpaywall reports
  `"oa_status": "closed"`, `"is_oa": false`, `"oa_locations": []`, `"has_repository_copy": false`.
  Semantic Scholar returns `"abstract": null` with a publisher-elision notice. `link.springer.com`
  303-redirects to `idp.springer.com` (auth); `curl` with a browser UA returns a 3 KB stub.
  **Getting the full text is the single highest-value follow-up in this slice.**

### 2. Ohme, J., Araujo, T., de Vreese, C. H. & Piotrowski, J. T. (2021) — *Mobile data donations: Assessing self-report accuracy and sample biases with the iOS Screen Time function*

*Mobile Media & Communication* 9(1). DOI `10.1177/2050157920959106`. 155 citations (OpenAlex).

- **Why it matters here.** The founding iOS data-donation paper and the one everybody inherits from.
  Its instrument is a **screenshot of Apple's own UI** — i.e. the reconstruction rule is 100%
  delegated to Apple, unread and unreadable, and the paper is the canonical precedent for that
  delegation being acceptable.
- **Instrument and ladder rung.** **Rung 1** (vendor aggregate; participants photograph the Screen
  Time UI and upload the images).
- **Episode reconstruction rule.** **DELEGATED — to Apple**, entirely and irrecoverably. The unit
  donated is a rendered daily/weekly total, so no rule is even expressible. (Structural inference
  from the instrument, which is stated in the title and confirmed by the figure captions
  "Example of screenshots. (a) Screen time, (b) most used apps and websites, (c) predefined
  [categories]". I did not read the methods section.)
- **Session threshold.** **N/A** — the instrument has no session concept.
- **Availability.** Not established (paper not read).
- **Access.** **Metadata + abstract-level only.** `journals.sagepub.com/doi/full/...` returned
  **HTTP 403** to WebFetch; the SAGE PDF endpoint likewise. OpenAlex reports `oa_status: hybrid`, so
  an OA copy should exist somewhere, but I did not locate a fetchable one within this slice.
  Secondary corroboration from search-result summaries only (compliance ~12% of those willing;
  self-report/log correlations 0.3–0.4) — **treat those numbers as unverified until the PDF is read.**

### 3. Asensio, M., Bosch, O. J. & Roberts, C. (2025) — *What is the best way of collecting data donations? An experiment assessing the feasibility of different data donation approaches to measure mobile and app usage*

*Information, Communication & Society*. DOI `10.1080/1369118X.2025.2570738`. Published 2025-10-25.
CC-BY hybrid OA.

- **Why it matters here.** Directly relevant as *the* current methodological state of the art in
  Screen Time donation, and it quietly documents a devastating fact for iOS measurement quality:
  the winning donation modality is **the participant typing the numbers in by hand**.
- **Instrument and ladder rung.** **Rung 1.** Verbatim from the abstract: "ask participants to donate
  … the data that is already available to them through features such as iOS Screen Time and Android
  Digital Wellbeing"; modalities were "screenshots, video recordings, and by manual imputation
  (which we call enhanced recall)".
- **Episode reconstruction rule.** **DELEGATED — to Apple/Google**, and in the winning arm delegated
  a second time, to the participant's transcription. No rule is expressible.
- **Session threshold.** **N/A.**
- **Availability.** 2×3 between-subject web survey experiment, N = 872, Swiss probability panel.
  Result verbatim: "while compliance rates are very low when using screenshots and video recordings
  as data donation methods, almost two thirds of participants donated their data by manually
  imputing their log data."
- **Access.** **Abstract only**, read verbatim via the Semantic Scholar Graph API. A CC-BY PDF exists
  at `tandfonline.com/doi/pdf/10.1080/1369118X.2025.2570738?needAccess=true`; not fetched.

### 4. Parry, D. A. & Klingelhoefer, J. (2025) — *Traces as Data*

PsyArXiv/OSF preprint `6nctf`, posted 2025-07-22. Book chapter. No DOI assigned at the record.

- **Why it matters here.** Background/framing, and mildly threatening only in that it is a
  systematisation of trace data. Its taxonomy stops **above** our layer: it classifies traces by
  *source* (platform vs device) and *content vs metadata*, and sensor readings by *continuous vs
  episodic temporal resolution* — but it does not descend to how a punctual event log becomes an
  episode. That gap is, for us, useful: a 2025 systematisation of trace data that never names the
  event→episode step is evidence the step is invisible to the field.
- **Instrument and ladder rung.** **N/A** — conceptual chapter, no data.
- **Episode reconstruction rule.** **ABSENT** (as a topic) in the abstract. Verbatim scope statement:
  "It systematizes trace data by distinguishing traces as either 1) usage logs or 2) sensor readings.
  Usage logs are further characterized along platform vs. device sources and content vs. metadata
  dimensions." Full text not read, so ABSENT is asserted **for the abstract only**; the chapter body
  is UNDETERMINED.
- **Session threshold.** N/A / UNDETERMINED.
- **Availability.** OA preprint.
- **Access.** **Abstract read verbatim** via the OSF API (`api.osf.io/v2/preprints/6nctf/`). The
  human-facing OSF page renders via JavaScript and returned only the literal string "OSF" to
  WebFetch — recorded as unavailable by the no-automation rule.

### 5. Shaleha, R., Roque, N., Andrews, H., Calfee, K. & Lee, S. (2026) — *Screen Use Measurement Tools: A Mapping of Instruments, Gaps, and Future Directions*

*Cyberpsychology, Behavior, and Social Networking*. DOI `10.1177/21522715261417288`. 2026-01-22.

- **Why it matters here.** A 2026 systematic mapping of 36 screen-use measurement instruments that
  **is entirely about self-report instrument content** and treats device logs only as an external
  validation criterion. Verbatim: "Very few assessed opportunity costs, dyadic use, or included
  validation against device-logged data." A mapping of the measurement field that never opens the
  log-processing box is a citable absence in our favour.
- **Instrument and ladder rung.** **N/A** (review of instruments).
- **Episode reconstruction rule.** **ABSENT** — the coding framework listed in the abstract
  ("measurement constructs, data collection modality (objective logs, self-, or proxy-report),
  temporal specificity, framing valence, opportunity cost, dyadic/social context, developmental
  focus, and evidence of reliability and validity") has **no dimension for how a logged measure was
  derived**. "objective logs" is a single undifferentiated modality value.
- **Session threshold.** N/A. Note their own diagnosis: instruments "lacked precision in temporal
  anchoring", and their remedy is "improve temporal anchoring (e.g., within-day, weekday vs.
  weekend)" — i.e. temporal anchoring is treated as a *recall window* problem, never as an
  episode-boundary problem.
- **Availability.** Not established.
- **Access.** **Abstract read verbatim** via the Crossref API (JATS abstract). Publisher page not
  fetched.

### 6. Ohme, J., Araujo, T., Boeschoten, L. et al. (2023) — *Digital Trace Data Collection for Social Media Effects Research: APIs, Data Donation, and (Screen) Tracking*

*Communication Methods and Measures*. DOI `10.1080/19312458.2023.2181319`. 164 citations.

- **Why it matters here.** The standard methods-overview citation for this whole area; likely to be
  where a reviewer says "this is already covered". Needs to be read before we claim novelty.
- **Instrument / rung / rule / threshold.** **UNDETERMINED — not read.** Recorded here so the next
  agent does not treat it as absent.
- **Access.** **Metadata only** (OpenAlex). `oa_status: hybrid`.

### 7. Other slice-adjacent papers surfaced but NOT read (metadata only — recorded so they are not silently dropped)

All of the following are **UNDETERMINED** on rung, rule, threshold and availability.

| Ref | Note |
|---|---|
| Gower & Moreno (2018), *JMIR mHealth uHealth* 6(11):e11012, PMID 30455163 | "Battery use screenshot" (BUS) method for iPhone — Rung 1 by construction; predates Screen Time. Only search-summary read. |
| Kaye, Orben, Ellis, Hodgkin (2020), *IJERPH* 17(10):3661, DOI `10.3390/ijerph17103661` | "The Conceptual and Methodological Mayhem of 'Screen Time'" — obligatory cite, but its critique is of *construct*, not of *processing*. Verify that before citing it as support. |
| Parry, Davidson, Sewall et al. (2021), *Nat Hum Behav*, DOI `10.1038/s41562-021-01117-5` | The self-report/log discrepancy meta-analysis. Belongs to SLICE F; flagged here only because every iOS donation paper cites it. |
| Christensen et al. (2016), *PLOS ONE*, DOI `10.1371/journal.pone.0165331` | Direct screen-time measurement; iPhone-era pre-Screen Time. |
| Bosch/Asensio group, Welbers et al., Haim & Hase, Keusch et al. (2023–2024, *CCR* / *SMR*) | Data-donation methodology cluster; all Rung 1 by instrument. |

---

## Part B — Primary technical sources (non-paper). This is where the slice's real evidence is.

These are read-in-full, quotable, and mostly **stronger evidence than the papers**, because they are
the actual implementations.

### B1. Apple, `DeviceActivity` framework documentation — the sanctioned API emits no intervals and cannot export

Read verbatim from Apple's own documentation JSON endpoints
(`developer.apple.com/tutorials/data/documentation/deviceactivity*.json`), fetched with `curl`.
The HTML pages are JS-rendered and returned nothing usable to WebFetch — the JSON endpoint is the
readable primary source.

`documentation/deviceactivity` — overview, verbatim:

> "Device Activity provides a privacy-preserving way for an application to monitor a person's
> application and website activity. For instance, you can set up a bedtime schedule that monitors
> device activity while the person is supposed to be asleep. Your app extension can receive warnings
> before an activity's schedule starts or ends, or when an activity is about to reach a predefined
> threshold."

`documentation/deviceactivity/deviceactivityreport` — discussion, verbatim:

> "When you create a report, the system asks your app's device activity report extension to provide a
> [view] representing the user's device activity. **To protect the user's privacy, your extension runs
> in a sandbox. This sandbox prevents your extension from making network requests or moving sensitive
> content outside the extension's address space.** The extension point identifier for all device
> activity report extensions is `com.apple.deviceactivityui.report-extension`."

The full data surface, enumerated from `DeviceActivityData`'s topic sections:

- `DeviceActivityData.ActivitySegment` — abstract: "Activity data for a specific time interval."
- `DeviceActivityData.activitySegments` — discussion: "The [filter] that your app requests via a
  [DeviceActivityReport] determines the length of each activity segment." (i.e. the segment is
  chosen by the *caller*, and is a reporting bucket, not an episode.)
- `DeviceActivityData.ApplicationActivity` — its **entire** measurement surface is three scalars:
  - `totalActivityDuration` — abstract, in full: **"Access the total activity time for this application."** *There is no discussion section. Apple never defines "activity time."*
  - `numberOfPickups` — "Access the number of pickups made directly to the application."
  - `numberOfNotifications` — "Access the number of notifications made by the application."

**Finding.** The only Apple-sanctioned research instrument on iOS exposes a **pre-reduced scalar per
app per caller-chosen bucket**, with no start/end timestamps, no event stream, and a one-line
undefined semantics. The event→episode step is not merely undeclared here — it is architecturally
unreachable, and the sandbox text above is Apple explicitly saying so.

### B2. Apple Frameworks Engineer, Developer Forums thread 722334 — Apple's own two APIs disagree, and the reason is published only in a forum reply

Developer question, verbatim:

> "By default, the DeviceActivityReport captures more Screen Time than the DeviceActivityMonitor by
> default. But if I try to filter the report by `totalActivityDuration` on each category, it misses
> some Screen Time captured by the monitor (like FaceTime, for instance)."

Apple Frameworks Engineer reply, verbatim:

> "Yes, the `totalActivityDuration` for each reported activity segment **includes screen time where no
> apps or websites are used (e.g. the time spent on the Home Screen)**, whereas Device Activity is
> only monitored for actively used apps and websites, which is expected behavior. However, please
> file a bug report using Feedback Assistant for the discrepancy you are seeing between the sum of
> each category's `totalActivityDuration` and the time monitored for an event that includes all apps,
> websites, and categories."

**This is the best single artefact in the slice.** It is Apple, on the record, stating that its two
Screen Time surfaces measure different things — and the definition ("includes screen time where no
apps or websites are used") appears **nowhere in the documentation quoted in B1**. It is exactly our
thesis, admitted by the vendor, in a forum thread. Access: full thread read via WebFetch.

### B3. `App.InFocus` (biome/SEGB) is a *punctual* event stream whose state field is an inference — iLEAPP, read from source

Read verbatim from `raw.githubusercontent.com/abrignoni/iLEAPP/main/scripts/artifacts/biomeInfocus.py`
(author `@JohnHyla`, created 2024-10-17, last update 2026-07-31). Path parsed:
`*/[Bb]iome/streams/restricted/App.InFocus/local/*`.

The module's own `notes` field, verbatim:

> "The Foreground/Background labels for values 1 and 0 are an interpretation of the App.InFocus stream
> name; other values are reported as stored."

The reconstruction, verbatim from the code:

```python
bundleid  = (protostuff['6'])
timestart = (webkit_timestampsconv(protostuff['4']))
state     = protostuff['3']
foreground = {1: 'Foreground', 0: 'Background'}.get(state, str(state))
data_list.append((ts, timestart, record.state.name, bundleid, foreground, filename, ...))
```

Output columns: `Timestamp, Start Time, SEGB State, Bundle ID, Action, Filename, Offset`.

- **Episode reconstruction rule.** **ABSENT.** One row per *event*. No pairing of Foreground with
  Background, no episode, no duration, no gap handling, no unclosed-event policy. The leading
  open-source iOS forensic tool emits the punctual stream and stops.
- **Session threshold.** N/A / none.
- Sample-data field confirms the stream is empty on iOS 16 ("abe_ios16: iOS 16.5 | 0 rows",
  "magnet_ios16: iOS 16.1.1 | 0 rows") and populated from iOS 17 on — i.e. **the stream itself
  changes availability across OS versions**, which is a reconstruction hazard in its own right.

**This is the exact iOS analogue of the Android `ACTIVITY_RESUMED`/`ACTIVITY_PAUSED` pairing problem,
and it is unsolved in the open-source tooling.**

### B4. `_DKEvent.App.InFocus` (biome/SEGB) *does* carry intervals plus a transition — iLEAPP, read from source

From `biomeDKInfocus.py` (same author/dates). Path:
`*/[Bb]iome/streams/restricted/_DKEvent.App.InFocus/local/*`.

Fields decoded from the protobuf, verbatim from the code:

```python
activity  = (protostuff['1']['1'])
timestart = (webkit_timestampsconv(protostuff['2']))
timeend   = (webkit_timestampsconv(protostuff['3']))
timewrite = (webkit_timestampsconv(protostuff['8']))
actionguid = (protostuff['5'])
bundleid   = (protostuff['4']['3'])
transition = ...protostuff['7']...['2']['3']
```

Output columns: `SEGB Timestamp, Time Start, Time End, Time Write, SEGB State, Activity, Bundle ID,
Transition, Action GUID, Filename, Offset`.

- **Episode reconstruction rule.** **DELEGATED — to Apple's DuetKnowledge layer.** The interval
  arrives already closed; iLEAPP does not construct it. The `Transition` string is decoded and
  surfaced but **never interpreted** — nothing in the module says what a transition value means.
- **Session threshold.** N/A / none applied.
- Note the field triple `Time Start` / `Time End` / `Time Write`: the record has a **write time
  distinct from the interval**, i.e. the observation of the episode is separable from the episode. If
  we want a provenance argument, this is the concrete hook.

### B5. `knowledgeC.db` `/app/usage` and `/app/inFocus` — APOLLO, read from source (Sarah Edwards)

`raw.githubusercontent.com/mac4n6/APOLLO/master/modules/knowledge_app_usage.txt` and
`knowledge_app_inFocus.txt`. Author `Sarah Edwards/mac4n6.com/@iamevltwin`. Declared platform
`IOS,MACOS`; declared versions `11,12,13,10.13,10.14,10.15,10.16,14`.

Verbatim from `knowledge_app_usage.txt`:

```sql
DATETIME(ZOBJECT.ZSTARTDATE+978307200,'UNIXEPOCH') AS "START",
DATETIME(ZOBJECT.ZENDDATE+978307200,'UNIXEPOCH')   AS "END",
ZOBJECT.ZVALUESTRING                               AS "BUNDLE ID",
(ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE)            AS "USAGE IN SECONDS",
(ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE)/60.00      AS "USAGE IN MINUTES",
...
WHERE ZSTREAMNAME = "/app/usage"
```

`knowledge_app_inFocus.txt` is the same arithmetic with `WHERE ZSTREAMNAME IS "/app/inFocus"`, plus
`Z_DKAPPLICATIONMETADATAKEY__LAUNCHREASON`, `...__EXTENSIONCONTAININGBUNDLEIDENTIFIER`, and
`...__EXTENSIONHOSTIDENTIFIER`.

- **Episode reconstruction rule.** **DECLARED, and trivially so: `duration = ZENDDATE − ZSTARTDATE`,
  one episode per row, no merging, no gap rule, no unclosed-row policy, no de-overlapping.** The
  substantive rule — the one that decided where `ZSTARTDATE` and `ZENDDATE` went — is Apple's, and is
  **DELEGATED and undocumented**.
- **Session threshold.** **None. Zero.** Not "30 minutes", not "5 seconds" — the concept is absent.
- **Availability.** Fully open-source, dual-licensed (BSD-like with acknowledgment clause / GPLv3),
  re-runnable by any third party against a device image. This is the *most* reproducible artefact in
  the slice — and it is reproducible precisely because it delegates the hard step.
- The module list also shows a distinct `/app/inFocus`, `/app/usage`, `/app/webUsage`,
  `/app/mediaUsage` split (`knowledge_app_media_usage.txt`, `knowledge_app_webusage.txt`), i.e.
  **four different senses of "used an app"**, plus a parallel `powerlog_app_frontmost.txt` /
  `powerlog_app_usage.txt` / `powerlog_app_usage_by_hour.txt` family from a completely different
  subsystem. 247 modules total in the directory.

### B6. Sarah Edwards / mac4n6 (2018-08-05/06) — the canonical `knowledgeC` write-up

`mac4n6.com/blog/2018/8/5/knowledge-is-power-...`. Read via WebFetch.

- Confirms duration is derived as `(ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE)` in seconds; Mac epoch
  offset 978307200; retention "approximately four weeks".
- Caveat stated: `/app/inFocus` **only tracks GUI-based applications**; background processes are
  invisible.
- **Nothing in the post claims Apple documents the stream semantics.** The whole artefact is
  reverse-engineered.
- **Access.** Full text.

### B7. SEGB / biome format — Cellebrite blog + `cclgroupltd/ccl-segb`

- Cellebrite, *Understanding and Decoding the Newest iOS SEGB Format* (read via WebFetch), verbatim:
  "SEGB is the format used by the Biome service in iOS, which emerged in iOS 15 and became a crucial
  source of forensic information in iOS 16." SEGB **v2 debuted in iOS 17**; v2 adds a trailer section
  that must be parsed to read the file; entry padding changed from 8-byte to 4-byte multiples; entry
  states include `1 = Written`, `3 = Deleted`. The article **does not state that Apple documents the
  format** and makes no mention of `App.InFocus`.
- `cclgroupltd/ccl-segb` README (read from raw GitHub): Python modules for SEGB v1/v2, exposing
  `record.data_start_offset`, `record.state`, `record.data`, `record.timestamp1`, and
  `record.timestamp2` ("Timestamp2 only present if record is a SEGB1").
- **Relevance.** The container is undocumented, versioned by OS release, and carries a per-record
  *state* including `Deleted`. Any iOS reconstruction therefore has a **tombstone/deletion semantics
  decision** that has no Android analogue. iLEAPP's `biomeInfocus.py` handles it by emitting a row of
  `None`s (`elif record.state == EntryState.Deleted:`) — a declared choice, but an arbitrary one.

### B8. Alex Beals (2026-07-14), *What are the grey bars in Screen Time?* — the Screen Time UI reverse-engineered

`blog.alexbeals.com/posts/greyed-out-screen-time`. Read via WebFetch.

- Identifies the two stores the UI reads: **`RMAdminStore-Local.sqlite`** (tables `ZUSAGEBLOCK` for
  the bar-chart data and `ZUSAGETIMEDITEM` for named categories) and **`knowledgeC.db`**
  (`/app/inFocus`).
- Key finding, verbatim: "This is where the grey bars are coming from: SpringBoard. The App Library,
  the app switcher, the home screen, and StandBy are all Apple's core surfaces, included in usage but
  hidden from categories."
- ~6+ hours attributed to `com.apple.springboard.stand-by` — StandBy (phone charging horizontally,
  user absent) **counted as screen time**, invisible in the category breakdown, with "no official
  response or fix".
- **Why it matters.** Independently corroborates B2 from the *other* direction: the Screen Time total
  a participant screenshots (papers 2 and 3 above) includes device-state time that no reasonable
  behavioural construct wants. Every Rung-1 iOS donation study inherits this silently.

### B9. `FelixKohlhas/ScreenTime2CSV` — grey-literature reconstruction, read from source

`raw.githubusercontent.com/FelixKohlhas/ScreenTime2CSV/main/screentime2csv.py`. Reads
`~/Library/Application Support/Knowledge/knowledgeC.db`. Source comment credits
`https://rud.is/b/2019/10/28/spelunking-macos-screentime-app-usage-with-r/` — **a threshold/method
provenance chain worth tracing** (2019 R blog post → 2023-ish Python tool → users' analyses).

Verbatim from the source:

```sql
SELECT ZOBJECT.ZVALUESTRING AS "app",
       (ZOBJECT.ZENDDATE - ZOBJECT.ZSTARTDATE) AS "usage", ...
FROM ZOBJECT LEFT JOIN ZSTRUCTUREDMETADATA ... LEFT JOIN ZSOURCE ... LEFT JOIN ZSYNCPEER ...
WHERE ZSTREAMNAME = "/app/usage" AND (ZOBJECT.ZCREATIONDATE + 978307200) > ?
```

- **Episode reconstruction rule.** **DECLARED (as code): per-row `ZENDDATE − ZSTARTDATE`. No merging,
  no gap threshold, no dedup.**
- **Concrete defect worth citing.** It `LEFT JOIN ZSYNCPEER` and emits `device_id`/`device_model`, so
  rows from **multiple iCloud-synced devices are pooled into one CSV with no de-overlapping**. Anyone
  summing the `usage` column across a Mac + iPhone + iPad double-counts wall-clock time. The tool
  does not warn about this.
- **Access.** Full source read.

### B10. Cellebrite / Magnet / Belkasoft — the Screen Time store schema (forensic vendor grey literature)

From vendor write-ups (search-summary level only; full articles **not** read):
`RMAdminStore-Local.sqlite` at `/private/var/mobile/Library/Application Support/com.apple.remotemanagementd/`,
with `ZUSAGEBLOCK` (dates/times), `ZUSAGETIMEDITEM` / `ZUSAGEITEMDITEM` (application info), and
`ZCOREUSER` (users incl. Family Sharing). A separate cloud-sync database exists for synced devices,
and the `-wal` file must be parsed too. **Marked as secondary/unverified** — I did not read the
vendor articles in full, and the table name is spelled two different ways across sources.

---

## Part C — The iOS 26 export question, answered from primary sources only

> **SUPERSEDED by the freshness correction at the top of this file and items 30–35/67–68 in the appended ledger.** This first pass searched release/support pages but missed the live DocC symbol introduced in iOS/iPadOS 26.4. Retain this section only as a dead-end record; do not cite its no-export verdict.

**Question.** Does iOS 26 let a user export their own granular Screen Time data, and from which
release?

**Answer: UNVERIFIED as an affirmative claim — no primary Apple source I could read documents any
such capability, in iOS 26 or any of its point releases.** Below is exactly what each primary source
says. I am reporting these as *what the documents contain*, not as proof of a universal negative.

### C1. Apple, *About iOS 26 Updates* (`support.apple.com/en-us/123075`)

Fetched with `curl`; HTML stripped to 22,485 characters of text. Published date on the page:
**July 27, 2026**. Version headings present on the page: **iOS 26, 26.1, 26.2, 26.3, 26.4, 26.5,
26.6** — i.e. this is the complete iOS 26 release-note history as of this slice.

A case-insensitive scan for `screen time` and `export` across the whole page returns **exactly three
hits, none of which is a Screen Time data export**:

1. "Additional **Lock Screen time** customization option lets you further adjust its appearance,
   giving the Liquid Glass material more or less opacity" — a Lock Screen clock styling option; the
   substring match is coincidental.
2. "Preview is a new app on iPhone dedicated to viewing and editing PDFs, with powerful features like
   AutoFill, a document scanner, and **export options**" — PDF export.
3. "Notes lets you import and **export** Markdown formatted files" — Notes export.

**There is no Screen Time data-export feature in the iOS 26.0–26.6 release notes.**

### C2. Apple, *Understand and control the personal information that you store with Apple* (`support.apple.com/en-us/102283`)

Fetched with `curl`. Published date on the page: **December 18, 2025**. This is the current primary
description of the Data and Privacy self-service tools. Verbatim, the complete list of what the
portal offers:

> "Get a copy of the data that you store with Apple that's associated with your Apple Account. For
> users based in the European Union, United Kingdom, or Japan you can schedule a one-time or
> recurring request for certain data (**including App Store information and app install and push
> notification activity**), as well as view the status of a request for a copy of your data that you
> made through another service. Deactivate your Apple Account temporarily. Delete your Apple Account
> — and the data associated with it — permanently. Request a correction to your personal data.
> Transfer a copy of your data to another service (including your iCloud Photos collection and your
> Apple Music playlists) and view the status of a transfer that you requested through another
> service. Learn about the types of data that Apple collects."

**Screen Time, app usage duration, and device usage are not among the listed categories.** The
closest item — the EU/UK/Japan recurring request — is scoped to "App Store information and app
install and push notification activity", which is store and notification activity, **not** foreground
usage intervals.

### C3. Apple Newsroom, *Apple previews new child safety features* (June 2026)

Read via WebFetch. Verbatim:

> "Screen Time is now redesigned and gives parents an at-a-glance view of their kids' average device
> usage and most used apps."

and, on availability, verbatim:

> "New features will be available after installing the Screen Time update in **iOS 27, iPadOS 27, and
> macOS 27**."

So the one announced Screen Time change in the current cycle is (a) a **UI redesign**, (b) shipping
in **iOS 27, not 26**, and (c) contains **no export**. The press release "contains no information
regarding data export capabilities, usage data availability to end users, or access provisions for
researchers."

### C4. Apple, `DeviceActivity` documentation — the developer route is affirmatively closed

Already quoted in full at §B1. The load-bearing sentence, verbatim:

> "To protect the user's privacy, your extension runs in a sandbox. This sandbox prevents your
> extension from making network requests or moving sensitive content outside the extension's address
> space."

This is Apple **affirmatively documenting that Screen Time data cannot leave the reporting
extension**. It is the strongest primary evidence available that no sanctioned granular export path
exists on iOS 26, and it is a positive statement rather than an absence.

### C5. What I could not check, and why

- `support.apple.com/guide/iphone/whats-new-in-ios-26-...` and the Screen Time user-guide topics
  render their body copy via JavaScript. `curl` returns the guide's table of contents plus inlined
  CSS; WebFetch on the same URLs reported "no mentions of Screen Time and no mentions of exporting
  data" against the ToC it received. **Recorded as unavailable, not as evidence.** Per the no-browser
  rule I did not drive a renderer at these pages.
- `apple.com/legal/privacy/data/en/data-and-privacy/` — **HTTP 404**.
- I did not sign in to `privacy.apple.com` (authenticated; out of reach for WebFetch/curl and not
  attempted).

### C6. Verdict, stated precisely

- **No primary Apple source I read states that iOS 26 adds user export of granular Screen Time data.**
  Four documents that would carry such an announcement (release notes for 26.0–26.6, the Data and
  Privacy tools page, the child-safety press release, the DeviceActivity docs) do not contain it, and
  the fourth affirmatively forbids the developer route.
- **The affirmative claim "iOS 26 lets users export granular Screen Time data" is UNVERIFIED.** I
  found no release that introduces it. I am not asserting from these four documents that no such
  feature exists anywhere in the OS — I am reporting that it is documented nowhere I could read.
- The correct citable statement for the paper is the **positive** one, not the negative:
  Apple documents that Screen Time data cannot leave the reporting extension (§C4), and Apple's
  sanctioned API exposes only `totalActivityDuration` with no definition (§B1). Those two facts do
  the work without requiring a universal negative.
- Practical consequence for the ladder: **iOS has no Rung 4 available to a consenting user.** The
  only routes to interval-level data are a full-filesystem forensic extraction (`knowledgeC.db`,
  biome/SEGB) or a Mac-side donation of Apple's own sync store (ASTER, §1).

---

## Part D — Report

### Totals

- **Papers kept and recorded: 6** (§1–§6), plus 5 recorded-but-unread at §7.
- **Read in full: 0 papers.** (Technical sources: 9 read in full — §B1–B9, all of B1/B3/B4/B5/B9 read
  as primary source code or Apple's own documentation JSON.)
- **Abstract only: 5** (§1 ASTER, §3 Asensio, §4 Parry & Klingelhoefer, §5 Shaleha, and §2 Ohme at
  metadata+figure-caption level).
- **Metadata only: 6** (§6 and the five in §7).

### Citation threats, ranked

1. **Martens & Van Gaeveren (2026), ASTER.** Same pipeline position, iOS, 2026, peer-reviewed, in a
   methods journal our reviewers read. Threatens a "no iOS pipeline exists" claim outright. Does
   **not** demonstrably threaten the rule-declaration claim — but that is because **I could not read
   it**, which is not the same as it being safe. **Get the full text before writing the related-work
   section.** Specifically check: which file they parse (`RMAdminStore-Local.sqlite` vs
   `knowledgeC.db`), whether they merge or de-overlap across the linked devices they explicitly pool
   ("all linked devices"), and whether they say anything about what Apple counts.
2. **Asensio, Bosch & Roberts (2025).** Current, rigorous, N=872, and it is *the* paper on how to get
   Screen Time data out of people. If a reviewer thinks "this is the iOS measurement paper", it is
   this one. It is not a threat to us on substance — its winning method is manual transcription of a
   vendor aggregate — but we must position against it explicitly rather than ignore it.
3. **Ohme, Araujo, Boeschoten et al. (2023), *Communication Methods and Measures*.** Unread, 164
   citations, and it is the standard "digital trace data collection" overview. **Highest-priority
   unread item after ASTER**, because it is exactly the kind of paper a reviewer cites to say
   "already covered".
4. **Shaleha et al. (2026).** Low threat, high utility. A 2026 mapping of 36 instruments whose coding
   framework has no dimension for log processing is a *supporting* citation for our gap claim, not a
   competitor — but only if the full text confirms the abstract.

### Anything that contradicts us

**Yes — and it is the most important finding in this slice, so it is stated first and unsoftened.**

**Apple declares a rule.** In Developer Forums thread 722334 (§B2), an Apple Frameworks Engineer
states on the record that `totalActivityDuration` "includes screen time where no apps or websites are
used (e.g. the time spent on the Home Screen), whereas Device Activity is only monitored for actively
used apps and websites, which is expected behavior."

That is a declared semantic difference between two Apple APIs. It weakens any claim phrased as "the
vendor never says what it counts". The honest framing is narrower and, I think, stronger: **the
declaration exists, but it is in a forum reply and not in the documentation** — `totalActivityDuration`'s
entire documented definition is the seven words "Access the total activity time for this application."
So the finding is not *absence of a rule* but *the rule is real, consequential, and unpublished*.
Do not overclaim past this.

**Second contradiction, weaker.** APOLLO (§B5) and ScreenTime2CSV (§B9) *do* declare their rules —
completely, in executable form, third-party re-runnable. So "nobody declares their rule" is false as
stated for the forensic-tooling community. The distinction that survives is: **forensics declares its
rule and delegates the hard part; behavioural science declares nothing and delegates everything.**
That is a sharper and more defensible claim than the one it replaces, and the forensics-found-it-first
angle in the brief is fully borne out — Sarah Edwards published the `knowledgeC` interval semantics in
**2018**, years before the psychology literature engaged with iOS logs at all.

**Third, a caution against a claim we might be tempted to make.** iLEAPP's `biomeInfocus.py` does
**not** implement a reconstruction — it emits raw punctual events. That is an *absence*, not a
*wrong rule*. Do not describe the forensic tooling as "using an undeclared rule"; it declines to
construct episodes at all, which is a legitimate and arguably correct choice for evidence work.

### Three things I expected and did not find

1. **Any behavioural-science or HCI paper that parses `knowledgeC.db` or biome/SEGB directly.** Zero.
   OpenAlex returns literally **0 results** for "Apple Biome SEGB forensic artefact iOS", **0** for
   "iOS knowledgeC CoreDuet forensic artefact analysis", and **0** for "Screen Time artefact forensic
   iOS RMAdminStore usage block". The search "knowledgeC database app usage research" returns
   **n = 10 works total**, of which the only genuinely on-topic hit is a dating-app forensics paper
   (Knox et al. 2020, `10.1016/j.cose.2020.101833`). The entire `knowledgeC` / biome body of knowledge
   lives in **blogs, vendor articles, conference talks, and GitHub** — it is essentially absent from
   the indexed scholarly record. Two literatures, one artefact, zero contact. **This is a publishable
   observation in its own right.**
2. **Any Apple documentation defining what Screen Time counts.** Not in the release notes, not in the
   user guide, not in the DeviceActivity reference. `totalActivityDuration`'s documentation is one
   sentence with no discussion section. The only substantive definition in existence (§B2) is a forum
   reply. I expected at least a support-page paragraph; there is none.
3. **Any iOS study reporting a session threshold.** Not one — no value, no kind, no justification,
   nowhere. Not in the papers, not in the tools, not in Apple's docs. The threshold-provenance /
   inheritance-chain hunt the brief asks for **has no iOS branch to trace**, because iOS never exposes
   the layer at which a threshold would apply. On iOS the researcher degree of freedom has been
   pre-consumed by the vendor. (The one provenance chain that *does* exist is a tooling chain, not a
   threshold chain: `rud.is` 2019 R blog post → `ScreenTime2CSV` → downstream users, §B9.)

**Bonus absence.** No paper anywhere connects Apple's `Transition` field (§B4) or the four parallel
`/app/usage`, `/app/inFocus`, `/app/webUsage`, `/app/mediaUsage` streams (§B5) to a measurement
argument. Four different machine-readable senses of "used an app" sit in one SQLite file and nobody in
either literature has written about choosing between them.

### Dead ends — do not repeat these

**Searches that returned nothing usable:**

- OpenAlex, `Apple Biome SEGB forensic artefact iOS` → **0 results**.
- OpenAlex, `iOS knowledgeC CoreDuet forensic artefact analysis` → **0 results**.
- OpenAlex, `Screen Time artefact forensic iOS RMAdminStore usage block` → **0 results**.
- OpenAlex, `forensic analysis iOS biome streams device usage artifacts` → n=12, all irrelevant
  (forensic entomology, video watermarking, GANs). The word "forensic" pulls the wrong discipline.
- OpenAlex, `Screen Time API iOS app usage tracking framework limitations researchers` → n=2179 but
  the top 20 are app-ecosystem economics, Android malware, and mHealth app reviews. Nothing on the
  API.
- OpenAlex, `iOS app usage logging without jailbreak research method` → app-forensics papers about
  *individual apps* (Happn, SimpliSafe, Web3 wallets), never about the usage log itself.
- `DeviceActivity framework research study smartphone use measurement` (WebSearch) → returned only
  Android/FLASH-mobile work. **No research study using `DeviceActivity` for measurement was found by
  any query.** Either they do not exist or they are unfindable by these terms; I lean toward the
  former, given §B1 makes exfiltration impossible.
- `DeviceActivity Screen Time API intervention study randomized trial` → returned screen-time RCTs
  that use questionnaires, plus SwiftUI tutorials. No trial instrumented via the API.

**Sources that could not be read (record as unavailable, not as absent):**

- `journals.sagepub.com` (Ohme 2021 full text and PDF) — **HTTP 403** to WebFetch.
- `link.springer.com` (ASTER) — **303 redirect to `idp.springer.com`** auth flow; `curl` with a
  browser UA returns a 3 KB stub. Unpaywall confirms **no OA copy exists anywhere**.
- `developer.apple.com/documentation/*` HTML — JS-rendered, returns nothing to WebFetch.
  **Use `developer.apple.com/tutorials/data/documentation/<path>.json` instead — it works with plain
  `curl` and returns clean structured prose. This is the single most useful technique from this
  slice; the next agent should reuse it.**
- `support.apple.com/guide/**` article bodies — JS-rendered; `curl` yields ToC + inlined CSS only.
  The `support.apple.com/en-us/<id>` KB articles, by contrast, **do** render server-side and strip
  cleanly.
- `osf.io/preprints/...` HTML — JS-only, returns the literal string "OSF". **Use
  `api.osf.io/v2/preprints/<id>/` instead.**
- `apple.com/legal/privacy/data/en/data-and-privacy/` — **404**.
- `apple.com/ios/ios-26/` — **404** (the marketing page has moved or been retired).

**Contaminated result — do not propagate.** A WebSearch for iOS Screen Time accuracy surfaced
`lifetips.alibaba.com` asserting "A Carnegie Mellon Human-Computer Interaction Institute study (2022)
found Screen Time reports deviate from objective process-level telemetry by 37–68% across 42 test
users." **I could not locate this study in Crossref, OpenAlex, Semantic Scholar, or PubMed, and the
host is SEO content.** Treat as fabricated until a DOI is produced. Flagged because the number is
exactly the kind of thing that gets laundered into a related-work section.

### Highest-value follow-ups from this slice

1. Obtain the ASTER full text (§1) — interlibrary loan or author contact (`marijn.martens@ugent.be`,
   corresponding). Everything about the citation-threat ranking depends on it.
2. Archive the Apple Frameworks Engineer forum reply (§B2). Developer-forum threads are deleted. It is
   the best vendor-admission quote in the paper and it lives on a URL Apple controls.
3. Read Ohme et al. (2023) *Communication Methods and Measures* (§6) before claiming novelty.
4. Trace the `rud.is` (2019-10-28) → `ScreenTime2CSV` chain (§B9) as a worked example of tooling
   provenance in the absence of methodological provenance.

<!-- independent-expansion-20260805:B -->

---

# Freshness-corrected independent expansion ledger — Slice B (68 internally deduplicated sources)


Research date: 2026-08-05 (America/Chicago). Scope: iOS `knowledgeC.db` / `/app/inFocus`, Biome/SEGB `App.InFocus`, public Screen Time frameworks and export, forensic work, and Screen Time/Battery data-donation studies. Search was live and deliberately split among forensic practitioners, Apple primary documentation, behavioral-science studies, and recent data-donation methods. The existing 51-item Winklbauer–Batinic chase was read first and used as a deduplication boundary.

Notation: R4 = raw platform events with declared semantics; R3 = app/event-level stream or research logger; R2 = screen on/off; R1 = vendor aggregate; N/A = no measurement. “Threshold” means an event/session threshold, not a study inclusion cutoff. “Full web” means the whole relevant source is readable online; it does not imply peer review. Accessed 2026-08-05 unless stated.

## A. Forensic and raw-artifact lineage (20 items)

## 1. Martens & Van Gaeveren (2026) — Making the impossible possible: … Apple Screen Time tracking through ASTER

- **Primary / DOI:** [PubMed and publisher record](https://pubmed.ncbi.nlm.nih.gov/42215756/); [code](https://github.com/kvgaever/ASTER-Apple_Screen_Time_ExploreR); DOI [10.3758/s13428-026-03065-2](https://doi.org/10.3758/s13428-026-03065-2).
- **Why / rung:** Closest citation threat. R3−: exports `App.InFocus` open/close events with microsecond timestamps, but Apple's device-specific “in focus” predicate is undeclared.
- **Rule / threshold:** **DECLARED:** “each app usage will thus have two entries in the dataset (1 and 0). The usage time can be calculated by subtracting the timestamps of both entries” (p.4). No gap/cap/repair threshold or unmatched-open rule. Predicate quote (p.5): “For the iPhone and iPad, it is the app that is currently visible or being interacted with last (if multiple apps are open).” Provenance: authors’ interpretation, not Apple documentation.
- **Availability / access:** Code and example schema public; raw donations private; pairing is rerunnable, but the generating predicate is not. Full article locally read; publisher record currently accessible; accepted-method/code public. **Full text.**

## 2. Sarah Edwards (2018) — Knowledge is Power! Using the macOS/iOS knowledgeC.db Database to Determine Precise User and Application Usage

- **Primary / DOI:** [mac4n6 primary post](https://www.mac4n6.com/blog/2018/8/5/knowledge-is-power-using-the-knowledgecdb-database-on-macos-and-ios-to-determine-precise-user-and-application-usage); no DOI.
- **Why / rung:** Establishes eight years before ASTER that `/app/inFocus` rows contain bundle ID plus `ZSTARTDATE` and `ZENDDATE`; this is the original public extraction lineage. R3−.
- **Rule / threshold:** **DECLARED at SQL level:** filter `ZSTREAMNAME IS "/app/inFocus"`; duration is same-row end minus start. No session gap. Caveat: usage “is really only for GUI-based applications” (post, caveats); retention “approximately 4 weeks.” Apple’s in-focus predicate remains absent.
- **Availability / access:** Full SQL is readable and rerunnable on matching iOS 11/macOS 10.13 schema; dataset not donated. **Full web.**

## 3. Sarah Edwards (2018) — Knowledge is Power II: A Day in the Life of My iPhone Using knowledgeC.db

- **Primary / DOI:** [mac4n6 primary post](https://www.mac4n6.com/blog/2018/9/12/knowledge-is-power-ii-a-day-in-the-life-of-my-iphone-using-knowledgecdb); no DOI.
- **Why / rung:** Independent worked validation tying knowledgeC records to a deliberately generated day of iPhone behavior. R3−.
- **Rule / threshold:** Uses completed knowledgeC intervals; event-to-episode generation **DELEGATED to CoreDuet/Apple**. No inactivity threshold. Exact extraction semantics are inherited from item 2; no Apple predicate documentation.
- **Availability / access:** Worked timeline and queries public; no raw test image; partially rerunnable with own acquisition. **Full web.**

## 4. Sarah Edwards / mac4n6 (2019–2024) — APOLLO (Apple Pattern of Life Lazy Output’er)

- **Primary / DOI:** [official repository](https://github.com/mac4n6/APOLLO); no DOI.
- **Why / rung:** Established open parser/query collection for `knowledgeC.db`, including `knowledge_app_inFocus`; demonstrates the forensic community operationalized this stream before behavioral research. R3−.
- **Rule / threshold:** Module query is declared in code; no new episode threshold. Complete knowledgeC rows are emitted, so duration remains end−start. Apple predicate **DELEGATED**.
- **Availability / access:** Code public; repository last pushed 2024-02-25 in live GitHub metadata; license field `NOASSERTION`; rerunnable on supported acquisitions. **Full code.**

## 5. Sarah Edwards (2020) — Providing Context to iOS App Usage with knowledgeC.db and APOLLO

- **Primary / DOI:** [mac4n6 post](https://www.mac4n6.com/blog/2020/1/14/providing-context-to-ios-app-usage-with-knowledgecdb-and-apollo); no DOI.
- **Why / rung:** Shows that app activity rows carry context blobs and that app-specific interpretation—not merely duration subtraction—is version/app dependent. R3−.
- **Rule / threshold:** No segmentation threshold; queries enrich intervals. Quote (opening): “Some applications will have data in knowledgeC.db, some will not.” Apple interval predicate **DELEGATED**.
- **Availability / access:** Public worked examples and APOLLO modules; test data unavailable. **Full web.**

## 6. Sarah Edwards (2020) — Extensive knowledgeC APOLLO Updates!

- **Primary / DOI:** [mac4n6 post](https://www.mac4n6.com/blog/2020/6/17/extensive-knowledgec-apollo-updates); no DOI.
- **Why / rung:** Reports regression testing on iOS 11–13/macOS 10.13–10.15 and specifically updates `knowledge_app_inFocus`, evidence of schema drift. R3−.
- **Rule / threshold:** Extraction code declared; no episode threshold. Quote: “Regression testing was performed on iOS 11, 12, and 13 and macOS 10.13, 10.14, and 10.15.”
- **Availability / access:** Public code; no full test corpus. Rerunnable but not independently benchmarkable. **Full web/code.**

## 7. Alexis Brignoni et al. (ongoing; live 2026) — iLEAPP

- **Primary / DOI:** [official repository/releases](https://github.com/abrignoni/iLEAPP/releases); no DOI.
- **Why / rung:** Major open iOS forensic parser now includes knowledgeC artifacts and Biome sync handling; useful independent implementation group. R3−.
- **Rule / threshold:** Parser semantics declared in code, but exact `App.InFocus` pairing was not traced in this pass: **UNDETERMINED**. No cited session threshold found.
- **Availability / access:** Code/releases public and rerunnable on user-supplied extraction; raw validation images not bundled. **Full code.**

## 8. DFIR Review / George Mason Digital Forensics (2022) — iOS KnowledgeC.db Notifications

- **Primary / DOI:** [full PDF](https://dfor.gmu.edu/wp-content/uploads/2022/12/IOS_Knowledge.pdf); DOI [10.21428/b0ac9c28.b2d0adf2](https://doi.org/10.21428/b0ac9c28.b2d0adf2).
- **Why / rung:** Reproducible artifact-validation study within the same database; documents disagreements among commercial/open parsers and demonstrates why versioned validation matters. R3 (notification events, not usage episodes).
- **Rule / threshold:** N/A to app-usage duration. Exact result: “Magnet AXIOM, ArtEx, and APOLLO parsed the KnowledgeC.db notifications. Cellebrite Physical Analyzer and iLEAPP did not” (testing note).
- **Availability / access:** Full report and a SQLite query link; rerunnable with recreated notifications. **Full text.**

## 9. CCL Solutions Group (2023–2026) — `ccl-segb`

- **Primary / DOI:** [announcement](https://www.cclsolutionsgroup.com/post/python-modules-for-segb-files-made-available-via-github); [repository](https://github.com/cclgroupltd/ccl-segb); no DOI.
- **Why / rung:** Independent open parser for the SEGB container underlying post-iOS-16 Biome streams; ASTER’s storage problem was already solved in forensics. R4 container / R3 usage when decoder applied.
- **Rule / threshold:** Container parsing only; **N/A** to event→episode. Quote: modules are “for reading SEGB files (formally known as Biome files)” and can “dump the contents of a SEGB file.”
- **Availability / access:** MIT code, repository pushed 2026-07-13; rerunnable. **Full code/web.**

## 10. Magnet Forensics (2023) — Bringing it Back With Biome Data

- **Primary / DOI:** [primary technical post](https://www.magnetforensics.com/blog/bringing-it-back-with-biome-data/); no DOI.
- **Why / rung:** Documents that iOS 16 moved disappearing knowledgeC artifacts into Biome/SEGB and that local/remote streams mix devices. R3−.
- **Rule / threshold:** No usage pairing rule. Important timestamp warning: records “only store a recorded time … so that’s not the exact timestamp of when the activity happened” (post). No threshold.
- **Availability / access:** Full post; AXIOM is commercial and extraction code closed, so transformation cannot be rerun independently. **Full web, closed implementation.**

## 11. Cellebrite (2023) — Decoding the iOS SEGB v2 Format

- **Primary / DOI:** [primary technical post](https://cellebrite.com/en/blog/understanding-and-decoding-the-newest-ios-segb-format/); no DOI.
- **Why / rung:** Independent SEGB v2 format description after iOS 17 changes; counters any claim that SEGB parsing itself originated with ASTER. R4 container.
- **Rule / threshold:** N/A to usage episodes; declares header fields/magic and entry framing. Quote: iOS 17 made changes “most notably to the SEGB format.”
- **Availability / access:** Full technical post; commercial parser closed; format description partly rerunnable. **Full web.**

## 12. Cellebrite / I Beg to DFIR (2023) — How iOS Biome Data Reveals Digital Evidence

- **Primary / DOI:** [episode page](https://cellebrite.com/en/series/beg-dfir/episode-21-i-beg-to-dfir-how-ios-biome-data-reveals-digital-evidence-in-ios-forensics/); no DOI.
- **Why / rung:** Practitioner training explicitly links knowledgeC, Biome, and activity “streams”; independent forensic lineage. R3−.
- **Rule / threshold:** **UNDETERMINED** (video not fully transcribed); page states knowledgeC was introduced in iOS 11 and calls each data type a “Stream.” No threshold available.
- **Availability / access:** Video/page public; commercial tooling closed. **Full audiovisual page; rule undetermined.**

## 13. SecurityRonin (2026) — `segb-core` 0.2.1

- **Primary / DOI:** [docs/source link](https://docs.rs/segb-core/latest/segb/); no DOI.
- **Why / rung:** Second open, panic-free parser that distinguishes SEGB v1/v2 headers/alignment and exposes record states/timestamps/payloads. R4 container.
- **Rule / threshold:** N/A to episodes. Exact docs: SEGB records carry “a state flag, one or two timestamps, and a raw protobuf payload.”
- **Availability / access:** Public crate/source; version 0.2.1 observed 2026-07; rerunnable. **Full code/docs.**

## 14. SecurityRonin (2026) — `segb-forensic` 0.2.1

- **Primary / DOI:** [crate docs](https://docs.rs/crate/segb-forensic/0.2.1); no DOI.
- **Why / rung:** Adds explicit anomaly semantics (CRC, residue, timestamp ordering) and warns that naïvely treating deleted/unknown records as corruption false-positives on normal streams. R4 container audit.
- **Rule / threshold:** N/A to usage episodes; audit rule declared in code. Docs: findings apply to `Written` records because deleted/unknown are “the normal lifecycle of a Biome append-log.”
- **Availability / access:** Public code/docs, versions since 2026-06; rerunnable. **Full code/docs.**

## 15. ActivityWatch contributors (2026) — `aw-import-screentime`

- **Primary / DOI:** [official repository](https://github.com/ActivityWatch/aw-import-screentime); no DOI.
- **Why / rung:** Very close practical threat: imports Apple `App.InFocus` SEGB telemetry into an independent time-tracking system and explicitly joins `sync.db`. R3−.
- **Rule / threshold:** Pair/stitch implementation exists in code but was not audited line-by-line here: **UNDETERMINED**. README calls the input “Screen Time App.InFocus telemetry”; timezone is a user option (`--tz local|utc`), itself a measurement decision.
- **Availability / access:** Code public; repo pushed 2026-07-27; license field absent in live metadata. Rerunnable with Full Disk Access and Share Across Devices. **Full code.**

## 16. Velociraptor project (2025) — `MacOS.Applications.KnowledgeC`

- **Primary / DOI:** [artifact definition](https://docs.velociraptor.app/exchange/artifacts/pages/macos.applications.knowledgec/); no DOI.
- **Why / rung:** Independent incident-response query surface showing the database is operationally standard, with explicit paths. R3−.
- **Rule / threshold:** Extraction query public; episode construction **DELEGATED to knowledgeC**; no gap threshold.
- **Availability / access:** Artifact definition full and rerunnable on macOS acquisitions; raw validation corpus absent. **Full code/docs.**

## 17. DFIR Assist (live 2026) — Biome Activity Streams (SEGB files)

- **Primary / DOI:** [artifact catalog entry](https://forge-work.com/dfir/knowledge/artifacts/ios-biome); no DOI.
- **Why / rung:** Concise independent catalog: Biome replaced portions of knowledgeC starting in iOS 16 and carries app usage/backlight/etc. R3/R4.
- **Rule / threshold:** No episode rule. Catalog says streams use “protobuf-encoded event records” and may retain deleted records. Threshold N/A.
- **Availability / access:** Full artifact description; implementation not supplied. **Full web.**

## 18. be-binary 4n6 (2026) — Beyond the C: SEGB and Biome Forensics with crush

- **Primary / DOI:** [primary post](https://bebinary4n6.blogspot.com/2026/05/beyond-c-segb-and-biome-forensics-with.html); no DOI.
- **Why / rung:** Worked iPhone `App.inFocus` acquisition and full path layout, including local/remote/tombstone. R3−.
- **Rule / threshold:** Parser decodes records but exact open/close stitching **UNDETERMINED**. Exact path: `/private/var/mobile/Library/Biome/streams/public/_DKEvent.App.inFocus/local/` (post, “Where to Find”).
- **Availability / access:** Full worked post; `crush` availability described but independent code/license not verified. **Full web.**

## 19. Palo Alto Networks Unit 42 (2026) — Tracing Digital Intent: New macOS Tahoe 26 Artifact Discovered

- **Primary / DOI:** [primary technical post](https://unit42.paloaltonetworks.com/new-macos-artifact-discovered/); no DOI.
- **Why / rung:** Independent discovery of `App.MenuItem` confirms Biome is a broader behavioral event system and recommends open `ccl-segb`; useful against hyperfocus on one stream. R4.
- **Rule / threshold:** N/A to use episodes. Quote: the stream “captures the exact text of menu items selected by the user, along with the timestamp.”
- **Availability / access:** Full post and open parser route; rerunnable with acquisition. **Full web.**

## 20. Tyler Seymour (2025) — Notes on accessing/exporting Apple’s Screen Time data

- **Primary / DOI:** [public gist](https://gist.github.com/tylerseymour/684e56cddf4b2df78c9841e1111314f6); no DOI.
- **Why / rung:** Independent attempt records ambiguity when old knowledgeC stream names no longer work and points to current modules/locations. R3−.
- **Rule / threshold:** **UNDETERMINED**; exploration notes, no validated pairing rule or threshold.
- **Availability / access:** Full gist, rerunnable notes but no versioned test corpus. **Full web.**

## B. Apple primary documentation and the iOS 26 export question (15 items)

Apple documentation pages have no DOI. Corporate author is Apple Inc. The key distinction is between the frameworks as introduced (iOS 15/16), where activity could be monitored or rendered inside a privacy-preserving report extension, and the new iOS 26.4 direct export method.

## 21. Apple (2021) — Meet the Screen Time API (WWDC21)

- **Primary:** [WWDC21 session and transcript](https://developer.apple.com/videos/play/wwdc2021/10123/).
- **Why / rung:** Primary release history: iOS 15 introduced Family Controls, Managed Settings, and Device Activity for parental-control apps. R1/API aggregate.
- **Rule / threshold:** API threshold is caller-selected, not sessionization: “Events are usage monitors that call your extension when the user on the device reaches a usage threshold in a Device Activity schedule” (transcript). Apple’s accumulation rule is **ABSENT**.
- **Availability / access:** Full transcript/video; API reproducible by entitled apps, underlying transform not rerunnable. **Full text/video.**

## 22. Apple (2022) — What’s New in Screen Time API (WWDC22)

- **Primary:** [WWDC22 session and transcript](https://developer.apple.com/videos/play/wwdc2022/110336/).
- **Why / rung:** Primary history: iOS 16 added independent-user authorization and Device Activity reports, expanding beyond child controls. R1/API aggregate.
- **Rule / threshold:** Transcript: Device Activity “allowed you to execute code on the start and end of timing windows, as well as whenever usage of an app or website exceeded a threshold.” Threshold selected by app developer; accumulation rule **ABSENT**.
- **Availability / access:** Full transcript/video and sample concepts; rerunnable with entitlement. **Full text/video.**

## 23. Apple (live 2026) — Screen Time Technology Frameworks

- **Primary:** [official overview](https://developer.apple.com/documentation/ScreenTimeAPIDocumentation).
- **Why / rung:** Canonical map of the public suite; no general-purpose raw event log. R1/API aggregate.
- **Rule / threshold:** Framework “includes Family Controls, Managed Settings, and Device Activity”; it documents monitoring and reports, not what opens/closes a use episode. **ABSENT**.
- **Availability / access:** Full docs. **Full web.**

## 24. Apple (iOS 15+, live 2026) — Device Activity framework

- **Primary:** [official framework reference](https://developer.apple.com/documentation/deviceactivity).
- **Why / rung:** Public activity API boundary: app/category/domain totals, schedules, threshold callbacks, reports. R1.
- **Rule / threshold:** “You can monitor the time spent on websites and apps to warn the person once they have reached their threshold” (Overview). Caller defines alert threshold; Apple’s time-spent construction **ABSENT**.
- **Availability / access:** Full docs; entitled app can rerun query/monitor but not raw reconstruction. **Full web.**

## 25. Apple (iOS 16+, live 2026) — `DeviceActivityFilter`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivityfilter).
- **Why / rung:** Defines the selectable population, device, date interval, and app/category/domain filters. R1.
- **Rule / threshold:** Overview: an app may filter “for a specific date interval, filter by user and device … [and] a subset of applications, categories, and web domains.” These are analysis/filter choices, not episode rules. **ABSENT**.
- **Availability / access:** Full docs; query rerunnable subject to authorization. **Full web.**

## 26. Apple (iOS 16+, live 2026) — `DeviceActivityFilter.SegmentInterval`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivityfilter/segmentinterval-swift.enum).
- **Why / rung:** Establishes the granularity of public reports/exports: enumeration cases are hourly, daily, weekly—not event intervals. R1.
- **Rule / threshold:** “the interval at which the system subdivides device activity data”; cases `hourly(during:)`, `daily(during:)`, `weekly(during:)`. Minimum public segment is hourly. Apple’s within-hour rule **ABSENT**.
- **Availability / access:** Full docs. **Full web.**

## 27. Apple (iOS 16+, live 2026) — `DeviceActivityData`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivitydata).
- **Why / rung:** Top-level aggregate returned per person/device, including segments/categories/apps/domains. R1.
- **Rule / threshold:** Abstract: “Activity data for a person on a specific device.” No raw events or inclusion predicate disclosed. **ABSENT**.
- **Availability / access:** Full docs; data query rerunnable only where API policy permits. **Full web.**

## 28. Apple (iOS 16+, live 2026) — `DeviceActivityData.ActivitySegment`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/activitysegment).
- **Why / rung:** Exposes `totalActivityDuration`, `longestActivity`, `firstPickup`, and pickup-without-app count; `longestActivity` proves Apple has a session concept but does not define it. R1.
- **Rule / threshold:** Overview: “all of the activity details … during `dateInterval`”; `longestActivity` is described only as “the date interval of the longest activity session.” Episode/session construction and threshold **ABSENT**.
- **Availability / access:** Full docs; returned aggregates rerunnable, construction not. **Full web.**

## 29. Apple (iOS 16+, live 2026) — `DeviceActivityData.ApplicationActivity`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/applicationactivity).
- **Why / rung:** Per-application public record contains total duration, pickups, notifications—not app-focus start/end events. R1.
- **Rule / threshold:** Abstract: “Activity data for an application”; field is `totalActivityDuration`. Apple provides no open/close, overlap, background, Home Screen, or system-app rule. **ABSENT**.
- **Availability / access:** Full docs. **Full web.**

## 30. Apple (introduced iOS/iPadOS 26.4) — `DeviceActivityData.activityData(filteredBy:using:)`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/activitydata%28filteredby%3Ausing%3A%29).
- **Why / rung:** **Decisive contradiction to ASTER’s premise.** Apple now provides a direct programmatic export route. R1, not raw events.
- **Rule / threshold:** Exact docs: “Use this method to export family activity data, for use in another app or platform.” Apple DocC JSON reports `introducedAt: "26.4"` for iOS/iPadOS. Region restriction: customer installations “can only use the method on devices located in the EU that are signed in with an Apple Account with an EU country or region.” No episode rule; export granularity is governed by hourly/daily/weekly `SegmentInterval`.
- **Availability / access:** Full docs; requires `approvedWithDataAccess` and new entitlement. Rerunnable for authorized EU users; not globally. **Full web.**

## 31. Apple (introduced iOS/iPadOS 26.4) — `FamilyActivityData`

- **Primary:** [official symbol](https://developer.apple.com/documentation/familycontrols/familyactivitydata).
- **Why / rung:** Companion API exposes actual installed apps, visited domains, and category identities instead of only opaque tokens; helps interpret exported activity. R1 metadata.
- **Rule / threshold:** “To fetch a person’s family activity data, use `installedApplications`, `visitedWebDomains`, or `activityCategories`.” N/A to episodes; same EU, authorization, entitlement restrictions.
- **Availability / access:** Full docs; DocC JSON `introducedAt: "26.4"`. **Full web.**

## 32. Apple (introduced iOS/iPadOS 26.4) — Family Controls App and Website Usage entitlement

- **Primary:** [official entitlement reference](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.family-controls.app-and-website-usage).
- **Why / rung:** Proves direct identifiers/data access is gated by a distinct user-authorized capability, not ordinary Family Controls. R1 metadata.
- **Rule / threshold:** Entitlement permits access “with the person’s permission” and can retrieve “actual bundle identifiers … domain names … and display names.” N/A to episodes.
- **Availability / access:** Full docs; distribution entitlement needed; rerunnability gated. **Full web.**

## 33. Apple (live 2026) — Family Controls

- **Primary:** [official framework reference](https://developer.apple.com/documentation/familycontrols).
- **Why / rung:** Documents individual vs child authorization and the privacy/token boundary. R1 metadata.
- **Rule / threshold:** Individual authorization requires device-owner approval; old activity selection uses opaque tokens. No usage construction rule. **ABSENT**.
- **Availability / access:** Full docs. **Full web.**

## 34. Apple (2026) — Developer Program License Agreement §3.3.3(P), Family Controls Framework

- **Primary:** [current agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
- **Why / rung:** Major re-runnability/data-donation constraint: a research-only app may not satisfy permitted primary purposes, and usage data sharing is restricted. N/A/rung 1 governance.
- **Rule / threshold:** Exact §P: usage data “may only be used for providing family controls, or individual device management” and may not be shared beyond the individual/device context. No episode rule.
- **Availability / access:** Full current agreement; legality of research export beyond an app/platform for the individual needs counsel. **Full web.**

## 35. Apple (2026) — iOS/iPadOS 26.4 release record

- **Primary:** [official security release page](https://support.apple.com/en-euro/126792).
- **Why / rung:** Fixes the release date for the export capability: March 24, 2026—before ASTER’s May 7 acceptance and May 29 publication. N/A.
- **Rule / threshold:** N/A. Exact release record: “Released March 24, 2026.”
- **Availability / access:** Full official page. **Full web.**

## C. iOS Screen Time/Battery data donation and measurement studies (31 items)

Unless a paper explicitly says otherwise, all Screen Time/Battery entries below are R1 and **DELEGATE** event→episode construction to Apple. “No threshold” means neither Apple’s session threshold nor a researcher-added one is stated.

## 36. Gower & Moreno (2018) — A Novel Approach to Evaluating Mobile Smartphone Screen Time for iPhones

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC6277825/); DOI [10.2196/11012](https://doi.org/10.2196/11012).
- **Why / rung:** Pre-Screen-Time iOS Battery Usage Screenshot (BUS) feasibility study; establishes an earlier donation surface. R1.
- **Rule / threshold:** **DELEGATED to Apple Battery.** Method quote: BUS was “the upload of a mobile phone screenshot of the ‘battery use’ page” (Methods, BUS approach). No session threshold; paper distinguishes on-screen/background as vendor fields.
- **Availability / access:** Screenshots manually inspectable; no raw Apple events/code, so reconstruction not rerunnable. **Full text.**

## 37. Ohme, Araujo, de Vreese & Piotrowski (2020 online/2021 issue) — Mobile data donations

- **Primary / DOI:** [full SAGE article](https://journals.sagepub.com/doi/10.1177/2050157920959106); DOI [10.1177/2050157920959106](https://doi.org/10.1177/2050157920959106).
- **Why / rung:** Foundational iOS Screen Time screenshot donation method in a general-population sample. R1.
- **Rule / threshold:** **DELEGATED to Apple; no threshold.** Abstract: “The iOS Screen Time function is used as a test case for gathering log data with the help of screenshots.” Five vendor metrics; no aggregation predicate.
- **Availability / access:** Screenshot-derived data, not raw events; method rerunnable but Apple transform is not. CC BY. **Full text.**

## 38. Baumgartner, Sumter, Petkevič & Wiradhany (2022 online/2023 issue) — A Novel iOS Data Donation Approach

- **Primary / DOI:** [full article](https://journals.sagepub.com/doi/10.1177/08944393211071068); DOI [10.1177/08944393211071068](https://doi.org/10.1177/08944393211071068).
- **Why / rung:** Automated screen-video/OCR extraction of iOS Battery Section; key reproducibility and accuracy benchmark. R1.
- **Rule / threshold:** **DELEGATED to Apple Battery; no threshold.** Quote: method is “based on screen video recordings of information provided by the iOS Battery Section” (Abstract/Introduction). Researchers compute on-screen/background/total matches but do not construct episodes.
- **Availability / access:** Processing description and validation accuracy public; donated videos restricted; OCR step partly rerunnable. **Full text.**

## 39. Ellis, Davidson, Shaw & Geyer (2019) — Do smartphone usage scales predict behavior?

- **Primary / DOI:** [publisher record](https://www.sciencedirect.com/science/article/pii/S1071581919300473); DOI [10.1016/j.ijhcs.2019.05.004](https://doi.org/10.1016/j.ijhcs.2019.05.004).
- **Why / rung:** Early study using Apple Screen Time as objective ground truth. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Method framing: compares scales with “objective behaviors derived from Apple’s Screen Time application”; iOS automatically logs seven-day metrics. No Apple rule.
- **Availability / access:** Accepted manuscript was obtained in the local citation chase; data/code not stated. Reconstruction not rerunnable. **Accepted manuscript/full.**

## 40. Hodes & Thomas (2021) — Smartphone Screen Time: Inaccuracy of self-reports

- **Primary / DOI:** [publisher abstract](https://www.sciencedirect.com/science/article/pii/S0747563220303630); DOI [10.1016/j.chb.2020.106616](https://doi.org/10.1016/j.chb.2020.106616).
- **Why / rung:** Same iPhones, two Apple aggregates (10-day Battery vs 7-day Screen Time) yield opposite directions of self-report bias—a natural measurement contradiction. R1×2.
- **Rule / threshold:** **UNDETERMINED (abstract only)**; structurally delegated to Apple. Abstract quote: participants shared “screenshots of their battery use (BUS) and iPhone screen time (iOS STT) data.”
- **Availability / access:** Data/code undetermined; no OA manuscript found in local chase. **Abstract only.**

## 41. Radesky et al. (2020) — Young Children’s Use of Smartphones and Tablets

- **Primary / DOI:** [PubMed](https://pubmed.ncbi.nlm.nih.gov/32482771/); [manuscript PDF](https://elp.georgetown.edu/wp-content/uploads/2021/06/Radesky-et-al-2020.pdf); DOI [10.1542/peds.2019-3518](https://doi.org/10.1542/peds.2019-3518).
- **Why / rung:** Canonical cross-platform pooling: Chronicle on Android, screenshots of Battery on iOS. R1 iOS / R4-ish Android.
- **Rule / threshold:** iOS **DELEGATED**; no threshold. Methods: “a passive-sensing application (Chronicle) in Android devices and screenshots of the battery feature in iOS devices.”
- **Availability / access:** iOS reconstruction not rerunnable; full article readable. **Full text.**

## 42. Hartanto, Lee, Chua, Quek & Majeed (2022/2023) — Smartphone use and daily cognitive failures

- **Primary / DOI:** [PubMed](https://pubmed.ncbi.nlm.nih.gov/36102535/); DOI [10.1111/bjop.12597](https://doi.org/10.1111/bjop.12597).
- **Why / rung:** Daily Screen Time screenshots with vendor app categories later collapsed by researchers. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Method: participants provided screenshots of total, category, and checking metrics; default App Store categories retained before researcher rebinning.
- **Availability / access:** Data and analytic code at [ResearchBox 628](https://researchbox.org/628); accepted manuscript full via SMU (local chase). Apple step not rerunnable. **Accepted manuscript/full.**

## 43. Bradley & Howard (2023) — Stress and Mood Associations With Smartphone Use

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC10491487/); DOI [10.1177/21677026221116889](https://doi.org/10.1177/21677026221116889).
- **Why / rung:** Twelve-week longitudinal weekly Screenshot donations; clear operational collection protocol. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Quote (Measures): “participants were asked to upload two screenshots from their Screen Time application.” Pickup parenthetical (“instances … after it was sitting idle”) supplies no idle duration.
- **Availability / access:** How-to video on OSF; screenshots/data availability per article; Apple transform not rerunnable. **Full text.**

## 44. Garrett et al. (2023/2024) — Links Between Objectively-Measured Hourly Smartphone Use and Adolescent Wake Events

- **Primary / DOI:** [publisher record/full route](https://www.tandfonline.com/doi/abs/10.1080/15374416.2023.2286595); DOI [10.1080/15374416.2023.2286595](https://doi.org/10.1080/15374416.2023.2286595).
- **Why / rung:** Uses hourly bars from iOS screenshots; directly shows researchers infer subdaily timing from vendor-binned output. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Methods: screenshots “presented graphical displays … per hour for the prior 24-h day” including minutes/pickups/notifications.
- **Availability / access:** Full PDF route found; data/code not verified; hourly extraction is rerunnable, Apple episode construction is not. **Full text.**

## 45. Burnell, Garrett, Nelson, Prinstein & Telzer (2024) — Daily links between objective smartphone use and sleep among adolescents

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11303118/); DOI [10.1002/jad.12326](https://doi.org/10.1002/jad.12326).
- **Why / rung:** Fourteen-day daily iOS Screen Time screenshot pipeline with hourly day/night split. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Procedure: “uploaded daily screenshots of their previous day’s smartphone total screen time, number of pickups, and number of notifications.” Android users excluded because data “were pulled from the iOS Screen Time app.”
- **Availability / access:** Full methods; extracted aggregates potentially rerunnable if data shared, Apple transform not. **Full text.**

## 46. Telzer & Burnell (2026) — Smartphone Use During School Hours and Cognitive Control

- **Primary / DOI:** [JAMA full text](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2846017); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12973097/); DOI [10.1001/jamanetworkopen.2026.1092](https://doi.org/10.1001/jamanetworkopen.2026.1092).
- **Why / rung:** Most recent large hourly screenshot study; uses Screen Time bar chart as objective hourly exposure. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Methods: youths uploaded “3 screenshots … each day” showing the prior day’s hourly graphical display.
- **Availability / access:** Full OA article/supplement; screenshot values may be rerunnable, vendor construction not. **Full text.**

## 47. Chase, Brown & Jensen (2022) — Emerging adults’ digital technology engagement and mental health

- **Primary / DOI:** [full Frontiers article](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.1023514/full); DOI [10.3389/fpsyg.2022.1023514](https://doi.org/10.3389/fpsyg.2022.1023514).
- **Why / rung:** iPhone-only survey-assisted transcription of Apple-defined categories, showing taxonomy delegation. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Method: iPhone users navigated native Screen Time; “Screen time categories are determined by Apple’s Screen Time application and vary slightly from participant to participant.”
- **Availability / access:** Full OA; raw Screen Time not available; reconstruction not rerunnable. **Full text.**

## 48. Coyne, Voth & Woodruff (2023) — A comparison of self-report and objective measurements

- **Primary / DOI:** [publisher record](https://doi.org/10.1016/j.teler.2023.100061); DOI [10.1016/j.teler.2023.100061](https://doi.org/10.1016/j.teler.2023.100061).
- **Why / rung:** Explicit iPhone Screen Time “mobile data donation” criterion. R1.
- **Rule / threshold:** **UNDETERMINED** from abstract; quote: study leveraged “mobile data donation (specifically iPhone Screen Time data).” Apple threshold structurally delegated.
- **Availability / access:** Gold OA but client-blocked and no mirror in local chase; data/code undetermined. **Abstract only (access failure, not paywall).**

## 49. Sewall & Parry (2021) — The role of depression in the estimated/actual smartphone-use discrepancy

- **Primary / DOI:** [OSF project/data/code](https://osf.io/mzywt/); DOI [10.1037/tmb0000036](https://doi.org/10.1037/tmb0000036).
- **Why / rung:** Apple Screen Time treated as actual use; unusually strong data/code availability above the vendor boundary. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Method uses iPhone Screen Time total over prior week; no Apple event rule.
- **Availability / access:** Data, R code, supplement and accepted manuscript public on OSF; Apple transform not rerunnable. **Accepted manuscript/full.**

## 50. Jones-Jang et al. (2020) — Good News! Communication Findings May be Underestimated

- **Primary / DOI:** [OUP article](https://academic.oup.com/jcmc/article/25/5/346/5894951); DOI [10.1093/jcmc/zmaa009](https://doi.org/10.1093/jcmc/zmaa009).
- **Why / rung:** Two iOS-only studies explicitly call Screen Time “logged data” and use it as ground truth. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Study 1: “asked them to show us their phone screen of Screen Time results”; Study 2: “self-upload the screenshots” (pp.352, 356). No definition of Apple use/pickup.
- **Availability / access:** No data/code statement; full article readable. **Full text.**

## 51. Shaw et al. (2020) — Quantifying smartphone “use”: Choice of measurement impacts relationships with health

- **Primary / DOI:** [accepted manuscript/project](https://osf.io/a4p78/); DOI [10.1037/tmb0000022](https://doi.org/10.1037/tmb0000022).
- **Why / rung:** Cross-study contrast: Android screen on/off logger vs manually transcribed Apple Screen Time; shows instrument choice changes findings. R2 Android / R1 iOS.
- **Rule / threshold:** Android ON→OFF implicit; iOS **DELEGATED**. Study 2 quote: “data was retrieved by utilising the Apple Screen Time feature … previous 7 days.” A proposed under-15-second “check” was dropped for cross-study parity; no Apple threshold.
- **Availability / access:** Data, scripts, logger source on OSF; iOS reconstruction not rerunnable. **Accepted manuscript/full.**

## 52. Sumter, Baumgartner & Wiradhany (2024/2025) — Beyond screentime: a 7-day mobile tracking study and sleep

- **Primary / DOI:** [publisher](https://doi.org/10.1080/0144929x.2024.2350663); DOI [10.1080/0144929X.2024.2350663](https://doi.org/10.1080/0144929X.2024.2350663).
- **Why / rung:** Uses donated iOS Battery screen video with evening-hour extraction, close to screenshot-processing work. R1.
- **Rule / threshold:** **DELEGATED; no session threshold.** Methods: “upload screen videos of their iOS Battery Section” (local full-text chase); authors define evening window, Apple defines on-screen minutes.
- **Availability / access:** Full text read via accepted/open route in local chase; donation processing described, raw videos restricted. **Full text.**

## 53. Tkaczyk et al. (2024) — (In)accuracy and convergent validity of daily and single-time self-reports

- **Primary / DOI:** [full manuscript PDF](https://is.muni.cz/publication/2400299/Inaccuracy_and_convergent_validity_of_daily_endofday.pdf); DOI [10.1016/j.chb.2024.108281](https://doi.org/10.1016/j.chb.2024.108281).
- **Why / rung:** Mostly Android R2 comparator but important direct contrast: declares screen-episode rule and inherited 15-second checking cutoff that Apple studies omit. R2, adjacent to iOS.
- **Rule / threshold:** **DECLARED:** “screen-on session is the length of time between screen-on and subsequent screen-off”; check ≤15 s, “based on prior studies” (Methods; cites Andrews 2015, Wilcockson 2018).
- **Availability / access:** Data at [OSF](https://osf.io/rs9x8/); article full; code not stated. Reconstruction concept rerunnable. **Full text.**

## 54. Kristensen et al. (2022) — Criterion validity of a research-based application for tracking screen time

- **Primary / DOI:** [publisher/OA](https://doi.org/10.1016/j.chbr.2021.100164); DOI [10.1016/j.chbr.2021.100164](https://doi.org/10.1016/j.chbr.2021.100164).
- **Why / rung:** Direct comparison to Apple Screen Time found 19.3 min/day mean bias and r=.88 on iOS versus ~0 bias/r=.99 on Android. Citation threat to equivalence. R3 research app vs R1 criterion.
- **Rule / threshold:** Research app rule **UNDETERMINED/ABSENT**; Apple **DELEGATED**. Full text states no explanation for iOS bias.
- **Availability / access:** Full OA; re-running episode construction impossible without hidden app/Apple transforms. **Full text.**

## 55. Horwood, Anglim & Mallawaarachchi (2021) — Problematic smartphone use in a nationally representative sample

- **Primary / DOI:** [publisher](https://doi.org/10.1016/j.chb.2021.106848); DOI [10.1016/j.chb.2021.106848](https://doi.org/10.1016/j.chb.2021.106848).
- **Why / rung:** Pools Screen Time (iOS) and Digital Wellbeing (Android) into one “objective” variable. R1.
- **Rule / threshold:** **UNDETERMINED** (abstract only); both vendor transforms delegated.
- **Availability / access:** Advertised green repository record was metadata-only/no file in local chase; data/code undetermined. **Abstract only.**

## 56. Asensio, Bosch & Roberts (2025) — What is the best way of collecting data donations?

- **Primary / DOI:** [full article](https://doi.org/10.1080/1369118X.2025.2570738); DOI [10.1080/1369118X.2025.2570738](https://doi.org/10.1080/1369118X.2025.2570738).
- **Why / rung:** Independent probability-panel experiment comparing screenshot, screen-video, and enhanced-recall donations from iOS Screen Time/Android Wellbeing. R1.
- **Rule / threshold:** **DELEGATED; no session threshold.** Method: data “presented aggregated per day”; five-day task. Researchers declare validation rule: upload all requested information plus manual correctness check (Methods §4.1).
- **Availability / access:** Full article and detailed instructions/supplements; vendor transform not rerunnable. **Full text.**

## 57. Perez et al. (2023) — Validated assessment tools for screen media use: systematic review

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC10101444/); DOI [10.1371/journal.pone.0283714](https://doi.org/10.1371/journal.pone.0283714).
- **Why / rung:** Independent review explicitly says Apple restrictions forced screenshot workarounds and reports poor agreement. N/A review, summarizes R1.
- **Rule / threshold:** N/A. Exact synthesis: iOS restrictions “prevent similar usage tracking apps”; Ohme and Radesky used periodic Screen Time screenshots. It does not recover Apple’s rule.
- **Availability / access:** Full OA; review search rerunnable in principle. **Full text.**

## 58. Ryding & Kuss (2020) — Passive objective measures in problematic smartphone use: systematic review

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7244920/); DOI [10.1016/j.abrep.2020.100257](https://doi.org/10.1016/j.abrep.2020.100257).
- **Why / rung:** Independent review catalogues Apple Screen Time and earlier third-party iOS apps but treats their duration outputs as passive measures. N/A review.
- **Rule / threshold:** N/A; review notes timestamps/launches/screen lock-unlock in some studies but does not audit episode rules.
- **Availability / access:** Full OA; underlying studies mixed. **Full text.**

## 59. Reesor-Oyer et al. (2022) — Tots and Tech Study protocol

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9557980/); DOI [10.2196/36240](https://doi.org/10.2196/36240).
- **Why / rung:** Daily iPhone Screen Time screenshot protocol for caregivers/children; reveals labor and app-coding steps. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Procedure: iPhone caregivers receive a 9 PM reminder “to send a screenshot of their screen time use each day.” Researchers classify apps with two coders plus arbitrator.
- **Availability / access:** Protocol full; future data restricted/undetermined; Apple transform not rerunnable. **Full text.**

## 60. Haag et al. (2024) — Investigating risk profiles of smartphone activities and psychosocial factors

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11683027/); DOI [10.1111/jora.13045](https://doi.org/10.1111/jora.13045).
- **Why / rung:** Daily Screen Time screenshot cleaning/validation in adolescents, independent team. R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Cleaning quote: research assistants checked that screenshots contained “the correct information from the correct day” (Methods). No Apple predicate.
- **Availability / access:** Full OA; screenshot cleaning described, data/code availability per article not verified. **Full text.**

## 61. Anderl, Hofer & Chen (2023) — Directly-measured smartphone screen time predicts well-being

- **Primary / DOI:** [publisher](https://doi.org/10.1177/02654075231158300); DOI [10.1177/02654075231158300](https://doi.org/10.1177/02654075231158300).
- **Why / rung:** Another independent “directly measured” usage claim; important for breadth and terminology. R1/mixed platform likely.
- **Rule / threshold:** **UNDETERMINED**; full method not retrieved in this pass. No episode rule can be inferred safely from title/abstract.
- **Availability / access:** Data/code and exact iOS share undetermined. **Abstract/metadata only.**

## 62. Júdice, Sousa-Sá & Palmeira (2023) — Discrepancies Between Self-reported and Objectively Measured Smartphone Screen Time

- **Primary / DOI:** [publisher](https://doi.org/10.1007/s10935-023-00724-4); DOI [10.1007/s10935-023-00724-4](https://doi.org/10.1007/s10935-023-00724-4).
- **Why / rung:** Before/during-lockdown comparison using device-reported measures; independent health-science group. R1/mixed.
- **Rule / threshold:** **UNDETERMINED** (method not read in full); no safe episode-rule claim.
- **Availability / access:** Data/code undetermined. **Abstract only.**

## 63. Grimaldi-Puyana et al. (2020) — Associations of Objectively-Assessed Smartphone Use with activity, mood and sleep

- **Primary / DOI:** [full MDPI](https://www.mdpi.com/1660-4601/17/10/3499); DOI [10.3390/ijerph17103499](https://doi.org/10.3390/ijerph17103499).
- **Why / rung:** Cross-platform study explicitly assigns iPhone users to built-in Screen Time and Android users to Your Hour. R1 mixed.
- **Rule / threshold:** **DELEGATED; no threshold.** Methods: iPhone users “were instructed to use the ‘Screen Time’ application.” No cross-vendor equivalence check.
- **Availability / access:** Full OA; vendor construction not rerunnable. **Full text.**

## 64. Saraceni, Migliorelli, Frontoni & Stacchio (2026) — Beyond screen time: objective vs perceived smartphone usage

- **Primary / DOI:** [full Frontiers](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2026.1773348/full); DOI [10.3389/fcomp.2026.1773348](https://doi.org/10.3389/fcomp.2026.1773348).
- **Why / rung:** Current independent study explicitly combines Digital Wellbeing or Screen Time apps as “objective.” R1.
- **Rule / threshold:** **DELEGATED; no threshold.** Abstract/method framing compares self-reports with “data collected through the Digital Wellbeing or Screen Time applications.”
- **Availability / access:** Full OA; no raw vendor events. **Full text.**

## 65. Migan-Gandonou Horr & Campos (2024) — Effects of a Technology-Based Self-Management Intervention

- **Primary / DOI:** [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11707117/); DOI [10.1007/s40617-024-00977-3](https://doi.org/10.1007/s40617-024-00977-3).
- **Why / rung:** Single-case intervention with daily iPhone Screen Time screenshots and manual app-duration entry; an independent applied-behavior use. R1.
- **Rule / threshold:** **DELEGATED; no episode threshold.** Procedure: participant sent “a screenshot of the previous day’s Screen Time data and record[ed] the duration-per-application data in Excel.” Intervention delays (10/30 s) are not session thresholds.
- **Availability / access:** Full OA; Excel/screenshot data availability not established. **Full text.**

## 66. Siebers, Beyens & Valkenburg (2023/2024) — Fragmented and sticky smartphone use

- **Primary / DOI:** [publisher/DOI](https://doi.org/10.1177/20501579231193941); DOI [10.1177/20501579231193941](https://doi.org/10.1177/20501579231193941).
- **Why / rung:** Android rather than iOS, but the most important contrast case: five-threshold sensitivity analysis flips an effect, illustrating exactly what Apple hides. R3/R2 adjacent.
- **Rule / threshold:** **DECLARED:** screen on→off, bridging off/on gaps ≤30 s because 30 s “has been most often used in previous research”; sensitivity thresholds 0/10/30/60/90 s (Methods). App foreground-time construction still delegated to Ethica.
- **Availability / access:** OSF preregistration/code/syntax and Figshare data public; full UvA manuscript read locally. **Full text.**

## 67. Apple (iOS 15+, live 2026) — `DeviceActivityEvent`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivityevent); no DOI.
- **Why / rung:** Apple’s clearest public statement of what per-app/domain “device activity” means, but still not how focus is detected. R1 API aggregate.
- **Rule / threshold:** Partial semantic declaration: “Device activity is the amount of time an application, category, or web domain is frontmost on the screen and accumulates based on the time zone of the scheduled start date.” Event `threshold` is caller-supplied. Opening/closing, split-screen, transition, Home Screen, and repair semantics remain **ABSENT**.
- **Availability / access:** Full docs; callback monitoring rerunnable with entitlement, underlying predicate not. **Full web.**

## 68. Apple (iOS 16+, live 2026) — `ActivitySegment.totalActivityDuration`

- **Primary:** [official symbol](https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/activitysegment/totalactivityduration); no DOI.
- **Why / rung:** Defines segment total differently from per-app activity: total is screen-on time, not necessarily the sum of frontmost app durations. R1.
- **Rule / threshold:** Exact Discussion: “This value represents the total amount of time the device’s screen remained on during `dateInterval`.” Screen-on episode construction and `longestActivity` boundary still **ABSENT**.
- **Availability / access:** Full docs; aggregate query rerunnable, construction not. **Full web.**

## Totals and access accounting

- **71 distinct citable items**: 20 forensic/artifact/tool sources, 17 Apple primary sources, 34 empirical/review/protocol papers.
- **66 full-source reads** (full paper/manuscript, full official docs, full technical post/code, or full audiovisual source); **5 abstract/metadata-only** (items 40, 48, 55, 61, 62); **0 guessed fields**.
- Peer-reviewed/research outputs among the 71: **36** (ASTER + knowledgeC Notifications + 34 study/review/protocol items). Non-peer-reviewed primary technical/official/software sources: **35**.
- Episode/session rule status: Apple construction **declared by Apple: 0**; Apple construction delegated/absent: every R1/API study; researcher rule declared in iOS raw stream: ASTER’s direct open/close subtraction only; adjacent Android rules declared: items 53 and 66.
- Access/re-runnability: public code/query/data routes are recorded per item; none can rerun Apple’s focus/screen-time construction from public semantics. The iOS 26.4 API can rerun authorized aggregate queries only for eligible EU installations.

## iOS 26 granular-export conclusion — VERIFIED from Apple primary sources

- **Yes, but the precise first release is iOS/iPadOS 26.4, not the initial iOS 26.0 release.** Apple’s live DocC JSON for `DeviceActivityData.activityData(filteredBy:using:)` reports `introducedAt: "26.4"`; Apple’s release record dates iOS 26.4 to **March 24, 2026**.
- It is a genuine programmatic export: Apple’s exact Discussion says, **“Use this method to export family activity data, for use in another app or platform.”** This directly answers the operator’s question and contradicts ASTER’s blanket no-API statement for the eligible population.
- It is **not global**: customer installations must be on a device physically located in the EU and signed into an Apple Account with an EU country/region; otherwise it throws. It additionally requires explicit `approvedWithDataAccess` authorization and the `Family Controls App and Website Usage` entitlement.
- It is **granular only relative to a weekly/daily Screen Time summary**. Public segment choices are hourly/daily/weekly. Per-app records expose total duration/pickups/notifications; segment records expose screen-on total, first pickup, and longest activity. The API does not expose `App.InFocus` start/end events or Apple’s event→episode rule.
- This finding does **not** verify that the ordinary Apple Data & Privacy portal download contains Screen Time. That separate portal question remained indeterminate.
- Primary sources: items 30–35 and 67–68; no commentary or third-party report is needed for the capability/release/region claims.

## Citation threats, ranked

1. **Apple’s iOS/iPadOS 26.4 `activityData(filteredBy:using:)` export (items 30–35, 67–68).** Highest framing threat. It directly falsifies any unqualified 2026 claim that Apple offers no programmatic export. It does **not** threaten the episode-ontology contribution: minimum segment is hourly and construction remains hidden.
2. **ASTER (item 1).** Closest published behavioral-method threat: event-level cross-device `App.InFocus` output plus a stated duration subtraction rule. Its unmatched-open, overlap, timezone, and predicate gaps leave the central measurement problem intact.
3. **Edwards/knowledgeC + APOLLO (items 2–6).** Strong priority threat to any novelty claim about extracting raw-ish iOS app-use intervals. It predates Screen Time and ASTER; cite it prominently.
4. **ActivityWatch `aw-import-screentime` (item 15).** Practical open-source threat because it stitches/imports the same SEGB stream. Its exact stitching deserves a future code audit before claiming no independent implementation exists.
5. **Apple `DeviceActivityEvent` semantics (item 67).** Apple now says per-app activity means “frontmost on the screen,” which narrows—but does not close—the semantic absence.
6. **Kristensen et al. (item 54).** Empirical validation threat/support: shows a 19.3 min/day iOS bias relative to a research tracker. It establishes measurement non-equivalence without identifying the rule.
7. **Siebers et al. (item 66).** Adjacent Android conceptual threat: named threshold, provenance chain, five-value sensitivity analysis, and an effect change. It proves the general argument is not unprecedented, but it does not solve iOS episodes.
8. **Ohme/Baumgartner/Asensio donation lineage (items 37, 38, 56).** Strong acquisition-method prior art; not event→episode prior art.

## Contradictions and corrections

1. **ASTER’s “no granular data through Screen Time APIs” premise became false for a defined population before publication.** iOS 26.4 shipped March 24, 2026; ASTER was accepted May 7 and published May 29. Direct export is EU-only, entitlement/authorization-gated, and hourly/daily/weekly—not raw episodes. Phrase the contradiction precisely.
2. **ASTER’s priority framing is contradicted by Edwards (2018).** `/app/inFocus` with start/end/duration was publicly queried before iOS 12 Screen Time; APOLLO operationalized it years earlier.
3. **“Raw without aggregation” is too strong for `App.InFocus`.** The stream is already an Apple-derived interval/event representation based on an undocumented/device-specific “in focus” predicate; ASTER is raw relative to the bar chart, not raw platform interaction.
4. **Apple exposes two non-identical totals.** `ActivitySegment.totalActivityDuration` is screen-on time (item 68); app/domain activity is frontmost time (item 67). Summing apps is not documented as identical to Screen Time total.
5. **Hodes & Thomas (item 40) reports opposite self-report conclusions from Battery and Screen Time on the same phones.** This is direct evidence vendor surfaces are not interchangeable.
6. **Kristensen et al. (item 54) shows platform-asymmetric validity** (~0 bias Android vs 19.3 min/day iOS), contradicting casual cross-platform pooling.
7. **The new export does not equal a Data & Privacy portal archive.** It is an entitled API method in an app, region-restricted; no verified evidence here shows that a user’s generic Apple Data & Privacy download now contains Screen Time.

## Expected absences that remained absent

1. No Apple document defines what opens/closes `longestActivity`, how missing closes are repaired, whether focus changes under overlays/split view/lock transitions, or how Home Screen/system UI is included in per-app versus total duration.
2. No published validation compares iOS 26.4 exported hourly/app totals against the built-in Screen Time UI, `App.InFocus` SEGB, or direct observation; no retention-window documentation was found for the new export.
3. No peer-reviewed independent paper before ASTER was found whose subject is reconstructing Screen Time from `knowledgeC.db`/Biome, despite abundant forensic posts/tools. The scholarly behavioral literature overwhelmingly starts at screenshots/aggregates.
4. No pre-iOS-26.4 research study was found using the public DeviceActivity report API as a general exportable research instrument; the sandboxed report-extension design appears to have blocked that use.
5. No official Apple release-note announcement specifically naming the 26.4 Screen Time export was found; availability is established by live DocC symbol metadata plus the official OS release date.

## Query and dead-end log

### Product-neutral / problem queries

- `how researchers collect iPhone app use duration`, `iPhone objective smartphone use screenshots`, `mobile data donation app usage`, `smartphone usage duration measurement iOS`, `objective hourly smartphone use iPhone`.
- Negation/limits: `iPhone Screen Time inaccurate`, `limitations Apple Screen Time research`, `DeviceActivity report total mismatch`, `Screen Time data export unavailable`, `iOS passive sensing restrictions`.
- Forensics vocabulary: `iOS user activity forensic database`, `CoreDuet app usage forensic`, `Apple Biome user activity stream`, `SEGB forensic parser`, `iOS forensic app in focus`.

### Exact follow-through queries (after neutral baseline)

- `knowledgeC.db /app/inFocus`, `App.InFocus SEGB`, `DeviceActivityData activityData export`, `FamilyActivityData iOS 26.4`, `Family Controls App and Website Usage`, `Apple Screen Time screenshots DOI`, `iOS Battery Section screen video data donation`.
- Source-specific searches across Apple Developer, Apple Support, PubMed/PMC, Crossref, OpenAlex, DFRWS, DFIR Review, GitHub, crates.io/docs.rs, Magnet, Cellebrite, CCL, and institutional repositories.

### Dead ends / low-yield routes

- OpenAlex full-text search for `DeviceActivity` and `App.InFocus` was noisy and returned unrelated “screen time”/digital-wellbeing papers; it was useful only for candidate discovery, never for method claims.
- `knowledgeC.db` scholarly searches produced one focused notification validation paper plus practitioner sources; broad Digital Forensics venue searches did not reveal an app-duration reconstruction paper.
- Generic Apple Support “export Screen Time” searches returned only the user-facing Screen Time guide. The decisive result required Apple DocC JSON/symbol availability metadata; no marketing/release-notes page surfaced.
- Apple Data & Privacy portal category searches did not yield a current public category list proving Screen Time inclusion. This remains **indeterminate**, not “absent.”
- GitHub unauthenticated repository/code search intermittently returned null/rate-limit responses. Exact known repositories and live metadata were fetched individually; no negative inference was drawn from the failed broad search.
- Several Elsevier/SAGE/Taylor & Francis full texts were 403/JS-gated. Where no repository manuscript existed, entries remain abstract-only; access failure was not converted to silence.
- Searches for `SEGB` are heavily polluted by unrelated “Biome” software/biology results; source and path terms (`Apple`, `forensic`, `_DKEvent`, `App.InFocus`) were required.

## Deduplicated bibliography

The numbered ledger above is itself the deduplicated bibliography: one canonical source per number, with DOI when registered and stable primary/full-text URL otherwise. Canonical keys for machine reconciliation:

1. Martens2026 — 10.3758/s13428-026-03065-2
2. Edwards2018Knowledge — mac4n6 `/2018/8/5/knowledge-is-power...`
3. Edwards2018KnowledgeII — mac4n6 `/2018/9/12/knowledge-is-power-ii...`
4. APOLLO — github.com/mac4n6/APOLLO
5. Edwards2020Context — mac4n6 `/2020/1/14/providing-context...`
6. Edwards2020Updates — mac4n6 `/2020/6/17/extensive-knowledgec...`
7. iLEAPP — github.com/abrignoni/iLEAPP
8. GMU2022Notifications — 10.21428/b0ac9c28.b2d0adf2
9. CCL2023SEGB — github.com/cclgroupltd/ccl-segb
10. Magnet2023Biome — magnetforensics.com/blog/bringing-it-back-with-biome-data
11. Cellebrite2023SEGBv2 — cellebrite.com/en/blog/understanding-and-decoding-the-newest-ios-segb-format
12. Cellebrite2023Biome — I Beg to DFIR episode 21
13. segb-core-0.2.1 — docs.rs/segb-core
14. segb-forensic-0.2.1 — docs.rs/segb-forensic
15. ActivityWatch2026Importer — github.com/ActivityWatch/aw-import-screentime
16. VelociraptorKnowledgeC — `MacOS.Applications.KnowledgeC`
17. DFIRAssistBiome — forge-work.com/dfir/knowledge/artifacts/ios-biome
18. BeBinary2026Biome — `Beyond the C`
19. Unit422026MenuItem — unit42.paloaltonetworks.com/new-macos-artifact-discovered
20. Seymour2025Notes — gist 684e56cddf4b2df78c9841e1111314f6
21. AppleWWDC21 — session 10123
22. AppleWWDC22 — session 110336
23. AppleScreenTimeFrameworks — `ScreenTimeAPIDocumentation`
24. AppleDeviceActivity — framework docs
25. AppleDeviceActivityFilter — symbol docs
26. AppleSegmentInterval — symbol docs
27. AppleDeviceActivityData — symbol docs
28. AppleActivitySegment — symbol docs
29. AppleApplicationActivity — symbol docs
30. AppleActivityDataExport — iOS 26.4 symbol docs
31. AppleFamilyActivityData — iOS 26.4 symbol docs
32. AppleUsageEntitlement — `com.apple.developer.family-controls.app-and-website-usage`
33. AppleFamilyControls — framework docs
34. AppleDPLA2026 — §3.3.3(P)
35. AppleIOS264Release — support.apple.com/en-euro/126792
36. GowerMoreno2018 — 10.2196/11012
37. OhmeEtAl2020 — 10.1177/2050157920959106
38. BaumgartnerEtAl2022 — 10.1177/08944393211071068
39. EllisEtAl2019 — 10.1016/j.ijhcs.2019.05.004
40. HodesThomas2021 — 10.1016/j.chb.2020.106616
41. RadeskyEtAl2020 — 10.1542/peds.2019-3518
42. HartantoEtAl2022 — 10.1111/bjop.12597
43. BradleyHoward2023 — 10.1177/21677026221116889
44. GarrettEtAl2023 — 10.1080/15374416.2023.2286595
45. BurnellEtAl2024 — 10.1002/jad.12326
46. TelzerBurnell2026 — 10.1001/jamanetworkopen.2026.1092
47. ChaseBrownJensen2022 — 10.3389/fpsyg.2022.1023514
48. CoyneVothWoodruff2023 — 10.1016/j.teler.2023.100061
49. SewallParry2021 — 10.1037/tmb0000036
50. JonesJangEtAl2020 — 10.1093/jcmc/zmaa009
51. ShawEtAl2020 — 10.1037/tmb0000022
52. SumterEtAl2024 — 10.1080/0144929X.2024.2350663
53. TkaczykEtAl2024 — 10.1016/j.chb.2024.108281
54. KristensenEtAl2022 — 10.1016/j.chbr.2021.100164
55. HorwoodEtAl2021 — 10.1016/j.chb.2021.106848
56. AsensioBoschRoberts2025 — 10.1080/1369118X.2025.2570738
57. PerezEtAl2023 — 10.1371/journal.pone.0283714
58. RydingKuss2020 — 10.1016/j.abrep.2020.100257
59. ReesorOyerEtAl2022 — 10.2196/36240
60. HaagEtAl2024 — 10.1111/jora.13045
61. AnderlHoferChen2023 — 10.1177/02654075231158300
62. JudiceEtAl2023 — 10.1007/s10935-023-00724-4
63. GrimaldiPuyanaEtAl2020 — 10.3390/ijerph17103499
64. SaraceniEtAl2026 — 10.3389/fcomp.2026.1773348
65. MiganGandonouHorrCampos2024 — 10.1007/s40617-024-00977-3
66. SiebersBeyensValkenburg2023 — 10.1177/20501579231193941
67. AppleDeviceActivityEvent — symbol docs
68. AppleSegmentTotalActivity — symbol docs

<!-- chatgpt-pro-delta-20260805:B -->

## Independently reviewed additions — Slice B

### 69. Kim, Gluck, Hall & Agarwal (2019) — *Real World Longitudinal iOS App Usage Study at Scale*

- **Stable source.** [arXiv DOI 10.48550/arXiv.1912.12526](https://doi.org/10.48550/arXiv.1912.12526).
- **Why it matters here.** **Citation threat:** a raw jailbroken-iOS study declares an app-session boundary and an outcome-changing tail-trimming rule.
- **Instrument and ladder rung.** ProtectMyPrivacy instrumentation on jailbroken iPhones, recording foreground app transitions; **Rung 4**.
- **Episode reconstruction rule.** **DECLARED.** “An app session starts when a user clicks the app icon” and ends at a home-screen exit or when another app enters the foreground (§3.1, printed p. 5).
- **Session threshold.** No inactivity gap. The method retains the central 99.7% of session lengths, approximately **0.1959–33,189.9 seconds** (§3.2.1, printed p. 6), treating the lower tail as accidental presses and the upper tail as unattended demonstrations or similar behavior. This is a trimming cutoff, not a joining timeout.
- **Availability.** No public raw session data or reconstruction source was located; **not independently rerunnable**.
- **Access.** Full arXiv preprint; **full text**.

### 70. Morrison, Xiong, Higgs, Bell & Chalmers (2018) — *A Large-Scale Study of iPhone App Launch Behaviour*

- **Stable source.** [DOI 10.1145/3173574.3173918](https://doi.org/10.1145/3173574.3173918).
- **Why it matters here.** **Citation threat:** it declares app-use start/end behavior, inherits a device-session timeout, and separately learns a micro-use breakpoint from observed durations.
- **Instrument and ladder rung.** `AppTracker` on jailbroken iPhones, recording app open/close and device lock/unlock events; **Rung 4**.
- **Episode reconstruction rule.** **DECLARED.** App use ends on home-screen return, another foreground app, or lock; unlocking to the same foreground app starts a new use. The source states, “When the screen locks with an app open … usage ending” (Methods/definitions, printed p. 4).
- **Session threshold.** **30 seconds, locked-screen timeout**, inherited from Böhmer et al. (2011): “screen has been locked for 30 seconds.” A separate **21.4-second** breakpoint learned with `k=2` k-means classifies micro-use; it does not join device sessions.
- **Availability.** No public raw-event dataset or complete `AppTracker` builder was located; **not independently rerunnable**.
- **Access.** Full CHI paper via author-uploaded copy plus ACM metadata; **full text**.

### 71. Decorte et al. (2026) — *Sleep and Smartphone Use: Within- and Between-Person Relationships from an Objective Longitudinal Smartphone and Wearable Data Donation Study*

- **Stable source.** [DOI 10.1371/journal.pdig.0001232](https://doi.org/10.1371/journal.pdig.0001232).
- **Why it matters here.** A current iOS Screen Time donation study makes downstream analysis reproducible while leaving primary episode construction entirely Apple-defined.
- **Instrument and ladder rung.** Participant-donated iOS Screen Time screenshots/data (iOS 16+), including daily total, hourly use, and top applications; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple Screen Time.** The study receives vendor-derived intervals/aggregates and cannot state Apple’s opening, closing, missing-event, overlap, or background-use policies.
- **Session threshold.** No numeric Screen Time threshold is available. The in-bed-use cleaning mentions long inactivity gaps and low-step epochs but supplies no event→episode threshold for Apple usage.
- **Availability.** Analysis data and scripts are on OSF; donated screenshots were deleted for privacy. Apple’s event→episode step cannot be independently rerun.
- **Access.** Full PLOS Digital Health HTML and linked OSF materials; **full text**.

## Correction to existing B3/B4 App.InFocus records

- **Correction source.** Mattia Epifani (27 July 2026), [*84 Streams Later, Part 2: Inside Apple Biome*](https://blog.digital-forensics.it/2026/07/84-streams-later-part-2-inside-apple.html).
- **Correction.** For iOS 17+, `_DKEvent.App.InFocus` includes start, end, write timestamp, bundle identifier, transition, and GUID, whereas `App.InFocus` is punctual and includes start, bundle, and background/foreground action. Both have roughly 28-day retention. SEGB write timestamps can be zero or differ from event occurrence time, so they must not silently replace start/end time. The post also identifies `ScreenTime.AppUsage`.
- **Counting.** This extends already-ledgered B3/B4 artifacts and is **not** counted as a new citation.

---

## Direct-field expansion — Slice B (2026-08-06)

These additions deliberately search beyond the first-pass author and citation neighborhoods. They retain only work that directly measures smartphone/device use, donates native mobile telemetry, or declares a consequential processing rule. Generic web analytics and clickstream sessionization are excluded.

### 72. Walsh, Regan, Okabe-Miyamoto & Lyubomirsky (2024) — *Does putting down your smartphone make you happier? The effects of restricting digital media on well-being*

- **Stable source.** [DOI 10.1371/journal.pone.0306910](https://doi.org/10.1371/journal.pone.0306910); preregistration [OSF `bv9dj`](https://osf.io/bv9dj/); materials, data, and R code [OSF `vpekx`](https://osf.io/vpekx/).
- **Why it matters here.** A comparatively transparent iPhone restriction experiment shows exactly where reproducibility stops: the investigators disclose screenshot transcription and analysis, but the upstream Screen Time builder remains Apple-defined.
- **Instrument and ladder rung.** iPhone on iOS 12 or later; participants submitted native Screen Time screenshots at pretest and posttest; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple.** The displayed weekly/daily Screen Time values were manually transcribed and checked; no raw foreground transitions were obtained.
- **Session threshold.** No event-joining or inactivity threshold. Experimental restriction was a behavioral instruction, not an episode-builder cutoff.
- **Availability.** Full paper, preregistration, deidentified data, materials, and R scripts are public; Apple’s event→aggregate implementation is not.
- **Access/quoted method.** Full open text, checked 2026-08-06. The method requires participants to submit “screenshots of their Screen Time usage.”

### 73. Rodman et al. (2024) — *Within-Person Fluctuations in Objective Smartphone Use and Emotional Processes During Adolescence*

- **Stable source.** [DOI 10.1007/s42761-024-00247-z](https://doi.org/10.1007/s42761-024-00247-z); [PubMed Central PMC11624186](https://pmc.ncbi.nlm.nih.gov/articles/PMC11624186/); coding materials [OSF `t36wd`](https://osf.io/t36wd/).
- **Why it matters here.** This is unusually explicit about harmonizing an instrumented Android stream with weekly iOS Screen Time donations over as long as twelve months.
- **Instrument and ladder rung.** Twenty iOS participants donated Screen Time screenshots; six Android participants used MetricWire; **mixed Rung 1/Rung 3**.
- **Episode reconstruction rule.** iOS values for duration, pickups/first app after opening, notifications, and app minutes were hand-coded per day, then aggregated monthly. App categories followed Apple App Store/Google Play descriptions. Apple’s underlying event builder remains **DELEGATED**.
- **Session threshold.** No inactivity or merge threshold is disclosed for iOS Screen Time. Monthly aggregation is declared but does not reconstruct sessions.
- **Availability.** Full article and coding materials are public; identifiable screenshots and Apple’s raw-event builder are not.
- **Access/quoted method.** Full open text, checked 2026-08-06. The paper says screenshots display “the total amount of time spent on their smartphone each day” and app-level use.

### 74. Yin et al. (2025) — *Associations Between Both Smartphone Addiction and Objectively Measured Smartphone Use and Sleep Quality and Duration Among University Students*

- **Stable source.** [DOI 10.2196/77796](https://doi.org/10.2196/77796).
- **Why it matters here.** A very large multisystem screenshot study (N=17,713) makes downstream categorization explicit while also naming the loss caused by vendor aggregates: no temporal sequence or functional context.
- **Instrument and ladder rung.** Previous full-week iOS Screen Time or Android Digital Wellbeing screenshots; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to the operating-system vendor.** Invalid or incomplete screenshots were excluded; retained weekly totals were categorized for analysis.
- **Session threshold.** Weekly screen-time bins were **0–21, 21–42, 42–63, and ≥63 hours**; unlock-frequency bins were likewise declared. These are outcome bins, not session timeouts.
- **Availability.** Full JMIR article is public; no raw operating-system events or vendor builder are available.
- **Access/quoted method.** Full open text, checked 2026-08-06. The limitations state that objective totals “lacked temporal and functional granularity.”

### 75. Wang et al. (2025) — *Objectively Measured Smartphone Use and Nonsuicidal Self-Injury Among College Students*

- **Stable source.** [DOI 10.2196/71264](https://doi.org/10.2196/71264); [PubMed Central PMC12310150](https://pmc.ncbi.nlm.nih.gov/articles/PMC12310150/).
- **Why it matters here.** Another large, cross-brand donation design (N=16,668) exposes the common two-stage ambiguity: researchers specify collection and bins but inherit each handset vendor’s undocumented usage builder.
- **Instrument and ladder rung.** Weekly screen-time and unlock-count screenshots from native phone settings, after participants enabled the recording feature two weeks earlier; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to iOS/Android and handset vendors.** The study screens submissions but does not receive foreground events.
- **Session threshold.** Screen time was binned at **21, 42, and 63 hours/week**; unlocks at **50, 150, and 400/week**. These analytic bins do not define an episode.
- **Availability.** Full paper is public; screenshot microdata, raw events, and vendor implementation are not reported as public.
- **Access/quoted method.** Full open text, checked 2026-08-06. Participants were required to upload screenshots of “weekly screen time and screen unlock frequency.”

### 76. Nesi et al. (2026) — *Objectively measured smartphone pickups among adolescents: Associations with daily positive and negative affect and mindfulness*

- **Stable source.** [DOI 10.1037/ppm0000601](https://doi.org/10.1037/ppm0000601).
- **Why it matters here.** A current adolescent intensive-longitudinal design connects daily native iOS pickup counts to fourteen days of EMA and demonstrates that pickup measures—not only duration—are being used as primary behavioral exposures.
- **Instrument and ladder rung.** Daily screenshots of iOS Screen Time pickups from 135 adolescents plus EMA; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple.** Daily pickup aggregates are donated; no raw unlock or foreground-transition builder is described.
- **Session threshold.** None disclosed. A “pickup” is Apple’s vendor-derived construct, not a researcher-declared temporal threshold.
- **Availability.** Bibliographic record and abstract were accessible; neither raw screenshots nor reconstruction code was located.
- **Access/quoted method.** Abstract/metadata only, checked 2026-08-06; the abstract identifies “daily screenshots of their iOS Screen Time pickup data.”

### 77. Reichenberger et al. (2026) — *Nighttime Smartphone Use Is Associated with Worse Sleep Among Firefighters: A Pilot Study*

- **Stable source.** [DOI 10.1093/sleep/zsag091.0389](https://doi.org/10.1093/sleep/zsag091.0389).
- **Why it matters here.** This pilot declares a rare post-donation transformation: custom OCR extracts iOS hourly bars, which are then aligned to calendar-day, wake-to-wake, evening, and overnight windows.
- **Instrument and ladder rung.** Two weeks of iOS Screen Time screenshots (iOS 16.1–18.5) or Android StayFree logs in 17 firefighters; **Rung 1**.
- **Episode reconstruction rule.** iOS hourly values were extracted by custom Python OCR; Android values were entered manually; usage was summed into declared windows. Upstream iOS episode construction is **DELEGATED**.
- **Session threshold.** No session timeout. Analysis windows were calendar day, wake-to-wake, **18:00–00:00**, and **00:00–06:00**.
- **Availability.** Conference abstract only; OCR code, data, and validation set were not located.
- **Access/quoted method.** Abstract, checked 2026-08-06; it reports that iOS use was “extracted using a custom Python optical character recognition pipeline.”

### 78. Chen et al. (2026) — *MOVE@NUS digital intervention cohort: Protocol for a cohort multiple randomised controlled trial among university students in Singapore*

- **Stable source.** [DOI 10.1186/s44167-026-00097-z](https://doi.org/10.1186/s44167-026-00097-z).
- **Why it matters here.** A current iPhone/Apple Watch protocol combines continuous HealthKit streams with repeated native Screen Time uploads, creating a direct example of multimodal alignment without access to raw iOS app-focus events.
- **Instrument and ladder rung.** iPhone, Apple Watch, Cogniss study app, HealthKit, and uploads from iOS Screen Time settings across sequential embedded trials; **mixed Rung 1/Rung 3**.
- **Episode reconstruction rule.** HealthKit collection is study-controlled, but Screen Time duration is **DELEGATED to Apple** and received as an aggregate.
- **Session threshold.** None for Screen Time. The intervention has sequential two-week trial periods, which are study windows rather than episode cutoffs.
- **Availability.** Full open protocol; no outcome dataset yet and no Apple event-builder implementation.
- **Access/quoted method.** Full open text, checked 2026-08-06; the protocol requires participants to upload “screen time data from their iOS settings.”

### 79. Mertens et al. (2026) — *Promoting Self-Regulated Social Media Use Through an Automated Digital Intervention (Wellspent): Randomized Controlled Trial*

- **Stable source.** [DOI 10.2196/56824](https://doi.org/10.2196/56824); [PubMed Central PMC13062480](https://pmc.ncbi.nlm.nih.gov/articles/PMC13062480/).
- **Why it matters here.** It separates two thresholds that surveys often conflate: a researcher-controlled in-session intervention trigger and an Apple-controlled outcome aggregate.
- **Instrument and ladder rung.** iPhone on iOS 16+, Wellspent intervention app, and participants’ native Screen Time records; **mixed Rung 1/Rung 3**.
- **Episode reconstruction rule.** The intervention displays a prompt after a selected-app session exceeds a user-defined limit. Daily outcome minutes were manually entered from Screen Time; Apple’s outcome builder is **DELEGATED**.
- **Session threshold.** Intervention threshold is participant-defined. Screen-time outliers with **|z| > 3.29** were winsorized to one unit above the largest valid value; neither rule is an Apple session-joining timeout.
- **Availability.** Full article and R code are public; participant data are private and Apple’s builder is unavailable.
- **Access/quoted method.** Full open text, checked 2026-08-06; the prompt appears when use “exceeded a self-defined time limit.”

### 80. Clifford, Doane & Lemery-Chalfant (2026) — *Heterogeneous Associations Between Objectively Measured Screen Time and Sleep in Early Adolescence*

- **Stable source.** [DOI 10.1037/tmb0000203](https://doi.org/10.1037/tmb0000203); [PubMed Central PMC13313597](https://pmc.ncbi.nlm.nih.gov/articles/PMC13313597/).
- **Why it matters here.** A large twin study directly combines seven days of scraped phone-use totals with actigraphy and models person-level heterogeneity rather than treating the average association as universal.
- **Instrument and ladder rung.** Study application scraped Android/iOS screen-time records after account access; 488 participants supplied screen time and 389 supplied actigraphy; **Rung 2** for acquired OS records.
- **Episode reconstruction rule.** The acquisition layer is described, but the iOS/Android foreground-event→duration rule is **DELEGATED** to the operating systems.
- **Session threshold.** No event-joining timeout disclosed. Seven consecutive days is the observation window.
- **Availability.** Full article is public; a raw-event builder and vendor source are not.
- **Access/quoted method.** Full open text, checked 2026-08-06; the study application “scraped screen time data in the background.”

### 81. Kosola, Mörö & Holopainen (2026) — *Objectively Measured Social Media Use and Psychosocial Wellbeing Among Adolescent Girls: A Prospective Study*

- **Stable source.** [DOI 10.64898/2026.05.25.26354016](https://doi.org/10.64898/2026.05.25.26354016) (medRxiv preprint).
- **Why it matters here.** This prospective data-donation study reports a consequential selection mechanism: participants who returned follow-up screenshots already had lower baseline social-media use.
- **Instrument and ladder rung.** Native iPhone Screen Time and other vendor dashboards (including Huawei Digital Balance); 564 baseline screenshot donors and 259 complete one-year follow-ups; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to each vendor.** Investigators extract displayed top-app duration; the top 3–10 displayed apps covered a median 84% of total use.
- **Session threshold.** No temporal joining threshold. Inclusion depends on a readable dashboard and adequate top-app coverage.
- **Availability.** Full preprint is public; no harmonized raw foreground-event builder is supplied.
- **Access/quoted method.** Full preprint, checked 2026-08-06. The authors explicitly compare participants “with and without follow-up screenshots,” making attrition part of the measurement threat.

### 82. Bakar Kahraman & Yeni Elbay (2026) — *Objective Screen Time and Smartphone Addiction Symptoms in Defining Risky Smartphone Use: A Cross-Sectional Study of University Students*

- **Stable source.** [DOI 10.1007/s11845-026-04470-4](https://doi.org/10.1007/s11845-026-04470-4).
- **Why it matters here.** It operationalizes “risky use” jointly from a native usage record and a symptom scale, illustrating how an explicit clinical-style cutoff can sit downstream of an opaque device aggregate.
- **Instrument and ladder rung.** Daily screen time read from the participant’s smartphone record plus SAS-SV questionnaire, N=297; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to the participant’s phone/vendor.** Exact OS mix and event→duration policy are not declared.
- **Session threshold.** Risky use was defined using **≥6 hours/day** objective use and/or the SAS-SV cutoff. This classification threshold is not a session timeout.
- **Availability.** Article text is accessible; neither device-event data nor reconstruction code was located.
- **Access/quoted method.** Full methods/metadata, checked 2026-08-06; the exposure is “objective screen time” obtained from the smartphone’s own record.

### 83. Geneş & Barçın (2025) — *Association Between Smartphone Screen Time and Exaggerated Blood Pressure Response During Treadmill Exercise Testing*

- **Stable source.** [DOI 10.1080/08037051.2025.2533452](https://doi.org/10.1080/08037051.2025.2533452).
- **Why it matters here.** Researchers directly observed native phone dashboards rather than accepting a recalled estimate, but still inherited Apple/Google aggregation—an important distinction between observation bias and construction bias.
- **Instrument and ladder rung.** Researcher-recorded prior-week average from iOS Screen Time or Android Digital Wellbeing; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple/Google.** Investigators transcribed the displayed average and did not reconstruct sessions.
- **Session threshold.** No session timeout disclosed; the prior seven days form the averaging window.
- **Availability.** Full article/PDF accessible; raw events, dashboard images, and vendor algorithms are not public.
- **Access/quoted method.** Full text, checked 2026-08-06; the researcher “directly observed and recorded” the native average daily screen time.

### 84. Cendrero-Luengo et al. (2026) — *A Scoping Review of Methods of Measuring Smartphone Usage*

- **Stable source.** [DOI 10.1016/j.anpedi.2026.504156](https://doi.org/10.1016/j.anpedi.2026.504156).
- **Why it matters here.** A current review of 89 pediatric studies documents field-wide instrument heterogeneity and supplies a counterweight to overinterpreting any single Screen Time cohort.
- **Instrument and ladder rung.** Scoping review of questionnaires, native records, and other smartphone-use measures; **review evidence spanning Rungs 0–3**.
- **Episode reconstruction rule.** No new builder. The review records measurement instruments but cannot harmonize undocumented vendor episode rules.
- **Session threshold.** No universal threshold; only seven included studies used standardized questionnaires, and heterogeneity precluded a pooled meta-analysis.
- **Availability.** Full open article; review search/method detail is available, but primary-study event builders generally are not.
- **Access/quoted method.** Full open text, checked 2026-08-06; the authors conclude that “heterogeneity” in measurement prevented meta-analysis.

### 85. Hrbáčková et al. (2025) — *What Role Do Self-Regulatory Mechanisms Play in the Risky Use of Digital Media by Adolescents?*

- **Stable source.** [DOI 10.3389/fpsyg.2025.1675778](https://doi.org/10.3389/fpsyg.2025.1675778).
- **Why it matters here.** It is a high-N example of “semi-objective” telemetry: adolescents read native dashboards themselves, which reduces recall length but retains transcription, compliance, and vendor-construction errors.
- **Instrument and ladder rung.** N=2,697; participant-transcribed value from iOS Screen Time or Android Digital Balance; **Rung 1 with self-transcription**.
- **Episode reconstruction rule.** **DELEGATED to vendors.** No screenshot proof or event records are retained.
- **Session threshold.** No session timeout. Screen-time values were log-transformed in sensitivity analysis; this is a statistical transformation, not episode construction.
- **Availability.** Full open article/PDF; no raw device events or builder code.
- **Access/quoted method.** Full open text, checked 2026-08-06; the authors call the measure “semi-objective.”

### 86. Cao et al. (2025) — *The Impact of Smartphone Use on Working Memory in College Students: A Functional Near-Infrared Spectroscopy Study*

- **Stable source.** [DOI 10.3389/fpsyt.2025.1725048](https://doi.org/10.3389/fpsyt.2025.1725048).
- **Why it matters here.** This neuroimaging study uses a fourteen-day device log to define extreme-use groups, showing how opaque native aggregates can become a hard biological exposure classifier.
- **Instrument and ladder rung.** Fourteen-day digital-usage log, with iOS Screen Time/Android Digital Wellbeing reports encouraged on compatible devices; **mixed Rung 0/Rung 1** because device proof was not universal.
- **Episode reconstruction rule.** **DELEGATED to vendors** where native reports were used; otherwise based on the study log.
- **Session threshold.** Heavy-use group **>9 hours/day** versus ≤9 hours/day, justified from cited prior work; not a sessionization timeout.
- **Availability.** Full open article; no raw native event stream or unified processing code was located.
- **Access/quoted method.** Full open text, checked 2026-08-06; compatible participants were encouraged to provide “iOS Screen Time or Android Digital Wellbeing” records.

### 87. Yaakoubi et al. (2026) — *Screen Time, Smartphone Addiction, and Executive-Motor Function in Tunisian Middle School Students*

- **Stable source.** [DOI 10.3389/fpsyg.2026.1694094](https://doi.org/10.3389/fpsyg.2026.1694094).
- **Why it matters here.** The eligibility rule explicitly removes shared devices and active focus/downtime controls, acknowledging conditions under which native usage aggregates cease to represent the individual or the full opportunity to use.
- **Instrument and ladder rung.** One week of built-in iOS/Android usage logs, N=270; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple/Android vendors.** Shared devices and devices with active Downtime/Focus were excluded.
- **Session threshold.** No session timeout. The study uses a seven-day measurement window and downstream addiction-scale cutoffs.
- **Availability.** Full open article; no raw foreground events or vendor algorithm.
- **Access/quoted method.** Full open text, checked 2026-08-06; eligibility excludes “shared devices” and active “Downtime/Focus” controls.

### 88. Wadsley & Ihssen (2023) — *Restricting Social Networking Site Use for One Week Produces Varied Effects on Mood but Does Not Increase Explicit or Implicit Desires to Use SNSs*

- **Stable source.** [DOI 10.1371/journal.pone.0293467](https://doi.org/10.1371/journal.pone.0293467).
- **Why it matters here.** An iPhone-only EMA experiment collects native objective use repeatedly at baseline, intervention, and postintervention rather than relying on a single end-of-study recollection.
- **Instrument and ladder rung.** iOS Screen Time totals for social-networking apps and total iPhone use plus EMA; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple.** Investigators analyze donated aggregate minutes, not raw transitions.
- **Session threshold.** No session timeout. The restriction lasts one week; measurement phases are study windows.
- **Availability.** Full PLOS article and supplementary material are public; Apple’s raw-event builder is not.
- **Access/quoted method.** Full open text, checked 2026-08-06; Screen Time provides “objective measures of SNS and total iPhone use.”

### 89. Zhang et al. (2026) — *Synchronizing Screen Time: Do Self-Reported and Actual Smartphone Usage Align?*

- **Stable source.** [SSRN abstract 6378327](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6378327) (preprint; no Crossref DOI located on 2026-08-06).
- **Why it matters here.** A large, current screenshot-donation preprint uses automated image recognition and finds a sizeable central discrepancy between recalled and native-dashboard use.
- **Instrument and ladder rung.** Participant report of the prior seven days plus uploaded native usage screenshots; keyword extraction indicates AI-assisted image recognition; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to heterogeneous phone vendors.** The paper processes dashboard images, not raw foreground events.
- **Session threshold.** No session timeout. Median objective use was **6.7 hours/day** versus **5.0 self-reported hours/day**.
- **Availability.** Abstract/preprint landing page accessible; extraction code, screenshot validation set, and raw images were not located.
- **Access/quoted method.** Abstract/metadata, checked 2026-08-06; participants provided “screenshots” of actual smartphone use.

### 90. Colston et al. (2026) — *Quantifying and Reducing Secure Messaging Interruptions: Mobile OS Analytics and Native Platform Features*

- **Stable source.** AMIA 2026 Clinical Informatics Conference poster/proceedings record (title and authors; no DOI located on 2026-08-06).
- **Why it matters here.** This clinician-workflow study uses iOS Screen Time donations for app time, pickups, and notifications, extending direct device analytics outside the usual adolescent/well-being clusters.
- **Instrument and ladder rung.** iOS Screen Time donations across 21 advanced-practice-provider devices, including app time, pickups, and notification counts; **Rung 1**.
- **Episode reconstruction rule.** **DELEGATED to Apple.** Counts and duration are copied from vendor analytics; no event-level builder is disclosed.
- **Session threshold.** No session timeout. The reported rate—approximately one interruption every 12 minutes—is a derived descriptive rate, not a joining rule.
- **Availability.** Conference poster/abstract available; source telemetry and reconstruction code were not located.
- **Access/quoted method.** Poster/abstract, checked 2026-08-06; the data fields are “time-on-app, pickups, and notifications.”

### Slice B expansion count

- **New records:** B72–B90 = **19**.
- **Authoritative Slice B total:** **90** records.
- **Scope guard:** direct native mobile/device measurement, intervention telemetry, or measurement-method review only; generic web/clickstream work excluded.

## Fresh iOS/native and intervention additions from Pro discovery — 2026-08-06

These five records are new by stable key/title. The first three are deliberately labelled forensic or
technical artifacts rather than peer-reviewed papers. Their value is the executable predicate, clock,
and extraction detail missing from most Screen Time studies.

### 91. Notari (2023–2025) — *iOS Unified Logs: Introduction, Screen Unlock and App Opening*

- **Stable source.** [Open technical analysis](https://www.ios-unifiedlogs.com/post/ios-unified-logs-unlock); key `ios-unifiedlogs-unlock-2023`.
- **Why / rung.** Unified Log predicates across SpringBoard, application state/focus, `apsd`, and related process messages; **Rung 1/2 forensic events**.
- **Construction.** Documents lock/unlock traces, prior-lock duration, activity identifiers, and alternative indicators for app launch, foreground/focus, home return, and exit.
- **Failure semantics.** Duplicate indicators, short/version-dependent retention, and predicate ambiguity require multi-message interpretation; there is no canonical cross-version episode builder.
- **Availability/status.** Public practitioner article with query examples; no DOI or population raw-log corpus. **Grey technical evidence.**

### 92. Notari (2025) — *iOS Unified Logs Parser* and SQL query library

- **Stable source.** [Parser article](https://www.ios-unifiedlogs.com/post/ios-unified-logs-my-parsing-tool-is-out); [SQL rules](https://www.ios-unifiedlogs.com/post/ios-unified-logs-parsing-all-my-sql-queries); key `ios-unifiedlogs-parser-sql-2025`.
- **Why / rung.** Open `.logarchive`→JSON/SQLite conversion with timestamp, mach timestamp, boot UUID, process, log number, and activity identifier; **Rung 1/2**.
- **Construction.** Executable SQL labels cover app state, lock/unlock, notifications, gestures, scrolling, wall-clock/timezone, boot, and shutdown; extraction emits row counts, hashes, and QC checks.
- **Failure semantics.** Full-log extraction before filtering is recommended because filtered and full extractions can disagree; rules remain version-dependent and do not form one validated behavioral ontology.
- **Availability/status.** Parser, SQL, and documentation public; no open longitudinal corpus. **Grey executable artifact.**

### 93. Williamson & Strong (2022) — *Time Well Spent: Precision Timing, Monotonic Clocks, and the PowerLogs Database for iOS*

- **Stable source.** [Forensic Focus presentation/article](https://www.forensicfocus.com/webinars/time-well-spent-precision-timing-monotonic-clocks-and-the-powerlogs-database-for-ios/); key `powerlogs-monotonic-clocks-2022`.
- **Why / rung.** PowerLog application/screen/timezone records and wall-clock/monotonic fields; **Rung 1/2**.
- **Construction.** `mach_absolute_time` pauses during sleep while `mach_continuous_time` does not; both are reboot-relative. Correct wall time requires the applicable historical system/baseband offset.
- **Failure semantics.** Writes are batched about every 15 min or when queues fill, so occurrence and database-write times differ; manual clock changes affect offsets rather than monotonic ordering.
- **Availability/status.** Public forensic analysis; no code/raw corpus verified. **Grey technical evidence.**

### 94. Grüning, Riedel & Lorenz-Spreen (2023) — *Directing Smartphone Use Through the Self-Nudge App one sec*

- **Stable source.** [DOI 10.1073/pnas.2213114120](https://doi.org/10.1073/pnas.2213114120); [open PMC article](https://pmc.ncbi.nlm.nih.gov/articles/PMC9974409/); [OSF data](https://osf.io/p4wy6/).
- **Why / rung.** Cross-platform/iOS-focused target-app-open interception with behavioral monitoring; **Rung 3 intervention episodes**.
- **Construction.** A target-app attempt triggers a 10-s deliberation/friction step and a continue/dismiss state. Users dismissed 36% of attempts; attempts fell from 166 to 105/week over six weeks.
- **Failure semantics.** Exact trigger/response states are observable, but this is not total-device session reconstruction and missing-trigger behavior is unstated.
- **Availability.** Full article and analysis data public; app source closed.

### 95. Haliburton et al. (2024) — *A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse*

- **Stable source.** [DOI 10.1145/3613904.3642370](https://doi.org/10.1145/3613904.3642370).
- **Why / rung.** Longitudinal one sec target-app trigger/resolution records; **Rung 3**.
- **Construction.** Delay is configurable 3–60 s (default 6 s); dismiss returns home and continue opens the app. History >309 days is excluded; a break is a gap >2,890 min/48.2 h.
- **Failure semantics.** Trigger, resolution, cutoff, and break rules are explicit; pre-install behavior, non-target apps, and silent attrition are unobserved.
- **Availability.** Primary paper, dataset, and analysis scripts public.

### Slice B fresh-discovery count

- **New records:** B91–B95 = **5**.
- **Authoritative Slice B total:** **95** records.
- **Direct conclusion:** practitioner Unified Log and PowerLog work exposes event predicates, boot-relative clocks, offset histories, and delayed writes that native-dashboard studies hide. It still does not reveal Apple’s Screen Time builder or supply a validated cross-version episode implementation.

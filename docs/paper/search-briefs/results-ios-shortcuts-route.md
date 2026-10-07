# Getting granular Screen Time data off an iPhone — Shortcuts / App Intents / Screen Time API / DeviceActivity

**Question:** is there any route by which a person can get their own granular Screen Time data off an iPhone, as of iOS 26?

**Research date:** 2026-08-05. Sources: developer.apple.com (documentation JSON renderer), apple.com/legal, support.apple.com. Every claim below carries a verbatim quote and a URL.

---

## HEADLINE ANSWER

**Two routes exist that the prior agent missed. Both are real; neither is a clean general-purpose export.**

**Route A — developer API, iOS 26.4, EU-only.** `DeviceActivityData.activityData(filteredBy:using:)`, whose documentation states in as many words:

> "Use this method to export family activity data, for use in another app or platform."
> — <https://developer.apple.com/documentation/DeviceActivity/DeviceActivityData/activityData(filteredBy:using:)>

This is the first Apple-sanctioned route by which granular per-app Screen Time data (duration, pickups, notifications) can leave the device. It reverses the historic `DeviceActivityReport` sandbox prohibition — but it is gated by four hard conditions, including that **customer installations only work on devices located in the EU signed in with an EU Apple Account**, and that **only one app per device** may hold the grant. Finest granularity is **hourly buckets** (§3d), not raw events.

**Route B — a Shortcuts action, iOS 26.0, output unknown.** Apple shipped a Screen Time action called **"Get App & Website Data"** in iOS 26 (§1a). Apple publishes its *name only* — no parameters, no output type, no description, anywhere. Whether it returns per-app usage totals is **UNVERIFIED and cannot be resolved from any Apple web source**; it requires adding the action on an iOS 26 device and reading the in-app description. This is the single highest-value open question in this brief, and it is cheap to answer with a device in hand.

**Accuracy note on the prior agent.** Its conclusion was right about the surfaces it checked (iOS 26 release notes, Data & Privacy export, DeviceActivity docs) and wrong-by-omission about two others. Both misses have the same cause: **the iOS 26 release notes and the WWDC25 index mention neither** (§4). The export API is documented only in the framework reference; the Shortcuts action is documented only in a support KB. Checking release notes was not sufficient.

---

## 1. Shortcuts actions for Screen Time

### 1a. Exactly one exists: "Get App & Website Data" (new in iOS 26)

Apple documents **one** Screen Time Shortcuts action, and publishes its *name and nothing else*.

From <https://support.apple.com/en-us/125148> — "What's new in Shortcuts for iOS, iPadOS, macOS, watchOS, and visionOS 26" — under the `<h2>` heading **"New in iOS, iPadOS, macOS, watchOS, and visionOS 26"**, in the New Actions list, verbatim:

> Screen Time
> "Get App & Website Data" (iOS, iPadOS, and macOS)

*(I verified this independently of the research lane by fetching the page and confirming the entry's nearest preceding heading is the "26" heading — i.e. it shipped in **iOS 26.0**, not a point release. The adjacent entries in the same list are Messages "Find Conversation" and Sports "Get Upcoming Sports Events".)*

**What it returns is UNVERIFIED.** Apple publishes no parameters, no output type, no granularity, no description. This was checked against: the iOS 26 Shortcuts User Guide, the macOS Shortcuts User Guide, the iPhone User Guide Screen Time section, Mac Help, developer.apple.com (App Intents, DeviceActivity, ManagedSettings, FamilyControls), the WWDC26 Shortcuts session, and Apple's iOS 26 feature PDF. None describes it.

**Structural reason this is hard to pin down:** *Apple has never published a per-action reference for Shortcuts.* The Shortcuts User Guide TOCs for iOS 26 (v9.0, 102 entries), 18, 17, 16, 15, 14 and the separate macOS guide (81 entries) contain **no action catalog**. The commonly-cited slug `support.apple.com/guide/shortcuts/apple-apps-actions-apd8b0d0a3c5/ios` **302-redirects to `/guide/shortcuts/welcome/ios` — it does not exist**. Apple's only action enumerations are the four "What's new in Shortcuts" KB articles.

The one Apple-sourced signal about its direction (labelled **inference, not fact**) is naming convention, from <https://support.apple.com/guide/shortcuts/get-actions-apd5c2bd430f/9.0/ios/26>:

> "Get actions collect content and add it to a shortcut. As you build your shortcut, you can search for get actions in the action list by entering keywords like get, search, find, and select. Actions like Get Latest Photos, Search Local Businesses, and Find Music look into their respective apps, get content, and then send it to the next action."

By that convention a "Get …" action produces output rather than setting state. Apple never states this for this action specifically.

The name also maps precisely onto Apple's own label for the usage-data subsystem. From <https://support.apple.com/guide/iphone/get-started-with-screen-time-iphbfa595995/ios>:

> "Tap App & Website Activity, then tap Turn On App & Website Activity."
>
> "Any time after you turn on Screen Time, you can view a report of your device use, including how much time you spend using certain kinds of apps, how often you pick up your iPhone and other devices, which apps send you the most notifications, and more."
>
> "Screen Time automatically groups your activity into categories—like Entertainment and Creativity."

Suggestive, not proof.

### 1b. Every other candidate action name: UNVERIFIED

All four Apple Shortcuts changelogs were grepped — **101583** (iOS 16.0–16.5), **111098** (iOS 17), **121131** (iOS 18), **125148** (iOS 26). Across all four, the strings `App Limit`, `Downtime`, `Communication Limit`, `Usage`, and `Report` appear **zero times**. `Screen Time` appears **once**, in the entry quoted above.

| Candidate name | Status |
|---|---|
| **Get App & Website Data** | **VERIFIED** — iOS 26, Screen Time category; output UNVERIFIED |
| "Set Screen Time" | UNVERIFIED — no Apple source |
| "Get Screen Time" | UNVERIFIED — no Apple source |
| "Turn Screen Time On/Off" | UNVERIFIED — no Apple source |
| "Set App Limit" / "Get App Limits" | UNVERIFIED — no Apple source |
| "Set Downtime" / "Turn Downtime On/Off" | UNVERIFIED — no Apple source |
| "Set Communication Limits" | UNVERIFIED — no Apple source |
| "Get Screen Time Report" | UNVERIFIED — no Apple source |
| "Get Usage" | UNVERIFIED — no Apple source |
| "Set Do Not Disturb" | UNVERIFIED as an action name; Apple uses the string only as a *Focus* example |
| "Set Focus" | UNVERIFIED — never named in any Apple changelog or guide page |

**Carry this caveat:** the changelogs only cover iOS 16.0 onward and Apple publishes no cumulative catalog. Here "UNVERIFIED" means *Apple has not documented it* — not *Apple has documented that it doesn't exist*.

The question's premise that "Screen Time gained Shortcuts-adjacent automation (Set Screen Time, app limits automations) at some point" is **not supported by any Apple source I or the research lane could find**. What Apple *does* document in that neighbourhood is **Focus**, not Screen Time:

- <https://support.apple.com/en-us/101583> (iOS 16.1): "Get Current Focus enables checking current Focus status" — an explicit reader
- same page (16.0): "Configure Focus Filter actions allow setting Focus Filters for apps"
- <https://support.apple.com/en-us/121131> (iOS 18.0): "Music — 'Set Music Focus Filter' is available on iOS and iPadOS"

### 1c. Screen Time as a Personal Automation trigger: VERIFIED ABSENT

The iOS 26 Shortcuts User Guide enumerates personal-automation triggers exhaustively across four pages. Screen Time appears in **none**.

> "Choose a trigger, such as Time of Day or Arrive. See Event triggers, Travel triggers, Communication triggers, or Setting triggers."
> — <https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/9.0/ios/26>

Complete trigger inventory:
- **Event**: Time of Day (Sunrise / Sunset / Time of Day / Repeat), Alarm, Sleep ("Wind Down Begins", "Bedtime Begins", "Waking Up"), Apple Watch Workout, Sound Recognition — <https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/9.0/ios/26>
- **Travel**: Arrive, Leave, Before I Commute, CarPlay — <https://support.apple.com/guide/shortcuts/travel-triggers-apd8ebfc4e8e/9.0/ios/26>
- **Communication**: Email, Message — <https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/9.0/ios/26>
- **Setting**: Wi-Fi, Bluetooth, Focus, Low Power Mode, Battery Level, Charger, NFC, App, Airplane Mode — <https://support.apple.com/guide/shortcuts/setting-triggers-apde31e9638b/9.0/ios/26>

The two closest neighbours carry no usage data:

> "The App trigger has the following options: App: Tap Choose, then select an app from the list. Is Opened: Triggers your automation when you open or switch to the selected app. Is Closed: Triggers your automation when you close or switch from the selected app."
> — Setting triggers page

The App trigger fires on open/close but Apple describes **no variable, payload, or duration** attached to it. There is no "app limit reached", "downtime started", or "usage threshold crossed" trigger. **Because no Screen Time trigger exists, the sub-question about a usage-carrying trigger variable is moot.**

Three automation types new in iOS 26 (guide not yet updated to list them) — none Screen Time:

> "In iOS 26, Automations are easier to discover in the Shortcuts editor. There are three new automation types - screenshot, keyboard connection, and notification. The notification automation enables fine-grained, keyword-filtered triggers based on notification content."
> — <https://developer.apple.com/videos/play/wwdc2026/310/> ("What's new in Shortcuts", WWDC26 session 310). `Screen Time` appears zero times on that page.

### 1d. No App Intents surface backs any of this

**Verified by me:** there is **no** Screen Time / Device Activity App Intents surface at all.

- The App Intents **app-intent-domains** list contains 28 entries. The complete set of schema domains is: assistant, audio, books, browser, calendar, camera, clock, files, journaling, mail, maps, messages, notes, phone, photos, presentation, reader, reminders, spreadsheet, system-and-in-app-search, visual-intelligence, whiteboard, word-processor (plus base types and the three schema macros).
  — <https://developer.apple.com/documentation/appintents/app-intent-domains>
  A full-text scan of that page's JSON for `Screen Time`, `ScreenTime`, `DeviceActivity`, `parental`, `Parental` returns **0 occurrences of each**.
- A full-text scan of the **App Intents Updates** page for `Screen Time`, `ScreenTime`, `DeviceActivity`, `FamilyControls`, `parental`, `usage`, `Usage` returns **0 occurrences of each**.
  — <https://developer.apple.com/documentation/updates/appintents>
- None of the 404 symbols across DeviceActivity, FamilyControls and ManagedSettings (full enumeration, see §4) is an `AppIntent`, `AppEntity`, or `AppEnum` conformance. There is no vended Shortcuts action in any of the three Screen Time frameworks.

**Consequence:** even a developer holding the new iOS 26.4 entitlement cannot surface Screen Time data *into* Shortcuts as an action output, because the frameworks vend no App Intent. Any Shortcuts-based route would have to be a first-party Apple action.

---

## 2. App Intents / ManagedSettings / FamilyControls / DeviceActivity — read vs. set

### 2a. What the frameworks are for (Apple's own framing)

> "Managed Settings provides a privacy-preserving way for users to restrict access to certain settings and features on their devices. With the user's permission, your app can limit media showings, restrict app purchases, lock passcode settings, and configure other device behavior."
> — <https://developer.apple.com/documentation/managedsettings>

> "Device Activity provides a privacy-preserving way for an application to monitor a person's application and website activity. For instance, you can set up a bedtime schedule that monitors device activity while the person is supposed to be asleep. Your app extension can receive warnings before an activity's schedule starts or ends, or when an activity is about to reach a predefined threshold."
> — <https://developer.apple.com/documentation/deviceactivity>

Note what `DeviceActivityMonitor` delivers: **threshold-crossing callbacks**, not values. The extension learns *that* a threshold was reached, not *how much* time was spent.

### 2b. `ManagedSettingsStore` is write-mostly

> "Use the settings objects to inspect your application's current configurations as well as apply new configurations. Changing the value of a setting to `nil` deletes your app's configuration for that setting from the device. The system doesn't guarantee that the settings you specify govern the device's behavior. The system is responsible for determining its effective state based on all the settings it receives."
> — <https://developer.apple.com/documentation/managedsettings/managedsettingsstore>

"inspect your application's current configurations" = read back **your own writes**. It is not a window onto system Screen Time state.

The only genuine system-state reads exposed are media ratings:

> "In a few cases, you can also access the effective settings. For example, a media app can access the effective rating settings to filter the content it offers, even though it doesn't provide configurations for these or any other settings. Subscribe to `$effectiveMaximumTVShowRating` or `$effectiveMaximumMovieRating` to determine what TV shows or movies to offer."
> — same URL

`ManagedSettingsStore` carries **no usage data whatsoever**. It is not an export path.

### 2c. Historically, app identity itself was withheld

Before iOS 26.4, even the *identity* of apps was opaque:

> "Managed Settings uses a `Token` to preserve user privacy and prevent anyone outside of a Family Sharing group from identifying what apps and websites the family accesses. You can use tokens to restrict and filter device use without accessing personal information."
> — <https://developer.apple.com/documentation/managedsettings/token>

> "To protect the user's privacy, `FamilyActivitySelection` holds opaque values that represent categories, applications, and web domains selected by the user."
> — <https://developer.apple.com/documentation/familycontrols/familyactivityselection>

So pre-26.4 the double lock was: (i) durations trapped in the report extension sandbox, (ii) app identities are opaque tokens meaningless outside the device.

### 2d. The DeviceActivityReport extension sandbox — CONFIRMED

The prior agent's finding is correct and the text is still live as of this fetch:

> "When you create a report, the system asks your app's device activity report extension to provide a View representing the user's device activity. **To protect the user's privacy, your extension runs in a sandbox. This sandbox prevents your extension from making network requests or moving sensitive content outside the extension's address space.** The extension point identifier for all device activity report extensions is `com.apple.deviceactivityui.report-extension`."
> — <https://developer.apple.com/documentation/deviceactivity/deviceactivityreport> (emphasis added)

Note the restriction is stated **twice over**, and the second clause is the load-bearing one: not merely "no network", but "**no moving sensitive content outside the extension's address space**". That phrasing forecloses the workarounds the question asks about:

- **Shared app group container** — writing computed durations to a shared container *is* moving sensitive content outside the extension's address space. Foreclosed by the documented restriction.
- **User-initiated share sheet** — same; the content would leave the address space.
- **`ManagedSettingsStore` as a side channel** — foreclosed both by the above and by §2b (the store holds settings, not usage values).

**UNVERIFIED:** Apple does not publish a per-mechanism enumeration of what the sandbox blocks (no seatbelt profile is documented). The documented rule is the single sentence above. I found no Apple text separately naming app groups, pasteboard, share sheet, or Darwin notifications. The blanket phrasing covers them, but the *enforcement mechanism* for each is UNVERIFIED.

**UNVERIFIED:** I could not obtain a verbatim WWDC transcript passage on the sandbox. WWDC22 session 110336 "What's new in Screen Time API" (<https://developer.apple.com/videos/play/wwdc2022/110336/>) covers `DeviceActivityReport.Context`, `DeviceActivityFilter`, `DeviceActivityReportScene`, `makeConfiguration()` and SwiftUI rendering, but its transcript does **not** discuss sandbox restrictions, network access, or data egress. The framework documentation quoted above is the authoritative statement.

### 2e. The iOS 26.4 change: identity de-tokenization

`FamilyActivityData` (**new in iOS 26.4**):

> "An interface to a person's family activity data."
>
> "To fetch a person's family activity data, use `installedApplications`, `visitedWebDomains`, or `activityCategories` based on the type of data you need.
> You can develop and test an app that uses this class on devices in any region. **Customer installations of your app can only use the class on devices located in the EU that are signed in with an Apple Account with an EU country or region.**
> Your app's authorization status needs to be `AuthorizationStatus.approvedWithDataAccess` to use this class.
> Your app needs the `Family Controls App and Website Usage` entitlement to use this class."
> — <https://developer.apple.com/documentation/familycontrols/familyactivitydata> (emphasis added)

Members, all iOS 26.4:

| Member | Documented abstract | Documented shape |
|---|---|---|
| `installedApplications` | "Applications someone installs on a device." | "Each application contains both a `bundleIdentifier` and a `token`." |
| `visitedWebDomains` | "Web domains someone visits on their device." | "Each web domain contains both a `domain` and a `token`." |
| `activityCategories` | "The set of all possible activity categories." | "Each category contains both a `localizedDisplayName` and a `token`." |

— <https://developer.apple.com/documentation/familycontrols/familyactivitydata/installedapplications>, `/visitedwebdomains`, `/activitycategories`

Declaration: `var installedApplications: [Application] { get async throws }`

The new authorization status:

> "The person, parent, or guardian approved the request for authorization with access to non-tokenized family activity data.
>
> This status grants everything that `AuthorizationStatus.approved` allows, and additionally lets your app use `FamilyActivityData` to fetch **the actual bundle identifiers of installed applications, domain names of visited websites, and display names of activity categories** instead of the opaque, tokenized representations returned under `AuthorizationStatus.approved`. **It also grants access to `activityData(filteredBy:using:)`.**
>
> **Only one app at a time can hold this authorization status on a given device.** If a person grants data access to a different app, your app's status reverts to `.notDetermined`.
>
> You may develop and test an app that achieves this status on devices in all regions by using an Apple-provided provisioning profile. **Customer installations of your app can only achieve this status on devices located in the EU that are signed in with an Apple Account with an EU country or region. On devices outside the EU, `authorizationStatus` never returns `approvedWithDataAccess`, and any attempt to access `FamilyActivityData` properties fails with `FamilyControlsError.unavailable`.**"
> — <https://developer.apple.com/documentation/familycontrols/authorizationstatus/approvedwithdataaccess> (emphasis added)

The new entitlement:

> "A Boolean value that indicates whether the app may, with the person's permission, access app and website usage information from the current device.
>
> You must add this entitlement to your app before you access app and website usage information through the `Family Controls` and `Device Activity` frameworks. This includes obtaining the `AuthorizationStatus.approvedWithDataAccess` authorization status, which lets your app use `FamilyActivityData` to retrieve the actual bundle identifiers of installed applications, domain names of visited websites, and display names of activity categories. Your app requires explicit authorization from the person before it can access any of this data."
> — <https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.family-controls.app-and-website-usage>

---

## 3. `DeviceActivityReport` / `totalActivityDuration` — can the computed values get out?

### 3a. Inside a report extension: NO (unchanged)

The restriction in §2d is unchanged and still current. A `DeviceActivityReport` extension may **render** `totalActivityDuration` into a SwiftUI `View` and nothing else. The exact documented restriction, once more, verbatim:

> "To protect the user's privacy, your extension runs in a sandbox. This sandbox prevents your extension from making network requests or moving sensitive content outside the extension's address space."
> — <https://developer.apple.com/documentation/deviceactivity/deviceactivityreport>

Additionally the view is composited by the system — the host app embeds `DeviceActivityReport` as a SwiftUI view but the pixels are produced out-of-process. The host app never sees the numbers.

**UNVERIFIED:** Apple does not document whether the host app can screenshot the composited report view, nor whether the view is redacted in screenshots/screen recording. No Apple statement found either way.

### 3b. Outside the extension, iOS 26.4+: YES, under four conditions

```swift
static func activityData(
    filteredBy filter: DeviceActivityFilter = .init(),
    using policy: DeviceActivityData.Policy = .cached
) -> some AsyncSequence<DeviceActivityData, any Error>
```
— <https://developer.apple.com/documentation/DeviceActivity/DeviceActivityData/activityData(filteredBy:using:)>

Documentation, verbatim and complete:

> "Requests device activity data using a filter."
>
> Parameters: "The filter to use when fetching activity data." / "The policy to use when fetching activity data."
> Returns: "A sequence of device activity data for the given filter."
>
> "**Use this method to export family activity data, for use in another app or platform.**
> You can develop and test an app that uses this method on devices in any region. **Customer installations of your app can only use the method on devices located in the EU that are signed in with an Apple Account with an EU country or region. Otherwise, it throws an error.**
> Your app's authorization status needs to be `AuthorizationStatus.approvedWithDataAccess` to use this method.
> Your app needs the `Family Controls App and Website Usage` entitlement to use this method."
> — same URL (emphasis added)

**The four conditions, all of which must hold:**
1. `com.apple.developer.family-controls.app-and-website-usage` entitlement (Apple-reviewed capability request).
2. `AuthorizationStatus.approvedWithDataAccess` — explicit user grant, **exclusive to one app per device**.
3. Device physically located in the EU **and** signed in with an EU-country Apple Account. Outside the EU the status is never granted and the call throws.
4. iOS/iPadOS 26.4 or later.

### 3c. What the exported data actually contains

The returned `DeviceActivityData` exposes (all iOS 16 shapes, now reachable outside the sandbox):

- `user`, `device` — `DeviceActivityData.User` / `.Device`
- `activitySegments` → `DeviceActivityResults<DeviceActivityData.ActivitySegment>`, `segmentInterval`, `lastUpdatedDate`
- `ActivitySegment` ("Activity data for a specific time interval"): `dateInterval`, `totalActivityDuration`, `longestActivity`, `firstPickup`, `totalPickupsWithoutApplicationActivity`, `categories`
- `ApplicationActivity`: `application`, **`totalActivityDuration`** ("Access the total activity time for this application."), `numberOfPickups`, `numberOfNotifications`
- `CategoryActivity`, `WebDomainActivity`

— <https://developer.apple.com/documentation/deviceactivity/deviceactivitydata>, `/activitysegment`, `/applicationactivity`, `/applicationactivity/totalactivityduration`

New fetch policy (iOS 26.4): `DeviceActivityData.Policy` — "The policy for fetching activity data" — with cases `cached` and `live`.
— <https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/policy>

New error type (iOS 26.4): `DeviceActivityData.Error` — "Errors that may occur when attempting to fetch activity data" — cases `unavailable`, `unauthorized`, `missingData`.
— <https://developer.apple.com/documentation/deviceactivity/deviceactivitydata/error>

**This is genuinely granular**: per-application duration, pickup counts, and notification counts, segmented by time interval, with real bundle identifiers. It is materially comparable in granularity to a Chronicle Android app-usage export, though segment-aggregated rather than raw event-level.

### 3d. Segment granularity — VERIFIED: hourly is the floor

`DeviceActivityFilter.SegmentInterval`:

> "A type indicating the interval at which the system subdivides device activity data within a specified date interval."

Enumeration cases, complete: **`hourly(during:)`, `daily(during:)`, `weekly(during:)`**.
— <https://developer.apple.com/documentation/DeviceActivity/DeviceActivityFilter/SegmentInterval-swift.enum>

**The finest available granularity is hourly.** Apple exposes no per-session, per-event, or sub-hour segmentation. There is no documented access to raw start/stop event timestamps anywhere in the framework.

The filter can also scope by user, device, applications, categories and web domains:
- `DeviceActivityFilter` initializers: `init(segment:devices:applications:categories:webDomains:)` and `init(segment:users:devices:applications:categories:webDomains:)`
- properties: `applications`, `categories`, `devices`, `segmentInterval`, `users`, `webDomains`; nested `Devices` and `Users` structs
— <https://developer.apple.com/documentation/deviceactivity/deviceactivityfilter>

**Implication for Chronicle-style research:** this is **not** equivalent to an Android raw-event export. Chronicle Android yields discrete app-usage events with start/stop timestamps that the matcher pairs into sessions; the iOS export yields **hourly-bucketed aggregates** (`totalActivityDuration`, `numberOfPickups`, `numberOfNotifications` per app per hour). Session-level reconstruction, proximity merging, and overlap splitting — the core of this repo's matcher — have no iOS input to operate on. `longestActivity` and `firstPickup` on `ActivitySegment` are the only session-shaped values, and they are one-per-segment summaries.

---

## 4. iOS 26 additions — complete enumeration

I enumerated **all 404 symbols** across DeviceActivity, FamilyControls and ManagedSettings via Apple's documentation index endpoints (`https://developer.apple.com/tutorials/data/index/<framework>`), then fetched each symbol's availability metadata. Zero unresolved. **32 symbols carry an iOS 26.x `introducedAt`; none carries iOS 27.**

| iOS | Symbol | Relevance |
|---|---|---|
| 26.0 | `ManagedSettingsStore.effectiveDenyExplicitContent` | not usage data |
| 26.2 | `View.familyActivityPicker(title:headerText:footerText:isPresented:selection:)` | UI only |
| **26.4** | **`DeviceActivityData.activityData(filteredBy:using:)`** | **the export API** |
| **26.4** | **`DeviceActivityData.Policy` (+ `.cached`, `.live`)** | **export fetch policy** |
| **26.4** | **`DeviceActivityData.Error` (+ `.unavailable`, `.unauthorized`, `.missingData`, `errorDescription`)** | **export errors** |
| **26.4** | **`AuthorizationStatus.approvedWithDataAccess`** | **the new grant** |
| **26.4** | **`FamilyActivityData` (+ `shared`, `installedApplications`, `visitedWebDomains`, `activityCategories`)** | **de-tokenized identity** |
| 26.4 | `FamilyControlsError.unauthorized` | export errors |
| 26.4 | `ShieldAction.{first,second,third}SecondarySubmenuItemPressed` | shield UI |
| 26.4 | `ShieldConfiguration.secondaryButtonSubmenuItems` + new initializer | shield UI |
| 26.5 | `ManagedSettingsStore.{deleteStore(),deleteStores(_:),isActive,refresh(_:)×3,stores,TokenExpiryMessage}` | store management |
| 26.5 | `ShieldActionResponse.openParentalControlsApp` | shield UI |

**Nothing shipped in iOS 26.0.** The export capability landed in the **26.4** point release. This is exactly why a check of the iOS 26.0 release notes and the DeviceActivity landing page finds nothing.

### Release-note cross-check

- iOS & iPadOS **26.0** release notes: `Screen Time` 0 hits, `DeviceActivity` 0, `FamilyControls` 0, `ManagedSettings` 0. Only Shortcuts hit is "Fixed: The Create Image action fails to appear in Shortcuts app and Spotlight. (153235442)". — <https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-26-release-notes>
- iOS & iPadOS **26.1 / 26.2 / 26.3 / 26.4** release notes: **zero** hits for `Screen Time`, `DeviceActivity`, `FamilyControls`, `ManagedSettings`, `usage`. The 26.4 export API is **not mentioned in the 26.4 release notes at all** — it is documented only in the framework reference.
- **WWDC25 Updates** page (the iOS 26 "what's new" index): `Screen Time` 0, `DeviceActivity` 0, `FamilyControls` 0, `ManagedSettings` 0, `Shortcuts` 0. Its "Parental controls and safety" section lists only PermissionKit, DeclaredAgeRange, SCVideoStreamAnalyzer. — <https://developer.apple.com/documentation/updates/wwdc2025>
- There is **no** Updates/changelog page for DeviceActivity, FamilyControls, or ManagedSettings. The Updates index lists ~90 frameworks; none of the three appears. — <https://developer.apple.com/documentation/updates>

**Methodological note:** this is why the API is easy to miss. It appears in no release note, no WWDC index, and no framework changelog. Symbol-level availability enumeration was the only way to find it.

---

## 5. iOS 27 — clearly separated

**iOS & iPadOS 27 release notes exist and are published** — <https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes>

Screen Time appears exactly **twice**, both bug fixes, neither an export capability:

> "Fixed: Screen Time restrictions might not apply to child accounts despite being configured. (175437403)"

Shortcuts-related entries in iOS 27 release notes (none Screen Time related):

> "Fixed: Focus automations migrated from iOS 26 to iOS 27 do not work. (179514725)"
> "Fixed: Writing Tools actions are unavailable in Shortcuts. (179846468)"
> "Fixed: The Use Model action might fail to run when using the On-Device option for some output types. (181071784)"
> "Shortcuts containing the Send Message action might fail when importing or sharing. (182745894)"

**No iOS 27 symbol exists in any of the three Screen Time frameworks** (§4 enumeration: 32 iOS 26.x symbols, 0 iOS 27 symbols).

**Notable absence:** there is **no** `updates/wwdc2026` page. The Apple Updates index "Past releases" section tops out at `wwdc2025` — <https://developer.apple.com/documentation/updates>. So although iOS 27 release notes and WWDC26 session videos are live, Apple has published no WWDC26 API-changes index at the time of this research.

### The real iOS 27 Screen Time work: parental controls, not export

Apple Newsroom, **June 8, 2026**, "Apple previews new child safety features" — <https://www.apple.com/newsroom/2026/06/apple-previews-new-child-safety-features/>. Verbatim:

> "With software updates this fall, parents will be able to access new child safety features, including a simpler setup experience with a recommended set of essential apps, Ask to Browse, Time Allowances, and a redesigned Screen Time."

> "Time Allowances give parents more flexible ways to manage the time their kids spend in apps across categories, including Entertainment, Games, and Social Media. When setting Time Allowances, parents are provided with guidance, based on expert research, that's tailored to a child's age."

> "Screen Time is now redesigned and gives parents an at-a-glance view of their kids' average device usage and most used apps. Parents can easily make adjustments to their kids' access to apps and the web in the moment, with just a tap."

> "Availability — New features will be available after installing the Screen Time update in iOS 27, iPadOS 27, and macOS 27. Features are subject to change."

**Three things to hold onto:**
1. This is **all setting-side and viewing-side** — allowances, schedules, an at-a-glance parental view. Nothing about export, data access, Shortcuts, or an API.
2. `Shortcuts` and `export` appear **zero times** on that page.
3. **iOS 27 had not shipped** at this research date — "with software updates this fall", dated June 8, 2026. Do not attribute Time Allowances or the redesigned Screen Time to iOS 26.

**Do not conflate** the iOS 27 parental-controls redesign (announced, not shipped, setting-side) with the iOS 26.4 `activityData` export API (shipped, developer-side, EU-only). They are unrelated pieces of work.

---

## Cross-cutting: why the EU gate, and does it help a researcher?

Apple's documentation does not state a reason for the EU restriction. The obvious candidate is the DMA, but I could not verify a link:

- Apple's DMA Compliance Report (Non-confidential summary, March 7, 2026) mentions Screen Time exactly **once**, in a passage about app-marketplace feature parity, not about API access:
  > "Screen Time, which allows users to know how much time they spend in each app and place limits on how much time they spend in each app."
  > — <https://www.apple.com/legal/dma/NCS-March-2026.pdf>, p. 148
- The iOS interoperability request page does not mention Screen Time, Device Activity, Family Controls, app usage data, or usage portability at all. — <https://developer.apple.com/support/ios-interoperability/>

**UNVERIFIED:** the causal link between the DMA and the iOS 26.4 `FamilyActivityData` / `activityData` addition. The EU-only gating is documented; the *reason* is not.

### Practical read for a research-data-collection use case

| Route | Works? | Notes |
|---|---|---|
| **Shortcuts "Get App & Website Data"** | **UNKNOWN — test on device** | Exists in iOS 26.0; Apple publishes name only. If it returns per-app totals, this is a **no-entitlement, no-EU-gate, participant-runnable** route and the single most valuable thing to check |
| Any other Shortcuts Screen Time action | No | Nothing else documented in any Apple changelog, iOS 16→26.4 |
| Screen Time as automation trigger | No | Verified absent from all four trigger pages |
| Data & Privacy export | No (prior agent) | Not granular Screen Time |
| `DeviceActivityReport` extension → anywhere | **No** | Sandbox blocks address-space egress |
| `ManagedSettingsStore` side channel | **No** | Settings only, no usage values |
| `DeviceActivityMonitor` threshold callbacks | Partial, lossy | Signals threshold crossings, not durations; a participant-side app could log crossing times, but this is a coarse reconstruction, not an export |
| **`activityData(filteredBy:using:)`, iOS 26.4+** | **Yes** | Entitlement + `approvedWithDataAccess` + EU device/account + one-app-exclusive |

For a study cohort **outside the EU**, there is still **no** sanctioned granular Screen Time export as of iOS 26 (through 26.5) or the published iOS 27 notes. For an **EU** cohort on 26.4+, a purpose-built entitled app is a real, Apple-sanctioned route — with the caveat that the exclusive-grant rule means the study app competes with any other parental-controls app the participant uses.

---

## Open questions, ranked

1. **What does the Shortcuts "Get App & Website Data" action return?** Unanswerable from the web — Apple publishes no per-action reference (§1a). Resolve by adding the action in the Shortcuts editor on an iOS 26 device and tapping the info button: per <https://support.apple.com/guide/shortcuts/apdc33e4f4da/9.0/ios/26>, "A brief description of the action appears, including the type of content that can be used as input (if any) and the resulting output." If it yields per-app minutes, it is a participant-runnable export with **no entitlement and no EU gate** — strictly better than Route A for research logistics.
2. **Does Route A's EU gate key on account region, device location, or both simultaneously and continuously?** Apple says "devices located in the EU that are signed in with an Apple Account with an EU country or region" — conjunctive, but re-evaluation cadence is undocumented.
3. **Is the exclusive one-app-per-device grant survivable in a study?** A participant installing any other parental-controls app silently reverts the study app to `.notDetermined`.
4. **Can the composited `DeviceActivityReport` view be screenshotted?** Undocumented either way (§3a). Not a serious route regardless — it would yield pixels, not values.

## Source inventory

All developer.apple.com pages fetched via the JSON renderer (`https://developer.apple.com/tutorials/data/documentation/<path>.json`), which returns plain JSON to curl where the HTML is JavaScript-only.

- `/documentation/deviceactivity` — framework overview
- `/documentation/deviceactivity/deviceactivityreport` — **sandbox restriction**
- `/documentation/deviceactivity/deviceactivityreportextension`
- `/documentation/DeviceActivity/DeviceActivityData/activityData(filteredBy:using:)` — **export API**
- `/documentation/deviceactivity/deviceactivitydata` + `/activitysegment`, `/applicationactivity`, `/applicationactivity/totalactivityduration`, `/policy`, `/error`, `/deviceactivityresults`
- `/documentation/deviceactivity/deviceactivityfilter` + `/DeviceActivityFilter/SegmentInterval-swift.enum` — **hourly/daily/weekly granularity floor**
- `/documentation/familycontrols` + `/familyactivitydata` (+3 members), `/authorizationstatus/approvedwithdataaccess`, `/familyactivityselection`, `/requesting-the-family-controls-entitlement`
- `/documentation/managedsettings` + `/managedsettingsstore`, `/token`, `/applicationtoken`
- `/documentation/BundleResources/Entitlements/com.apple.developer.family-controls.app-and-website-usage`
- `/documentation/screentimeapidocumentation`
- `/documentation/appintents/app-intent-domains`, `/documentation/updates/appintents`
- `/documentation/updates`, `/documentation/updates/wwdc2025`
- `/documentation/ios-ipados-release-notes` + `/ios-ipados-{26,26_1,26_2,26_3,26_4,27}-release-notes`
- Index endpoints: `https://developer.apple.com/tutorials/data/index/{deviceactivity,familycontrols,managedsettings}` — 404 symbols enumerated
- <https://www.apple.com/legal/dma/NCS-March-2026.pdf>
- <https://developer.apple.com/support/ios-interoperability/>
- <https://developer.apple.com/videos/play/wwdc2022/110336/> (transcript checked; no sandbox discussion)

**Shortcuts / user-facing (support.apple.com and apple.com):**
- <https://support.apple.com/en-us/125148> — What's new in Shortcuts, iOS 26 — **the "Get App & Website Data" entry**
- <https://support.apple.com/en-us/101583> (iOS 16.x), <https://support.apple.com/en-us/111098> (iOS 17), <https://support.apple.com/en-us/121131> (iOS 18) — action changelogs; zero Screen Time entries
- <https://support.apple.com/guide/shortcuts/toc> — User Guide TOC (iOS 26 v9.0, 102 entries; no action catalog)
- <https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/9.0/ios/26> + the four trigger pages (`event-triggers-apd932ff833f`, `travel-triggers-apd8ebfc4e8e`, `communication-triggers-apdd711f9dff`, `setting-triggers-apde31e9638b`)
- <https://support.apple.com/guide/shortcuts/get-actions-apd5c2bd430f/9.0/ios/26> — "get actions" convention
- <https://support.apple.com/guide/shortcuts/apdc33e4f4da/9.0/ios/26> — in-app action descriptions are the only per-action reference
- <https://support.apple.com/guide/iphone/get-started-with-screen-time-iphbfa595995/ios>, <https://support.apple.com/guide/mac-help/view-app-website-activity-settings-screen-mchle37ec855/mac>
- <https://www.apple.com/os/pdf/All_New_Features_iOS_26_Sept_2025.pdf> — "Screen Time" appears 0 times
- <https://www.apple.com/newsroom/2026/06/apple-previews-new-child-safety-features/> — iOS 27 preview
- <https://developer.apple.com/videos/play/wwdc2026/310/> — What's new in Shortcuts, WWDC26

**Dead link, worth recording:** `support.apple.com/guide/shortcuts/apple-apps-actions-apd8b0d0a3c5/ios` 302-redirects to `/guide/shortcuts/welcome/ios`. Apple has never published a per-action Shortcuts reference.

**Non-Apple, cited only as a lead and adding nothing:** 9to5Mac, "iOS 26's Shortcuts app adds 25+ new actions" — <https://9to5mac.com/2025/12/09/ios-26s-shortcuts-app-adds-25-new-actions-heres-everything-new/> — lists "Get App & Website Data" in a bare bullet with no description.

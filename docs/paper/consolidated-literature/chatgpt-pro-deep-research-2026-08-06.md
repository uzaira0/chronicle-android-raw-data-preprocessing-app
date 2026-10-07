# ChatGPT Pro deep-research reconciliation — 2026-08-06

**Run marker:** `codex-pro-run:5292bc15-e8fc-4717-964d-6be96333cec3`  
**Input reviewed:** the completed Pro research response returned by the user.  
**Decision rule:** treat the response as a candidate generator, verify against primary sources, and
retain only work roughly directly related to mobile screen/app-use acquisition, construction,
validation, selection, discrepancy, or feature-level behavior. Generic web/clickstream and network
traffic proxies are outside the requested scope.

## Reconciliation result

- **22** candidate records were proposed by the Pro response.
- **17** canonical works/artifacts were accepted after primary-source review.
- Those works contribute **26 slice-role records**: 13 in A, 8 in D, and 5 in F.
- **Five** candidates were rejected from the retained corpus as too indirect, even when factually
  interesting.
- **Two identifier/source errors** were corrected: the proposed Khatri UsageStats repository does
  not exist, and LV-Linker has a canonical published UIST DOI that the response missed.
- The GESIS entry was materially strengthened after inspecting its executable tutorial source.

This is a reconciliation of one independent review, not a claim that discovery is exhausted.

## Accepted canonical records

| # | Canonical work/artifact | Slice roles | Verified contribution | Decision |
|---:|---|---|---|---|
| 1 | Zerrer, Wieland & de Alwis, *How to Work With Android App Logging Data*, [10.71627/How-to-work-with-Android-App-Logging-Data.1](https://doi.org/10.71627/How-to-work-with-Android-App-Logging-Data.1) | A | Executable Start/Stop reconstruction, missing/remote-stop alternatives, 600-s cap, ten-event check, close provenance, 60-s cross-app grouping, timezone/background/OEM handling | **Accept; highest-priority direct threat** |
| 2 | Yang et al., *Association Between the Severity of Depressive Symptoms and Human-Smartphone Interactions*, [10.2196/42935](https://doi.org/10.2196/42935) | A, D | Screen-on→next-screen-off session and explicit downstream features; within/between-person associations differ | **Accept** |
| 3 | Okoshi et al., *Cyberoception*, [10.1145/3706598.3713638](https://doi.org/10.1145/3706598.3713638) | A, F | Android resumed→paused and interactive→non-interactive pairing; <5-s micro-use construct | **Accept** |
| 4 | Ahmed et al., *Before You Scroll Again*, [arXiv 2606.08965](https://arxiv.org/html/2606.08965) | A, D, F | UsageStats+Accessibility exit detection; package/overlay filtering; intention–actual-use gap outperforms raw duration | **Accept as current preprint; code promised but not yet linked** |
| 5 | Meinhardt et al., *Scrolling in the Deep*, [10.1145/3706598.3713187](https://doi.org/10.1145/3706598.3713187) | A, D | Feature-level infinite-scroll episode with 15-min intervention gate | **Accept; gate is selection, not general sessionization** |
| 6 | Meinhardt et al., *Can't Stop*, [10.1145/3831979](https://doi.org/10.1145/3831979) | A, D | Explicit uninterrupted passive-scroll session; 15-min gate; open app/data/R | **Accept** |
| 7 | Abrignoni et al., [ALEAPP UsageStats parser](https://github.com/abrignoni/ALEAPP/blob/main/scripts/artifacts/usagestats.py) | A | Open XML/protobuf v1/v2 extraction, token handling, duplicate-folder and human-action caveats | **Accept ALEAPP only; no episode builder** |
| 8 | Bortnik & Lavrenovs, *Android Dumpsys Analysis to Indicate Driver Distraction*, [10.1007/978-3-030-68734-2_8](https://doi.org/10.1007/978-3-030-68734-2_8) | A | System-service timeline reconstruction from Android forensic artifacts | **Accept as adjacent direct-source evidence** |
| 9 | Pagano, *Turbo Speed*, [10.21428/b0ac9c28.245fd6c6](https://doi.org/10.21428/b0ac9c28.245fd6c6) | A | Device Health Services start/end package artifacts and Android/OEM coverage limits | **Accept; preformed artifact, no builder** |
| 10 | The Binary Hick, [Device Personalization Services timeline write-up](https://thebinaryhick.blog/2020/05/16/walking-the-android-timeline-part-2-using-androids-device-personalization-services-to-timeline-user-activity/) | A | `reflection_gel_events.db` app bookends plus deletion, coverage, lock/unlock, and multitasking caveats | **Accept as clearly labeled grey literature** |
| 11 | Belkasoft, [Android system application-usage artifacts](https://belkasoft.com/android-system-artifacts-forensic-analysis-of-application-usage) | A | Cross-artifact/OEM field map; notification/system-event and absence≠non-use warnings | **Accept as vendor corroboration, not scientific builder** |
| 12 | Forensafe, [Investigating Android App Usage History](https://forensafe.com/blogs/android-app-usage-history.html) | A | Current UsageStats path/field and commercial-parser coverage | **Accept as supporting tool record** |
| 13 | Lee et al., LV-Linker, [10.1145/3526114.3558714](https://doi.org/10.1145/3526114.3558714) | A | Aligns processed app logs and screen video for boundary/task audit | **Accept as validation UI, not reconstruction** |
| 14 | Reiter & Schoedel, *Never Miss a Beep*, [10.3758/s13428-023-02252-9](https://doi.org/10.3758/s13428-023-02252-9) | D, F | Screen-conditioned prompt delivery, 60-min windows, ±4-SD and missingness rules | **Accept** |
| 15 | Toth, Parry & Klingelhoefer, *Somebody's (Still) Watching Me*, [10.31235/osf.io/xt24p_v3](https://doi.org/10.31235/osf.io/xt24p_v3) | D, F | Direct logging/ESM reactivity, event exclusions, split five-minute windows | **Accept as preprint** |
| 16 | Toth et al., *Zooming in on Smartphone Habits*, [10.31234/osf.io/bqfne_v3](https://doi.org/10.31234/osf.io/bqfne_v3) | D, F | Glance/session/episode unit comparison; duration/frequency conclusions differ | **Accept as preprint** |
| 17 | Krüger, Sachdeva & Sobolev, *Synthetic Data Generation for Screen Time and App Usage*, [arXiv 2509.13892](https://arxiv.org/abs/2509.13892) | D | Synthetic session schema and plausibility checks expose >42-h/day/no-inactivity failures | **Accept as validation-fixture evidence** |

## Rejected candidates

| Candidate | Pro-assigned relevance | Final decision and reason |
|---|---|---|
| Lassila et al., *Stop Fiddling With Your Phone and Go Offline*, `10.1145/3772318.3790822` | Cross-device trace sessions with a 20-minute inactivity rule | **Reject from retained corpus.** The unit is dominated by browser/online trace activity and falls inside the user's explicit web/clickstream exclusion. It may be rediscovered only if a future section specifically reviews cross-device online sessions. |
| *Digital Phenotyping via Passive Network Traffic Monitoring*, `10.2196/84618` | Network-derived activity proxies | **Reject.** Encrypted/network traffic is not foreground screen/app use and cannot determine active user episodes. |
| Mahmood et al., *Learning Behavioral Signals From Encrypted Smartphone Network Traffic*, arXiv `2605.01616` | Network-derived behavioral representations | **Reject.** Same modality mismatch; the paper itself cannot distinguish foreground human activity from user/background traffic. |
| Tang et al., *PocketPPD*, arXiv `2607.17185` | AWARE passive sensing with screen events | **Reject from this expansion.** Direct phone sensing is present, but the paper delegates/omits the screen-session builder and contributes no distinctive screen/app construction result beyond already-covered AWARE/clinical lineages. |
| Android Health Connect Synthetic Package Name documentation | Versioned provenance analogue for step records | **Reject from the retained paper corpus.** It concerns step aggregation/source attribution, not screen or app usage. It is a useful platform-design analogy but would inflate Slice E without direct relevance. |

## Corrections to the Pro response

### GESIS was understated

The response summarized simple Start→Stop adjacent pairing. The
[tutorial source](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data)
instead implements a richer policy:

1. Search for the nearest same-app Stop after a Start.
2. Check event distance and a 600-second maximum duration.
3. If the Stop is missing or implausible, close at the next global event within the timeout.
4. Otherwise force a 600-second timeout close.
5. Preserve whether the close was `original`, `activity_based`, or `timeout`.
6. In a separate layer, group visits into sessions with a 60-second cross-app gap.
7. Handle background-app removal, timezone conversion, and unknown OEM event type `100` explicitly.

This moves GESIS from a generic tutorial to one of the strongest direct reconstruction disclosures in
the corpus. It still does not cross a multiverse of competing event/pairing/repair policies or attach
complete per-episode source lineage.

### One proposed repository does not exist

The response paired ALEAPP with `yogesh-khatri/Android_Usagestats`. GitHub returned no repository
under that owner/path or the plausible `ydkhatri` spelling. Only ALEAPP was retained. The absence is
recorded here to prevent a citation loop around a fabricated stable key.

### LV-Linker has a canonical publication identity

The response retained only arXiv `2205.14641` and an earlier title. The canonical publication is
Lee, Lee, Koh & Lee, *Supporting Fine-Grained User Interaction Analyses by Linking Smartphone Log
and Recorded Video Data*, UIST 2022 Adjunct,
[DOI 10.1145/3526114.3558714](https://doi.org/10.1145/3526114.3558714). The arXiv route remains an
earlier version, not a separate work.

## Novelty effect

The prior-art floor rises in three ways:

1. **Executable repair exists.** GESIS publishes missing-close alternatives, maximum-duration
   closure, session grouping, and repair provenance.
2. **Feature-level sessions are a live frontier.** The infinite-scrolling and regret studies define
   use below the package level and reveal threshold-selected observation.
3. **“Objective” measurement can be reactive and selected.** Screen-conditioned prompts, logging
   awareness, ESM intervention, and alternative glance/session/episode units alter the comparison.

The residual contribution remains defensible only in conjunctive form: no located reusable artifact
binds versioned typed mobile events to a crossed set of opener/closer, matching, gap, malformed,
missing, duplicate, overlap, order, clock/timezone, and query-boundary policies; executes them on the
same open raw logs; and emits per-episode lineage/quality traces plus validation fixtures.

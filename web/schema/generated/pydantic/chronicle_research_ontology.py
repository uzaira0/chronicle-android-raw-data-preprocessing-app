from __future__ import annotations

import re
import sys
from datetime import (
    date,
    datetime,
    time
)
from decimal import Decimal
from enum import Enum
from typing import (
    Any,
    ClassVar,
    Literal,
    Optional,
    Union
)

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    SerializationInfo,
    SerializerFunctionWrapHandler,
    field_validator,
    model_serializer
)


metamodel_version = "1.7.0"
version = "None"


class ConfiguredBaseModel(BaseModel):
    model_config = ConfigDict(
        serialize_by_alias = True,
        validate_by_name = True,
        validate_assignment = True,
        validate_default = True,
        extra = "forbid",
        arbitrary_types_allowed = True,
        use_enum_values = True,
        strict = False,
    )





class LinkMLMeta(RootModel):
    root: dict[str, Any] = {}
    model_config = ConfigDict(frozen=True)

    def __getattr__(self, key:str):
        return getattr(self.root, key)

    def __getitem__(self, key:str):
        return self.root[key]

    def __setitem__(self, key:str, value):
        self.root[key] = value

    def __contains__(self, key:str) -> bool:
        return key in self.root


linkml_meta = LinkMLMeta({'comments': ['Screen-use measurement framework alignment (Shaleha, Roque, '
                  'Andrews, Calfee & Lee 2026, doi:10.1177/21522715261417288): '
                  "this ontology's measures sit on the framework's OBJECTIVE-LOG / "
                  'passive-sensing modality axis. Referenced, not class-mapped, '
                  'because the framework has no stable class IRIs.'],
     'default_prefix': 'chron',
     'default_range': 'string',
     'description': 'Core entity model for the Android UsageStatsManager event-log '
                    '-> usage-measurement research ontology. Implements the D4 '
                    'five-way split from docs/workflow/research-ontology-design.md '
                    '(occurrence / record / optional logging-observation / '
                    'assertion / execution / interval) so provenance can always '
                    'distinguish what was OBSERVED from what was RECONSTRUCTED, '
                    'and so absence and unresolved attribution can never silently '
                    'drop from denominators.\n'
                    'Backbone (D2, upper-neutral): SOSA/SSN + OWL-Time + PROV-O + '
                    'P-Plan. BFO-vs-DOLCE is deliberately deferred and, when '
                    'needed, bridged via SSSOM — this module asserts only the '
                    'free, standards-grounded mappings. This is the FOUNDATION '
                    'module: SHACL axioms, BCIO/Shaleha close-mappings, DQV '
                    'quality, and generator wiring are later build-order steps '
                    '(doc 13 §"Prioritized build order").',
     'id': 'https://w3id.org/chronicle-usage-ontology/core',
     'imports': ['linkml:types'],
     'license': 'MIT',
     'name': 'chronicle-usage-ontology-core',
     'prefixes': {'BCIO': {'prefix_prefix': 'BCIO',
                           'prefix_reference': 'http://humanbehaviourchange.org/ontology/BCIO_'},
                  'chron': {'prefix_prefix': 'chron',
                            'prefix_reference': 'https://w3id.org/chronicle-usage-ontology/core/'},
                  'dcterms': {'prefix_prefix': 'dcterms',
                              'prefix_reference': 'http://purl.org/dc/terms/'},
                  'dqv': {'prefix_prefix': 'dqv',
                          'prefix_reference': 'http://www.w3.org/ns/dqv#'},
                  'linkml': {'prefix_prefix': 'linkml',
                             'prefix_reference': 'https://w3id.org/linkml/'},
                  'pplan': {'prefix_prefix': 'pplan',
                            'prefix_reference': 'http://purl.org/net/p-plan#'},
                  'prov': {'prefix_prefix': 'prov',
                           'prefix_reference': 'http://www.w3.org/ns/prov#'},
                  'qudt': {'prefix_prefix': 'qudt',
                           'prefix_reference': 'http://qudt.org/schema/qudt/'},
                  'skos': {'prefix_prefix': 'skos',
                           'prefix_reference': 'http://www.w3.org/2004/02/skos/core#'},
                  'sosa': {'prefix_prefix': 'sosa',
                           'prefix_reference': 'http://www.w3.org/ns/sosa/'},
                  'ssn': {'prefix_prefix': 'ssn',
                          'prefix_reference': 'http://www.w3.org/ns/ssn/'},
                  'time': {'prefix_prefix': 'time',
                           'prefix_reference': 'http://www.w3.org/2006/time#'},
                  'unit': {'prefix_prefix': 'unit',
                           'prefix_reference': 'http://qudt.org/vocab/unit/'}},
     'see_also': ['https://doi.org/10.1177/21522715261417288'],
     'source_file': 'chronicle-research-ontology.linkml.yaml',
     'title': 'Chronicle Android Usage Measurement — Research Ontology (core '
              'module)'} )

class EventTypeCode(str, Enum):
    """
    Canonical Android lifecycle / device-state event vocabulary. Modeled as a SKOS concept scheme.
This value set is HAND-AUTHORED, not generated. An earlier description said the full both-spellings scheme (human labels plus the "Unknown importance: N" spellings) "is generated from the engine constants"; no generator in this repository produces such an artifact, and `web/schema/Makefile` has no target that emits one. The authority for the both-spellings mapping is `normalize_interaction_type` in `rust/chronicle_chrono_kernel_wasm/src/lib.rs`, which folds thirty-one "Unknown importance: N" codes plus the Chronicle prose spellings onto canonical labels. Nothing checks this enum against that function.
The values below are the codes THIS ontology's own terms refer to: the ones the reconstruction, screen-session, opener-set, event-retention and notification-proxy axes name in their own descriptions. Codes the kernel normalizes but no term here references (3, 5, 6, 8, 9, 13, 20, 21, 24, 25, 28, 29, 30, 31) are deliberately not minted, so a code appearing here is one this ontology actually reasons about rather than a mirror of the platform.
    """
    activity_resumed = "activity_resumed"
    """
    App moved to foreground (Move to Foreground / UI:1).
    """
    activity_paused = "activity_paused"
    """
    App moved to background (Move to Background / UI:2).
    """
    continue_previous_day = "continue_previous_day"
    """
    Continue Previous Day (UI:4). App-scoped; named by the gesis_app_scoped_starts opener set.
    """
    user_interaction = "user_interaction"
    """
    User Interaction (UI:7). The only code retained by usage_logger_5 that no other named published retention set keeps (the `none` value retains every event).
    """
    notification_seen = "notification_seen"
    """
    Notification Seen (UI:10). An INSTANT, not an interval: the seen_contact_v1 notification-proxy rule emits it into a separate contact channel and it contributes no duration to app usage.
    """
    standby_bucket_changed = "standby_bucket_changed"
    """
    Standby Bucket Changed (UI:11). App-scoped; named by the gesis_app_scoped_starts opener set.
    """
    notification_interruption = "notification_interruption"
    """
    Notification Interruption (UI:12). An INSTANT, like Notification Seen; the interruption_contact_v1 proxy rule emits it. The stronger of the two contact signals.
    """
    slice_pinned_app = "slice_pinned_app"
    """
    Slice Pinned App (UI:14). App-scoped; named by the gesis_app_scoped_starts opener set.
    """
    screen_interactive = "screen_interactive"
    """
    Screen turned interactive (UI:15).
    """
    screen_non_interactive = "screen_non_interactive"
    """
    Screen turned non-interactive (UI:16).
    """
    keyguard_shown = "keyguard_shown"
    """
    Keyguard shown / device locked (UI:17).
    """
    keyguard_hidden = "keyguard_hidden"
    """
    Keyguard hidden / device unlocked (UI:18).
    """
    foreground_service_start = "foreground_service_start"
    """
    Foreground Service Start (UI:19). App-scoped; named by the gesis_app_scoped_starts opener set.
    """
    rollover_foreground_service = "rollover_foreground_service"
    """
    Rollover Foreground Service (UI:22). App-scoped; named by the gesis_app_scoped_starts opener set.
    """
    activity_stopped = "activity_stopped"
    """
    Activity stopped (UI:23) — proximity/fallback close.
    """
    device_shutdown = "device_shutdown"
    """
    Device shutdown boundary (UI:26 / importance 26).
    """
    device_startup = "device_startup"
    """
    Device startup boundary (UI:27 / importance 27).
    """


class AttributionStatus(str, Enum):
    """
    Attribution status of an App-Usage assertion. Chronicle uses a CLOSED attribution vocabulary: "Target Child", "Other", or "None"/blank (survey answers arrive as "Other (From Survey)"). Mirrors Rust attribution in pipeline_v2_incremental.rs (the runtime source of truth). NEVER a null person and NEVER an "unknown person" class.
This enum is a per-episode label. It is NOT, by itself, "the compliance denominator contract" — an earlier version of this description said it was, which overstated it. The denominator is a participant-day quantity that admits only SOME labelled episodes; what it admits and what it silently leaves out is stated on ComplianceDayAssessment, which is the term for the measure the engine actually computes.
    """
    target = "target"
    """
    Attributed to the enrolled target child (label "Target Child").
    """
    known_non_target = "known_non_target"
    """
    Attributed to a known person other than the target child (label "Other"). Counts as known/attributed.
    """
    unresolved = "unresolved"
    """
    Usage occurred but the person is unresolved (label "None"/blank or an empty/"nan" username). Never dropped: an admitted unresolved episode is in the denominator and out of the numerator. Admission is decided by ComplianceDayAssessment, not by this label.
    """


class EndpointStatus(str, Enum):
    """
    Observation-endpoint qualification for a derived interval. Under RDF open-world semantics a missing endpoint is UNKNOWN, not observed-absent — so absence is always an explicit status, never a null result.
    """
    observed = "observed"
    """
    Endpoint directly observed in the event stream.
    """
    unobserved = "unobserved"
    """
    Endpoint not observed and not bounded by later evidence.
    """
    right_censored = "right_censored"
    """
    Observation ended while usage was believed still open.
    """
    interval_censored = "interval_censored"
    """
    Endpoint known only to lie within bounds set by later evidence (e.g. a fallback close).
    """


class MeasurementLayer(str, Enum):
    """
    The measurement-model layer a class/assertion belongs to (doc 13; chronicle-ontology.md).
    """
    construct = "construct"
    validity = "validity"
    presence = "presence"
    engagement = "engagement"
    """
    Device/app usage-engagement measurement (screen-on, app-in-foreground). RELATED to, but deliberately NOT equated with, BCIO "participant engagement with behaviour change intervention" (BCIO:013000): BCIO engagement is intervention-scoped whereas a chronicle app is generally not a behaviour-change intervention — hence relatedMatch, not closeMatch (doc 13 D3).
    """
    person = "person"
    attribution = "attribution"


class ReconstructionStrategyId(str, Enum):
    """
    Canonical IRI-bearing identifiers for the named episode-reconstruction algorithms. Forward-pairing is a DISTINCT algorithm, not a knob setting (doc 08). The runtime enum carries the canonical procedure IRI; concrete strategies are versioned individuals of ReconstructionStrategy.
    """
    parry_toth_forward_pairing = "parry_toth_forward_pairing"
    """
    Parry & Toth start-only bracket-first forward pairing.
    """
    fused_matcher = "fused_matcher"
    """
    This engine's fused open/close matcher (production).
    """
    eyes_complement = "eyes_complement"
    """
    EYES complement-based device-state segmentation (ACTIVE = not(SHUTDOWN or IDLE or GAP or GLANCE)).
    """
    gesis_start_stop_repair = "gesis_start_stop_repair"
    """
    GESIS/Zerrer three-tier start-stop repair. Tier 1 is the nearest same-package close candidate — a Stop, or a Start whose next same-app event is not a Stop, so an app with no stop event closes at its own next Start (ported deliberately from the tutorial code, per the matcher's own comment) — accepted only when at most ten events sit between the start and that candidate (`GESIS_EVENT_THRESHOLD = 10`, pipeline_v2.rs:125, passed to `match_app_usage_gesis_with_openers_indices_core`): the tutorial's `event_threshold`, alongside its `max_timeout`. Tier 2 is the next event of any kind, accepted only when it falls within 600 s of the start; tier 3 cuts the episode at start + 600 s, an instant no event carries (`GESIS_MAX_TIMEOUT_NS`). The event threshold is as load-bearing as the timeout — a same-package stop further than ten events away is rejected even when it is well inside 600 s — and omitting it from this description made the arm look like a pure time rule.
    """
    foreground_background_pairing = "foreground_background_pairing"
    """
    Ahmed et al. (2023) / Okoshi et al. (2025): each Activity Resumed closed by the next Activity Paused of the same package, with no repair of any kind.
    """
    draxler_interruption_aware = "draxler_interruption_aware"
    """
    Chronicle episode-level derivative informed by Draxler et al. (2021), not their full learning-session/interruption method: closes on own-package backgrounding, a screen-stop event, foreground handover, or a gap strictly over 600 seconds between consecutive input rows (at the preceding row time). It does not reconstruct within-session suspending interruptions, return linkage, or experience-sampling queries.
    """
    morrison_lock_tolerant = "morrison_lock_tolerant"
    """
    Morrison et al. (2018): ends on handover or on a lock that keeps the screen off for thirty seconds (inherited from Bohmer et al. 2011); a shorter lock does not end the use.
    """
    schoedel_2026_app_within_screen_prose_v1 = "schoedel_2026_app_within_screen_prose_v1"
    """
    Controlled derivative of Schoedel et al. (2026)'s simplified prose: within a selected screen interval, a type-1 app row opens an episode and the app's last row before a different-app type-1 row or observed screen end closes it. This is not the full deposited PhoneStudy pipeline.
    """


class IntervalQualityPolicyId(str, Enum):
    """
    Canonical identifiers for the named interval-quality policies. This is a SEPARATE axis from reconstruction, crossed with it: a reconstruction rule decides where an episode starts and ends, an interval-quality policy bounds one that is already reconstructed but implausible. It never redefines an episode boundary.
    """
    none = "none"
    """
    This engine's own interval cleaning (production default).
    """
    culverhouse_trim_and_log = "culverhouse_trim_and_log"
    """
    Culverhouse: trim an implausible interval and record that it was trimmed, rather than dropping the episode or blanking its duration.
    """


class SessionGroupingPolicyId(str, Enum):
    """
    Canonical identifiers for the named usage-session grouping rules. A THIRD axis, crossed with the two above: reconstruction decides episode boundaries, interval quality bounds an implausible episode, and this groups finished episodes into usage sessions. Most members differ only in their gap constant, so the comparison operator and any package clause are the load-bearing differences and are stated per value.
    """
    none = "none"
    """
    No session grouping; no session column is emitted (default).
    """
    church_5s = "church_5s"
    """
    Church et al.: 5 s gap. Weakest provenance in this set — the constant is quoted by van Berkel et al. and has not been read from Church's own text.
    """
    smartphone_wellbeing_strict_lt_5s = "smartphone_wellbeing_strict_lt_5s"
    """
    Schoedel et al. (2024, doi:10.1016/j.chb.2023.107977), from the deposited SmartphoneUsage_Wellbeing preprocessing code: join adjacent usage sessions only when the previous-stop to next-start gap is strictly less than 5 s (`diff.to.previous < 5`). A gap exactly equal to 5 s starts a new session. This is distinct from church_5s because the Church boundary comparator is not established from primary code here.
    """
    grosse_deters_10s = "grosse_deters_10s"
    """
    grosse Deters et al.: 10 s gap, published as a merge of adjacent use.
    """
    ross_15s = "ross_15s"
    """
    Ross et al. (2025): 15 s gap, inclusive (>=), and a package change also ends the session. The package-change clause is unique to this member; the inclusive >= boundary is shared with peng_zhu_2020_participant_median, which adopts Ross's boundary side without his package clause. POLLED-INSTRUMENT CAVEAT, stated here for the same reason PolledEmulationMethodId states it for the same paper: Ross's rule was written over POLLED SAMPLES, not over reconstructed episodes. Their collector repeatedly records ScreenStatus and LatestUsedApp, and the released code measures the gap to the NEXT SAMPLE and forces the terminal sample closed. Chronicle applies the constant to the gap between reconstructed episodes instead, which is a transposition of the rule onto a different instrument, not a replay of it. Their brief is also explicit that the 15 s figure is an engineering rule embedded in code, not a validated behavioral cutoff. To reproduce the sampled shape rather than borrow its constant, use ross_2025_sampled_gap_v1 on the PolledEmulationMethodId axis.
    """
    van_berkel_45s = "van_berkel_45s"
    """
    Legacy identifier for Chronicle's app-episode gap grouping: gaps <= 45 s join; gaps > 45 s split. This is not an exact implementation of van Berkel et al. (2016): their Constant Classifier applies Gap < T to device-session gaps and classifies equality as new, against participant objective-continuation labels. Their 45 s recommendation is sample/objective-specific and explicitly not generalizable. Later papers citing the constant must retain their own input, stage and equality semantics.
    """
    zerrer_60s = "zerrer_60s"
    """
    Zerrer et al.: 60 s gap. The prose says 'at least 60 seconds' and the code says '> 60'; the code is authoritative because the code produced the published numbers.
    """
    peng_zhu_2020_participant_median = "peng_zhu_2020_participant_median"
    """
    Peng & Zhu (2020, JCMC, doi:10.1093/jcmc/zmz029): the only individualized member of the set. Verbatim: 'An individualized threshold, which is the median score of a user's inter-app intervals, is adopted for each user. If the inter-app interval is smaller than the median inter-app interval of a user, then the two apps are grouped into a mobile session; otherwise, they are assigned to two distinct sessions.' The threshold is the median of each participant partition's own previous-stop-to-next-start intervals — no constant, no multiplier, no observation floor — and 'smaller than joins' places a gap exactly equal to the median on the splitting side (inclusive >=, like Ross, without his package clause). The median is always derived from previous-stop intervals even when the gap-basis departure is selected for the comparison, because a statistic measured from the running maximum would depend on the very session assignments it defines. With session-break lineage on, each partition's OPEN flag records the derived median and its interval count, so the individualized threshold is reconstructible from the export.
    """


class SessionGapBasisId(str, Enum):
    """
    Canonical identifiers for WHICH endpoint a session gap is measured from. Every rule on the SessionGroupingPolicyId axis is stated over a stream in which episodes do not overlap — a polled foreground sample, or a table already reduced to one app at a time. Chronicle's event stream is not that stream, and `model_concurrent_usage` (which splits overlapping episodes) defaults OFF, so on a default run an episode nested inside a longer one reaches grouping intact.
The published reading then measures the gap from whichever episode starts last, which for a nested pair is the SHORT one. Verified against the kernel: a 30 min episode, a 1 min episode nested at its start, and a third episode 20 s after the long one ends are numbered `[0, 0, 1]` under the 60 s rule, although the screen was covered continuously throughout.
The alternative is a stated DEPARTURE from every published rule, not a correction of them, which is why the published reading is the default and an unknown identifier widens to it.
    """
    previous_episode_stop_v1 = "previous_episode_stop_v1"
    """
    The immediately preceding episode's stop, in start order. What every published rule ships, and the default.
    """
    session_running_maximum_stop_v1 = "session_running_maximum_stop_v1"
    """
    The maximum stop of every episode already placed in this session — the coverage envelope the rules describe in prose. An episode nested inside a longer one can no longer pull the measuring point backwards.
    """


class SessionBoundaryScopeId(str, Enum):
    """
    Canonical identifiers for WHICH rows are numbered as one sequence of sessions. The engine partitions by `participant_id` alone, but every other dimension of the published classification key (`study_id,participant_id,possible_device_model,username`) varies WITHIN a participant: `username` is a raw per-row Chronicle column, and nothing constrains one export to a single `study_id`.
The failure this axis addresses is a MISSED break rather than a spurious one. A foreign row landing inside a participant's silence bridges it, so the participant's session is never split. Verified against the kernel: three episodes in which study A is silent for 950 s and study B's episode sits inside that silence are numbered `[0, 0, 0]` under the 60 s rule.
`attribute_person` already retypes a shared device's non-target rows to Non-Target Participant App Usage, which grouping then excludes — but that runs only when a device-sharing file is configured. Without one, a sibling's episodes stay App Usage and are numbered into the target child's sequence.
The scopes nest, so widening can only split a sequence further and can never merge two. Unknown identifiers resolve to the narrowest scope, which is today's behaviour.
    """
    participant_v1 = "participant_v1"
    """
    `participant_id` alone. What the engine has always used, and the default.
    """
    participant_and_study_v1 = "participant_and_study_v1"
    """
    `(study_id, participant_id)`. A participant id reused across studies no longer bridges either study's silences.
    """
    participant_study_and_person_v1 = "participant_study_and_person_v1"
    """
    `(study_id, participant_id, username)`. Also separates the people on a shared device when no device-sharing file has reclassified them.
    """


class EventRetentionSetId(str, Enum):
    """
    Canonical identifiers for the named event-retention sets — which raw interaction types a published study let its reconstruction see at all. A FOURTH axis, crossed with the three above and sitting UPSTREAM of them: it narrows the events the app-usage reconstruction sees, before any episode is reconstructed, so one study's rule can be replayed on the set of event types another study recorded. It does NOT narrow the screen-usage branch, which reads the full event stream. Unknown identifiers resolve to `none`, which widens rather than narrows, so an unrecognised value can never silently delete data.
PROVENANCE WARNING for every value except `none`: the retained type sets below are transcribed from the papers' own descriptions and this repository holds NO artifact that can check them. `.refs/` carries no bibliography entry and no code for Parry & Toth's retained-type list, for Usage Logger, or for Toth & Trifonova. Contrast `zerrer_60s` and `smartphone_wellbeing_strict_lt_5s` on the SessionGroupingPolicyId axis, whose comparators are read from deposited code. Treat every set here as unverified transcription until a source lands in `.refs/`.
    """
    none = "none"
    """
    Retain every interaction type; the engine's own filtering still applies (default).
    """
    parry_toth_7 = "parry_toth_7"
    """
    Parry & Toth: types 1, 15, 16, 17, 18, 26, 27. Activity Paused (type 2) is NOT retained — the paper closes on screen and device events instead. This differs from the parry_toth_forward_pairing reconstruction arm, which ports Culverhouse's adaptation and does close on type 2.
    """
    usage_logger_5 = "usage_logger_5"
    """
    Usage Logger: types 1, 2, 7, 26, 27. The only set that retains User Interaction (type 7).
    """
    toth_trifonova_app = "toth_trifonova_app"
    """
    Toth & Trifonova: types 1, 2, 17, 26 — the foreground pair plus keyguard-shown and shutdown. Type 17 is Keyguard Shown (the screen locking), NOT screen-on, which is type 15 and is not in this set; an earlier version of this description said screen-on and disagreed with the code it documents.
    """
    foreground_background_only = "foreground_background_only"
    """
    Types 1 and 2 only. The minimal set: reconstruction sees the foreground/background pair and nothing else, so every close is an observed app transition. It is a strict subset of usage_logger_5 and toth_trifonova_app, but NOT of parry_toth_7, which drops type 2.
    """


class InteractionTypeRemovalModeId(str, Enum):
    """
    Whether selected interaction types are removed unconditionally or retain rows that carry long-data-gap evidence. `gap_preserving` is Chronicle's compatibility behavior. `unconditional` reproduces source pipelines such as SmartphoneUsage_Wellbeing that filter the named event before any long-gap exception is considered.
    """
    gap_preserving = "gap_preserving"
    """
    Drop selected types except rows whose data gap reaches the smallest configured long-gap threshold (default).
    """
    unconditional = "unconditional"
    """
    Drop every row of a selected type, including rows that carry long-gap evidence.
    """


class OpenerSetId(str, Enum):
    """
    Canonical identifiers for which retained, app-scoped event rows may begin an app episode. This axis runs after event retention and before episode reconstruction: it changes opener eligibility without deleting non-opener rows that may still close, bound, explain, or censor an episode. It does not choose a closer or repair rule, and package handling remains with the selected reconstruction strategy and the separate package-policy axis.
    """
    strategy_defined = "strategy_defined"
    """
    Compatibility default: preserve the selected reconstruction strategy's native opener and materializer behavior exactly.
    """
    activity_resumed_only = "activity_resumed_only"
    """
    Canonical Android type 1 (Activity Resumed / Move to Foreground), including Chronicle's filtered equivalent after normalization. Package policy remains inherited from the selected reconstruction strategy.
    """
    gesis_app_scoped_starts = "gesis_app_scoped_starts"
    """
    GESIS-derived adapter, not a verbatim source method: begin with source membership {1, 4, 11, 14, 15, 18, 19, 22, 27}, then intersect with app-scoped Android event semantics for effective membership {1, 4, 11, 14, 19, 22}. Device-scoped types 15, 18, and 27 never open app credit; package handling remains separate.
    """


class MicroUseClassificationPolicyId(str, Enum):
    """
    Canonical identifiers for a non-destructive classification of an already reconstructed app episode. Classification never changes duration, boundaries, inclusion, grouping, or aggregate credit.
    """
    none = "none"
    """
    Compatibility default: do not classify episodes and do not add a micro-use column to the default scientific CSV.
    """
    okoshi_lt_5s = "okoshi_lt_5s"
    """
    Okoshi et al. (2025) source-aligned component: a positive, bounded raw reconstructed duration strictly below five seconds is micro-use; equality is not micro-use and an unbounded or zero-length artifact is not classifiable.
    """


class MinimumDurationComparatorId(str, Enum):
    """
    Comparator applied once to immutable raw reconstructed episode duration at the post-materialization, pre-concurrency checkpoint.
    """
    strict_lt = "strict_lt"
    """
    Qualify a bounded episode only when raw duration is strictly less than the configured minimum_usage_duration; compatibility default.
    """
    inclusive_le = "inclusive_le"
    """
    Qualify a bounded episode when raw duration is less than or exactly equal to the configured minimum_usage_duration.
    """


class MinimumDurationDispositionId(str, Enum):
    """
    Disposition for an episode qualified by the minimum-duration comparator. This is separate from micro-use classification and exact-zero cleanup.
    """
    chronicle_blank_keep_row = "chronicle_blank_keep_row"
    """
    Compatibility default: retain the row and its boundaries but blank duration_seconds and duration_minutes.
    """
    retain_and_credit = "retain_and_credit"
    """
    Retain raw timing and credit the episode while recording that it qualified as below the declared floor.
    """
    retain_but_exclude = "retain_but_exclude"
    """
    Retain raw timing and lineage but mark the episode ineligible for headline aggregates.
    """
    drop_row = "drop_row"
    """
    Remove the app output row while retaining its exact bounds, duration, reason, and source ranges in a dedicated excluded-lineage artifact.
    """


class MaximumDurationPolicyId(str, Enum):
    """
    Canonical identifiers for the maximum-duration policy: how an app episode whose duration exceeds a maximum threshold is treated. Chronicle's legacy behaviour is a candidate-admissibility rule inside the fused matcher (a candidate closer more than long_duration_threshold_hours after the opener is rejected, so the episode surfaces as End of Usage Missing); it is not a post-reconstruction stage. When every maximum-duration key is absent the legacy behaviour runs exactly as before and no receipt is emitted. Any explicit selection activates checked i128 arithmetic on the timestamp differences it evaluates and emits a maximum-duration receipt.
CITATION CORRECTION. An earlier version of this description offered Dekker et al. (2024) as precedent for keeping uncapped EPISODE durations. That misreads them. What Dekker et al. kept was extreme PARTICIPANTS — their sentence is "some extreme outliers were present, but these people seemed to use gaming apps extensively and were thus not removed", a decision about participant-level DAILY totals (screen time M = 327.43 min/day, max = 1270.00). They state no episode rule at all: their session is defined conceptually ("unlocking the phone, followed by a series of phone activities, until the phone is locked again") and the event-to-session logic belongs to the proprietary Murmuras collector, so they cannot be cited for or against an episode-duration policy. They did apply an exclusion elsewhere — YouTube Vanced and Basic Daydreams were removed from screen time as screen-forcing apps — so "Dekker kept the outliers" is not even a general stance of theirs. The honest precedent is therefore for the participant-day INCLUSION decision, not for this axis; nothing in the collected corpus supports a per-participant duration cap (see b12_adaptive_participant on MaximumDurationThresholdSourceId).
    """
    strategy_native = "strategy_native"
    """
    Explicitly adopt the selected reconstruction strategy's native maximum-duration behaviour. Baseline-equivalent output plus a receipt; not the same as omission.
    """
    chronicle_observed_close_rejection_v1 = "chronicle_observed_close_rejection_v1"
    """
    Name Chronicle's fused-matcher candidate-admissibility rule explicitly. Executable only with the fused_matcher strategy; every other strategy refuses with maximum_policy_incompatible_with_reconstruction_strategy.
    """
    post_reconstruction_strict_max_v1 = "post_reconstruction_strict_max_v1"
    """
    Generic stage after episode reconstruction and before concurrency: an episode qualifies when raw duration is strictly greater than the threshold (equality is retained), then the configured disposition applies.
    """


class MaximumDurationConfiguredDispositionId(str, Enum):
    """
    Disposition for an episode qualified by the generic maximum-duration stage. Only post_reconstruction_strict_max_v1 reads it; the other policies require not_applicable.
    """
    not_applicable = "not_applicable"
    """
    Required with strategy_native and chronicle_observed_close_rejection_v1, which own their endpoint behaviour natively.
    """
    flag_and_retain = "flag_and_retain"
    """
    Retain raw timing and credit the episode while recording that it qualified as above the declared maximum.
    """
    retain_but_exclude = "retain_but_exclude"
    """
    Retain raw timing and lineage but mark the episode ineligible for headline aggregates.
    """
    truncate_to_threshold = "truncate_to_threshold"
    """
    Move the effective stop to start + threshold, record the trimmed nanoseconds and effective_endpoint_reason, and keep the raw episode bounds in lineage.
    """
    drop_row = "drop_row"
    """
    Remove the app output row while retaining its exact bounds, duration, reason, and source ranges in the maximum-duration excluded-lineage receipt.
    """


class MaximumDurationThresholdSourceId(str, Enum):
    """
    Where the selected policy's threshold comes from. Each policy accepts exactly one pairing: strategy_native with strategy_native, chronicle_observed_close_rejection_v1 with chronicle_legacy_config, and post_reconstruction_strict_max_v1 with fixed_parameter or b12_adaptive_participant. Any other pairing refuses with request_shape_invalid; no missing sibling is filled in.
    """
    strategy_native = "strategy_native"
    """
    The selected reconstruction strategy's own threshold, if it has one; pairs only with the strategy_native policy.
    """
    chronicle_legacy_config = "chronicle_legacy_config"
    """
    Chronicle's long_duration_threshold_hours, canonicalized exactly to integer nanoseconds (1.25 h -> 4500000000000; a value that is not a whole number of nanoseconds refuses); pairs only with chronicle_observed_close_rejection_v1.
    """
    fixed_parameter = "fixed_parameter"
    """
    Read maximum_duration_threshold_ns: exact base-10 nanoseconds, [1-9][0-9]{0,18}, at most i64::MAX; pairs only with post_reconstruction_strict_max_v1.
    """
    b12_adaptive_participant = "b12_adaptive_participant"
    """
    Standing refusal (adaptive_maximum_threshold_provider_unavailable): no paper in the collected corpus derives a per-participant duration CAP, so there is nothing faithful for this source to execute and no fallback threshold is fabricated. The individualized-threshold practice that exists in the literature is Peng & Zhu (2020)'s per-user median of inter-app intervals, which is a session-grouping rule and is implemented as the peng_zhu_2020_participant_median arm of SessionGroupingPolicyId.
    """


class ScreenSessionConstructionStrategyId(str, Enum):
    """
    Canonical identifiers for device-level screen-session construction. The two source-sensitive strategies require a digest-bound capability sidecar and preserved physical source order; missing prerequisites refuse rather than falling back to Chronicle.
    """
    chronicle_screen_interactive_v1 = "chronicle_screen_interactive_v1"
    """
    Compatibility default: Chronicle's participant-isolated Screen Interactive / Screen Non-Interactive state machine with its existing duplicate, orphan, and right-edge behavior.
    """
    parry_toth_2025_session_glance_v1 = "parry_toth_2025_session_glance_v1"
    """
    Parry and Toth (2025) source-aligned adapter over separate Android event types 15-18 and 26-27, preserving screen-only physical adjacency and distinguishing sessions from locked glances.
    """
    zhu_2018_unlock_lock_v1 = "zhu_2018_unlock_lock_v1"
    """
    Zhu et al. (2018) source-aligned adapter: an immediately adjacent full-log screen-on then keyguard-hidden opens at unlock; screen-off or shutdown closes.
    """
    unlock_to_lock_v1 = "unlock_to_lock_v1"
    """
    Direct literature rule family: keyguard-hidden (unlock) opens a session and keyguard-shown (lock) closes it.
    """
    unlock_to_off_or_lock_v1 = "unlock_to_off_or_lock_v1"
    """
    Direct literature rule family: keyguard-hidden (unlock) opens a session and the first screen-non-interactive or keyguard-shown event closes it.
    """


class ScreenSessionClassificationPolicyId(str, Enum):
    """
    Source-selectable labels derived from a constructed screen interval.
    """
    none = "none"
    """
    Do not assign a literature screen-session class.
    """
    phone_check_inclusive_15s = "phone_check_inclusive_15s"
    """
    Tkaczyk et al. (2024): label a screen-on session lasting no longer than 15 seconds as phone_check; equality is included.
    """
    null_no_app_strict_gt15s_vs_app = "null_no_app_strict_gt15s_vs_app"
    """
    Hammer and Yan (2014): label sessions with app evidence as app, and no-app sessions strictly longer than 15 seconds as null.
    """


class ScreenSessionMaximumDurationDispositionId(str, Enum):
    """
    Action applied to a constructed screen interval above its declared maximum duration.
    """
    none = "none"
    """
    Preserve the constructed screen interval.
    """
    truncate = "truncate"
    """
    For a strictly over-threshold interval, stop at start plus the configured maximum and retain truncation lineage.
    """
    exclude_participant = "exclude_participant"
    """
    If any completed interval is strictly over the threshold, exclude that participant's analytical outputs; equality is retained.
    """


class LockedScreenAudioDispositionId(str, Enum):
    """
    Whether locked-screen app/audio continuation counts as interactive phone use.
    """
    include = "include"
    """
    Compatibility default; retain normal Chronicle app and screen construction.
    """
    exclude_from_phone_and_app_sessions = "exclude_from_phone_and_app_sessions"
    """
    Menthal rule: activity while the screen remains locked/noninteractive creates neither a phone session nor an app session.
    """


class ScreenGatingRuleId(str, Enum):
    """
    Canonical identifiers for the rule that decides which parts of an app session earn screen-gated credit. Chronicle's shipped rule is the intersection of two independently observed conditions: intervals where a screen event witnessed the screen ON (bridged across sub-auto-lock blips), and spans where the device was demonstrably alive (event cadence within the liveness tolerance, broken by a Device Startup). Naming the rule makes each conjunct selectable on its own, so a researcher can state which observation their measurement rests on instead of inheriting the intersection implicitly. The rule affects only the credited side output; the headline app-usage output is never changed by any value.
    """
    screen_and_liveness_v1 = "screen_and_liveness_v1"
    """
    Compatibility default: credit the intersection of witnessed screen-ON intervals and demonstrably-alive spans. Byte-identical to the pre-B07 credited output.
    """
    screen_witness_only = "screen_witness_only"
    """
    Credit witnessed screen-ON intervals alone, without requiring the device to be demonstrably alive. More permissive: a lit screen inside a long event silence still earns credit.
    """
    strict_visual_only = "strict_visual_only"
    """
    Credit witnessed screen-ON intervals alone and exclude any app session with no screen witness. This is the source-faithful visual-only rule; it never uses Chronicle's no-witness alive-span fallback.
    """
    device_liveness_only = "device_liveness_only"
    """
    Credit demonstrably-alive spans alone, without requiring a screen witness. An activity-based rather than screen-based measurement; the no-screen-witness fallback never applies because no screen evidence is consulted.
    """


class TimezoneNormalizationPolicyId(str, Enum):
    """
    Canonical identifiers for how a run resolves the ONE output timezone that every downstream day boundary is measured in, and for what happens to rows whose recorded timezone is not that zone.
This is the axis DayBoundaryAttributionId presupposes. That term defines a day as local midnight "in the row's output timezone" but says nothing about how the output timezone is chosen, and two of the four values here DELETE ROWS to make the answer unique. A daily total is therefore not fully specified by a day-boundary rule alone; it also depends on which value of this axis produced the clock and the surviving rows.
Timestamps themselves are absolute. "Convert" re-expresses the same instants on one clock and drops nothing; it changes the local-time columns and the `date` a row is attributed to. "Filter" keeps the recorded clock and removes every row that disagrees with it — a data-deletion decision made before any episode is reconstructed, upstream of every other axis in this ontology and of the compliance and coverage denominators.
Implemented by `resolve_timezone_strategy` (pipeline_v2_incremental.rs) and `standardize_event_clock`; the contract slot is `timezone_handling`, whose local enum TimezoneHandlingMode carries exactly these four values. The default is selected-convert, so the default run deletes no row for its timezone. This is the ONE axis whose values are declared in the local contract's own enum rather than read from here, because the kernel reads it as a plain string field; the two vocabularies are kept identical by `npm run check:contract`.
    """
    selected_filter = "selected-filter"
    """
    Keep only rows whose recorded timezone equals the researcher-selected zone; that zone becomes the output timezone. Every other row is DELETED before reconstruction. An empty selection refuses, and so does a selection that would remove all rows — but a selection that removes some rows does not warn.
    """
    selected_convert = "selected-convert"
    """
    Default. The researcher-selected zone becomes the output timezone and every row is re-expressed on it. No row is deleted for its timezone. This is what the studies' locked configuration runs, and it is also the kernel's absent-key default.
    """
    primary_filter = "primary-filter"
    """
    The output timezone is the file's primary zone — the most frequent non-empty recorded value, ties resolved to the first encountered — and every row not carrying that exact value is DELETED, including rows with a blank timezone, which are skipped when the primary is counted but not when the filter is applied.
    """
    primary_convert = "primary-convert"
    """
    The output timezone is the file's primary zone, computed the same way, and every row is re-expressed on it. No row is deleted.
    """


class DayBoundaryAttributionId(str, Enum):
    """
    Canonical identifiers for how a usage session that spans local midnight is attributed to calendar days. Chronicle dates a session by the local calendar day of its START instant and never divides it, so a session that runs from 23:40 to 00:20 contributes all forty minutes to the first day and none to the second. That is a measurement decision, not a fact about the device: a study reporting daily screen time is asking how much use fell within each day, and the undivided form answers a different question. Naming the rule lets a researcher state which one their daily totals rest on. The day boundary itself is local midnight in the row's output timezone under every value, resolved through the zone's own transitions so a daylight-saving day is 23 or 25 hours rather than an assumed 24. WHICH zone that is, and whether any row was deleted for disagreeing with it, is decided upstream by TimezoneNormalizationPolicyId — a daily total is specified by the two terms together, never by this one alone.
    """
    attribute_to_start_day = "attribute_to_start_day"
    """
    Compatibility default: a spanning session stays one row, dated by the local calendar day of its start instant. Byte-identical to the pre-B14 output.
    """
    split_at_local_midnight = "split_at_local_midnight"
    """
    A spanning session is divided at each local midnight it crosses into one row per calendar day, each carrying its own start, stop, duration, and date, and all of them carrying the same raw source evidence. Daily totals then sum the time that actually fell within each day.
    """


class PackageExclusionPresetId(str, Enum):
    """
    Canonical identifiers for WHICH rows of the supplied package-filter file actually exclude a package from app-usage measurement. This is the package-policy axis that the opener-set and reconstruction-strategy axes defer to; it selects the membership of the excluded set and changes nothing about how an episode is reconstructed.
Exclusion in this pipeline is a RELABEL, never a deletion: an excluded package's episode is retained as `Filtered App Usage`, keeps its raw evidence and its place in the event order, and still closes and opens neighbouring episodes exactly as it would if it were not excluded. Every value below therefore moves which rows carry the excluded label and the headline app-usage totals derived from them, and none of them moves episode reconstruction.
The shipped default filter file (`Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv`) carries an `app_filter_category` classification and a per-row `filter_bool`. Before this axis existed no kernel step read either column — the filter map was built from the package and label columns alone — so every supplied row excluded regardless of its category, and a row marked `filter_bool` 0 was excluded anyway. That silent disagreement between a shipped artifact and engine behavior is what naming this axis resolves. Unknown identifiers resolve to `all_supplied_rows`, which is the widest membership and the pre-existing behavior, so an unrecognised value can never silently narrow the excluded set.
    """
    all_supplied_rows = "all_supplied_rows"
    """
    Compatibility default: every row of the supplied filter file excludes its package, whatever its `app_filter_category` and whatever its `filter_bool` says. Byte-identical to the pre-B10 output. The category and flag columns remain unread under this value.
    """
    honor_filter_flag = "honor_filter_flag"
    """
    Read `filter_bool`: a row whose flag parses as 0 (or `false`/`no`/`off`, case-insensitively) does not exclude its package; every other row does, including a row whose flag is absent or unparseable, which keeps an unreadable flag from silently narrowing the set. All 80 rows of the shipped default file carry 1, so this value is a no-op on the shipped file and takes effect only on a file a researcher has edited.
    """
    system_scope_only = "system_scope_only"
    """
    Read `app_filter_category`: exclude only rows classified `system` or `system-defensive` — the launcher, system-UI, settings and keyguard surfaces that are not user-facing apps. On the shipped default file that is 60 of the 80 rows, leaving the carrier, audio, navigation, external-remote, lockscreen-phantom and non-child-productivity rows measured as ordinary app usage. A row with no category, or a category outside those two, is not excluded under this value.
    """


class FilterMatchFieldId(str, Enum):
    """
    Canonical identifier for the field whose exact value makes a filter-file row match an input row. app_package_name is the compatibility default. application_label uses case-sensitive full-string equality and retains a matched row as filtered lineage without inferring a package identity.
    """
    app_package_name = "app_package_name"
    """
    Compatibility default: match the supplied package identity, optionally narrowed by the supplied known label.
    """
    application_label = "application_label"
    """
    Match the input application_label by exact, case-sensitive, full-string equality; never case-fold, use substrings, or infer a package.
    """


class NotificationProxyRuleId(str, Enum):
    """
    Canonical identifiers for WHICH raw notification rows, if any, become explicit proxy contact events. This axis exists so that notification-derived usage is represented only through a named rule with visible provenance, never implicitly.
Chronicle records Android's `NOTIFICATION_SEEN` (event type 10) and `NOTIFICATION_INTERRUPTION` (type 12) as app-scoped rows carrying a package name, and the app-usage reconstruction reads neither: output rows are episodes, so a raw notification row produces no output at all. The only notification decision the engine made before this axis was internal to one reconstruction strategy, which declares `Notification Seen` unmatchable as an episode stop.
A notification is an INSTANT, not an interval. No value below contributes a duration to app usage or changes the headline app-usage output in any way: admitted rows are emitted into a separate `Notification Contact` CSV whose rows carry no start, stop, or duration at all. Each emitted row keeps its source interaction type and gains two flags in `any_app_usage_flags` — the rule that emitted it, and whether its instant falls inside a reconstructed episode of the same package, so notification contact can be separated from time already counted as observed usage.
Unknown identifiers resolve to `none`, which emits nothing. This is the one axis that NARROWS on an unrecognised value rather than widening: the failure it must prevent is fabricating proxy usage a study did not ask for.
    """
    none = "none"
    """
    Compatibility default: notification rows play no role beyond whatever the selected reconstruction strategy already does with them, and no proxy channel is emitted. Byte-identical to the pre-B08 output.
    """
    seen_contact_v1 = "seen_contact_v1"
    """
    `Notification Seen` (Android type 10) only. The notification was posted and surfaced to the user; nothing in the event says it was acted on. This is the weaker of the two contact signals.
    """
    interruption_contact_v1 = "interruption_contact_v1"
    """
    `Notification Interruption` (Android type 12) only. The notification actively interrupted the user rather than merely being visible, so it is the stronger contact signal of the two.
    """
    any_notification_contact_v1 = "any_notification_contact_v1"
    """
    Both notification types, emitted into one channel. Each row still records which type it came from, so the two can be separated after the fact without a second run.
    """


class PolledEmulationMethodId(str, Enum):
    """
    Canonical identifiers for WHICH published polled-collection rule, if any, is re-derived from this run's reconstructed episode timeline and emitted as a declared approximation alongside the headline app-usage output.
Chronicle collects the EVENT STREAM: every foreground transition carries its own timestamp. A large part of the smartphone-use literature does not. It POLLS — a background service records what is on screen at a fixed cadence — and derives sessions from those samples. A researcher holding Chronicle totals cannot compare them to a published polled study, because the two instruments did not observe the same thing. This axis exists so that comparison can be made explicitly, under a named rule, rather than by assuming the two measurements are interchangeable.
Every value other than `none` emits a SEPARATE `Polled Emulation` CSV. The headline app-usage output is never changed by any value here. Each emitted row carries, in `any_app_usage_flags`, the method and cadence that produced it and the flag `EMULATED NOT OBSERVED`, because the one thing a reader must not do is mistake a re-derived row for collected data.
The approximation is lossy in a measurable direction, which is why it must be declared rather than folded into a default. ScreenTK 2024 (`10.1145/3675094.3677547`) reports that five-second sampling misses substantial active and passive UI events against an interval baseline. Resampling an event-derived timeline can only LOSE detail relative to that timeline: it does not reproduce what a real polled collector would have missed differently — jitter, doze, service restarts, permission loss. Treat the difference as a lower bound between instruments, not as a simulation of one.
Screen state is an assumption, not an observation. The published rules retain only samples whose `ScreenStatus` is `Interactive`. In an event-derived timeline a sample instant falling inside an app episode IS an interactive sample with that package foregrounded, so the retention is already implied by the episode. Every emitted row is produced under that equivalence, and carries the flag that says so.
Package exclusion is NOT part of this axis. The published rules exclude the study app, Android, System UI and launchers; this repository already owns that decision through the filter file and the package-exclusion preset, and emulation runs over whatever the run's existing exclusion already decided rather than introducing a second package list.
Unknown identifiers resolve to `none`. Like the notification-proxy axis this NARROWS on an unrecognised value: the failure it must prevent is fabricating an emulated measurement a study did not ask for.
    """
    none = "none"
    """
    Compatibility default: no resampling is performed and no emulated channel is emitted. Byte-identical to the pre-B09 output.
    """
    ross_2025_sampled_gap_v1 = "ross_2025_sampled_gap_v1"
    """
    Ross, Rhee, Le, Mount, Chang & Bayer (2025), Scientific Reports `10.1038/s41598-025-25174-2`, OSF `bjh2m`. The rule is declared in released code, not inferred from prose: a retained sample ends and counts a session when the gap to the next sample is at least the gap threshold or the next foreground package differs, and the terminal sample is forced closed so that it counts. Duration comes from endpoint subtraction over the retained samples. The brief for this source is explicit that the 15 s figure is an engineering rule embedded in code, not a validated behavioral cutoff — which is exactly why it is reproducible here as a named choice instead of a default.
    """
    cerit_2025_sample_count_v1 = "cerit_2025_sample_count_v1"
    """
    Cerit et al. (2025), `10.2196/59875`. A different polled shape: duration is the RETAINED SAMPLE COUNT converted by the sampling cadence, never endpoint subtraction. Emitted for the same timeline as the Ross rule so the two conversions can be compared directly; the gap threshold does not apply, because this rule never asks how far apart two samples were.
    """


class IntervalExpansionMethodId(str, Enum):
    """
    Canonical identifiers for source-declared expansions of bounded app intervals into a separate derived timeline. This is not polling: every emitted point is anchored to its own source interval start, and the headline reconstructed episode table is never changed.
    """
    none = "none"
    """
    Compatibility default: emit no interval-expansion artifact.
    """
    behapp_start_anchored_half_open_1s_v1 = "behapp_start_anchored_half_open_1s_v1"
    """
    Exact deposited Behapp preprocessing for `10.1037/emo0001485` (`Match_ESM_App.py`): compute end as start plus `int(duration)`, then emit start, start + 1 second, ... strictly before end. Thus a three-second interval emits offsets 0, 1, and 2, never the stop endpoint.
    """


class DayCoverageStatus(str, Enum):
    """
    Per participant-day observability status, as the engine actually computes it in `build_coverage` (pipeline_v2_incremental.rs) and emits it in the `day_coverage_csv` `status` column. Exactly these three values are produced; there is no fourth.
The day spine is the participant's study window when one is configured, and otherwise the inclusive range from their first to their last observed date, so "no data" is only ever asserted INSIDE a window that was expected to hold data. That is what makes the no-activity / no-data distinction an observability claim rather than a claim about the person.
Admission to `usage` is narrower than "an app episode exists on that day": the row must be App Usage (a Filtered App Usage row does not count), must be aggregate-eligible under the minimum-duration disposition, and must carry a duration strictly greater than zero. A day whose only app rows are filtered, sub-floor, or zero-length is therefore `no_activity`, not `usage`, even though app activity was observed.
    """
    usage = "usage"
    """
    At least one App Usage episode on this day is aggregate-eligible with a duration strictly greater than zero minutes.
    """
    no_activity = "no_activity"
    """
    Raw events exist for this participant-day but no episode meets the `usage` bar. Observation happened; qualifying usage did not. Related to, but NOT identical with, `add_no_activity_placeholder_days`: the placeholder (a zero-duration `com.placeholder.noactivity` row synthesized from the day's first raw event — a marker for an observed day, never invented usage) is suppressed by ANY retained App Usage row (`add_no_activity_placeholder_rows`, pipeline_v2.rs), while this status applies the stricter `usage` bar — so a day whose only app rows are sub-floor or zero-length is `no_activity` here yet receives no placeholder.
    """
    no_data = "no_data"
    """
    The day lies inside the participant's spine but carries no raw event at all. Nothing was observed, so nothing can be said about use; this is the only value that means absence of observation rather than absence of qualifying usage.
    """


class CoverageCause(str, Enum):
    """
    Best-supported cause of a coverage gap. A gap is an OBSERVABILITY condition — never asserted as physical inactivity.
NOT CURRENTLY COMPUTED. No path in the kernel produces any of these four values: the shipped day-coverage output is DayCoverageStatus, which classifies a day as usage / no_activity / no_data and offers no cause at all. This enum, and the CoverageAssessment class that carries it, are design-time vocabulary for a cause attribution the engine does not yet make. They are retained because the distinctions are the ones the event stream could support — Device Shutdown and Device Startup are already canonical EventTypeCode values and the screen-gating layer already reads device liveness — but an instance carrying a value here is an assertion by whoever wrote it, not a reading of this pipeline's output.
    """
    shutdown_boundary = "shutdown_boundary"
    """
    Gap opens with a clean shutdown-class event.
    """
    unclean_power_loss = "unclean_power_loss"
    """
    Gap ends with a startup-class event but no clean shutdown (battery death / forced off).
    """
    collector_reporting_gap = "collector_reporting_gap"
    """
    Device on but the collector did not report.
    """
    unknown = "unknown"
    """
    Cause not determinable from events.
    """


class DeviceSharingStatus(str, Enum):
    """
    Whether a participant's device is declared shared, as the compliance step reads it from the device-sharing support file. Emitted verbatim in the `sharing_status` column of the `compliance_csv`.
    """
    shared = "shared"
    """
    The participant appears in the device-sharing file (CSV literal "Shared"). Only for these participants is a compliance share measured.
    """
    non_shared = "non_shared"
    """
    The participant does not appear in the device-sharing file (CSV literal "Non-Shared"). The compliance percent is imputed, not measured — see ComplianceValueBasis.
    """


class ComplianceValueBasis(str, Enum):
    """
    How a ComplianceDayAssessment's compliance_percent came to hold its value. This distinction exists because the engine writes the literal 100.0 into two cases where nothing was measured, and the CSV column that carries it is the same column that carries a real share — so a reader summarizing the column without this basis is averaging measurements together with imputations.
    """
    measured_share = "measured_share"
    """
    known_minutes / (known_minutes + unknown_minutes), rounded to two decimals. Produced only when the participant is shared AND the day admitted a positive total.
    """
    imputed_non_shared_device = "imputed_non_shared_device"
    """
    The participant is not in the device-sharing file, so no attribution question arises and the engine writes 100.0. Nothing about this day's attribution was measured.
    """
    imputed_no_eligible_usage = "imputed_no_eligible_usage"
    """
    The admitted total for the day is zero — no App Usage or Non-Target Participant App Usage row survived aggregate eligibility with nonzero minutes — so the share is 0/0 and the engine writes 100.0. The day is recorded with zero_eligible_usage set, which is the only signal separating it from a genuine perfect day.
    """


class QueryExecutionStatus(str, Enum):
    """
    Observed state of one physical query in a runtime execution.
    """
    cached = "cached"
    """
    Reused from a compatible in-memory or durable checkpoint.
    """
    recomputed = "recomputed"
    """
    Evaluated during this run.
    """
    error = "error"
    """
    Evaluation failed.
    """
    skipped = "skipped"
    """
    Intentionally omitted by the execution mode.
    """
    bypassed = "bypassed"
    """
    Not applicable for the supplied inputs and configuration.
    """


class ScreenStateId(str, Enum):
    """
    Normalized supplied screen state, not recovered Android serializer codes (Hard Lock Life, printed p218 Figure1).
    """
    ON = "ON"
    OFF = "OFF"


class KeyguardStateId(str, Enum):
    """
    Normalized supplied keyguard state; screen-off does not imply locked (Hard Lock Life, printed p218 Figure1).
    """
    LOCKED = "LOCKED"
    UNLOCKED = "UNLOCKED"


class DeviceStateIntervalKindId(str, Enum):
    """
    Distinct supplied interval meanings, not reconstruction algorithms or raw codes.
    """
    screen_bout = "screen_bout"
    """
    SCREEN_ON to SCREEN_OFF, including lock-screen use (Hard Lock Life, printed p220 Section4.2.1).
    """
    unlock_cost_upper_bound = "unlock_cost_upper_bound"
    """
    ON_LOCKED to ON_UNLOCKED, potentially including clock/notification viewing, not pure authentication time (printed p218 Section4.1.1).
    """


class MethodSettingRoleId(str, Enum):
    """
    Functional role of one source-supported method setting in a complete study profile.
    """
    acquisition = "acquisition"
    event_schema = "event_schema"
    diary_schema = "diary_schema"
    participant_schema = "participant_schema"
    reconstruction = "reconstruction"
    quality_control = "quality_control"
    aggregation = "aggregation"
    feature_engineering = "feature_engineering"
    analysis = "analysis"
    intervention = "intervention"
    """
    Source-controlled app behavior that delivers an intervention, changes content availability, or actuates a device setting, distinct from data acquisition and downstream analysis.
    """
    validation = "validation"
    reporting = "reporting"
    provenance = "provenance"


class TypingTrialRepresentationId(str, Enum):
    """
    Retained action membership versus explicitly supplied derived-only trial cells. Missing actions never select a branch.
    """
    action_membership = "action_membership"
    derived_metrics = "derived_metrics"


class MethodTargetLayerId(str, Enum):
    """
    The layer whose meaning or behavior a method setting changes.
    """
    collector = "collector"
    raw_occurrence = "raw_occurrence"
    raw_record = "raw_record"
    acquired_snapshot = "acquired_snapshot"
    app_episode = "app_episode"
    app_session = "app_session"
    screen_bout = "screen_bout"
    device_session = "device_session"
    device_setting_state_interval = "device_setting_state_interval"
    """
    An observed occupancy interval for a device setting such as ringer mode, bounded by state changes; not a device-use session or proof of occupancy during unobserved power-off time. Chang and Tang DOI 10.1145/2785830.2785852, PDF pp. 11–12, 14–15.
    """
    device_setting_actuation = "device_setting_actuation"
    """
    Source-controlled behavior that changes a device setting, including action eligibility, calibration guards and triggering conditions; distinct from observed setting-change occurrences, occupancy intervals, intervention-content availability and predictive models. Pielot DOI 10.1145/2632048.2632060, author PDF p. 2, The Silencer Application: per-call acceleration calibration gates conditional temporary ringer muting.
    """
    pickup_activation = "pickup_activation"
    participant_day = "participant_day"
    participant_hour = "participant_hour"
    """
    A supplied participant-specific one-hour period, distinct from a participant day or pooled hour-of-day bucket. CHI2020 Paper36 CCM, DOI 10.1145/3313831.3376163 pp5–6, aggregates each retained emotion independently alongside app-launch counts and total use duration; period endpoints and clocks remain source-specific.
    """
    participant_record = "participant_record"
    participant_measure = "participant_measure"
    study_window = "study_window"
    analysis_record_set = "analysis_record_set"
    """
    Source-defined subset of observed records selected for a named downstream analysis, without changing what the collector acquired or which participants entered the study. Snooze! DOI 10.1145/3229434.3229436 excludes installation-day snooze events from its reported analyses (PDF p. 5); Dismissed! DOI 10.1145/3229434.3229445 excludes immediately attended notifications only from its Sankey flow (PDF p. 3:7).
    """
    text_entry_trial = "text_entry_trial"
    """
    One source-defined typing-analysis trial, distinct from app/device-use sessions or an analysis subset. Akpinar et al. DOI 10.1145/3577013 p13§4.2 reconstructs action sequences; Rodrigues et al. DOI 10.1145/3491102.3501908 p5§3.1.2 retains derived metrics for first-letter-to-keyboard-closure trials without retaining raw actions.
    """
    diary_item = "diary_item"
    diary_response = "diary_response"
    derived_feature = "derived_feature"
    model = "model"
    notification_item = "notification_item"
    """
    A source-defined notification identity that can persist across observed snapshots or repeated snoozes; distinct from a posted callback, an analytic alert proxy, and each item appearance or user action. Clear All DOI 10.1145/3340764.3340765, PDF p. 5; Snooze! DOI 10.1145/3229434.3229436, PDF p. 5. Identity keys remain source-specific and may be undisclosed.
    """
    notification_alert = "notification_alert"
    """
    An analytic alert proxy inferred from inbound Android notification callbacks, not an observed perceptible alert. Dismissed! retains the last posted callback in a same-second burst because it usually contains the perceived alert; it does not establish one-to-one callback/alert identity (DOI 10.1145/3229434.3229445, PDF pp. 3:3–3:4). An Annotif annotation candidate is a filtered record, not an alert claim.
    """
    notification_attendance = "notification_attendance"
    """
    An inferred per-notification seen, checked, consumed, or related attendance state, not direct observation of human reading (Dismissed! DOI 10.1145/3229434.3229445, PDF p. 3:6; My Phone and Me DOI 10.1145/2858036.2858566, accepted manuscript pp. 4–5).
    """
    notification_delivery = "notification_delivery"
    """
    Outbound intervention notification scheduling, triggering, and payload selection; not an observed Android notification event.
    """
    intervention_content_state = "intervention_content_state"
    """
    Intervention tool availability and unlock transitions; not a released artifact or measured outcome.
    """
    call_handling = "call_handling"
    """
    Source-controlled incoming-call alert presentation and handling, including accept/decline/repeated-postpone actions, call/conversation transitions and scripted call-arrival or caller-hangup rules. Distinct from intervention-tool availability/unlocking, device-setting actuation, outbound notification delivery and observed notification-record identity. Böhmer et al. DOI 10.1145/2556288.2557066, PDF pp. 3–4, 7–9; source-defined behavior does not establish raw event keys or an executable call-state implementation.
    """
    outcome = "outcome"
    released_artifact = "released_artifact"


class MethodValueKindId(str, Enum):
    """
    Serialization shape of a method setting's source-declared value.
    """
    boolean = "boolean"
    integer = "integer"
    float = "float"
    string = "string"
    enumeration = "enumeration"
    duration = "duration"
    timestamp = "timestamp"
    time_window = "time_window"
    list = "list"
    object = "object"
    expression = "expression"
    artifact_reference = "artifact_reference"
    unspecified = "unspecified"


class MethodImplementationStatusId(str, Enum):
    """
    Whether Chronicle can execute a source-supported setting without silently approximating it.
    """
    native = "native"
    external_executor = "external_executor"
    specification_only = "specification_only"
    refused_missing_signal = "refused_missing_signal"
    unresolved = "unresolved"


class MethodExecutionRouteId(str, Enum):
    """
    Exact destination through which a source-supported setting participates in replication.
    """
    native_option_binding = "native_option_binding"
    protocol_input = "protocol_input"
    native_operator_parameter = "native_operator_parameter"
    external_named_executor = "external_named_executor"
    receipt_conformance = "receipt_conformance"


class DocumentaryExecutionEligibilityId(str, Enum):
    """
    Closed execution eligibility for documentary-only provenance receipts.
    """
    documentary_only = "documentary_only"
    """
    The provenance receipt is executable; the referenced artifact is not executed.
    """


class MethodDisclosureStatusId(str, Enum):
    """
    Normalized disclosure state; access depth and implementation state remain separate.
    """
    declared = "declared"
    declared_partial = "declared_partial"
    delegated = "delegated"
    absent = "absent"
    not_applicable = "not_applicable"
    undetermined = "undetermined"


class MethodApplicabilityStatusId(str, Enum):
    """
    Whether a setting is required to reproduce this profile, independent of whether the source disclosed it.
    """
    applicable = "applicable"
    not_applicable = "not_applicable"
    undetermined = "undetermined"


class MethodProfileExecutionStatusId(str, Enum):
    """
    Whole-profile execution state after every required setting, input, GUI control, receipt, and conformance gate is evaluated.
    """
    executable = "executable"
    blocked = "blocked"
    specification_only = "specification_only"


class MethodConfigurationStructureId(str, Enum):
    """
    How a source relates multiple method specifications without flattening them into one paper-wide value.
    """
    fixed = "fixed"
    full_factorial = "full_factorial"
    one_factor_at_a_time = "one_factor_at_a_time"
    coherent_joint_specifications = "coherent_joint_specifications"
    ablation = "ablation"
    cross_study_catalog = "cross_study_catalog"
    source_declared_axes = "source_declared_axes"
    enumerated_combinations = "enumerated_combinations"
    conditional = "conditional"
    documentary_only = "documentary_only"
    evidence_blocked = "evidence_blocked"


class MethodConfigurationSelectionStatusId(str, Enum):
    """
    Whether a source configuration selection is exact and source-authorized.
    """
    exact = "exact"
    incomplete = "incomplete"
    prohibited = "prohibited"


class DiaryTriggerKindId(str, Enum):
    """
    What causes a diary prompt or entry opportunity to become due.
    """
    scheduled = "scheduled"
    random = "random"
    event_triggered = "event_triggered"
    participant_initiated = "participant_initiated"
    completion_relative = "completion_relative"


class SequenceEncodingRuleId(str, Enum):
    """
    History-dependent encoding of an ordered sequence, not record selection or deduplication.
    """
    first_vs_previously_seen_in_partition = "first_vs_previously_seen_in_partition"
    """
    Emit one symbol for every ordered occurrence. Emit the first symbol if this identity has not occurred earlier in the current partition and the repeat symbol otherwise, retaining every repeat and resetting history at each partition. Does not specify raw identity extraction or tie order. Jones DOI 10.1145/2750858.2807542, physical PDF p.6 (Bath cover=p.1).
    """


class GroupedRecordGroupingBasisId(str, Enum):
    """
    How candidate records are grouped inside an already established partition.
    """
    declared_group_membership = "declared_group_membership"
    """
    Use the upstream declared groups; do not infer undisclosed equality fields.
    """
    field_equality = "field_equality"
    """
    Group by equality of the referenced source fields inside the upstream partition.
    """
    raw_string_concatenation = "raw_string_concatenation"
    """
    Group by equality of the raw strings concatenated in the declared operand order, without separator, escaping or type coercion. Only explicitly listed absent fields default to the empty string; null is not absence.
    """


class GroupedRecordSelectionRuleId(str, Enum):
    """
    Which members of each candidate group survive; not a timestamp or tie-order rule.
    """
    FIRST = "FIRST"
    """
    Retain the first member in the source-defined order; undisclosed ordering stays unresolved.
    """
    LAST = "LAST"
    """
    Retain the last member in the source-defined order; undisclosed ordering stays unresolved.
    """
    DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS = "DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS"
    """
    Discard summary members only when non-summary members coexist, preserving all non-summary members. Preserve summary-only groups without imposing singleton cardinality or FIRST/LAST reduction. The literal summary marker and its extraction are separate source-schema facts, not supplied by this rule.
    """
    RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL = "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL"
    """
    Preserve every summary member when any summary exists, otherwise every member, retaining their relative input order. Do not collapse multiple summaries or impose FIRST/LAST. Marker extraction is a separate source fact.
    """


class InteractionEventPayloadRoleId(str, Enum):
    """
    Payload roles within one captured UI interaction-event record, not independent input channels.
    """
    screenshot = "screenshot"
    """
    Captured visual representation of the UI.
    """
    view_hierarchy = "view_hierarchy"
    """
    Captured structural representation of the same UI.
    """
    gesture = "gesture"
    """
    Associated interaction type and location; its presence does not establish correctness.
    """


class InteractionEventPayloadAssociationId(str, Enum):
    """
    Source-declared payload association, without inventing synchronization, matching timeouts or tie handling.
    """
    gesture_to_most_recent_paired_snapshot = "gesture_to_most_recent_paired_snapshot"
    """
    Associate the inferred gesture with the most recent event's paired screenshot and view hierarchy.
    """


class SensorControlActionId(str, Enum):
    """
    Supplied normalized enable/disable occurrence label, not proof of successful collection or a reconstructed active interval.
    """
    enable = "enable"
    disable = "disable"


class InteractionTraceRecordOriginId(str, Enum):
    """
    Epistemic status of supplied normalized records; neither value authenticates an original source export. Reused for interaction traces, notification snapshots/histories and ringer-state intervals.
    """
    analyst_constructed_example = "analyst_constructed_example"
    supplied_normalized_records = "supplied_normalized_records"


class NotificationEvidenceKindId(str, Enum):
    """
    Distinct supplied notification-history evidence quantities in My Phone and Me (2016), accepted manuscript pp.3-4 Figure2/Table1/Data Collection. A classification record is not necessarily a directly observed action.
    """
    arrival = "arrival"
    removal = "removal"
    phone_unlock = "phone_unlock"
    corresponding_app_launch = "corresponding_app_launch"
    notification_bar_click = "notification_bar_click"
    swipe_dismiss = "swipe_dismiss"
    assumed_seen = "assumed_seen"
    seen_latency = "seen_latency"
    clicked = "clicked"
    dismissed = "dismissed"
    context = "context"
    """
    A supplied item-linked context value, distinct from a lifecycle/action event or response classification (My Phone and Me p.4 Table1; Content-driven notifications p.3 Table1).
    """
    category = "category"
    """
    Supplied item-specific information category, not a participant/title multi-label annotation or a category computed on import (Content-driven notifications p.4 Dataset).
    """
    response_stage = "response_stage"
    """
    Supplied stage-specific response evidence with independent observability; unobservable does not mean no decision or negative response (Reachable pp.3-4 Sections3.1-3.2.1/Figure1).
    """
    response_endpoint = "response_endpoint"
    """
    Supplied graded response endpoint, separate from evidence availability: Reachable pp.3-4/p.6 distinguishes null, partial and complete responses. No endpoint is inferred.
    """
    response_objective_label = "response_objective_label"
    """
    Independently supplied named response-objective label (Reachable p.4/p.6: reachability, engageability, receptivity), not a universal acceptance recode or computed truth table.
    """
    quantity = "quantity"
    """
    Independently supplied named item-owned quantity, distinct from context, seen latency or response classification. Call to Action (DOI 10.3390/s24082612, pp.7–8) defines Interaction Delay from appearance to removal. Import retains a supplied value/unit/supports without endpoint pairing, arithmetic, rounding or eligibility filtering.
    """
    action_occurrence = "action_occurrence"
    """
    Separately identified supplied item-owned action with an open action label; repeated postpones and widget moves are distinct from call endings (Interrupted by a Phone Call pp.3,7–8). No raw action code or intent is inferred.
    """
    posted_callback = "posted_callback"
    """
    Separately identified supplied NotificationListenerService posted callback, not a logical item arrival or perceived alert (Dismissed! printed pp.3:3–3:4). Populated ingress requires a supplied callback-group owner, not an item history.
    """


class NotificationResponseObservabilityId(str, Enum):
    """
    Supplied availability of stage observation, independent of the stage's supplied classification or whether the decision occurs (Reachable p.4 Section3.2.1).
    """
    observable = "observable"
    """
    Stage evidence can be observed; does not itself assert a positive response.
    """
    unobservable = "unobservable"
    """
    Stage observation is unavailable; a supplied inferred annotation is not direct observation or a negative response.
    """


class NotificationEvidenceRoleId(str, Enum):
    """
    Status of a supplied evidence record, not an authenticity, causality or human-attention guarantee.
    """
    recorded = "recorded"
    """
    Supplied recorded event or source-recorded classification; clicked/dismissed can incorporate inference.
    """
    inferred = "inferred"
    """
    Explicitly inferred assertion or derived quantity, not directly observed attention or an executed inference here.
    """


class ParticipantDayObservationKindId(str, Enum):
    """
    Supplied objective period aggregate, subjective response or separately owned collection-run modality availability. Legacy day-named enum retains period observations; collection runs are not calendar periods. None computes aggregation, eligibility or correlations.
    """
    objective_aggregate = "objective_aggregate"
    """
    Supplied aggregate of objective log data for the referenced participant-period.
    """
    subjective_response = "subjective_response"
    """
    Supplied subjective answer about the explicit period; submission time does not identify the period described.
    """
    modality_availability = "modality_availability"
    """
    Supplied modality contribution within an explicitly identified collection run (Moodable primary508–517,603–611,685–689). Provided/unavailable are constructed normalized states, not source serializer codes; unavailable does not imply refusal, permission denial, empty history, zero count or model eligibility.
    """


class NotificationOpeningKindId(str, Enum):
    """
    Distinct opening proxies in In-Situ notifications (DOI 10.1145/2628363.2628364), p.4 Notification Viewed. Neither establishes actual reading or response.
    """
    app_opening = "app_opening"
    """
    Opening the corresponding application; not necessarily process launch. Membership refers to supplied pending items associated with that app.
    """
    drawer_opening = "drawer_opening"
    """
    Opening the drawer; membership refers to supplied pending items shown there, not all outstanding items inferred from arrivals.
    """


class NotificationContextSamplingBoundaryId(str, Enum):
    """
    Collection boundary of supplied item-linked context; distinct from a feature's retrospective window or a verified sample timestamp.
    """
    arrival = "arrival"
    """
    Collected at arrival (My Phone and Me accepted manuscript p.4 Table1); no exact clock alignment or GPS join is implied.
    """
    removal = "removal"
    """
    Collected at removal (My Phone and Me accepted manuscript p.4 Table1); not a response, swipe or seen-time boundary.
    """
    interruption = "interruption"
    """
    Interruption-relative context alignment, not necessarily a sensor sample exactly at interruption (Reachable p.6 Section4.2: closest screen reading within plus/minus0.5s). No alignment or tie handling runs on import.
    """
    posting = "posting"
    """
    Posting-relative feature anchor, not a sensor sample exactly at posting. Beyond Interruptibility (DOI 10.1145/3130956, pp.8,11–12) starts sensor collection 30 seconds earlier and describes independent retrospective windows. Neither sample-time equality nor a reducer is inferred.
    """
    source_unreported = "source_unreported"
    """
    The inspected source does not disclose context sampling alignment (Content-driven notifications p.3 Table1/NotifyMe); previous-minute features do not supply it.
    """


class RingerModeId(str, Enum):
    """
    Normalized ringer-setting vocabulary in Chang and Tang (2015), printed p.12 / physical PDF p.7. Not Android numeric mode codes or a claim of device use.
    """
    Normal = "Normal"
    Vibrate = "Vibrate"
    Silent = "Silent"


class NotificationItemIdentityBasisId(str, Enum):
    """
    Distinct Clear All paper and linked-analysis identity definitions; their equivalence is not established.
    """
    paper_four_field_combination = "paper_four_field_combination"
    """
    Package, notification ID, notification tag and creation instant (Clear All PDF p.5), represented by supplied normalized tokens.
    """
    linked_code_key_posttime = "linked_code_key_posttime"
    """
    Supplied key and str(postTime) tokens used by the pinned release's key + '@' + str(postTime), not a recovered four-field expansion.
    """


class InteractionRedactionSelectionId(str, Enum):
    """
    ODIM's distinct device and web selection relations (PDF pp. 8-9, section 4.4); no IoU cutoff is inferred.
    """
    selected_ui_element = "selected_ui_element"
    drawn_region_sufficient_iou = "drawn_region_sufficient_iou"


class ScreenshotRedactionEffectId(str, Enum):
    """
    Source-declared pixel effects, not evidence that a supplied image is sanitized.
    """
    selected_element_pixels_deleted = "selected_element_pixels_deleted"
    drawn_region_blackened = "drawn_region_blackened"


class HierarchyRedactionEffectId(str, Enum):
    """
    Tagging corresponding text/content and removing qualifying metadata are not interchangeable.
    """
    corresponding_text_content_tagged = "corresponding_text_content_tagged"
    qualifying_element_metadata_removed = "qualifying_element_metadata_removed"



class PlatformEventOccurrence(ConfiguredBaseModel):
    """
    The real-world Android lifecycle/system occurrence (an app resuming, the screen turning off, a shutdown). This is the thing that happened in the world — NOT the logged record and NOT an observation. Deliberately untyped as sosa:Observation.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    occurrence_instant: Optional[str] = Field(default=None, description="""When the occurrence happened.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence',
                       'NotificationOpeningOccurrenceRecord',
                       'SensorControlOccurrenceRecord'],
         'slot_uri': 'time:inXSDDateTimeStamp'} })
    event_code: Optional[EventTypeCode] = Field(default=None, description="""Canonical event type.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence', 'UsageEventRecord']} })


class UsageEventRecord(ConfiguredBaseModel):
    """
    The logged information artifact for one Android usage event. A prov:Entity, not an observation.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    event_timestamp_ns: Optional[int] = Field(default=None, description="""Event timestamp in nanoseconds since epoch.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })
    event_code: Optional[EventTypeCode] = Field(default=None, description="""Canonical event type.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence', 'UsageEventRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    app_class_name: Optional[str] = Field(default=None, description="""Android activity class name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    timezone: Optional[str] = Field(default=None, description="""Original recording timezone (preserved).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'NotificationDrawerSnapshotRecord']} })
    records_occurrence: Optional[PlatformEventOccurrence] = Field(default=None, description="""The real-world occurrence this record logs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })


class LoggingObservation(ConfiguredBaseModel):
    """
    OPTIONAL. The OS logger's act of observing a device property, modeled only if that abstraction is genuinely needed. Do NOT type UsageEventRecord as this.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['sosa:Observation'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    observed_property: Optional[str] = Field(default=None, description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    result_record: Optional[UsageEventRecord] = Field(default=None, description="""The event record produced by the logging observation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation']} })


class InteractionTraceRecord(ConfiguredBaseModel):
    """
    A supplied normalized current interaction trace, not a device-use session, prospective method plan or claimed ODIM serialization. Events belong to this trace in explicit sequence positions; absent events are not current members. ODIM PDF pp. 6-7 sections 4.2-4.3 supports sequential events and manual removal. No timestamp-sort predicate, edit journal or payload-byte verification is implied.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'description': 'Optional supplied trace '
                                                          'participant identity. Known '
                                                          'identities constrain linked '
                                                          'tasks; unknown identity is '
                                                          'not inferred from payloads '
                                                          'or accounts.',
                                           'name': 'participant_id',
                                           'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    interaction_trace_id: str = Field(default=..., description="""Normalized identity of one current interaction trace.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord']} })
    trace_description: Optional[str] = Field(default=None, description="""Supplied semantic description of this whole trace/task (ODIM PDF p. 9 section 4.5), separate from event/screen descriptions and redaction justifications. Preserve text verbatim, including empty versus null/omission. No author, original serializer or manual/LLM generation route is inferred; the source's manual annotation implementation remains distinct from its illustrative LLM augmentation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: Optional[str] = Field(default=None, description="""Optional supplied trace participant identity. Known identities constrain linked tasks; unknown identity is not inferred from payloads or accounts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    trace_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Distinguishes constructed examples from supplied normalized data without claiming source authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord']} })
    interaction_events: list[InteractionEventRecord] = Field(default=..., description="""Current members only; their explicit sequence positions define order independently of JSON array ordering or timestamps.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class InteractionEventRecord(ConfiguredBaseModel):
    """
    One normalized trace member with paired visual/structural payload identities and optional gesture. Positions express current trace order, not timestamps. Capture incompleteness and human-detected incorrectness are independent nullable assertions; gesture presence implies neither correctness nor a human assessment. ODIM PDF pp. 6-7 sections 4.2-4.3. IDs and field names are normalized, not recovered.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    interaction_event_id: str = Field(default=..., description="""Normalized event identity, unique within its owning trace.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    screen_description: Optional[str] = Field(default=None, description="""Supplied description of this labelled screen interaction (ODIM PDF p. 9 section 4.5), owned by the event within its trace, not by a reusable screenshot payload. Independent of the whole trace description and redaction justification; preserve verbatim empty/null/omission without inferring an annotator or generation route.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    event_sequence_position: int = Field(default=..., description="""Nonnegative position in the current trace; unique within the trace. Does not assert a source timestamp-sort algorithm.""", ge=0, json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    screenshot_artifact_id: str = Field(default=..., description="""Identity of this event's screenshot in the supplied existing ArtifactRef catalog.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord', 'SessionScreenshotRecord']} })
    hierarchy_artifact_id: str = Field(default=..., description="""Identity of this event's paired view hierarchy in the supplied ArtifactRef catalog.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    gesture_artifact_id: Optional[str] = Field(default=None, description="""Optional gesture payload identity; absent or null is not silently completed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    capture_incomplete: Optional[bool] = Field(default=None, description="""Supplied capture-completeness assertion, not inferred here from gesture presence; independent of human correctness review.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    human_detected_incorrect: Optional[bool] = Field(default=None, description="""Supplied human finding of incorrect interaction metadata; false, null and omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })
    interaction_redactions: Optional[list[InteractionRedactionRecord]] = Field(default=None, description="""Paired redaction records for this owning event only.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord']} })


class InteractionRedactionRecord(ConfiguredBaseModel):
    """
    A supplied record of paired effects on its owning event's screenshot and hierarchy. ODIM device selection deletes selected-element pixels and tags corresponding text/content; web selection blackens a drawn region and removes metadata for supplied sufficiently-high-IoU elements (PDF pp. 8-9 section 4.4). The actual cutoff, tag spelling, pixel fill and node/pixel correspondence are not inferred. Records do not establish effective sanitization of payload bytes.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    redaction_record_id: str = Field(default=..., description="""Normalized identity of one paired redaction record.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    redaction_selection_basis: InteractionRedactionSelectionId = Field(default=..., description="""Element selection versus drawn-region/IoU selection; no undisclosed cutoff is supplied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    selected_element_ids: list[str] = Field(default=..., description="""Supplied corresponding hierarchy elements; web elements are supplied as qualifying, not selected by an invented IoU rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    target_region_id: Optional[str] = Field(default=None, description="""Supplied identity of the drawn web pixel region, without invented geometry.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    redacted_screenshot_artifact_id: str = Field(default=..., description="""Identity of the paired screenshot output, not an executed sanitization claim.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    redacted_hierarchy_artifact_id: str = Field(default=..., description="""Identity of the corresponding hierarchy output, not an executed sanitization claim.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    screenshot_redaction_effect: ScreenshotRedactionEffectId = Field(default=..., description="""Supplied pixel-side effect of this paired redaction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    hierarchy_redaction_effect: HierarchyRedactionEffectId = Field(default=..., description="""Supplied hierarchy-side effect of this paired redaction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    redaction_justification: Optional[str] = Field(default=None, description="""Supplied per-redaction textual justification (ODIM device route, PDF p. 8 section 4.4); no web prompt or mandatory response is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionRedactionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationDrawerSnapshotRecord(ConfiguredBaseModel):
    """
    One supplied normalized observation of pending Android drawer state, not a posted/removed callback, image, usage session or prospective method. Clear All PDF pp.4-5. Required empty membership means observed empty; an absent snapshot does not. A normalized ID is not the source ascending transmission ID. No inter-snapshot arrival, removal, dismissal, continuous residence or fixed realized sampling interval is inferred (PDF p.10).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'device_id': {'name': 'device_id', 'required': True},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    snapshot_record_id: str = Field(default=..., description="""Normalized snapshot identity scoped by profile and device; not a generated transmission counter.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    device_id: str = Field(default=..., description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    snapshot_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Explicit example versus supplied normalized record status; neither authenticates source serialization.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    snapshot_instant: str = Field(default=..., description="""Supplied normalized observation-time representation; original encoding and epoch are not inferred or converted here.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    timezone: Optional[str] = Field(default=None, description="""Original recording timezone (preserved).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'NotificationDrawerSnapshotRecord']} })
    android_version: Optional[str] = Field(default=None, description="""Supplied textual Android version at this observation (Clear All PDF p.4); not an inferred numeric version or immutable device attribute. Empty, null and omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    device_model: Optional[str] = Field(default=None, description="""Supplied textual model at this observation (Clear All PDF p.4), without an inferred model codebook or immutable device attribute.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    device_product: Optional[str] = Field(default=None, description="""Supplied textual product name at this observation (Clear All PDF p.4), not an assumed model alias.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    device_manufacturer: Optional[str] = Field(default=None, description="""Supplied textual manufacturer at this observation (Clear All PDF p.4), without case normalization or eligibility filtering.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    snapshot_transmission_id_token: Optional[str] = Field(default=None, description="""Supplied opaque textual representation of the source transmission ID, separate from normalized snapshot identity (Clear All PDF p.4 filtering rule4). No numeric coercion, monotonicity, missing-counter inference or original serialization is asserted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    pending_item_appearances: list[NotificationItemAppearanceRecord] = Field(default=..., description="""Observed pending membership; an empty array is not a missing or unobserved snapshot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationDrawerSnapshotRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationItemAppearanceRecord(ConfiguredBaseModel):
    """
    One pending-item appearance in its owning observed snapshot. Repeated item references preserve recurrence without creating callback events. Supplied item identity is scoped by profile, device and identity basis; identical tokens on another device or basis do not imply the same item. Paper identity components and release key/postTime tokens are alternative normalized representations, not recovered raw types or automatically equated identities. Drawer position is observation-specific and has no assumed ordinal base.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_package_name': {'name': 'app_package_name',
                                             'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    appearance_record_id: str = Field(default=..., description="""Normalized appearance identity unique within its owning snapshot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    notification_item_id: str = Field(default=..., description="""Supplied recurring-item reference scoped by profile/device/identity basis; conflicting or split identities are rejected rather than automatically merged across scopes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord', 'NotificationHistoryRecord']} })
    item_identity_basis: NotificationItemIdentityBasisId = Field(default=..., description="""Source-backed identity definition for this appearance, not an asserted equivalence between source versions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    app_package_name: str = Field(default=..., description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    notification_id_json: Optional[str] = Field(default=None, description="""Losslessly preserved JSON token for the supplied paper-basis ID; lexical consistency is checked without numeric coercion or claiming equivalence of alternative JSON encodings.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    notification_tag_json: Optional[str] = Field(default=None, description="""Losslessly preserved paper-basis JSON tag token; JSON null and string null remain distinct without inventing a missing-tag convention or alternative-encoding equivalence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    creation_instant: Optional[str] = Field(default=None, description="""Supplied normalized creation-time representation for the paper identity; neither an observed arrival nor an inferred residence start.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    notification_key_token: Optional[str] = Field(default=None, description="""Supplied linked-code key string without an invented package/ID/tag expansion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    post_time_identity_token: Optional[str] = Field(default=None, description="""Supplied literal str(postTime) identity token from the linked-code basis; not a parsed epoch or verified conversion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    drawer_position: Optional[int] = Field(default=None, description="""Supplied normalized observation-specific drawer ordinal; no source zero/one base or creation-time ordering is asserted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    priority_value_json: Optional[str] = Field(default=None, description="""Supplied appearance-local priority as a lexical JSON value token (Clear All linked release 08_notification_priorities.ipynb cell7). No import-time clamp, vocabulary inference or original raw-type equivalence; changes do not alter recurring-item identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    clearability_value_json: Optional[str] = Field(default=None, description="""Supplied appearance-local clearability as a lexical JSON value token (Clear All linked release 09_non_clearable_notifications.ipynb cells6/21/27). False, zero, string false and null remain distinct; no truthiness, cast, user action or permanence is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    group_key_compat_value_json: Optional[str] = Field(default=None, description="""Supplied appearance-local groupKeyCompat lexical JSON value token (Clear All linked shared.py lines17/33). Present null and empty string are not absence, and import applies no default, key expansion or grouping.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    group_summary_compat_value_json: Optional[str] = Field(default=None, description="""Supplied appearance-local isGroupSummaryCompat lexical JSON value token (Clear All linked shared.py lines24/35/37); no truthiness conversion or summary-member selection is performed by import.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    group_key_compat_absent: Optional[bool] = Field(default=None, description="""Explicit normalized assertion about original linked-release group-key absence; true must not coexist with a supplied group_key_compat_value_json token, false asserts not absent, and null or omission is unknown. Never inferred from normalized omission or used to apply a default during import.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationHistoryRecord(ConfiguredBaseModel):
    """
    One supplied normalized item history with independently retained evidence, linked subjective responses and supplied acceptance outcomes. My Phone and Me (2016), accepted manuscript pp.3-4 and p.8. Identity is local to the profile, participant and supplied device (when known), not a recovered raw key, Clear All identity definition or a package/title/time match. Inlining scopes references to this item; it does not imply exclusive ownership of a world occurrence such as an unlock shared by multiple pending items. No action matching, timestamp arithmetic, acceptance recode or missing-data completion runs during import. Tokens, omissions and supplied order remain. Optional original-history references distinguish a temporary snooze prompt or retriggered copy from the original item (Snooze DOI 10.1145/3229434.3229436 pp.3–4 Figure2). Supplied references resolve within profile/source/participant/device, including forward references; no package/title matching, chronology or five-second realized interval is inferred.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'notification_item_id': {'description': 'Supplied normalized '
                                                                'item reference scoped '
                                                                'by '
                                                                'profile/participant/known '
                                                                'device; no Clear All '
                                                                'basis or source-key '
                                                                'recovery is asserted.',
                                                 'name': 'notification_item_id'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    notification_history_id: str = Field(default=..., description="""Normalized item-history record identity scoped by profile/participant/known device.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    history_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Example versus supplied normalized history; not authenticated original rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord', 'NotificationCallbackGroupRecord']} })
    notification_item_id: str = Field(default=..., description="""Supplied normalized item reference scoped by profile/participant/known device; no Clear All basis or source-key recovery is asserted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationItemAppearanceRecord', 'NotificationHistoryRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    notification_title: Optional[str] = Field(default=None, description="""Supplied normalized title text (My Phone and Me p.4 Table1); empty, null and omission remain distinct. Not notification content or an identity key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord',
                       'NotificationTitleAnnotationRecord']} })
    title_annotation_reference: Optional[str] = Field(default=None, description="""Supplied annotation ID resolved in the owning profile/participant; omission/null is unknown association. No app/title equality, device identity, sender parser or location join is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord']} })
    original_notification_history_reference: Optional[str] = Field(default=None, description="""Optional supplied original item-history ID for a temporary snooze prompt or retriggered copy. Positive references resolve to another history within profile/source/participant/device at ingress; forward references are allowed and null/omission is unknown. No identity matching or chronology is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord']} })
    notification_evidence: list[NotificationEvidenceRecord] = Field(default=..., description="""Independently retained supplied evidence records local to the owning item history or callback group; no ordering or pairing reconstruction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord', 'NotificationCallbackGroupRecord']} })
    questionnaire_responses: Optional[list[NotificationQuestionnaireResponseRecord]] = Field(default=None, description="""Supplied answers linked to this item only; omission/null is not a negative answer or complete-response claim.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord']} })
    acceptance_records: Optional[list[NotificationAcceptanceRecord]] = Field(default=None, description="""Independently supplied acceptance outcomes; null means supplied unknown and import calculates none or substitutes recorded behavior.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('original_notification_history_reference')
    def pattern_original_notification_history_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid original_notification_history_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid original_notification_history_reference format: {v}"
            raise ValueError(err_msg)
        return v


class NotificationCallbackGroupRecord(ConfiguredBaseModel):
    """
    Supplied normalized group of independently recorded notification-posted callbacks, with an optional supplied member designated as an analytic alert proxy. Dismissed! (DOI 10.1145/3229434.3229445), printed pp.3:3–3:4, distinguishes posted-event bursts from usually perceived alerts and retains the last posted event after title filtering. The retained callback itself is the proxy; no third proxy identity or logical notification-item identity is required. Group membership and designation are supplied, not computed. Positive proxy references resolve only within this group at ingress; omission/null is unknown, not observed perception or a negative alert. Ingress admits only recorded posted_callback members, retaining opaque times, lexical payloads, local supporting references and supplied order. Group IDs are scoped by profile/participant/supplied device, not recovered raw keys. No timestamp sorting, LAST selection, title filtering, second bucket, grouping partition, tie rule or notification matching is inferred. Equal times or payloads do not merge independently identified callbacks.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'notification_evidence': {'description': 'Supplied recorded '
                                                                 'posted_callback '
                                                                 'members local to '
                                                                 'this group; no item '
                                                                 'owner or '
                                                                 'automatically '
                                                                 'reconstructed burst '
                                                                 'is asserted.',
                                                  'name': 'notification_evidence'},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    callback_group_id: str = Field(default=..., description="""Supplied normalized posted-callback group identity scoped by profile/participant/supplied device; not a notification item or an automatically computed second bucket.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationCallbackGroupRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    history_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Example versus supplied normalized history; not authenticated original rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord', 'NotificationCallbackGroupRecord']} })
    notification_evidence: list[NotificationEvidenceRecord] = Field(default=..., description="""Supplied recorded posted_callback members local to this group; no item owner or automatically reconstructed burst is asserted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord', 'NotificationCallbackGroupRecord']} })
    analytic_alert_proxy_reference: Optional[str] = Field(default=None, description="""Optional supplied evidence_record_id of the posted member retained as an analytic alert proxy in this callback group. Null/omission stays unknown. No perception observation, LAST computation, sorting or third proxy identity is asserted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationCallbackGroupRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationTitleAnnotationRecord(ConfiguredBaseModel):
    """
    Supplied participant-relative multi-label annotation of a communication title, shared by referenced notification items; not a permanent category, globally identified sender or deduplicated notification. Content-driven notifications (DOI 10.1145/2750858.2807544), p.4 Dataset and footnote2. Normalized identity is scoped by profile and participant, not app/device. Labels remain independent of each item's location-resolved category. Optional title allows withheld/discarded raw content (p.4 privacy passage); omission/null is not an invented title hash. No matching, deduplication, normalization, GPS join or category resolution runs during import.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    title_annotation_id: str = Field(default=..., description="""Supplied normalized shared annotation identity scoped by profile/participant, not a recovered raw title/sender key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationTitleAnnotationRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    annotation_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Example versus supplied normalized annotation; not authenticated original labels or title matching.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationTitleAnnotationRecord']} })
    notification_title: Optional[str] = Field(default=None, description="""Supplied normalized title text (My Phone and Me p.4 Table1); empty, null and omission remain distinct. Not notification content or an identity key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationHistoryRecord',
                       'NotificationTitleAnnotationRecord']} })
    sender_relationship_labels: list[str] = Field(default=..., description="""Supplied participant-relative relationship labels (Content-driven notifications p.4: work, social, family, other); multiple labels retained in supplied order, not a priority list or inferred category.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationTitleAnnotationRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ParticipantDayObservationRecord(ConfiguredBaseModel):
    """
    Supplied populated objective aggregate, subjective response or collection-run modality availability owned by a profile/work/participant, an optional explicitly supplied device, and exactly one supplied day, specific-hour, night or collection-run identity. Energy Drain2015 §3.4 distinguishes daily energy per device; device identity is never inferred from participant identity. Same- and cross-period supports stay within the supplied device owner (or the unknown-device owner when omitted/null). The class and day_* transport names are retained for compatibility; an hour or night is never stored in referenced_day_token. CHI2020 Paper36 p5 CCM separately aggregates each retained emotion, application launches and use duration per participant per one-hour period. Hour tokens identify particular periods, not recurring hour-of-day buckets, and do not establish their endpoints. In-Situ notifications pp.3-4 asks about the prior day; p.6 associates daily objective notification logs with subjective responses about that same day. No notification-item identity is required. Each period token is opaque, not an inferred calendar date, cutoff, timezone or raw study join key. Values, units, categories and optional question wording are supplied independently; absence/null is not zero. Subjective supports point only to objective records in the same owner/period kind/token unless an explicit cross-period reference identifies a different target period and the supplied relationship. Murnane2016 pp3,7–8 distinguishes prior-night sleep, following-day use and event counts during that night. No night/day identity or adjacency is inferred. Moodable primary508–517,603–611,685–689 separately permits any subset of contributed modalities. Run-owned modality availability uses its local method definition, not a day or classifier campaign; run tokens do not assert repeated original participation. Unavailable does not infer why data were not contributed. Import neither aggregates, joins timestamps, schedules prompts nor computes correlations. Normalized origin does not authenticate original participant rows or recover the full instrument.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'rules': [{'postconditions': {'exactly_one_of': [{'slot_conditions': {'day_observation_kind': {'name': 'day_observation_kind',
                                                                                                        'pattern': '^(objective_aggregate|subjective_response)$'},
                                                                               'method_setting_reference': {'name': 'method_setting_reference',
                                                                                                            'value_presence': 'ABSENT'},
                                                                               'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'pattern': '\\S',
                                                                                                        'required': True},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'value_presence': 'ABSENT'},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'value_presence': 'ABSENT'},
                                                                               'referenced_run_token': {'name': 'referenced_run_token',
                                                                                                        'value_presence': 'ABSENT'}}},
                                                          {'slot_conditions': {'day_observation_kind': {'name': 'day_observation_kind',
                                                                                                        'pattern': '^(objective_aggregate|subjective_response)$'},
                                                                               'method_setting_reference': {'name': 'method_setting_reference',
                                                                                                            'value_presence': 'ABSENT'},
                                                                               'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'value_presence': 'ABSENT'},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'pattern': '\\S',
                                                                                                         'required': True},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'value_presence': 'ABSENT'},
                                                                               'referenced_run_token': {'name': 'referenced_run_token',
                                                                                                        'value_presence': 'ABSENT'}}},
                                                          {'slot_conditions': {'day_observation_kind': {'name': 'day_observation_kind',
                                                                                                        'pattern': '^(objective_aggregate|subjective_response)$'},
                                                                               'method_setting_reference': {'name': 'method_setting_reference',
                                                                                                            'value_presence': 'ABSENT'},
                                                                               'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'value_presence': 'ABSENT'},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'value_presence': 'ABSENT'},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'pattern': '\\S',
                                                                                                          'required': True},
                                                                               'referenced_run_token': {'name': 'referenced_run_token',
                                                                                                        'value_presence': 'ABSENT'}}},
                                                          {'slot_conditions': {'day_observation_kind': {'equals_string': 'modality_availability',
                                                                                                        'name': 'day_observation_kind'},
                                                                               'method_setting_reference': {'name': 'method_setting_reference',
                                                                                                            'pattern': '\\S',
                                                                                                            'required': True},
                                                                               'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'value_presence': 'ABSENT'},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'value_presence': 'ABSENT'},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'value_presence': 'ABSENT'},
                                                                               'referenced_run_token': {'name': 'referenced_run_token',
                                                                                                        'pattern': '\\S',
                                                                                                        'required': True}}}]},
                    'preconditions': {'slot_conditions': {'day_observation_id': {'name': 'day_observation_id',
                                                                                 'value_presence': 'PRESENT'}}}}],
         'slot_usage': {'app_package_name': {'description': 'Optional supplied package '
                                                            'identity for per-app '
                                                            'period observations '
                                                            '(Screenomics2024 '
                                                            'primary236–257; Energy '
                                                            'Drain2015 §4). '
                                                            'Independent of '
                                                            'observation_category and '
                                                            'supplied device; '
                                                            'omitted/null identity '
                                                            'never implies a '
                                                            'category-wide total or a '
                                                            'UID/package join, and '
                                                            'overlapping categories '
                                                            'are not collapsed.',
                                             'name': 'app_package_name',
                                             'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'method_setting_reference': {'description': 'Local '
                                                                    'quality-control '
                                                                    'definition '
                                                                    'required only for '
                                                                    'collection-run '
                                                                    'modality '
                                                                    'availability; '
                                                                    'absent on period '
                                                                    'aggregates/responses.',
                                                     'name': 'method_setting_reference',
                                                     'required': False},
                        'observed_property': {'description': 'Supplied measured '
                                                             'quantity or '
                                                             'subjective-property '
                                                             'label; not necessarily '
                                                             'verbatim question '
                                                             'wording or a raw field '
                                                             'name.',
                                              'name': 'observed_property',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'questionnaire_item_label': {'description': 'Optional supplied '
                                                                    'wording on a '
                                                                    'subjective '
                                                                    'response only; '
                                                                    'omission/null '
                                                                    'does not recover '
                                                                    'undisclosed '
                                                                    'wording.',
                                                     'name': 'questionnaire_item_label',
                                                     'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    day_observation_id: str = Field(default=..., description="""Supplied observation identity scoped by profile/participant/period kind/token, not a raw join key; legacy day-named transport supports explicit hour ownership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    referenced_day_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of the day described, mutually exclusive with hour/night tokens; not substituted from prompt/submission time, parsed, calendar-normalized or timezone-converted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'TaskOccurrenceRecord']} })
    referenced_hour_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of a particular one-hour period, not an hour-of-day bucket, day or night. Mutually exclusive with day/night tokens; no endpoints, timezone or timestamp join inferred (CHI2020 Paper36 p5 CCM).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    referenced_night_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of the night described, not a calendar day, prompt time, source serializer or inferred sleep interval. Mutually exclusive with day/hour tokens; no endpoints or preceding/following day recovered (Murnane2016 pp3,7–8).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    referenced_run_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque collection/assessment-run identity for participant modality availability (Moodable primary508–517,603–611,685–689). Not a day/hour/night, model campaign, clock or original repeated-participation claim; mutually exclusive with period tokens.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    method_setting_reference: Optional[str] = Field(default=None, description="""Local quality-control definition required only for collection-run modality availability; absent on period aggregates/responses.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    day_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized participant-period record; legacy key, not original-source authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    day_observation_kind: ParticipantDayObservationKindId = Field(default=..., description="""Objective period aggregate, subjective response or run-owned modality availability; none substitutes for another. Legacy day-named transport key retains explicitly supplied owner kinds.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    observed_property: str = Field(default=..., description="""Supplied measured quantity or subjective-property label; not necessarily verbatim question wording or a raw field name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    observation_category: Optional[str] = Field(default=None, description="""Optional supplied category scope, independent of property/value; not a reconstructed app classifier. Null/omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord', 'SessionQuantityRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Optional supplied package identity for per-app period observations (Screenomics2024 primary236–257; Energy Drain2015 §4). Independent of observation_category and supplied device; omitted/null identity never implies a category-wide total or a UID/package join, and overlapping categories are not collapsed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    day_observation_value_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON value retained without recoding or numeric coercion; zero, JSON null, supplied null and omission stay distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    evidence_unit: Optional[str] = Field(default=None, description="""Supplied unit for this quantity alone; no numeric conversion or inferred unit.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'SampledQuantityRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Optional supplied wording on a subjective response only; omission/null does not recover undisclosed wording.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    aggregate_observation_references: Optional[list[str]] = Field(default=None, description="""Supplied support IDs on a subjective response, resolving to objective records in the same profile/participant/period kind/token. Equal day/hour token strings do not establish the same period. Null/omission is unknown support, [] explicitly empty; no category-equality or correlation is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    cross_period_aggregate_references: Optional[list[CrossPeriodAggregateReference]] = Field(default=None, description="""Supplied explicit comparisons/supports on a subjective response to objective observations in different periods under the same profile/work/participant. Each target uses its exact period kind/token and observation ID; labels/locators remain supplied. Null/omission is unknown support, [] explicitly empty; no cross-period link is inferred from equal IDs, values or timestamps.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class CrossPeriodAggregateReference(ConfiguredBaseModel):
    """
    Explicit support/comparison from a subjective participant-period observation to an objective aggregate in a different supplied period, within the same profile/work/participant. The target observation identity and exact period kind/token both resolve; the relationship label and provenance preserve why the records are compared, not a computed calendar adjacency or causal claim. Murnane2016 p7 compares prior-night reported sleep with following-day use; p8 same-night counts use the separate existing same-period reference.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'rules': [{'postconditions': {'exactly_one_of': [{'slot_conditions': {'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'pattern': '\\S',
                                                                                                        'required': True},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'value_presence': 'ABSENT'},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'value_presence': 'ABSENT'}}},
                                                          {'slot_conditions': {'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'value_presence': 'ABSENT'},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'pattern': '\\S',
                                                                                                         'required': True},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'value_presence': 'ABSENT'}}},
                                                          {'slot_conditions': {'referenced_day_token': {'name': 'referenced_day_token',
                                                                                                        'value_presence': 'ABSENT'},
                                                                               'referenced_hour_token': {'name': 'referenced_hour_token',
                                                                                                         'value_presence': 'ABSENT'},
                                                                               'referenced_night_token': {'name': 'referenced_night_token',
                                                                                                          'pattern': '\\S',
                                                                                                          'required': True}}}]},
                    'preconditions': {'slot_conditions': {'day_observation_id': {'name': 'day_observation_id',
                                                                                 'value_presence': 'PRESENT'}}}}],
         'slot_usage': {'relationship_label': {'name': 'relationship_label',
                                               'pattern': '\\S',
                                               'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    day_observation_id: str = Field(default=..., description="""Supplied observation identity scoped by profile/participant/period kind/token, not a raw join key; legacy day-named transport supports explicit hour ownership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    referenced_day_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of the day described, mutually exclusive with hour/night tokens; not substituted from prompt/submission time, parsed, calendar-normalized or timezone-converted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'TaskOccurrenceRecord']} })
    referenced_hour_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of a particular one-hour period, not an hour-of-day bucket, day or night. Mutually exclusive with day/night tokens; no endpoints, timezone or timestamp join inferred (CHI2020 Paper36 p5 CCM).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    referenced_night_token: Optional[str] = Field(default=None, description="""Explicitly supplied opaque identity of the night described, not a calendar day, prompt time, source serializer or inferred sleep interval. Mutually exclusive with day/hour tokens; no endpoints or preceding/following day recovered (Murnane2016 pp3,7–8).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference']} })
    relationship_label: str = Field(default=..., description="""Supplied nonblank relationship designation, not inferred causality, chronology or a source storage code.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CrossPeriodAggregateReference',
                       'SampledObservationReferenceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('relationship_label')
    def pattern_relationship_label(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid relationship_label format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid relationship_label format: {v}"
            raise ValueError(err_msg)
        return v


class NotificationOpeningOccurrenceRecord(ConfiguredBaseModel):
    """
    One supplied normalized opening occurrence shared by item-specific inferred views. In-Situ notifications (DOI 10.1145/2628363.2628364), p.4 Notification Viewed. Identity is scoped by profile/participant/supplied device, never inferred from equal app/time tokens. Optional membership retains supplied pending app items or shown drawer items; omission/null is unknown and an empty list is explicitly empty. Positive links require a known common device at ingress. No pending queue, matching, time conversion or inference runs. Normalized IDs and relationships do not claim recovered source keys or original rows. Opening is not observed reading, dismissal or response.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_package_name': {'description': 'Optional supplied app '
                                                            'identity for an '
                                                            'application opening; '
                                                            'null/omission stays '
                                                            'unknown. Drawer '
                                                            'membership does not '
                                                            'require app equality.',
                                             'name': 'app_package_name'},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'occurrence_instant': {'description': 'Supplied textual '
                                                              'opening time; '
                                                              'omission/null is '
                                                              'unknown. No verified '
                                                              'epoch, precision, '
                                                              'timezone, or equality '
                                                              'with inferred view '
                                                              'time.',
                                               'name': 'occurrence_instant'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    opening_occurrence_id: str = Field(default=..., description="""Normalized shared opening identity scoped by profile/participant/device; distinct occurrences remain distinct even at equal supplied app/time.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationOpeningOccurrenceRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    opening_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized opening, not original-source authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationOpeningOccurrenceRecord']} })
    opening_kind: NotificationOpeningKindId = Field(default=..., description="""Application-opening versus drawer-opening proxy, not an OS process launch or actual reading.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationOpeningOccurrenceRecord']} })
    occurrence_instant: Optional[str] = Field(default=None, description="""Supplied textual opening time; omission/null is unknown. No verified epoch, precision, timezone, or equality with inferred view time.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence',
                       'NotificationOpeningOccurrenceRecord',
                       'SensorControlOccurrenceRecord'],
         'slot_uri': 'time:inXSDDateTimeStamp'} })
    app_package_name: Optional[str] = Field(default=None, description="""Optional supplied app identity for an application opening; null/omission stays unknown. Drawer membership does not require app equality.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    pending_history_references: Optional[list[str]] = Field(default=None, description="""Supplied history IDs for pending items associated with the opened app or shown in the opened drawer. Positive members resolve within profile/participant/known device; omission/null is unknown, [] explicitly empty. No pending reconciliation runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationOpeningOccurrenceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationEvidenceRecord(ConfiguredBaseModel):
    """
    One owner-local event, classification or inferred quantity with independent provenance and optional local supporting evidence. Arrival, removal, unlock-derived assumed-seen, already-unlocked zero seen latency and clicked status are not interchangeable (My Phone and Me pp.3-4). Removal alone is not swipe, rejected content or accepted outcome; clicked may include app launch. Missing time/basis/value means not supplied, not a negative event. An instant is a supplied representation, not a verified epoch/precision. Context evidence requires a property label and independent collection boundary at normalized ingress. My Phone and Me p.4 Table1 records arrival/removal context; Content-driven notifications p.3 Table1 has unknown sampling alignment and separately described last-minute features. Null/omitted value and optional lookback/unit/time remain unknown; no context reducer, alert/ringer equivalence or sensor/location join runs. Optional shared-opening reference supports an inferred seen/latency only with positively supplied owner-local pending membership; it does not replace item-local supporting references or compute the view. Response stages carry independent observability and open stage identifiers: Reachable pp.3-4 allows variable/merged decisions, not a fixed D1-D3 enum. Unobservable is neither a negative response nor a prohibition on supplied inferred annotations. Endpoint and named objective labels are independent; string-valued null endpoint is not an unknown JSON null or omitted value. Import does not infer stages, labels, chronological order or truth tables. Item-owned action occurrences retain open source-qualified labels and an optional supplied ordinal, distinct from array position, event time and supporting references. Interrupted by a Phone Call pp.3,7–8 distinguishes repeated postpones, widget moves and accepted/declined/unanswered endings. Non-null ordinals are unique among actions in one history at ingress; neither zero-based indexing, contiguity nor complete capture is asserted. No action sorting, time conversion, raw-key recovery or outcome recode runs. The callback-group carrier reuses only the recorded posted_callback variant and its lexical time/value/basis/supports; it does not assign item ownership or action, context, response, opening or attention semantics to a callback. Named quantities retain independent lexical values, units and local supporting events. In Call to Action pp.7–8, IDL is an appearance-to-removal difference, not seen latency or observed attention; neither endpoint arithmetic nor positive/one-day analysis filtering runs during import.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'lookback': {'description': 'Supplied retrospective '
                                                    'context-feature scope independent '
                                                    'of collection boundary; last one '
                                                    'minute in Content-driven '
                                                    'notifications p.3 Table1 does not '
                                                    'disclose a reducer or timestamp '
                                                    'anchor.',
                                     'name': 'lookback'},
                        'observed_property': {'description': 'Supplied context '
                                                             'property, item-owned '
                                                             'quantity name or '
                                                             'independent '
                                                             'response-objective name; '
                                                             'required for those '
                                                             'evidence kinds at '
                                                             'ingress, not a computed '
                                                             'value or recovered raw '
                                                             'key.',
                                              'name': 'observed_property'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    evidence_record_id: str = Field(default=..., description="""Normalized evidence identity local to its owning item history or supplied callback group; duplicated world-occurrence evidence across histories does not assert distinct unlocks. Equal callback times/payloads do not imply equal identities.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    evidence_kind: NotificationEvidenceKindId = Field(default=..., description="""Supplied evidence quantity or classification kind.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    evidence_role: NotificationEvidenceRoleId = Field(default=..., description="""Recorded record/classification versus explicitly inferred assertion; not an observed-action guarantee.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    evidence_instant: Optional[str] = Field(default=None, description="""Supplied textual time token for this evidence alone; no endpoint equality or conversion is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    evidence_value_json: Optional[str] = Field(default=None, description="""Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'SampledQuantityRecord']} })
    evidence_unit: Optional[str] = Field(default=None, description="""Supplied unit for this quantity alone; no numeric conversion or inferred unit.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'SampledQuantityRecord']} })
    evidence_basis: Optional[str] = Field(default=None, description="""Supplied inference or recording basis; omission/null leaves the basis unknown rather than reconstructed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    evidence_references: Optional[list[str]] = Field(default=None, description="""Supplied supporting evidence IDs resolved only within the owning history or callback group; optional null means unknown support and no cross-owner matching or constructor execution occurs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'NotificationAcceptanceRecord']} })
    opening_occurrence_reference: Optional[str] = Field(default=None, description="""Optional shared opening ID supporting inferred seen/latency in the owning history. A positive reference requires that history in supplied opening membership and a known common device; null/omission does not assert a relationship.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    observed_property: Optional[str] = Field(default=None, description="""Supplied context property, item-owned quantity name or independent response-objective name; required for those evidence kinds at ingress, not a computed value or recovered raw key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    context_sampling_boundary: Optional[NotificationContextSamplingBoundaryId] = Field(default=None, description="""Collection boundary for context evidence or explicit source-unreported status; required by normalized context ingress, never inferred from lookback, timestamp or reference. My Phone and Me p.4 Table1 versus Content-driven notifications p.3 Table1.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    lookback: Optional[str] = Field(default=None, description="""Supplied retrospective context-feature scope independent of collection boundary; last one minute in Content-driven notifications p.3 Table1 does not disclose a reducer or timestamp anchor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'AcquisitionProtocol']} })
    response_stage_id: Optional[str] = Field(default=None, description="""Supplied nonblank stage label required for normalized response_stage evidence. Variable/merged stages are permitted; not a recovered source field, ordinal or inferred chronology (Reachable pp.3-4).""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    response_observability: Optional[NotificationResponseObservabilityId] = Field(default=None, description="""Supplied observation availability required for normalized response_stage evidence, independent of response value, device-use context and recorded/inferred provenance (Reachable p.4 Section3.2.1).""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    action_kind: Optional[str] = Field(default=None, description="""Supplied nonblank action label required only for action_occurrence evidence. Repeated labels identify separate occurrences, not a recovered raw enum, response stage or call-ending classification (Interrupted by a Phone Call pp.3,7–8).""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    occurrence_ordinal: Optional[int] = Field(default=None, description="""Optional supplied nonnegative integer ordering token on action_occurrence evidence only; unique among actions in the owning history at ingress. Null/omission is unknown, not array position or time. No assumed ordinal base, contiguous sequence, complete capture or sorting.""", ge=0, json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationQuestionnaireResponseRecord(ConfiguredBaseModel):
    """
    A supplied subjective answer associated with the owning item, not the prospective DiaryItem instrument, an action timestamp or a population-wide observation. My Phone and Me p.4 Table2/Data Collection and p.8. The item label and lexical JSON answer do not claim recovered raw questionnaire keys. A handling self-report need not agree with a recorded final status.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    questionnaire_response_id: str = Field(default=..., description="""Normalized answer record identity local to the owning item history.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_item_label: str = Field(default=..., description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: str = Field(default=..., description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationAcceptanceRecord(ConfiguredBaseModel):
    """
    Independently supplied binary acceptance outcome, separate from clicked or dismissed evidence. My Phone and Me p.8 recodes a dismissal as accepted when its handling answer says no further action was required; the clicked branch need not have that answer. Import preserves supplied references and code without applying this formula, enrolling an item in the questionnaire analysis, or filling an absent response/outcome with zero.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'evidence_references': {'name': 'evidence_references',
                                                'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    acceptance_record_id: str = Field(default=..., description="""Normalized acceptance-outcome record identity local to the owning history.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord']} })
    acceptance_code: int = Field(default=..., description="""Supplied normalized My Phone and Me p.8 binary acceptance code: 0 dismissed, 1 accepted; independently retained, not computed.""", ge=0, le=1, json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord']} })
    evidence_references: list[str] = Field(default=..., description="""Supplied supporting evidence IDs resolved only within the owning history or callback group; optional null means unknown support and no cross-owner matching or constructor execution occurs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'NotificationAcceptanceRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Supplied supporting answer IDs resolved only within the owning history; optional null means unknown support and the clicked branch does not require an answer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class UsageInterval(ConfiguredBaseModel):
    """
    A phenomenon-time interval a usage assertion denotes. A time:ProperInterval.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['time:ProperInterval'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    start_instant: Optional[str] = Field(default=None, description="""Interval start instant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    end_instant: Optional[str] = Field(default=None, description="""Interval end instant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    duration_seconds: Optional[float] = Field(default=None, description="""Interval duration in seconds.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval'], 'slot_uri': 'qudt:hasQuantityValue'} })
    start_status: Optional[EndpointStatus] = Field(default=None, description="""Endpoint status of the start.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    end_status: Optional[EndpointStatus] = Field(default=None, description="""Endpoint status of the end.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })


class DeviceUseSessionRecord(ConfiguredBaseModel):
    """
    Supplied normalized device-use session with independently identified questionnaire answers and definition-specific labels. Rabbit Hole (2023) physical p7 Section3.1.1 starts at ON_USERPRESENT and ends at OFF_LOCKED, OFF_UNLOCKED or SHUTDOWN; this is not necessarily unlock-to-lock, one app episode or a screen/keyguard observation. Physical pp8-11 associate ESM answers and original classifications with sessions; pp21-22 separately revise the definition. Source definition references and membership are supplied, not recovered raw joins. No constructor, scheduling, eligibility, scoring, relabeling or inference of missing responses runs during import. Oulasvirta et al. DOI10.1007/s00779-011-0412-2 printed p106 instead preserves separate opener, closer and action-membership definitions in the existing SessionConstructionPolicy. Its supplied record references the opener in one unambiguous profile-local policy; activation and next idle/lock phrases remain intact, not translated into Rabbit state codes. Approximate sampled inputs (p108) do not establish exact idle predicates, sample-to-boundary timestamp assignment or repaired action membership. Supplied session actions retain all-user-action membership and app-launch order independently of equal times (pp106–107). Hush Section3.2/6.1 also distinguishes alternating screen-on/off intervals with app activity and foreground membership in an explicitly supplied immediately following interval. Neither the successor nor app membership is inferred from times; missing membership cannot be classified as no activity. BFC is not computed. Jones DOI10.1145/2750858.2807542 physicalp6 preserves its scalar unlock/lock constructor and session-local repeated application launches with supplied F/B roles. Session-owned supplied quantities and labels remain distinct from actions and intervals; import computes neither ratios nor strategies. APNOMS2011 SectionIII-C independently supplies voice/3G/Wi-Fi sessions, AC/USB charging intervals and battery-change intervals. These are distinct source-defined intervals, not unlock-to-lock use; no raw boundary codes, charging/change equivalence or snapshot membership is inferred. Mathur2016 separately owns the four-member SessionLogger policy (screen-on, screen-off bounds, unlock inclusion gate, inclusive five-second merge and its provenance) versus QuantApp supplied sessions at screen-on/context start with unknown end. Hiniker2016 owns ordered app windows with lock/dark or state-conditioned system/launcher inactivity delimiters; it does not impose universal inactivity. Tapping2024 separately retains phone unlock-to-lock ownership, ordered foreground-change app periods and timestamped taps. Regret2025 instead uses screen-on/off parents and app-local intention, daily regret and screenshot context. Anatomy2016 keeps local key-entry attempts and separate code versus dismissal outcomes; supplied parent/action links are not a constructor, timestamp repair or raw join. AngryBirds2011 owns higher-order application chains separated by standby longer than thirty seconds, distinct from independent sampled app-or-epsilon states and individual foreground episodes. No sample/event construction runs.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'method_setting_reference': {'description': 'Compatible '
                                                                    'combined '
                                                                    'constructor, flat '
                                                                    'alternating-screen '
                                                                    'definition or '
                                                                    'opener of one '
                                                                    'complete '
                                                                    'separate-definition '
                                                                    'policy; '
                                                                    'references do not '
                                                                    'execute session '
                                                                    'construction.',
                                                     'name': 'method_setting_reference'},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    device_use_session_id: str = Field(default=..., description="""Supplied session identity scoped by profile/participant/device; not inferred from equal times or recovered raw keys.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Compatible combined constructor, flat alternating-screen definition or opener of one complete separate-definition policy; references do not execute session construction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    start_condition: Optional[str] = Field(default=None, description="""Optional supplied start-condition token validated against the local constructor definition; not an inferred event occurrence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord']} })
    end_condition: Optional[str] = Field(default=None, description="""Optional supplied terminal-condition token validated against the local constructor definition; not an inferred event occurrence or reconstructed closing time.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord']} })
    session_questionnaire_responses: Optional[list[DeviceSessionQuestionnaireResponseRecord]] = Field(default=None, description="""Supplied answers local to their containing session, in preserved order; the owning class selects device-session or tracked-app answer shape. Null/omission is unknown membership, [] explicitly empty. No prompt eligibility, chronology or interruption join inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord', 'AppInterruptionSessionRecord']} })
    session_labels: Optional[list[DeviceSessionLabelRecord]] = Field(default=None, description="""Independent supplied device- or tracked-app-session classifications in preserved order, each retaining its source definition; null/omission is unknown membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord', 'AppInterruptionSessionRecord']} })
    session_actions: Optional[list[TaskActionRecord]] = Field(default=None, description="""Supplied device- or tracked-app-session-local action/activity membership in supplied array order; actions need not identify an app. Null/omission is unknown membership, [] supplied empty, never a reconstructed or complete-zero assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    session_quantities: Optional[list[SessionQuantityRecord]] = Field(default=None, description="""Supplied session-owned quantities in preserved order; null/omission unknown and [] explicitly empty. Local IDs and definition/scope compatibility are checked by ingress, not inferred from action membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    following_device_use_session_reference: Optional[str] = Field(default=None, description="""Explicitly supplied immediately following interval within the same disclosed family: alternating screen intervals (Hush Section6.1) or uninterrupted T0 sessions (Van Berkel Analysis). Scoped by profile/source/participant/known device; distinct and acyclic. Known on/off consistency applies only to alternating intervals. Never inferred from equal timestamps, gaps or continuation labels. Null/omission is unknown, not no successor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DeviceSessionQuestionnaireResponseRecord(ConfiguredBaseModel):
    """
    Supplied answer identity local to the containing device-use session, referencing a compatible instrument in its profile. Rabbit Hole physical pp8-9 Figure3 distinguishes intention, completion, deviation, regret and perception questions without establishing complete numeric slider codes. Repeated equal answers remain separate. Optional wording and lexical value do not imply a prompt, completion, observed negative or raw key.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'observed_property': {'description': 'Supplied measure '
                                                             'designation, distinct '
                                                             'from optional exact item '
                                                             'wording.',
                                              'name': 'observed_property',
                                              'required': True},
                        'questionnaire_item_label': {'name': 'questionnaire_item_label',
                                                     'required': False},
                        'questionnaire_response_id': {'description': 'Supplied answer '
                                                                     'identity unique '
                                                                     'within its '
                                                                     'owning '
                                                                     'device-use '
                                                                     'session.',
                                                      'name': 'questionnaire_response_id'},
                        'questionnaire_setting_reference': {'description': 'Compatible '
                                                                           'local '
                                                                           'instrument '
                                                                           'definition, '
                                                                           'not a '
                                                                           'schedule, '
                                                                           'suppression '
                                                                           'rule or '
                                                                           'invented '
                                                                           'numeric '
                                                                           'recode.',
                                                            'name': 'questionnaire_setting_reference'},
                        'response_value_json': {'name': 'response_value_json',
                                                'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'support_task_action_references': {'description': 'Optional '
                                                                          'explicitly '
                                                                          'supplied '
                                                                          'local '
                                                                          'foreground-period '
                                                                          'support for '
                                                                          'Regret2025 '
                                                                          'intention/daily-regret '
                                                                          'answers. At '
                                                                          'most one '
                                                                          'known '
                                                                          'visit; '
                                                                          'null/omission '
                                                                          'is unknown '
                                                                          'and [] '
                                                                          'explicitly '
                                                                          'empty. '
                                                                          'Repeated '
                                                                          'same-app '
                                                                          'visits '
                                                                          'remain '
                                                                          'distinct. '
                                                                          'No survey '
                                                                          'eligibility, '
                                                                          'timing or '
                                                                          'last-visit '
                                                                          'selection '
                                                                          'is '
                                                                          'inferred.',
                                                           'name': 'support_task_action_references'}}})

    questionnaire_response_id: str = Field(default=..., description="""Supplied answer identity unique within its owning device-use session.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_setting_reference: str = Field(default=..., description="""Compatible local instrument definition, not a schedule, suppression rule or invented numeric recode.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TypingQuestionnaireResponseRecord']} })
    observed_property: str = Field(default=..., description="""Supplied measure designation, distinct from optional exact item wording.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional explicitly supplied local foreground-period support for Regret2025 intention/daily-regret answers. At most one known visit; null/omission is unknown and [] explicitly empty. Repeated same-app visits remain distinct. No survey eligibility, timing or last-visit selection is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DeviceSessionLabelRecord(ConfiguredBaseModel):
    """
    Independently supplied classification local to a device-use session or tracked-app interruption, referencing its applicable profile-owned label definition. Rabbit Hole physical p11 original intention-deviation and regret classifications are not the revised RH/negative-RH definitions at pp21-22 Figure14/Section6. Supplied lexical labels and local answer supports remain separate; missing is not negative. Import does not apply formulas, recover thresholds or fabricate an absent-answer truth table or original-to-revised mapping. Jones physicalp8/Table3 separately supplies whole-session strategy classes bound to the profile's analysis/derived-feature pattern definitions. Those labels are not action-local F/B roles; no regex execution is implied. APNOMS2011 also supplies network-modality and charging-power-source labels; those interval descriptors are not questionnaire-derived classifications.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'observed_property': {'description': 'Supplied designation of '
                                                             'the independent session '
                                                             'classification or '
                                                             'source-defined '
                                                             'app-period '
                                                             'classification; '
                                                             'whole-session and '
                                                             'app-period scopes are '
                                                             'not interchangeable.',
                                              'name': 'observed_property',
                                              'required': True},
                        'questionnaire_response_references': {'description': 'Supplied '
                                                                             'supporting '
                                                                             'answer '
                                                                             'IDs '
                                                                             'resolving '
                                                                             'only '
                                                                             'within '
                                                                             'the '
                                                                             'containing '
                                                                             'device-use '
                                                                             'session; '
                                                                             'null/omission '
                                                                             'is '
                                                                             'unknown '
                                                                             'support, '
                                                                             '[] '
                                                                             'explicitly '
                                                                             'empty.',
                                                              'name': 'questionnaire_response_references'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'support_task_action_references': {'description': 'Optional '
                                                                          'supplied '
                                                                          'action/foreground-period '
                                                                          'IDs '
                                                                          'resolving '
                                                                          'only within '
                                                                          'the '
                                                                          'containing '
                                                                          'session. '
                                                                          'Repeated '
                                                                          'visits to '
                                                                          'the same '
                                                                          'app remain '
                                                                          'distinct by '
                                                                          'local '
                                                                          'action ID; '
                                                                          'null/omission '
                                                                          'is unknown '
                                                                          'support, [] '
                                                                          'explicitly '
                                                                          'empty. No '
                                                                          'EEG join, '
                                                                          'app '
                                                                          'matching, '
                                                                          'classifier '
                                                                          'or weighted '
                                                                          'vote runs.',
                                                           'name': 'support_task_action_references'}}})

    label_record_id: str = Field(default=..., description="""Supplied label identity unique within its owning session, independent of equal property or value tokens.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    label_setting_reference: str = Field(default=..., description="""Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    observed_property: str = Field(default=..., description="""Supplied designation of the independent session classification or source-defined app-period classification; whole-session and app-period scopes are not interchangeable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    label_value_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional supplied action/foreground-period IDs resolving only within the containing session. Repeated visits to the same app remain distinct by local action ID; null/omission is unknown support, [] explicitly empty. No EEG join, app matching, classifier or weighted vote runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Supplied supporting answer IDs resolving only within the containing device-use session; null/omission is unknown support, [] explicitly empty.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ScreenshotSessionRecord(ConfiguredBaseModel):
    """
    Supplied normalized screenshot container with local image identities and annotations. PULSE phone-use sessions are not app episodes or an unlock-to-lock interval. Regret2025 pp5–8 instead supplies foreground-app screenshot ownership, its definition and optional explicit screen-parent/ app-period action links. App and parent identities are not inferred from images, times or equal values. PULSE (2025), printed p.202 Section2.2 and p.203 Figure1b/c, groups screenshots into continuous phone-use sessions and applies labels to selected first/last screenshot ranges. Capture or upload membership may be incomplete (p.203 Section2.3.1); no session construction, timestamp conversion or label propagation runs during import. IDs are normalized, not recovered raw keys.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_identifier': {'name': 'app_identifier', 'required': False},
                        'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'method_setting_reference': {'description': 'Source-compatible '
                                                                    'local '
                                                                    'foreground-app '
                                                                    'screenshot-container '
                                                                    'definition for '
                                                                    'Regret2025, not a '
                                                                    'PULSE constructor '
                                                                    'or inferred '
                                                                    'screenshot '
                                                                    'grouping.',
                                                     'name': 'method_setting_reference',
                                                     'required': False},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    screenshot_session_id: str = Field(default=..., description="""Supplied screenshot-container identity scoped by profile/participant/device, source-defined phone-use or foreground-app ownership; not inferred from app or unlock timing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    session_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized session; neither authenticates source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord']} })
    method_setting_reference: Optional[str] = Field(default=None, description="""Source-compatible local foreground-app screenshot-container definition for Regret2025, not a PULSE constructor or inferred screenshot grouping.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    app_identifier: Optional[str] = Field(default=None, description="""Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'TaskActionRecord',
                       'MonthlyAppUseCellRecord']} })
    device_use_session_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    session_action_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    screenshots: list[SessionScreenshotRecord] = Field(default=..., description="""Supplied screenshot members in preserved array order; [] means explicitly empty supplied membership, not a complete original capture claim.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord']} })
    screenshot_range_annotations: Optional[list[ScreenshotRangeAnnotationRecord]] = Field(default=None, description="""Supplied session-local range annotations in preserved order; omission/null is unknown and [] explicitly empty. Neither entails negative intent labels.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('device_use_session_reference')
    def pattern_device_use_session_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid device_use_session_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid device_use_session_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('session_action_reference')
    def pattern_session_action_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid session_action_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid session_action_reference format: {v}"
            raise ValueError(err_msg)
        return v


class SessionScreenshotRecord(ConfiguredBaseModel):
    """
    One supplied screenshot identity local to its owning source-defined screenshot container (PULSE phone use or Regret foreground-app use). Optional supplied sequence position, capture-time token and existing ArtifactRef identity remain independent; equal times or shared payloads do not collapse captures. PULSE printed pp.202-203 Section2.2 describes chronological display and visual stacking, not underlying row deletion. Missing payload metadata does not require fabricated size/digest/hierarchy. No image bytes, raw serialization or complete capture stream is verified.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'screenshot_artifact_id': {'name': 'screenshot_artifact_id',
                                                   'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    screenshot_record_id: str = Field(default=..., description="""Supplied screenshot identity local to its owning session, independent of capture time or image equality.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionScreenshotRecord']} })
    screenshot_sequence_position: Optional[int] = Field(default=None, description="""Optional supplied nonnegative sequence position, unique within session; sparse positions do not reveal index base or equal-time sorting.""", ge=0, json_schema_extra = { "linkml_meta": {'domain_of': ['SessionScreenshotRecord']} })
    screenshot_instant: Optional[str] = Field(default=None, description="""Optional supplied screenshot capture-time token; no encoding, timezone or duration is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionScreenshotRecord']} })
    screenshot_artifact_id: Optional[str] = Field(default=None, description="""Identity of this event's screenshot in the supplied existing ArtifactRef catalog.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionEventRecord', 'SessionScreenshotRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ScreenshotRangeAnnotationRecord(ConfiguredBaseModel):
    """
    Supplied annotation of a first/last screenshot range within the owning phone-use session, not whole-session intent or a populated app-feature selection. PULSE printed p.202 Section2.2 and p.203 Figure1b/c allows labels in any order and study-specific dimensions. Positive endpoint references resolve only within that session; null/omission retains unknown endpoints. The open lexical label object preserves partial/unknown dimensions rather than enforcing the later analysis completeness filter (p.204 Section3.3). Endpoint inclusion, overlap/relabel handling and stack expansion remain unknown. No range membership, duration or missing labels are inferred. Regret2025 pp6–8 additionally uses source-bound single-image descriptions, classifier category/justification, independent human categories and consensus. Optional supplied assessor identity is not the participant. Description context has at most one known prior image; classification and human context at most four within the same app-owned container. Partial supports do not fill missing images or execute models/consensus.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'assessor_id': {'description': 'Optional opaque supplied '
                                                       'human/model/consensus '
                                                       'assessor, distinct from the '
                                                       'assessed participant and '
                                                       'independent of other '
                                                       'judgments; no rater identity '
                                                       'or agreement is inferred.',
                                        'name': 'assessor_id'},
                        'method_setting_reference': {'description': 'Optional '
                                                                    'source-qualified '
                                                                    'local '
                                                                    'screenshot-analysis '
                                                                    'definition; '
                                                                    'distinct '
                                                                    'descriptions, '
                                                                    'model judgments, '
                                                                    'human judgments '
                                                                    'and consensus are '
                                                                    'not collapsed.',
                                                     'name': 'method_setting_reference',
                                                     'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    range_annotation_id: str = Field(default=..., description="""Supplied annotation identity local to the owning screenshot session, not inferred from equal endpoints or labels.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord']} })
    method_setting_reference: Optional[str] = Field(default=None, description="""Optional source-qualified local screenshot-analysis definition; distinct descriptions, model judgments, human judgments and consensus are not collapsed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    assessor_id: Optional[str] = Field(default=None, description="""Optional opaque supplied human/model/consensus assessor, distinct from the assessed participant and independent of other judgments; no rater identity or agreement is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord', 'TaskOccurrenceRecord']} })
    support_screenshot_references: Optional[list[str]] = Field(default=None, description="""Optional ordered supplied prior-context image IDs local to the same screenshot container. Null/omission is unknown and [] explicitly empty; no missing image, timestamp, model execution or inferred previousness is reconstructed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord']} })
    first_screenshot_reference: Optional[str] = Field(default=None, description="""Optional supplied first endpoint resolving within the owning session; unknown is not the session's first screenshot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord']} })
    last_screenshot_reference: Optional[str] = Field(default=None, description="""Optional supplied last endpoint resolving within the owning session; unknown is not the session's last screenshot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord']} })
    range_label_values_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON object of open dimension labels to values, or JSON null. Partial, empty, omitted and supplied-null objects stay distinct; no codebook, completeness or relabel rule is imposed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('assessor_id')
    def pattern_assessor_id(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid assessor_id format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid assessor_id format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('support_screenshot_references')
    def pattern_support_screenshot_references(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid support_screenshot_references format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid support_screenshot_references format: {v}"
            raise ValueError(err_msg)
        return v


class AppInterruptionSessionRecord(ConfiguredBaseModel):
    """
    Supplied tracked-app session containing separately identified interruption intervals, not continuous app use or unlock-to-lock device use. Why Did you Stop (2021), author-copy physical p.3 Section3.2 and p.7 Section4.4.2, records each interruption individually within a learning session. Figure1 p.4 illustrates independent session/interruption times and app labels. Meaningful (3191754) primary279-284 uses one before/during/after sampling timing per app instance, not three waves within every instance. Supplied session answers, optional interruption references and independent quantities retain their own definitions. Package identity is independent of an optional printed app label. IDs and pairing are normalized, not recovered raw serialization. Unknown membership is not observed zero. No timer, constructor, return-to-learning, interruption cause, scoring, last-interruption selection, ESQ eligibility or duration is inferred.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_name': {'name': 'app_name', 'required': False},
                        'app_package_name': {'name': 'app_package_name',
                                             'required': False},
                        'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'session_questionnaire_responses': {'name': 'session_questionnaire_responses',
                                                            'range': 'AppSessionQuestionnaireResponseRecord'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    app_interruption_session_id: str = Field(default=..., description="""Supplied tracked-app session identity scoped by profile/participant/device, not reconstructed from app/time equality.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppInterruptionSessionRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    app_name: Optional[str] = Field(default=None, description="""Supplied application label qualifying feature names, distinct from an optional package name; no package inference or taxonomy restriction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppInterruptionSessionRecord', 'AppFeatureSessionRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    session_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized session; neither authenticates source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    interruptions: Optional[list[SessionInterruptionRecord]] = Field(default=None, description="""Supplied interruption members local to the containing session; omission/null is unknown and [] explicitly empty supplied membership. Neither establishes complete observation of zero interruptions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppInterruptionSessionRecord']} })
    session_questionnaire_responses: Optional[list[AppSessionQuestionnaireResponseRecord]] = Field(default=None, description="""Supplied answers local to their containing session, in preserved order; the owning class selects device-session or tracked-app answer shape. Null/omission is unknown membership, [] explicitly empty. No prompt eligibility, chronology or interruption join inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord', 'AppInterruptionSessionRecord']} })
    session_quantities: Optional[list[SessionQuantityRecord]] = Field(default=None, description="""Supplied session-owned quantities in preserved order; null/omission unknown and [] explicitly empty. Local IDs and definition/scope compatibility are checked by ingress, not inferred from action membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    session_labels: Optional[list[DeviceSessionLabelRecord]] = Field(default=None, description="""Independent supplied device- or tracked-app-session classifications in preserved order, each retaining its source definition; null/omission is unknown membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord', 'AppInterruptionSessionRecord']} })
    session_actions: Optional[list[TaskActionRecord]] = Field(default=None, description="""Supplied device- or tracked-app-session-local action/activity membership in supplied array order; actions need not identify an app. Null/omission is unknown membership, [] supplied empty, never a reconstructed or complete-zero assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SessionInterruptionRecord(ConfiguredBaseModel):
    """
    One supplied interruption identity local to its containing app session, independent of label or equal time tokens. Why Did you Stop physical p.4 Figure1 prints APP_SWITCH and a visited-app label list containing repeated Google. These labels are not package IDs, classified causes, complete app histories or independently timed visits. Preserve supplied order and optional/null/empty descriptors; no sorting, deduplication, containment arithmetic, resumption or terminating/suspending outcome is inferred.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    interruption_record_id: str = Field(default=..., description="""Supplied interruption identity unique within its containing session, independent of label or equal bounds.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionInterruptionRecord']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    interruption_type: Optional[str] = Field(default=None, description="""Optional open supplied event-type descriptor, such as the illustrated APP_SWITCH; not automatically an internal/device/external cause or suspending/terminating outcome.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionInterruptionRecord']} })
    interruption_classifications: Optional[list[DeviceSessionLabelRecord]] = Field(default=None, description="""Independently supplied automatic labels, final ESQ-confirmed labels, or suspending/terminating outcomes local to one interruption, distinguished by observed property and source definition. Kept separate from event type and subjective ESQ responses; no classifier, rule or causal join is executed. Omission/null is unknown and [] explicitly empty supplied labels.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionInterruptionRecord']} })
    notification_history_references: Optional[list[str]] = Field(default=None, description="""Optional explicitly supplied notification-item associations supporting this interruption, scoped to the same profile/source/participant and compatible known device. Unknown devices must not create ambiguous joins. No nearest-time selection, prior-notification matching or causal attribution is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionInterruptionRecord']} })
    visited_app_labels: Optional[list[str]] = Field(default=None, description="""Optional supplied ordered visited-app label list; duplicates, empty strings and unknown/empty membership retained without converting labels to packages or inferring complete timed transitions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionInterruptionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SessionAssociationDatabaseRecord(ConfiguredBaseModel):
    """
    Supplied session-transaction database and its mined rules scoped to a profile, participant and analysis run. Habitual Smartphone Use (3447991), physical pp10-12 sections3.2.2-3.2.3, mines each participant's cluster separately; pp20-21 section5 pools Android Socialize sessions without clustering. Group labels are not globally unique or recovered raw keys. Supplied memberships/results do not execute mining or establish exact collector, clock, platform, context join or original-row provenance.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    association_database_id: str = Field(default=..., description="""Supplied database identity scoped by profile/participant/device/analysis run, independent of its potentially repeated group label.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    analysis_run_id: str = Field(default=..., description="""Supplied analysis-run identity, not an invented date, reconstructed rolling window or proof that an algorithm ran.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    association_group_label: Optional[str] = Field(default=None, description="""Optional printed or supplied cluster/group label. Null/omission does not assign a cluster or pooled group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    grouping_setting_reference: Optional[str] = Field(default=None, description="""Optional compatible local source-definition reference, distinguishing per-user clustering from pooled sessions without executing either.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    transaction_definition_setting_reference: Optional[str] = Field(default=None, description="""Optional compatible local binary session-transaction definition, not a reference to duration-weighted features.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    session_transactions: Optional[list[SessionTransactionRecord]] = Field(default=None, description="""Supplied database-local transactions. Omission/null is unknown membership; [] is explicitly supplied empty membership, not complete observed zero.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    association_rules: Optional[list[AssociationRuleRecord]] = Field(default=None, description="""Supplied rules owned by this mining database. Presence does not imply that supplied transactions are complete, generate the rule, or determine its denominator.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionAssociationDatabaseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SessionTransactionRecord(ConfiguredBaseModel):
    """
    A supplied transaction for a separately identified phone-use session in its containing database. Habitual physical p12 section3.2.3 and p14 Figure5 distinguish binary app/context presence, explicit absence and undisclosed columns. This is not the preceding duration-weighted TF-IDF Bag-of-Apps representation. Unknown bounds/membership stay unknown; no missing item becomes zero. The illustrated Session i is not linked to U34 or Table5's clusters by the source.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    session_transaction_id: str = Field(default=..., description="""Supplied transaction identity unique within its database, not inferred from equal times or app sets.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    source_session_id: str = Field(default=..., description="""Supplied normalized identity of the session represented by this transaction, unique within the database; not authentication of an original raw key or recovered session constructor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    present_app_items: Optional[list[str]] = Field(default=None, description="""Explicitly supplied present app item labels/identities, not necessarily package IDs. Unlisted items are not inferred absent; supplied order is not usage order.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    absent_app_items: Optional[list[str]] = Field(default=None, description="""Explicitly supplied absent app items, distinct from omitted, unknown or unobserved items.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    present_context_items: Optional[list[AssociationContextItemRecord]] = Field(default=None, description="""Explicitly supplied present contextual items, independent of app itemsets and with no context join inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    absent_context_items: Optional[list[AssociationContextItemRecord]] = Field(default=None, description="""Explicitly supplied absent contextual items; undisclosed columns never become absent values.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionTransactionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class AssociationRuleRecord(ConfiguredBaseModel):
    """
    Supplied rule within its containing mining database, with independently supplied antecedent/consequent app and contextual itemsets. Habitual physical p17 Table5 R6 is WhatsApp=>Instagram for U34's cluster3; reversing the sides changes the rule without changing combined app membership. Printed quality values and category/type annotations remain lexical JSON, not calculated values, temporal order, causes or execution receipts.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    association_rule_id: str = Field(default=..., description="""Supplied database-local rule identity, potentially a printed label rather than an original key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    antecedent_app_items: Optional[list[str]] = Field(default=None, description="""Supplied app items on the antecedent side; not chronological previous apps or causal triggers.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    antecedent_context_items: Optional[list[AssociationContextItemRecord]] = Field(default=None, description="""Supplied contextual antecedent itemset; omitted/null/empty remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    consequent_app_items: Optional[list[str]] = Field(default=None, description="""Supplied app items on the consequent side, independently retained from antecedent membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    consequent_context_items: Optional[list[AssociationContextItemRecord]] = Field(default=None, description="""Supplied contextual consequent itemset where disclosed; no missing membership is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    rule_quality_values_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON quality values with their source labels/units/qualifications. Not computed from supplied sessions or silently treated as a normalized proportion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    rule_annotation_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON rule annotations such as printed category/type, separate from quality values, inferred action or classification execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationRuleRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class AssociationContextItemRecord(ConfiguredBaseModel):
    """
    Context item value with an optional supplied dimension. Habitual physical p14 Figure5 distinguishes notification, period, time, location and activity from app labels. Missing dimension is not inferred from a label; equal labels in different dimensions remain distinct. Array order is preserved as supplied, never interpreted as chronology.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    context_item_label: str = Field(default=..., description="""Supplied context value label, preserved without coercion, case folding or inferred sensor encoding.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationContextItemRecord']} })
    context_dimension: Optional[str] = Field(default=None, description="""Optional supplied context dimension, such as time, location or activity; no dimension or mutually-exclusive value policy is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AssociationContextItemRecord']} })


class TaskOccurrenceRecord(ConfiguredBaseModel):
    """
    Supplied normalized occurrence of a task, potentially spanning several apps and screen/notification/unlock actions, not one app session or paired visual trace. S-ADL (2024), physical pp8 Figure2 and25 Table11, supplies expected scripts and subtask roles; p21 AppendixA.1 and p23 Table6 supply independent content-based criteria. Existing source-setting definitions are referenced, not copied. IDs, role assignments, assessments and links are supplied normalization, not recovered source rows or an executed script matcher. Supplied answers may concern the owning task/session, as in ACII2019 text-entry-session emotion reports. A separately identified questionnaire completion can represent condition-level administration (Alt2012 SUS; Böhmer2014 post-condition TLX). It does not create a browser, call or navigation-trial join or imply task-correctness assessment. Anatomy2016 additionally admits explicitly supplied authentication-task links to one parent screen session and one local attempt action. Code success, retry, screen-off abort and keyguard dismissal remain independent supplied evidence; no finite-state execution or timestamp scheduling repair runs. DynamicSecurity layout874–896 separates the answering participant from an optional supplied history subject. Shared question cases span responders; equal wording does not establish identity and role-varying wording does not contradict an explicitly supplied shared case.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'referenced_day_token': {'description': 'Optional supplied '
                                                                'response/aggregation '
                                                                'day, distinct from '
                                                                'the response instant '
                                                                '(Digital Nightlife '
                                                                'released timeframe '
                                                                'R:22 and combination '
                                                                'R:89–94). Does not '
                                                                'assert calendar '
                                                                'containment of every '
                                                                'owned window, derive '
                                                                'a date from an action '
                                                                'time, or merge '
                                                                'independently '
                                                                'identified tasks.',
                                                 'name': 'referenced_day_token'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'source_work_id': {'name': 'source_work_id', 'required': True}}})

    task_occurrence_id: str = Field(default=..., description="""Supplied task identity scoped by profile/participant/device, not reconstructed from equal app/time tokens.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    assessor_id: Optional[str] = Field(default=None, description="""Optional supplied assessor identity, distinct from the assessed participant_id. JCP2017 pp867–868 has one live interviewer and two video-review psychiatrists, each independently producing standard and app-incorporated judgments. The assessor belongs to the owning task and its assessments; null/omission leaves identity unknown. No clinician catalog, interview/video join or consensus is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotRangeAnnotationRecord', 'TaskOccurrenceRecord']} })
    history_subject_participant_id: Optional[str] = Field(default=None, description="""Optional supplied person whose autobiographical history generated a DynamicSecurity challenge, distinct from the owning Task participant_id answering it. Primary layout874–896 presents the same question/options to the legitimate person, paired strong adversary and hidden-stranger naive adversary. Null/omission leaves history identity unknown; no participant assignment, original challenge key or history join is recovered.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    task_label: str = Field(default=..., description="""Supplied task designation, including which script is meant when a source-setting definition contains multiple scripts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    referenced_day_token: Optional[str] = Field(default=None, description="""Optional supplied response/aggregation day, distinct from the response instant (Digital Nightlife released timeframe R:22 and combination R:89–94). Does not assert calendar containment of every owned window, derive a date from an action time, or merge independently identified tasks.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'TaskOccurrenceRecord']} })
    device_use_session_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    session_action_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    interaction_trace_reference: Optional[str] = Field(default=None, description="""Optional supplied link to the trace assessed by this task/questionnaire completion (ODIM pp12–13 §§5.2–5.3). Resolves within the same profile/source and must match participant identity when known on the trace. Multiple independent questionnaire tasks may assess one trace; null/omission leaves the target unknown. No join, temporal order or participant identity is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    expected_script_setting_reference: Optional[str] = Field(default=None, description="""Optional reference to a compatible task-sequence setting within the owning profile/source; null/omission does not assert an expected script. No script matcher runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    task_actions: Optional[list[TaskActionRecord]] = Field(default=None, description="""Supplied task-local actions in supplied array order. Null/omission is unknown membership; [] is explicitly empty supplied membership, not proof of complete zero observation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    criterion_assessments: Optional[list[TaskCriterionAssessmentRecord]] = Field(default=None, description="""Independently supplied assessments within the task, not one combined task score. Null/omission/empty membership stay distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    task_questionnaire_responses: Optional[list[TaskQuestionnaireResponseRecord]] = Field(default=None, description="""Independently supplied answers concerning the owning task/session or a separate questionnaire completion; omission/null/empty membership are distinct and never imply completion, a call join or a navigation-trial join.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    task_observation_windows: Optional[list[TaskObservationWindowRecord]] = Field(default=None, description="""Supplied task/completion-local windows with source definitions and disclosed local anchor events; STDD alone permits an unknown anchor. Null/omission is unknown membership, [] explicitly empty. No time matching, aggregation or first-response inference runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskOccurrenceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('assessor_id')
    def pattern_assessor_id(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid assessor_id format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid assessor_id format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('history_subject_participant_id')
    def pattern_history_subject_participant_id(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid history_subject_participant_id format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid history_subject_participant_id format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('device_use_session_reference')
    def pattern_device_use_session_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid device_use_session_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid device_use_session_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('session_action_reference')
    def pattern_session_action_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid session_action_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid session_action_reference format: {v}"
            raise ValueError(err_msg)
        return v


class TaskActionRecord(ConfiguredBaseModel):
    """
    Individually supplied member of its containing task or device-use session with optional action label, app identity, time, role labels and lexical content. S-ADL physical p25 Table11 distinguishes observed app/screen actions from extracted subtask roles. Missing/extra/tied-event handling and the automatic constructor are not inferred. Same labels or times do not merge members or create order. Supplied array order remains intact. Oulasvirta pp106–107 distinguishes all-user-action session membership from app-launch order; app identity is independently supplied, never extracted from labels. Hush Section6.1 distinguishes active-in-off from foreground-in-following-on membership.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_identifier': {'name': 'app_identifier', 'required': False},
                        'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    task_action_id: str = Field(default=..., description="""Supplied action identity unique within the containing task or session; labels or equal times are not identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskActionRecord']} })
    app_identifier: Optional[str] = Field(default=None, description="""Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'TaskActionRecord',
                       'MonthlyAppUseCellRecord']} })
    action_label: Optional[str] = Field(default=None, description="""Optional open supplied action descriptor, not a required recovered event code.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskActionRecord']} })
    assigned_role_labels: Optional[list[str]] = Field(default=None, description="""Optional supplied role labels relative to the containing task/session, retained in order without automatic assignment, matching, deduplication or expected-script completion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskActionRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    action_content_json: Optional[str] = Field(default=None, description="""Optional lexical JSON content evidence attached to a task/session action. Null, JSON null and omission stay distinct; no comparison or scoring runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskActionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TaskCriterionAssessmentRecord(ConfiguredBaseModel):
    """
    Independently supplied assessment of a designated criterion for the owning task. S-ADL physical p23 Table6 has separate registration-number and spoken information criteria. Supplied content evidence, result and supporting task actions remain distinct. A definition reference does not recover the actual stimulus or demonstrate automated correctness. No scoring runs at import. Password Entry Usability (2012) pp4–6 also supplies performance criteria: first-to-last-character entry time in milliseconds, guess-to-target Levenshtein distance and participant/password-local best-attempt selection. A supplied value and supporting action identities do not execute those calculations or make the later Send action an entry-time endpoint. Murnane2016 p4 supplies participant-baseline-relative PVT performance; its record does not recover trial granularity or a percentage convention. Source-defined questionnaire summaries, including affect means and PHQ-9 scores/classifications, are assessments rather than individual answers. Supplied summaries remain independent of item values; no scoring, classification or missing-item policy is inferred during import.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    criterion_assessment_id: str = Field(default=..., description="""Supplied assessment identity unique within the task, independent of repeated criterion labels.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    criterion_setting_reference: str = Field(default=..., description="""Reference to a compatible task-correctness, task-performance or questionnaire-summary definition within the owning profile/source; criterion designation remains separate from this potentially composite definition. Referencing a metric does not execute it.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    criterion_label: str = Field(default=..., description="""Supplied designation of the criterion/subtask being assessed, not an inferred selection or result.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    assessment_value_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON assessment result. Does not compute correctness; zero, JSON null, supplied null and omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    assessment_content_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON content supporting the assessment, distinct from its result or action/time evidence; omitted content may be withheld or unreported.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional supplied TaskActionRecord IDs resolving only within the containing task or session, as selected by the owning class. Null/omission is unknown support, [] explicitly empty. No matching, score calculation, temporal anchoring or cross-owner join runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    support_criterion_assessment_references: Optional[list[str]] = Field(default=None, description="""Optional supplied supporting assessment IDs within the containing task, distinct from action IDs. Brain Disorders medRxiv2020 beginning/end PHQ-9 change names its two score assessments without inferring subtraction direction. Null/omission is unknown support, [] explicitly empty; duplicate, self and foreign references reject. These are supplied relationships, not an executed derivation DAG or array-order calculation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskCriterionAssessmentRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TaskQuestionnaireResponseRecord(ConfiguredBaseModel):
    """
    Supplied subjective response concerning its owning task/session or a separately identified questionnaire completion, independently referencing the owning profile's disclosed categorical answers, response scale or instrument definition. Oh App (2013) physical p2 Procedure and p3 Self-Assessment distinguish completing the post-study instrument from logged navigation and from issuing its invitation. This is not task correctness, a navigation-trial link or a reconstructed questionnaire row. Property designation is not exact question wording; endpoints do not supply the complete offered labels, numeric codes or missing-response policy. ACII2019 explicit No Response is a supplied skip, not absent membership or a fifth modeled emotion. Alt2012 physical p3 specifies SUS per condition without administered items/endpoints; Böhmer2014 p5 specifies post-condition dimensions and a 20-point scale without anchors. These omissions do not justify invented instrument details. Import preserves lexical answers without scoring or recoding.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'observed_property': {'description': 'Supplied subjective '
                                                             'measure designation, not '
                                                             'necessarily exact '
                                                             'question wording.',
                                              'name': 'observed_property',
                                              'required': True},
                        'questionnaire_item_label': {'name': 'questionnaire_item_label',
                                                     'required': False},
                        'questionnaire_response_id': {'description': 'Supplied answer '
                                                                     'identity unique '
                                                                     'within the '
                                                                     'owning task; '
                                                                     'repeated labels '
                                                                     'or values do not '
                                                                     'merge answers.',
                                                      'name': 'questionnaire_response_id',
                                                      'required': True},
                        'response_value_json': {'name': 'response_value_json',
                                                'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'support_task_action_references': {'description': 'Optional '
                                                                          'explicitly '
                                                                          'supplied '
                                                                          'owner-local '
                                                                          'actions: '
                                                                          'Chang '
                                                                          'retrospective '
                                                                          'event '
                                                                          'supports or '
                                                                          'DynamicSecurity '
                                                                          'answer-local '
                                                                          'evidence/confidence '
                                                                          'supports, '
                                                                          'resolving '
                                                                          'only within '
                                                                          'the '
                                                                          'containing '
                                                                          'TaskOccurrence. '
                                                                          'The '
                                                                          'preceding24h '
                                                                          'end-of-day '
                                                                          'event '
                                                                          'selection '
                                                                          'horizon '
                                                                          'remains a '
                                                                          'method '
                                                                          'definition; '
                                                                          'these links '
                                                                          'do not turn '
                                                                          'an event '
                                                                          'into a24h '
                                                                          'window or '
                                                                          'infer '
                                                                          'prompt '
                                                                          'time/selection. '
                                                                          'Shared '
                                                                          'answer '
                                                                          'supports do '
                                                                          'not compute '
                                                                          'confidence '
                                                                          'or recover '
                                                                          'missing '
                                                                          'case '
                                                                          'identities. '
                                                                          'Null/omission '
                                                                          'is unknown, '
                                                                          '[] '
                                                                          'explicitly '
                                                                          'empty; '
                                                                          'unrelated '
                                                                          'response '
                                                                          'carriers '
                                                                          'reject this '
                                                                          'field '
                                                                          'unless '
                                                                          'their own '
                                                                          'ingress '
                                                                          'validates '
                                                                          'it.',
                                                           'name': 'support_task_action_references'}}})

    questionnaire_response_id: str = Field(default=..., description="""Supplied answer identity unique within the owning task; repeated labels or values do not merge answers.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_setting_reference: str = Field(default=..., description="""Reference to a compatible disclosed response-scale definition within the owning profile/source, not an invitation or reported result; unknown instrument details remain on that source definition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TypingQuestionnaireResponseRecord']} })
    observed_property: str = Field(default=..., description="""Supplied subjective measure designation, not necessarily exact question wording.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    assessment_case_token: Optional[str] = Field(default=None, description="""Optional supplied case identity scoped to profile/source, independent of rater, text label, description or response. Meaningful primary339–354 has authored app-use cases followed by independent ratings of shared cases. DynamicSecurity layout874–896 supplies shared question/options identities across legitimate/adversarial responders, without requiring literal role-varying wording equality. This token preserves a supplied relationship across completions without recovering original IDs or declaring a case catalog. Null/omission is unknown identity; equal labels do not imply equal cases.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskQuestionnaireResponseRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional explicitly supplied owner-local actions: Chang retrospective event supports or DynamicSecurity answer-local evidence/confidence supports, resolving only within the containing TaskOccurrence. The preceding24h end-of-day event selection horizon remains a method definition; these links do not turn an event into a24h window or infer prompt time/selection. Shared answer supports do not compute confidence or recover missing case identities. Null/omission is unknown, [] explicitly empty; unrelated response carriers reject this field unless their own ingress validates it.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('assessment_case_token')
    def pattern_assessment_case_token(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid assessment_case_token format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid assessment_case_token format: {v}"
            raise ValueError(err_msg)
        return v


class AppSessionQuestionnaireResponseRecord(TaskQuestionnaireResponseRecord):
    """
    Supplied answer identity local to one tracked-app session, using the existing subjective-answer slots and compatible local source definition. Optional response-role labels retain before/during/after or another supplied designation without reconstructing sampling chronology. Meaningful released Sample.java527-554 cancels only the current prompt: earlier answers survive, current NO_RESPONSE differs from later NA. WhyStop ESQ answers may be partial; no answer is mandatory. An optional supplied interruption reference resolves only within the containing session and does not infer the last interruption, cause or outcome.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'questionnaire_item_label': {'name': 'questionnaire_item_label',
                                                     'required': False},
                        'questionnaire_response_id': {'description': 'Supplied answer '
                                                                     'identity unique '
                                                                     'within its '
                                                                     'owning '
                                                                     'tracked-app '
                                                                     'session.',
                                                      'name': 'questionnaire_response_id',
                                                      'required': True},
                        'response_value_json': {'name': 'response_value_json',
                                                'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    response_role_label: Optional[str] = Field(default=None, description="""Optional supplied answer-role designation such as before/during/after; not a computed sampling phase or a claim that all phases occur in one app instance.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppSessionQuestionnaireResponseRecord']} })
    interruption_record_reference: Optional[str] = Field(default=None, description="""Optional supplied interruption ID resolving only within the containing tracked-app session; null/omission is unknown relationship, not a last-interruption or cause inference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppSessionQuestionnaireResponseRecord']} })
    questionnaire_response_id: str = Field(default=..., description="""Supplied answer identity unique within its owning tracked-app session.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_setting_reference: str = Field(default=..., description="""Reference to a compatible disclosed response-scale definition within the owning profile/source, not an invitation or reported result; unknown instrument details remain on that source definition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TypingQuestionnaireResponseRecord']} })
    observed_property: str = Field(default=..., description="""Supplied subjective measure designation, not necessarily exact question wording.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    assessment_case_token: Optional[str] = Field(default=None, description="""Optional supplied case identity scoped to profile/source, independent of rater, text label, description or response. Meaningful primary339–354 has authored app-use cases followed by independent ratings of shared cases. DynamicSecurity layout874–896 supplies shared question/options identities across legitimate/adversarial responders, without requiring literal role-varying wording equality. This token preserves a supplied relationship across completions without recovering original IDs or declaring a case catalog. Null/omission is unknown identity; equal labels do not imply equal cases.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskQuestionnaireResponseRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional explicitly supplied owner-local actions: Chang retrospective event supports or DynamicSecurity answer-local evidence/confidence supports, resolving only within the containing TaskOccurrence. The preceding24h end-of-day event selection horizon remains a method definition; these links do not turn an event into a24h window or infer prompt time/selection. Shared answer supports do not compute confidence or recover missing case identities. Null/omission is unknown, [] explicitly empty; unrelated response carriers reject this field unless their own ingress validates it.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('response_role_label')
    def pattern_response_role_label(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid response_role_label format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid response_role_label format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('interruption_record_reference')
    def pattern_interruption_record_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid interruption_record_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid interruption_record_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('assessment_case_token')
    def pattern_assessment_case_token(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid assessment_case_token format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid assessment_case_token format: {v}"
            raise ValueError(err_msg)
        return v


class TaskObservationWindowRecord(ConfiguredBaseModel):
    """
    Supplied observation/summary window anchored to an explicitly identified action in its containing task or questionnaire completion. Personality states (2020) printed697 ends its preceding30-minute window at the first photographic-affect-meter response, not later personality submission. Sarsenbayeva (2020) p5 compares ESM valence against1/5/60-minute Affectiva windows; only the1-minute case explicitly says preceding. Local source definitions preserve that distinction; unspecified sidedness and endpoints are never inferred. Supplied answer links designate comparisons, not the anchor event or equality of their timestamps. Quantities are supplied, not computed; valence does not inherit raw emotion-confidence scale bounds. Local references preserve normalization but do not authenticate firstness, reconstruct time, match raw rows or establish observation completeness. Murnane2016 p7 preserves a one-hour window surrounding a PVT assessment and independent mean-session-seconds, distinct-app and switch summaries; surrounding does not specify centered offsets or a phone-session closer.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'anchor_task_action_reference': {'description': 'Supplied '
                                                                        'local action '
                                                                        'anchor. '
                                                                        "STDD's "
                                                                        'preceding-EMA '
                                                                        'alignment '
                                                                        'does not '
                                                                        'disclose '
                                                                        'receipt/open/submission '
                                                                        'semantics and '
                                                                        'alone permits '
                                                                        'an '
                                                                        'omitted/null '
                                                                        'anchor. '
                                                                        'Established '
                                                                        'action-anchored '
                                                                        'policies '
                                                                        'retain their '
                                                                        'required '
                                                                        'local action '
                                                                        'in source '
                                                                        'validation; '
                                                                        'no action is '
                                                                        'fabricated to '
                                                                        'satisfy the '
                                                                        'structure.',
                                                         'name': 'anchor_task_action_reference'},
                        'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': False},
                        'questionnaire_response_references': {'description': 'Supplied '
                                                                             'compared/supporting '
                                                                             'answer '
                                                                             'IDs '
                                                                             'resolving '
                                                                             'only '
                                                                             'within '
                                                                             'the '
                                                                             'containing '
                                                                             'task '
                                                                             'completion. '
                                                                             'Null/omission '
                                                                             'is '
                                                                             'unknown '
                                                                             'support, '
                                                                             '[] '
                                                                             'explicitly '
                                                                             'empty; '
                                                                             'the '
                                                                             'anchor '
                                                                             'event '
                                                                             'remains '
                                                                             'separately '
                                                                             'identified.',
                                                              'name': 'questionnaire_response_references'},
                        'screen_text_capture_references': {'description': 'Supplied '
                                                                          'ordered '
                                                                          'Screen Text '
                                                                          'Sensor '
                                                                          'capture '
                                                                          'IDs, '
                                                                          'resolved '
                                                                          'within the '
                                                                          'same '
                                                                          'profile/source/participant '
                                                                          'and '
                                                                          'compatible '
                                                                          'known '
                                                                          'device. '
                                                                          'Null/omission '
                                                                          'is unknown '
                                                                          'membership, '
                                                                          '[] '
                                                                          'explicitly '
                                                                          'empty. The '
                                                                          'five-minute '
                                                                          'policy is '
                                                                          'anchored to '
                                                                          'questionnaire '
                                                                          'receipt, '
                                                                          'not '
                                                                          'response; '
                                                                          'no '
                                                                          'timestamp '
                                                                          'matching, '
                                                                          'sorting or '
                                                                          'text-equality '
                                                                          'deduplication '
                                                                          'is '
                                                                          'performed.',
                                                           'name': 'screen_text_capture_references'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    observation_window_id: str = Field(default=..., description="""Supplied window identity unique within its containing task, not inferred from duration or equal endpoints.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord']} })
    window_setting_references: list[str] = Field(default=..., description="""Nonempty unique references to compatible window/span/anchor definitions within the owning profile and source. Ambiguous sidedness remains on its source definition, not inherited from another window.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord']} })
    anchor_task_action_reference: Optional[str] = Field(default=None, description="""Supplied local action anchor. STDD's preceding-EMA alignment does not disclose receipt/open/submission semantics and alone permits an omitted/null anchor. Established action-anchored policies retain their required local action in source validation; no action is fabricated to satisfy the structure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Supplied compared/supporting answer IDs resolving only within the containing task completion. Null/omission is unknown support, [] explicitly empty; the anchor event remains separately identified.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    screen_text_capture_references: Optional[list[str]] = Field(default=None, description="""Supplied ordered Screen Text Sensor capture IDs, resolved within the same profile/source/participant and compatible known device. Null/omission is unknown membership, [] explicitly empty. The five-minute policy is anchored to questionnaire receipt, not response; no timestamp matching, sorting or text-equality deduplication is performed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord',
                       'SampledQuantityObservationRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    quantities: Optional[list[SampledQuantityRecord]] = Field(default=None, description="""Independently retained supplied quantities; [] is empty membership, omission/null unknown. No sum, counter difference, reset repair or unit conversion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord',
                       'SampledQuantityObservationRecord',
                       'SampledEntityMemberRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class AppFeatureSessionRecord(ConfiguredBaseModel):
    """
    Supplied normalized app session containing individually identified timed feature-use instances and optional instance-selection responses. Finesse (2021), published-layout p.8 Section3.3 and p.3 Figure1, stores session start/duration and each instance's feature name/start/end. Same-label instances are not one occurrence. IDs are supplied normalized identities, not recovered raw keys; no classification, session construction, sampling, timing conversion or regret computation runs during import.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    feature_session_id: str = Field(default=..., description="""Supplied app-session identity scoped by profile/participant/device; not an inferred app/time join key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppFeatureSessionRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    session_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized session; neither authenticates source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord']} })
    app_name: str = Field(default=..., description="""Supplied application label qualifying feature names, distinct from an optional package name; no package inference or taxonomy restriction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppInterruptionSessionRecord', 'AppFeatureSessionRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    feature_occurrences: list[AppFeatureOccurrenceRecord] = Field(default=..., description="""Supplied ordered instances in the owning session; [] is explicit empty membership, not missing data. No feature-label deduplication occurs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppFeatureSessionRecord']} })
    session_feature_selections: Optional[list[SessionFeatureSelectionRecord]] = Field(default=None, description="""Supplied session-local response records; null/omission remains unknown, [] explicitly empty. No prompt or sampling eligibility is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppFeatureSessionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class AppFeatureOccurrenceRecord(ConfiguredBaseModel):
    """
    One supplied feature-use instance local to its owning app session, not merely a feature label, app episode or Accessibility callback. Finesse p.8 Section3.3 preserves each instance's name/start/end. Supplied order, opaque time tokens and unknown endpoints survive without inferring an overlap, adjacency, containment, carry-forward or duration policy.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    feature_occurrence_id: str = Field(default=..., description="""Supplied instance identity unique within its owning session even at identical feature labels/times.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppFeatureOccurrenceRecord']} })
    feature_name: str = Field(default=..., description="""Supplied feature label scoped by the owning application; not a global closed vocabulary or an occurrence identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AppFeatureOccurrenceRecord']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SessionFeatureSelectionRecord(ConfiguredBaseModel):
    """
    Supplied response state and optional membership of selected feature-use occurrences in the owning app session. Finesse p.8 Section3.3 asks users to select individual instances; p.3 Figure1 illustrates SUBMIT and SKIP. Submitted empty membership differs from an unanswered or expired prompt. Status labels are supplied normalized descriptions, not recovered stored codes; SKIP's deployed storage mapping remains unknown. Unknown wording, answers and membership are never manufactured from a status.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'questionnaire_item_label': {'name': 'questionnaire_item_label',
                                                     'required': False},
                        'questionnaire_response_id': {'description': 'Supplied '
                                                                     'normalized '
                                                                     'response '
                                                                     'identity local '
                                                                     'to the owning '
                                                                     'app session, not '
                                                                     'a notification '
                                                                     'history.',
                                                      'name': 'questionnaire_response_id'},
                        'response_value_json': {'name': 'response_value_json',
                                                'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    questionnaire_response_id: str = Field(default=..., description="""Supplied normalized response identity local to the owning app session, not a notification history.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    selection_response_status: str = Field(default=..., description="""Supplied nonblank open response-state label, not a source-code enum, timer execution or inferred negative response.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionFeatureSelectionRecord']} })
    selected_feature_occurrence_references: Optional[list[str]] = Field(default=None, description="""Supplied submitted-answer membership, not provisional clicks: distinct occurrence IDs resolving only within the owning session. [] is explicit empty selection; null/omission is unknown. Unanswered/expired states do not assert submitted membership; SKIP's stored mapping is unknown. Selection of one same-label occurrence does not label every such occurrence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionFeatureSelectionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ScreenTextCaptureRecord(ConfiguredBaseModel):
    """
    Supplied normalized text snapshot, with its raw or derived meaning declared by the referenced local source definition. ScreenTextSensor (10.1145/3613904.3642347) physical pp3–4 Sections3.1–3.2 describes a saved flat string, application package and individually delimited text-node phrases with pixel rectangles from Android Accessibility. JMIR55999 (10.2196/55999) physical p4 describes EasyOCR-derived screenshot text and its confidence filter and normalization; these are not raw Accessibility observations. ScreenTK (10.1145/3675094.3677547) Figures2–3 separately describe capture time and Unix event time; source_event_time_token preserves the latter independently, without assuming units or conversion between them. This record is not screenshot pixels or a UsageStats event, and importing it does not execute OCR or normalization. Equal text/time tokens do not merge captures or phrases. Flat text and phrase membership are independently supplied; no delimiter parsing, concatenation, filtering, tree/visibility inference or time conversion runs at import. Null, empty and omitted membership remain distinct. Normalized IDs do not recover raw keys, serializer or the study build.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    text_capture_id: str = Field(default=..., description="""Supplied normalized saved-text record identity local to profile/participant/device, not a timestamp or text hash.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    capture_instant: Optional[str] = Field(default=None, description="""Supplied opaque text-capture time token; no clock units, ordering or timezone inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord']} })
    source_event_time_token: Optional[str] = Field(default=None, description="""Supplied opaque source-designated event-time token, independent of capture_instant. ScreenTK Figure3 calls its timestamp Unix event time; numeric unit, precision and conversion to the Figure2 capture-time representation are unreported. No parsing, clock conversion, timezone assignment or equality between the two time fields is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord', 'SampledQuantityObservationRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    screen_text: Optional[str] = Field(default=None, description="""Supplied flat screen-text string, preserved without splitting, joining, trimming or verifying original delimiter grammar.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord']} })
    screen_phrases: Optional[list[ScreenTextPhraseRecord]] = Field(default=None, description="""Supplied capture-owned phrase members; null/omission is unknown, empty is supplied empty membership. Equal text never deduplicates children.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TypingTrialRecord(ConfiguredBaseModel):
    """
    Supplied normalized trial membership or explicitly selected derived-only cells. Akpinar et al. DOI 10.1145/3577013 physical pp12-13 Figure4/Section4.2 distinguishes raw actions from later trial construction by participant, timestamp order, app switch, text reset and transition-specific pauses. This class retains supplied ordered references, not an executed trial constructor, timestamp tie rule, computed correction verdict or recovered ESM join. IDs and membership are normalized, not recovered source keys. Rodrigues et al. DOI10.1145/3491102.3501908 p5§3.1.2 stores metrics without raw text, touchpoints or app identity. Its released CSV's repeated Index tuples must not be deduplicated or treated as trial identity. Derived-only rows reference their own lifecycle and column definitions, not CABAS boundaries. Optional action-trial-owned token evaluations and text-change cases, independent system verdicts, participant follow-up answers and separately supplied questionnaire answers preserve the pp18–20 follow-up and pp7–8/32–33 ESM relationships without executing a classifier or recovering raw case keys and joins.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'rules': [{'elseconditions': {'slot_conditions': {'keyboard_transaction_references': {'minimum_cardinality': 1,
                                                                                               'name': 'keyboard_transaction_references',
                                                                                               'required': True},
                                                           'released_values_json': {'name': 'released_values_json',
                                                                                    'value_presence': 'ABSENT'},
                                                           'trial_app_switch_setting_reference': {'name': 'trial_app_switch_setting_reference',
                                                                                                  'pattern': '\\S',
                                                                                                  'required': True},
                                                           'trial_lifecycle_setting_reference': {'name': 'trial_lifecycle_setting_reference',
                                                                                                 'value_presence': 'ABSENT'},
                                                           'trial_partition_setting_reference': {'name': 'trial_partition_setting_reference',
                                                                                                 'pattern': '\\S',
                                                                                                 'required': True},
                                                           'trial_pause_setting_reference': {'name': 'trial_pause_setting_reference',
                                                                                             'pattern': '\\S',
                                                                                             'required': True},
                                                           'trial_representation': {'equals_string': 'action_membership',
                                                                                    'name': 'trial_representation',
                                                                                    'required': False},
                                                           'trial_reset_setting_reference': {'name': 'trial_reset_setting_reference',
                                                                                             'pattern': '\\S',
                                                                                             'required': True},
                                                           'trial_schema_setting_reference': {'name': 'trial_schema_setting_reference',
                                                                                              'value_presence': 'ABSENT'}}},
                    'postconditions': {'slot_conditions': {'keyboard_transaction_references': {'name': 'keyboard_transaction_references',
                                                                                               'value_presence': 'ABSENT'},
                                                           'released_values_json': {'name': 'released_values_json',
                                                                                    'required': True},
                                                           'text_change_cases': {'name': 'text_change_cases',
                                                                                 'value_presence': 'ABSENT'},
                                                           'token_evaluation_cases': {'name': 'token_evaluation_cases',
                                                                                      'value_presence': 'ABSENT'},
                                                           'trial_app_switch_setting_reference': {'name': 'trial_app_switch_setting_reference',
                                                                                                  'value_presence': 'ABSENT'},
                                                           'trial_lifecycle_setting_reference': {'name': 'trial_lifecycle_setting_reference',
                                                                                                 'pattern': '\\S',
                                                                                                 'required': True},
                                                           'trial_partition_setting_reference': {'name': 'trial_partition_setting_reference',
                                                                                                 'value_presence': 'ABSENT'},
                                                           'trial_pause_setting_reference': {'name': 'trial_pause_setting_reference',
                                                                                             'value_presence': 'ABSENT'},
                                                           'trial_questionnaire_responses': {'name': 'trial_questionnaire_responses',
                                                                                             'value_presence': 'ABSENT'},
                                                           'trial_reset_setting_reference': {'name': 'trial_reset_setting_reference',
                                                                                             'value_presence': 'ABSENT'},
                                                           'trial_schema_setting_reference': {'name': 'trial_schema_setting_reference',
                                                                                              'pattern': '\\S',
                                                                                              'required': True}}},
                    'preconditions': {'slot_conditions': {'trial_representation': {'equals_string': 'derived_metrics',
                                                                                   'name': 'trial_representation',
                                                                                   'value_presence': 'PRESENT'}}}}],
         'slot_usage': {'keyboard_transaction_references': {'minimum_cardinality': 1,
                                                            'name': 'keyboard_transaction_references',
                                                            'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'trial_app_switch_setting_reference': {'name': 'trial_app_switch_setting_reference',
                                                               'required': False},
                        'trial_partition_setting_reference': {'name': 'trial_partition_setting_reference',
                                                              'required': False},
                        'trial_pause_setting_reference': {'name': 'trial_pause_setting_reference',
                                                          'required': False},
                        'trial_reset_setting_reference': {'name': 'trial_reset_setting_reference',
                                                          'required': False}}})

    typing_trial_id: str = Field(default=..., description="""Supplied normalized typing-trial identity local to profile/participant/device; not a recovered trial constructor or timestamp key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    trial_representation: Optional[TypingTrialRepresentationId] = Field(default=None, description="""Explicit derived_metrics branch versus retained action_membership. Omission is legacy action membership; null is invalid at ingress.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_partition_setting_reference: Optional[str] = Field(default=None, description="""Local source-located participant-partition and timestamp-order rule for trial construction; not by itself the complete boundary method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_app_switch_setting_reference: Optional[str] = Field(default=None, description="""Local source-located app-package switch trial boundary; no app-switch inference runs at import.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_reset_setting_reference: Optional[str] = Field(default=None, description="""Local source-located nonempty-current then empty-before trial boundary; not a submitted-versus-cleared decision.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_pause_setting_reference: Optional[str] = Field(default=None, description="""Local source-located three transition-specific pause thresholds; comparator equality remains unreported and no pause split runs at import.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    keyboard_transaction_references: Optional[list[str]] = Field(default=None, description="""Supplied ordered normalized action IDs in one trial, resolving to standalone same-owner keyboard transactions. [] is not a valid observed trial; no membership is inferred for unreferenced actions.""", min_length=1, json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_lifecycle_setting_reference: Optional[str] = Field(default=None, description="""Required only for derived_metrics: local reconstruction/text_entry_trial start/end or explicit trial-unit definition (such as each prompted answer). It does not supply clocks, action membership or execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_schema_setting_reference: Optional[str] = Field(default=None, description="""Required only for derived_metrics: local event_schema/analysis_record_set declaration of every supplied column label.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    released_values_json: Optional[str] = Field(default=None, description="""Required only for derived_metrics: supplied lexical JSON object with exactly the locally declared column labels and string-valued cells. Preserve codes, blanks and numeric text without coercion, deduplication or time inference; columns are not all metrics.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    text_change_cases: Optional[list[TextChangeCaseRecord]] = Field(default=None, description="""Optional supplied case members in an action-membership trial; omission/null/[] remain distinct and no change extraction runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    token_evaluation_cases: Optional[list[TokenEvaluationCaseRecord]] = Field(default=None, description="""Optional supplied word-evaluation cases distinct from text-change cases; no tokenization or classifier runs, and omission/null/[] remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    trial_questionnaire_responses: Optional[list[TypingQuestionnaireResponseRecord]] = Field(default=None, description="""Independent supplied trial-local questionnaire answers, not case follow-up feedback or recovered ESM joins; omission/null/[] remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TypingTrialRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TokenEvaluationCaseRecord(ConfiguredBaseModel):
    """
    Supplied word-evaluation case local to an action-membership typing trial, distinct from removed/reentered text. Akpinar et al. DOI10.1145/3577013 pp18–19 Section4.4.1–4.4.2 presents selected words with overall text and independently retained system judgments and participant F/T feedback. F means participant-reported typo, not correction or system disagreement. Withheld text remains unknown. Equal words do not merge case identities; supplied ownership does not recover original word/action/trial joins.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'system_verdicts': {'name': 'system_verdicts',
                                            'range': 'TokenEvaluationVerdictRecord'}}})

    token_evaluation_case_id: str = Field(default=..., description="""Supplied word-evaluation identity unique within its containing trial, independent of equal token text.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord']} })
    token_text: Optional[str] = Field(default=None, description="""Supplied selected word text, optionally withheld; not reconstructed from keyboard actions or removed/reentered segments.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord']} })
    overall_text: Optional[str] = Field(default=None, description="""Supplied case-context text, optionally withheld; not reconstructed from keyboard actions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    system_verdicts: Optional[list[TokenEvaluationVerdictRecord]] = Field(default=None, description="""Independent supplied case-local verdicts with their own definition/version references; no classifier, revision ordering or participant-agreement calculation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    followup_responses: Optional[list[TypingQuestionnaireResponseRecord]] = Field(default=None, description="""Supplied case-local participant feedback distinct from system verdicts and trial ESM; lexical F/T is not boolean correctness.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TokenEvaluationVerdictRecord(ConfiguredBaseModel):
    """
    Independently supplied word-correctness judgment referencing a profile-local token classification definition, not an edit/correction definition. Akpinar et al. pp18–19 Section4.4 keeps judgments separate from first-task F/T answers. Optional supporting answers resolve only within this token case. No classifier, version assignment, chronology or agreement recoding.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'label_record_id': {'description': 'Supplied verdict identity '
                                                           'unique within its '
                                                           'containing '
                                                           'token-evaluation case.',
                                            'name': 'label_record_id'},
                        'observed_property': {'name': 'observed_property',
                                              'required': True},
                        'questionnaire_response_references': {'description': 'Optional '
                                                                             'supplied '
                                                                             'answer '
                                                                             'IDs '
                                                                             'local to '
                                                                             'this '
                                                                             'token '
                                                                             'case, '
                                                                             'not a '
                                                                             'text-change '
                                                                             'case or '
                                                                             'trial '
                                                                             'questionnaire.',
                                                              'name': 'questionnaire_response_references'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    label_record_id: str = Field(default=..., description="""Supplied verdict identity unique within its containing token-evaluation case.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    label_setting_reference: str = Field(default=..., description="""Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    observed_property: str = Field(default=..., description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    label_value_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Optional supplied answer IDs local to this token case, not a text-change case or trial questionnaire.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TextChangeCaseRecord(ConfiguredBaseModel):
    """
    Supplied text-change case local to an action-membership typing trial. Akpinar et al. DOI10.1145/3577013 pp18–19 §4.4.1–4.4.2 provides overall, removed and reentered text for independent system-verdict and participant follow-up comparison. Withheld text remains null/omitted. Equal content does not merge case IDs. Optional action supports resolve within the trial, not an inferred segmentation, exhaustive membership or disjoint partition. Array order is preserved but does not establish case or revision chronology.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    text_change_case_id: str = Field(default=..., description="""Supplied case identity unique within its typing trial, independent of equal text.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TextChangeCaseRecord']} })
    overall_text: Optional[str] = Field(default=None, description="""Supplied case-context text, optionally withheld; not reconstructed from keyboard actions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    removed_text: Optional[str] = Field(default=None, description="""Supplied removed text segment, not inferred by comparing action states; empty/null/omission preserved.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TextChangeCaseRecord']} })
    reentered_text: Optional[str] = Field(default=None, description="""Supplied reentered text segment, independently preserved without normalization or correction classification.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TextChangeCaseRecord']} })
    support_keyboard_transaction_references: Optional[list[str]] = Field(default=None, description="""Optional supplied action supports resolving uniquely within the owning trial's membership; [] means explicit empty support, null/omission unknown. No boundary extraction or disjointness inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TextChangeCaseRecord']} })
    system_verdicts: Optional[list[TextChangeVerdictRecord]] = Field(default=None, description="""Independent supplied case-local verdicts with their own definition/version references; no classifier, revision ordering or participant-agreement calculation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    followup_responses: Optional[list[TypingQuestionnaireResponseRecord]] = Field(default=None, description="""Supplied case-local participant feedback distinct from system verdicts and trial ESM; lexical F/T is not boolean correctness.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TokenEvaluationCaseRecord', 'TextChangeCaseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TextChangeVerdictRecord(ConfiguredBaseModel):
    """
    Independently supplied text-change verdict, referencing a profile-local classification definition. Akpinar et al. pp18–20 §4.4 distinguishes initial and revised verdicts; printed Algorithm2's version placement remains unresolved. No verdict is computed from supplied feedback or assigned to a version by array position. Supporting answer IDs, when supplied, resolve only within this case's follow-up answers, not ESM or another case.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'label_record_id': {'description': 'Supplied verdict identity '
                                                           'unique within the '
                                                           'containing text-change '
                                                           'case, not a device '
                                                           'session.',
                                            'name': 'label_record_id'},
                        'observed_property': {'name': 'observed_property',
                                              'required': True},
                        'questionnaire_response_references': {'description': 'Optional '
                                                                             'supplied '
                                                                             'supporting '
                                                                             'answer '
                                                                             'IDs '
                                                                             'local to '
                                                                             'the '
                                                                             "case's "
                                                                             'follow-up '
                                                                             'responses; '
                                                                             'no '
                                                                             'causal '
                                                                             'or '
                                                                             'temporal '
                                                                             'inference.',
                                                              'name': 'questionnaire_response_references'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    label_record_id: str = Field(default=..., description="""Supplied verdict identity unique within the containing text-change case, not a device session.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    label_setting_reference: str = Field(default=..., description="""Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    observed_property: str = Field(default=..., description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    label_value_json: Optional[str] = Field(default=None, description="""Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionLabelRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Optional supplied supporting answer IDs local to the case's follow-up responses; no causal or temporal inference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TypingQuestionnaireResponseRecord(ConfiguredBaseModel):
    """
    Individually identified supplied answer owned either by a token or text-change case's follow-up or separately by its typing trial's questionnaire association. Akpinar et al. pp18–19 §4.4.1 uses F for participant-reported error correction and T otherwise in the change task; the distinct word task uses F for a participant-reported typo and T otherwise. Neither means system agreement. ESM context and subjective-error instruments on pp7–8/32–33 are separate. Each answer references its own local definition. Null/omission/lexical JSON null and repeated values remain distinct; no raw join, scoring or recoding.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'observed_property': {'name': 'observed_property',
                                              'required': True},
                        'questionnaire_item_label': {'name': 'questionnaire_item_label',
                                                     'required': False},
                        'questionnaire_response_id': {'description': 'Supplied answer '
                                                                     'identity unique '
                                                                     'within its '
                                                                     'containing case '
                                                                     'or trial; equal '
                                                                     'IDs in separate '
                                                                     'owners do not '
                                                                     'merge.',
                                                      'name': 'questionnaire_response_id'},
                        'questionnaire_setting_reference': {'description': 'Local '
                                                                           'compatible '
                                                                           'task-specific '
                                                                           'word/change '
                                                                           'follow-up '
                                                                           'or '
                                                                           'questionnaire '
                                                                           'instrument '
                                                                           'definition, '
                                                                           'not a '
                                                                           'prompt '
                                                                           'cadence or '
                                                                           'reported '
                                                                           'statistic.',
                                                            'name': 'questionnaire_setting_reference'},
                        'response_value_json': {'name': 'response_value_json',
                                                'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    questionnaire_response_id: str = Field(default=..., description="""Supplied answer identity unique within its containing case or trial; equal IDs in separate owners do not merge.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    questionnaire_setting_reference: str = Field(default=..., description="""Local compatible task-specific word/change follow-up or questionnaire instrument definition, not a prompt cadence or reported statistic.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TypingQuestionnaireResponseRecord']} })
    observed_property: str = Field(default=..., description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    questionnaire_item_label: Optional[str] = Field(default=None, description="""Supplied questionnaire item label; not an invented raw schema key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    response_value_json: Optional[str] = Field(default=None, description="""Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationQuestionnaireResponseRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'TaskQuestionnaireResponseRecord',
                       'SessionFeatureSelectionRecord',
                       'TypingQuestionnaireResponseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class KeyboardTransactionRecord(ConfiguredBaseModel):
    """
    One supplied keyboard action independent of any reconstructed trial. Preserve both text states, the opaque timestamp, application package and supplied normalized boolean flags independently. Figure4 prints 0/1 flags but does not disclose its deployed raw serializer or timestamp unit. Trial membership may remain unknown; no source row key, correction verdict or sequence position is inferred from equal time/text values.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    keyboard_transaction_id: str = Field(default=..., description="""Supplied action identity local to profile/participant/device, not inferred from equal time, text or package.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    keyboard_schema_setting_reference: str = Field(default=..., description="""Local source-located keyboard before/after transaction schema, distinct from an Accessibility text snapshot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    keyboard_timestamp: Optional[str] = Field(default=None, description="""Opaque supplied keyboard-event timestamp token; Figure4 prints 13-digit examples but formal source storage unit is unreported.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    before_text: Optional[str] = Field(default=None, description="""Whole field text before this keyboard action, independently preserved from current_text; null, empty and omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    current_text: Optional[str] = Field(default=None, description="""Whole field text after this keyboard action; not a screen-text snapshot or inferred token/correction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    is_deleted: Optional[bool] = Field(default=None, description="""Supplied normalized boolean deletion flag, not a recovered 0/1 source serialization or an edit classifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    is_password: Optional[bool] = Field(default=None, description="""Supplied normalized boolean password-field flag; password phrases are not reconstructed from masked source data.""", json_schema_extra = { "linkml_meta": {'domain_of': ['KeyboardTransactionRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ScreenTextPhraseRecord(ConfiguredBaseModel):
    """
    One supplied normalized text-node member of its owning capture, with its own capture-local identity. ScreenTextSensor physical p4 Section3.2 and Figure2 distinguishes individual phrases and their top-left/bottom-right pixel coordinates. Equal phrase strings do not merge children. Bounds denote node rectangles, not glyph coordinates, visibility or a tree relation (physical p17 Section6.6). Optional partial values remain unknown; importer preserves supplied child order without asserting source chronology.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    phrase_id: str = Field(default=..., description="""Supplied normalized child identity local to its owning capture, not text equality or a recovered raw node key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    phrase_text: Optional[str] = Field(default=None, description="""Supplied literal phrase text; empty, null and omission are distinct, with no normalization or inferred relationship.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    phrase_left_px: Optional[float] = Field(default=None, description="""Supplied top-left node-rectangle x coordinate in pixels, not glyph position or visibility; partial values remain unknown.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    phrase_top_px: Optional[float] = Field(default=None, description="""Supplied top-left node-rectangle y coordinate in pixels; offscreen/overlapping/zero-size rectangles are not filtered.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    phrase_right_px: Optional[float] = Field(default=None, description="""Supplied bottom-right node-rectangle x coordinate in pixels, independent of the supplied top-left coordinate.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    phrase_bottom_px: Optional[float] = Field(default=None, description="""Supplied bottom-right node-rectangle y coordinate in pixels; no screen extent or text location is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextPhraseRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SensorControlOccurrenceRecord(ConfiguredBaseModel):
    """
    A separately identified supplied normalized logged sensor enable/disable instance, independent of text captures. ScreenTextSensor physical p17 Section6.6 describes AWARE-Light logging these instances. This is neither screen/keyguard state nor an active-collection interval; do not infer success, actor, disabled duration, missing capture or a neighboring join. The profile-owned definition reference identifies the logged-control acquisition claim, not an execution receipt or recovered raw event code.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    sensor_control_id: str = Field(default=..., description="""Supplied logged-control record identity local to profile/participant/device; equal times do not merge instances.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SensorControlOccurrenceRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    sensor_label: str = Field(default=..., description="""Supplied sensor identifier/label, not normalized into an Android package or an inferred deployed build.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SensorControlOccurrenceRecord']} })
    sensor_control_action: SensorControlActionId = Field(default=..., description="""Supplied enable/disable occurrence label; not observed service status or a reconstructed disabled interval.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SensorControlOccurrenceRecord']} })
    occurrence_instant: Optional[str] = Field(default=None, description="""When the occurrence happened.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence',
                       'NotificationOpeningOccurrenceRecord',
                       'SensorControlOccurrenceRecord'],
         'slot_uri': 'time:inXSDDateTimeStamp'} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SampledQuantityObservationRecord(ConfiguredBaseModel):
    """
    TimeKilling CHI2023 additionally retains supplied capture-pair and feature identities distinct from source phone-use screenshot sessions and nonoverlapping seven-pair prediction sequences. Optional parent/child screenshot references retain supplied membership without clock equality, padding inference or tensor/model execution. Explicit padding, unknown membership and captured black images are distinct. Source-qualified quantities retain current/session/past-window scopes and named axes; independently supplied user/group and model summaries do not manufacture participants or calculate outputs. Supplied normalized observation with independently retained quantities and an explicitly typed subject. Falaki et al. IMC2010 Section2 Dataset2 records these every two minutes; Section4's later per-application interval analysis does not disclose cumulative-versus-delta storage or process/app joins. Tokens and IDs are supplied, not inferred packages, PIDs or clocks. Equal subjects, times and values do not merge observation identities. Missing quantities remain unknown; no arithmetic or interval construction. Hush Section3.1 additionally distinguishes process/core CPU readings, core frequency-residency durations, UID network bytes and device battery and signal readings; PID/UID-to-app aggregation is not inferred. CHI2020 Sarsenbayeva p3 supplies participant facial-expression confidence values from 0 to 100, not probabilities, percentages or questionnaire answers. Energy Drain2015 §§3–5 additionally supplies device summaries and distinct application-owned foreground/background/component quantities, independent application-category averages/totals/shares and version-scoped foreground drain rates plus total foreground energy/time/EDR. A category aggregate is not an individual app or evidence of app membership. An app token is not a process or Android UID; its identity and any period token are supplied, never joined. Participant context may be omitted/null only for exact source-compatible across-device Energy app/category summaries, Meaningful pooled U&G shares, Falaki across-user application-category popularity and Next App Table2 application classifications, and exact Mercati DATE2014 per-core reporting records from the hardware-only governor experiment with supplied device/core ownership. The wireless-signal controlled handset, system-call-model and validation observations (doi:10.1145/2465529.2466586) additionally permit unknown human context only with a supplied device; volunteer trace and selected-user what-if observations still require participant ownership. Screen Text and Angry Birds additionally distinguish exact source-scoped participant-group summaries from individual participant observations; unknown original group IDs are not manufactured. Screen Text application and application-category summaries retain their distinct subject kinds. A cohort or hardware device is never manufactured as a participant. Observation time may be omitted for study-wide summaries. Import performs no division, mean, weighting, membership propagation or classifier execution. Energy Drain2015 Section2.5 additionally retains independent dynamic event occurrences, not resulting state snapshots; source event time remains distinct from collection time. Appendix A logged per-core CPU frequency is not a residency duration, and raw screen brightness has an unreported unit, not the later duration-weighted percentage. Its UID-owned Nsnd/Nrcv byte values and T interval in seconds remain independent supplied quantities, without a UID-to-app join, cadence inference or network-call or energy reconstruction. Supplied student-course subjects keep the participant as the student and require a separate opaque course token. Distinct class/attendance evidence observations do not merge on course equality; explicitly supplied same-owner supports retain Wi-Fi-primary, GPS-building fallback and unavailable-evidence distinctions without inferring attendance. Scheduled, attended and effective class time, screen exposure and the class-time denominator remain independent. Source-compatible local definitions constrain entity, property and units. Next App §§3–5 additionally retains separately identified raw action occurrences, independently supplied basic/last-family vector features, app-opening analysis anchors and role-specific sampled supports. A following Gaussian context member is not a preceding last-action feature. Static inventories, cold-app class/prior values and explicit cold-user inventory/history relationships retain their independent owners. Vectors do not establish a dimension, training recipe or computed representation. No callback equivalence, latest selection, time ordering, Gaussian draw, aggregation, class cutoff or cross-user history alignment is inferred. Supplied predictor rows may name a same-owner task explicitly, without asserting an action anchor, original row join, window bounds or calculation. A supplied scan can own ordered AP appearances; a supplied inferred place can own AP/cell members. List position is not a rank or clustering proof. Root membership is an optional local reference, never inferred from order. Device summaries over observed days are not particular-day observations. A current-running-app snapshot owns simultaneous application appearances; a supplied per-user binary feature row owns vocabulary members with independent app-use values. Neither implies launch, foreground attribution or a reconstructed episode. A static installed-app inventory owns installed applications and optionally supplied native versus user-installed origin. Static membership is not a particular-day, monthly-use or running claim. No source cadence, timestamp, binary conversion, inventory count, native proportion or raw-to-derived join is inferred from members. A ranked recent-task snapshot can instead own application members with independently supplied source keys, zero-based ranks, boot-elapsed logging-time tokens, component strings and source values (Gouin-Vallerand2014 p3 Sample1). Per-member times may differ within a list; they are not a parent collection instant or a known launch time. No scalar time unit, boot-to-wall-clock join, unchanged-list filtering, rank reversal or transition is inferred. Mercati DATE2014 Figure2 per-core H/L allocation is distinct from scheduler PID observations, dynamic H-PID lists, foreground episodes and idle frequency context. Experimental seconds and reliability virtual-years quantities remain independent of scheduler/temperature cadences and the accelerated aging definition. H never constructs a maximum-frequency value; the reported budget-exhaustion qualification and unknown raw-to-plot constructor persist. Tapping2024 app/tap observations additionally admit explicitly supplied phone-session and local foreground-period action references. A→B→A visits retain independent identities. Source event time is not collection time; these supports never select a nearest episode or construct app periods. Independent authentication durations need not belong to the usage cohort; configuration booleans are normalized truth values, not recovered codes. PlacesActivities activity reports and CoronaHealth released active-use or inferred-inactivity records may additionally retain a supplied UsageInterval. That optional interval is not a fabricated task, place visit, day, inferred boundary pair or computed duration. Its endpoints and duration remain independent, with omission, null and populated values distinct. Corona submission observations keep ordered optional app blocks and separately permissioned coarse GPS; release windows are not necessarily one day. PlacesActivities context summaries distinguish participant means by activity, place type or characteristic from pooled participant-group summaries. Sleep Prediction daily graphs likewise retain an explicit participant-group owner, directed peer-day edges and independently supplied own previous-day quality. No callback, submission/GPS equality, calendar offset, membership, category, threshold, mean, questionnaire score or prediction is inferred.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'description': 'Optional supplied '
                                                            'UsageInterval only for '
                                                            'source-compatible '
                                                            'PlacesActivities activity '
                                                            'reports and CoronaHealth '
                                                            'active-use/inferred-inactivity '
                                                            'release records. '
                                                            'Start/end tokens, '
                                                            'duration and endpoint '
                                                            'statuses remain '
                                                            'independent; no '
                                                            'inclusivity, calendar, '
                                                            'one-day boundary, clock '
                                                            'arithmetic, place visit '
                                                            'or session constructor is '
                                                            'inferred.',
                                             'name': 'denotes_interval',
                                             'required': False},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'observation_instant': {'description': 'Opaque supplied '
                                                               'collection-time token; '
                                                               'no units, timezone or '
                                                               'observed interval '
                                                               'bounds inferred.',
                                                'name': 'observation_instant'},
                        'participant_id': {'description': 'Exact TimeKilling supplied '
                                                          'group summaries '
                                                          'additionally permit '
                                                          'omitted/null individual '
                                                          'context only on their '
                                                          'source-authorized pooled '
                                                          'route; no individual '
                                                          'participant or device is '
                                                          'inferred. Optional supplied '
                                                          'context only for '
                                                          'source-compatible '
                                                          'application/application-category '
                                                          'Energy Drain2015 '
                                                          'aggregates, Meaningful '
                                                          'pooled application U&G '
                                                          'shares, Falaki across-user '
                                                          'application-category '
                                                          'popularity, Next App Table2 '
                                                          'application '
                                                          'classifications, exact '
                                                          'Screen Text pooled '
                                                          'application/category, '
                                                          'participant-group or '
                                                          'explicitly scoped place '
                                                          'summaries, exact Angry '
                                                          'Birds pooled '
                                                          'application/category/participant-group '
                                                          'and Kim2019 pooled '
                                                          'application/participant-group '
                                                          'summaries, and exact '
                                                          'Mercati DATE2014 '
                                                          'hardware-only per-core '
                                                          'reporting records with '
                                                          'supplied device/core '
                                                          'ownership. Exact '
                                                          'doi:10.1145/2465529.2466586 '
                                                          'controlled handset, '
                                                          'system-call-model and '
                                                          'validation device/process '
                                                          'observations also permit '
                                                          'omitted/null human context '
                                                          'only with a nonblank '
                                                          'device; volunteer trace and '
                                                          'selected-user what-if rows '
                                                          'still require participant '
                                                          'context. Exact '
                                                          'PlacesActivities pooled '
                                                          'context summaries and Sleep '
                                                          'Prediction supplied daily '
                                                          'graphs also permit '
                                                          'omitted/null human context '
                                                          'only as participant-group '
                                                          'subjects without an '
                                                          'individual '
                                                          'participant/device. Exact '
                                                          'KeyboardStress pooled '
                                                          'participant-group '
                                                          'windows/features and HMOG '
                                                          'controlled-device energy '
                                                          'observations also permit '
                                                          'omitted/null human context; '
                                                          'the former cannot name an '
                                                          'individual '
                                                          'participant/device and the '
                                                          'latter require the supplied '
                                                          'device. The importer '
                                                          'retains a required nonblank '
                                                          'participant for all other '
                                                          'subject/source routes, '
                                                          'including named-person '
                                                          'Screen Text summaries, '
                                                          'ordinary HMOG '
                                                          'authentication and Hush CPU '
                                                          'cores; it never invents a '
                                                          'cohort or hardware '
                                                          'participant.',
                                           'name': 'participant_id',
                                           'required': False},
                        'screen_text_capture_references': {'description': 'Supplied '
                                                                          'ordered '
                                                                          'Screen Text '
                                                                          'capture '
                                                                          'membership, '
                                                                          'source-qualified '
                                                                          'and local '
                                                                          'to '
                                                                          'profile/source/participant/compatible '
                                                                          'known '
                                                                          'device. '
                                                                          'Per-screen '
                                                                          'density/sentiment '
                                                                          'admits at '
                                                                          'most one '
                                                                          'known '
                                                                          'capture, '
                                                                          'sequential '
                                                                          'phrase '
                                                                          'difference '
                                                                          'at most '
                                                                          'two, and '
                                                                          'selected-set '
                                                                          'screen '
                                                                          'counts '
                                                                          'admit '
                                                                          'independently '
                                                                          'supplied '
                                                                          'members. '
                                                                          'Null/omission/empty '
                                                                          'membership '
                                                                          'remains '
                                                                          'distinct; '
                                                                          'no '
                                                                          'timestamp '
                                                                          'selection, '
                                                                          'chronology, '
                                                                          'completeness, '
                                                                          'set '
                                                                          'arithmetic '
                                                                          'or '
                                                                          'aggregate '
                                                                          'is '
                                                                          'inferred.',
                                                           'name': 'screen_text_capture_references'},
                        'source_event_time_token': {'description': 'Optional opaque '
                                                                   'source-designated '
                                                                   'event time, '
                                                                   'distinct from '
                                                                   'observation_instant '
                                                                   'collection time. '
                                                                   'Boredom Table1 has '
                                                                   'screen '
                                                                   'on/off/unlock '
                                                                   'occurrences and '
                                                                   'timed '
                                                                   'incoming/outgoing '
                                                                   'call and '
                                                                   'receiving/reading/sending '
                                                                   'SMS occurrences; '
                                                                   'WhyStop p3 also '
                                                                   'records '
                                                                   'timestamped '
                                                                   'RINGING/SMS_RECEIVED '
                                                                   'occurrences. Each '
                                                                   'is independently '
                                                                   'owned by its '
                                                                   'source definition, '
                                                                   'not a state '
                                                                   'snapshot or an '
                                                                   'invented '
                                                                   'task/session '
                                                                   'group. No '
                                                                   'point-time '
                                                                   'conversion, '
                                                                   'cadence, boundary '
                                                                   'pairing, temporal '
                                                                   'order, collector '
                                                                   'execution or ESM '
                                                                   'join is inferred.',
                                                    'name': 'source_event_time_token',
                                                    'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    sampled_observation_id: str = Field(default=..., description="""Supplied observation identity local to profile/participant/device; equal time or entity tokens do not merge records.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    screenshot_session_reference: Optional[str] = Field(default=None, description="""Optional supplied cross-carrier screenshot-session parent. TimeKilling CHI2023 pp6–7 supplies a real phone-use parent distinct from prediction sequences; importer resolves source/profile/participant/compatible known device without constructing sessions or joins.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    screenshot_record_reference: Optional[str] = Field(default=None, description="""Optional supplied screenshot child within its explicitly referenced screenshot-session parent. A known child requires that parent; missing/null child remains unknown. No timestamp equality, inferred nearest image, padding inference or recovered serializer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: Optional[str] = Field(default=None, description="""Exact TimeKilling supplied group summaries additionally permit omitted/null individual context only on their source-authorized pooled route; no individual participant or device is inferred. Optional supplied context only for source-compatible application/application-category Energy Drain2015 aggregates, Meaningful pooled application U&G shares, Falaki across-user application-category popularity, Next App Table2 application classifications, exact Screen Text pooled application/category, participant-group or explicitly scoped place summaries, exact Angry Birds pooled application/category/participant-group and Kim2019 pooled application/participant-group summaries, and exact Mercati DATE2014 hardware-only per-core reporting records with supplied device/core ownership. Exact doi:10.1145/2465529.2466586 controlled handset, system-call-model and validation device/process observations also permit omitted/null human context only with a nonblank device; volunteer trace and selected-user what-if rows still require participant context. Exact PlacesActivities pooled context summaries and Sleep Prediction supplied daily graphs also permit omitted/null human context only as participant-group subjects without an individual participant/device. Exact KeyboardStress pooled participant-group windows/features and HMOG controlled-device energy observations also permit omitted/null human context; the former cannot name an individual participant/device and the latter require the supplied device. The importer retains a required nonblank participant for all other subject/source routes, including named-person Screen Text summaries, ordinary HMOG authentication and Hush CPU cores; it never invents a cohort or hardware participant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""Optional supplied UsageInterval only for source-compatible PlacesActivities activity reports and CoronaHealth active-use/inferred-inactivity release records. Start/end tokens, duration and endpoint statuses remain independent; no inclusivity, calendar, one-day boundary, clock arithmetic, place visit or session constructor is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    device_use_session_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    session_action_reference: Optional[str] = Field(default=None, description="""Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenshotSessionRecord',
                       'TaskOccurrenceRecord',
                       'SampledQuantityObservationRecord']} })
    task_occurrence_reference: Optional[str] = Field(default=None, description="""Optional supplied task identity within the same profile/source/participant/device; omission/null is unknown. Not a timing anchor, inferred original join, classifier input construction or questionnaire-answer reference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    screen_text_capture_references: Optional[list[str]] = Field(default=None, description="""Supplied ordered Screen Text capture membership, source-qualified and local to profile/source/participant/compatible known device. Per-screen density/sentiment admits at most one known capture, sequential phrase difference at most two, and selected-set screen counts admit independently supplied members. Null/omission/empty membership remains distinct; no timestamp selection, chronology, completeness, set arithmetic or aggregate is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord',
                       'SampledQuantityObservationRecord']} })
    observed_entity_kind: str = Field(default=..., description="""Explicit subject kind constrained by the local source definition; an application, application category and participant group are distinct subjects, not an individual participant, process, core, Android UID, device, supplied course or inferred place. Participant groups are admitted only for exact source-scoped aggregate definitions. No PID/UID/package identity join, app/category/cohort membership or calendar window is implied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    observed_entity_token: Optional[str] = Field(default=None, description="""Opaque supplied identity of the typed subject, including independently identified applications, categories and student courses. A course token is not a class/attendance occurrence ID; distinct observation IDs preserve those instances. Null/omission remains unknown, not an inferred app package, PID, UID equality, app/category membership or cross-observation join.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord', 'SampledEntityMemberRecord']} })
    observation_instant: Optional[str] = Field(default=None, description="""Opaque supplied collection-time token; no units, timezone or observed interval bounds inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord',
                       'DeviceStateObservationRecord']} })
    source_event_time_token: Optional[str] = Field(default=None, description="""Optional opaque source-designated event time, distinct from observation_instant collection time. Boredom Table1 has screen on/off/unlock occurrences and timed incoming/outgoing call and receiving/reading/sending SMS occurrences; WhyStop p3 also records timestamped RINGING/SMS_RECEIVED occurrences. Each is independently owned by its source definition, not a state snapshot or an invented task/session group. No point-time conversion, cadence, boundary pairing, temporal order, collector execution or ESM join is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ScreenTextCaptureRecord', 'SampledQuantityObservationRecord']} })
    quantities: Optional[list[SampledQuantityRecord]] = Field(default=None, description="""Independently retained supplied quantities; [] is empty membership, omission/null unknown. No sum, counter difference, reset repair or unit conversion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord',
                       'SampledQuantityObservationRecord',
                       'SampledEntityMemberRecord']} })
    entity_members: Optional[list[SampledEntityMemberRecord]] = Field(default=None, description="""Ordered supplied members of one scan or inferred group; [] is an observed empty membership while omission/null is unknown. No clustering, deduplication or inferred cross-observation join.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    root_entity_member_reference: Optional[str] = Field(default=None, description="""Optional supplied root member ID resolved within the same inferred group; omission/null is unknown, never the first member by convention.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    app_interruption_session_reference: Optional[str] = Field(default=None, description="""Optional supplied tracked-app-session membership for this independently identified observation. Resolve within profile/source/participant and compatible known device; unknown device must not produce an ambiguous join. No session membership, observation timestamp, movement episode or interval is inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    sampled_observation_references: Optional[list[SampledObservationReferenceRecord]] = Field(default=None, description="""Source-compatible role-qualified supplied supports or memberships; omission/null is unknown, [] explicitly empty supplied links. Order is preserved, not temporal chronology. Actual importer validates each source's roles, target definition and ownership without discovering or constructing links.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('device_use_session_reference')
    def pattern_device_use_session_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid device_use_session_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid device_use_session_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('session_action_reference')
    def pattern_session_action_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid session_action_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid session_action_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('observed_entity_kind')
    def pattern_observed_entity_kind(cls, v):
        pattern=re.compile(r"^(process|cpu_core|android_uid|device|participant|participant_group|place|course|application|application_category)$")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid observed_entity_kind format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid observed_entity_kind format: {v}"
            raise ValueError(err_msg)
        return v


class SampledObservationReferenceRecord(ConfiguredBaseModel):
    """
    Supplied role-qualified relationship to another normalized observation, not a matcher or temporal selection. Next App pp4–5 distinguishes one AppOpen anchor, six independently named last-action supports and a separate before/after Gaussian-context membership. Same-owner links resolve within profile/work/participant and compatible known device. Sections5.2.1–5.2.2 separately permit explicit cross-participant input inventories and surrogate-history members; target identities retain their source participant, never an inferred identity merge. Omitted/null target leaves this role's support unknown. Equal timestamps or values do not establish linkage, latest/nearest selection or order.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'relationship_label': {'name': 'relationship_label',
                                               'pattern': '\\S',
                                               'required': True},
                        'sampled_observation_reference': {'name': 'sampled_observation_reference',
                                                          'pattern': '\\S',
                                                          'required': False},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    relationship_label: str = Field(default=..., description="""Supplied nonblank relationship designation, not inferred causality, chronology or a source storage code.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CrossPeriodAggregateReference',
                       'SampledObservationReferenceRecord']} })
    sampled_observation_reference: Optional[str] = Field(default=None, description="""Optional supplied target observation identity. Nonblank positive IDs resolve unambiguously within the relation's source-authorized owner scope; null/omission is unknown.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledObservationReferenceRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('relationship_label')
    def pattern_relationship_label(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid relationship_label format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid relationship_label format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('sampled_observation_reference')
    def pattern_sampled_observation_reference(cls, v):
        pattern=re.compile(r"\S")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid sampled_observation_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid sampled_observation_reference format: {v}"
            raise ValueError(err_msg)
        return v


class SampledEntityMemberRecord(ConfiguredBaseModel):
    """
    One supplied AP appearance, cell/AP member, or application member owned by one observation. Application meaning comes from the local source definition: simultaneous running appearance, supplied app-vocabulary feature member, static installed membership, or ranked recent-task member are distinct. Its local record identity is distinct from an optional recurring entity token and independently retained CID/LAC or anonymized MAC/SSID readings. Equal tokens/values do not merge members. RSSI/frequency belong to the scan appearance, not a stable AP property or an inferred place fingerprint. Omitted/null quantities remain unknown; an empty list is explicitly empty. Membership does not recover a scan-to-place join, ranking, geographic coordinate, hash algorithm, clustering execution, visit or session context. An application token is a supplied opaque identifier, not an inferred package/name mapping. Installation origin is an optional member-owned categorical quantity, not a device/cohort mean or inferred app use. Ranked recent-task source rank/key, boot-elapsed token, component and source value remain independent member quantities. Same-package/different- activity appearances retain distinct member IDs and ordered source keys; list position does not synthesize rank.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    entity_member_id: str = Field(default=..., description="""Supplied member record ID unique within its owning observation; distinct from an optional recurring AP/cell identity token.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledEntityMemberRecord']} })
    member_entity_kind: str = Field(default=..., description="""Explicit member kind constrained by the local source definition; not inferred from token/value formatting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledEntityMemberRecord']} })
    observed_entity_token: Optional[str] = Field(default=None, description="""Opaque supplied identity of the typed subject, including independently identified applications, categories and student courses. A course token is not a class/attendance occurrence ID; distinct observation IDs preserve those instances. Null/omission remains unknown, not an inferred app package, PID, UID equality, app/category membership or cross-observation join.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord', 'SampledEntityMemberRecord']} })
    quantities: Optional[list[SampledQuantityRecord]] = Field(default=None, description="""Independently retained supplied quantities; [] is empty membership, omission/null unknown. No sum, counter difference, reset repair or unit conversion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TaskObservationWindowRecord',
                       'SampledQuantityObservationRecord',
                       'SampledEntityMemberRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })

    @field_validator('member_entity_kind')
    def pattern_member_entity_kind(cls, v):
        pattern=re.compile(r"^(access_point|cell|application)$")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid member_entity_kind format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid member_entity_kind format: {v}"
            raise ValueError(err_msg)
        return v


class SampledQuantityRecord(ConfiguredBaseModel):
    """
    One independently supplied quantity owned by its observation or window. Window summary values do not inherit raw-emotion confidence bounds. Traffic byte directions occur at most once per observation and require bytes. Hush frequency-residency members may have distinct opaque frequency qualifiers; unknown qualifiers never merge members or require inference. CPU/residency/signal units are undisclosed and remain omitted/null; UID network bytes and battery percent remain distinct. Emotion confidence has no inferred physical unit and its components need not sum to 100. Lexical JSON retains zero, quoted numeric text and JSON null separately from an omitted or null field. The source's raw serializer and counter reset/interval interpretation remain unknown; values are not converted.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'observed_property': {'name': 'observed_property',
                                              'required': True}}})

    observed_property: str = Field(default=..., description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    evidence_value_json: Optional[str] = Field(default=None, description="""Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'SampledQuantityRecord']} })
    evidence_unit: Optional[str] = Field(default=None, description="""Supplied unit for this quantity alone; no numeric conversion or inferred unit.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'SampledQuantityRecord']} })
    quantity_qualifier: Optional[str] = Field(default=None, description="""Supplied source-defined quantity variant: a core-residency frequency designation (Hush Section3.1), a session feature's absolute/frequency/normalization/state designation (Rabbit Hole Section4.1), or an explicitly named activity/component/connectivity/radio stratum for an Energy Drain2015 summary. No frequency, unit, weighting, group boundary or formula is inferred. Omission/null is unknown and does not merge members.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityRecord']} })


class SessionQuantityRecord(SampledQuantityRecord):
    """
    Independently identified supplied quantity local to one device-use or tracked-app session, linked to its source feature or record-field definition. Jones physicalpp6,8 distinguishes session-string length and B/length from physical duration and strategy. Rabbit Hole physicalp11 Section4.1 distinguishes per-app and per-category counts/time/interactions from session-wide features. Explicit scope survives unknown app/category identity; missing identity is not a session total. Qualifiers preserve absolute counts, time-relative frequencies, supplied state and normalization variants. Figure7 seconds/session/minute and Figure11 normalized-by-session-length do not establish a universal fraction, percentage, formula or missing-unit conversion. No aggregation, app join, timestamp inference, normalization or repair runs during import. APNOMS2011 Figure7 supplies separate start/end battery levels in percent for charging or battery-change intervals, not computed energy consumption. Meaningful (3191754) released Event.java103-117 separately preserves four millisecond duration fields, including lexical NA; sample duration is not silently added to duration_total. WhyStop net length excludes suspending interruption time but supplies no overlap/union algorithm. Values remain independent rather than being derived from containing intervals. Chang printedpp9,12 additionally preserves each ringer-occupancy-local attending-action gap with independently supplied ordered endpoints, its ordinal attendance category and its separate supplied mean. No arithmetic, within-boundary selection, chronology or completeness is asserted.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'app_identifier': {'name': 'app_identifier', 'required': False},
                        'questionnaire_response_references': {'description': 'Optional '
                                                                             'supplied '
                                                                             'answer '
                                                                             'IDs '
                                                                             'resolving '
                                                                             'only '
                                                                             'within '
                                                                             'the '
                                                                             'containing '
                                                                             'session. '
                                                                             'Hiniker2016 '
                                                                             'Table4 '
                                                                             'retains '
                                                                             'each '
                                                                             'response-specific '
                                                                             'context '
                                                                             'row '
                                                                             'independently '
                                                                             'of '
                                                                             'unresolved '
                                                                             'displayed/collected/submitted '
                                                                             'timing; '
                                                                             'this '
                                                                             'relation '
                                                                             'is not a '
                                                                             'clock '
                                                                             'anchor. '
                                                                             'Null/omission '
                                                                             'is '
                                                                             'unknown '
                                                                             'support, '
                                                                             '[] '
                                                                             'explicitly '
                                                                             'empty.',
                                                              'name': 'questionnaire_response_references'},
                        'source_locators': {'name': 'source_locators',
                                            'required': True},
                        'support_task_action_references': {'description': 'Optional '
                                                                          'supplied '
                                                                          'action/foreground-period '
                                                                          'IDs '
                                                                          'resolving '
                                                                          'only within '
                                                                          'the '
                                                                          'containing '
                                                                          'session, '
                                                                          'not app '
                                                                          'identity or '
                                                                          'a derived '
                                                                          'join. A→B→A '
                                                                          'retains '
                                                                          'separate '
                                                                          'visits; '
                                                                          'supports do '
                                                                          'not execute '
                                                                          'raw-to-period '
                                                                          'construction, '
                                                                          'clipping or '
                                                                          'feature '
                                                                          'calculation.',
                                                           'name': 'support_task_action_references'}}})

    quantity_record_id: str = Field(default=..., description="""Supplied quantity identity unique within its owning session; repeated equal properties/values remain independent.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord']} })
    quantity_setting_reference: str = Field(default=..., description="""Profile-local feature or record-field definition with compatible role, target, property, unit and scope; not a request to compute the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord']} })
    quantity_scope: str = Field(default=..., description="""Explicit session/app/app-category subject scope, independent of whether the app/category identity is known.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord']} })
    app_identifier: Optional[str] = Field(default=None, description="""Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'TaskActionRecord',
                       'MonthlyAppUseCellRecord']} })
    observation_category: Optional[str] = Field(default=None, description="""Optional supplied category scope, independent of property/value; not a reconstructed app classifier. Null/omission remain distinct.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord', 'SessionQuantityRecord']} })
    support_task_action_references: Optional[list[str]] = Field(default=None, description="""Optional supplied action/foreground-period IDs resolving only within the containing session, not app identity or a derived join. A→B→A retains separate visits; supports do not execute raw-to-period construction, clipping or feature calculation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord']} })
    questionnaire_response_references: Optional[list[str]] = Field(default=None, description="""Optional supplied answer IDs resolving only within the containing session. Hiniker2016 Table4 retains each response-specific context row independently of unresolved displayed/collected/submitted timing; this relation is not a clock anchor. Null/omission is unknown support, [] explicitly empty.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAcceptanceRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'TaskObservationWindowRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord']} })
    start_action_reference: Optional[str] = Field(default=None, description="""Optional supplied start action ID for a Chang attending-action gap, resolving only inside its containing ringer occupancy. Null/omission is unknown; array order and timestamps never infer the reference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord']} })
    end_action_reference: Optional[str] = Field(default=None, description="""Optional supplied end action ID for the same gap, resolving locally and distinct from a known start. Not an aggregation support or mean endpoint; no duration calculation or cross-boundary matching.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })
    observed_property: str = Field(default=..., description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation',
                       'ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'SampledQuantityRecord']} })
    evidence_value_json: Optional[str] = Field(default=None, description="""Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'SampledQuantityRecord']} })
    evidence_unit: Optional[str] = Field(default=None, description="""Supplied unit for this quantity alone; no numeric conversion or inferred unit.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'NotificationEvidenceRecord',
                       'SampledQuantityRecord']} })
    quantity_qualifier: Optional[str] = Field(default=None, description="""Supplied source-defined quantity variant: a core-residency frequency designation (Hush Section3.1), a session feature's absolute/frequency/normalization/state designation (Rabbit Hole Section4.1), or an explicitly named activity/component/connectivity/radio stratum for an Energy Drain2015 summary. No frequency, unit, weighting, group boundary or formula is inferred. Omission/null is unknown and does not merge members.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityRecord']} })

    @field_validator('quantity_scope')
    def pattern_quantity_scope(cls, v):
        pattern=re.compile(r"^(session|app|app_category)$")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid quantity_scope format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid quantity_scope format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('start_action_reference')
    def pattern_start_action_reference(cls, v):
        pattern=re.compile(r"^.*\S.*$")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid start_action_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid start_action_reference format: {v}"
            raise ValueError(err_msg)
        return v

    @field_validator('end_action_reference')
    def pattern_end_action_reference(cls, v):
        pattern=re.compile(r"^.*\S.*$")
        if isinstance(v, list):
            for element in v:
                if isinstance(element, str) and not pattern.match(element):
                    err_msg = f"Invalid end_action_reference format: {element}"
                    raise ValueError(err_msg)
        elif isinstance(v, str) and not pattern.match(v):
            err_msg = f"Invalid end_action_reference format: {v}"
            raise ValueError(err_msg)
        return v


class MonthlyAppUseCellRecord(ConfiguredBaseModel):
    """
    Supplied partial user/app/month binary cell, as distinguished in Sekara et al. Scientific Reports2021 Figure1 and Methods. One means used in that month and zero otherwise, not installed/uninstalled. Omitted/null values are normalized unknowns, never filled with zero. App and user tokens are opaque pseudonymous identifiers, not inferred packages or hash algorithms. No day/session, calendar boundary, complete fingerprint, eligibility or annual maximum/OR computation is inferred from these supplied cells.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    cell_id: str = Field(default=..., description="""Supplied normalized app-use cell record identity local to profile/participant/device; not derived by concatenating tensor coordinates.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MonthlyAppUseCellRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    month_label: str = Field(default=..., description="""Supplied nonblank month token, preserving wording without inferred days, timezone, bounds or calendar conversion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MonthlyAppUseCellRecord']} })
    app_identifier: str = Field(default=..., description="""Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'TaskActionRecord',
                       'MonthlyAppUseCellRecord']} })
    used_in_month: Optional[int] = Field(default=None, description="""Supplied binary cell: 1 used during month, 0 otherwise. Missing/null is unknown and never converted to zero; no installed-app inference.""", ge=0, le=1, json_schema_extra = { "linkml_meta": {'domain_of': ['MonthlyAppUseCellRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DeviceStateObservationRecord(ConfiguredBaseModel):
    """
    Supplied normalized logged state-entry record, not a real-world occurrence, ringer occupancy or unlock-to-lock session. Hard Lock Life printed p218 Figure1/Section4.1.1 combines screen and keyguard states and timestamps state entry. Preserve independent state components and separately identified records at equal opaque times, including OFF/UNLOCKED. Optional/null values remain unknown, not inferred from the other component or an adjacent row. IDs and tokens are supplied, not recovered raw serialization.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    state_observation_id: str = Field(default=..., description="""Supplied normalized state-record ID local to profile/participant/device; never derived from a timestamp.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateObservationRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    observation_instant: Optional[str] = Field(default=None, description="""Supplied opaque state-entry time token. Null/omission/empty stay distinct; no clock conversion or chronology inferred.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SampledQuantityObservationRecord',
                       'DeviceStateObservationRecord']} })
    screen_state: Optional[ScreenStateId] = Field(default=None, description="""Supplied screen component only, independent of keyguard state; omission/null remains unknown.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateObservationRecord']} })
    keyguard_state: Optional[KeyguardStateId] = Field(default=None, description="""Supplied keyguard component only, independent of screen state; omission/null remains unknown.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateObservationRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DeviceStateIntervalRecord(ConfiguredBaseModel):
    """
    Supplied kind-qualified interval with independently supplied endpoint state-record references. Hard Lock Life printed pp218/220 distinguishes screen bouts from upper-bound unlock cost. Equal time tokens do not equate endpoints or erase kind. Positive references resolve in the same profile, participant and known device; unknown endpoints remain null/omitted. Reuse UsageInterval without sorting, pairing, duration calculation, missing-event repair, or authentication inference. This is not an executed constructor.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'participant_id': {'name': 'participant_id', 'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    state_interval_id: str = Field(default=..., description="""Supplied normalized interval-record ID local to profile/participant/device; equal bounds do not merge records.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateIntervalRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Constructed example versus supplied normalized evidence; neither authenticates raw source rows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    method_setting_reference: str = Field(default=..., description="""Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParticipantDayObservationRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'ScreenTextCaptureRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord']} })
    interval_kind: DeviceStateIntervalKindId = Field(default=..., description="""Supplied interval meaning; upper-bound unlock cost is not authentication-input duration.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateIntervalRecord']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    start_observation_ref: Optional[str] = Field(default=None, description="""Supplied start state-record ID, resolved within profile/participant/known device; null/omission is unknown, not reconstructed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateIntervalRecord']} })
    end_observation_ref: Optional[str] = Field(default=None, description="""Supplied end state-record ID, independent of start and bounds; resolved within profile/participant/known device.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceStateIntervalRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class RingerStateIntervalRecord(ConfiguredBaseModel):
    """
    Supplied normalized ringer-setting occupancy over an interval, not a continuous device-use session, mode-change callback or executed constructor. Chang and Tang (2015), printed p.12 / PDF p.7, defines occupancy until a different mode and calculates attendance gaps within that scope. The local source policy preserves the unknown powered-off duration (printed pp.14-15 / PDF pp.9-10); no bridge, deletion, duration or endpoint is inferred here. IDs and tokens are normalized, not recovered source serialization.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'denotes_interval': {'inlined': True,
                                             'name': 'denotes_interval',
                                             'required': True},
                        'method_profile_id': {'identifier': False,
                                              'name': 'method_profile_id',
                                              'required': True},
                        'source_locators': {'name': 'source_locators',
                                            'required': True}}})

    ringer_state_interval_id: str = Field(default=..., description="""Normalized interval record identity scoped by profile and participant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['RingerStateIntervalRecord']} })
    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    interval_record_origin: InteractionTraceRecordOriginId = Field(default=..., description="""Supplied normalized records versus constructed example; neither authenticates source rows or reconstruction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['RingerStateIntervalRecord']} })
    session_construction_policy_reference: str = Field(default=..., description="""Local profile-owned policy ID whose output is device_setting_state_interval; not an execution receipt.""", json_schema_extra = { "linkml_meta": {'domain_of': ['RingerStateIntervalRecord']} })
    ringer_mode: RingerModeId = Field(default=..., description="""Supplied normalized setting occupied over denotes_interval; no numeric-code conversion or phone-use inference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['RingerStateIntervalRecord']} })
    denotes_interval: UsageInterval = Field(default=..., description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    session_actions: Optional[list[TaskActionRecord]] = Field(default=None, description="""Supplied device- or tracked-app-session-local action/activity membership in supplied array order; actions need not identify an app. Null/omission is unknown membership, [] supplied empty, never a reconstructed or complete-zero assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    session_quantities: Optional[list[SessionQuantityRecord]] = Field(default=None, description="""Supplied session-owned quantities in preserved order; null/omission unknown and [] explicitly empty. Local IDs and definition/scope compatibility are checked by ingress, not inferred from action membership.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'AppInterruptionSessionRecord',
                       'RingerStateIntervalRecord']} })
    source_locators: list[str] = Field(default=..., description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class UsageEpisodeAssertion(ConfiguredBaseModel):
    """
    A claim that one app was in continuous use over an interval. A derived prov:Entity (what the pipeline asserts, not a ground truth).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    reconstructed_by: Optional[ReconstructionExecution] = Field(default=None, description="""The execution that produced this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })
    attribution: Optional[AttributionAssertion] = Field(default=None, description="""Person attribution for this episode.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion']} })
    measurement_layer: Optional[MeasurementLayer] = Field(default=None, description="""Measurement-model layer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })


class UsageSessionAssertion(ConfiguredBaseModel):
    """
    A claim of continuous device use between unlock and lock. Derived prov:Entity.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    reconstructed_by: Optional[ReconstructionExecution] = Field(default=None, description="""The execution that produced this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })
    measurement_layer: Optional[MeasurementLayer] = Field(default=None, description="""Measurement-model layer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })


class GlanceAssertion(ConfiguredBaseModel):
    """
    A claim that the screen activated then deactivated without an unlock. Derived prov:Entity.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    reconstructed_by: Optional[ReconstructionExecution] = Field(default=None, description="""The execution that produced this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })
    measurement_layer: Optional[MeasurementLayer] = Field(default=None, description="""Measurement-model layer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })


class EffectiveUsageMeasure(ConfiguredBaseModel):
    """
    One screen-gated credited app EPISODE — the unit the engine actually emits when `enable_screen_gated_crediting` is on.
    An earlier version of this class described a per-participant-day `effective_minutes` figure governed by a free-text `coverage_policy`. No such daily measure exists. `apply_screen_gated_credit_incremental` (pipeline_v2.rs) emits `credited_app_csv`, a side-by-side CSV written by the same `write_app_csv_from_iter` as the headline app output, so a credited measure is an episode row with the app schema's own start, stop, duration and date — not a daily total. Its workflow checkpoint is named `effective_usage`, which is where this class's name comes from.
    The rule that decides which parts of a session earn credit is typed: ScreenGatingRuleId, not prose. Its three values select witnessed screen-ON intervals, demonstrably-alive spans, or (the default) their intersection. The numeric bounds around it — `auto_lock_bridge_seconds`, `credited_session_cap_minutes`, `device_liveness_gap_tolerance_minutes`, `no_witness_min_day_apps` — are ordinary ParameterBindings of the cited ParameterSet.
    NOT asserted as physical truth, and never a replacement for the headline app-usage output, which no value of the gating rule changes. A daily credited total is an aggregation a consumer performs over these rows under a stated DayBoundaryAttributionId and TimezoneNormalizationPolicyId; it is not something this pipeline emits.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    date: Optional[date] = Field(default=None, description="""Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'AppInterruptionSessionRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'KeyboardTransactionRecord',
                       'UsageEpisodeAssertion',
                       'EffectiveUsageMeasure']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionTransactionRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    produced_by: Optional[str] = Field(default=None, description="""The operation execution that produced this measure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    cites_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet under which this measure was produced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    screen_gating_rule: Optional[ScreenGatingRuleId] = Field(default=None, description="""The typed rule that decided which parts of the app session earned credit. Replaces the former free-text coverage_policy, which named a policy vocabulary that never existed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })


class ComplianceDayAssessment(ConfiguredBaseModel):
    """
    One participant-day row of the `compliance_csv` — the compliance measure this engine actually computes. Its slots mirror the CSV columns: the eight-field `ComplianceDayCheckpoint` (pipeline_v2.rs) plus `expected_device_count`, which the writer joins from the enrolled-devices support file at write time; `compliance_threshold_percent` is the scalar input the engine compares against (not a CSV column), and `compliance_value_basis` is this ontology's own name for the imputation distinction, present in no engine output. This term exists because AttributionStatus formerly claimed to BE the compliance denominator contract while nothing described the quantity, its denominator, or its defaults.
    WHAT THE DENOMINATOR ADMITS. `accumulate_minutes` (pipeline_v2_incremental.rs) walks the output rows and adds `duration_minutes` to the day's bucket only when the row's interaction type is App Usage or Non-Target Participant App Usage AND `minimum_duration_aggregate_eligible` is set. Numerator = minutes whose username is neither blank, \"nan\", nor \"None\"; denominator = numerator plus the rest.
    WHAT IT SILENTLY EXCLUDES, in every case without a receipt in this output: (1) Filtered App Usage — excluded packages are RELABELLED rather than deleted, keep their raw evidence, and are then absent from both numerator and denominator, so package-exclusion policy moves this measure; (2) episodes ruled ineligible by the minimum-duration disposition, so a sub-floor episode's minutes are attributed to nobody; (3) any episode whose duration is blank, which contributes 0.0; (4) every non-app row type, including End of Usage Missing — so an episode zeroed by the long-duration cap leaves the denominator entirely. The compliance percent is therefore a share of ADMITTED minutes, never a share of the participant's day.
    THE 100.0 DEFAULT IS AN IMPUTATION. When the participant is not in the device-sharing file, or when the admitted total for the day is zero, the engine writes compliance_percent = 100.0 without measuring anything, and `is_valid` then compares that literal against the threshold like any other value — so an unshared participant and a participant with no qualifying usage both count as valid days. The distinction survives only in `sharing_status` and `zero_real_usage`; compliance_value_basis is this ontology's name for it, so a summary of the percent column can state which rows it measured and which it inherited.
    The participant-day spine is every (participant, date) pair seen on any APP-output row — the screen output is not consulted — including rows contributing no minutes, so a day can appear here with a zero total and a 100.0 percent.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    date: Optional[date] = Field(default=None, description="""Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment']} })
    sharing_status: Optional[DeviceSharingStatus] = Field(default=None, description="""Whether the participant's device is declared shared, as read from the device-sharing support file.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    known_minutes: Optional[float] = Field(default=None, description="""Admitted minutes on this participant-day whose username is a real person (neither blank, \"nan\", nor \"None\"). The compliance numerator.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    unknown_minutes: Optional[float] = Field(default=None, description="""Admitted minutes on this participant-day with no resolved person. In the denominator, never in the numerator, and never dropped.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    compliance_percent: Optional[float] = Field(default=None, description="""known_minutes / (known_minutes + unknown_minutes) as a percentage rounded to two decimals — OR the literal 100.0 imputed for a non-shared participant or a day with no admitted minutes. Always read with compliance_value_basis.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    compliance_value_basis: Optional[ComplianceValueBasis] = Field(default=None, description="""Whether compliance_percent was measured or imputed, and which imputation applied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    zero_eligible_usage: Optional[bool] = Field(default=None, description="""True when no App Usage or Non-Target Participant App Usage row on this participant-day was aggregate-eligible with nonzero minutes, so the share was 0/0. The engine's zero_real_usage column.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    compliance_threshold_percent: Optional[float] = Field(default=None, description="""The percent a day must reach to count as valid. Study-specific; the product default is 70.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    meets_compliance_threshold: Optional[bool] = Field(default=None, description="""compliance_percent >= compliance_threshold_percent. The engine's is_valid column, computed over imputed 100.0 values exactly as over measured ones.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })
    expected_device_count: Optional[int] = Field(default=None, description="""Enrolled device count for the participant, joined from the enrolled-devices support file; blank when the participant is absent from it. Reported alongside the measure, not used in it.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ComplianceDayAssessment']} })


class DayCoverageAssessment(ConfiguredBaseModel):
    """
    One participant-day row of the `day_coverage_csv`: the observability status the engine actually computes, over a spine that is the participant's study window when one is configured and otherwise their first-to-last observed date. Distinct from CoverageAssessment, which models a cause attribution this pipeline does not make (see CoverageCause).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    date: Optional[date] = Field(default=None, description="""Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment']} })
    day_coverage_status: Optional[DayCoverageStatus] = Field(default=None, description="""Observability status for this participant-day.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DayCoverageAssessment']} })


class CoverageAssessment(ConfiguredBaseModel):
    """
    A coverage/observability judgement over a stream window: expected vs actual data availability, its threshold, bounding events, and best-supported cause. A gap MAY CONCEAL usage — this asserts only how the measurement policy treats the interval, never that the device was inactive.
    DESIGN-TIME ONLY, like the CoverageCause it carries: no kernel path emits an expectation, an availability threshold, a policy treatment, or a cause. The coverage judgement this engine ships is the per-day DayCoverageAssessment. Keep the two apart when reading an instance graph — this class describes a window-level cause attribution that is available to an author, not a reading of pipeline output.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    assesses_interval: Optional[UsageInterval] = Field(default=None, description="""The stream window assessed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'InteractionTraceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'ComplianceDayAssessment',
                       'DayCoverageAssessment',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'CoverageAssessment']} })
    expected_available: Optional[bool] = Field(default=None, description="""Whether data was expected to be available (needs a heartbeat/expectation to assert NoData).""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    actually_available: Optional[bool] = Field(default=None, description="""Whether any data was actually present.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    availability_threshold: Optional[float] = Field(default=None, description="""Coverage threshold applied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    coverage_cause: Optional[CoverageCause] = Field(default=None, description="""Best-supported cause.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    policy_treatment: Optional[str] = Field(default=None, description="""How the measurement policy treats this interval (e.g. pass / na / exclude).""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })


class AttributionAssertion(ConfiguredBaseModel):
    """
    Attribution of usage to a person. Exactly one status is required; an actual person is attached only when known. The participant-device-day denominator must satisfy duration conservation: target + known_non_target + unresolved = eligible.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    attribution_status: AttributionStatus = Field(default=..., description="""Required attribution status.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })
    attributed_person: Optional[str] = Field(default=None, description="""The actual person, attached only when known.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })
    on_shared_device: Optional[bool] = Field(default=None, description="""Whether the device is shared.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })


class WorkflowPlan(ConfiguredBaseModel):
    """
    The prospective processing workflow. A p-plan:Plan / prov:Plan.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['pplan:Plan'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'tree_root': True})

    plan_id: str = Field(default=..., description="""Plan identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['WorkflowPlan']} })
    operations: Optional[list[OperationDefinition]] = Field(default=None, description="""Semantic operations in the workflow.""", json_schema_extra = { "linkml_meta": {'domain_of': ['WorkflowPlan']} })
    queries: Optional[list[QueryDefinition]] = Field(default=None, description="""Physical queries in the workflow.""", json_schema_extra = { "linkml_meta": {'domain_of': ['WorkflowPlan']} })


class OperationDefinition(ConfiguredBaseModel):
    """
    One semantic operation in the workflow at any useful scale. Operations compose recursively via part_of_operation so a coarse responsibility and its independently invalidatable transformations share one model without forcing presentation and execution boundaries to coincide.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['pplan:Step'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    operation_id: str = Field(default=..., description="""Stable semantic operation identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    verb: Optional[str] = Field(default=None, description="""Action the operation performs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    engine: Optional[str] = Field(default=None, description="""Named algorithm or engine the operation realizes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    operation_role: Optional[str] = Field(default=None, description="""Semantic responsibility of the operation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    epistemic_role: Optional[str] = Field(default=None, description="""Whether the operation observes, infers, applies policy, or presents.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    consumes: Optional[list[str]] = Field(default=None, description="""Channels or inputs the operation reads.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    produces: Optional[list[str]] = Field(default=None, description="""Channels or outputs the operation produces.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    depends_on: Optional[list[str]] = Field(default=None, description="""Operations that must precede this one.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    configuration_dependencies: Optional[list[str]] = Field(default=None, description="""Direct configuration fields read by this operation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    data_effects: Optional[list[str]] = Field(default=None, description="""Declared effects such as preserve, drop, split, classify, or encode.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    is_fatal: Optional[bool] = Field(default=None, description="""Whether a failure fails the whole workflow.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    part_of_operation: Optional[str] = Field(default=None, description="""The coarser semantic operation this operation is a proper part of. Referenced by operation_id, not inlined.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition'], 'slot_uri': 'dcterms:isPartOf'} })
    group_scope_operation_ids: Optional[list[str]] = Field(default=None, description="""Upstream operations defining enclosing partitions for a group-to-subset rule; may be transitive rather than direct dependencies. Does not establish exact group construction, ordering, ties, row lineage or execution. Source assertions remain linked through configuration_dependencies.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    grouping_basis: Optional[GroupedRecordGroupingBasisId] = Field(default=None, description="""Whether groups are declared or constructed by field equality or ordered raw string concatenation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    equality_key_setting_ids: Optional[list[str]] = Field(default=None, description="""Profile-local source field assertions compared for equality inside the enclosing partition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    concatenated_key_setting_ids: Optional[list[str]] = Field(default=None, description="""Ordered profile-local source field assertions concatenated without separator when grouping_basis is raw_string_concatenation. This is a sequence, not a conjunctive equality-field set; repeated operands remain meaningful.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition'],
         'list_elements_ordered': True,
         'list_elements_unique': False} })
    empty_if_absent_key_setting_ids: Optional[list[str]] = Field(default=None, description="""Subset of concatenated key operands whose absent fields contribute an empty string. Does not replace explicit null or coerce a non-string value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    selection_rule: Optional[GroupedRecordSelectionRuleId] = Field(default=None, description="""Source-declared group member disposition, independent of the unrecovered ordering or marker implementation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    required_event_payload_roles: Optional[list[InteractionEventPayloadRoleId]] = Field(default=None, description="""Payloads required together within each interaction-event record produced by this operation. These are event composition, not unrelated output channels or literal serialized field names. Does not establish instance identities.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    optional_event_payload_roles: Optional[list[InteractionEventPayloadRoleId]] = Field(default=None, description="""Payloads that may be absent from the produced interaction-event record, disjoint from its required payloads.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    event_payload_association: Optional[InteractionEventPayloadAssociationId] = Field(default=None, description="""Direction and source-declared association of payloads within one interaction event; no undisclosed temporal predicate is implied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    missing_gesture_marks_incomplete: Optional[bool] = Field(default=None, description="""Whether absence of gesture metadata marks the event incomplete, independently of the captured screenshot and hierarchy.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    gesture_presence_implies_correctness: Optional[bool] = Field(default=None, description="""Whether gesture presence alone establishes correctness. False means presence is insufficient evidence, not that every gesture is wrong. Completeness and correctness remain independent; no particular instance is assessed here.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    sequence_encoding_rule: Optional[SequenceEncodingRuleId] = Field(default=None, description="""Closed encoding rule applied to every ordered occurrence within each declared partition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    sequence_scope_operation_ids: Optional[list[str]] = Field(default=None, description="""Upstream operations defining the partitions at which sequence history resets; not a global history or an invented raw pairing algorithm.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    sequence_identity_setting_ids: Optional[list[str]] = Field(default=None, description="""Profile-local source assertions identifying what is compared with earlier occurrences within a partition; undisclosed raw comparison fields remain unknown.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    sequence_first_symbol_setting_id: Optional[str] = Field(default=None, description="""Profile-local source assertion of the literal symbol emitted for a first occurrence in the partition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })
    sequence_repeat_symbol_setting_id: Optional[str] = Field(default=None, description="""Profile-local source assertion of the literal symbol emitted for an identity previously encountered in the partition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationDefinition']} })


class OperationExecution(ConfiguredBaseModel):
    """
    A retrospective execution of an OperationDefinition. A prov:Activity.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Activity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    execution_id: str = Field(default=..., description="""Stable workflow-execution identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution']} })
    executes_operation: Optional[str] = Field(default=None, description="""The OperationDefinition this execution realizes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution']} })
    used_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet the execution used.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution',
                       'QueryExecution',
                       'ReconstructionExecution']} })
    started_at: Optional[str] = Field(default=None, description="""Execution start.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution']} })
    ended_at: Optional[str] = Field(default=None, description="""Execution end.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution']} })


class QueryDefinition(ConfiguredBaseModel):
    """
    One physical computation and memoization boundary. Its realizes_operations links are prospective mappings and do not imply that those semantic operations were applied in a particular run.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['pplan:Step'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    query_id: str = Field(default=..., description="""Stable physical-query identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })
    query_group_id: str = Field(default=..., description="""Presentation-only query-group identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })
    query_dependencies: Optional[list[str]] = Field(default=None, description="""Direct upstream physical queries.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })
    realizes_operations: Optional[list[str]] = Field(default=None, description="""Semantic operations this query may realize.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })
    query_outputs: Optional[list[str]] = Field(default=None, description="""Independently identified output artifacts or ports.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })
    query_request_fields: Optional[list[str]] = Field(default=None, description="""Exact request fields read by the query.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryDefinition']} })


class QueryExecution(ConfiguredBaseModel):
    """
    Retrospective evidence for one physical query. Kept distinct from OperationExecution because a fused query can realize several semantic operations with different applicability.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Activity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    executes_query: str = Field(default=..., description="""The QueryDefinition this execution realizes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution']} })
    used_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet the execution used.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution',
                       'QueryExecution',
                       'ReconstructionExecution']} })
    query_execution_status: QueryExecutionStatus = Field(default=..., description="""Observed physical execution state.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution']} })
    query_input_key: str = Field(default=..., description="""Content identity of the query's exact effective inputs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution']} })
    query_output_digest: str = Field(default=..., description="""Content identity of the query output.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution']} })
    query_reason_id: str = Field(default=..., description="""Stable identity of the evidence supporting the state.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution']} })
    part_of_execution: str = Field(default=..., description="""Root workflow execution containing this query execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution'], 'slot_uri': 'dcterms:isPartOf'} })
    execution_started_at: datetime  = Field(default=..., description="""Evidence timestamp for the query execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution'], 'slot_uri': 'prov:startedAtTime'} })
    execution_ended_at: datetime  = Field(default=..., description="""Evidence timestamp for the query execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['QueryExecution'], 'slot_uri': 'prov:endedAtTime'} })


class ReconstructionExecution(ConfiguredBaseModel):
    """
    The execution that produced a usage assertion. A prov:Activity.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Activity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    follows_strategy: Optional[str] = Field(default=None, description="""The reconstruction strategy followed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionExecution']} })
    used_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet the execution used.""", json_schema_extra = { "linkml_meta": {'domain_of': ['OperationExecution',
                       'QueryExecution',
                       'ReconstructionExecution']} })


class ReconstructionStrategy(ConfiguredBaseModel):
    """
    A named, versioned episode-reconstruction algorithm (semantic category + canonical IRI). Subclass only where formal restrictions genuinely differ.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['sosa:Procedure'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    strategy_id: str = Field(default=..., description="""Strategy identifier (unique key).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    strategy_kind: Optional[ReconstructionStrategyId] = Field(default=None, description="""Canonical strategy category (IRI-bearing enum value).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    strategy_version: Optional[str] = Field(default=None, description="""Strategy version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    canonical_iri: Optional[str] = Field(default=None, description="""Canonical IRI carried by the runtime enum.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })


class ParameterSet(ConfiguredBaseModel):
    """
    A content-addressed configuration entity — a set of ParameterBindings over the plan's variables. NOT a Plan: the plan is the workflow; this binds its variables.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    parameter_set_sha256: Optional[str] = Field(default=None, description="""Content-addressed hash of the canonical parameter set.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterSet']} })
    bindings: Optional[list[ParameterBinding]] = Field(default=None, description="""Knob=value bindings.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterSet']} })


class ParameterBinding(ConfiguredBaseModel):
    """
    One knob = value binding within a ParameterSet: a key and its canonical JSON value, and nothing else.
    THIS IS FLAT AND UNTYPED, DELIBERATELY AND COMPLETELY. The runtime provenance builder (`workflow_provenance.rs`) emits one of these nodes per entry of the request's parameter object with only `chron:knob_key` and `chron:knob_value`. No binding declares what kind of consequence its knob has, and that is true of the named research axes as well: selecting `zerrer_60s` reaches the sidecar as the string pair (\"session_grouping_policy\", \"zerrer_60s\"), carrying no link to SessionGroupingPolicyId. A reader recovers axis identity by matching knob_key against the option slots that carry a `research_axis_enum` annotation in `chronicle-local-contract.linkml.yaml`, and recovers nothing for the rest.
    THE SHAPE OF WHAT IS LEFT OVER. Some keys the contract classifies as computational (`COMPUTATIONAL_BROWSER_OPTION_KEYS`) carry a `research_axis_enum`; `timezone_handling`, via `research_ontology_enum`, also binds an ontology enum. The remaining computational keys have no term here at all. That set is not a residue of presentation knobs — it includes keys that change measured quantities: `use_app_codebook` (DEFAULT ON) RESTATES WHAT EACH ROW'S APP IS — `join_codebook` attaches a second, codebook-sourced identity (`application_label` arrives as `codebook_application_label` beside the row's own label) and the whole category/genre block, then `derive_broad_category` and `collapse_app_genre` write the row's reported broad category and `genre_id_scraped`, each defaulting to \"Unknown\" when the codebook offers nothing. The package key is untouched, but every category-level analysis of the output is a reading of the codebook rather than of the device; `proximity_interval_seconds` MOVES EPISODE BOUNDARIES by treating an Activity Stopped within its grace as an intra-app teardown rather than a close; `timezone_handling` can delete rows outright (see TimezoneNormalizationPolicyId, the one such key this ontology now names); `interaction_type_remap` rewrites the event vocabulary at ingest, BEFORE reconstruction sees it, while `interaction_types_to_remove` deletes output rows AFTER it — two knobs that read alike and sit on opposite sides of the reconstruction; `long_duration_threshold_hours` decides which episodes surface as End of Usage Missing; `minimum_usage_duration` blanks durations; `model_concurrent_usage` splits overlapping episodes.
    WHY THEY STAY UNTYPED, rather than each becoming an axis. Every named axis in this ontology is an enumerated PUBLISHED-METHOD vocabulary whose values are alternatives a study could have chosen and a paper can be cited for. A continuous grace in seconds, a float threshold, or a boolean has no such value set; minting one would mean inventing permissible values no source declares, which is the failure mode the EventRetentionSetId provenance warning already guards against. `proximity_interval_seconds` is the clearest case: the kernel implements exactly one proximity rule with a numeric grace, so there is no vocabulary to name, and calling it an axis would assert a choice between methods that does not exist. These keys are declared and described in the local contract instead, which is where a non-vocabulary parameter belongs.
    Two consequences a consumer must not overlook. A ParameterSet digest is identical whether a knob was set deliberately or left at its default, so the sidecar answers \"what ran\" and never \"what was chosen\". And two knob keys with equal consequence — one an axis, one not — are indistinguishable here, so a provenance graph must not be read as ranking them.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    knob_key: Optional[str] = Field(default=None, description="""Option/knob key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterBinding']} })
    knob_value: Optional[str] = Field(default=None, description="""Bound value (canonical JSON string).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterBinding']} })


class StudyMethodProfile(ConfiguredBaseModel):
    """
    A versioned, source-located account of one retained method from acquisition through release. A profile is not runnable while any applicable setting is unresolved; semantic coverage never implies executable support.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Plan'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_profile_id: str = Field(default=..., description="""Stable identifier for the versioned method profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    source_method_variant_id: str = Field(default=..., description="""Stable identity of the exact cohort, platform, protocol version, branch, or multiverse configuration represented by this profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'DiaryReplicationBinding']} })
    source_method_variant_label: Optional[str] = Field(default=None, description="""Source-facing label for this exact method variant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    source_method_cohort: Optional[str] = Field(default=None, description="""Cohort or population slice to which this exact method variant applies.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    source_method_platform: Optional[str] = Field(default=None, description="""Platform or device slice to which this exact method variant applies.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    source_method_branch: Optional[str] = Field(default=None, description="""Source-declared analysis, sensitivity, ablation, or protocol branch represented by this profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_configuration_structure: MethodConfigurationStructureId = Field(default=..., description="""Relationship among this source's method specifications; never infer unreported cross-products.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'MethodConfigurationSpace']} })
    method_configuration_space: Optional[MethodConfigurationSpace] = Field(default=None, description="""Complete source-declared configuration space for this method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_configuration_selection: Optional[MethodConfigurationSelection] = Field(default=None, description="""Exact selected source levels for one executable method variant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_profile_version: str = Field(default=..., description="""Version of this source-to-method interpretation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_settings: Optional[list[MethodSettingAssertion]] = Field(default=None, description="""Source-supported settings in this profile or subprotocol.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'DiaryProtocol']} })
    method_setting_ids: Optional[list[str]] = Field(default=None, description="""Ordered inventory of embedded method-setting identities for round-trip validation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_setting_count: Optional[int] = Field(default=None, description="""Number of embedded method settings; must equal the inventory and object count.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    method_operations: Optional[list[OperationDefinition]] = Field(default=None, description="""Prospective operations needed to reproduce the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    acquisition_protocols: Optional[list[AcquisitionProtocol]] = Field(default=None, description="""Observation protocols used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    session_construction_policies: Optional[list[SessionConstructionPolicy]] = Field(default=None, description="""Target-typed session construction policies used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    notification_attribution_policies: Optional[list[NotificationAttributionPolicy]] = Field(default=None, description="""Notification-to-behavior attribution policies used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    duration_policies: Optional[list[DurationPolicy]] = Field(default=None, description="""Target-typed duration rules used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    timestamp_policies: Optional[list[TimestampPolicy]] = Field(default=None, description="""Timestamp fidelity and ordering policies used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    parameter_provenance_assertions: Optional[list[ParameterProvenanceAssertion]] = Field(default=None, description="""Documentary and derivation provenance for method parameters.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    source_artifact_provenance_assertions: Optional[list[SourceArtifactProvenanceAssertion]] = Field(default=None, description="""Exact content-bound source-artifact documentary assertions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    protocol_materialization_blockers: Optional[list[ProtocolMaterializationBlocker]] = Field(default=None, description="""Explicit missing-field or shape blockers for protocol fragments.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    diary_protocols: Optional[list[DiaryProtocol]] = Field(default=None, description="""Diary instruments and schedules used by the method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    diary_replication_bindings: Optional[list[DiaryReplicationBinding]] = Field(default=None, description="""Content-bound diary version and released-layout selections validated without claiming full protocol execution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    release_profiles: Optional[list[MeasurementReleaseProfile]] = Field(default=None, description="""Collected-signal to released-measure provenance.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile']} })
    profile_implementation_status: MethodProfileExecutionStatusId = Field(default=..., description="""Whole-profile execution status; executable requires every replication gate to pass.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'DiaryReplicationBinding']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodSettingAssertion(ConfiguredBaseModel):
    """
    One source-supported decision in a StudyMethodProfile. This is richer than runtime ParameterBinding: it preserves semantic role, target, value shape, evidence, and implementation binding before a runnable subset compiles to flat knob/value pairs.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'broad_mappings': ['prov:Entity'],
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_setting_id: str = Field(default=..., description="""Stable identity of one source-supported setting assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion',
                       'DiaryReplicationBinding']} })
    source_extraction_id: str = Field(default=..., description="""Evidence-row identity from which this atomic setting was derived.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    rubric_component_id: Optional[str] = Field(default=None, description="""Stable C01-C21 measurement-component identifier when applicable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_setting_role: MethodSettingRoleId = Field(default=..., description="""Functional role of the setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_target_layer: Optional[MethodTargetLayerId] = Field(default=None, description="""Layer affected by the setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_parameter_key: Optional[str] = Field(default=None, description="""Source or canonical parameter name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'ParameterProvenanceAssertion']} })
    method_value_kind: MethodValueKindId = Field(default=..., description="""Serialization shape of method_value_json.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_value_json: Optional[str] = Field(default=None, description="""Canonical JSON serialization of the complete source-declared value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_unit: Optional[str] = Field(default=None, description="""Unit attached to the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'DurationPolicy', 'DiaryItem']} })
    method_comparator: Optional[str] = Field(default=None, description="""Boundary comparator such as less-than, at-most, or inclusive-between.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'NotificationAttributionPolicy',
                       'DurationPolicy']} })
    method_boundary_convention: Optional[str] = Field(default=None, description="""Inclusivity, clipping, ordering, or calendar convention required to interpret the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_applicability_status: MethodApplicabilityStatusId = Field(default=..., description="""Whether this setting is required for this profile, separately from disclosure quality.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_disclosure_status: MethodDisclosureStatusId = Field(default=..., description="""What the reviewed source disclosed for this setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    mapped_ontology_term: Optional[list[str]] = Field(default=None, description="""Existing ontology term used by the setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    mapped_contract_slot: Optional[list[str]] = Field(default=None, description="""Generated runtime-contract slot used when natively executable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    contract_bindings: Optional[list[MethodContractBinding]] = Field(default=None, description="""Exact runtime slot/value bindings authorized by this setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    chronicle_output_kind: Optional[str] = Field(default=None, description="""Exact Chronicle output artifact kind containing the source-declared output field.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    chronicle_output_column: Optional[str] = Field(default=None, description="""Exact Chronicle output column corresponding to the source-declared output field.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_output_position: Optional[int] = Field(default=None, description="""Zero-based position of this field in the source-declared output tuple.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_implementation_status: MethodImplementationStatusId = Field(default=..., description="""Execution support for this exact setting, never inferred from semantic mapping alone.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_execution_route: Optional[MethodExecutionRouteId] = Field(default=None, description="""Exact replication destination assigned to this setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_execution_destination_id: Optional[str] = Field(default=None, description="""Registered operation, protocol adapter, external executor, or receipt destination identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_execution_parameter_path: Optional[str] = Field(default=None, description="""Exact parameter or input path within the destination contract.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_execution_blocker_code: Optional[str] = Field(default=None, description="""Current fail-closed reason preventing this route from executing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    executor_id: Optional[str] = Field(default=None, description="""Stable native or external executor identity when one exists.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    required_inputs: Optional[list[str]] = Field(default=None, description="""Inputs whose exact identities or schemas are required by this setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    source_evidence_work_id: Optional[str] = Field(default=None, description="""Canonical identity of the exact source supplying the evidence when it differs from the reviewed work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_component_id: Optional[str] = Field(default=None, description="""Source extraction component or auxiliary axis identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_observed_setting: Optional[str] = Field(default=None, description="""Source-located statement from which this atomic setting was extracted.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_value_json: Optional[str] = Field(default=None, description="""Canonical JSON serialization of the complete pre-atomization source value for reversible audit.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_coverage_status: Optional[str] = Field(default=None, description="""Source-ledger coverage status preserved independently from applicability and implementation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_ids: Optional[list[str]] = Field(default=None, description="""Stable clause identities within the source extraction that this atomic setting accounts for.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_label: Optional[str] = Field(default=None, description="""Human-readable label for the accounted source clause.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_text: Optional[str] = Field(default=None, description="""Exact extracted clause text represented by this atomic setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_path: Optional[str] = Field(default=None, description="""Stable structural path of the clause within the source extraction.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_start: Optional[int] = Field(default=None, description="""Start offset of the clause within the preserved source value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_clause_end: Optional[int] = Field(default=None, description="""End offset of the clause within the preserved source value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    source_value_sha256: Optional[str] = Field(default=None, description="""SHA-256 identity of the complete preserved source value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    method_variant_group_id: Optional[str] = Field(default=None, description="""Stable identity of a source-declared alternative, joint specification, conditional branch set, or multiverse group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_variant_relation: Optional[str] = Field(default=None, description="""Source-declared relationship among members of the method variant group; kept verbatim until profile partitioning adjudicates it.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_variant_branch_id: Optional[str] = Field(default=None, description="""Stable branch identity within the method variant group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_variant_branch_label: Optional[str] = Field(default=None, description="""Source-facing label for this branch or member.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    method_configuration_json: Optional[str] = Field(default=None, description="""Canonical JSON preserving the complete source-declared atomic, joint, variant, or multiverse configuration structure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    structured_protocol_candidate_json: Optional[str] = Field(default=None, description="""Canonical JSON preserving an evidence-derived candidate for a first-class acquisition, diary, session, duration, timestamp, release, or notification protocol object.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    evidence_layer: Optional[str] = Field(default=None, description="""Source evidence layer used for this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    ontology_mapping_note: Optional[str] = Field(default=None, description="""Preserved source-to-ontology mapping note.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    gap_assessment: Optional[str] = Field(default=None, description="""Preserved assessment of any semantic or execution gap.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    integration_source: Optional[str] = Field(default=None, description="""Corpus wave or integration source that supplied the evidence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    adjudication_confidence: Optional[float] = Field(default=None, description="""Bounded confidence in the structured adjudication.""", ge=0, le=1, json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    adjudication_rationale: Optional[str] = Field(default=None, description="""Evidence-bound rationale for implementation and binding status.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion']} })
    conformance_fixture_id: Optional[str] = Field(default=None, description="""Stable identity of the source or source-derived fixture proving this exact executor binding.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    conformance_result_digest: Optional[str] = Field(default=None, description="""Content digest of the passing conformance result for this exact setting and executor value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodContractBinding(ConfiguredBaseModel):
    """
    One exact compilation target for a method setting. It binds one generated runtime slot to one canonical JSON value. Candidate semantic mappings stay in mapped_contract_slot; only this class authorizes compilation.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    contract_slot: str = Field(default=..., description="""Exact generated runtime-contract slot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodContractBinding']} })
    contract_value_json: str = Field(default=..., description="""Canonical JSON value supplied to the runtime slot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodContractBinding']} })


class LiteratureInputAdapterContract(ConfiguredBaseModel):
    """
    A closed, versioned registration that promotes source-backed method settings only when an existing Chronicle upload role can carry the observations and a named Rust adapter validates or transforms them. The setting inventory is exact: unregistered settings remain blocked and no missing values are synthesized.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    literature_input_semantic_type: str = Field(default=..., description="""Audited semantic input artifact group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_adapter_id: str = Field(default=..., description="""Registered Rust input adapter identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_adapter_version: str = Field(default=..., description="""Exact adapter version committed to execution receipts.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_route_kind: MethodExecutionRouteId = Field(default=..., description="""Protocol-input or native-operator route used by the adapter.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_role: str = Field(default=..., description="""Existing raw or support-file role consumed by the adapter.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_schema_id: str = Field(default=..., description="""Closed schema identity validated at ingestion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_required_fields: list[str] = Field(default=..., description="""Exact raw or support fields required for conformance.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_gui_surface: str = Field(default=..., description="""Existing schema-driven upload surface that supplies this role.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })
    literature_input_method_setting_ids: list[str] = Field(default=..., description="""Exact promoted method-setting inventory for this adapter registration.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LiteratureInputAdapterContract']} })


class ProtocolMaterializationBlocker(ConfiguredBaseModel):
    """
    One source-grounded reason a typed protocol fragment is partial or withheld. The canonical setting remains authoritative; this object prevents the missing protocol field from disappearing at profile assembly.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    protocol_materialization_blocker_id: str = Field(default=..., description="""Stable identity of one protocol materialization blocker.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_materialization_id: str = Field(default=..., description="""Stable identity of the protocol fragment this blocker concerns.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_ontology_class: str = Field(default=..., description="""Intended typed ontology class for the protocol fragment.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_profile_slot: str = Field(default=..., description="""StudyMethodProfile slot to which the fragment belongs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_object_attached: bool = Field(default=..., description="""Whether the partial but shape-conformant protocol object is attached to its typed slot.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_blocker_code: str = Field(default=..., description="""Stable missing-field or materialization blocker code.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_blocker_field: Optional[str] = Field(default=None, description="""Protocol field affected by the blocker.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    protocol_blocker_reason: str = Field(default=..., description="""Source-grounded reason the field could not be populated.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    blocked_method_setting_ids: list[str] = Field(default=..., description="""Canonical method settings supporting or affected by this blocker.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    partial_protocol_object_json: Optional[str] = Field(default=None, description="""Canonical JSON of a withheld shape-invalid protocol fragment.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ProtocolMaterializationBlocker']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodConfigurationSpace(ConfiguredBaseModel):
    """
    The complete source-declared choice space for one retained method. Levels and combinations are explicit; absence of an allowed combination forbids inventing a Cartesian product.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_configuration_space_id: str = Field(default=..., description="""Stable identity of a source method's configuration space.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace']} })
    method_configuration_structure: MethodConfigurationStructureId = Field(default=..., description="""Relationship among this source's method specifications; never infer unreported cross-products.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'MethodConfigurationSpace']} })
    invariant_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings that apply to every selectable configuration in this space.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace']} })
    method_configuration_groups: Optional[list[MethodConfigurationGroup]] = Field(default=None, description="""Source-declared configuration groups; group relationships do not imply a cross-product.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace']} })
    allowed_method_combinations: Optional[list[MethodConfigurationCombination]] = Field(default=None, description="""Only combinations explicitly enumerated by the source.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace']} })
    documentary_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Source statements retained for audit but not treated as selectable method values.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    not_applicable_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings explicitly reported as not applicable to this source method.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace']} })
    unresolved_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Evidence-blocked settings preventing complete configuration selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodConfigurationGroup(ConfiguredBaseModel):
    """
    One source-declared fixed, alternative, conditional, sensitivity, ablation, or multiverse group.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_configuration_group_id: str = Field(default=..., description="""Stable identity of one source configuration group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    method_configuration_group_kind: str = Field(default=..., description="""Source-grounded group kind such as fixed set, sensitivity axis, ablation, or conditional state machine.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    method_configuration_axis: Optional[list[str]] = Field(default=None, description="""Source-declared axes varied by this group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    method_selection_semantics: str = Field(default=..., description="""Whether levels are jointly applied, independently selectable, conditional, documentary, or evidence-blocked.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    method_cross_product_policy: str = Field(default=..., description="""Explicit rule prohibiting or enumerating combinations with other groups.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    method_configuration_levels: Optional[list[MethodConfigurationLevel]] = Field(default=None, description="""Exact source-declared levels or branches in this group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationGroup']} })
    documentary_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Source statements retained for audit but not treated as selectable method values.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    unresolved_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Evidence-blocked settings preventing complete configuration selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodConfigurationLevel(ConfiguredBaseModel):
    """
    One exact source-declared level or branch and its setting membership.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_configuration_level_id: str = Field(default=..., description="""Stable identity of one source-declared configuration level.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel']} })
    method_configuration_level_label: str = Field(default=..., description="""Source-facing label for the level.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel']} })
    included_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings selected by this level or explicit combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel', 'MethodConfigurationCombination']} })
    excluded_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Alternative settings explicitly excluded by this level.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel']} })
    common_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings shared by every level in this group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel']} })
    branch_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings specific to this level or branch.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel']} })
    documentary_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Source statements retained for audit but not treated as selectable method values.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    unresolved_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Evidence-blocked settings preventing complete configuration selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodConfigurationCombination(ConfiguredBaseModel):
    """
    One combination explicitly enumerated by the source; never inferred from independent levels.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_configuration_combination_id: str = Field(default=..., description="""Stable identity of one source-enumerated combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationCombination']} })
    method_configuration_combination_label: str = Field(default=..., description="""Source-facing label for the combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationCombination']} })
    selected_method_configuration_level_ids: list[str] = Field(default=..., description="""Exact levels included in this source-enumerated combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationCombination',
                       'MethodConfigurationSelection']} })
    included_method_setting_ids: Optional[list[str]] = Field(default=None, description="""Settings selected by this level or explicit combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationLevel', 'MethodConfigurationCombination']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class MethodConfigurationSelection(ConfiguredBaseModel):
    """
    One exact selection from a source-declared configuration space.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_configuration_selection_id: str = Field(default=..., description="""Stable identity of one exact source configuration selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSelection']} })
    method_configuration_space_reference: str = Field(default=..., description="""Configuration-space identity from which this selection was made.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSelection']} })
    selected_method_configuration_level_ids: list[str] = Field(default=..., description="""Exact levels included in this source-enumerated combination.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationCombination',
                       'MethodConfigurationSelection']} })
    effective_method_setting_ids: list[str] = Field(default=..., description="""Exact setting inventory active under this selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSelection']} })
    method_configuration_selection_status: MethodConfigurationSelectionStatusId = Field(default=..., description="""Exactness and source authorization state of the selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSelection']} })
    method_configuration_selection_blockers: Optional[list[str]] = Field(default=None, description="""Fail-closed reasons preventing an exact selection.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodConfigurationSelection']} })


class AcquisitionProtocol(ConfiguredBaseModel):
    """
    Actual observation semantics, distinct from selecting events after collection. Cadence, lookback, cursoring, overlap, persistence, and failure behavior can each change which occurrences are observable.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    acquisition_protocol_id: str = Field(default=..., description="""Stable acquisition-protocol identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    collector: Optional[str] = Field(default=None, description="""Collector, framework, application, or instrument.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    api_and_version: Optional[str] = Field(default=None, description="""Acquisition API and applicable version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    observation_mode: Optional[str] = Field(default=None, description="""Callback, broadcast, fixed-cadence poll, retrospective query, snapshot, or aggregate mode.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    requested_cadence: Optional[str] = Field(default=None, description="""Requested observation or prompt cadence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol', 'DiaryScheduleRule']} })
    realized_cadence_and_jitter: Optional[str] = Field(default=None, description="""Observed cadence and jitter, kept distinct from the request.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    query_bounds: Optional[str] = Field(default=None, description="""Query interval and bound inclusivity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    lookback: Optional[str] = Field(default=None, description="""Retrospective lookback rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationEvidenceRecord', 'AcquisitionProtocol']} })
    backfill: Optional[str] = Field(default=None, description="""Historical backfill rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    cursor_policy: Optional[str] = Field(default=None, description="""Cursor advancement and resume rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    overlap_policy: Optional[str] = Field(default=None, description="""Overlap between acquisition windows.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    acquisition_deduplication: Optional[str] = Field(default=None, description="""Identity and disposition for repeated acquired observations.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol', 'TimestampPolicy']} })
    occurrence_timestamp_semantics: Optional[str] = Field(default=None, description="""Meaning and source of occurrence time.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    processing_timestamp_semantics: Optional[str] = Field(default=None, description="""Meaning and source of collection or processing time.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    initial_sample_policy: Optional[str] = Field(default=None, description="""Treatment of the first observation in a run or window.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    terminal_sample_policy: Optional[str] = Field(default=None, description="""Treatment of the last or incomplete observation in a run or window.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    persistence_policy: Optional[str] = Field(default=None, description="""On-device or intermediate persistence behavior.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    upload_policy: Optional[str] = Field(default=None, description="""Upload trigger, batching, retry, and transport behavior.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    restart_behavior: Optional[str] = Field(default=None, description="""Behavior across collector or device restart.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    doze_behavior: Optional[str] = Field(default=None, description="""Behavior under Android doze or battery restrictions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    permission_loss_behavior: Optional[str] = Field(default=None, description="""Behavior and provenance when required permission is absent or revoked.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol']} })
    method_settings: Optional[list[MethodSettingAssertion]] = Field(default=None, description="""Source-supported settings in this profile or subprotocol.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'DiaryProtocol']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SessionConstructionPolicy(ConfiguredBaseModel):
    """
    A target-typed session constructor. App sessions, screen bouts, device sessions, pickup activations, and runs of polled samples are not aliases.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    session_construction_policy_id: str = Field(default=..., description="""Stable target-typed session-construction identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionConstructionPolicy']} })
    session_input_layer: MethodTargetLayerId = Field(default=..., description="""Layer consumed by the constructor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionConstructionPolicy']} })
    session_output_layer: MethodTargetLayerId = Field(default=..., description="""Layer asserted by the constructor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionConstructionPolicy']} })
    reconstruction_strategy: Optional[str] = Field(default=None, description="""Named reconstruction strategy used by the constructor.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SessionConstructionPolicy']} })
    method_settings: Optional[list[MethodSettingAssertion]] = Field(default=None, description="""Source-supported settings in this profile or subprotocol.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'DiaryProtocol']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class NotificationAttributionPolicy(ConfiguredBaseModel):
    """
    A policy relating notification evidence to behavior or artifact disposition, distinct from generic foreground/background attribution.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    notification_attribution_policy_id: str = Field(default=..., description="""Stable notification-attribution policy identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_target_behavior: Optional[str] = Field(default=None, description="""Behavior attributed to notification evidence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_evidence_mode: Optional[str] = Field(default=None, description="""Observed or inferred notification evidence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_temporal_direction: Optional[str] = Field(default=None, description="""Whether evidence precedes, follows, or brackets behavior.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_window: Optional[str] = Field(default=None, description="""Attribution window.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    method_comparator: Optional[str] = Field(default=None, description="""Boundary comparator such as less-than, at-most, or inclusive-between.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'NotificationAttributionPolicy',
                       'DurationPolicy']} })
    notification_package_scope: Optional[str] = Field(default=None, description="""Package identity or matching scope.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_attribution_confidence: Optional[str] = Field(default=None, description="""Confidence or evidence strength.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    notification_disposition: Optional[str] = Field(default=None, description="""Retain, relabel, remove, flag, or other resulting action.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NotificationAttributionPolicy']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DurationPolicy(ConfiguredBaseModel):
    """
    A duration rule with an explicit target layer. Equal thresholds applied to an app episode, screen bout, device session, pickup, polled run, or daily aggregate are different methods.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    duration_policy_id: str = Field(default=..., description="""Stable target-typed duration-policy identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DurationPolicy']} })
    method_target_layer: Optional[MethodTargetLayerId] = Field(default=None, description="""Layer affected by the setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_comparator: Optional[str] = Field(default=None, description="""Boundary comparator such as less-than, at-most, or inclusive-between.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'NotificationAttributionPolicy',
                       'DurationPolicy']} })
    method_value_json: Optional[str] = Field(default=None, description="""Canonical JSON serialization of the complete source-declared value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_unit: Optional[str] = Field(default=None, description="""Unit attached to the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'DurationPolicy', 'DiaryItem']} })
    duration_action: Optional[str] = Field(default=None, description="""Action on values meeting the duration condition.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DurationPolicy']} })
    method_boundary_convention: Optional[str] = Field(default=None, description="""Inclusivity, clipping, ordering, or calendar convention required to interpret the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class TimestampPolicy(ConfiguredBaseModel):
    """
    Timestamp fidelity, ordering, multiplicity, and synthetic-order provenance. Original and effective time remain separate.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    timestamp_policy_id: str = Field(default=..., description="""Stable timestamp-policy identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    original_timestamp_semantics: Optional[str] = Field(default=None, description="""Preserved source timestamp meaning and representation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    effective_timestamp_semantics: Optional[str] = Field(default=None, description="""Timestamp used by later operations after correction or normalization.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    timestamp_resolution: Optional[str] = Field(default=None, description="""Source or effective timestamp resolution.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    source_sequence_semantics: Optional[str] = Field(default=None, description="""Preserved acquisition or source-row order.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    tie_group_semantics: Optional[str] = Field(default=None, description="""Identity of observations sharing an effective timestamp.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    acquisition_deduplication: Optional[str] = Field(default=None, description="""Identity and disposition for repeated acquired observations.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol', 'TimestampPolicy']} })
    tie_break_policy: Optional[str] = Field(default=None, description="""Ordering or multiplicity policy within a tie group.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    synthetic_order_provenance: Optional[str] = Field(default=None, description="""Provenance for a timestamp or order introduced by processing.""", json_schema_extra = { "linkml_meta": {'domain_of': ['TimestampPolicy']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class ParameterProvenanceAssertion(ConfiguredBaseModel):
    """
    Documentary and derivation provenance for one method parameter. A citation, a default, an author-set value, and a data-derived value are not aliases.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    parameter_provenance_id: str = Field(default=..., description="""Stable parameter-provenance assertion identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterProvenanceAssertion']} })
    method_parameter_key: Optional[str] = Field(default=None, description="""Source or canonical parameter name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'ParameterProvenanceAssertion']} })
    method_value_json: Optional[str] = Field(default=None, description="""Canonical JSON serialization of the complete source-declared value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    derivation_type: Optional[str] = Field(default=None, description="""Author-set, data-derived, conventional, engineering, repository-default, or unresolved origin.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterProvenanceAssertion']} })
    documentary_support: Optional[str] = Field(default=None, description="""Primary, secondary, cited-unverified, unstated, or unresolved documentary basis.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterProvenanceAssertion']} })
    inheritance: Optional[str] = Field(default=None, description="""Direct, inherited, or unresolved parameter transfer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterProvenanceAssertion']} })
    method_boundary_convention: Optional[str] = Field(default=None, description="""Inclusivity, clipping, ordering, or calendar convention required to interpret the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    method_target_layer: Optional[MethodTargetLayerId] = Field(default=None, description="""Layer affected by the setting.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'DurationPolicy',
                       'ParameterProvenanceAssertion']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class SourceArtifactProvenanceAssertion(ConfiguredBaseModel):
    """
    Exact, content-bound documentary provenance registered for a source artifact. Registration verifies identity and bytes. `documentary_only` maps to `executionEligible=false` at the browser and Rust receipt boundaries.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'slot_usage': {'conformance_fixture_id': {'name': 'conformance_fixture_id',
                                                   'required': True},
                        'conformance_result_digest': {'name': 'conformance_result_digest',
                                                      'required': True},
                        'source_value_sha256': {'name': 'source_value_sha256',
                                                'required': True}}})

    source_artifact_provenance_id: str = Field(default=..., description="""Stable identity of a source-artifact provenance assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })
    method_setting_id: str = Field(default=..., description="""Stable identity of one source-supported setting assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion',
                       'DiaryReplicationBinding']} })
    source_work_id: str = Field(default=..., description="""Canonical citation identity of the source work.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'NotificationOpeningOccurrenceRecord',
                       'DeviceUseSessionRecord',
                       'ScreenshotSessionRecord',
                       'AppInterruptionSessionRecord',
                       'SessionAssociationDatabaseRecord',
                       'TaskOccurrenceRecord',
                       'AppFeatureSessionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'KeyboardTransactionRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion']} })
    source_extraction_id: str = Field(default=..., description="""Evidence-row identity from which this atomic setting was derived.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    source_value_sha256: str = Field(default=..., description="""SHA-256 identity of the complete preserved source value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    source_artifact_provenance_object_json: str = Field(default=..., description="""Canonical JSON serialization of the exact registered provenance object.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })
    source_artifact_provenance_object_digest: str = Field(default=..., description="""JCS SHA-256 digest of the exact registered provenance object.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })
    provenance_keys: list[str] = Field(default=..., description="""Exact key set of the registered provenance object.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })
    candidate_status: str = Field(default=..., description="""Closed-registry adjudication status.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })
    conformance_fixture_id: str = Field(default=..., description="""Stable identity of the source or source-derived fixture proving this exact executor binding.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    conformance_result_digest: str = Field(default=..., description="""Content digest of the passing conformance result for this exact setting and executor value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'SourceArtifactProvenanceAssertion']} })
    execution_eligibility: DocumentaryExecutionEligibilityId = Field(default=..., description="""Closed documentary-only eligibility; the referenced artifact is never executed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['SourceArtifactProvenanceAssertion']} })


class MeasurementReleaseProfile(ConfiguredBaseModel):
    """
    Provenance from collected signal to the measure and granularity released for analysis.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    release_profile_id: str = Field(default=..., description="""Stable measurement-release profile identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    measurement_source: Optional[str] = Field(default=None, description="""Collected source signal or upstream measure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    measurement_target: Optional[str] = Field(default=None, description="""Construct the method intends to measure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    objective_metric_type: Optional[str] = Field(default=None, description="""Count, duration, latency, ratio, sequence, classification, or another metric type.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    aggregation_window: Optional[str] = Field(default=None, description="""Window over which released values are aggregated.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    released_data_granularity: Optional[str] = Field(default=None, description="""Event, interval, bin, day, participant, or other released granularity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    raw_event_availability: Optional[str] = Field(default=None, description="""Whether and where underlying raw events are available.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    collector_to_release_transformations: Optional[list[str]] = Field(default=None, description="""Ordered transformations from acquisition to release.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MeasurementReleaseProfile']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DiaryProtocol(ConfiguredBaseModel):
    """
    A versioned diary setup: item and response schemas, schedule and trigger rules, recall window, timezone behavior, and missing-response policy.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    diary_protocol_id: str = Field(default=..., description="""Stable diary-protocol identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    diary_title: Optional[str] = Field(default=None, description="""Source title or label of the diary instrument.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    diary_items: Optional[list[DiaryItem]] = Field(default=None, description="""Item and response definitions.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    diary_schedule_rules: Optional[list[DiaryScheduleRule]] = Field(default=None, description="""Schedule and trigger rules.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    diary_recall_window: Optional[str] = Field(default=None, description="""Time interval respondents are asked to recall.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    diary_response_timezone: Optional[str] = Field(default=None, description="""Timezone and day-boundary convention for prompts and responses.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol', 'DiaryScheduleRule']} })
    diary_missing_response_policy: Optional[str] = Field(default=None, description="""Missing, late, partial, duplicate, and corrected response policy.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol']} })
    method_settings: Optional[list[MethodSettingAssertion]] = Field(default=None, description="""Source-supported settings in this profile or subprotocol.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'DiaryProtocol']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DiaryItem(ConfiguredBaseModel):
    """
    One source-defined diary field or question and its response contract.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    diary_item_id: str = Field(default=..., description="""Stable item identifier within the diary protocol.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_item_name: Optional[str] = Field(default=None, description="""Machine-readable field name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_prompt: Optional[str] = Field(default=None, description="""Source wording or stable prompt reference.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_response_kind: MethodValueKindId = Field(default=..., description="""Response serialization shape.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_allowed_values: Optional[list[str]] = Field(default=None, description="""Closed response choices when applicable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    method_unit: Optional[str] = Field(default=None, description="""Unit attached to the value.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion', 'DurationPolicy', 'DiaryItem']} })
    diary_required: Optional[bool] = Field(default=None, description="""Whether the instrument requires a response.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_repeatable: Optional[bool] = Field(default=None, description="""Whether the item may occur more than once per entry.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    diary_anchor_event: Optional[str] = Field(default=None, description="""Event or interval the response refers to.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryItem']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DiaryScheduleRule(ConfiguredBaseModel):
    """
    One schedule, randomization, or event-contingent diary trigger.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    diary_schedule_rule_id: str = Field(default=..., description="""Stable diary-schedule rule identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    diary_trigger_kind: DiaryTriggerKindId = Field(default=..., description="""Trigger category for this rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    requested_cadence: Optional[str] = Field(default=None, description="""Requested observation or prompt cadence.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AcquisitionProtocol', 'DiaryScheduleRule']} })
    diary_window_start: Optional[str] = Field(default=None, description="""Earliest local or relative time at which the rule applies.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    diary_window_end: Optional[str] = Field(default=None, description="""Latest local or relative time at which the rule applies.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    diary_max_prompts_per_day: Optional[int] = Field(default=None, description="""Daily prompt cap when applicable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    diary_randomization_policy: Optional[str] = Field(default=None, description="""Randomization, stratification, or without-replacement rule.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryScheduleRule']} })
    diary_response_timezone: Optional[str] = Field(default=None, description="""Timezone and day-boundary convention for prompts and responses.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryProtocol', 'DiaryScheduleRule']} })
    source_locators: Optional[list[str]] = Field(default=None, description="""Source locations supporting this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['InteractionTraceRecord',
                       'InteractionRedactionRecord',
                       'NotificationDrawerSnapshotRecord',
                       'NotificationItemAppearanceRecord',
                       'NotificationHistoryRecord',
                       'NotificationCallbackGroupRecord',
                       'NotificationTitleAnnotationRecord',
                       'ParticipantDayObservationRecord',
                       'CrossPeriodAggregateReference',
                       'NotificationOpeningOccurrenceRecord',
                       'NotificationEvidenceRecord',
                       'NotificationQuestionnaireResponseRecord',
                       'NotificationAcceptanceRecord',
                       'DeviceUseSessionRecord',
                       'DeviceSessionQuestionnaireResponseRecord',
                       'DeviceSessionLabelRecord',
                       'SessionQuantityRecord',
                       'ScreenshotSessionRecord',
                       'SessionScreenshotRecord',
                       'ScreenshotRangeAnnotationRecord',
                       'AppInterruptionSessionRecord',
                       'SessionInterruptionRecord',
                       'SessionAssociationDatabaseRecord',
                       'SessionTransactionRecord',
                       'AssociationRuleRecord',
                       'TaskOccurrenceRecord',
                       'TaskActionRecord',
                       'TaskCriterionAssessmentRecord',
                       'TaskQuestionnaireResponseRecord',
                       'TaskObservationWindowRecord',
                       'AppFeatureSessionRecord',
                       'AppFeatureOccurrenceRecord',
                       'SessionFeatureSelectionRecord',
                       'ScreenTextCaptureRecord',
                       'TypingTrialRecord',
                       'TokenEvaluationCaseRecord',
                       'TokenEvaluationVerdictRecord',
                       'TextChangeCaseRecord',
                       'TextChangeVerdictRecord',
                       'TypingQuestionnaireResponseRecord',
                       'KeyboardTransactionRecord',
                       'ScreenTextPhraseRecord',
                       'SensorControlOccurrenceRecord',
                       'SampledQuantityObservationRecord',
                       'SampledObservationReferenceRecord',
                       'SampledEntityMemberRecord',
                       'MonthlyAppUseCellRecord',
                       'DeviceStateObservationRecord',
                       'DeviceStateIntervalRecord',
                       'RingerStateIntervalRecord',
                       'StudyMethodProfile',
                       'MethodSettingAssertion',
                       'ProtocolMaterializationBlocker',
                       'MethodConfigurationSpace',
                       'MethodConfigurationGroup',
                       'MethodConfigurationLevel',
                       'MethodConfigurationCombination',
                       'AcquisitionProtocol',
                       'SessionConstructionPolicy',
                       'NotificationAttributionPolicy',
                       'DurationPolicy',
                       'TimestampPolicy',
                       'ParameterProvenanceAssertion',
                       'MeasurementReleaseProfile',
                       'DiaryProtocol',
                       'DiaryItem',
                       'DiaryScheduleRule']} })


class DiarySourceAdapterReceipt(ConfiguredBaseModel):
    """
    Exact receipt from one versioned diary source-layout adapter execution. This proves source-layout conformance only; it never upgrades a blocked diary protocol to executable.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    mapping_profile_id: str = Field(default=..., description="""Exact released source-layout mapping profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    mapping_profile_version: str = Field(default=..., description="""Version of the released source-layout mapping profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    adapter_id: str = Field(default=..., description="""Versioned source-layout adapter identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    adapter_version: str = Field(default=..., description="""Exact source-layout adapter version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    conformance_fixture_ids: list[str] = Field(default=..., description="""Shared fixture identities registered to the exact adapter and mapping profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt']} })
    source_sha256: str = Field(default=..., description="""SHA-256 of the source bytes accepted by the diary source adapter.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt']} })
    normalized_sha256: str = Field(default=..., description="""SHA-256 of the bytes emitted by the diary source adapter.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt']} })


class DiaryReplicationBinding(ConfiguredBaseModel):
    """
    Content-bound selection of one Sleep Scoring diary version and released source layout. Chronicle validates this binding and its embedded shared fixture independently while preserving the full profile's blocked state.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    method_setting_id: str = Field(default=..., description="""Stable identity of one source-supported setting assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['MethodSettingAssertion',
                       'SourceArtifactProvenanceAssertion',
                       'DiaryReplicationBinding']} })
    bridge_payload_sha256: str = Field(default=..., description="""SHA-256 of the canonical generated Chronicle bridge payload.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    catalog_source_sha256: str = Field(default=..., description="""SHA-256 identity declared by the authoritative Sleep Scoring generated diary catalog.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    version_definition_id: str = Field(default=..., description="""Exact authoritative diary version definition selected for replication.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    source_method_variant_id: str = Field(default=..., description="""Stable identity of the exact cohort, platform, protocol version, branch, or multiverse configuration represented by this profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'DiaryReplicationBinding']} })
    mapping_profile_id: str = Field(default=..., description="""Exact released source-layout mapping profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    mapping_profile_version: str = Field(default=..., description="""Version of the released source-layout mapping profile.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    adapter_id: str = Field(default=..., description="""Versioned source-layout adapter identity.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    adapter_version: str = Field(default=..., description="""Exact source-layout adapter version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiarySourceAdapterReceipt', 'DiaryReplicationBinding']} })
    fixture_id: str = Field(default=..., description="""Shared conformance fixture executed for this binding.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    fixture_input_sha256: str = Field(default=..., description="""Expected and observed SHA-256 of the shared fixture input.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    fixture_normalized_sha256: str = Field(default=..., description="""Expected and observed SHA-256 of the adapter-normalized shared fixture.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    profile_implementation_status: MethodProfileExecutionStatusId = Field(default=..., description="""Whole-profile execution status; executable requires every replication gate to pass.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StudyMethodProfile', 'DiaryReplicationBinding']} })
    blocker_codes: list[str] = Field(default=..., description="""Complete authoritative fail-closed reasons that keep the full diary profile non-executable.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    diary_item_count: int = Field(default=..., description="""Number of composed diary item definitions transported for the selected version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    form_element_count: int = Field(default=..., description="""Number of composed form elements transported for the selected version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    schedule_rule_count: int = Field(default=..., description="""Number of composed diary schedule rules transported for the selected version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    administration_schedule_count: int = Field(default=..., description="""Number of composed administration schedules transported for the selected version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    rule_definition_count: int = Field(default=..., description="""Number of composed conditional or validation rules transported for the selected version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })
    diary_source_adapter_receipt: DiarySourceAdapterReceipt = Field(default=..., description="""Exact source-layout adapter execution receipt nested in this binding.""", json_schema_extra = { "linkml_meta": {'domain_of': ['DiaryReplicationBinding']} })


# Model rebuild
# see https://pydantic-docs.helpmanual.io/usage/models/#rebuilding-a-model
PlatformEventOccurrence.model_rebuild()
UsageEventRecord.model_rebuild()
LoggingObservation.model_rebuild()
InteractionTraceRecord.model_rebuild()
InteractionEventRecord.model_rebuild()
InteractionRedactionRecord.model_rebuild()
NotificationDrawerSnapshotRecord.model_rebuild()
NotificationItemAppearanceRecord.model_rebuild()
NotificationHistoryRecord.model_rebuild()
NotificationCallbackGroupRecord.model_rebuild()
NotificationTitleAnnotationRecord.model_rebuild()
ParticipantDayObservationRecord.model_rebuild()
CrossPeriodAggregateReference.model_rebuild()
NotificationOpeningOccurrenceRecord.model_rebuild()
NotificationEvidenceRecord.model_rebuild()
NotificationQuestionnaireResponseRecord.model_rebuild()
NotificationAcceptanceRecord.model_rebuild()
UsageInterval.model_rebuild()
DeviceUseSessionRecord.model_rebuild()
DeviceSessionQuestionnaireResponseRecord.model_rebuild()
DeviceSessionLabelRecord.model_rebuild()
ScreenshotSessionRecord.model_rebuild()
SessionScreenshotRecord.model_rebuild()
ScreenshotRangeAnnotationRecord.model_rebuild()
AppInterruptionSessionRecord.model_rebuild()
SessionInterruptionRecord.model_rebuild()
SessionAssociationDatabaseRecord.model_rebuild()
SessionTransactionRecord.model_rebuild()
AssociationRuleRecord.model_rebuild()
AssociationContextItemRecord.model_rebuild()
TaskOccurrenceRecord.model_rebuild()
TaskActionRecord.model_rebuild()
TaskCriterionAssessmentRecord.model_rebuild()
TaskQuestionnaireResponseRecord.model_rebuild()
AppSessionQuestionnaireResponseRecord.model_rebuild()
TaskObservationWindowRecord.model_rebuild()
AppFeatureSessionRecord.model_rebuild()
AppFeatureOccurrenceRecord.model_rebuild()
SessionFeatureSelectionRecord.model_rebuild()
ScreenTextCaptureRecord.model_rebuild()
TypingTrialRecord.model_rebuild()
TokenEvaluationCaseRecord.model_rebuild()
TokenEvaluationVerdictRecord.model_rebuild()
TextChangeCaseRecord.model_rebuild()
TextChangeVerdictRecord.model_rebuild()
TypingQuestionnaireResponseRecord.model_rebuild()
KeyboardTransactionRecord.model_rebuild()
ScreenTextPhraseRecord.model_rebuild()
SensorControlOccurrenceRecord.model_rebuild()
SampledQuantityObservationRecord.model_rebuild()
SampledObservationReferenceRecord.model_rebuild()
SampledEntityMemberRecord.model_rebuild()
SampledQuantityRecord.model_rebuild()
SessionQuantityRecord.model_rebuild()
MonthlyAppUseCellRecord.model_rebuild()
DeviceStateObservationRecord.model_rebuild()
DeviceStateIntervalRecord.model_rebuild()
RingerStateIntervalRecord.model_rebuild()
UsageEpisodeAssertion.model_rebuild()
UsageSessionAssertion.model_rebuild()
GlanceAssertion.model_rebuild()
EffectiveUsageMeasure.model_rebuild()
ComplianceDayAssessment.model_rebuild()
DayCoverageAssessment.model_rebuild()
CoverageAssessment.model_rebuild()
AttributionAssertion.model_rebuild()
WorkflowPlan.model_rebuild()
OperationDefinition.model_rebuild()
OperationExecution.model_rebuild()
QueryDefinition.model_rebuild()
QueryExecution.model_rebuild()
ReconstructionExecution.model_rebuild()
ReconstructionStrategy.model_rebuild()
ParameterSet.model_rebuild()
ParameterBinding.model_rebuild()
StudyMethodProfile.model_rebuild()
MethodSettingAssertion.model_rebuild()
MethodContractBinding.model_rebuild()
LiteratureInputAdapterContract.model_rebuild()
ProtocolMaterializationBlocker.model_rebuild()
MethodConfigurationSpace.model_rebuild()
MethodConfigurationGroup.model_rebuild()
MethodConfigurationLevel.model_rebuild()
MethodConfigurationCombination.model_rebuild()
MethodConfigurationSelection.model_rebuild()
AcquisitionProtocol.model_rebuild()
SessionConstructionPolicy.model_rebuild()
NotificationAttributionPolicy.model_rebuild()
DurationPolicy.model_rebuild()
TimestampPolicy.model_rebuild()
ParameterProvenanceAssertion.model_rebuild()
SourceArtifactProvenanceAssertion.model_rebuild()
MeasurementReleaseProfile.model_rebuild()
DiaryProtocol.model_rebuild()
DiaryItem.model_rebuild()
DiaryScheduleRule.model_rebuild()
DiarySourceAdapterReceipt.model_rebuild()
DiaryReplicationBinding.model_rebuild()

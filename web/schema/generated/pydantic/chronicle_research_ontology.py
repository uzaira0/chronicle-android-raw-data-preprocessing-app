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


linkml_meta = LinkMLMeta({'default_prefix': 'chron',
     'default_range': 'string',
     'description': 'Core entity model for the Android UsageStatsManager event-log '
                    '-> usage-measurement research ontology. Implements the D4 '
                    'five-way split from '
                    'docs/pipeline-graph/13-research-ontology-design.md '
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
     'prefixes': {'chron': {'prefix_prefix': 'chron',
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
     'source_file': 'chronicle-research-ontology.linkml.yaml',
     'title': 'Chronicle Android Usage Measurement — Research Ontology (core '
              'module)'} )

class EventTypeCode(str, Enum):
    """
    Canonical Android lifecycle / device-state event vocabulary. Modeled as a SKOS concept scheme. The FULL both-spellings scheme (human labels PLUS "Unknown importance: N" importance codes 26/27/28/29 ...) is generated from the engine constants; the values below are the canonical semantic anchors every spelling maps to.
    """
    activity_resumed = "activity_resumed"
    """
    App moved to foreground (Move to Foreground / UI:1).
    """
    activity_paused = "activity_paused"
    """
    App moved to background (Move to Background / UI:2).
    """
    activity_stopped = "activity_stopped"
    """
    Activity stopped (UI:23) — proximity/fallback close.
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
    Attribution status of an App-Usage assertion — the compliance denominator contract. Chronicle uses a CLOSED attribution vocabulary: "Target Child", "Other", or "None"/blank (survey answers arrive as "Other (From Survey)"). Mirrors classifyAttribution() in web/src/lib/stages/attributePerson.ts (the runtime SSOT). NEVER a null person and NEVER an "unknown person" class.
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
    Usage occurred but the person is unresolved (label "None"/blank). Counts toward the compliance denominator; never dropped.
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


class CoverageCause(str, Enum):
    """
    Best-supported cause of a coverage gap. A gap is an OBSERVABILITY condition — never asserted as physical inactivity.
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



class PlatformEventOccurrence(ConfiguredBaseModel):
    """
    The real-world Android lifecycle/system occurrence (an app resuming, the screen turning off, a shutdown). This is the thing that happened in the world — NOT the logged record and NOT an observation. Deliberately untyped as sosa:Observation.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    occurrence_instant: Optional[str] = Field(default=None, description="""When the occurrence happened.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence'],
         'slot_uri': 'time:inXSDDateTimeStamp'} })
    event_code: Optional[EventTypeCode] = Field(default=None, description="""Canonical event type.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence', 'UsageEventRecord']} })


class UsageEventRecord(ConfiguredBaseModel):
    """
    The logged information artifact for one Android usage event. A prov:Entity, not an observation.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    event_timestamp_ns: Optional[int] = Field(default=None, description="""Event timestamp in nanoseconds since epoch.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })
    event_code: Optional[EventTypeCode] = Field(default=None, description="""Canonical event type.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PlatformEventOccurrence', 'UsageEventRecord']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'UsageEpisodeAssertion']} })
    app_class_name: Optional[str] = Field(default=None, description="""Android activity class name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'CoverageAssessment']} })
    timezone: Optional[str] = Field(default=None, description="""Original recording timezone (preserved).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })
    records_occurrence: Optional[PlatformEventOccurrence] = Field(default=None, description="""The real-world occurrence this record logs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord']} })


class LoggingObservation(ConfiguredBaseModel):
    """
    OPTIONAL. The OS logger's act of observing a device property, modeled only if that abstraction is genuinely needed. Do NOT type UsageEventRecord as this.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'sosa:Observation',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    observed_property: Optional[str] = Field(default=None, description="""The device property the logger observed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation']} })
    result_record: Optional[UsageEventRecord] = Field(default=None, description="""The event record produced by the logging observation.""", json_schema_extra = { "linkml_meta": {'domain_of': ['LoggingObservation']} })


class UsageInterval(ConfiguredBaseModel):
    """
    A phenomenon-time interval a usage assertion denotes. A time:ProperInterval.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'time:ProperInterval',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    start_instant: Optional[str] = Field(default=None, description="""Interval start instant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    end_instant: Optional[str] = Field(default=None, description="""Interval end instant.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    duration_seconds: Optional[float] = Field(default=None, description="""Interval duration in seconds.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval'], 'slot_uri': 'qudt:hasQuantityValue'} })
    start_status: Optional[EndpointStatus] = Field(default=None, description="""Endpoint status of the start.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })
    end_status: Optional[EndpointStatus] = Field(default=None, description="""Endpoint status of the end.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageInterval']} })


class UsageEpisodeAssertion(ConfiguredBaseModel):
    """
    A claim that one app was in continuous use over an interval. A derived prov:Entity (what the pipeline asserts, not a ground truth).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    app_package_name: Optional[str] = Field(default=None, description="""Android package name.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'UsageEpisodeAssertion']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
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
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
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
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'CoverageAssessment']} })
    reconstructed_by: Optional[ReconstructionExecution] = Field(default=None, description="""The execution that produced this assertion.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })
    measurement_layer: Optional[MeasurementLayer] = Field(default=None, description="""Measurement-model layer.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion']} })


class EffectiveUsageMeasure(ConfiguredBaseModel):
    """
    The effective-usage duration (episode interval intersected with active coverage, per a named policy). Cites the ParameterSet and execution that produced it. NOT asserted as physical truth — carries the coverage policy that produced it.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'CoverageAssessment']} })
    date: Optional[date] = Field(default=None, description="""Study/local date the measure is assigned to.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    effective_minutes: Optional[float] = Field(default=None, description="""Effective usage minutes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    denotes_interval: Optional[UsageInterval] = Field(default=None, description="""The phenomenon-time interval this assertion denotes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure']} })
    produced_by: Optional[NodeExecution] = Field(default=None, description="""The node execution that produced this measure.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    cites_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet under which this measure was produced.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })
    coverage_policy: Optional[str] = Field(default=None, description="""Named policy for how coverage gaps were treated.""", json_schema_extra = { "linkml_meta": {'domain_of': ['EffectiveUsageMeasure']} })


class CoverageAssessment(ConfiguredBaseModel):
    """
    A coverage/observability judgement over a stream window: expected vs actual data availability, its threshold, bounding events, and best-supported cause. A gap MAY CONCEAL usage — this asserts only how the measurement policy treats the interval, never that the device was inactive.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    assesses_interval: Optional[UsageInterval] = Field(default=None, description="""The stream window assessed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    participant_id: str = Field(default=..., description="""Participant/device identifier (string, always).""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord',
                       'UsageEpisodeAssertion',
                       'UsageSessionAssertion',
                       'GlanceAssertion',
                       'EffectiveUsageMeasure',
                       'CoverageAssessment']} })
    device_id: Optional[str] = Field(default=None, description="""Device identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['UsageEventRecord', 'CoverageAssessment']} })
    expected_available: Optional[bool] = Field(default=None, description="""Whether data was expected to be available (needs a heartbeat/expectation to assert NoData).""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    actually_available: Optional[bool] = Field(default=None, description="""Whether any data was actually present.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    availability_threshold: Optional[float] = Field(default=None, description="""Coverage threshold applied.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    coverage_cause: Optional[CoverageCause] = Field(default=None, description="""Best-supported cause.""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })
    policy_treatment: Optional[str] = Field(default=None, description="""How the measurement policy treats this interval (e.g. pass / na / exclude).""", json_schema_extra = { "linkml_meta": {'domain_of': ['CoverageAssessment']} })


class AttributionAssertion(ConfiguredBaseModel):
    """
    Attribution of usage to a person. Exactly one status is required; an actual person is attached only when known. The participant-device-day denominator must satisfy duration conservation: target + known_non_target + unresolved = eligible.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    attribution_status: AttributionStatus = Field(default=..., description="""Required attribution status.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })
    attributed_person: Optional[str] = Field(default=None, description="""The actual person, attached only when known.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })
    on_shared_device: Optional[bool] = Field(default=None, description="""Whether the device is shared.""", json_schema_extra = { "linkml_meta": {'domain_of': ['AttributionAssertion']} })


class PipelinePlan(ConfiguredBaseModel):
    """
    The prospective processing workflow. A p-plan:Plan / prov:Plan.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'pplan:Plan',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core',
         'tree_root': True})

    plan_id: str = Field(default=..., description="""Plan identifier.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PipelinePlan']} })
    steps: Optional[list[StepDefinition]] = Field(default=None, description="""Steps of the plan.""", json_schema_extra = { "linkml_meta": {'domain_of': ['PipelinePlan']} })


class StepDefinition(ConfiguredBaseModel):
    """
    One processing step in the plan (a graph node). A p-plan:Step. Follows the ProcessingStep shape (id/verb/engine/consumes/produces/depends_on).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'pplan:Step',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    step_id: str = Field(default=..., description="""Step identifier (= graph node id).""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    verb: Optional[str] = Field(default=None, description="""Action the step performs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    engine: Optional[str] = Field(default=None, description="""Named algorithm/engine the step realizes.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    consumes: Optional[list[str]] = Field(default=None, description="""Channels/inputs the step reads.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    produces: Optional[list[str]] = Field(default=None, description="""Channels/outputs the step produces.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    depends_on: Optional[list[str]] = Field(default=None, description="""Steps that must precede this one.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })
    is_fatal: Optional[bool] = Field(default=None, description="""Whether a failure fails the whole workflow.""", json_schema_extra = { "linkml_meta": {'domain_of': ['StepDefinition']} })


class NodeExecution(ConfiguredBaseModel):
    """
    A retrospective execution of a StepDefinition. A prov:Activity.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Activity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    executes_step: Optional[str] = Field(default=None, description="""The StepDefinition this execution runs.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NodeExecution']} })
    used_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet the execution used.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NodeExecution', 'ReconstructionExecution']} })
    started_at: Optional[str] = Field(default=None, description="""Execution start.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NodeExecution']} })
    ended_at: Optional[str] = Field(default=None, description="""Execution end.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NodeExecution']} })


class ReconstructionExecution(ConfiguredBaseModel):
    """
    The execution that produced a usage assertion. A prov:Activity (and sosa:Execution).
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Activity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    follows_strategy: Optional[str] = Field(default=None, description="""The reconstruction strategy followed.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionExecution']} })
    used_parameter_set: Optional[ParameterSet] = Field(default=None, description="""The ParameterSet the execution used.""", json_schema_extra = { "linkml_meta": {'domain_of': ['NodeExecution', 'ReconstructionExecution']} })


class ReconstructionStrategy(ConfiguredBaseModel):
    """
    A named, versioned episode-reconstruction algorithm (semantic category + canonical IRI). Subclass only where formal restrictions genuinely differ.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'sosa:Procedure',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    strategy_id: str = Field(default=..., description="""Strategy identifier (unique key).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    strategy_kind: Optional[ReconstructionStrategyId] = Field(default=None, description="""Canonical strategy category (IRI-bearing enum value).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    strategy_version: Optional[str] = Field(default=None, description="""Strategy version.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })
    canonical_iri: Optional[str] = Field(default=None, description="""Canonical IRI carried by the runtime enum.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ReconstructionStrategy']} })


class ParameterSet(ConfiguredBaseModel):
    """
    A content-addressed configuration entity — a set of ParameterBindings over the plan's variables. NOT a Plan: the plan is the workflow; this binds its variables.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'class_uri': 'prov:Entity',
         'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    parameter_set_sha256: Optional[str] = Field(default=None, description="""Content-addressed hash of the canonical parameter set.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterSet']} })
    bindings: Optional[list[ParameterBinding]] = Field(default=None, description="""Knob=value bindings.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterSet']} })


class ParameterBinding(ConfiguredBaseModel):
    """
    One knob = value binding within a ParameterSet.
    """
    linkml_meta: ClassVar[LinkMLMeta] = LinkMLMeta({'from_schema': 'https://w3id.org/chronicle-usage-ontology/core'})

    knob_key: Optional[str] = Field(default=None, description="""Option/knob key.""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterBinding']} })
    knob_value: Optional[str] = Field(default=None, description="""Bound value (canonical JSON string).""", json_schema_extra = { "linkml_meta": {'domain_of': ['ParameterBinding']} })


# Model rebuild
# see https://pydantic-docs.helpmanual.io/usage/models/#rebuilding-a-model
PlatformEventOccurrence.model_rebuild()
UsageEventRecord.model_rebuild()
LoggingObservation.model_rebuild()
UsageInterval.model_rebuild()
UsageEpisodeAssertion.model_rebuild()
UsageSessionAssertion.model_rebuild()
GlanceAssertion.model_rebuild()
EffectiveUsageMeasure.model_rebuild()
CoverageAssessment.model_rebuild()
AttributionAssertion.model_rebuild()
PipelinePlan.model_rebuild()
StepDefinition.model_rebuild()
NodeExecution.model_rebuild()
ReconstructionExecution.model_rebuild()
ReconstructionStrategy.model_rebuild()
ParameterSet.model_rebuild()
ParameterBinding.model_rebuild()

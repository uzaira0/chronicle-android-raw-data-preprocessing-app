-- # Class: PlatformEventOccurrence Description: The real-world Android lifecycle/system occurrence (an app resuming, the screen turning off, a shutdown). This is the thing that happened in the world — NOT the logged record and NOT an observation. Deliberately untyped as sosa:Observation.
--     * Slot: id
--     * Slot: occurrence_instant Description: When the occurrence happened.
--     * Slot: event_code Description: Canonical event type.
-- # Class: UsageEventRecord Description: The logged information artifact for one Android usage event. A prov:Entity, not an observation.
--     * Slot: id
--     * Slot: event_timestamp_ns Description: Event timestamp in nanoseconds since epoch.
--     * Slot: event_code Description: Canonical event type.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: app_class_name Description: Android activity class name.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: timezone Description: Original recording timezone (preserved).
--     * Slot: records_occurrence_id Description: The real-world occurrence this record logs.
-- # Class: LoggingObservation Description: OPTIONAL. The OS logger's act of observing a device property, modeled only if that abstraction is genuinely needed. Do NOT type UsageEventRecord as this.
--     * Slot: id
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: result_record_id Description: The event record produced by the logging observation.
-- # Class: UsageInterval Description: A phenomenon-time interval a usage assertion denotes. A time:ProperInterval.
--     * Slot: id
--     * Slot: start_instant Description: Interval start instant.
--     * Slot: end_instant Description: Interval end instant.
--     * Slot: duration_seconds Description: Interval duration in seconds.
--     * Slot: start_status Description: Endpoint status of the start.
--     * Slot: end_status Description: Endpoint status of the end.
-- # Class: UsageEpisodeAssertion Description: A claim that one app was in continuous use over an interval. A derived prov:Entity (what the pipeline asserts, not a ground truth).
--     * Slot: id
--     * Slot: app_package_name Description: Android package name.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
--     * Slot: attribution_id Description: Person attribution for this episode.
-- # Class: UsageSessionAssertion Description: A claim of continuous device use between unlock and lock. Derived prov:Entity.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
-- # Class: GlanceAssertion Description: A claim that the screen activated then deactivated without an unlock. Derived prov:Entity.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
-- # Class: EffectiveUsageMeasure Description: The effective-usage duration (episode interval intersected with active coverage, per a named policy). Cites the ParameterSet and execution that produced it. NOT asserted as physical truth — carries the coverage policy that produced it.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: date Description: Study/local date the measure is assigned to.
--     * Slot: effective_minutes Description: Effective usage minutes.
--     * Slot: coverage_policy Description: Named policy for how coverage gaps were treated.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: produced_by_id Description: The node execution that produced this measure.
--     * Slot: cites_parameter_set_id Description: The ParameterSet under which this measure was produced.
-- # Class: CoverageAssessment Description: A coverage/observability judgement over a stream window: expected vs actual data availability, its threshold, bounding events, and best-supported cause. A gap MAY CONCEAL usage — this asserts only how the measurement policy treats the interval, never that the device was inactive.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: expected_available Description: Whether data was expected to be available (needs a heartbeat/expectation to assert NoData).
--     * Slot: actually_available Description: Whether any data was actually present.
--     * Slot: availability_threshold Description: Coverage threshold applied.
--     * Slot: coverage_cause Description: Best-supported cause.
--     * Slot: policy_treatment Description: How the measurement policy treats this interval (e.g. pass / na / exclude).
--     * Slot: assesses_interval_id Description: The stream window assessed.
-- # Class: AttributionAssertion Description: Attribution of usage to a person. Exactly one status is required; an actual person is attached only when known. The participant-device-day denominator must satisfy duration conservation: target + known_non_target + unresolved = eligible.
--     * Slot: id
--     * Slot: attribution_status Description: Required attribution status.
--     * Slot: attributed_person Description: The actual person, attached only when known.
--     * Slot: on_shared_device Description: Whether the device is shared.
-- # Class: PipelinePlan Description: The prospective processing workflow. A p-plan:Plan / prov:Plan.
--     * Slot: plan_id Description: Plan identifier.
-- # Class: StepDefinition Description: One processing step in the plan (a graph node). A p-plan:Step. Follows the ProcessingStep shape (id/verb/engine/consumes/produces/depends_on).
--     * Slot: step_id Description: Step identifier (= graph node id).
--     * Slot: verb Description: Action the step performs.
--     * Slot: engine Description: Named algorithm/engine the step realizes.
--     * Slot: is_fatal Description: Whether a failure fails the whole workflow.
--     * Slot: PipelinePlan_plan_id Description: Autocreated FK slot
-- # Class: NodeExecution Description: A retrospective execution of a StepDefinition. A prov:Activity.
--     * Slot: id
--     * Slot: executes_step Description: The StepDefinition this execution runs.
--     * Slot: started_at Description: Execution start.
--     * Slot: ended_at Description: Execution end.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: ReconstructionExecution Description: The execution that produced a usage assertion. A prov:Activity (and sosa:Execution).
--     * Slot: id
--     * Slot: follows_strategy Description: The reconstruction strategy followed.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: ReconstructionStrategy Description: A named, versioned episode-reconstruction algorithm (semantic category + canonical IRI). Subclass only where formal restrictions genuinely differ.
--     * Slot: strategy_id Description: Strategy identifier (unique key).
--     * Slot: strategy_kind Description: Canonical strategy category (IRI-bearing enum value).
--     * Slot: strategy_version Description: Strategy version.
--     * Slot: canonical_iri Description: Canonical IRI carried by the runtime enum.
-- # Class: ParameterSet Description: A content-addressed configuration entity — a set of ParameterBindings over the plan's variables. NOT a Plan: the plan is the workflow; this binds its variables.
--     * Slot: id
--     * Slot: parameter_set_sha256 Description: Content-addressed hash of the canonical parameter set.
-- # Class: ParameterBinding Description: One knob = value binding within a ParameterSet.
--     * Slot: id
--     * Slot: knob_key Description: Option/knob key.
--     * Slot: knob_value Description: Bound value (canonical JSON string).
--     * Slot: ParameterSet_id Description: Autocreated FK slot
-- # Class: StepDefinition_consumes
--     * Slot: StepDefinition_step_id Description: Autocreated FK slot
--     * Slot: consumes Description: Channels/inputs the step reads.
-- # Class: StepDefinition_produces
--     * Slot: StepDefinition_step_id Description: Autocreated FK slot
--     * Slot: produces Description: Channels/outputs the step produces.
-- # Class: StepDefinition_depends_on
--     * Slot: StepDefinition_step_id Description: Autocreated FK slot
--     * Slot: depends_on Description: Steps that must precede this one.

CREATE TABLE "PlatformEventOccurrence" (
	id INTEGER NOT NULL,
	occurrence_instant TEXT,
	event_code VARCHAR(22),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_PlatformEventOccurrence_id" ON "PlatformEventOccurrence" (id);

CREATE TABLE "UsageInterval" (
	id INTEGER NOT NULL,
	start_instant TEXT,
	end_instant TEXT,
	duration_seconds FLOAT,
	start_status VARCHAR(17),
	end_status VARCHAR(17),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_UsageInterval_id" ON "UsageInterval" (id);

CREATE TABLE "AttributionAssertion" (
	id INTEGER NOT NULL,
	attribution_status VARCHAR(16) NOT NULL,
	attributed_person TEXT,
	on_shared_device BOOLEAN,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_AttributionAssertion_id" ON "AttributionAssertion" (id);

CREATE TABLE "PipelinePlan" (
	plan_id TEXT NOT NULL,
	PRIMARY KEY (plan_id)
);
CREATE INDEX "ix_PipelinePlan_plan_id" ON "PipelinePlan" (plan_id);

CREATE TABLE "ReconstructionStrategy" (
	strategy_id TEXT NOT NULL,
	strategy_kind VARCHAR(26),
	strategy_version TEXT,
	canonical_iri TEXT,
	PRIMARY KEY (strategy_id)
);
CREATE INDEX "ix_ReconstructionStrategy_strategy_id" ON "ReconstructionStrategy" (strategy_id);

CREATE TABLE "ParameterSet" (
	id INTEGER NOT NULL,
	parameter_set_sha256 TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_ParameterSet_id" ON "ParameterSet" (id);

CREATE TABLE "UsageEventRecord" (
	id INTEGER NOT NULL,
	event_timestamp_ns INTEGER,
	event_code VARCHAR(22),
	app_package_name TEXT,
	app_class_name TEXT,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	timezone TEXT,
	records_occurrence_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(records_occurrence_id) REFERENCES "PlatformEventOccurrence" (id)
);
CREATE INDEX "ix_UsageEventRecord_id" ON "UsageEventRecord" (id);

CREATE TABLE "CoverageAssessment" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	expected_available BOOLEAN,
	actually_available BOOLEAN,
	availability_threshold FLOAT,
	coverage_cause VARCHAR(23),
	policy_treatment TEXT,
	assesses_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(assesses_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_CoverageAssessment_id" ON "CoverageAssessment" (id);

CREATE TABLE "StepDefinition" (
	step_id TEXT NOT NULL,
	verb TEXT,
	engine TEXT,
	is_fatal BOOLEAN,
	"PipelinePlan_plan_id" TEXT,
	PRIMARY KEY (step_id),
	FOREIGN KEY("PipelinePlan_plan_id") REFERENCES "PipelinePlan" (plan_id)
);
CREATE INDEX "ix_StepDefinition_step_id" ON "StepDefinition" (step_id);

CREATE TABLE "ReconstructionExecution" (
	id INTEGER NOT NULL,
	follows_strategy TEXT,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(follows_strategy) REFERENCES "ReconstructionStrategy" (strategy_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_ReconstructionExecution_id" ON "ReconstructionExecution" (id);

CREATE TABLE "ParameterBinding" (
	id INTEGER NOT NULL,
	knob_key TEXT,
	knob_value TEXT,
	"ParameterSet_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ParameterSet_id") REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_ParameterBinding_id" ON "ParameterBinding" (id);

CREATE TABLE "LoggingObservation" (
	id INTEGER NOT NULL,
	observed_property TEXT,
	result_record_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(result_record_id) REFERENCES "UsageEventRecord" (id)
);
CREATE INDEX "ix_LoggingObservation_id" ON "LoggingObservation" (id);

CREATE TABLE "UsageEpisodeAssertion" (
	id INTEGER NOT NULL,
	app_package_name TEXT,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	attribution_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id),
	FOREIGN KEY(attribution_id) REFERENCES "AttributionAssertion" (id)
);
CREATE INDEX "ix_UsageEpisodeAssertion_id" ON "UsageEpisodeAssertion" (id);

CREATE TABLE "UsageSessionAssertion" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id)
);
CREATE INDEX "ix_UsageSessionAssertion_id" ON "UsageSessionAssertion" (id);

CREATE TABLE "GlanceAssertion" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id)
);
CREATE INDEX "ix_GlanceAssertion_id" ON "GlanceAssertion" (id);

CREATE TABLE "NodeExecution" (
	id INTEGER NOT NULL,
	executes_step TEXT,
	started_at TEXT,
	ended_at TEXT,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(executes_step) REFERENCES "StepDefinition" (step_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_NodeExecution_id" ON "NodeExecution" (id);

CREATE TABLE "StepDefinition_consumes" (
	"StepDefinition_step_id" TEXT,
	consumes TEXT,
	PRIMARY KEY ("StepDefinition_step_id", consumes),
	FOREIGN KEY("StepDefinition_step_id") REFERENCES "StepDefinition" (step_id)
);
CREATE INDEX "ix_StepDefinition_consumes_consumes" ON "StepDefinition_consumes" (consumes);
CREATE INDEX "ix_StepDefinition_consumes_StepDefinition_step_id" ON "StepDefinition_consumes" ("StepDefinition_step_id");

CREATE TABLE "StepDefinition_produces" (
	"StepDefinition_step_id" TEXT,
	produces TEXT,
	PRIMARY KEY ("StepDefinition_step_id", produces),
	FOREIGN KEY("StepDefinition_step_id") REFERENCES "StepDefinition" (step_id)
);
CREATE INDEX "ix_StepDefinition_produces_produces" ON "StepDefinition_produces" (produces);
CREATE INDEX "ix_StepDefinition_produces_StepDefinition_step_id" ON "StepDefinition_produces" ("StepDefinition_step_id");

CREATE TABLE "StepDefinition_depends_on" (
	"StepDefinition_step_id" TEXT,
	depends_on TEXT,
	PRIMARY KEY ("StepDefinition_step_id", depends_on),
	FOREIGN KEY("StepDefinition_step_id") REFERENCES "StepDefinition" (step_id)
);
CREATE INDEX "ix_StepDefinition_depends_on_depends_on" ON "StepDefinition_depends_on" (depends_on);
CREATE INDEX "ix_StepDefinition_depends_on_StepDefinition_step_id" ON "StepDefinition_depends_on" ("StepDefinition_step_id");

CREATE TABLE "EffectiveUsageMeasure" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	date DATE,
	effective_minutes FLOAT,
	coverage_policy TEXT,
	denotes_interval_id INTEGER,
	produced_by_id INTEGER,
	cites_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(produced_by_id) REFERENCES "NodeExecution" (id),
	FOREIGN KEY(cites_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_EffectiveUsageMeasure_id" ON "EffectiveUsageMeasure" (id);


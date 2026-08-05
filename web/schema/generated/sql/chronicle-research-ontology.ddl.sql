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
--     * Slot: produced_by Description: The operation execution that produced this measure.
--     * Slot: coverage_policy Description: Named policy for how coverage gaps were treated.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
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
-- # Class: WorkflowPlan Description: The prospective processing workflow. A p-plan:Plan / prov:Plan.
--     * Slot: plan_id Description: Plan identifier.
-- # Class: OperationDefinition Description: One semantic operation in the workflow at any useful scale. Operations compose recursively via part_of_operation so a coarse responsibility and its independently invalidatable transformations share one model without forcing presentation and execution boundaries to coincide.
--     * Slot: operation_id Description: Stable semantic operation identifier.
--     * Slot: verb Description: Action the operation performs.
--     * Slot: engine Description: Named algorithm or engine the operation realizes.
--     * Slot: operation_role Description: Semantic responsibility of the operation.
--     * Slot: epistemic_role Description: Whether the operation observes, infers, applies policy, or presents.
--     * Slot: is_fatal Description: Whether a failure fails the whole workflow.
--     * Slot: part_of_operation Description: The coarser semantic operation this operation is a proper part of. Referenced by operation_id, not inlined.
--     * Slot: WorkflowPlan_plan_id Description: Autocreated FK slot
-- # Class: OperationExecution Description: A retrospective execution of an OperationDefinition. A prov:Activity.
--     * Slot: execution_id Description: Stable workflow-execution identifier.
--     * Slot: executes_operation Description: The OperationDefinition this execution realizes.
--     * Slot: started_at Description: Execution start.
--     * Slot: ended_at Description: Execution end.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: QueryDefinition Description: One physical computation and memoization boundary. Its realizes_operations links are prospective mappings and do not imply that those semantic operations were applied in a particular run.
--     * Slot: query_id Description: Stable physical-query identifier.
--     * Slot: query_group_id Description: Presentation-only query-group identity.
--     * Slot: WorkflowPlan_plan_id Description: Autocreated FK slot
-- # Class: QueryExecution Description: Retrospective evidence for one physical query. Kept distinct from OperationExecution because a fused query can realize several semantic operations with different applicability.
--     * Slot: id
--     * Slot: executes_query Description: The QueryDefinition this execution realizes.
--     * Slot: query_execution_status Description: Observed physical execution state.
--     * Slot: query_input_key Description: Content identity of the query's exact effective inputs.
--     * Slot: query_output_digest Description: Content identity of the query output.
--     * Slot: query_reason_id Description: Stable identity of the evidence supporting the state.
--     * Slot: part_of_execution Description: Root workflow execution containing this query execution.
--     * Slot: execution_started_at Description: Evidence timestamp for the query execution.
--     * Slot: execution_ended_at Description: Evidence timestamp for the query execution.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: ReconstructionExecution Description: The execution that produced a usage assertion. A prov:Activity.
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
-- # Class: OperationDefinition_consumes
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: consumes Description: Channels or inputs the operation reads.
-- # Class: OperationDefinition_produces
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: produces Description: Channels or outputs the operation produces.
-- # Class: OperationDefinition_depends_on
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: depends_on Description: Operations that must precede this one.
-- # Class: OperationDefinition_configuration_dependencies
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: configuration_dependencies Description: Direct configuration fields read by this operation.
-- # Class: OperationDefinition_data_effects
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: data_effects Description: Declared effects such as preserve, drop, split, classify, or encode.
-- # Class: QueryDefinition_query_dependencies
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_dependencies_query_id Description: Direct upstream physical queries.
-- # Class: QueryDefinition_realizes_operations
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: realizes_operations_operation_id Description: Semantic operations this query may realize.
-- # Class: QueryDefinition_query_outputs
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_outputs Description: Independently identified output artifacts or ports.
-- # Class: QueryDefinition_query_request_fields
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_request_fields Description: Exact request fields read by the query.

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

CREATE TABLE "WorkflowPlan" (
	plan_id TEXT NOT NULL,
	PRIMARY KEY (plan_id)
);
CREATE INDEX "ix_WorkflowPlan_plan_id" ON "WorkflowPlan" (plan_id);

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

CREATE TABLE "OperationDefinition" (
	operation_id TEXT NOT NULL,
	verb TEXT,
	engine TEXT,
	operation_role TEXT,
	epistemic_role TEXT,
	is_fatal BOOLEAN,
	part_of_operation TEXT,
	"WorkflowPlan_plan_id" TEXT,
	PRIMARY KEY (operation_id),
	FOREIGN KEY(part_of_operation) REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY("WorkflowPlan_plan_id") REFERENCES "WorkflowPlan" (plan_id)
);
CREATE INDEX "ix_OperationDefinition_operation_id" ON "OperationDefinition" (operation_id);

CREATE TABLE "QueryDefinition" (
	query_id TEXT NOT NULL,
	query_group_id TEXT NOT NULL,
	"WorkflowPlan_plan_id" TEXT,
	PRIMARY KEY (query_id),
	FOREIGN KEY("WorkflowPlan_plan_id") REFERENCES "WorkflowPlan" (plan_id)
);
CREATE INDEX "ix_QueryDefinition_query_id" ON "QueryDefinition" (query_id);

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

CREATE TABLE "OperationExecution" (
	execution_id TEXT NOT NULL,
	executes_operation TEXT,
	started_at TEXT,
	ended_at TEXT,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (execution_id),
	FOREIGN KEY(executes_operation) REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_OperationExecution_execution_id" ON "OperationExecution" (execution_id);

CREATE TABLE "OperationDefinition_consumes" (
	"OperationDefinition_operation_id" TEXT,
	consumes TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", consumes),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_consumes_consumes" ON "OperationDefinition_consumes" (consumes);
CREATE INDEX "ix_OperationDefinition_consumes_OperationDefinition_operation_id" ON "OperationDefinition_consumes" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_produces" (
	"OperationDefinition_operation_id" TEXT,
	produces TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", produces),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_produces_OperationDefinition_operation_id" ON "OperationDefinition_produces" ("OperationDefinition_operation_id");
CREATE INDEX "ix_OperationDefinition_produces_produces" ON "OperationDefinition_produces" (produces);

CREATE TABLE "OperationDefinition_depends_on" (
	"OperationDefinition_operation_id" TEXT,
	depends_on TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", depends_on),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_depends_on_depends_on" ON "OperationDefinition_depends_on" (depends_on);
CREATE INDEX "ix_OperationDefinition_depends_on_OperationDefinition_operation_id" ON "OperationDefinition_depends_on" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_configuration_dependencies" (
	"OperationDefinition_operation_id" TEXT,
	configuration_dependencies TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", configuration_dependencies),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_configuration_dependencies_configuration_dependencies" ON "OperationDefinition_configuration_dependencies" (configuration_dependencies);
CREATE INDEX "ix_OperationDefinition_configuration_dependencies_OperationDefinition_operation_id" ON "OperationDefinition_configuration_dependencies" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_data_effects" (
	"OperationDefinition_operation_id" TEXT,
	data_effects TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", data_effects),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_data_effects_data_effects" ON "OperationDefinition_data_effects" (data_effects);
CREATE INDEX "ix_OperationDefinition_data_effects_OperationDefinition_operation_id" ON "OperationDefinition_data_effects" ("OperationDefinition_operation_id");

CREATE TABLE "QueryDefinition_query_dependencies" (
	"QueryDefinition_query_id" TEXT,
	query_dependencies_query_id TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_dependencies_query_id),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(query_dependencies_query_id) REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_dependencies_query_dependencies_query_id" ON "QueryDefinition_query_dependencies" (query_dependencies_query_id);
CREATE INDEX "ix_QueryDefinition_query_dependencies_QueryDefinition_query_id" ON "QueryDefinition_query_dependencies" ("QueryDefinition_query_id");

CREATE TABLE "QueryDefinition_realizes_operations" (
	"QueryDefinition_query_id" TEXT,
	realizes_operations_operation_id TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", realizes_operations_operation_id),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(realizes_operations_operation_id) REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_QueryDefinition_realizes_operations_realizes_operations_operation_id" ON "QueryDefinition_realizes_operations" (realizes_operations_operation_id);
CREATE INDEX "ix_QueryDefinition_realizes_operations_QueryDefinition_query_id" ON "QueryDefinition_realizes_operations" ("QueryDefinition_query_id");

CREATE TABLE "QueryDefinition_query_outputs" (
	"QueryDefinition_query_id" TEXT,
	query_outputs TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_outputs),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_outputs_query_outputs" ON "QueryDefinition_query_outputs" (query_outputs);
CREATE INDEX "ix_QueryDefinition_query_outputs_QueryDefinition_query_id" ON "QueryDefinition_query_outputs" ("QueryDefinition_query_id");

CREATE TABLE "QueryDefinition_query_request_fields" (
	"QueryDefinition_query_id" TEXT,
	query_request_fields TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_request_fields),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_request_fields_query_request_fields" ON "QueryDefinition_query_request_fields" (query_request_fields);
CREATE INDEX "ix_QueryDefinition_query_request_fields_QueryDefinition_query_id" ON "QueryDefinition_query_request_fields" ("QueryDefinition_query_id");

CREATE TABLE "EffectiveUsageMeasure" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	date DATE,
	effective_minutes FLOAT,
	produced_by TEXT,
	coverage_policy TEXT,
	denotes_interval_id INTEGER,
	cites_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(produced_by) REFERENCES "OperationExecution" (execution_id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(cites_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_EffectiveUsageMeasure_id" ON "EffectiveUsageMeasure" (id);

CREATE TABLE "QueryExecution" (
	id INTEGER NOT NULL,
	executes_query TEXT NOT NULL,
	query_execution_status VARCHAR(10) NOT NULL,
	query_input_key TEXT NOT NULL,
	query_output_digest TEXT NOT NULL,
	query_reason_id TEXT NOT NULL,
	part_of_execution TEXT NOT NULL,
	execution_started_at DATETIME NOT NULL,
	execution_ended_at DATETIME NOT NULL,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(executes_query) REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(part_of_execution) REFERENCES "OperationExecution" (execution_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_QueryExecution_id" ON "QueryExecution" (id);


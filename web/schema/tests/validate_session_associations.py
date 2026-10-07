#!/usr/bin/env python3
"""Same supplied-record example as ingress/GUI, not a recovered/mined dataset."""
import json
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "generated/pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    SessionAssociationDatabaseRecord, SessionTransactionRecord,
    AssociationRuleRecord, AssociationContextItemRecord,
    TaskOccurrenceRecord, AppFeatureSessionRecord, ParticipantDayObservationRecord,
)

schema = json.loads((root / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
records = json.loads((root.parent / "e2e/fixtures/habitual-association-example.json.fixture").read_text())["session_association_databases"]

def validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})

def preserved(cls, row):
    validator(cls).validate(row)
    assert cls(**row).model_dump(exclude_unset=True) == row

for database in records:
    preserved(SessionAssociationDatabaseRecord, database)
    for transaction in database.get("session_transactions") or []:
        preserved(SessionTransactionRecord, transaction)
        for field in ["present_context_items", "absent_context_items"]:
            for context in transaction.get(field) or []:
                preserved(AssociationContextItemRecord, context)
    for rule in database.get("association_rules") or []:
        preserved(AssociationRuleRecord, rule)

database = records[0]
for old in [TaskOccurrenceRecord, AppFeatureSessionRecord, ParticipantDayObservationRecord]:
    assert not validator(old).is_valid(database), f"{old.__name__} is not a populated mining database"
reversed_rule = deepcopy(database)
rule = reversed_rule["association_rules"][0]
rule["antecedent_app_items"], rule["consequent_app_items"] = rule["consequent_app_items"], rule["antecedent_app_items"]
preserved(SessionAssociationDatabaseRecord, reversed_rule)
assert reversed_rule != database
for cls, row, fields in [
    (SessionAssociationDatabaseRecord, database, ["association_group_label", "grouping_setting_reference", "transaction_definition_setting_reference", "session_transactions", "association_rules", "device_id"]),
    (SessionTransactionRecord, records[1]["session_transactions"][0], ["denotes_interval", "present_app_items", "absent_app_items", "present_context_items", "absent_context_items"]),
    (AssociationRuleRecord, database["association_rules"][0], ["antecedent_app_items", "consequent_app_items", "antecedent_context_items", "consequent_context_items", "rule_quality_values_json", "rule_annotation_json"]),
    (AssociationContextItemRecord, records[1]["session_transactions"][0]["present_context_items"][0], ["context_dimension"]),
]:
    for field in fields:
        for omitted in [False, True]:
            variant = deepcopy(row)
            if omitted:
                variant.pop(field, None)
            else:
                variant[field] = None
            preserved(cls, variant)
for cls, row, field in [
    (SessionAssociationDatabaseRecord, database, "analysis_run_id"),
    (SessionTransactionRecord, records[1]["session_transactions"][0], "source_session_id"),
    (AssociationRuleRecord, database["association_rules"][0], "association_rule_id"),
    (AssociationContextItemRecord, records[1]["session_transactions"][0]["present_context_items"][0], "context_item_label"),
]:
    invalid = deepcopy(row)
    invalid.pop(field)
    assert not validator(cls).is_valid(invalid)
invalid = deepcopy(database)
invalid["executed_mining_receipt"] = "invented"
assert not validator(SessionAssociationDatabaseRecord).is_valid(invalid)
print("association generated shapes: shared database/transaction/rule/context records, null/omission and reversal preserved; 3 incompatible carriers and 5 structural negatives passed; stronger semantics checked by real ingress")

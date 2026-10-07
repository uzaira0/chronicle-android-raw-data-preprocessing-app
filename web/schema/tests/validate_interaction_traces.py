#!/usr/bin/env python3
"""Validate the same ODIM constructed trace used by the importer and browser."""
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator
from pydantic import ValidationError

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "generated/pydantic"))
from chronicle_research_ontology import InteractionTraceRecord, InteractionEventRecord  # noqa: E402

schema = json.loads((root / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
traces = json.loads(subprocess.check_output([
    "node", "--experimental-strip-types", "--input-type=module", "-e",
    'import {odimInteractionTraceExample} from "./e2e/fixtures/odim-interaction-trace.ts";'
    'console.log(JSON.stringify(odimInteractionTraceExample(null).interaction_traces));',
], cwd=root.parent, text=True))

for cls, row, field in [
    (InteractionTraceRecord, traces[0], "trace_description"),
    (InteractionEventRecord, traces[0]["interaction_events"][0], "screen_description"),
]:
    validator = Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})
    for value in [row[field], None, "", "  café 日本語\n<script>text only</script>  "]:
        variant = deepcopy(row)
        variant[field] = value
        validator.validate(variant)
        assert cls(**variant).model_dump(exclude_unset=True) == variant
    omitted = deepcopy(row)
    del omitted[field]
    validator.validate(omitted)
    assert cls(**omitted).model_dump(exclude_unset=True) == omitted
    for value in [0, False, [], {"text": "not a string"}]:
        invalid = deepcopy(row)
        invalid[field] = value
        assert not validator.is_valid(invalid)
        try:
            cls(**invalid)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"{cls.__name__}.{field} accepted {value!r}")
print("ODIM descriptions: generated schemas preserve text/null/omission and reject non-text; actual nested trace fixture retained")

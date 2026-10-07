#!/usr/bin/env python3
"""Preserve optional enums and conditional presence in LinkML1.10 JSON Schema."""
import sys
from linkml.generators.jsonschemagen import JsonSchema, JsonSchemaGenerator


class NullableEnumJsonSchemaGenerator(JsonSchemaGenerator):
    def get_subschema_for_anonymous_class(self, expression, properties_required=False):
        result = super().get_subschema_for_anonymous_class(expression, properties_required)
        if result is not None:
            for condition in expression.slot_conditions.values():
                if condition.required or str(condition.value_presence) == "PRESENT":
                    # LinkML1.10 emits conditional presence but omits range types.
                    # Preserve the declared non-null type, including array ranges.
                    declared = self.schemaview.get_slot(condition.name)
                    if declared is not None:
                        name = self.aliased_slot_name(condition)
                        result["properties"][name] = JsonSchema({"allOf": [
                            self.get_subschema_for_slot(declared, include_null=False),
                            result["properties"][name],
                        ]})
            absent = [self.aliased_slot_name(condition)
                      for condition in expression.slot_conditions.values()
                      if str(condition.value_presence) == "ABSENT"]
            if absent:
                # not(required=[a,b]) forbids only their joint presence, not each.
                result["not"] = JsonSchema({"anyOf": [{"required": [name]} for name in absent]})
        return result

    def get_subschema_for_slot(self, slot, omit_type=False, include_null=True):
        result = super().get_subschema_for_slot(slot, omit_type, include_null)
        # LinkML1.10 includes null for optional scalar/class ranges but omits it
        # for a bare enum $ref. Required enums and multivalued members stay strict.
        if not omit_type and include_null and not slot.required and "$ref" in result \
                and slot.range in self.schemaview.all_enums():
            return JsonSchema({"anyOf": [result, {"type": "null"}]})
        return result


if __name__ == "__main__":
    print(NullableEnumJsonSchemaGenerator(sys.argv[1]).serialize(), end="")

"""Focused regression test for whole-profile compound setting coverage."""

import importlib.util
import unittest
from pathlib import Path

SCRIPT = (
    Path(__file__).parents[1] / "scripts/validate-android-profile-execution-spec.py"
)
SPEC = importlib.util.spec_from_file_location("android_profile_execution_spec", SCRIPT)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)
DRIVER_SCRIPT = (
    Path(__file__).parents[1] / "scripts/run-android-method-profile-conformance.py"
)
DRIVER_SPEC = importlib.util.spec_from_file_location(
    "android_profile_conformance_driver", DRIVER_SCRIPT
)
assert DRIVER_SPEC and DRIVER_SPEC.loader
DRIVER = importlib.util.module_from_spec(DRIVER_SPEC)
DRIVER_SPEC.loader.exec_module(DRIVER)


class CompoundCoverageTest(unittest.TestCase):
    def test_partial_schoedel_component_run_is_rejected_and_complete_run_is_admitted(
        self,
    ):
        profile_id = "method-profile:doi:10.1016/j.chb.2023.107977"
        profile = {"method_profile_id": profile_id}
        components = [
            component
            for (parent_id, _), component in VALIDATOR.registered_components().items()
            if parent_id == profile_id
        ]
        self.assertGreaterEqual(len(components), 2)
        component_setting_ids = [
            setting_id
            for component in components
            for setting_id in component["settingIds"]
        ]
        receipt = {
            "settingIds": [
                "setting-core",
                *component_setting_ids,
                "setting-external",
                "setting-documentary",
            ],
            "bindings": [{"settingId": "setting-core"}],
            "inputBindings": [
                {
                    "settingId": setting_id,
                    "adapterId": component["componentId"].rsplit("/", 1)[0],
                    "adapterVersion": component["componentId"].rsplit("/", 1)[1],
                }
                for component in components
                for setting_id in component["settingIds"]
            ],
            "externalBindings": [
                {
                    "executorId": "external:test",
                    "sourceConfigurationId": "campaign:test",
                    "settingIds": ["setting-external"],
                }
            ],
            "documentaryBindings": [{"settingId": "setting-documentary"}],
        }
        expectation = VALIDATOR.compound_lane_expectation(receipt, profile)
        driver_expectation = DRIVER.compound_expectation(receipt, profile_id)
        self.assertEqual(driver_expectation["core"], expectation["core"])
        self.assertEqual(
            [
                component["componentId"]
                for component in driver_expectation["components"]
            ],
            [component["componentId"] for component in expectation["components"]],
        )
        self.assertEqual(driver_expectation["external"], expectation["external"])
        self.assertEqual(driver_expectation["documentary"], expectation["documentary"])

        complete = {
            "core": {"settingIds": ["setting-core"]},
            "components": [
                {
                    "componentId": component["componentId"],
                    "settingIds": component["settingIds"],
                }
                for component in components
            ],
            "external": [
                {
                    "executorId": "external:test",
                    "sourceConfigurationId": "campaign:test",
                    "settingIds": ["setting-external"],
                }
            ],
            "documentary": {"settingIds": ["setting-documentary"]},
        }
        partial = {
            **complete,
            "components": complete["components"][:1],
        }
        with self.assertRaisesRegex(
            VALIDATOR.ValidationError, "component count is not exact"
        ):
            VALIDATOR.validate_compound_lane_coverage(partial, expectation)
        VALIDATOR.validate_compound_lane_coverage(complete, expectation)


if __name__ == "__main__":
    unittest.main()

"""Run with the pinned operator Python environment; no live controller required."""
import base64
import importlib.util
import pathlib
import unittest

from openshell._proto import openshell_pb2 as api, sandbox_pb2 as policy

path = pathlib.Path(__file__).parents[2] / "scripts/local/upgrade-rpc.py"
spec = importlib.util.spec_from_file_location("upgrade_rpc", path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Controller:
    def __init__(self):
        self.sandbox = api.Sandbox()
        self.sandbox.metadata.id = "00000000-0000-4000-8000-000000000002"
        self.sandbox.metadata.name = "cs-test"
        self.sandbox.metadata.labels["clawscarf.installation"] = "owner"
        self.sandbox.metadata.resource_version = 9223372036854775800
        self.sandbox.status.phase = api.SANDBOX_PHASE_STOPPED
        self.sandbox.spec.command.extend(["/app/clawscarf/bin/openclaw", "gateway"])
        self.sandbox.spec.providers.append("configured-provider")
        self.sandbox.spec.environment["PRESERVED"] = "value"
        self.sandbox.spec.policy.version = 1
        self.effective = policy.GetSandboxConfigResponse(policy_source=policy.POLICY_SOURCE_SANDBOX)
        self.effective.policy.version = 1
        self.effective.settings["explicit-false"].scope = policy.SETTING_SCOPE_SANDBOX
        self.effective.settings["explicit-false"].value.bool_value = False
        self.effective.settings["large-integer"].scope = policy.SETTING_SCOPE_SANDBOX
        self.effective.settings["large-integer"].value.int_value = 9223372036854775800
        self.effective.settings["unset"].scope = policy.SETTING_SCOPE_UNSPECIFIED
        self.gateway = policy.GetGatewayConfigResponse()
        self.gateway.settings["registered-but-unset"].CopyFrom(policy.SettingValue())
        self.loaded = api.GetSandboxPolicyStatusResponse(active_version=2)
        self.loaded.revision.version = 2
        self.loaded.revision.status = api.POLICY_STATUS_LOADED
        self.loaded.revision.policy.version = 1
        self.loaded.revision.policy.network_policies["current-rule"].endpoints.add(host="example.com", port=443)
        self.updates = []
        self.created = None

    def GetSandbox(self, request, timeout):
        return api.SandboxResponse(sandbox=self.sandbox)

    def GetSandboxConfig(self, request, timeout):
        return self.effective

    def GetGatewayConfig(self, request, timeout):
        return self.gateway

    def GetSandboxPolicyStatus(self, request, timeout):
        return self.loaded

    def UpdateConfig(self, request, timeout):
        self.updates.append(request)
        setting = self.effective.settings[request.setting_key]
        setting.scope = policy.SETTING_SCOPE_SANDBOX
        setting.value.CopyFrom(request.setting_value)
        return api.UpdateConfigResponse()

    def CreateSandbox(self, request, timeout):
        self.created = request
        return api.SandboxResponse(sandbox=self.sandbox)


class UpgradeProtocolTest(unittest.TestCase):
    def setUp(self):
        self.controller = Controller()
        self.request = {"name": "cs-test", "id": self.controller.sandbox.metadata.id, "ownerId": "owner"}

    def test_snapshot_preserves_current_base_policy_and_exact_spec(self):
        result = bridge.snapshot(self.controller, self.request)
        request = api.CreateSandboxRequest.FromString(base64.b64decode(result["create"]))
        self.assertIn("current-rule", request.spec.policy.network_policies)
        self.assertEqual(request.spec.environment["PRESERVED"], "value")
        self.assertEqual(list(request.spec.providers), ["configured-provider"])
        self.assertEqual(result["resourceVersion"], "9223372036854775800")

    def test_global_false_is_configured_not_unset(self):
        self.controller.gateway.settings["explicit-false"].bool_value = False
        with self.assertRaisesRegex(bridge.Refused, "global_overrides_unsupported"):
            bridge.snapshot(self.controller, self.request)

    def test_unloaded_policy_is_not_promoted(self):
        self.controller.loaded.revision.status = api.POLICY_STATUS_FAILED
        with self.assertRaisesRegex(bridge.Refused, "policy_not_loaded"):
            bridge.snapshot(self.controller, self.request)

    def test_restore_preserves_false_and_int64_without_string_coercion(self):
        snapshot = bridge.snapshot(self.controller, self.request)
        self.controller.effective.settings["explicit-false"].Clear()
        self.controller.effective.settings["large-integer"].Clear()
        bridge.perform(self.controller, {**self.request, "action": "restore", "snapshot": snapshot})
        self.assertEqual(len(self.controller.updates), 2)
        values = {value.setting_key: value.setting_value for value in self.controller.updates}
        self.assertEqual(values["explicit-false"].WhichOneof("value"), "bool_value")
        self.assertFalse(values["explicit-false"].bool_value)
        self.assertEqual(values["large-integer"].int_value, 9223372036854775800)
        bridge.perform(self.controller, {**self.request, "action": "restore", "snapshot": snapshot})
        self.assertEqual(len(self.controller.updates), 2)

    def test_resume_observes_write_committed_before_lost_response(self):
        snapshot = bridge.snapshot(self.controller, self.request)
        self.controller.effective.settings["explicit-false"].Clear()
        update = self.controller.UpdateConfig
        def lost(request, timeout):
            update(request, timeout)
            raise TimeoutError("response lost")
        self.controller.UpdateConfig = lost
        request = {**self.request, "action": "restore", "snapshot": snapshot}
        with self.assertRaises(TimeoutError):
            bridge.perform(self.controller, request)
        self.controller.UpdateConfig = update
        bridge.perform(self.controller, request)
        self.assertEqual(len(self.controller.updates), 1)

    def test_restore_refuses_an_unexpected_configured_value(self):
        snapshot = bridge.snapshot(self.controller, self.request)
        self.controller.effective.settings["explicit-false"].value.bool_value = True
        with self.assertRaisesRegex(bridge.Refused, "configuration_changed"):
            bridge.perform(self.controller, {**self.request, "action": "restore", "snapshot": snapshot})
        self.assertEqual(self.controller.updates, [])

    def test_create_preserves_provider_and_environment_and_sets_unique_gate(self):
        snapshot = bridge.snapshot(self.controller, self.request)
        bridge.perform(self.controller, {**self.request, "action": "create", "snapshot": snapshot,
                                        "image": "sha256:new", "generation": "test-generation"})
        created = self.controller.created
        self.assertEqual(created.spec.environment["PRESERVED"], "value")
        self.assertEqual(created.spec.environment["CLAWSCARF_START_GATE"], "test-generation")
        self.assertEqual(created.labels["clawscarf.upgrade"], "test-generation")
        self.assertEqual(list(created.spec.providers), ["configured-provider"])


if __name__ == "__main__":
    unittest.main()

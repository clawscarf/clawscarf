"""The operator bridge fails closed without disclosing SDK exception contents."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sdk = types.ModuleType("openshell.sandbox")
sdk.SandboxClient = object
sys.modules["openshell"] = types.ModuleType("openshell")
sys.modules["openshell.sandbox"] = sdk
spec = importlib.util.spec_from_file_location("transport", Path(__file__).parents[2] / "scripts/packs/transport.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class Input(io.StringIO):
    @property
    def buffer(self):
        return io.BytesIO(self.getvalue().encode())


class BridgeTests(unittest.TestCase):
    def request(self, **changes):
        return dict(gateway="clawscarf", sandboxId="00000000-0000-4000-8000-000000000001", command=["true"], stdin="", **changes)

    def test_uuid_target_and_no_secret_env(self):
        request = self.request()
        client = unittest.mock.MagicMock()
        session = client.from_active_cluster.return_value.__enter__.return_value
        session.exec.return_value = types.SimpleNamespace(exit_code=0, stdout="ok", stderr="")
        with patch.object(transport, "SandboxClient", client), patch.object(sys, "stdin", Input(json.dumps(request))), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(transport.main(), 0)
        self.assertEqual(output.getvalue(), "ok")
        session.exec.assert_called_once_with(request["sandboxId"], ["true"], env={"OPENCLAW_EXPERIMENTAL_CLAWS": "1"}, stdin=b"", timeout_seconds=110)

    def test_invalid_envelope_never_dispatches(self):
        for change in [{"stdin": None}, {"sandboxId": "reused-name"}, {"command": "shell"}, {"extra": True}]:
            request = self.request()
            request.update(change)
            client = unittest.mock.MagicMock()
            with patch.object(transport, "SandboxClient", client), patch.object(sys, "stdin", Input(json.dumps(request))), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(transport.main(), 2)
            client.from_active_cluster.assert_not_called()

    def test_uncertain_outcome_never_replays_or_prints_sdk_secrets(self):
        client = unittest.mock.MagicMock()
        client.from_active_cluster.return_value.__enter__.return_value.exec.side_effect = RuntimeError("secret-controller-token")
        with patch.object(transport, "SandboxClient", client), patch.object(sys, "stdin", Input(json.dumps(self.request()))), contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(transport.main(), 3)
        self.assertNotIn("secret-controller-token", errors.getvalue())
        self.assertIn("no confirmed completion", errors.getvalue())
        self.assertEqual(client.from_active_cluster.return_value.__enter__.return_value.exec.call_count, 1)


unittest.main()

"""Pinned public OpenShell protobuf RPCs absent from its high-level SandboxClient.

Operator-only: private mTLS material and snapshots never enter the runtime image.
The published SDK supplies generated messages; no private client attributes are used.
"""
import base64
import json
import pathlib
import sys

import grpc
from openshell._proto import openshell_pb2 as api, openshell_pb2_grpc, sandbox_pb2 as policy


class Refused(Exception):
    pass


def encode(message):
    return base64.b64encode(message.SerializeToString(deterministic=True)).decode("ascii")


def decode(value, kind):
    result = kind()
    result.ParseFromString(base64.b64decode(value, validate=True))
    return result


def current(stub, request):
    result = stub.GetSandbox(api.GetSandboxRequest(name=request["name"], workspace="default"), timeout=15).sandbox
    if result.metadata.id != request["id"] or result.metadata.labels.get("clawscarf.installation") != request["ownerId"]:
        raise Refused("identity_changed")
    return result


def config(stub, sandbox):
    return stub.GetSandboxConfig(policy.GetSandboxConfigRequest(sandbox_id=sandbox.metadata.id), timeout=15)


def no_globals(stub, effective):
    global_settings = stub.GetGatewayConfig(policy.GetGatewayConfigRequest(), timeout=15)
    if any(value.WhichOneof("value") is not None for value in global_settings.settings.values()) or effective.policy_source != policy.POLICY_SOURCE_SANDBOX:
        raise Refused("global_overrides_unsupported")


def snapshot(stub, request):
    sandbox = current(stub, request)
    if sandbox.status.phase != api.SANDBOX_PHASE_STOPPED:
        raise Refused("runtime_not_stopped")
    effective = config(stub, sandbox)
    no_globals(stub, effective)
    revision = stub.GetSandboxPolicyStatus(api.GetSandboxPolicyStatusRequest(name=request["name"], workspace="default"), timeout=15)
    if revision.revision.status != api.POLICY_STATUS_LOADED or revision.active_version != revision.revision.version:
        raise Refused("policy_not_loaded")
    spec = api.SandboxSpec()
    spec.CopyFrom(sandbox.spec)
    spec.policy.CopyFrom(revision.revision.policy)
    if list(spec.command) != ["/app/clawscarf/bin/openclaw", "gateway"]:
        raise Refused("runtime_command_unsupported")
    create = api.CreateSandboxRequest(spec=spec, name=request["name"], workspace="default",
                                     labels=sandbox.metadata.labels, annotations=sandbox.metadata.annotations)
    result = {"create": encode(create), "effective": encode(effective),
              "resourceVersion": str(sandbox.metadata.resource_version)}
    # Reads are not a transaction: reject a revision changing during the snapshot.
    if current(stub, request).metadata.resource_version != sandbox.metadata.resource_version or encode(config(stub, sandbox)) != result["effective"]:
        raise Refused("configuration_changed")
    return result


def restored(stub, request, expected):
    sandbox = current(stub, request)
    actual = config(stub, sandbox)
    no_globals(stub, actual)
    if actual.policy != expected.policy or actual.settings != expected.settings:
        raise Refused("restoration_unverified")
    original = decode(request["snapshot"]["create"], api.CreateSandboxRequest)
    if list(sandbox.spec.providers) != list(original.spec.providers):
        raise Refused("configuration_changed")
    return {"verified": True}


def perform(stub, request):
    action = request["action"]
    if action == "snapshot":
        return snapshot(stub, request)
    original = decode(request["snapshot"]["create"], api.CreateSandboxRequest)
    expected = decode(request["snapshot"]["effective"], policy.GetSandboxConfigResponse)
    if original.name != request["name"] or original.labels.get("clawscarf.installation") != request["ownerId"]:
        raise Refused("identity_changed")
    if action == "create":
        no_globals(stub, expected)
        original.spec.template.image = request["image"]
        original.spec.environment["CLAWSCARF_START_GATE"] = request["generation"]
        original.labels["clawscarf.upgrade"] = request["generation"]
        result = stub.CreateSandbox(original, timeout=120).sandbox
        return {"id": result.metadata.id}
    if action == "verify":
        return restored(stub, request, expected)
    if action == "restore":
        sandbox = current(stub, request)
        no_globals(stub, config(stub, sandbox))
        for key, setting in expected.settings.items():
            if setting.scope != policy.SETTING_SCOPE_SANDBOX or setting.value.WhichOneof("value") is None:
                continue
            sandbox = current(stub, request)
            observed = config(stub, sandbox).settings.get(key)
            if observed is not None and observed == setting:
                continue
            if observed is not None and observed.value.WhichOneof("value") is not None:
                raise Refused("configuration_changed")
            # The pinned setting-update API has no atomic revision precondition.
            # Explicit resume skips observed matches and reapplies only unset values;
            # exclusive operator control prevents concurrent edits.
            stub.UpdateConfig(api.UpdateConfigRequest(name=request["name"], workspace="default", setting_key=key,
                setting_value=setting.value), timeout=15)
        return restored(stub, request, expected)
    raise Refused("invalid_request")


def main():
    try:
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise Refused("invalid_request")
        request = json.loads(raw)
        directory = pathlib.Path(request["controller"])
        settings = json.loads((directory / "controller.json").read_text())
        if settings["name"] != request["name"]:
            raise Refused("identity_changed")
        tls = directory / "tls"
        credentials = grpc.ssl_channel_credentials((tls / "ca.crt").read_bytes(),
            (tls / "client/tls.key").read_bytes(), (tls / "client/tls.crt").read_bytes())
        with grpc.secure_channel(f"127.0.0.1:{settings['port']}", credentials) as channel:
            result = perform(openshell_pb2_grpc.OpenShellStub(channel), request)
        output = json.dumps({"ok": True, "value": result})
        if len(output.encode()) > 4 * 1024 * 1024:
            raise Refused("response_too_large")
        print(output)
    except Refused as error:
        print(json.dumps({"ok": False, "code": str(error)}))
    except grpc.RpcError as error:
        print(json.dumps({"ok": False, "code": error.code().name}))
    except Exception:
        print(json.dumps({"ok": False, "code": "unavailable"}))


if __name__ == "__main__":
    main()

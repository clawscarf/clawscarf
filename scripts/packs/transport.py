"""Operator-only bridge to the pinned official OpenShell SDK; no runtime secrets."""
import base64
import json
import re
import sys
from uuid import UUID

from openshell.sandbox import SandboxClient

MAX_INPUT = 16 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024


def parse_request():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("Operator payload too large")
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != {
        "gateway", "sandboxId", "command", "stdin"
    }:
        raise ValueError("Invalid operator request")
    gateway = value["gateway"]
    sandbox_id = value["sandboxId"]
    command = value["command"]
    encoded = value["stdin"]
    if not isinstance(gateway, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", gateway):
        raise ValueError("Invalid gateway name")
    if not isinstance(sandbox_id, str) or str(UUID(sandbox_id)) != sandbox_id:
        raise ValueError("Invalid sandbox UUID")
    if not isinstance(command, list) or not 1 <= len(command) <= 128:
        raise ValueError("Invalid command")
    if not all(isinstance(arg, str) and len(arg) <= 8192 and "\0" not in arg for arg in command):
        raise ValueError("Invalid command argument")
    if not isinstance(encoded, str):
        raise ValueError("Invalid stdin")
    return gateway, sandbox_id, command, base64.b64decode(encoded, validate=True)


def main():
    try:
        gateway, sandbox_id, command, stdin = parse_request()
    except (ValueError, TypeError):
        sys.stderr.write("Invalid operator execution request.\n")
        return 2
    try:
        with SandboxClient.from_active_cluster(cluster=gateway, timeout=120) as client:
            result = client.exec(
                sandbox_id, command,
                env={"OPENCLAW_EXPERIMENTAL_CLAWS": "1"},
                stdin=stdin,
                timeout_seconds=110,
            )
    except Exception:
        sys.stderr.write("OpenShell execution has no confirmed completion; inspect native state before retrying.\n")
        return 3
    if result.exit_code != 0:
        sys.stderr.write(f"Native command exited with status {result.exit_code}; inspect native state before retrying.\n")
        return 1
    if len(result.stdout.encode("utf8")) > MAX_OUTPUT:
        sys.stderr.write("Native response exceeded the operator output limit; inspect native state before retrying.\n")
        return 3
    sys.stdout.write(result.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

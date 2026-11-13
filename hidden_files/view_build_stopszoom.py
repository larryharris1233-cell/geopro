#!/usr/bin/env python3
"""Single eas build:view --json read for the stops/zoom/black-marker build.
Prints id/status/artifacts/expirationDate. Never prints credentials."""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "6ad47c11-c174-4645-b534-16284fcef1d4"

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"

proc = subprocess.run(
    ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
    cwd="/home/hatch/workspace/trucker-app/geopro",
    env=env, capture_output=True, text=True, timeout=180)
out = re.sub(r"hsurr:\S+", "<redacted>", proc.stdout or "")
start = out.find("{")
if start < 0:
    print("VIEW_FAILED:", out[-500:])
    sys.exit(1)
obj, _ = json.JSONDecoder().raw_decode(out[start:])
print(json.dumps({
    "id": obj.get("id"),
    "status": obj.get("status"),
    "artifacts": obj.get("artifacts"),
    "expirationDate": obj.get("expirationDate"),
    "completedAt": obj.get("completedAt"),
    "error": obj.get("error"),
}))

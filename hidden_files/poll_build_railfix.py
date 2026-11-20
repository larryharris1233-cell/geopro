#!/usr/bin/env python3
"""Poll ONE EAS build via `eas build:view --json` until FINISHED.
Never resubmits. Token from the approved dynamic-credential store, never printed."""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "f8959c56-99c2-471a-a458-d9e6b23059ff"

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"


def view():
    proc = subprocess.run(
        ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
        cwd="/home/hatch/workspace/trucker-app/geopro",
        env=env, capture_output=True, text=True, timeout=300)
    out = proc.stdout or ""
    start, end = out.find("{"), out.rfind("}")
    if start < 0 or end < 0:
        return None, (out + (proc.stderr or ""))[-500:]
    try:
        return json.loads(out[start:end + 1]), None
    except json.JSONDecodeError as e:
        return None, f"JSON parse failed: {e}"


deadline = time.time() + 40 * 60
last_status = None
while time.time() < deadline:
    data, err = view()
    if data is None:
        print("view error:", err, flush=True)
        time.sleep(60)
        continue
    status = data.get("status")
    if status != last_status:
        print("STATUS:", status, flush=True)
        last_status = status
    if status == "FINISHED":
        arts = data.get("artifacts") or {}
        print("BUILD_URL:", arts.get("buildUrl"))
        print("ARCHIVE_URL:", arts.get("applicationArchiveUrl"))
        print("EXPIRES:", data.get("expirationDate"))
        print("COMPLETED:", data.get("completedAt"))
        sys.exit(0)
    if status in ("ERRORED", "CANCELED"):
        print("TERMINAL:", status, data.get("error"))
        sys.exit(2)
    time.sleep(60)

print("TIMEOUT waiting for FINISHED; last status:", last_status)
sys.exit(3)

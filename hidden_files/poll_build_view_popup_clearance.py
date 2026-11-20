#!/usr/bin/env python3
"""Poll the GeoPro pop-up-clearance EAS build via eas-cli build:view --json until
it finishes; print final status + APK URL + expiry. Never prints credentials."""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "e503d693-85b6-44fc-9599-240269c92431"

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"


def view():
    proc = subprocess.run(
        ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
        cwd="/home/hatch/workspace/trucker-app/geopro",
        env=env, capture_output=True, text=True, timeout=180)
    out = re.sub(r"hsurr:\S+", "<redacted>", proc.stdout or "")
    start = out.find("{")
    if start < 0:
        return None, out[-500:]
    try:
        obj, _ = json.JSONDecoder().raw_decode(out[start:])
        return obj, ""
    except Exception:
        return None, out[-500:]


for i in range(60):
    b, tail = view()
    if b is None:
        print(f"[{i}] view failed: {tail}", flush=True)
        time.sleep(60)
        continue
    status = b.get("status", "UNKNOWN")
    print(f"[{i}] status={status}", flush=True)
    if status in ("FINISHED", "ERRORED", "CANCELED"):
        print("FINAL:", json.dumps({
            "id": b.get("id"),
            "status": status,
            "artifacts": b.get("artifacts"),
            "expirationDate": b.get("expirationDate"),
            "error": b.get("error"),
            "completedAt": b.get("completedAt"),
        }), flush=True)
        break
    time.sleep(60)
else:
    print("FINAL: still not finished after 60 polls", flush=True)

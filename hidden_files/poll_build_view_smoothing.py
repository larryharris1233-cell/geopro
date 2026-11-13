#!/usr/bin/env python3
"""Poll the GeoPro EAS build via eas-cli build:view --json (the reliable
route per the Nov 1 run logs) until FINISHED / ERRORED / CANCELED.
Never prints credential values."""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "e111b69c-3364-4612-bfd4-a5e7e51be7fc"

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"

for i in range(40):
    proc = subprocess.run(
        ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
        cwd="/home/hatch/workspace/trucker-app/geopro",
        env=env, capture_output=True, text=True, timeout=300)
    try:
        d = json.loads(proc.stdout)
    except Exception:
        print(f"[{i}] build:view parse failed", flush=True)
        time.sleep(60)
        continue
    status = d.get("status", "UNKNOWN")
    print(f"[{i}] status={status}", flush=True)
    if status in ("FINISHED", "ERRORED", "CANCELED"):
        print("FINAL:", json.dumps({
            "id": d.get("id"),
            "status": status,
            "expirationDate": d.get("expirationDate"),
            "completedAt": d.get("completedAt"),
            "artifacts": d.get("artifacts") or {},
            "error": d.get("error"),
        }))
        break
    time.sleep(60)
else:
    print("FINAL: still not finished after 40 polls")

#!/usr/bin/env python3
"""Poll a Build #30 EAS build with `eas build:view --json` ONLY.

AGENTS.md lesson (Nov 7, 2026): the GraphQL byId poller once reported
FINISHED with a wrong artifact URL while build:view still showed
IN_PROGRESS. Trust build:view; on FINISHED print the artifact URL and
the expiry (createdAt + 90 days, the EAS artifact retention).

Usage: poll_build_build30.py <build-id> [timeout_seconds]
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = sys.argv[1]
TIMEOUT = int(sys.argv[2]) if len(sys.argv) > 2 else 1800

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"


def view() -> dict:
    proc = subprocess.run(
        ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
        cwd="/home/hatch/workspace/trucker-app/geopro",
        env=env, capture_output=True, text=True, timeout=300,
    )
    out = re.sub(r"hsurr:\S+", "<redacted>", proc.stdout or "")
    return json.loads(out)


deadline = time.time() + TIMEOUT
last = None
while True:
    info = view()
    status = info.get("status")
    if status != last:
        print(f"[{datetime.now(timezone.utc).isoformat()}] status={status}", flush=True)
        last = status
    if status in ("FINISHED", "ERRORED", "CANCELED"):
        print(json.dumps(info, indent=2))
        if status == "FINISHED":
            url = (info.get("artifacts") or {}).get("buildUrl")
            created = info.get("createdAt")
            if url:
                print(f"ARTIFACT_URL={url}")
            if created:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                print(f"EXPIRES~{(dt + timedelta(days=90)).date().isoformat()} (createdAt + 90d)")
        sys.exit(0 if status == "FINISHED" else 1)
    if time.time() > deadline:
        print("TIMEOUT waiting for build", file=sys.stderr)
        sys.exit(3)
    time.sleep(30)

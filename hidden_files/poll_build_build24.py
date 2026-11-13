#!/usr/bin/env python3
"""Poll build #24 via `eas build:view --json` until FINISHED/ERRORED.
Prints the artifact URL + expiry at the end. Token never printed."""
import json, os, re, subprocess, sys, time
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "2aa6c9d5-1015-42c5-837f-93f4dee5fc3c"
env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"

for i in range(60):
    proc = subprocess.run(
        ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
        cwd="/home/hatch/workspace/trucker-app/geopro", env=env,
        capture_output=True, text=True, timeout=180)
    try:
        data = json.loads(proc.stdout)
    except Exception:
        out = re.sub(r"hsurr:\S+", "<redacted>", (proc.stdout or "") + (proc.stderr or ""))
        print(f"[{i}] unparseable: {out[-200:]}", flush=True)
        time.sleep(45)
        continue
    status = data.get("status", "UNKNOWN")
    print(f"[{i}] status={status}", flush=True)
    if status in ("FINISHED", "ERRORED", "CANCELED"):
        arts = data.get("artifacts") or {}
        print("FINAL_STATUS:", status)
        print("BUILD_URL:", arts.get("buildUrl"))
        print("EXPIRES:", data.get("expirationDate"))
        print("COMPLETED:", data.get("completedAt"))
        err = data.get("error")
        if err:
            print("ERROR:", json.dumps(err)[:500])
        break
    time.sleep(45)
else:
    print("FINAL: still not finished after 60 polls")

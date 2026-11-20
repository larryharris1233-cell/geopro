#!/usr/bin/env python3
"""View a build via `eas build:view --json` (trusted status source).
Usage: view_build_multistop.py <build-id>  |  view_build_multistop.py list
Token from the credential store, never printed."""
import json, os, re, subprocess, sys
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"

if sys.argv[1] == "list":
    cmd = ["npx", "-y", "eas-cli@latest", "build:list", "--platform", "android",
           "--limit", "3", "--json", "--non-interactive"]
else:
    cmd = ["npx", "-y", "eas-cli@latest", "build:view", sys.argv[1], "--json"]

proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=300)
try:
    data = json.loads(proc.stdout)
except Exception:
    out = re.sub(r"hsurr:\S+", "<redacted>", (proc.stdout or "") + (proc.stderr or ""))
    print("UNPARSEABLE:", out[-500:])
    sys.exit(1)

def show(d):
    arts = d.get("artifacts") or {}
    print("ID:", d.get("id"))
    print("STATUS:", d.get("status"))
    print("MESSAGE:", (d.get("message") or "")[:80])
    print("BUILD_URL:", arts.get("buildUrl"))
    print("EXPIRES:", d.get("expirationDate"))
    print("COMPLETED:", d.get("completedAt"))
    err = d.get("error")
    if err:
        print("ERROR:", json.dumps(err)[:500])

if isinstance(data, list):
    for d in data:
        show(d)
        print("---")
else:
    show(data)

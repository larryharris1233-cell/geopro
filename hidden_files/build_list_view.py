#!/usr/bin/env python3
"""List the newest GeoPro EAS builds and view one build's details via
eas-cli (authoritative route). Never prints credential values."""
import json
import os
import subprocess
import sys

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
CWD = "/home/hatch/workspace/trucker-app/geopro"


def run(args):
    proc = subprocess.run(args, cwd=CWD, env=env, capture_output=True,
                          text=True, timeout=300)
    return proc


proc = run(["npx", "-y", "eas-cli@latest", "build:list", "--platform",
            "android", "--limit", "3", "--json", "--non-interactive"])
try:
    builds = json.loads(proc.stdout)
    for b in builds:
        print(json.dumps({
            "id": b.get("id"),
            "status": b.get("status"),
            "createdAt": b.get("createdAt"),
            "completedAt": b.get("completedAt"),
            "expirationDate": b.get("expirationDate"),
            "message": (b.get("message") or "")[:80],
            "buildUrl": (b.get("artifacts") or {}).get("buildUrl"),
        }))
except Exception:
    print("build:list parse failed; stderr tail:")
    print((proc.stderr or "")[-1500:])

if len(sys.argv) > 1:
    bid = sys.argv[1]
    proc = run(["npx", "-y", "eas-cli@latest", "build:view", bid, "--json"])
    try:
        d = json.loads(proc.stdout)
        print("VIEW:", json.dumps({
            "id": d.get("id"),
            "status": d.get("status"),
            "expirationDate": d.get("expirationDate"),
            "completedAt": d.get("completedAt"),
            "artifacts": d.get("artifacts") or {},
            "error": d.get("error"),
        }))
    except Exception:
        print("build:view parse failed; stderr tail:")
        print((proc.stderr or "")[-1500:])

#!/usr/bin/env python3
"""Verify the finished build: eas build:view --json for status/artifacts/expiry,
then a range GET on the artifact API URL (with surrogate auth) expecting
HTTP 206 and a PK\\x03\\x04 header. Never prints credential values."""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "822038cd-7e2f-47cc-acb0-3b23a7873b82"

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
proc = subprocess.run(
    ["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
    cwd="/home/hatch/workspace/trucker-app/geopro",
    env=env, capture_output=True, text=True, timeout=300)
view = {}
try:
    view = json.loads(proc.stdout)
except Exception:
    print("build:view JSON parse failed; stderr tail:", (proc.stderr or "")[-500:])
print("VIEW:", json.dumps({k: view.get(k) for k in
      ("id", "status", "expirationDate", "createdAt", "completedAt")}, indent=2))
arts = view.get("artifacts") or {}
print("ARTIFACTS:", json.dumps(arts, indent=2))
url = arts.get("buildUrl") or arts.get("applicationArchiveUrl")

if url:
    # The artifacts URL redirects to api.expo.dev/v2/artifacts/eas/<hash>;
    # request that endpoint directly with a Range header + surrogate auth.
    hash_part = url.rstrip("/").split("/")[-1]
    api_url = f"https://api.expo.dev/v2/artifacts/eas/{hash_part}"
    req = urllib.request.Request(api_url, method="GET")
    dc.add_surrogate_to_request(req, "custom.expo", entry_name="access_token",
                                allowed_hosts=["api.expo.dev"])
    req.add_header("Range", "bytes=0-1023")
    req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                 "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            head = resp.read(16)
            print("RANGE GET:", resp.status, resp.headers.get("Content-Type"),
                  "first-bytes:", head[:4])
    except urllib.error.HTTPError as e:
        body = e.read(200)
        print("RANGE GET HTTPError:", e.code, body[:200])

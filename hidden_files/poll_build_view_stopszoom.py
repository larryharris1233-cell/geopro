#!/usr/bin/env python3
"""Poll eas build:view for the stops/zoom/black-marker build until FINISHED,
then verify the artifact URL with a live range GET (HTTP 206 + PK header).
Known quirk: a FINISHED read can mint a not-yet-live URL — keep re-reading
build:view until a minted URL passes. Never prints credentials."""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "6ad47c11-c174-4645-b534-16284fcef1d4"

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
        return None
    obj, _ = json.JSONDecoder().raw_decode(out[start:])
    return obj


def url_live(url):
    proc = subprocess.run(
        ["curl", "-sL", "--range", "0-3", "-o", "/tmp/apk_head.bin",
         "-w", "%{http_code}", url],
        capture_output=True, text=True, timeout=120)
    code = proc.stdout.strip()
    try:
        with open("/tmp/apk_head.bin", "rb") as f:
            head = f.read(4)
    except OSError:
        head = b""
    return code, head


deadline = time.time() + 2400  # 40 min ceiling
attempt = 0
while time.time() < deadline:
    attempt += 1
    obj = view()
    if obj is None:
        print(f"[{attempt}] view parse failed, retrying", flush=True)
        time.sleep(45)
        continue
    status = obj.get("status")
    print(f"[{attempt}] status={status}", flush=True)
    if status == "FINISHED":
        url = (obj.get("artifacts") or {}).get("buildUrl")
        if not url:
            print("FINISHED but no buildUrl yet; re-reading", flush=True)
            time.sleep(45)
            continue
        code, head = url_live(url)
        print(f"artifact check: HTTP {code} head={head!r}", flush=True)
        if code == "206" and head[:2] == b"PK":
            print("VERIFIED_URL:", url)
            print("EXPIRY:", obj.get("expirationDate"))
            print("COMPLETED_AT:", obj.get("completedAt"))
            sys.exit(0)
        print("URL not live yet (known quirk); re-reading build:view", flush=True)
        time.sleep(60)
        continue
    if status in ("ERRORED", "CANCELED"):
        print("TERMINAL_FAILURE:", json.dumps(obj.get("error")))
        sys.exit(2)
    time.sleep(60)

print("TIMEOUT waiting for build")
sys.exit(3)

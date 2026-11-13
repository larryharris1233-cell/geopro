#!/usr/bin/env python3
"""Verify build #27: status from `eas build:view --json` (done by the
poller), then the APK byte check — live range GET expecting HTTP 206
and a PK zip header. Builds #23-#26 were blocked by Expo's changed
artifact delivery (403/1010); this script tries the public URL and
the authenticated API endpoint and reports exactly what each returns.
Token never printed."""
import json, os, subprocess, sys, urllib.error, urllib.request
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "51f3dfdc-3fd8-4ceb-98e1-e16ef1d8fab2"
env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
proc = subprocess.run(["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
    cwd="/home/hatch/workspace/trucker-app/geopro", env=env,
    capture_output=True, text=True, timeout=300)
view = json.loads(proc.stdout)
print("STATUS:", view.get("status"), "| EXPIRES:", view.get("expirationDate"),
      "| COMPLETED:", view.get("completedAt"))
url = (view.get("artifacts") or {}).get("buildUrl")
print("BUILD_URL:", url)

def try_range(label, req):
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            head = r.read(4)
            print(f"{label}: HTTP {r.status} | first bytes: {head!r} | PK: {head[:2] == b'PK'}")
            return r.status == 206 and head[:2] == b"PK"
    except urllib.error.HTTPError as e:
        body = e.read(200).decode("utf-8", "replace")
        print(f"{label}: HTTP {e.code} | {body[:150]}")
    except Exception as e:
        print(f"{label}: FAILED {type(e).__name__}: {e}")
    return False

# 1) Public artifact URL, unauthenticated range GET.
req = urllib.request.Request(url, method="GET", headers={"Range": "bytes=0-3"})
ok = try_range("public range GET", req)

# 2) Authenticated API endpoint (the URL the public one redirects to).
if not ok and url:
    hash_part = url.rstrip("/").split("/")[-1].replace(".apk", "")
    api_url = f"https://api.expo.dev/v2/artifacts/eas/{hash_part}"
    req2 = urllib.request.Request(api_url, method="GET", headers={"Range": "bytes=0-3"})
    dc.add_surrogate_to_request(req2, "custom.expo", entry_name="access_token",
                                allowed_hosts=["api.expo.dev"])
    ok = try_range("authed API range GET", req2)

print("BYTE_CHECK:", "VERIFIED (206 + PK)" if ok else "UNVERIFIED")

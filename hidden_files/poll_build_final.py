#!/usr/bin/env python3
"""Poll the GeoPro EAS build until it finishes; print final status + APK URL.
Never prints credential values."""
import json
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "a89a106c-e998-43d0-bbb3-66d21a7b4017"


def gql(query):
    req = urllib.request.Request(
        "https://api.expo.dev/graphql",
        data=json.dumps({"query": query}).encode(), method="POST")
    dc.add_surrogate_to_request(req, "custom.expo", entry_name="access_token",
                                allowed_hosts=["api.expo.dev"])
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                 "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return dc.read_json_response(resp)
    except urllib.error.HTTPError as e:
        return {"HTTP": e.code}


for i in range(50):
    r = gql('query { build { byId(buildId: "%s") { id status artifacts { buildUrl } '
            'error { errorCode message } } } }' % BUILD_ID)
    b = (r.get("data") or {}).get("build", {}).get("byId") or {}
    status = b.get("status", "UNKNOWN")
    print(f"[{i}] status={status}", flush=True)
    if status in ("FINISHED", "ERRORED", "CANCELED"):
        print("FINAL:", json.dumps(b))
        break
    time.sleep(60)
else:
    print("FINAL: still not finished after 50 polls")

#!/usr/bin/env python3
"""Fetch the build's expirationDate from the EAS GraphQL API. Never prints credentials."""
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "822038cd-7e2f-47cc-acb0-3b23a7873b82"


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


r = gql('query { build { byId(buildId: "%s") { id status expirationDate artifacts { buildUrl } '
        'createdAt updatedAt } } }' % BUILD_ID)
print(json.dumps(r.get("data") or r, indent=2))

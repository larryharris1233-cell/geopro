#!/usr/bin/env python3
"""Submit the Build #30 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build29.py —
token comes from the approved dynamic-credential store, never printed.
This build carries Austin's Nov 17-18, 2026 list (bug log items
8/8b/8c/8d, 9-21): the banner rule (next REAL maneuver only,
"continue straight" otherwise), keep-awake, day/night (sun-auto +
moon force), elevation + Report top-left stack, combined trip-stats
box, PiP framing fix, north-up re-snap, doubled lookahead + approach
zoom, the 2/1/0.2 mi voice ladder, Style B double-ding at the turn
moment only, four American voices, denser two-tone shields, and the
state-line welcome. First build carrying GOOGLE_GEOCODING_API_KEY
(EAS env, set Nov 18, 2026) into the Google address-search tier."""
import os
import re
import subprocess
import sys

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
env["EAS_NO_VCS"] = "0"

cmd = [
    "npx", "-y", "eas-cli@latest", "build",
    "--platform", "android",
    "--profile", "preview",
    "--non-interactive",
    "--no-wait",
    "--message", "Build #30: banner shows only the next REAL turn (continue straight + distance otherwise), 2/1/0.2 mi voice ladder, Style B ding at the turn moment only, keep-awake, sun-auto day/night + moon button, elevation + Report top-left, combined trip box, PiP framing fix, doubled lookahead + approach zoom, 4 American voices, denser shields, state-line welcome, Geocoding key live.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

#!/usr/bin/env python3
"""Submit the Build #24 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build23.py —
token comes from the approved dynamic-credential store, never printed."""
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
    "--message", "Build #24: lane guidance, Esri place-name label fix, current-road readout, heading-locked marker, destination-TZ arrival, interstate hop fix (maneuver_penalty 300 + dip guard), wider speed-scaled cruise zoom, POI multi-select + all-category 5-mi heads-ups, tap-to-speak banner, Then: arrow chip, long-press moves destination",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

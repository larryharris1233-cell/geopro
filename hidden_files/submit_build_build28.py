#!/usr/bin/env python3
"""Submit the full-list EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build27.py —
token comes from the approved dynamic-credential store, never printed.
This build carries the whole Nov 12-13 next-build list (items 1-12)
on top of build #27's marker commit (item 13, already in HEAD)."""
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
    "--message", "Build #28: full Nov 12-13 list on top of #27 marker build - 2mi cruise lookahead + turn zoom, repeated interstate shields on route, banner-clear buttons, big dedicated arrival cell, whole-route POI pins, muted non-route interstates, PiP live follow view + relaxed minimized detection, neon thicker route line, voice ducking focus (hammerlane-voice module) + More volume slider, speed-limit badge shows unknown, latching north-up compass. Marker tight-crop from #27 included.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

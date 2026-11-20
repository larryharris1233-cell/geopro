#!/usr/bin/env python3
"""Submit the Build #29 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build28.py —
token comes from the approved dynamic-credential store, never printed.
This build carries Austin's Nov 16, 2026 list: the address-search
fix (Esri validation + comma-less city peel + Google geocode tier),
3.5mi cruise lookahead, green thicker route line, Report button
moved bottom-right, neon all-roads overlay replacing the blue
interstate overlay, and denser route shields."""
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
    "--message", "Build #29: address search fixed (Esri state-name validation + comma-less city peel + Google geocoding fallback tier behind build-time key), cruise lookahead 3.5 mi, route line green + thicker, Report button bottom-right, blue interstate overlay replaced with neon all-roads overlay, shields every ~0.5 mi to 3.5 mi.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

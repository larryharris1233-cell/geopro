#!/usr/bin/env python3
"""Submit the Build #27 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build26.py —
token comes from the approved dynamic-credential store, never printed.
Build #27 carries the marker fix committed in 08b2ad0: pad, halo and
stage shadow removed; marker PNGs tight-cropped. Follow-up to #26."""
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
    "--message", "Build #27: truck marker is just the truck - dark pad, black silhouette halo and wrap stage shadow/elevation removed (per road test of #26: 'no shadow just truck perfectly'); marker PNGs tight-cropped to the truck (white 400x657 -> 379x650, blue 400x574 -> 383x562, red 400x660 -> 382x657, black already edge-to-edge). Marker frame unchanged. Everything else is build #26.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

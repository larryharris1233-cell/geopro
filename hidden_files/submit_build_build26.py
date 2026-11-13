#!/usr/bin/env python3
"""Submit the Build #26 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build24.py —
token comes from the approved dynamic-credential store, never printed.
Build #26 carries the road-test fixes committed in 14699c8:
course-up/marker bearing-feed root fix, bright-blue interstates,
Report button nudge. Follow-up to #25."""
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
    "--message", "Build #26: course-up root fix (region events carry bearing not heading - marker heading-lock feed was dead, truck pointed sideways across the vertical road; now truck points straight up course-up road), bright-blue interstate overlay (OpenFreeMap vector motorway class, white casing + #1E90FF core, both styles), Report button nudged down (bottom 124 -> 110). Truck marker image unchanged.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

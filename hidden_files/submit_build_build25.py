#!/usr/bin/env python3
"""Submit the Build #25 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_build24.py —
token comes from the approved dynamic-credential store, never printed.
Build #25 carries items 12+13 (committed in 691fbda, queued from #24):
compact destination card + branded POI badges."""
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
    "--message", "Build #25: compact destination card (opens small, Truck route/Start route, chevron expands), branded POI badges (blue P parking, CAT Scale badge, chain badges incl. Flying J from verified chain field). Follow-up to #24 carrying items 12+13.",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

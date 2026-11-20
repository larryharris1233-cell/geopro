#!/usr/bin/env python3
"""Submit the build #19 EAS preview build for GeoPro using the stored
custom.expo credential. Same pattern as submit_build_mapillary.py —
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
    "--message", "Build #19: PiP mini map, heading-up + heading readout, top turn banner, full address, auto re-center, parking size badges, heading readout in nav bar",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-4000:])
print("EXIT:", proc.returncode)

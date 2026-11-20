#!/usr/bin/env python3
"""Submit an EAS preview build for GeoPro using the stored custom.expo credential.
The surrogate token is passed via env only and never printed; output is scrubbed."""
import os
import re
import subprocess
import sys

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

entry = dc.dynamic_credential_entry("custom.expo", "access_token")
token = str(entry["surrogate"]).strip()

env = dict(os.environ)
env["EXPO_TOKEN"] = token
env["CI"] = "1"
env["EAS_NO_VCS"] = "0"

cmd = [
    "npx", "-y", "eas-cli@latest", "build",
    "--platform", "android",
    "--profile", "preview",
    "--non-interactive",
    "--no-wait",
    "--message", "POI across the USA: viewport + route-corridor loading for all 9 categories, 3x3 grid picker, bundled truck stops 60 -> 7,722 nationwide OSM extract",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=1200)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
out = out.replace(token, "<redacted>")
print(out[-4000:])
print("EXIT:", proc.returncode)

#!/usr/bin/env python3
"""List recent EAS builds to confirm none is in flight before submitting.
Token comes from the approved dynamic-credential store, never printed."""
import os
import re
import subprocess
import sys

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"

cmd = [
    "npx", "-y", "eas-cli@latest", "build:list",
    "--platform", "android",
    "--limit", "3",
    "--json",
    "--non-interactive",
]
proc = subprocess.run(cmd, cwd="/home/hatch/workspace/trucker-app/geopro",
                      env=env, capture_output=True, text=True, timeout=600)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
out = re.sub(r"hsurr:\S+", "<redacted>", out)
print(out[-3000:])
print("EXIT:", proc.returncode)

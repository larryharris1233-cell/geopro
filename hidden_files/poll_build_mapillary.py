#!/usr/bin/env python3
"""Poll ONE EAS build via `eas build:view --json` until FINISHED.
Never resubmits. Token from the approved dynamic-credential store, never printed."""
import json, os, subprocess, sys, time
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc
BUILD_ID = "0c5d4553-aa8c-4627-bc59-f201ba24b4f6"
env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
def view():
    proc = subprocess.run(["npx","-y","eas-cli@latest","build:view",BUILD_ID,"--json"],cwd="/home/hatch/workspace/trucker-app/geopro",env=env,capture_output=True,text=True,timeout=300)
    out = proc.stdout or ""
    s,e = out.find("{"), out.rfind("}")
    if s<0 or e<0: return None,(out+(proc.stderr or ""))[-500:]
    try: return json.loads(out[s:e+1]),None
    except Exception as ex: return None,str(ex)
deadline=time.time()+55*60
last=None
while time.time()<deadline:
    data,err=view()
    if data is None:
        print("view error:",err,flush=True); time.sleep(60); continue
    st=data.get("status")
    if st!=last: print("STATUS:",st,flush=True); last=st
    if st=="FINISHED":
        arts=data.get("artifacts") or {}
        print("BUILD_URL:",arts.get("buildUrl")); print("ARCHIVE_URL:",arts.get("applicationArchiveUrl")); print("EXPIRES:",data.get("expirationDate")); print("COMPLETED:",data.get("completedAt")); sys.exit(0)
    if st in ("ERRORED","CANCELED"):
        print("TERMINAL:",st,data.get("error")); sys.exit(2)
    time.sleep(60)
print("TIMEOUT last:",last); sys.exit(3)

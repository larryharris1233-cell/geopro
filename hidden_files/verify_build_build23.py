#!/usr/bin/env python3
"""Verify build #23: eas build:view --json, range GET (206 + PK),
then full APK pull to check embedded assets/app.config Mapillary
token (length/prefix only, value never printed),
supportsPictureInPicture in the compiled manifest, and the Route
home shortcut metadata (android.app.shortcuts in the manifest +
route-home / hammerlaneco strings in a compiled res XML)."""
import io, json, os, re, subprocess, sys, urllib.error, urllib.request, zipfile
sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

BUILD_ID = "56860f2e-2db2-4517-818b-a454efb1542e"
env = dict(os.environ)
env["EXPO_TOKEN"] = dc.dynamic_credential_entry("custom.expo", "access_token")["surrogate"]
env["CI"] = "1"
proc = subprocess.run(["npx", "-y", "eas-cli@latest", "build:view", BUILD_ID, "--json"],
    cwd="/home/hatch/workspace/trucker-app/geopro", env=env,
    capture_output=True, text=True, timeout=300)
view = json.loads(proc.stdout)
print("STATUS:", view.get("status"), "| EXPIRES:", view.get("expirationDate"),
      "| COMPLETED:", view.get("completedAt"))
url = (view.get("artifacts") or {}).get("buildUrl")
print("BUILD_URL:", url)
hash_part = url.rstrip("/").split("/")[-1].replace(".apk", "")
api_url = f"https://api.expo.dev/v2/artifacts/eas/{hash_part}"

def authed_req(range_hdr=None):
    req = urllib.request.Request(api_url, method="GET")
    dc.add_surrogate_to_request(req, "custom.expo", entry_name="access_token",
                                allowed_hosts=["api.expo.dev"])
    if range_hdr: req.add_header("Range", range_hdr)
    req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    return req

with urllib.request.urlopen(authed_req("bytes=0-1023"), timeout=60) as resp:
    head = resp.read(16)
    print("RANGE GET:", resp.status, "| first4:", head[:4], "| PK ok:", head[:4] == b"PK\x03\x04")

print("downloading full APK...")
with urllib.request.urlopen(authed_req(), timeout=600) as resp:
    data = resp.read()
print("APK bytes:", len(data))
z = zipfile.ZipFile(io.BytesIO(data))
names = z.namelist()

# Mapillary token in embedded app.config
cfg = None
for n in names:
    if n.endswith("assets/app.config"):
        cfg = z.read(n)
        break
tok_ok = False
if cfg:
    m = re.search(rb'"mapillaryToken"\s*:\s*"([^"]*)"', cfg)
    if m:
        tok = m.group(1).decode()
        print("MAPILLARY: len", len(tok), "| starts MLY:", tok.startswith("MLY"))
        tok_ok = len(tok) == 54 and tok.startswith("MLY")
    else:
        print("MAPILLARY: key not found in app.config")
else:
    print("MAPILLARY: assets/app.config missing")
print("MAPILLARY OK:", tok_ok)

# Compiled manifest: PiP flag + shortcuts meta-data (binary AXML stores strings as UTF-16LE; also try UTF-8)
man = z.read("AndroidManifest.xml")
def has_str(blob, s):
    return s.encode() in blob or s.encode("utf-16-le") in blob
print("PIP in manifest:", has_str(man, "supportsPictureInPicture"))
print("SHORTCUTS meta-data in manifest:", has_str(man, "android.app.shortcuts"))

# Compiled shortcuts XML: some res/*.xml whose string pool holds route-home / hammerlaneco://route-home
found = []
for n in names:
    if n.startswith("res/") and n.endswith(".xml"):
        b = z.read(n)
        if has_str(b, "route-home") and has_str(b, "hammerlaneco"):
            found.append(n)
print("SHORTCUT XML entries:", found)


# Build #23: configChanges resize flags in the compiled manifest.
print("CONFIGCHANGES screenSize in manifest:", has_str(man, "screenSize"))
print("CONFIGCHANGES smallestScreenSize in manifest:", has_str(man, "smallestScreenSize"))
print("CONFIGCHANGES screenLayout in manifest:", has_str(man, "screenLayout"))

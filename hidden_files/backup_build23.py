#!/usr/bin/env python3
"""Build #20 refresh of the GitHub backup, mirroring
~/workspace/custom-connectors/custom.github/bin/api_push_backup.py
(same Git Data API route: blobs -> tree -> parentless snapshot commit
-> refs/heads/master). The stock script's ref write uses force:false
and fails 422 'not a fast forward' on every refresh because snapshot
commits are parentless; per the standing fix, this variant
force-updates ONLY the backup branch `master` (never `main`) and
then reads the ref back and verifies the remote tree equals the
local HEAD tree. Prints counts/status only — never the token."""
import sys, os, json, base64, subprocess, urllib.request, urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc

REPO_DIR = "/home/hatch/workspace/trucker-app/geopro"
OWNER, REPO = "larryharris1233-cell", "geopro"
TOKEN = dc.dynamic_credential_entry("custom.github", "access_token")["surrogate"]
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def call(method, url, body=None):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + TOKEN,
                 "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json",
                 "User-Agent": "HammerLaneCo/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def git(*args):
    return subprocess.run(["git", "-C", REPO_DIR] + list(args),
                          capture_output=True, text=True, check=True).stdout


head = git("rev-parse", "HEAD").strip()
tree_sha = git("rev-parse", "HEAD^{tree}").strip()
print("local HEAD:", head[:7], "tree:", tree_sha[:7])

entries = []
for line in git("ls-tree", "-r", "-z", "HEAD").split("\0"):
    if not line:
        continue
    meta, path = line.split("\t", 1)
    mode, typ, sha = meta.split()
    entries.append({"path": path, "mode": mode, "type": typ, "sha": sha})
blobs = [e for e in entries if e["type"] == "blob"]
print("tree entries:", len(entries), "| blobs:", len(blobs))

uploaded = existed = 0
for e in blobs:
    st, _ = call("GET", f"{API}/git/blobs/{e['sha']}")
    if st == 200:
        existed += 1
        continue
    raw = subprocess.run(["git", "-C", REPO_DIR, "cat-file", "-p", e["sha"]],
                         capture_output=True, check=True).stdout
    st, resp = call("POST", f"{API}/git/blobs",
                    {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
    if st != 201 or resp.get("sha") != e["sha"]:
        print("BLOB FAIL", e["path"], st, resp.get("message"))
        sys.exit(1)
    uploaded += 1
print("blobs: existed", existed, "| uploaded", uploaded)

st, resp = call("POST", f"{API}/git/trees", {"tree": entries})
if st != 201:
    print("TREE FAIL", st, resp.get("message"))
    sys.exit(1)
print("remote tree:", resp["sha"][:7], "| match:", resp["sha"] == tree_sha)
if resp["sha"] != tree_sha:
    sys.exit(1)

msg = ("Backup of Hammer Lane Co app source — local master @ "
       + head[:7] + " (build #23, code + Kotlin fix commits). Uploaded via GitHub "
       "API; full commit history remains in the local repo.")
st, resp = call("POST", f"{API}/git/commits",
                {"message": msg, "tree": tree_sha,
                 "author": {"name": "Larry Harris",
                            "email": "larryharris1233@gmail.com"}})
if st != 201:
    print("COMMIT FAIL", st, resp.get("message"))
    sys.exit(1)
commit_sha = resp["sha"]
print("commit:", commit_sha[:7])

# The fix for the known defect: force-update ONLY the backup branch.
st, resp = call("PATCH", f"{API}/git/refs/heads/master",
                {"sha": commit_sha, "force": True})
print("ref force-write status:", st)
if st not in (200, 201):
    print("REF FAIL", resp.get("message"))
    sys.exit(1)

# Read back: ref must point at the new commit, and that commit's tree
# must equal the local HEAD tree.
st, resp = call("GET", f"{API}/git/ref/heads/master")
ref_sha = resp.get("object", {}).get("sha", "")
print("verify ref:", st, ref_sha[:7], "| is new commit:", ref_sha == commit_sha)
st, resp = call("GET", f"{API}/git/commits/{ref_sha}")
remote_tree = resp.get("tree", {}).get("sha", "")
print("verify remote tree:", remote_tree[:7], "| matches local:", remote_tree == tree_sha)
if ref_sha != commit_sha or remote_tree != tree_sha:
    print("VERIFY FAIL")
    sys.exit(1)
print("BACKUP OK")

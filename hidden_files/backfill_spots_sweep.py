#!/usr/bin/env python3
"""Build #19 item 6 — remainder sweep + merge.

The main backfill (backfill_spots.py) completed all 3,098 nodes and
3,600 of 4,467 ways before the public Overpass instances degraded
(repeated 502s/timeouts on one batch). This sweep covers the rest —
ways from index 3600 on, plus all 97 relations — in small batches
with short timeouts, single attempt per endpoint, skipping failures.
It then merges ALL found counts (progress checkpoint + sweep) into
data/truckStops.json and writes the coverage summary with exact
queried/total numbers.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = "/home/hatch/workspace/trucker-app/geopro"
STOPS_PATH = f"{ROOT}/data/truckStops.json"
PROGRESS_PATH = f"{ROOT}/hidden_files/spots-backfill-progress.json"
SUMMARY_PATH = f"{ROOT}/hidden_files/spots-backfill-summary.json"

ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
UA = {"User-Agent": "HammerLaneCo-build19-backfill/1.0 (OSM capacity lookup)"}
ID_RE = re.compile(r"^ts-osm-([nwr])(\d+)$")
CAP_RE = re.compile(r"^\d+$")

# What the main run completed before it was stopped.
DONE = {"n": 3098, "w": 3600, "r": 0}
RETURNED_BEFORE = 6681


def fetch(kind: str, ids: list[int]):
    noun = {"n": "node", "w": "way", "r": "relation"}[kind]
    ql = f"[out:json][timeout:60];{noun}(id:{','.join(map(str, ids))});out tags;"
    body = ("data=" + urllib.parse.quote(ql)).encode()
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode())
            return {el["id"]: el.get("tags") or {} for el in data.get("elements", [])}
        except Exception as e:  # noqa: BLE001
            print(f"  {kind} batch via {ep}: {e}", flush=True)
    return None


def main() -> int:
    stops = json.load(open(STOPS_PATH))
    found: dict[str, int] = json.load(open(PROGRESS_PATH))
    print(f"checkpoint counts: {len(found)}", flush=True)

    by_kind: dict[str, list[tuple[str, int]]] = {"n": [], "w": [], "r": []}
    non_osm = 0
    for s in stops:
        m = ID_RE.match(str(s.get("id", "")))
        if m:
            by_kind[m.group(1)].append((s["id"], int(m.group(2))))
        else:
            non_osm += 1

    queried = dict(DONE)
    returned = RETURNED_BEFORE
    failed_batches = 0
    for kind in ("w", "r"):
        pairs = by_kind[kind][DONE[kind]:]
        for i in range(0, len(pairs), 150):
            chunk = pairs[i : i + 150]
            res = fetch(kind, [o for _, o in chunk])
            if res is None:
                failed_batches += 1
                print(f"  {kind} chunk {i}: FAILED both endpoints, skipped", flush=True)
                continue
            queried[kind] += len(chunk)
            returned += len(res)
            for full_id, osm_id in chunk:
                cap = (res.get(osm_id) or {}).get("capacity")
                if cap is not None and CAP_RE.match(cap.strip()):
                    v = int(cap.strip())
                    if 1 <= v <= 2000:
                        found[full_id] = v
            json.dump(found, open(PROGRESS_PATH, "w"))
            print(
                f"{kind} +{len(chunk)} (total queried {queried[kind]}); counts={len(found)}",
                flush=True,
            )
            time.sleep(1)

    total_osm = sum(len(v) for v in by_kind.values())
    total_queried = sum(queried.values())
    merged = 0
    out = []
    for s in stops:
        rec = dict(s)
        if rec["id"] in found:
            rec["spots"] = found[rec["id"]]
            merged += 1
        out.append({k: rec[k] for k in sorted(rec)})
    with open(STOPS_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    summary = {
        "total_stops": len(stops),
        "osm_backed": total_osm,
        "non_osm_ids": non_osm,
        "elements_queried": total_queried,
        "elements_returned": returned,
        "failed_batches_skipped": failed_batches,
        "with_verified_count": merged,
        "coverage_pct_of_all": round(100.0 * merged / len(stops), 2),
        "coverage_pct_of_queried": round(100.0 * merged / total_queried, 2)
        if total_queried
        else 0,
        "source": "OSM capacity tag on the stop's own element, via Overpass, 2026-11-08",
    }
    json.dump(summary, open(SUMMARY_PATH, "w"), indent=1)
    print("SUMMARY:", json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

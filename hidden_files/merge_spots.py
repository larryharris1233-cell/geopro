#!/usr/bin/env python3
"""Build #19 item 6 — final merge of the checkpointed Overpass counts.

The long backfill queried 6,998 of 7,662 OSM-backed stop elements
(all 3,098 nodes + 3,900 of 4,467 ways) before the public Overpass
instances degraded and the sweep process was lost; the found counts
survived in the checkpoint file. This merges exactly those verified
counts into data/truckStops.json (compact, sorted keys — the file's
existing format) and writes the coverage summary. The 664 elements
never successfully queried (417 ways + 97 relations unattempted in
the final sweep, 150 ways in one doubly-failed batch) simply have
no count — nothing is estimated.
"""
import json
from collections import Counter

ROOT = "/home/hatch/workspace/trucker-app/geopro"
STOPS_PATH = f"{ROOT}/data/truckStops.json"
PROGRESS_PATH = f"{ROOT}/hidden_files/spots-backfill-progress.json"
SUMMARY_PATH = f"{ROOT}/hidden_files/spots-backfill-summary.json"

QUERIED = 6998  # 3,098 nodes + 3,900 ways, from the backfill logs
OSM_BACKED = 7662

stops = json.load(open(STOPS_PATH))
found: dict[str, int] = json.load(open(PROGRESS_PATH))

merged = 0
buckets = Counter()
out = []
for s in stops:
    rec = dict(s)
    if rec["id"] in found:
        rec["spots"] = found[rec["id"]]
        merged += 1
        v = found[rec["id"]]
        buckets["S" if v <= 10 else "M" if v <= 50 else "L"] += 1
    out.append({k: rec[k] for k in sorted(rec)})

with open(STOPS_PATH, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

summary = {
    "total_stops": len(stops),
    "osm_backed": OSM_BACKED,
    "non_osm_ids": len(stops) - OSM_BACKED,
    "elements_queried": QUERIED,
    "elements_never_queried": OSM_BACKED - QUERIED,
    "with_verified_count": merged,
    "coverage_pct_of_all": round(100.0 * merged / len(stops), 2),
    "coverage_pct_of_queried": round(100.0 * merged / QUERIED, 2),
    "size_distribution": dict(buckets),
    "source": "OSM capacity tag on the stop's own element, via Overpass, 2026-11-08",
}
json.dump(summary, open(SUMMARY_PATH, "w"), indent=1)
print("SUMMARY:", json.dumps(summary))

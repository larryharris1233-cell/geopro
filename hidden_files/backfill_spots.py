#!/usr/bin/env python3
"""Build #19, item 6: backfill REAL truck-parking spot counts for the
bundled truck stops from OpenStreetMap.

The bundled ids are OSM element ids (ts-osm-n<id> = node, -w = way,
-r = relation). For each element we ask Overpass for its tags and
keep ONLY a plain-integer `capacity` tag — the OSM parking capacity.
No count is ever estimated: stops whose element carries no usable
capacity tag simply get no `spots` field and therefore no badge.

Progress is checkpointed to spots-backfill-progress.json after every
batch; the final merge writes data/truckStops.json (compact, sorted
keys — the file's existing format) and a coverage summary.
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

ROOT = "/home/hatch/workspace/trucker-app/geopro"
STOPS_PATH = f"{ROOT}/data/truckStops.json"
PROGRESS_PATH = f"{ROOT}/hidden_files/spots-backfill-progress.json"
SUMMARY_PATH = f"{ROOT}/hidden_files/spots-backfill-summary.json"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
BATCH = 600
UA = {"User-Agent": "HammerLaneCo-build19-backfill/1.0 (OSM capacity lookup)"}

ID_RE = re.compile(r"^ts-osm-([nwr])(\d+)$")
CAP_RE = re.compile(r"^\d+$")


def fetch_batch(kind: str, ids: list[int]) -> dict[int, dict]:
    """Return {osm_id: tags} for one batch, trying each endpoint."""
    noun = {"n": "node", "w": "way", "r": "relation"}[kind]
    ql = (
        f"[out:json][timeout:180];{noun}(id:{','.join(str(i) for i in ids)});"
        "out tags;"
    )
    body = ("data=" + urllib.parse.quote(ql)).encode()
    last_err = None
    for attempt in range(3):
        for ep in ENDPOINTS:
            try:
                req = urllib.request.Request(ep, data=body, headers=UA)
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.loads(resp.read().decode())
                return {
                    el["id"]: el.get("tags") or {}
                    for el in data.get("elements", [])
                }
            except Exception as e:  # noqa: BLE001 — retry across mirrors
                last_err = e
                print(f"  batch {kind} attempt {attempt} via {ep}: {e}", flush=True)
                time.sleep(10)
    raise RuntimeError(f"batch {kind} failed after retries: {last_err}")


def main() -> int:
    stops = json.load(open(STOPS_PATH))
    by_kind: dict[str, list[tuple[str, int]]] = {"n": [], "w": [], "r": []}
    skipped = 0
    for s in stops:
        m = ID_RE.match(str(s.get("id", "")))
        if m:
            by_kind[m.group(1)].append((s["id"], int(m.group(2))))
        else:
            skipped += 1
    total_osm = sum(len(v) for v in by_kind.values())
    print(f"stops={len(stops)} osm-backed={total_osm} non-osm={skipped}", flush=True)

    try:
        found: dict[str, int] = json.load(open(PROGRESS_PATH))
        print(f"resuming with {len(found)} counts already found", flush=True)
    except Exception:
        found = {}

    queried = 0
    elements_seen = 0
    for kind, pairs in by_kind.items():
        for i in range(0, len(pairs), BATCH):
            chunk = pairs[i : i + BATCH]
            tags_by_id = fetch_batch(kind, [osm_id for _, osm_id in chunk])
            queried += len(chunk)
            elements_seen += len(tags_by_id)
            for full_id, osm_id in chunk:
                cap = (tags_by_id.get(osm_id) or {}).get("capacity")
                if cap is not None and CAP_RE.match(cap.strip()):
                    v = int(cap.strip())
                    if 1 <= v <= 2000:
                        found[full_id] = v
            json.dump(found, open(PROGRESS_PATH, "w"))
            print(
                f"{kind} {i + len(chunk)}/{len(pairs)} queried; "
                f"elements returned so far={elements_seen}; counts={len(found)}",
                flush=True,
            )
            time.sleep(1.5)

    # Merge: rebuild each record with sorted keys, adding spots only
    # where a verified count exists.
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
        "non_osm_ids": skipped,
        "elements_returned": elements_seen,
        "with_verified_count": merged,
        "coverage_pct_of_all": round(100.0 * merged / len(stops), 2),
        "coverage_pct_of_osm_backed": round(100.0 * merged / total_osm, 2)
        if total_osm
        else 0,
    }
    json.dump(summary, open(SUMMARY_PATH, "w"), indent=1)
    print("SUMMARY:", json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

// Low-bridge layer (build #17, Larry's ask Nov 8, 2026): any bridge
// or overpass whose tagged clearance is BELOW the truck's height and
// which the planned/active route actually passes under.
//
// Data: OpenStreetMap `maxheight` / `maxheight:physical` tags, queried
// live from the Overpass API along the route corridor — the same
// pattern as the POI corridor lookups in constants/poi.ts. Two nets
// over the same OSM data: Valhalla truck costing (planRoute passes
// the truck profile's height) already steers the planned route away
// from tagged low bridges, and this layer warns about — and triggers
// avoid-replans around — any that still land on the produced route.
//
// HONEST LIMIT: everything depends on OSM having the bridge's
// clearance tagged. An untagged low bridge produces neither a
// warning nor an avoidance. Parsing is conservative: a value we
// cannot parse confidently is ignored, never guessed — no false
// warnings from bad data.
//
// This module imports nothing React-Native so its pure functions
// (parsing, corridor filtering) can be exercised from a Node harness
// against live Overpass/Valhalla data during development.

import {
  buildActiveRoute,
  projectOntoRoute,
  type ActiveRoute,
  type RouteCoord,
} from './activeRoute';

export interface LowBridgeCandidate {
  // OSM element the clearance came from, e.g. "way-100219681".
  id: string;
  latitude: number;
  longitude: number;
  clearanceM: number;
  // The tag exactly as OSM carried it ("12'6\"", "3.8", …).
  raw: string;
}

export interface LowBridgePoint extends LowBridgeCandidate {
  // Miles along the route to the point where it passes under.
  alongMi: number;
  // Straight-line distance from that point to the route line.
  offMi: number;
  // Human label, e.g. 12'6".
  label: string;
}

// How close to the route line a clearance point must sit to count as
// "the route passes under it". Deliberately tight — POI "along the
// route" uses ~3 miles; a bridge the truck does not drive under must
// never warn. ~0.1 mi leaves room for OSM way-geometry wobble while
// excluding parallel streets and nearby crossings.
export const LOW_BRIDGE_TOLERANCE_MI = 0.1;

// Two clearance points closer than this along the route with the
// same clearance are the same physical bridge mapped twice (a node
// plus its way, dual carriageways) — reported once.
const DEDUPE_ALONG_MI = 0.15;

// Parse an OSM maxheight value to meters. Returns null for anything
// unparseable — the caller ignores those (no false warnings).
// Formats seen in real OSM data:
//   "3.8"        plain number = meters (the OSM default unit)
//   "3.8 m"      explicit meters ("meter"/"metres" too)
//   "380 cm"     centimeters
//   "12'6\""     feet'inches" — also "12'6", "12'", "13.5'",
//                and the "15'8''" variant (two apostrophes for the
//                inch mark, common in US tagging)
// Sanity gate: a real road clearance is between 0.5 m and 10 m;
// anything outside that is a tagging error, not a bridge.
export function parseMaxheight(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m: number | null = null;
  const imperial = s.match(
    /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in)?)?$/,
  );
  if (imperial) {
    const feet = parseFloat(imperial[1]);
    const inches = imperial[2] ? parseFloat(imperial[2]) : 0;
    if (inches >= 12) return null;
    m = (feet * 12 + inches) * 0.0254;
  } else {
    const metric = s.match(/^(\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres)$/);
    const cm = s.match(/^(\d+(?:\.\d+)?)\s*cm$/);
    const plain = s.match(/^(\d+(?:\.\d+)?)$/);
    if (metric) m = parseFloat(metric[1]);
    else if (cm) m = parseFloat(cm[1]) / 100;
    else if (plain) m = parseFloat(plain[1]);
  }
  if (m === null || !isFinite(m) || m < 0.5 || m > 10) return null;
  return Math.round(m * 1000) / 1000;
}

// Meters -> the label a US driver reads on the sign: 12'6".
export function formatClearance(clearanceM: number): string {
  const totalIn = Math.round(clearanceM / 0.0254);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return `${ft}'${inch}"`;
}

// Truck height (meters) from the Map screen's truck profile fields.
// The profile defaults to 13'6" (DEFAULT_TRUCK in map.tsx); a blank
// or unparseable field falls back to that default's component, the
// same fallback planRoute has always used for the costing height.
export function truckHeightM(heightFt: string, heightIn: string): number {
  const ft = parseInt(heightFt || '13', 10) || 13;
  const inch = parseInt(heightIn || '6', 10) || 0;
  return Math.round(((ft * 12 + inch) * 0.0254) * 100) / 100;
}

// Filter corridor candidates down to the low bridges a route
// actually passes under: project each candidate onto the route,
// keep only tight-lateral hits with clearance BELOW the truck
// height, dedupe double-mapped bridges, sort by along-distance.
export function lowBridgesOnRoute(
  route: ActiveRoute,
  candidates: LowBridgeCandidate[],
  heightM: number,
): LowBridgePoint[] {
  const hits: LowBridgePoint[] = [];
  for (const c of candidates) {
    if (!(c.clearanceM < heightM - 0.001)) continue;
    const proj = projectOntoRoute(route, c.latitude, c.longitude);
    if (proj.offMi > LOW_BRIDGE_TOLERANCE_MI) continue;
    hits.push({
      ...c,
      alongMi: proj.alongMi,
      offMi: proj.offMi,
      label: formatClearance(c.clearanceM),
    });
  }
  hits.sort((a, z) => a.alongMi - z.alongMi);
  const out: LowBridgePoint[] = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (
      prev &&
      h.alongMi - prev.alongMi < DEDUPE_ALONG_MI &&
      Math.abs(h.clearanceM - prev.clearanceM) < 0.01
    ) {
      continue;
    }
    out.push(h);
  }
  return out;
}

// Convenience wrapper for a raw route option (coords + summary),
// used for alternate routes: their clearance points come from the
// same corridor fetch as the primary's when they are cheap to get
// (the alternates run near the primary, so its candidate set largely
// covers them) — no extra Overpass round-trip per alternate.
export function lowBridgesForCoords(
  coords: RouteCoord[],
  info: { miles: number; minutes: number },
  candidates: LowBridgeCandidate[],
  heightM: number,
): LowBridgePoint[] {
  const route = buildActiveRoute(coords, info);
  if (!route) return [];
  return lowBridgesOnRoute(route, candidates, heightM);
}

// ---- Overpass corridor fetch --------------------------------------

// Public Overpass instances, tried in order — same fallback pair as
// the POI lookups.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Corridor query: ONE polyline `around` filter — maxheight-tagged
// objects within 300 m of the route line itself. (The POI corridor
// pattern — a union of big radius lookups around spaced samples —
// was tried first during development and timed out: it scans whole
// cities around a short route. The polyline form returns exactly
// the elements near the line; on the Kansas City test route it
// returned precisely the 3 elements of the bridge the route passes
// under.) The line is the route simplified to a point every ~0.4 mi
// (capped, spacing widens on very long routes) so it hugs curves
// well inside the 300 m band. Ways are asked for their geometry
// (`out geom`) so the filter can project the way's own points onto
// the route instead of trusting a long way's center point.
export function lowBridgeCorridorQuery(route: ActiveRoute): string | null {
  const { coords, cumulativeMi, miles } = route;
  if (coords.length < 2) return null;
  const spacing = Math.max(0.4, miles / 240);
  const pts: RouteCoord[] = [coords[0]];
  let nextAt = spacing;
  for (let i = 1; i < coords.length; i++) {
    if (cumulativeMi[i] >= nextAt) {
      pts.push(coords[i]);
      nextAt += spacing;
    }
  }
  const last = coords[coords.length - 1];
  if (pts[pts.length - 1] !== last) pts.push(last);
  const line = pts
    .map((c) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`)
    .join(',');
  return (
    `[out:json][timeout:30];` +
    `(nwr["maxheight"](around:300,${line});` +
    `nwr["maxheight:physical"](around:300,${line}););out geom 500;`
  );
}


function elementsToCandidates(elements: any[]): LowBridgeCandidate[] {
  const seen = new Set<string>();
  const out: LowBridgeCandidate[] = [];
  const push = (
    id: string,
    lat: unknown,
    lon: unknown,
    clearanceM: number,
    raw: string,
  ) => {
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (!isFinite(lat) || !isFinite(lon)) return;
    // Geometry points of one way land centimetres apart; bucket to
    // ~11 m so a way contributes a handful of points, not hundreds.
    const key = `${id}|${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, latitude: lat, longitude: lon, clearanceM, raw });
  };
  for (const el of elements) {
    const tags: Record<string, string> = el?.tags ?? {};
    const raw = tags['maxheight'] ?? tags['maxheight:physical'];
    const clearanceM = parseMaxheight(raw);
    if (clearanceM === null) continue;
    const id = `osm-${el.type}-${el.id}`;
    if (el.type === 'node') {
      push(id, el.lat, el.lon, clearanceM, raw);
    } else if (el.type === 'way') {
      const geom: any[] = Array.isArray(el.geometry) ? el.geometry : [];
      if (geom.length) {
        for (const g of geom) push(id, g?.lat, g?.lon, clearanceM, raw);
      } else {
        push(id, el.center?.lat, el.center?.lon, clearanceM, raw);
      }
    }
  }
  return out;
}

export interface LowBridgeFetchResult {
  candidates: LowBridgeCandidate[];
  // null on success — including a genuine zero-result answer. A
  // message when the lookup itself failed, so the caller can tell
  // "no tagged bridges found" apart from "couldn't check": a failed
  // check must never trigger avoid-replans or false all-clears.
  error: string | null;
  aborted?: boolean;
}

// Fetch every parseable maxheight candidate along the route
// corridor (see lowBridgeCorridorQuery for the query shape). The
// caller runs this asynchronously after a route is applied, so the
// generous per-attempt timeout (the POI loader's 45 s: Overpass's
// own 30 s execution cap plus queue room) never blocks planning —
// a slow answer still lands in time to warn miles ahead, and a
// failed one simply leaves the route unchecked.
export async function fetchLowBridgeCandidates(
  route: ActiveRoute,
  externalSignal?: AbortSignal,
): Promise<LowBridgeFetchResult> {
  const query = lowBridgeCorridorQuery(route);
  if (!query) return { candidates: [], error: null };
  let lastError = 'Low-bridge data lookup failed';
  for (const url of OVERPASS_ENDPOINTS) {
    if (externalSignal?.aborted) {
      return { candidates: [], error: null, aborted: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener?.('abort', onExternalAbort);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Overpass rejects generic library user agents with 406;
          // the app identifies itself, per the usage policy.
          'User-Agent': 'HammerLaneCo/2.1',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!resp.ok) {
        lastError = `Low-bridge data server error (${resp.status})`;
        continue;
      }
      const data = await resp.json();
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      return { candidates: elementsToCandidates(elements), error: null };
    } catch {
      if (externalSignal?.aborted) {
        return { candidates: [], error: null, aborted: true };
      }
      lastError = 'Low-bridge data lookup timed out or failed';
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', onExternalAbort);
    }
  }
  return { candidates: [], error: lastError };
}

// Full corridor check for one route: fetch candidates, then filter
// to the low bridges the route passes under. Also returns the raw
// candidate set so alternate routes from the same plan can be
// filtered without another fetch.
export async function checkRouteLowBridges(
  route: ActiveRoute,
  heightM: number,
  externalSignal?: AbortSignal,
): Promise<{
  bridges: LowBridgePoint[];
  candidates: LowBridgeCandidate[];
  error: string | null;
  aborted?: boolean;
}> {
  const { candidates, error, aborted } = await fetchLowBridgeCandidates(
    route,
    externalSignal,
  );
  if (aborted) return { bridges: [], candidates: [], error: null, aborted: true };
  if (error) return { bridges: [], candidates: [], error };
  return {
    bridges: lowBridgesOnRoute(route, candidates, heightM),
    candidates,
    error: null,
  };
}

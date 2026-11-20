import AsyncStorage from '@react-native-async-storage/async-storage';

import { distMi } from './activeRoute';

// Check-in points: where a truck driver actually checks in for a
// delivery or pickup, as opposed to the street address the route
// ends at. Larry asked for a second flag for this (Nov 8, 2026):
// the checkered flag stays on the building/address point, and a
// smaller second flag marks the check-in spot.
//
// The only source is the driver's OWN point: he drops a pin at the
// gate / guard shack / dock office once, taps "Set check-in here",
// and the app remembers it for that destination (this module's
// store, on-device only). (An automatic "Truck entrance" flag
// guessed from open map data shipped in build #14 and was removed
// the same day at Larry's call — it flagged wrong spots at rural
// destinations. Nothing is detected or guessed anymore; no saved
// point means no second flag.)

export interface CheckInPoint {
  // Storage key (see checkInKey) — also the record's identity.
  key: string;
  // The destination this check-in belongs to: the coordinates the
  // route was planned to, and its name when one is known.
  destLatitude: number;
  destLongitude: number;
  destName: string | null;
  // The check-in point itself.
  latitude: number;
  longitude: number;
  // When the driver saved it (ms epoch).
  at: number;
}

export type CheckInMap = Record<string, CheckInPoint>;

const CHECKINS_KEY = 'geopro.checkIns.v1';

function slugOf(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Destination identity: rounded coordinates (~11 m cells) plus a
// name slug when available. The same facility can be reached under
// slightly different names/coords on different days, so lookups also
// fall back to proximity (findCheckIn) — the key is an ID, not the
// only matching rule.
export function checkInKey(
  latitude: number,
  longitude: number,
  name?: string | null,
): string {
  const slug = slugOf(name).slice(0, 48);
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}${slug ? `|${slug}` : ''}`;
}

// Find the saved check-in for a destination: exact key first, then
// a same-name match nearby (re-geocoded names drift), then any
// destination point within ~80 m (the same yard re-searched from a
// slightly different address point).
export function findCheckIn(
  map: CheckInMap,
  latitude: number,
  longitude: number,
  name?: string | null,
): CheckInPoint | null {
  const exact = map[checkInKey(latitude, longitude, name)];
  if (exact) return exact;
  const slug = slugOf(name);
  let best: CheckInPoint | null = null;
  let bestD = Infinity;
  if (slug) {
    for (const p of Object.values(map)) {
      if (slugOf(p.destName) !== slug) continue;
      const d = distMi(latitude, longitude, p.destLatitude, p.destLongitude);
      if (d < 0.25 && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best) return best;
  }
  for (const p of Object.values(map)) {
    const d = distMi(latitude, longitude, p.destLatitude, p.destLongitude);
    if (d < 0.05 && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

// Insert or replace the check-in for a destination. Any existing
// entry findCheckIn would match for that destination is removed
// first, so there's never more than one saved point per yard.
export function upsertCheckIn(map: CheckInMap, point: CheckInPoint): CheckInMap {
  const next: CheckInMap = { ...map };
  const existing = findCheckIn(next, point.destLatitude, point.destLongitude, point.destName);
  if (existing) delete next[existing.key];
  next[point.key] = point;
  return next;
}

// Remove the check-in saved for a destination, if one exists.
export function removeCheckIn(
  map: CheckInMap,
  latitude: number,
  longitude: number,
  name?: string | null,
): CheckInMap {
  const existing = findCheckIn(map, latitude, longitude, name);
  if (!existing) return map;
  const next: CheckInMap = { ...map };
  delete next[existing.key];
  return next;
}

function isCheckInPoint(p: any): p is CheckInPoint {
  return (
    p &&
    typeof p.key === 'string' &&
    typeof p.destLatitude === 'number' &&
    typeof p.destLongitude === 'number' &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    typeof p.at === 'number' &&
    (typeof p.destName === 'string' || p.destName === null)
  );
}

export async function loadCheckIns(): Promise<CheckInMap> {
  try {
    const raw = await AsyncStorage.getItem(CHECKINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, any>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CheckInMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (isCheckInPoint(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveCheckIns(map: CheckInMap): Promise<void> {
  try {
    await AsyncStorage.setItem(CHECKINS_KEY, JSON.stringify(map));
  } catch {}
}

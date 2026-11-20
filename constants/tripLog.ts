import AsyncStorage from '@react-native-async-storage/async-storage';

import { US_STATES } from '@/constants/usStates';

// Offline IFTA trip log. While a trip is active, GPS fixes feed addFix(),
// which accumulates driven miles and attributes them to US states using
// the bundled simplified Census state polygons (point-in-polygon, done
// locally — no network needed). Current trip + finished trips persist in
// AsyncStorage.

export interface TripRecord {
  id: string;
  startedAt: number;
  endedAt: number | null;
  stateMiles: Record<string, number>;
  totalMiles: number;
}

const TRIP_LOG_KEY = 'geopro.tripLog.v1';

interface TripLogState {
  current: TripRecord | null;
  history: TripRecord[];
}

const EMPTY: TripLogState = { current: null, history: [] };

let state: TripLogState = EMPTY;
let loaded = false;
let lastLat: number | null = null;
let lastLng: number | null = null;
let lastState: string | null = null;
let lastStateCheckLat: number | null = null;
let lastStateCheckLng: number | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function distMi(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Ray-casting point-in-polygon over [lng, lat] rings.
function ringContains(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function stateAbbrAt(latitude: number, longitude: number): string | null {
  for (const s of US_STATES) {
    for (const poly of s.polygons) {
      // Even-odd across all rings of the polygon handles holes.
      let inside = false;
      for (const ring of poly) {
        if (ringContains(longitude, latitude, ring)) inside = !inside;
      }
      if (inside) return s.abbr;
    }
  }
  return null;
}

export function stateName(abbr: string): string {
  return US_STATES.find((s) => s.abbr === abbr)?.name ?? abbr;
}

async function persist() {
  try {
    await AsyncStorage.setItem(TRIP_LOG_KEY, JSON.stringify(state));
  } catch {}
}

function schedulePersist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 5000);
}

export async function loadTripLog(): Promise<TripLogState> {
  if (!loaded) {
    try {
      const raw = await AsyncStorage.getItem(TRIP_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TripLogState;
        state = {
          current: parsed.current ?? null,
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };
      }
    } catch {}
    loaded = true;
  }
  return state;
}

export function getTripLog(): TripLogState {
  return state;
}

export function startTrip(): TripRecord {
  const trip: TripRecord = {
    id: `trip-${Date.now()}`,
    startedAt: Date.now(),
    endedAt: null,
    stateMiles: {},
    totalMiles: 0,
  };
  state = { ...state, current: trip };
  lastLat = null;
  lastLng = null;
  lastState = null;
  lastStateCheckLat = null;
  lastStateCheckLng = null;
  void persist();
  return trip;
}

export function endTrip(): TripRecord | null {
  const cur = state.current;
  if (!cur) return null;
  const done: TripRecord = { ...cur, endedAt: Date.now() };
  state = { current: null, history: [done, ...state.history].slice(0, 50) };
  lastLat = null;
  lastLng = null;
  void persist();
  return done;
}

// Feed one GPS fix. Returns true when the accumulated numbers changed
// enough to be worth a UI refresh.
export function addFix(latitude: number, longitude: number): boolean {
  const cur = state.current;
  if (!cur) return false;
  if (lastLat === null || lastLng === null) {
    lastLat = latitude;
    lastLng = longitude;
    return false;
  }
  const d = distMi(lastLat, lastLng, latitude, longitude);
  const prevLat = lastLat;
  const prevLng = lastLng;
  lastLat = latitude;
  lastLng = longitude;
  // Ignore GPS jitter (< ~26 ft) and impossible jumps (> 2 mi between fixes).
  if (d < 0.005 || d > 2) return false;

  // Attribute the segment to the state at its midpoint. Only recompute the
  // polygon lookup when we've moved > 0.05 mi from the last check point.
  const midLat = (prevLat + latitude) / 2;
  const midLng = (prevLng + longitude) / 2;
  if (
    lastStateCheckLat === null ||
    lastStateCheckLng === null ||
    distMi(lastStateCheckLat, lastStateCheckLng, midLat, midLng) > 0.05
  ) {
    lastState = stateAbbrAt(midLat, midLng);
    lastStateCheckLat = midLat;
    lastStateCheckLng = midLng;
  }
  // Near a border the cached state can be stale; if the midpoint check is
  // fresh it is already correct. Unknown state (just offshore / border
  // fuzz) still counts toward the trip total.
  const key = lastState ?? '??';
  cur.stateMiles[key] = (cur.stateMiles[key] ?? 0) + d;
  cur.totalMiles += d;
  schedulePersist();
  return true;
}

export function tripToCsv(trip: TripRecord): string {
  const rows = Object.entries(trip.stateMiles)
    .filter(([abbr]) => abbr !== '??')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([abbr, miles]) => `${abbr},${miles.toFixed(1)}`);
  const unknown = trip.stateMiles['??'] ?? 0;
  if (unknown > 0.05) {
    rows.push(`Unknown,${unknown.toFixed(1)}`);
  }
  rows.push(`TOTAL,${trip.totalMiles.toFixed(1)}`);
  return ['state,miles', ...rows].join('\n');
}

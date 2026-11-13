import AsyncStorage from '@react-native-async-storage/async-storage';

// Trip odometer: a simple miles-driven counter with a reset button.
// GPS fixes feed addOdometerFix() (from the nav watcher and the IFTA
// trip watcher — both share this module's last-fix, so overlapping
// watchers don't double-count). The total persists in AsyncStorage;
// resetOdometer() zeroes it. Deliberately separate from the IFTA
// trip log: this is the driver's own "miles since I last reset"
// counter, nothing to do with state-by-state reporting.

const ODOMETER_KEY = 'geopro.odometer.v1';

interface OdometerState {
  totalMi: number;
  lastLat: number | null;
  lastLng: number | null;
}

const EMPTY: OdometerState = { totalMi: 0, lastLat: null, lastLng: null };

let state: OdometerState = EMPTY;
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function distMi(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
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

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(ODOMETER_KEY, JSON.stringify(state)).catch(
      () => {},
    );
  }, 2000);
}

export async function loadOdometer(): Promise<number> {
  if (loaded) return state.totalMi;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(ODOMETER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OdometerState>;
      if (typeof parsed.totalMi === 'number' && parsed.totalMi >= 0) {
        state = {
          totalMi: parsed.totalMi,
          lastLat: typeof parsed.lastLat === 'number' ? parsed.lastLat : null,
          lastLng: typeof parsed.lastLng === 'number' ? parsed.lastLng : null,
        };
      }
    }
  } catch {}
  return state.totalMi;
}

export function getOdometerTotal(): number {
  return state.totalMi;
}

// Feed one GPS fix. Returns the running total. Jumps over 1 mile in a
// single fix are treated as GPS glitches and ignored; movements under
// ~10 feet are noise and don't move the last-fix anchor.
export function addOdometerFix(latitude: number, longitude: number): number {
  if (!isFinite(latitude) || !isFinite(longitude)) return state.totalMi;
  if (state.lastLat === null || state.lastLng === null) {
    state.lastLat = latitude;
    state.lastLng = longitude;
    scheduleSave();
    return state.totalMi;
  }
  const d = distMi(state.lastLat, state.lastLng, latitude, longitude);
  if (d > 1) {
    // Glitch jump: re-anchor without counting it.
    state.lastLat = latitude;
    state.lastLng = longitude;
    return state.totalMi;
  }
  if (d >= 0.002) {
    state.totalMi += d;
    state.lastLat = latitude;
    state.lastLng = longitude;
    scheduleSave();
  }
  return state.totalMi;
}

export function resetOdometer(): number {
  state = { totalMi: 0, lastLat: null, lastLng: null };
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  AsyncStorage.setItem(ODOMETER_KEY, JSON.stringify(state)).catch(() => {});
  return 0;
}

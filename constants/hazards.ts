import AsyncStorage from '@react-native-async-storage/async-storage';

// Road hazard reports, Google-Maps style: the driver taps a report
// button (police, object in the road, accident, stopped vehicle,
// hazard) and the app drops it at his position. While navigating,
// approaching a report triggers a spoken call — "Police reported
// ahead, in 5 miles" — and the report shows as a pin on the map.
//
// Reports live on-device (AsyncStorage) and expire after 2 hours.
// Sharing reports between drivers needs a shared backend, which the
// app does not have yet — until then this is the driver's own
// report layer, announced back to him on approach like Waze does.

export type HazardKind =
  | 'police'
  | 'object'
  | 'accident'
  | 'vehicle'
  | 'construction'
  | 'hazard';

export interface HazardReport {
  id: string;
  kind: HazardKind;
  latitude: number;
  longitude: number;
  at: number;
}

export const HAZARD_TTL_MS = 2 * 60 * 60 * 1000;

export const HAZARD_LABELS: Record<HazardKind, string> = {
  police: 'Police reported ahead',
  object: 'Object in the road ahead',
  accident: 'Accident ahead',
  vehicle: 'Stopped vehicle ahead',
  construction: 'Construction ahead',
  hazard: 'Hazard ahead',
};

export const HAZARD_ICONS: Record<HazardKind, string> = {
  police: '🚓',
  object: '🛑',
  accident: '💥',
  vehicle: '🚗',
  construction: '🚧',
  hazard: '⚠️',
};

export const HAZARD_KINDS: HazardKind[] = [
  'police',
  'object',
  'accident',
  'vehicle',
  'construction',
  'hazard',
];

const HAZARDS_KEY = 'geopro.hazards.v1';

export function pruneHazards(list: HazardReport[]): HazardReport[] {
  const now = Date.now();
  return list.filter((h) => now - h.at <= HAZARD_TTL_MS);
}

export async function loadHazards(): Promise<HazardReport[]> {
  try {
    const raw = await AsyncStorage.getItem(HAZARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HazardReport[];
    if (!Array.isArray(parsed)) return [];
    return pruneHazards(
      parsed.filter(
        (h) =>
          h &&
          typeof h.id === 'string' &&
          typeof h.latitude === 'number' &&
          typeof h.longitude === 'number' &&
          typeof h.at === 'number' &&
          h.kind in HAZARD_LABELS,
      ),
    );
  } catch {
    return [];
  }
}

export async function saveHazards(list: HazardReport[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      HAZARDS_KEY,
      JSON.stringify(pruneHazards(list)),
    );
  } catch {}
}

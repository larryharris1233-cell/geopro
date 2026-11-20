import AsyncStorage from '@react-native-async-storage/async-storage';

// Driver route preferences, applied to every Valhalla truck route plan.
// Implemented with Valhalla costing options (our router, OpenStreetMap
// data) — no third-party app's settings or data involved.
export interface RouteSettings {
  routeType: 'fastest' | 'shortest';
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

export const ROUTE_SETTINGS_KEY = 'geopro.routeSettings.v1';

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = {
  routeType: 'fastest',
  avoidTolls: false,
  avoidHighways: false,
  avoidFerries: false,
};

export async function loadRouteSettings(): Promise<RouteSettings> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
    if (raw) {
      return {
        ...DEFAULT_ROUTE_SETTINGS,
        ...(JSON.parse(raw) as Partial<RouteSettings>),
      };
    }
  } catch {}
  return DEFAULT_ROUTE_SETTINGS;
}

export async function saveRouteSettings(settings: RouteSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

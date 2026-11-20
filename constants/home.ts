import AsyncStorage from '@react-native-async-storage/async-storage';

// Saved home place (build #21, Larry Nov 9, 2026): the "Route home"
// launcher shortcut needs a home to route to, and Larry sets it
// himself inside the app. The record lives ONLY in AsyncStorage on
// his phone — it is never sent anywhere, never leaves the device,
// and is never hardcoded. No saved home means the shortcut simply
// opens the Map with a prompt to set one first.
export interface HomePlace {
  latitude: number;
  longitude: number;
  // The place name as shown on its address/pin card when he saved it.
  name: string | null;
  // When he saved it (ms epoch).
  at: number;
}

const HOME_KEY = 'geopro.home.v1';

export function makeHomePlace(
  latitude: number,
  longitude: number,
  name: string | null,
): HomePlace {
  return { latitude, longitude, name, at: Date.now() };
}

function isHomePlace(p: any): p is HomePlace {
  return (
    p &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    (typeof p.name === 'string' || p.name === null) &&
    typeof p.at === 'number'
  );
}

export async function loadHome(): Promise<HomePlace | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isHomePlace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveHome(place: HomePlace): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_KEY, JSON.stringify(place));
  } catch {}
}

export async function clearHome(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HOME_KEY);
  } catch {}
}

// Same-place test (~50 m): the card that IS his saved home offers to
// clear it instead of saving it again.
export function isSameHome(
  home: HomePlace | null,
  latitude: number,
  longitude: number,
): boolean {
  if (!home) return false;
  const dLat = (home.latitude - latitude) * 111320;
  const dLng =
    (home.longitude - longitude) *
    111320 *
    Math.cos((latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng) < 50;
}

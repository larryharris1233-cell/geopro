import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';

export interface NavOptions {
  voice: boolean;
  voiceId: string | null;
  // Spoken-prompt volume, 0.1–1.0 (build #27, item 10b): the
  // in-app slider on the More tab. 1.0 = full utterance volume;
  // prompts also take transient ducking audio focus while they
  // speak (see modules/hammerlane-voice), so this scales the
  // voice itself, not the phone's media volume.
  voiceVolume: number;
  reroute: boolean;
  zoom: boolean;
  routeColor: string;
  // Weather: current-conditions chip in the drive strip + spoken
  // NWS severe-weather alerts while navigating.
  weather: boolean;
  // Weather radar overlay on the map (RainViewer frames).
  radar: boolean;
  // Road hazard reports (police / object in road / accident…):
  // report buttons, map pins, and spoken "reported ahead" calls.
  // This is also the app's live-traffic layer until a paid traffic
  // feed exists — there is no free live-flow traffic source.
  hazards: boolean;
  // Overspeed prompt: spoken alert when driving 5+ mph over the
  // posted limit (limit itself shows in the drive strip).
  speedAlert: boolean;
  // Legacy field: the pre-make-picker generic icon name (Semi / Box
  // truck / Express). Kept so old stored settings still parse; the UI
  // no longer reads it — truckMake below is the live selection.
  truckIcon: string;
  truckMake: TruckMake;
}

export const NAV_OPTIONS_KEY = 'geopro.navOptions.v1';

export const DEFAULT_NAV_OPTIONS: NavOptions = {
  voice: true,
  voiceId: null,
  voiceVolume: 1.0,
  reroute: true,
  zoom: true,
  weather: true,
  radar: false,
  hazards: true,
  speedAlert: true,
  routeColor: '#2E9BFF',
  truckIcon: 'truck-cargo-container',
  truckMake: 'red',
};

export const ROUTE_COLORS: { hex: string; label: string }[] = [
  { hex: '#2E9BFF', label: 'Blue' },
  { hex: '#4ADE80', label: 'Green' },
  { hex: '#F87171', label: 'Red' },
  { hex: '#C084FC', label: 'Purple' },
];

// "My truck" picker (More tab): Larry's three trucks — the same
// rear-view tractor in white, blue, red and black, cut out with no
// background (transparent PNGs in assets/trucks/). The picked truck
// IS the navigation marker on the map: just the truck, no circle
// badge around it. The pick is a look, not a vehicle class — truck
// size/weight for routing lives in the Truck Profile and is
// semi-sized regardless of pick. (The TruckMake name is historical:
// the picker used to choose between stock make photos.)
export type TruckMake = 'white' | 'blue' | 'red' | 'black';

export const TRUCK_MAKES: {
  key: TruckMake;
  label: string;
  image: ImageSourcePropType;
}[] = [
  {
    key: 'white',
    label: 'White',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/trucks/nav-white.png'),
  },
  {
    key: 'blue',
    label: 'Blue',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/trucks/nav-blue.png'),
  },
  {
    key: 'red',
    label: 'Red',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/trucks/nav-red.png'),
  },
  {
    key: 'black',
    label: 'Black',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/trucks/nav-black.png'),
  },
];

export const DEFAULT_TRUCK_MAKE: TruckMake = 'red';

export function isTruckMake(value: unknown): value is TruckMake {
  return (
    value === 'white' || value === 'blue' || value === 'red' || value === 'black'
  );
}

export function truckMakeImage(make: TruckMake): ImageSourcePropType {
  return TRUCK_MAKES.find((t) => t.key === make)?.image ?? TRUCK_MAKES[2].image;
}

export async function loadNavOptions(): Promise<NavOptions> {
  try {
    const raw = await AsyncStorage.getItem(NAV_OPTIONS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<NavOptions>;
      const merged: NavOptions = { ...DEFAULT_NAV_OPTIONS, ...stored };
      if (!isTruckMake(stored.truckMake)) {
        // Migration: installs saved before the color picker stored a
        // stock make name (freightliner / kenworth / volvo) or only a
        // generic icon. None of those parse as a color pick, so every
        // prior selection lands on the red default.
        merged.truckMake = DEFAULT_TRUCK_MAKE;
      }
      return merged;
    }
  } catch {}
  return DEFAULT_NAV_OPTIONS;
}

export async function saveNavOptions(opts: NavOptions): Promise<void> {
  try {
    await AsyncStorage.setItem(NAV_OPTIONS_KEY, JSON.stringify(opts));
  } catch {}
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';

export type NightMode = 'auto' | 'day' | 'night';

export interface NavOptions {
  voice: boolean;
  voiceId: string | null;
  // Day/night map mode (build #30, item 10): 'auto' follows the
  // sun at the truck's position (dark CARTO base after sunset,
  // standard OSM base in daylight); 'night' forces the dark base
  // and 'day' forces the light one. The Map's moon button cycles
  // auto <-> night; all three states live in the More tab.
  nightMode: NightMode;
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
  nightMode: 'auto',
  voiceVolume: 1.0,
  reroute: true,
  zoom: true,
  weather: true,
  radar: false,
  hazards: true,
  speedAlert: true,
  // Build #29 (Austin, Nov 16, 2026): the route line is GREEN —
  // his word on the I-70 road test ("make that green follow that
  // route green"). Blue was the shipped default through build #28.
  routeColor: '#4ADE80',
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
export type TruckMake =
  | 'white'
  | 'blue'
  | 'red'
  | 'black'
  | 'mario'
  | 'luigi'
  | 'peach'
  | 'donkeykong'
  | 'koopa'
  | 'toad'
  | 'bowser'
  | 'pacman';

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
  // Character markers (Austin, Nov 19, 2026): back views of the kart
  // racers + an angled Pac-Man, cut out with transparency and sized to
  // the same 58x94 marker box as the trucks. They ride the route the
  // same way the truck cutouts do — the marker spin group heading-locks
  // them, so the backs face up-route. Animation hooks for Build #31:
  // kart picks get a slight steering wiggle (small rocking rotation on
  // the spin group), Pac-Man swaps open/closed mouth frames (chomp),
  // and the truck picks get a light smoke puff over the stacks.
  // Build #32: Pac-Man's two frames were flipped horizontally —
  // Austin, Nov 20: "turn it facing the other way, so it's kind of
  // facing forward." The kart frames ride bigger on the map (see
  // navKartMarker in map.tsx); these pick images are unchanged.
  // NOTE: these are Nintendo / Bandai Namco characters — fine in
  // Austin's own test builds, but they must NOT ship in the store
  // release (IP takedown risk); swap in original characters there.
  {
    key: 'mario',
    label: 'Mario',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/mario.png'),
  },
  {
    key: 'luigi',
    label: 'Luigi',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/luigi.png'),
  },
  {
    key: 'peach',
    label: 'Princess',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/peach.png'),
  },
  {
    key: 'donkeykong',
    label: 'Donkey Kong',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/donkeykong.png'),
  },
  {
    key: 'koopa',
    label: 'Koopa',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/koopa.png'),
  },
  {
    key: 'toad',
    label: 'Toad',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/toad.png'),
  },
  {
    key: 'bowser',
    label: 'Bowser',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/bowser.png'),
  },
  {
    key: 'pacman',
    label: 'Pac-Man',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    image: require('../assets/markers/pacman.png'),
  },
];

export const DEFAULT_TRUCK_MAKE: TruckMake = 'red';

export function isTruckMake(value: unknown): value is TruckMake {
  return (
    value === 'white' ||
    value === 'blue' ||
    value === 'red' ||
    value === 'black' ||
    value === 'mario' ||
    value === 'luigi' ||
    value === 'peach' ||
    value === 'donkeykong' ||
    value === 'koopa' ||
    value === 'toad' ||
    value === 'bowser' ||
    value === 'pacman'
  );
}

export function truckMakeImage(make: TruckMake): ImageSourcePropType {
  return TRUCK_MAKES.find((t) => t.key === make)?.image ?? TRUCK_MAKES[2].image;
}

// Build #31 (marker animations): which animation family a pick
// belongs to. Trucks puff a little stack smoke, the kart racers
// get the slight steering wiggle, and Pac-Man chomps.
export type MarkerKind = 'truck' | 'kart' | 'pacman';

export function markerKindFor(make: TruckMake): MarkerKind {
  if (make === 'pacman') return 'pacman';
  if (
    make === 'mario' ||
    make === 'luigi' ||
    make === 'peach' ||
    make === 'donkeykong' ||
    make === 'koopa' ||
    make === 'toad' ||
    make === 'bowser'
  ) {
    return 'kart';
  }
  return 'truck';
}

// Build #31: Pac-Man's closed-mouth frame (the full circle, cut
// from his back view onto the same 58x94 bottom-anchored canvas
// as the open frame) — the chomp swaps between this and the
// regular pacman pick image every ~280 ms while navigating.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const PACMAN_CLOSED_IMAGE: ImageSourcePropType = require('../assets/markers/pacman-closed.png');

// Build #31: the soft smoke-puff sprite the truck markers puff
// from their stacks while navigating (drawn in code — a radial
// gray blob cluster, blurred; no photo asset).
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const SMOKE_PUFF_IMAGE: ImageSourcePropType = require('../assets/markers/smoke-puff.png');

export async function loadNavOptions(): Promise<NavOptions> {
  try {
    const raw = await AsyncStorage.getItem(NAV_OPTIONS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<NavOptions>;
      const merged: NavOptions = { ...DEFAULT_NAV_OPTIONS, ...stored };
      if (stored.routeColor === '#2E9BFF') {
        // Build #29 migration: '#2E9BFF' (blue) was the SHIPPED
        // DEFAULT through build #28, so a stored blue almost always
        // means "never picked a color" — and Austin directed green
        // on Nov 16, 2026. Migrate the old default to green; the
        // other explicit picks (red / purple) are left untouched,
        // and blue stays in the More picker for anyone who wants it.
        merged.routeColor = '#4ADE80';
      }
      if (
        stored.nightMode !== 'auto' &&
        stored.nightMode !== 'day' &&
        stored.nightMode !== 'night'
      ) {
        merged.nightMode = 'auto';
      }
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

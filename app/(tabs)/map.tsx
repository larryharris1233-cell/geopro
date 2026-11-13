import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import tzLookup from 'tz-lookup';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AmenityChips } from '@/components/AmenityChips';
import { GroundViewLink } from '@/components/GroundView';
import {
  enterPip,
  getWindowState,
  isInPip,
  setPipArmed,
} from '../../modules/hammerlane-pip';
import {
  duckOtherAudio,
  releaseDuckedAudio,
} from '../../modules/hammerlane-voice';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_NAV_OPTIONS,
  loadNavOptions,
  truckMakeImage,
  type NavOptions,
} from '@/constants/navOptions';
import {
  buildActiveRoute,
  clearActiveRoute,
  getActiveRoute,
  projectOntoRoute,
  sampleAlongRoute,
  setActiveRoute,
  ALONG_ROUTE_TOLERANCE_MI,
} from '@/constants/activeRoute';
import {
  checkRouteLowBridges,
  lowBridgesForCoords,
  truckHeightM,
  type LowBridgeCandidate,
  type LowBridgePoint,
} from '@/constants/lowBridges';
import { takePendingNav } from '@/constants/pendingNav';
import {
  clearHome,
  isSameHome,
  loadHome,
  makeHomePlace,
  saveHome,
  type HomePlace,
} from '@/constants/home';
import { setInPip as setSharedInPip } from '@/constants/pipState';
import { setNavBannerUp as setSharedNavBannerUp } from '@/constants/navBanner';
import { requestRouteHome, takeRouteHomeRequest } from '@/constants/routeHome';
import {
  bboxAround,
  fetchOsmPois,
  fetchOsmPoisAlongRoute,
  fetchOsmPoisBbox,
  loadPoiLayers,
  POI_CATEGORIES,
  poiCategoryMeta,
  savePoiLayers,
  type Poi,
  type PoiBbox,
  type PoiCategory,
  type PoiLayerPrefs,
} from '@/constants/poi';
import {
  checkInKey,
  findCheckIn,
  loadCheckIns,
  removeCheckIn,
  saveCheckIns,
  upsertCheckIn,
  type CheckInMap,
  type CheckInPoint,
} from '@/constants/checkin';
import {
  loadRouteSettings,
  saveRouteSettings,
  type RouteSettings,
} from '@/constants/routeSettings';
import { colors, spacing } from '@/constants/theme';
import {
  addFix,
  endTrip as endTripLog,
  getTripLog,
  loadTripLog,
  startTrip as startTripLog,
  type TripRecord,
} from '@/constants/tripLog';
import {
  addOdometerFix,
  loadOdometer,
  resetOdometer,
} from '@/constants/odometer';
import {
  HAZARD_ICONS,
  HAZARD_KINDS,
  HAZARD_LABELS,
  HAZARD_TTL_MS,
  loadHazards,
  pruneHazards,
  saveHazards,
  type HazardKind,
  type HazardReport,
} from '@/constants/hazards';
import truckStopsJson from '@/data/truckStops.json';
import { parkingSize, type TruckStop, type WeighStation } from '@/data/types';
import weighStationsJson from '@/data/weighStations.json';

interface SavedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

// MapLibre (OpenStreetMap-based) — no Google Maps platform anywhere.
// MapLibre has no web implementation — only load it on native.
let MapLibreMap: any = null;
let MLCamera: any = null;
let MLMarker: any = null;
let MLGeoJSONSource: any = null;
let MLLayer: any = null;
let MLUserLocation: any = null;
if (Platform.OS !== 'web') {
  const ml = require('@maplibre/maplibre-react-native');
  MapLibreMap = ml.Map;
  MLCamera = ml.Camera;
  MLMarker = ml.Marker;
  MLGeoJSONSource = ml.GeoJSONSource;
  MLLayer = ml.Layer;
  MLUserLocation = ml.UserLocation;
}

// Build #26 (Larry, I-74 drive): interstates must read BLUE and
// bright at a glance. Both base styles are RASTER (OSM tiles /
// Esri imagery + Esri's transportation overlay), and baked-in
// raster roads can't be recolored per road class — so interstates
// get a dedicated VECTOR overlay: OpenFreeMap's free OpenMapTiles
// planet tiles (no key; TileJSON at tiles.openfreemap.org/planet,
// source maxzoom 14, verified live Nov 12, 2026 — the
// `transportation` layer carries class "motorway" for the
// interstate/freeway class). One white casing + one bright-blue
// core (#1E90FF) drawn over the base in BOTH styles, widths
// zoom-scaled so the blue covers the raster road beneath at nav
// zooms. Route line / markers are component children and still
// render above these.
const INTERSTATE_SOURCE = {
  type: 'vector',
  url: 'https://tiles.openfreemap.org/planet',
  attribution: '© OpenMapTiles © OpenStreetMap contributors',
};
// Build #27 (item 7): Larry's correction on the #26 blue — at an
// interchange the whole knot (his road, the crossing interstate,
// the parallel carriageways) rendered as one thick saturated-blue
// blob and he couldn't read it. The overlay is now THINNER and
// TRANSLUCENT, so the base map's own casing and road detail show
// through and segments separate visually. The bright blue is not
// gone — HIS road keeps it, because the neon route line (item 9)
// rides on top of his route at full strength; the muting applies
// to everything the route line doesn't cover: ramps' parent roads,
// crossing and parallel interstates, the road behind him.
const INTERSTATE_CASING_LAYER = {
  id: 'interstates-casing',
  type: 'line',
  source: 'ofmRoads',
  'source-layer': 'transportation',
  filter: ['==', ['get', 'class'], 'motorway'],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': '#FFFFFF',
    'line-opacity': 0.5,
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      5, 1,
      8, 1.8,
      11, 3,
      13, 5,
      15, 8.5,
      17, 13,
    ],
  },
};
const INTERSTATE_LAYER = {
  id: 'interstates',
  type: 'line',
  source: 'ofmRoads',
  'source-layer': 'transportation',
  filter: ['==', ['get', 'class'], 'motorway'],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': '#1E90FF',
    'line-opacity': 0.6,
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      5, 0.6,
      8, 1.1,
      11, 2,
      13, 3.6,
      15, 6.5,
      17, 11,
    ],
  },
};

const OSM_STYLE = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      // OSM serves tiles to z19; past that the map scales these up
      // (overzoom) instead of requesting tiles that don't exist.
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
    ofmRoads: INTERSTATE_SOURCE,
  },
  layers: [
    { id: 'base', type: 'raster', source: 'base' },
    INTERSTATE_CASING_LAYER,
    INTERSTATE_LAYER,
  ],
};

const SAT_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      // Esri imagery tops out around z19; overzoom scales from there.
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    roads: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      // Same overzoom behavior as the imagery below it, so road
      // names and highway shields keep showing at deep zooms.
      maxzoom: 19,
      attribution: 'Roads © Esri',
    },
    labels: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
    // Build #26: bright-blue interstate overlay (see the note at
    // INTERSTATE_SOURCE) — drawn over the Esri hybrid stack.
    ofmRoads: INTERSTATE_SOURCE,
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    // Esri's hybrid stack: the transportation reference overlay draws
    // the roads, highway shields and street names over the imagery
    // (pure World_Imagery has none), and the boundaries/places labels
    // sit on top. Route line, markers and pins are component children
    // and still render above all of these.
    { id: 'roads', type: 'raster', source: 'roads' },
    { id: 'labels', type: 'raster', source: 'labels' },
    INTERSTATE_CASING_LAYER,
    INTERSTATE_LAYER,
  ],
};

// Build #26: MapLibre RN's region-change events carry the map's
// bearing as `bearing` (MLRNMapView.makeViewState puts "bearing",
// "center", "zoom", "pitch" into the payload) — there is NO
// `heading` key. The region handlers read `heading` from build #19
// through #25, so mapHeading / mapHeadingRef NEVER updated and sat
// at 0 (north-up) forever: the follow camera rotated the map
// course-up correctly, but the truck marker's counter-rotation
// (course − map bearing) subtracted a bearing that was always 0,
// so the cutout rendered rotated by the full course — pointing
// west across a vertical road on Larry's I-74 drive (course
// 295°). Read `bearing` first; the legacy `heading` keys stay as
// harmless fallbacks.
function regionBearing(ne: any): number | null {
  const h =
    ne?.bearing ?? ne?.properties?.bearing ?? ne?.heading ?? ne?.properties?.heading;
  return typeof h === 'number' && isFinite(h) ? h : null;
}

function deltaToZoom(delta: number): number {
  return Math.max(2, Math.min(17, Math.log2(360 / delta) - 1));
}

interface Coord {
  latitude: number;
  longitude: number;
}

interface TruckProfile {
  heightFt: string;
  heightIn: string;
  weightLbs: string;
  lengthFt: string;
  lengthIn: string;
  widthFt: string;
  widthIn: string;
  hazmat: boolean;
}

// One lane of a maneuver's lane guidance (build #24, item 1).
// Valhalla (turn_lanes: true) reports, per lane, a `directions`
// bitmask of the turns that lane allows, plus optional `valid` /
// `active` bitmasks naming the direction(s) that follow the route
// — "active" is the best lane choice. Bit values (Valhalla
// LaneDirection): 1 None, 2 Through, 4 SharpLeft, 8 Left,
// 16 SlightLeft, 32 SlightRight, 64 Right, 128 SharpRight,
// 256 Reverse, 512 MergeToLeft, 1024 MergeToRight.
interface NavLane {
  directions: number;
  valid?: number;
  active?: number;
}

interface NavStep {
  instruction: string;
  miles: number;
  latitude: number;
  longitude: number;
  // Valhalla maneuver type (build #24: dip guard, item 6; "Then:"
  // arrow, item 10).
  type?: number;
  // Street names of the segment this maneuver starts (build #24:
  // current-road readout, item 3; dip guard, item 6).
  streetNames?: string[];
  // Lane guidance for this maneuver, when OSM has turn:lanes
  // mapped there (build #24, item 1). Absent = no strip, never
  // guessed.
  lanes?: NavLane[];
}

interface RouteOption {
  coords: Coord[];
  steps: NavStep[];
  miles: number;
  minutes: number;
  // Per-leg summaries (build #18): legs[i] is the drive from the
  // previous point (start or stop i) to the next point (stop i+1 or
  // the destination). Multi-stop ETAs are cumulative sums of these.
  legs: { miles: number; minutes: number }[];
  // Valhalla flags toll roads in the trip summary when it knows them.
  hasToll?: boolean;
}

interface ViaPoint {
  name: string;
  latitude: number;
  longitude: number;
}

// Multiple stops (Larry, build #18): up to 10 intermediate stops
// between the start and the final destination, driven in the order
// he sets them — the app never reorders them for him.
const MAX_STOPS = 10;

function stopKey(v: ViaPoint): string {
  return `${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`;
}

// "45 min" / "1 h 5 min" — the house format for drive durations.
function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

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

// Build #27 (items 1–2): cruise framing is specified as LOOKAHEAD
// — how much road shows AHEAD of the truck — not as a bare zoom
// number. The follow camera renders the truck ~40% up from the
// bottom of the screen (see aheadCenter), so ~60% of the viewport
// height is road ahead. Solve the zoom whose viewport height puts
// exactly `aheadMi` of road in that 60%, using the same
// meters-per-pixel relation aheadCenter uses. Device- and
// latitude-independent by construction.
function zoomForLookahead(
  aheadMi: number,
  lat: number,
  viewportH: number,
): number {
  const aheadFraction = 0.6;
  const viewportM = (aheadMi * 1609.34) / aheadFraction;
  const metersPerDp = viewportM / Math.max(200, viewportH);
  const z =
    Math.log2(
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / metersPerDp,
    );
  return Math.min(15, Math.max(12.6, z));
}

// Build #27 (item 9): the neon treatment for the picked route
// color — push it toward white-hot so the line reads as lit neon
// over any base map, whichever of the four colors he picked.
function neonColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.22);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

// Build #24 (item 6) — the off-and-back-on "dip" guard. Larry's
// rule: on an interstate run the route must STAY on the interstate;
// a route that exits onto a surface road and rejoins the SAME
// interstate a few miles later is a defect, not a shortcut. The
// scorer walks a route option's maneuvers tracking which
// interstate the truck is established on. An exit maneuver opens
// an "episode"; the episode is a DIP when, before the route is
// re-established on that same interstate, a turn-family maneuver
// (types 9–16) or an on-ramp maneuver (18/19) back onto the same
// interstate intervenes. Exit narration that never actually
// leaves — an exit maneuver followed by a keep maneuver (23/24)
// whose segment is still named for the same interstate — is a
// phantom and scores zero. An episode that never closes (the
// genuine final departure to the destination, or a transfer onto
// a different interstate) is not a dip. Verified maneuver-by-
// maneuver against the live router on the I-70 IL -> Lebanon IN
// corridor (see build-24 run log): the old app request scored 5
// dips; the build #24 request scores 0.
function interstateKeys(names?: string[]): string[] {
  const keys: string[] = [];
  for (const n of names ?? []) {
    const m =
      /\bI[-\s]?(\d{1,3})\b/.exec(n) ?? /\bINTERSTATE\s+(\d{1,3})\b/i.exec(n);
    if (m) {
      const k = `I${m[1]}`;
      if (!keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

function countRouteDips(steps: NavStep[]): number {
  const isExit = (t?: number) => t === 20 || t === 21;
  const isRampOn = (t?: number) => t === 18 || t === 19;
  const isKeep = (t?: number) => t === 22 || t === 23 || t === 24;
  const isTurn = (t?: number) => t !== undefined && t >= 9 && t <= 16;
  let current: string | null = null;
  let episode = false;
  let dirty = false;
  let dips = 0;
  for (const s of steps) {
    const keys = interstateKeys(s.streetNames);
    if (!episode) {
      if (isExit(s.type) && current) {
        // An exit maneuver whose own (long) segment is already a
        // different interstate is a transfer, not a departure.
        if (keys.length && !keys.includes(current) && s.miles > 1) {
          current = keys[0];
          continue;
        }
        episode = true;
        dirty = false;
      } else if (keys.length) {
        current = keys[0];
      }
      continue;
    }
    // Inside an exit episode.
    if (isTurn(s.type)) dirty = true;
    if (isRampOn(s.type)) {
      // An on-ramp back onto the SAME interstate proves the route
      // really left it — that is the dip itself.
      if (keys.includes(current!)) dirty = true;
      if (dirty) dips += 1;
      if (keys.length && !keys.includes(current!)) current = keys[0];
      episode = false;
      continue;
    }
    if (isKeep(s.type) && keys.length) {
      // Re-established on a named interstate segment: same road =
      // phantom narration (unless a turn already dirtied the
      // episode); a different road = a transfer.
      if (dirty) dips += 1;
      if (!keys.includes(current!)) current = keys[0];
      episode = false;
      continue;
    }
    if (isExit(s.type)) {
      if (keys.length && !keys.includes(current!) && s.miles > 1) {
        if (dirty) dips += 1;
        current = keys[0];
        episode = false;
      }
      continue;
    }
    if (keys.length && !keys.includes(current!)) {
      if (dirty) dips += 1;
      current = keys[0];
      episode = false;
    }
  }
  return dips;
}

// Build #24 (item 1) — lane strip helpers. Direction bits in the
// order a driver reads them: through first, then the gentlest
// turn to the sharpest.
const LANE_DIR_PRIORITY = [2, 16, 8, 4, 32, 64, 128, 512, 1024, 256, 1];

function laneDirBit(mask: number): number {
  for (const bit of LANE_DIR_PRIORITY) {
    if (mask & bit) return bit;
  }
  return 2;
}

function laneGlyphName(bit: number): string {
  switch (bit) {
    case 4:
    case 8:
      return 'arrow-back';
    case 16:
      return 'return-up-back';
    case 64:
    case 128:
      return 'arrow-forward';
    case 32:
      return 'return-up-forward';
    case 256:
      return 'arrow-undo';
    case 512:
      return 'return-up-back';
    case 1024:
      return 'return-up-forward';
    default:
      return 'arrow-up';
  }
}

// The bitmask naming the direction(s) of this lane that follow
// the route: Valhalla's "active" (best) when present, else
// "valid". 0 = this lane does not follow the route (or the data
// doesn't say, in which case the strip stays hidden upstream).
function laneRouteMask(lane: NavLane): number {
  return lane.active ?? lane.valid ?? 0;
}

// Build #24 (item 10) — the "Then:" chip arrow. Direction comes
// from the maneuver's instruction text first (Valhalla always
// words turns left/right), with the maneuver type as fallback.
// On this router, observed: type 23 pairs with "keep right"
// wording and 24 with "keep left" (verified live, build #24).
function thenArrowName(step: NavStep): string {
  const text = step.instruction.toLowerCase();
  const t = step.type;
  const leftTypes = [3, 13, 14, 15, 16, 19, 21, 24];
  const rightTypes = [2, 9, 10, 11, 12, 18, 20, 23];
  if (/\bleft\b/.test(text) || (t !== undefined && leftTypes.includes(t) && !/\bright\b/.test(text))) {
    return 'arrow-back';
  }
  if (/\bright\b/.test(text) || (t !== undefined && rightTypes.includes(t))) {
    return 'arrow-forward';
  }
  return 'arrow-up';
}

// Build #24 (item 3) — the road the current maneuver travels:
// prefer an interstate/US name from the maneuver's street names.
function currentRoadName(step?: NavStep | null): string | null {
  const names = step?.streetNames ?? [];
  const major = names.find((n) => /^(I[-\s]?\d|US\b|INTERSTATE\b)/i.test(n));
  const raw = major ?? names[0];
  return raw ?? null;
}

// Valhalla encodes route shapes as a polyline with 6 decimal precision.
function decodePolyline6(str: string): Coord[] {
  const coords: Coord[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e6, longitude: lng / 1e6 });
  }
  return coords;
}

const truckStops = truckStopsJson as TruckStop[];
const weighStations = weighStationsJson as WeighStation[];

const SAVED_PLACES_KEY = 'geopro.savedPlaces.v1';
const TRUCK_PROFILE_KEY = 'geopro.truckProfile.v1';
const DEFAULT_TRUCK: TruckProfile = {
  heightFt: '13',
  heightIn: '6',
  weightLbs: '80000',
  lengthFt: '72',
  lengthIn: '0',
  widthFt: '8',
  widthIn: '6',
  hazmat: false,
};
// Free public truck-routing server (Valhalla, OpenStreetMap data).
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
// Same server's map-matching endpoint — used for the posted speed limit
// (OSM maxspeed) of the road under the truck during navigation.
const VALHALLA_TRACE_URL = 'https://valhalla1.openstreetmap.de/trace_attributes';

const INITIAL_CENTER = { latitude: 39.5, longitude: -98.35 };

// The POI category picker behind the rail's POI pill: Larry's list, in his
// order, with his names. Each entry maps onto the existing layer engine in
// constants/poi.ts (bundled datasets + OpenStreetMap/Overpass). Build #24
// (item 8): tiles are independent toggles — any combination can be on at
// once and every enabled category shows on the map together.
const POI_PICKER: { category: PoiCategory; label: string }[] = [
  { category: 'catscale', label: 'CAT Scales' },
  { category: 'distcenter', label: 'Distribution Centers' },
  { category: 'fuel', label: 'Gas Stations' },
  { category: 'milemarkers', label: 'Mile Markers' },
  { category: 'rest', label: 'Rest Areas' },
  { category: 'dealers', label: 'Truck Dealerships' },
  { category: 'parking', label: 'Truck Parking' },
  { category: 'stops', label: 'Truck Stops' },
  { category: 'weigh', label: 'Weigh Stations' },
];

// Build #24 (item 13): branded POI map badges, SmartTruckRoute
// style — a small rounded badge in the brand's own colors with
// its initial(s), drawn in-app (no logo files). A badge appears
// ONLY where the data actually names the brand: bundled truck
// stops carry a verified `chain` field, and OSM fuel POIs are
// matched against their own name text. 'Independent' stops and
// unmatched names keep the generic category badge — a brand is
// never guessed from location alone.
const CHAIN_BADGES: Record<string, { bg: string; fg: string; text: string }> = {
  Pilot: { bg: '#D22630', fg: '#FFFFFF', text: 'P' },
  'Flying J': { bg: '#FFC72C', fg: '#D22630', text: 'FJ' },
  "Love's": { bg: '#D22630', fg: '#FFD200', text: 'L' },
  TA: { bg: '#0057B8', fg: '#FFFFFF', text: 'TA' },
  Petro: { bg: '#F97316', fg: '#FFFFFF', text: 'P' },
  'Sapp Bros': { bg: '#1F3A93', fg: '#FFFFFF', text: 'SB' },
  QuikTrip: { bg: '#D22630', fg: '#FFFFFF', text: 'QT' },
  'Kwik Trip': { bg: '#0072CE', fg: '#FFFFFF', text: 'KT' },
  "Casey's": { bg: '#D22630', fg: '#FFFFFF', text: 'C' },
  "Buc-ee's": { bg: '#8A5A2B', fg: '#FFD200', text: 'B' },
  Maverik: { bg: '#111111', fg: '#E31837', text: 'M' },
  AMBEST: { bg: '#0057B8', fg: '#FFD200', text: 'A' },
  Bosselman: { bg: '#0057B8', fg: '#FFFFFF', text: 'B' },
  'Town Pump': { bg: '#0E7A3D', fg: '#FFFFFF', text: 'TP' },
};

// Brand badge for an OSM POI from its own name, or null when the
// name names no known travel-center chain. 'Flying J' is tested
// before 'Pilot' because so many locations carry both names
// ("Pilot Flying J") and the J is the distinctive badge.
function chainBadgeForName(
  name: string,
): { bg: string; fg: string; text: string } | null {
  const n = ` ${name.toLowerCase()} `;
  if (n.includes('flying j')) return CHAIN_BADGES['Flying J'];
  if (n.includes('pilot')) return CHAIN_BADGES.Pilot;
  if (n.includes("love's") || n.includes('loves')) return CHAIN_BADGES["Love's"];
  if (n.includes('petro')) return CHAIN_BADGES.Petro;
  if (/\bta\b/.test(n) || n.includes('travelcenters')) return CHAIN_BADGES.TA;
  if (n.includes('quiktrip') || n.includes('quik trip')) return CHAIN_BADGES.QuikTrip;
  if (n.includes('kwik trip')) return CHAIN_BADGES['Kwik Trip'];
  if (n.includes("casey's") || n.includes('caseys')) return CHAIN_BADGES["Casey's"];
  if (n.includes('buc-ee')) return CHAIN_BADGES["Buc-ee's"];
  if (n.includes('maverik')) return CHAIN_BADGES.Maverik;
  if (n.includes('sapp bros')) return CHAIN_BADGES['Sapp Bros'];
  if (n.includes('ambest')) return CHAIN_BADGES.AMBEST;
  if (n.includes('bosselman')) return CHAIN_BADGES.Bosselman;
  if (n.includes('town pump')) return CHAIN_BADGES['Town Pump'];
  return null;
}

export default function MapScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Build #23 (item 4): the turn banner must clear the PHONE'S
  // status bar (build #22 pinned it at top: 8 and it sat on top of
  // Larry's clock/notifications). The top safe-area inset is the
  // status bar's height on his phone; the banner drops to just
  // below it, and the *Nav anchor offsets key off the same number.
  const insets = useSafeAreaInsets();
  const bannerTop = spacing.sm + insets.top;
  // Build #27 (item 4): the turn banner's MEASURED height. The
  // banner's height varies (two-line instructions, the lane
  // strip), and the old fixed offsets for the floating buttons
  // below it guessed wrong — the banner's right edge sat on top
  // of the locate/compass circles and ate their taps. The banner
  // reports its real height via onLayout and the buttons hang
  // below the measured bottom edge.
  const [bannerHeight, setBannerHeight] = useState(0);
  const cameraRef = useRef<any>(null);
  const [selected, setSelected] = useState<TruckStop | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  // Address autocomplete: suggestions appear while typing, from the
  // same Nominatim service the full search uses.
  const [suggestions, setSuggestions] = useState<SavedPlace[]>([]);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSeqRef = useRef(0);
  const [searchResult, setSearchResult] = useState<SavedPlace | null>(null);
  // Build #24 (item 12): the destination card opens COMPACT —
  // address + Truck route / Start route only — so most of the map
  // (and the destination pin) stays visible and long-pressable
  // (item 11 needs that map access). The chevron expands it to
  // the full option list. Expansion is keyed to the destination's
  // id, so every NEW destination starts compact automatically.
  const [destCardExpandedId, setDestCardExpandedId] = useState<string | null>(
    null,
  );
  const destCardExpanded =
    searchResult !== null && destCardExpandedId === searchResult.id;
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  // The right-side tool rail (Map type, Saved, My Truck, Trip, Route,
  // Places) lives behind one floating button — collapsed by default so it
  // never covers the map, especially during navigation.
  const [railOpen, setRailOpen] = useState(false);
  const [truck, setTruck] = useState<TruckProfile>(DEFAULT_TRUCK);
  const [truckOpen, setTruckOpen] = useState(false);
  // Phase 2: route preferences (fastest/shortest, tolls, highways,
  // ferries) and toggleable POI map layers.
  const [routeSettings, setRouteSettings] = useState<RouteSettings | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  const [poiOpen, setPoiOpen] = useState(false);
  const [poiLayers, setPoiLayers] = useState<PoiLayerPrefs | null>(null);
  const [osmPois, setOsmPois] = useState<Partial<Record<PoiCategory, Poi[]>>>({});
  const [poiLoading, setPoiLoading] = useState<PoiCategory | null>(null);
  // Per-category lookup failures, kept separate from results so a failed
  // fetch is never displayed as a genuine "0 found".
  const [poiError, setPoiError] = useState<Partial<Record<PoiCategory, string>>>({});
  // Where each OSM category's cached results were loaded around, so a
  // pick made after driving across the state refetches instead of
  // silently reusing pins from hundreds of miles away.
  const osmCenterRef = useRef<Partial<Record<PoiCategory, Coord>>>({});
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null);
  const [poiAlongRoute, setPoiAlongRoute] = useState(false);
  // POI picker (rail's POI pill): Build #24 (item 8) made it a
  // MULTI-select — every tile is an independent toggle in the
  // same layer prefs the Places panel drives, so any combination
  // (including all of them) can be on at once and every enabled
  // category renders together. There is no single "pick" anymore.
  const [poiPickerOpen, setPoiPickerOpen] = useState(false);
  // "Across the USA" POI loading: the visible map region, tracked from
  // region-change events. Active categories load for wherever the map
  // is looking (viewport), and along the planned route (corridor) —
  // GPS-radius loading below stays as the first-open fallback.
  const mapRef = useRef<any>(null);
  const [viewBounds, setViewBounds] = useState<PoiBbox | null>(null);
  const viewBoundsRef = useRef<PoiBbox | null>(null);
  const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every new load request per category; a fetch whose token
  // is no longer current is stale (the map moved on) and its results
  // are dropped instead of overwriting fresher data.
  const osmRequestRef = useRef<Partial<Record<PoiCategory, number>>>({});
  const osmAbortRef = useRef<Partial<Record<PoiCategory, AbortController>>>({});
  // Regions each category has already loaded, so panning inside known
  // territory doesn't refetch, and panning somewhere new does.
  const osmLoadedAreasRef = useRef<Partial<Record<PoiCategory, PoiBbox[]>>>({});
  // Which route (by signature) each category's corridor load covers.
  const corridorKeyRef = useRef<Partial<Record<PoiCategory, string>>>({});
  // Sync mirrors for the debounced viewport loader and result merging,
  // which run outside render and must not act on stale state.
  const poiLayersRef = useRef<PoiLayerPrefs | null>(null);
  const osmPoisRef = useRef<Partial<Record<PoiCategory, Poi[]>>>({});
  const [routing, setRouting] = useState(false);
  const [routeCoords, setRouteCoords] = useState<Coord[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ miles: number; minutes: number } | null>(
    null,
  );
  const [navSteps, setNavSteps] = useState<NavStep[]>([]);
  const [navIndex, setNavIndexState] = useState<number | null>(null);
  const [navDistMi, setNavDistMi] = useState<number | null>(null);
  const [myPos, setMyPos] = useState<Coord | null>(null);
  const [navOptions, setNavOptions] = useState<NavOptions>(DEFAULT_NAV_OPTIONS);
  const [speedMph, setSpeedMph] = useState<number | null>(null);
  const [navRemain, setNavRemain] = useState<{
    miles: number;
    minutes: number;
    arriveLabel: string;
    // Build #27 (item 5): the arrival clock split for its own
    // always-on big cell in the nav strip — arriveShort is the
    // clock ("5:48 PM"), arriveZone the destination's zone
    // abbreviation ("EDT"), which rides in the cell's label
    // instead of shrinking the clock to fit.
    arriveShort: string;
    arriveZone: string;
  } | null>(null);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  // Low bridges (build #17): clearance points on the ACTIVE route
  // below the truck's height, from the corridor check that runs
  // after every plan / alternate pick / reroute, plus the persistent
  // note shown when a low bridge stays on the route.
  const [lowBridges, setLowBridges] = useState<LowBridgePoint[]>([]);
  const [lowBridgeNote, setLowBridgeNote] = useState<string | null>(null);
  // Stops on the way (build #18): the ordered intermediate stops.
  // routeViasRef below is the ref mirror planRoute reads; the two
  // are only ever changed together through syncVias().
  const [vias, setVias] = useState<ViaPoint[]>([]);
  // Leg summaries of the currently applied route option — drives
  // the per-stop ETAs in the stops panel.
  const [routeLegs, setRouteLegs] = useState<{ miles: number; minutes: number }[]>([]);
  // Transient stops-panel note (e.g. the 10-stop cap message).
  const [stopsMsg, setStopsMsg] = useState<string | null>(null);
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [weighAlert, setWeighAlert] = useState<string | null>(null);
  const [viaQuery, setViaQuery] = useState('');
  const [viaSearching, setViaSearching] = useState(false);
  const [viaDest, setViaDest] = useState<SavedPlace | null>(null);
  // Voice destination search: true while the recognizer is listening.
  const [listening, setListening] = useState(false);
  // Live navigation: camera follows the truck unless the driver grabs the
  // map; the full steps panel is an optional view, closed by default.
  const [navFollow, setNavFollow] = useState(true);
  const [stepsOpen, setStepsOpen] = useState(false);
  // Build #19: the truck marker's amber heading wedge rotates with
  // the smoothed GPS course relative to the map's bearing, and the
  // heading readout chip shows the same course as a cardinal +
  // degrees. Mirrors navHeadingRef into state, throttled to ~2°
  // changes.
  const [navCourseDeg, setNavCourseDeg] = useState<number | null>(null);
  // The strip's tappable stat cycles miles left -> time remaining
  // -> miles left. Miles are the default. (Build #27, item 5: the
  // arrival time left the cycle — it now has its own always-on big
  // cell at the right end of the strip.)
  const [stripStat, setStripStat] = useState<'miles' | 'time'>('miles');
  // Current elevation (feet) from the GPS altitude — shown as small
  // white text at the bottom-left of the map (Larry's placement).
  const [elevationFt, setElevationFt] = useState<number | null>(null);
  // Current map bearing in degrees (0 = north up). Tracked from the
  // region-change events so the compass needle can point at true
  // north now that two-finger rotation is enabled (Larry, Nov 7 —
  // this reverses the build #4 north-up lock at his word).
  const [mapHeading, setMapHeading] = useState(0);
  // Build #21: picture-in-picture is showing right now. While true
  // the screen renders ONLY the map + a compact turn banner (the
  // tab layout hides its own bar/header off the same flag in
  // constants/pipState), and the full layout returns on PiP exit.
  const [inPip, setInPip] = useState(false);
  // Build #22 (item 1) framed the WHOLE route (overview) in the
  // PiP mini window; build #27 (item 8) retired that — the mini
  // window now keeps the live follow view. pipOverview survives
  // only as the (now always-off) stand-down flag the camera
  // driver and watchdog still check, and its diagnostic marker.
  const [pipOverview, setPipOverview] = useState(false);
  const pipOverviewRef = useRef(false);
  // Frames the whole route in the PiP mini window. Held in a ref
  // (assigned once by an effect near its definition below). Build
  // #27: no longer called on PiP entry (see the poll effect) —
  // kept wired so the overview can return if Larry asks for it.
  const fitPipOverviewRef = useRef<() => void>(() => {});
  // Build #22 (item 2): the route chip's small X now hides ONLY the
  // card — the route, its line and its stops stay put. A slim pill
  // brings the card back (and the pill's own X is the real clear).
  const [chipHidden, setChipHidden] = useState(false);
  // Build #21: Larry's saved home (constants/home.ts, on-device
  // only) — drives the address card's Set home action and the
  // "Route home" launcher shortcut.
  const [homePlace, setHomePlace] = useState<HomePlace | null>(null);
  const homePlaceRef = useRef<HomePlace | null>(null);
  const routeHomeBusyRef = useRef(false);

  function noteElevation(meters: number | null | undefined) {
    if (meters == null || !Number.isFinite(meters)) return;
    setElevationFt(Math.round(meters * 3.28084));
  }
  // Posted speed limit (mph) for the current road; null = unknown.
  // Build #27 (item 11): the badge now SHOWS the unknown state
  // instead of hiding — a badge that silently vanishes mid-route
  // reads as a glitch, and the 5-over alert rides on this value.
  const [speedLimitMph, setSpeedLimitMph] = useState<number | null>(null);
  const speedLimitRef = useRef<number | null>(null);
  // Build #27 (item 12): the compass "N" button is a LATCHING
  // north-up toggle. While latched, the follow camera holds
  // bearing 0 no matter the travel direction; unlatching returns
  // the map to exactly the orientation it had before the latch
  // (in follow mode that is the live course-up view; freehand,
  // the bearing saved in preNorthBearingRef). Replaces the old
  // behavior where the follow camera snapped the map back to
  // course-up within a tick of the tap, making north-up a
  // momentary peek.
  const [northLock, setNorthLock] = useState(false);
  const northLockRef = useRef(false);
  const preNorthBearingRef = useRef(0);
  // Build #27 (item 3): repeated interstate shield badges along
  // the route ahead of the truck (positions recomputed in the nav
  // loop while the current road is an interstate), so the cruise
  // view shows the route's number 2–3 times instead of one long
  // unlabelled blue line.
  const [routeShields, setRouteShields] = useState<
    { id: string; latitude: number; longitude: number; label: string }[]
  >([]);
  const shieldTrackRef = useRef<{ alongMi: number; key: string } | null>(null);
  const navWatchRef = useRef<any>(null);
  const navStepsRef = useRef<NavStep[]>([]);
  const navIndexRef = useRef<number | null>(null);
  const navOptionsRef = useRef<NavOptions>(DEFAULT_NAV_OPTIONS);
  const routeDestRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const routeCoordsRef = useRef<Coord[]>([]);
  const reroutingRef = useRef(false);
  const lastRerouteRef = useRef(0);
  const offRouteStreakRef = useRef(0);
  const zoomStageRef = useRef<{ idx: number; stage: number } | null>(null);
  const announcedStepRef = useRef<number | null>(null);
  const tripWatchRef = useRef<any>(null);
  const announcedWeighRef = useRef<Set<string>>(new Set());
  // Low-bridge bookkeeping (build #17): ref mirror for the nav
  // warning loop, the corridor candidates from the last check (so
  // alternate picks can be filtered instantly from the same fetch),
  // a sequence guard that drops stale checks, cumulative Valhalla
  // avoid points per destination, and the signature of the route
  // currently applied (a check only ever acts on its own route).
  const lowBridgesRef = useRef<LowBridgePoint[]>([]);
  const lowBridgeCandidatesRef = useRef<LowBridgeCandidate[]>([]);
  const lowBridgeCheckRef = useRef(0);
  const lowBridgeAbortRef = useRef<AbortController | null>(null);
  const lowBridgeAvoidsRef = useRef<{ destKey: string; points: Coord[] }>({
    destKey: '',
    points: [],
  });
  const routeSigRef = useRef<string | null>(null);
  const announcedLowBridgeRef = useRef<Set<string>>(new Set());
  // Route progress (miles along the route) + the trimmed line state:
  // while navigating, the drawn route line starts at the truck so the
  // part already driven disappears behind it.
  const navAlongRef = useRef(0);
  const navTrimIdxRef = useRef(0);
  const [remainingCoords, setRemainingCoords] = useState<Coord[] | null>(null);
  // 5-mile POI / hazard / weather announcements: once per item per
  // nav session (keys carry a stage suffix where there are two calls).
  const announcedPoiRef = useRef<Set<string>>(new Set());
  const announcedHazardRef = useRef<Set<string>>(new Set());
  const announcedWeatherRef = useRef<Set<string>>(new Set());
  const weatherCheckRef = useRef(0);
  const overspeedRef = useRef(0);
  // Odometer (miles driven, resettable) + hazard reports + the
  // current-conditions readout for the weather chip.
  const [odoMi, setOdoMi] = useState(0);
  const odoShownRef = useRef(0);
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const hazardsRef = useRef<HazardReport[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [weatherNow, setWeatherNow] = useState<{
    tempF: number;
    label: string;
    windMph: number;
  } | null>(null);
  const weatherNowRef = useRef(0);
  // RainViewer radar frame path (latest), when the radar option is on.
  const [radarPath, setRadarPath] = useState<string | null>(null);
  // Smoothed badge position: the truck icon glides between GPS fixes
  // instead of hopping fix-to-fix.
  const [displayPos, setDisplayPos] = useState<Coord | null>(null);
  const badgePosRef = useRef<Coord | null>(null);
  const badgeAnimRef = useRef<{
    from: Coord;
    to: Coord;
    start: number;
    dur: number;
  } | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Build #20 motion engine: the badge no longer animates fix-to-fix
  // on a fixed-duration line. The latest raw fix (plus its speed)
  // feeds a continuous 50 ms tick that dead-reckons the aim point
  // along the smoothed heading between fixes and chases it with an
  // exponential approach — the truck glides and keeps rolling
  // between fixes instead of hopping. The same tick drives the
  // follow camera (see driveFollowCamera).
  const badgeTargetRef = useRef<{
    pos: Coord;
    at: number;
    speedMps: number | null;
  } | null>(null);
  const badgeTickRef = useRef({ lastAt: 0, camTicks: 0 });
  // Follow-camera zoom: the staged turn zoom now only NAMES the
  // target; the camera driver eases the applied zoom toward it, so
  // push-ins are smooth instead of discrete flyTo jumps.
  const navZoomTargetRef = useRef(15);
  // Build #24 (item 7): the current speed-scaled cruise zoom —
  // the staged turn-zoom logic recomputes it from the truck's
  // speed on every nav fix (15 in town, 13.9 at highway speed so
  // ~1–2 more miles of road show ahead).
  const cruiseZoomRef = useRef(15);
  const camZoomRef = useRef(15);
  const lastCamRef = useRef<{
    lat: number;
    lng: number;
    heading: number | null;
    zoom: number;
    at: number;
  } | null>(null);
  // Safe-zone watchdog (build #20): ~once a second while follow is
  // engaged, project the truck to screen pixels; if it ever leaves
  // the safe zone, force a recenter, and if it stays out, remount
  // the truck marker (epoch key) as a recovery.
  const watchdogRef = useRef({
    lastCheck: 0,
    badStreak: 0,
    lastEpochBump: 0,
    bearingStreak: 0,
  });
  // Mirror of the map's actual bearing (from region-change events)
  // for the watchdog's heading-up check.
  const mapHeadingRef = useRef(0);
  const windowDimsRef = useRef({ w: 0, h: 0 });
  const [markerEpoch, setMarkerEpoch] = useState(0);
  // Passed-maneuver tracking for the sooner reroute (build #20):
  // distance-to-turn per step — if it bottomed out close to the
  // maneuver and then rises on consecutive fixes, he drove past it.
  const maneuverTrackRef = useRef<{
    stepIdx: number;
    minD: number;
    lastD: number;
    rises: number;
  } | null>(null);
  const weighAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeViasRef = useRef<ViaPoint[]>([]);
  // Multi-stop nav bookkeeping (build #18): stops already announced
  // as passed this route (by stopKey), how many have been passed
  // (their announcement numbers run in the order they're reached),
  // and the last successful plan's endpoints so stop edits can
  // replan without a fresh GPS fix.
  const announcedStopRef = useRef<Set<string>>(new Set());
  const passedStopsRef = useRef(0);
  const lastPlanRef = useRef<{
    fromLat: number;
    fromLng: number;
    destLat: number;
    destLng: number;
  } | null>(null);
  const routeDestNameRef = useRef<string | null>(null);
  const navFollowRef = useRef(true);
  // Build #19: pending auto re-center — when a map grab pauses
  // follow mid-navigation, this timer re-locks follow after ~5 s
  // without further interaction (Google Maps behavior).
  const autoFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Check-in points (Larry, Nov 8): the checkered flag marks the
  // address the route ends at; a second, smaller flag marks where a
  // driver actually checks in. The working destination below is set
  // on every successful route plan and intentionally survives
  // clearRoute() — dropping a pin to mark the check-in spot clears
  // the route, and the pin card still needs to know which
  // destination the point belongs to.
  const [destContext, setDestContext] = useState<{
    latitude: number;
    longitude: number;
    name: string | null;
  } | null>(null);
  const destContextRef = useRef<{
    latitude: number;
    longitude: number;
    name: string | null;
  } | null>(null);
  // Driver-saved check-ins (constants/checkin.ts), keyed by
  // destination. The ref mirror serves the async resolvers.
  const [checkIns, setCheckIns] = useState<CheckInMap>({});
  const checkInsRef = useRef<CheckInMap>({});
  // The second flag, once resolved: the driver's own saved check-in
  // for the working destination, if he has set one. (An automatic
  // map-detected "truck entrance" flag shipped in build #14 and was
  // removed the same day at Larry's call — it flagged wrong spots at
  // rural/unmapped destinations. Saved check-ins are his marks only.)
  const [checkInFlag, setCheckInFlag] = useState<{
    key: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const resolveCheckInRef = useRef<
    (dest: { latitude: number; longitude: number; name: string | null }) => void
  >(() => {});
  // Smoothed GPS course. It feeds the navigation camera heading
  // (Driver's POV — the map turns with the truck, so the road runs
  // up-and-down; confirmed again by Larry's reference pictures,
  // Nov 8), the ahead-of-truck camera shift (aheadCenter), the
  // marker's heading wedge, and the heading readout chip. Null
  // until the first rolling fix gives us one.
  const navHeadingRef = useRef<number | null>(null);

  // Camera center for the nav follow shots: shifted AHEAD of the
  // given point along the heading, so the point itself renders low
  // on the screen (~40% up from the bottom) and the driver sees more
  // of what's coming than what's behind. Build #21 raised the
  // anchor from ~28% (build #20): Larry's Nov 9 road test — "I
  // can't see the truck icon, its to far down" — the 28% spot sat
  // too close to the bottom nav strip. A point renders at fraction
  // f up from the bottom when the center is shifted ahead by
  // (0.5 - f) of the window height, so f = 0.40 -> shift 0.10.
  // No heading yet → point unshifted.
  function aheadCenter(
    lat: number,
    lng: number,
    zoom: number,
    heading: number | null,
  ): [number, number] {
    if (heading === null) return [lng, lat];
    const latRad = (lat * Math.PI) / 180;
    const metersPerDp =
      (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
    const shiftM = metersPerDp * windowHeight * 0.1;
    const hRad = (heading * Math.PI) / 180;
    const dLat = (shiftM * Math.cos(hRad)) / 111320;
    const dLng = (shiftM * Math.sin(hRad)) / (111320 * Math.cos(latRad));
    return [lng + dLng, lat + dLat];
  }
  const speedCheckRef = useRef<{
    at: number;
    latitude: number;
    longitude: number;
  } | null>(null);
  const prevFixRef = useRef<Coord | null>(null);
  // Speech events are registered once; this ref always points at the
  // latest searchAddress closure so a spoken result searches fresh state.
  const searchByTextRef = useRef<(text: string) => void>(() => {});

  function setFollow(follow: boolean) {
    navFollowRef.current = follow;
    setNavFollow(follow);
  }

  // Build #27 (item 12): the compass "N" button toggles the north
  // latch. Latching remembers the bearing the map sits at right
  // now; while latched, the follow camera holds bearing 0 (see
  // driveFollowCamera) or, freehand, the map flies north and
  // stays. Unlatching restores exactly what was there before:
  // in follow navigation the camera driver simply resumes the
  // live course-up bearing (the pre-tap orientation), and
  // freehand the map flies back to the saved bearing.
  function toggleNorthLock() {
    if (!northLockRef.current) {
      preNorthBearingRef.current = mapHeadingRef.current;
      northLockRef.current = true;
      setNorthLock(true);
      if (navIndexRef.current !== null && navFollowRef.current) {
        // The camera driver applies bearing 0 from its next
        // tick; clear its memory so the skip gates can't pass.
        lastCamRef.current = null;
      } else {
        // `bearing`, not `heading` — MapLibre's Camera ignores
        // `heading` (the build #21 fix).
        cameraRef.current?.flyTo({ bearing: 0, duration: 300 });
      }
    } else {
      northLockRef.current = false;
      setNorthLock(false);
      if (navIndexRef.current !== null && navFollowRef.current) {
        lastCamRef.current = null;
      } else {
        cameraRef.current?.flyTo({
          bearing: preNorthBearingRef.current,
          duration: 300,
        });
      }
    }
  }

  // Build #19: grabbing the map during navigation pauses follow
  // (the long-standing behavior), but only for a few seconds — with
  // no further interaction, follow re-locks onto the truck on its
  // own (Google Maps behavior; Larry's build #18 road test: a stray
  // touch stranded the view while the voice kept guiding). Called
  // from the map tap handler and from user-interaction region
  // changes (pans / pinches / rotations). The amber Follow button
  // stays as the manual override.
  function noteNavMapGrabbed() {
    if (navIndexRef.current === null) return;
    setFollow(false);
    if (autoFollowTimerRef.current) clearTimeout(autoFollowTimerRef.current);
    autoFollowTimerRef.current = setTimeout(() => {
      autoFollowTimerRef.current = null;
      if (navIndexRef.current === null || navFollowRef.current) return;
      // Build #20: no flyTo needed here — the motion tick's camera
      // driver re-anchors on the truck within ~100 ms of follow
      // flipping back on.
      setFollow(true);
    }, 5000);
  }

  // Build #19: picture-in-picture is armed exactly while turn-by-
  // turn navigation is running. The native module does the rest
  // (Android 12+ auto-enter + the pause-path entry on older flows).
  useEffect(() => {
    setPipArmed(navIndex !== null);
  }, [navIndex]);

  // Window size mirror for the safe-zone watchdog (refs, so the
  // 50 ms motion tick can read current dims without re-creating
  // its interval on every render).
  useEffect(() => {
    windowDimsRef.current = { w: windowWidth, h: windowHeight };
  }, [windowWidth, windowHeight]);

  // Fallback PiP entry: if the native pause hook somehow missed,
  // an AppState backgrounding during navigation asks once more.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && navIndexRef.current !== null) {
        enterPip();
      }
    });
    return () => sub.remove();
  }, []);

  // Minimized-window layout detection. While navigating (the only
  // time the window can shrink), poll the native side ~3x a second;
  // when the app is in a small window, this screen renders ONLY the
  // map + a compact turn banner and the tab layout hides its
  // bar/header (shared flag in constants/pipState). Exiting the
  // small window restores everything.
  // Build #23 (item 5) — why #21/#22 missed on Larry's phone: both
  // keyed the swap off isInPictureInPictureMode ONLY. On his
  // Samsung, shrinking the app puts it in One UI's freeform POP-UP
  // VIEW, where that flag stays false forever — so the swap never
  // fired and the mini window kept the full layout (its GL map sat
  // above the visible slice; only the tab bar showed). Detection
  // now also reads the native window bounds: multi-window mode, or
  // a window under 60% of the physical screen height while much
  // wider than tall, counts as minimized too. (The manifest half
  // of the fix — declaring the size configChanges so Android stops
  // recreating the activity on the resize — lives in
  // plugins/withPip.js.)
  useEffect(() => {
    if (Platform.OS !== 'android' || navIndex === null) return;
    let live = true;
    const tick = () => {
      if (!live) return;
      let pip = isInPip();
      if (!pip) {
        const ws = getWindowState();
        if (
          ws &&
          ws.screenHeight > 0 &&
          // Build #27 (item 8): the build #23 test also demanded
          // the window be WIDER THAN TALL — a portrait-ish pop-up
          // view fails that clause, so on Larry's phone the swap
          // still never fired and the mini window kept the full
          // layout (tab bar and all). Any clearly-shrunken window
          // now counts: multi-window, under 60% of the screen
          // height, or under 70% of the screen width.
          (ws.multiWindow ||
            ws.windowHeight < ws.screenHeight * 0.6 ||
            ws.windowWidth < ws.screenWidth * 0.7)
        ) {
          pip = true;
        }
      }
      setInPip((prev) => {
        if (prev === pip) return prev;
        // Build #27 (item 8) REPLACES the build #22 behavior:
        // entering the mini window no longer switches it to the
        // whole-route overview fit. Larry's word: "when it's
        // minimized it's not showing the map. Still need to see
        // the map [and] which way we're going." So the mini
        // window keeps the LIVE follow camera — map centered on
        // the truck, heading up (or north-latched) — exactly the
        // main view, minus the chrome. pipOverview stays off;
        // clearing lastCam forces the camera driver to re-apply
        // a fresh follow shot for the resized window at once.
        pipOverviewRef.current = false;
        setPipOverview(false);
        lastCamRef.current = null;
        return pip;
      });
      setSharedInPip(pip);
    };
    tick();
    const t = setInterval(tick, 350);
    return () => {
      live = false;
      clearInterval(t);
      setInPip(false);
      setSharedInPip(false);
      pipOverviewRef.current = false;
      setPipOverview(false);
    };
  }, [navIndex]);

  // Build #22 (item 1): frame the ENTIRE route inside the PiP mini
  // window — the fix list's acceptance ("minimize mid-route → the
  // small window shows the navigation map, entire green route
  // fitted in frame"). Uses the untrimmed planned line so the whole
  // run is visible even though the main map trims behind the truck.
  // Assigned inside an effect (never during render): the closure
  // only reads refs, so one stable assignment is enough.
  useEffect(() => {
    fitPipOverviewRef.current = () => {
      const coords = routeCoordsRef.current;
      if (!coords || coords.length < 2) return;
      const lngs = coords.map((c) => c.longitude);
      const lats = coords.map((c) => c.latitude);
      cameraRef.current?.fitBounds(
        [
          Math.min(...lngs),
          Math.min(...lats),
          Math.max(...lngs),
          Math.max(...lats),
        ],
        {
          // Tight padding, and leave room at the top for the compact
          // PiP turn banner that overlays the window.
          padding: { top: 44, right: 10, bottom: 10, left: 10 },
          duration: 0,
        },
      );
    };
  }, []);

  // Build #21: load the saved home once on mount (on-device only).
  useEffect(() => {
    loadHome().then((h) => {
      homePlaceRef.current = h;
      setHomePlace(h);
    });
  }, []);

  // Voice search events: interim words fill the search box as they're
  // heard; the final result runs the normal address search, and the
  // driver still confirms with Save / Truck route on the result card.
  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript?.trim();
    if (!text) return;
    setQuery(text);
    if (event.isFinal) {
      setListening(false);
      searchByTextRef.current(text);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error === 'no-speech' || event.error === 'speech-timeout') {
      setLocationError("Didn't catch that. Tap the mic and say the place again.");
    } else if (
      event.error === 'not-allowed' ||
      event.error === 'service-not-allowed'
    ) {
      setLocationError(
        'Voice search is not allowed on this phone. Type the address instead.',
      );
    } else if (event.error !== 'aborted') {
      setLocationError('Voice search ran into a problem. Type the address instead.');
    }
  });

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
    };
  }, []);

  // Build #27 (item 10): every prompt takes transient DUCKING
  // audio focus (navigation-guidance usage) for exactly its own
  // length, so music/podcasts drop under the voice Google Maps
  // style, then come back. The utterance sequence number guards
  // the release: an interrupted prompt's onStopped must not hand
  // the audio back while its replacement is still speaking.
  const speechSeqRef = useRef(0);

  function speak(text: string, opts?: { stopFirst?: boolean }) {
    if (!navOptionsRef.current.voice) return;
    try {
      if (opts?.stopFirst !== false) Speech.stop();
      // Volume comes from the More-tab slider (item 10b); the
      // default is full. The phone's media volume is still the
      // ceiling — the ducking focus above is what makes the voice
      // win over Bluetooth audio, not a bigger number here.
      const volume = Math.min(
        1,
        Math.max(0.05, navOptionsRef.current.voiceVolume ?? 1),
      );
      duckOtherAudio();
      const seq = ++speechSeqRef.current;
      const releaseIfCurrent = () => {
        if (speechSeqRef.current === seq) releaseDuckedAudio();
      };
      Speech.speak(text, {
        voice: navOptionsRef.current.voiceId ?? undefined,
        volume,
        onDone: releaseIfCurrent,
        onStopped: releaseIfCurrent,
        onError: releaseIfCurrent,
      });
    } catch {}
  }

  function showWeighAlert(text: string) {
    setWeighAlert(text);
    if (weighAlertTimerRef.current) clearTimeout(weighAlertTimerRef.current);
    weighAlertTimerRef.current = setTimeout(() => setWeighAlert(null), 9000);
  }

  function setLowBridgesBoth(list: LowBridgePoint[]) {
    lowBridgesRef.current = list;
    setLowBridges(list);
  }

  function lowBridgeNoteText(bridges: LowBridgePoint[]): string {
    const lowest = bridges.reduce((a, b) => (a.clearanceM <= b.clearanceM ? a : b));
    return (
      `⚠️ Low bridge on this route — ${lowest.label} clearance` +
      (bridges.length > 1 ? ` (${bridges.length} found)` : '') +
      `. Warnings at 5 miles and 1 mile.`
    );
  }

  function setNavIndex(i: number | null) {
    const prev = navIndexRef.current;
    navIndexRef.current = i;
    setNavIndexState(i);
    if (i !== null && i !== prev) {
      const step = navStepsRef.current[i];
      if (step) speak(step.instruction);
    }
  }

  function stopNav() {
    if (navWatchRef.current) {
      navWatchRef.current.remove();
      navWatchRef.current = null;
    }
    try {
      Speech.stop();
    } catch {}
    // Build #27 (item 10): stopping speech also hands the audio
    // back — a prompt cut off by End must not leave other audio
    // ducked.
    releaseDuckedAudio();
    zoomStageRef.current = null;
    announcedStepRef.current = null;
    navHeadingRef.current = null;
    if (autoFollowTimerRef.current) clearTimeout(autoFollowTimerRef.current);
    autoFollowTimerRef.current = null;
    setNavCourseDeg(null);
    setNavIndex(null);
    setStepsOpen(false);
    setReportOpen(false);
    setFollow(true);
    // Build #27: a fresh navigation starts unlatched (course-up)
    // and shield-free.
    northLockRef.current = false;
    setNorthLock(false);
    shieldTrackRef.current = null;
    setRouteShields([]);
    setStripStat('miles');
    setSpeedLimitMph(null);
    speedLimitRef.current = null;
    speedCheckRef.current = null;
    prevFixRef.current = null;
    setNavDistMi(null);
    setSpeedMph(null);
    setNavRemain(null);
    setWeighAlert(null);
    announcedWeighRef.current = new Set();
    announcedLowBridgeRef.current = new Set();
    navAlongRef.current = 0;
    navTrimIdxRef.current = 0;
    offRouteStreakRef.current = 0;
    setRemainingCoords(null);
    announcedPoiRef.current = new Set();
    announcedHazardRef.current = new Set();
    announcedWeatherRef.current = new Set();
    badgeAnimRef.current = null;
    if (badgeTimerRef.current) clearInterval(badgeTimerRef.current);
    badgeTimerRef.current = null;
    badgePosRef.current = null;
    badgeTargetRef.current = null;
    navZoomTargetRef.current = 15;
    camZoomRef.current = 15;
    lastCamRef.current = null;
    maneuverTrackRef.current = null;
    watchdogRef.current = {
      lastCheck: 0,
      badStreak: 0,
      lastEpochBump: 0,
      bearingStreak: 0,
    };
    setDisplayPos(null);
  }

  function cycleStripStat() {
    setStripStat((m) => (m === 'miles' ? 'time' : 'miles'));
  }

  // Spoken noun for a POI category, for the 5-mile heads-up calls.
  function poiSpokenNoun(key: string): string {
    switch (key) {
      case 'rest':
        return 'Rest area';
      case 'repair':
        return 'Truck repair shop';
      case 'walmart':
        return 'Walmart';
      case 'parking':
        return 'Truck parking';
      case 'tpc':
        return 'Truck Parking Club location';
      case 'catscale':
        return 'CAT Scale';
      case 'fuel':
        return 'Gas station';
      case 'distcenter':
        return 'Distribution center';
      case 'dealers':
        return 'Truck dealership';
      case 'construction':
        return 'Construction zone';
      default:
        return 'Point of interest';
    }
  }

  // NWS active alerts for a position (US only, no key needed).
  // Severe warnings are spoken once each per nav session.
  async function checkWeatherAlerts(lat: number, lng: number) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(
          `https://api.weather.gov/alerts/active?point=${lat},${lng}`,
          {
            headers: { 'User-Agent': 'HammerLaneCo/1.0 (Android trucker app)' },
            signal: controller.signal,
          },
        );
        if (!resp.ok) return;
        const data: any = await resp.json();
        const features: any[] = Array.isArray(data?.features)
          ? data.features
          : [];
        for (const f of features) {
          const props = f?.properties ?? {};
          const id = typeof props.id === 'string' ? props.id : null;
          const event =
            typeof props.event === 'string' ? props.event : null;
          const severity =
            typeof props.severity === 'string' ? props.severity : '';
          if (!id || !event || announcedWeatherRef.current.has(id))
            continue;
          if (
            severity === 'Extreme' ||
            severity === 'Severe' ||
            event.includes('Warning')
          ) {
            announcedWeatherRef.current.add(id);
            speak(`Weather alert: ${event}.`, { stopFirst: false });
            showWeighAlert(`🌩️ Weather alert — ${event}`);
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  }

  // Current conditions from Open-Meteo (free, no key), for the
  // weather chip. Throttled to one fetch per 15 minutes.
  async function refreshWeatherNow(lat: number, lng: number, now: number) {
    if (now - weatherNowRef.current < 900000) return;
    weatherNowRef.current = now;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`,
          { signal: controller.signal },
        );
        if (!resp.ok) return;
        const data: any = await resp.json();
        const cur = data?.current;
        if (!cur || typeof cur.temperature_2m !== 'number') return;
        const code = typeof cur.weather_code === 'number' ? cur.weather_code : -1;
        const label =
          code === 0
            ? 'Clear'
            : code <= 2
              ? 'Partly cloudy'
              : code === 3
                ? 'Overcast'
                : code === 45 || code === 48
                  ? 'Fog'
                  : code >= 51 && code <= 57
                    ? 'Drizzle'
                    : code >= 61 && code <= 67
                      ? 'Rain'
                      : code >= 71 && code <= 77
                        ? 'Snow'
                        : code >= 80 && code <= 82
                          ? 'Showers'
                          : code >= 95
                            ? 'Thunderstorm'
                            : '—';
        setWeatherNow({
          tempF: Math.round(cur.temperature_2m),
          label,
          windMph:
            typeof cur.wind_speed_10m === 'number'
              ? Math.round(cur.wind_speed_10m)
              : 0,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  }

  // Build #20 motion engine. The old glide animated the badge from
  // fix to fix over a fixed 1.1 s line while the camera flyTo'd to
  // each raw fix on its own clock — two unsynced motions that read
  // as hops and skips, and when the framing math lost the truck
  // there was no recovery (Larry's build #19 road test: "No truck
  // when drive", "it skips and not a smooth moving"). Now one 50 ms
  // tick owns all motion while the badge is live:
  //  - the aim point is the latest fix DEAD-RECKONED along the
  //    smoothed heading at the fix's speed, so the truck keeps
  //    rolling between fixes instead of waiting for the next one;
  //  - the badge chases the aim point with an exponential approach
  //    (frame-rate independent, no overshoot, blends corrections);
  //  - every other tick the follow camera jumpTo's to the SAME
  //    smoothed position (ahead-shifted as before), so camera and
  //    truck move as one — and the truck, anchored to the position
  //    the camera is derived from, cannot leave the frame;
  //  - ~once a second a watchdog projects the truck to screen
  //    pixels and recovers (recenter, then marker remount) if it
  //    is ever outside the safe zone anyway.
  // Jumps over half a mile (GPS glitches, first fix) snap instantly.
  function glideBadgeTo(target: Coord, now: number, speedMps?: number | null) {
    const from = badgePosRef.current;
    badgeTargetRef.current = {
      pos: target,
      at: now,
      speedMps: speedMps ?? null,
    };
    if (
      !from ||
      distMi(from.latitude, from.longitude, target.latitude, target.longitude) >
        0.5
    ) {
      badgeAnimRef.current = null;
      badgePosRef.current = target;
      setDisplayPos(target);
    }
    startMotionTick();
  }

  function startMotionTick() {
    if (badgeTimerRef.current) return;
    badgeTickRef.current.lastAt = 0;
    badgeTimerRef.current = setInterval(() => motionTick(Date.now()), 50);
  }

  function motionTick(now: number) {
    const tick = badgeTickRef.current;
    const dt = tick.lastAt
      ? Math.min(200, Math.max(1, now - tick.lastAt))
      : 50;
    tick.lastAt = now;
    const target = badgeTargetRef.current;
    const cur = badgePosRef.current;
    if (!target || !cur) return;
    // Dead-reckoned aim point: the last fix carried forward along
    // the smoothed course at its own speed, capped so a stale fix
    // can't run away (2.5 s / 0.25 mi, whichever comes first).
    let aimLat = target.pos.latitude;
    let aimLng = target.pos.longitude;
    const spd = target.speedMps;
    const hdg = navHeadingRef.current;
    if (spd != null && spd > 0.5 && hdg !== null) {
      const elapsedS = Math.min((now - target.at) / 1000, 2.5);
      const aheadM = Math.min(spd * elapsedS, 0.25 * 1609.34);
      if (aheadM > 1) {
        const hRad = (hdg * Math.PI) / 180;
        const latRad = (target.pos.latitude * Math.PI) / 180;
        aimLat += (aheadM * Math.cos(hRad)) / 111320;
        aimLng += (aheadM * Math.sin(hRad)) / (111320 * Math.cos(latRad));
      }
    }
    const k = 1 - Math.exp(-dt / 280);
    const next = {
      latitude: cur.latitude + (aimLat - cur.latitude) * k,
      longitude: cur.longitude + (aimLng - cur.longitude) * k,
    };
    if (
      distMi(cur.latitude, cur.longitude, next.latitude, next.longitude) *
        1609.34 >
      0.15
    ) {
      badgePosRef.current = next;
      setDisplayPos(next);
    }
    tick.camTicks += 1;
    if (tick.camTicks % 2 === 0) driveFollowCamera(now);
    if (now - watchdogRef.current.lastCheck >= 1000) {
      watchdogRef.current.lastCheck = now;
      void checkTruckInFrame(now);
    }
  }

  // The follow camera (build #20): anchored on the SMOOTHED truck
  // position — the exact spot the marker is drawn at — every ~100 ms
  // while follow is engaged. Small zero-duration steps at that
  // cadence read as one continuous glide (at highway speed each
  // step moves the center ~2 m). The zoom eases toward the staged
  // target the turn-zoom logic names, so push-ins glide too. When
  // nothing has meaningfully moved (parked), it re-applies at most
  // every 2 s as a keep-alive so any native drift self-heals.
  function driveFollowCamera(now: number) {
    // Build #22 (item 1): in the PiP overview the camera belongs to
    // fitPipOverview — never chase the truck in the mini window.
    if (pipOverviewRef.current) return;
    if (navIndexRef.current === null || !navFollowRef.current) return;
    const p = badgePosRef.current;
    if (!p) return;
    const zt = navZoomTargetRef.current;
    let z = camZoomRef.current;
    const dz = zt - z;
    if (Math.abs(dz) > 0.005) {
      z += Math.max(-0.08, Math.min(0.08, dz));
      camZoomRef.current = z;
    }
    const h = navHeadingRef.current;
    // Build #27 (item 12): while the north latch is on, the camera
    // bearing is 0 (north-up) no matter the course — the center
    // still shifts along the geographic course (aheadCenter), so
    // the road ahead fills the screen in the direction of travel.
    // Unlatching returns bearingOut to the live course, which is
    // exactly the orientation the map had before the latch.
    const bearingOut = northLockRef.current ? 0 : h;
    const last = lastCamRef.current;
    if (last) {
      const movedM =
        distMi(last.lat, last.lng, p.latitude, p.longitude) * 1609.34;
      const dh =
        bearingOut === null || last.heading === null
          ? 0
          : Math.abs(((bearingOut - last.heading + 540) % 360) - 180);
      if (
        movedM < 1 &&
        dh < 0.5 &&
        Math.abs(z - last.zoom) < 0.01 &&
        now - last.at < 2000
      ) {
        return;
      }
    }
    lastCamRef.current = {
      lat: p.latitude,
      lng: p.longitude,
      heading: bearingOut,
      zoom: z,
      at: now,
    };
    // BUILD #21 HEADING-UP FIX — the actual bug behind Larry's
    // Nov 9 10:29 AM screenshot (heading readout W / 271°, speed
    // 75, yet the map sat north-up/sideways with the route line
    // running horizontally): this jumpTo used to pass the course
    // as `heading`, but MapLibre RN v11's Camera options have no
    // `heading` field — the native CameraStop only reads `bearing`
    // (Camera.d.ts CameraOptions / android CameraStop.kt), so the
    // rotation was silently dropped on EVERY tick and the map
    // never turned. The course now goes out as `bearing`, which is
    // what actually rotates the map heading-up, Google Maps style.
    cameraRef.current?.jumpTo({
      center: aheadCenter(p.latitude, p.longitude, z, h),
      zoom: z,
      ...(bearingOut !== null ? { bearing: bearingOut } : {}),
    });
  }

  // Safe-zone watchdog: the camera driver anchors on the truck by
  // construction, but Larry's rule is "in view at all times" — so
  // verify it on screen ~once a second. A truck projected outside
  // the safe zone gets an immediate forced recenter; if it is still
  // out a second later, the marker itself is remounted (epoch key)
  // in case the native marker view is what failed.
  async function checkTruckInFrame(now: number) {
    // Build #22 (item 1): the PiP overview intentionally frames the
    // whole route, truck wherever it falls — no recentering there.
    if (pipOverviewRef.current) return;
    if (navIndexRef.current === null || !navFollowRef.current) return;
    // Build #21 heading-up verification, folded into this watchdog:
    // the map's ACTUAL bearing (region-change events) must track
    // the smoothed course. If it sits >25° off for two straight
    // checks, the rotation is not landing — force the camera driver
    // to re-apply it (lastCam cleared so the moved/heading gates
    // can't skip the shot). This is the tripwire that would have
    // caught the dropped-`heading` bug on the road.
    // Build #26: the tripwire itself was blind through #25 — it
    // reads mapHeadingRef, which the region handlers fed from a
    // nonexistent `heading` event key, so it compared course
    // against a permanent 0. regionBearing() feeds it the real
    // `bearing` now, so this check finally means something.
    // Build #27 (item 12): the tripwire stands down while the
    // north latch is on — there the map bearing is SUPPOSED to
    // sit at 0 while the course points elsewhere.
    const course = navHeadingRef.current;
    if (course !== null && !northLockRef.current) {
      const dh = Math.abs(((course - mapHeadingRef.current + 540) % 360) - 180);
      const wdB = watchdogRef.current;
      if (dh > 25) {
        wdB.bearingStreak += 1;
        if (wdB.bearingStreak >= 2) {
          wdB.bearingStreak = 0;
          lastCamRef.current = null;
          driveFollowCamera(now);
        }
      } else {
        wdB.bearingStreak = 0;
      }
    }
    const p = badgePosRef.current ?? prevFixRef.current;
    const map = mapRef.current;
    if (!p || !map?.project) return;
    try {
      const pt: any = await map.project([p.longitude, p.latitude]);
      if (navIndexRef.current === null || !navFollowRef.current) return;
      const x = Array.isArray(pt) ? pt[0] : pt?.x;
      const y = Array.isArray(pt) ? pt[1] : pt?.y;
      const { w, h } = windowDimsRef.current;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !isFinite(x) ||
        !isFinite(y) ||
        !w ||
        !h
      ) {
        return;
      }
      const wd = watchdogRef.current;
      // Safe zone tracks the build #21 anchor: the truck should
      // sit ~40% up from the bottom (y ≈ 0.60h) centered-ish.
      if (x >= w * 0.05 && x <= w * 0.95 && y >= h * 0.26 && y <= h * 0.8) {
        wd.badStreak = 0;
        return;
      }
      wd.badStreak += 1;
      lastCamRef.current = null;
      driveFollowCamera(now);
      if (wd.badStreak >= 2 && now - wd.lastEpochBump > 5000) {
        wd.lastEpochBump = now;
        wd.badStreak = 0;
        setMarkerEpoch((e) => e + 1);
      }
    } catch {}
  }

  // Drop a hazard report at the truck's current position.
  function reportHazard(kind: HazardKind, at: number) {
    const pos = prevFixRef.current ?? myPos;
    if (!pos) return;
    const report: HazardReport = {
      id: `hz-${at}`,
      kind,
      latitude: pos.latitude,
      longitude: pos.longitude,
      at,
    };
    const next = pruneHazards([...hazardsRef.current, report]);
    hazardsRef.current = next;
    setHazards(next);
    void saveHazards(next);
    setReportOpen(false);
    speak(`Reported: ${HAZARD_LABELS[kind].replace(' ahead', '')}.`, {
      stopFirst: false,
    });
  }

  function resetOdometerPressed() {
    resetOdometer();
    odoShownRef.current = 0;
    setOdoMi(0);
  }

  // Posted speed limit (mph) for the road under the truck, from
  // Valhalla's trace_attributes (OpenStreetMap maxspeed on the matched
  // edge). Throttled to one lookup per ~20 s and 0.05 mi of travel.
  // No data -> the limit stays null and the badge shows its explicit
  // unknown state (build #27, item 11); it never guesses a limit.
  async function refreshSpeedLimit(lat: number, lng: number, now: number) {
    const last = speedCheckRef.current;
    if (
      last &&
      now - last.at < 20000 &&
      distMi(lat, lng, last.latitude, last.longitude) < 0.05
    ) {
      return;
    }
    speedCheckRef.current = { at: now, latitude: lat, longitude: lng };
    const prev = prevFixRef.current;
    const trailing =
      prev && distMi(lat, lng, prev.latitude, prev.longitude) > 0.01
        ? { lat: prev.latitude, lon: prev.longitude }
        : { lat: lat + 0.0002, lon: lng };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(VALHALLA_TRACE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shape: [trailing, { lat, lon: lng }],
            costing: 'auto',
            shape_match: 'map_snap',
            units: 'miles',
            filters: {
              attributes: ['edge.speed_limit'],
              action: 'include',
            },
          }),
          signal: controller.signal,
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const edges: any[] = Array.isArray(data?.edges) ? data.edges : [];
        const raw = edges.length ? edges[edges.length - 1]?.speed_limit : null;
        const limit =
          typeof raw === 'number' && raw > 0 ? Math.round(raw) : null;
        speedLimitRef.current = limit;
        setSpeedLimitMph(limit);
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  }

  async function startNav() {
    if (!navStepsRef.current.length) return;
    // Start route = live navigation on the map: route line is already
    // drawn, the camera follows the truck, and the next turn lives in a
    // slim banner. The steps panel stays closed unless asked for.
    setStepsOpen(false);
    setRailOpen(false);
    setFollow(true);
    setStripStat('miles');
    setNavIndex(0);
    // Build #20: seed the truck marker from the last known fix so
    // it is on the map from the first nav frame instead of waiting
    // for the watch's first fix, and start the camera driver at
    // cruise zoom.
    navZoomTargetRef.current = 15;
    camZoomRef.current = 15;
    lastCamRef.current = null;
    const seed = prevFixRef.current ?? myPos;
    if (seed) {
      setMyPos(seed);
      if (!badgePosRef.current) {
        badgePosRef.current = seed;
        badgeTargetRef.current = { pos: seed, at: 0, speedMps: null };
        setDisplayPos(seed);
        startMotionTick();
      }
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      if (navWatchRef.current) navWatchRef.current.remove();
      navWatchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        (pos) => {
          const steps = navStepsRef.current;
          const idx = navIndexRef.current;
          if (idx === null || !steps.length) return;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setMyPos({ latitude: lat, longitude: lng });
          noteElevation(pos.coords.altitude);
          glideBadgeTo(
            { latitude: lat, longitude: lng },
            Date.now(),
            pos.coords.speed,
          );
          // Keep the speed-limit badge current for the road we're on.
          void refreshSpeedLimit(lat, lng, Date.now());
          if (navOptionsRef.current.weather) {
            void refreshWeatherNow(lat, lng, Date.now());
          }
          prevFixRef.current = { latitude: lat, longitude: lng };
          // Drive screen: live speed + remaining miles / ETA.
          const spd = pos.coords.speed;
          // Heading for the driver's-POV camera: GPS course only
          // counts while actually rolling — under ~3 mph it jitters
          // and spins, so the last good heading holds. Shortest-arc
          // smoothing keeps turns from snapping.
          const hdg = pos.coords.heading;
          if (hdg != null && hdg >= 0 && spd != null && spd * 2.23694 > 3) {
            const prevH = navHeadingRef.current;
            if (prevH === null) {
              navHeadingRef.current = hdg;
            } else {
              const dh = ((hdg - prevH + 540) % 360) - 180;
              navHeadingRef.current = (prevH + dh * 0.4 + 360) % 360;
            }
          }
          // Mirror the smoothed course into state for the truck
          // marker's heading wedge (build #19) — only on ~2°+
          // changes so the marker doesn't re-render every fix.
          const hNowDeg = navHeadingRef.current;
          if (hNowDeg !== null) {
            setNavCourseDeg((prev) => {
              if (prev === null) return Math.round(hNowDeg);
              const dh = Math.abs(((hNowDeg - prev + 540) % 360) - 180);
              return dh >= 2 ? Math.round(hNowDeg) : prev;
            });
          }
          setSpeedMph(spd != null && spd >= 0 ? Math.round(spd * 2.23694) : 0);
          // Overspeed prompt: at 5+ mph over the posted limit, call
          // it out — at most once a minute while he stays over.
          const mphNow = spd != null && spd >= 0 ? spd * 2.23694 : null;
          const limitNow = speedLimitRef.current;
          if (
            navOptionsRef.current.speedAlert &&
            mphNow !== null &&
            limitNow !== null &&
            mphNow >= limitNow + 5
          ) {
            const nowMs = Date.now();
            if (nowMs - overspeedRef.current > 60000) {
              overspeedRef.current = nowMs;
              speak(
                `You're ${Math.round(mphNow - limitNow)} over the speed limit. Limit is ${limitNow}.`,
                { stopFirst: false },
              );
              showWeighAlert(
                `🚨 ${Math.round(mphNow)} mph in a ${limitNow} — slow down`,
              );
            }
          }
          const target = steps[Math.min(idx + 1, steps.length - 1)];
          const d = distMi(lat, lng, target.latitude, target.longitude);
          setNavDistMi(d);
          let remainMi = d;
          for (let s = idx + 1; s < steps.length; s++) remainMi += steps[s].miles;
          const avgMph = spd != null && spd * 2.23694 > 5 ? spd * 2.23694 : 45;
          const remainMin = Math.max(1, Math.round((remainMi / avgMph) * 60));
          // Build #24 (item 5): the arrival clock reads in the
          // DESTINATION's local time, not the phone's — Larry
          // crossed into Eastern and the bar showed Central's
          // 4:48 for a 5:48 delivery. The zone comes from the
          // destination's coordinates (tz-lookup, on-device); the
          // zone abbreviation rides in the label ("5:48 PM EDT")
          // so there is no doubt which clock it is. Falls back to
          // the phone zone if the lookup ever fails.
          const arriveAt = new Date(Date.now() + remainMin * 60000);
          let arriveLabel: string | null = null;
          const destForTz = routeDestRef.current;
          if (destForTz) {
            try {
              arriveLabel = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
                timeZone: tzLookup(destForTz.latitude, destForTz.longitude),
              }).format(arriveAt);
            } catch {
              arriveLabel = null;
            }
          }
          if (!arriveLabel) {
            arriveLabel = arriveAt
              .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              .replace(/\s?[AP]M/i, '');
          }
          // Build #27 (item 5): split the zone abbreviation off
          // the clock for the strip's dedicated arrival cell —
          // "5:48 PM EDT" -> clock "5:48 PM", zone "EDT". The
          // phone-zone fallback carries no abbreviation, so the
          // zone simply stays empty there.
          let arriveShort = arriveLabel;
          let arriveZone = '';
          const arriveParts = arriveLabel.split(' ');
          if (arriveParts.length >= 3) {
            arriveZone = arriveParts[arriveParts.length - 1];
            arriveShort = arriveParts.slice(0, -1).join(' ');
          }
          setNavRemain({
            miles: remainMi,
            minutes: remainMin,
            arriveLabel,
            arriveShort,
            arriveZone,
          });
          // Build #27 (item 3): repeated interstate shields along
          // the route ahead. While the current road is an
          // interstate, a shield badge rides the route line at
          // ~0.65 / 1.35 / 2.05 mi ahead of the truck — 2–3 of
          // them inside the 2-mile cruise lookahead — and each is
          // verified to still be ON that interstate: the segment
          // containing the point must carry the same I-key in its
          // street names, so shields stop at the exit where the
          // route leaves the interstate. Recomputed only once the
          // truck has rolled ~0.08 mi since the last pass.
          {
            const route = getActiveRoute();
            const shieldKey =
              interstateKeys(steps[idx]?.streetNames)[0] ?? null;
            if (route && shieldKey && route.coords.length > 1) {
              const proj = projectOntoRoute(route, lat, lng);
              const lastShield = shieldTrackRef.current;
              if (
                !lastShield ||
                lastShield.key !== shieldKey ||
                Math.abs(proj.alongMi - lastShield.alongMi) >= 0.08
              ) {
                shieldTrackRef.current = {
                  alongMi: proj.alongMi,
                  key: shieldKey,
                };
                // Segment walk: `d` is the distance to the next
                // maneuver (the end of the current segment); each
                // later segment k spans steps[k].miles.
                const segKeyAt = (aheadMi: number): string | null => {
                  let rem = aheadMi;
                  let k = idx;
                  let segRemain = d;
                  while (rem > segRemain) {
                    rem -= segRemain;
                    k += 1;
                    if (k >= steps.length) return null;
                    segRemain = steps[k].miles;
                  }
                  return interstateKeys(steps[k]?.streetNames)[0] ?? null;
                };
                const coordAt = (alongMi: number) => {
                  const cum = route.cumulativeMi;
                  let lo = 0;
                  let hi = cum.length - 1;
                  while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (cum[mid] < alongMi) lo = mid + 1;
                    else hi = mid;
                  }
                  const i = Math.max(1, lo);
                  const span = cum[i] - cum[i - 1] || 1;
                  const t = Math.min(
                    1,
                    Math.max(0, (alongMi - cum[i - 1]) / span),
                  );
                  const a = route.coords[i - 1];
                  const b = route.coords[i];
                  return {
                    latitude: a.latitude + (b.latitude - a.latitude) * t,
                    longitude: a.longitude + (b.longitude - a.longitude) * t,
                  };
                };
                const nextShields: {
                  id: string;
                  latitude: number;
                  longitude: number;
                  label: string;
                }[] = [];
                for (const ahead of [0.65, 1.35, 2.05]) {
                  if (segKeyAt(ahead) !== shieldKey) continue;
                  const c = coordAt(proj.alongMi + ahead);
                  nextShields.push({
                    id: `shield-${ahead}`,
                    latitude: c.latitude,
                    longitude: c.longitude,
                    label: shieldKey.replace(/^I(\d)/, 'I-$1'),
                  });
                }
                setRouteShields(nextShields);
              }
            } else if (shieldTrackRef.current !== null) {
              shieldTrackRef.current = null;
              setRouteShields([]);
            }
          }
          // Weigh-station approach alerts (once per station per nav
          // session): a heads-up at 5 miles, then again at 2 miles.
          for (const ws of weighStations) {
            const dWs = distMi(lat, lng, ws.latitude, ws.longitude);
            if (
              !announcedWeighRef.current.has(`${ws.id}:5`) &&
              dWs <= 5
            ) {
              announcedWeighRef.current.add(`${ws.id}:5`);
              speak('Weigh station in 5 miles.', { stopFirst: false });
              showWeighAlert(`⚖️ Weigh station in 5 miles — ${ws.name}`);
              break;
            }
            if (announcedWeighRef.current.has(ws.id)) continue;
            if (dWs <= 2) {
              announcedWeighRef.current.add(ws.id);
              speak('Weigh station in 2 miles.', { stopFirst: false });
              showWeighAlert(`⚖️ Weigh station in 2 miles — ${ws.name}`);
              break;
            }
          }
          // Odometer: every nav fix feeds the miles-driven counter.
          const odoTotal = addOdometerFix(lat, lng);
          if (odoTotal - odoShownRef.current >= 0.1) {
            odoShownRef.current = odoTotal;
            setOdoMi(odoTotal);
          }
          // Route progress: miles along the route, and the drawn
          // route line trims behind the truck — only the road ahead
          // stays on the map.
          const activeRoute = getActiveRoute();
          let truckAlongMi: number | null = null;
          if (activeRoute && activeRoute.coords.length > 1) {
            const proj = projectOntoRoute(activeRoute, lat, lng);
            if (proj.offMi <= 1.5) {
              truckAlongMi = Math.max(navAlongRef.current, proj.alongMi);
              navAlongRef.current = truckAlongMi;
              const cum = activeRoute.cumulativeMi;
              let ti = navTrimIdxRef.current;
              while (ti < cum.length - 2 && cum[ti + 1] < truckAlongMi) ti++;
              if (ti !== navTrimIdxRef.current) {
                navTrimIdxRef.current = ti;
                const rest = activeRoute.coords.slice(ti);
                if (rest.length > 1) setRemainingCoords(rest);
              }
            }
          }
          if (activeRoute && truckAlongMi !== null) {
            const along = truckAlongMi;
            const aheadDelta = (pLat: number, pLng: number): number => {
              if (distMi(lat, lng, pLat, pLng) > 6) return -1;
              const p = projectOntoRoute(activeRoute, pLat, pLng);
              const delta = p.alongMi - along;
              return p.offMi <= ALONG_ROUTE_TOLERANCE_MI &&
                delta > 0.1 &&
                delta <= 5
                ? delta
                : -1;
            };
            // 5-mile heads-up for what's coming up: truck stops
            // (bundled) plus every enabled OSM POI layer. One call
            // per fix — the nearest in the band — and every other
            // in-band item is marked so the same exit doesn't stack
            // calls on top of each other.
            const candidates: { key: string; delta: number; text: string }[] =
              [];
            for (const stop of truckStops) {
              const key = `stop:${stop.id}`;
              if (announcedPoiRef.current.has(key)) continue;
              const delta = aheadDelta(stop.latitude, stop.longitude);
              if (delta > 0)
                candidates.push({
                  key,
                  delta,
                  text: `Truck stop in 5 miles — ${stop.name}`,
                });
            }
            const layers = poiLayersRef.current;
            if (layers) {
              for (const meta of POI_CATEGORIES) {
                if (meta.source !== 'osm' || !layers[meta.key]) continue;
                // Build #24 (item 8): EVERY enabled category gets
                // the 5-mile heads-up — the old skip list
                // (milemarkers / weigh / stops) is gone. Stops and
                // weigh are bundled-source categories, so they
                // never reach this OSM loop (their own loops above
                // announce them); the one real exclusion was mile
                // markers, and Larry's rule is now "every enabled
                // category prompts" — he controls the chatter with
                // the category toggles themselves.
                for (const poi of osmPoisRef.current[meta.key] ?? []) {
                  const key = `poi:${poi.id}`;
                  if (announcedPoiRef.current.has(key)) continue;
                  const delta = aheadDelta(poi.latitude, poi.longitude);
                  if (delta > 0)
                    candidates.push({
                      key,
                      delta,
                      text: `${poiSpokenNoun(meta.key)} in 5 miles${
                        poi.name ? ` — ${poi.name}` : ''
                      }`,
                    });
                }
              }
            }
            if (candidates.length) {
              candidates.sort((a, z) => a.delta - z.delta);
              for (const c of candidates) announcedPoiRef.current.add(c.key);
              speak(`${candidates[0].text}.`, { stopFirst: false });
              showWeighAlert(`📍 ${candidates[0].text}`);
            }
            // Hazard reports ahead (police, object in the road,
            // accident…): called at 5 miles and again at 1 mile,
            // once each per report per nav session.
            if (navOptionsRef.current.hazards) {
              for (const hz of hazardsRef.current) {
                if (Date.now() - hz.at > HAZARD_TTL_MS) continue;
                if (distMi(lat, lng, hz.latitude, hz.longitude) > 6)
                  continue;
                const p = projectOntoRoute(
                  activeRoute,
                  hz.latitude,
                  hz.longitude,
                );
                if (p.offMi > ALONG_ROUTE_TOLERANCE_MI) continue;
                const delta = p.alongMi - along;
                const label = HAZARD_LABELS[hz.kind];
                if (
                  delta > 1 &&
                  delta <= 5 &&
                  !announcedHazardRef.current.has(`${hz.id}:5`)
                ) {
                  announcedHazardRef.current.add(`${hz.id}:5`);
                  speak(`${label}, in 5 miles.`, { stopFirst: false });
                  showWeighAlert(`⚠️ ${label} — 5 miles ahead`);
                } else if (
                  delta > 0.05 &&
                  delta <= 1 &&
                  !announcedHazardRef.current.has(`${hz.id}:1`)
                ) {
                  announcedHazardRef.current.add(`${hz.id}:1`);
                  speak(`${label}, in 1 mile.`, { stopFirst: false });
                  showWeighAlert(`⚠️ ${label} — 1 mile ahead`);
                }
              }
            }
          }
          // Low bridges on the active route (build #17): spoken +
          // banner at 5 miles out, urgent repeat at 1 mile — once
          // per bridge per stage per nav session. Runs on whatever
          // route is active now, so alternate picks and reroutes
          // (which refresh lowBridgesRef via the corridor check)
          // are covered by the same loop.
          if (activeRoute && truckAlongMi !== null) {
            const alongNow = truckAlongMi;
            for (const b of lowBridgesRef.current) {
              const delta = b.alongMi - alongNow;
              const key = `${b.id}@${b.alongMi.toFixed(2)}`;
              if (
                delta > 1 &&
                delta <= 5 &&
                !announcedLowBridgeRef.current.has(`${key}:5`)
              ) {
                announcedLowBridgeRef.current.add(`${key}:5`);
                speak(`Low bridge ahead. Clearance ${b.label}, in 5 miles.`, {
                  stopFirst: false,
                });
                showWeighAlert(`⚠️ Low bridge ahead — ${b.label} · 5 miles`);
              } else if (
                delta > 0.05 &&
                delta <= 1 &&
                !announcedLowBridgeRef.current.has(`${key}:1`)
              ) {
                announcedLowBridgeRef.current.add(`${key}:1`);
                speak(`Urgent: low bridge in 1 mile. Clearance ${b.label}.`, {
                  stopFirst: false,
                });
                showWeighAlert(`🚨 Low bridge — ${b.label} · 1 mile ahead`);
              }
            }
          }
          // Stop pass-through (build #18): when the truck reaches
          // the next stop on the way — within ~0.08 mi of it, or
          // past its point on the route line — announce it and drop
          // it from the list, so navigation rolls on to the next
          // leg hands-free and any later reroute only keeps the
          // stops still ahead. Once per stop per route.
          {
            const remaining = routeViasRef.current;
            if (remaining.length) {
              const next = remaining[0];
              const key = stopKey(next);
              if (!announcedStopRef.current.has(key)) {
                let passed =
                  distMi(lat, lng, next.latitude, next.longitude) < 0.08;
                if (!passed && activeRoute && truckAlongMi !== null) {
                  const p = projectOntoRoute(
                    activeRoute,
                    next.latitude,
                    next.longitude,
                  );
                  passed =
                    p.offMi <= 0.5 && p.alongMi < truckAlongMi - 0.05;
                }
                if (passed) {
                  announcedStopRef.current.add(key);
                  passedStopsRef.current += 1;
                  const n = passedStopsRef.current;
                  speak(`Stop ${n}. ${next.name}.`, { stopFirst: false });
                  showWeighAlert(`🚩 Stop ${n} — ${next.name}`);
                  syncVias(remaining.slice(1));
                }
              }
            }
          }
          // Severe weather at our position (NWS active alerts),
          // re-checked at most every 10 minutes while navigating.
          if (navOptionsRef.current.weather) {
            const nowMs = Date.now();
            if (nowMs - weatherCheckRef.current > 600000) {
              weatherCheckRef.current = nowMs;
              void checkWeatherAlerts(lat, lng);
            }
          }
          // Camera follow is owned by the build #20 motion tick
          // (driveFollowCamera): it anchors on the smoothed badge
          // position — the exact spot the truck marker is drawn —
          // so the camera and the truck move as one and the truck
          // cannot slide out of the frame. The old per-fix flyTo
          // chased the raw fix on a separate clock from the gliding
          // badge, which is part of why the truck got lost in
          // build #19. The staged turn zoom below now only names
          // the target zoom; the driver eases the camera there.
          const opts = navOptionsRef.current;
          // Announce the turn once as it approaches.
          if (idx < steps.length - 1 && d < 0.25) {
            if (announcedStepRef.current !== idx) {
              announcedStepRef.current = idx;
              const distText =
                d < 0.1
                  ? `${Math.max(10, Math.round((d * 5280) / 10) * 10)} feet`
                  : `${d.toFixed(2)} miles`;
              speak(`In ${distText}, ${steps[idx + 1].instruction}`);
            }
          }
          // Staged turn zoom: ease in as the turn gets close so the
          // driver can see exactly where the turn is — starts 0.6 mi
          // out, closer at a quarter mile, and inside ~600 ft the
          // camera sits tight. Build #20: this only names the target
          // zoom — the camera driver eases toward it while staying
          // anchored on the truck. (The old version flew the camera
          // to the TURN point; with the truck low in that framing it
          // could slide off the bottom edge — one of the ways build
          // #19 lost him.) At these zooms the turn ahead still fits
          // in the road shown above the truck.
          // Build #24 (item 7): the cruise zoom is speed-scaled.
          // At highway speed the camera sits further back so Larry
          // sees roughly 1–2 MORE miles of road ahead than build
          // #23's fixed zoom 15 (a zoom-15 viewport shows ~1.6 mi
          // of road vertically at these latitudes; 13.9 shows
          // ~3.5 mi). In town the framing stays at the old 15.
          // The staged turn push-ins keep the same offsets above
          // cruise they had above 15, so close-up turn framing is
          // unchanged relative to cruise.
          // Build #27 (items 1–2): Larry put a number on it — the
          // cruise view must show about 2 MILES of road ahead of
          // the truck (the speed-tier zooms above still read too
          // tight on his phone). The target is now the lookahead
          // itself, converted to a zoom for this phone's viewport
          // height and latitude by zoomForLookahead: 2.0 mi ahead
          // at highway speed, stepping down in town where 2 miles
          // of lookahead would erase street detail (1.6 mi at
          // 35–55, 1.2 mi below that). The staged turn push-ins
          // below keep their offsets above cruise, so as a turn
          // approaches the camera still eases IN from the 2-mile
          // cruise to the tight turn framing, and back out after.
          const lookaheadMi =
            mphNow === null
              ? 2.0
              : mphNow >= 55
                ? 2.0
                : mphNow >= 35
                  ? 1.6
                  : 1.2;
          const cruiseZ = zoomForLookahead(lookaheadMi, lat, windowHeight);
          cruiseZoomRef.current = cruiseZ;
          if (opts.zoom && idx < steps.length - 1) {
            const stage = d < 0.12 ? 3 : d < 0.25 ? 2 : d < 0.6 ? 1 : 0;
            const prevStage =
              zoomStageRef.current?.idx === idx
                ? zoomStageRef.current.stage
                : 0;
            const stageZoom =
              stage === 1
                ? cruiseZ + 0.5
                : stage === 2
                  ? cruiseZ + 1.5
                  : stage === 3
                    ? cruiseZ + 2.5
                    : cruiseZ;
            if (stage !== prevStage || stageZoom !== navZoomTargetRef.current) {
              zoomStageRef.current = { idx, stage };
              navZoomTargetRef.current = stageZoom;
            }
          } else if (navZoomTargetRef.current !== cruiseZ) {
            navZoomTargetRef.current = cruiseZ;
          }
          // Auto-advance when we reach the next turn point.
          if (idx < steps.length - 1 && d < 0.03) {
            zoomStageRef.current = null;
            announcedStepRef.current = null;
            setNavIndex(idx + 1);
            // Build #20: the camera driver eases the zoom back out
            // to cruise level — no separate flyTo to fight it.
            // Build #24 (item 7): cruise is the speed-scaled zoom.
            navZoomTargetRef.current = cruiseZoomRef.current;
            return;
          }
          // Off-route? Automatically re-plan to the same destination.
          // Distance is measured to the route LINE via
          // projectOntoRoute — never to the shape vertices (the
          // pre-#6 vertex-sampling bug must not come back), and fixes
          // with poor GPS accuracy are skipped so a lone jump can't
          // trip it. Build #20 trips SOONER (Larry confirmed #19's
          // reroute worked, just slowly): TWO straight fixes beyond
          // 0.12 mi off the line (was three beyond 0.2), OR the
          // passed-maneuver signal — the distance to the turn
          // bottomed out close (<0.15 mi) and is now rising on
          // consecutive fixes, which means he drove past it (in #19
          // that count just kept growing with no replan). Cooldown
          // between reroutes: 30 s (was 90).
          if (opts.reroute && routeDestRef.current && !reroutingRef.current) {
            const route = getActiveRoute();
            const acc = pos.coords.accuracy ?? 0;
            if (route && route.coords.length > 1 && acc <= 160) {
              const tripReroute = () => {
                lastRerouteRef.current = Date.now();
                offRouteStreakRef.current = 0;
                maneuverTrackRef.current = null;
                reroutingRef.current = true;
                speak('Rerouting');
                const dest = routeDestRef.current;
                if (!dest) {
                  reroutingRef.current = false;
                  return;
                }
                void planRoute(lat, lng, dest.latitude, dest.longitude, true).finally(
                  () => {
                    reroutingRef.current = false;
                  },
                );
              };
              let shouldTrip = false;
              const { offMi } = projectOntoRoute(route, lat, lng);
              if (offMi > 0.12) {
                offRouteStreakRef.current += 1;
                if (offRouteStreakRef.current >= 2) shouldTrip = true;
              } else {
                offRouteStreakRef.current = 0;
              }
              const mt = maneuverTrackRef.current;
              if (!mt || mt.stepIdx !== idx) {
                maneuverTrackRef.current = {
                  stepIdx: idx,
                  minD: d,
                  lastD: d,
                  rises: 0,
                };
              } else {
                if (d < mt.minD) mt.minD = d;
                if (d > mt.lastD + 0.005) mt.rises += 1;
                else if (d < mt.lastD - 0.005) mt.rises = 0;
                mt.lastD = d;
                if (mt.minD < 0.15 && mt.rises >= 2 && d > mt.minD + 0.08) {
                  shouldTrip = true;
                }
              }
              if (
                shouldTrip &&
                Date.now() - lastRerouteRef.current > 30000
              ) {
                tripReroute();
              }
            }
          }
        },
      );
    } catch {}
  }

  async function startTripWatch() {
    if (tripWatchRef.current) return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      tripWatchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        (pos) => {
          noteElevation(pos.coords.altitude);
          if (
            addFix(pos.coords.latitude, pos.coords.longitude) &&
            getTripLog().current
          ) {
            setTrip({ ...getTripLog().current! });
          }
          const odoTotal = addOdometerFix(
            pos.coords.latitude,
            pos.coords.longitude,
          );
          if (odoTotal - odoShownRef.current >= 0.1) {
            odoShownRef.current = odoTotal;
            setOdoMi(odoTotal);
          }
          if (navOptionsRef.current.weather) {
            void refreshWeatherNow(
              pos.coords.latitude,
              pos.coords.longitude,
              Date.now(),
            );
          }
        },
      );
    } catch {}
  }

  function stopTripWatch() {
    if (tripWatchRef.current) {
      tripWatchRef.current.remove();
      tripWatchRef.current = null;
    }
  }

  function toggleTrip() {
    if (trip) {
      endTripLog();
      stopTripWatch();
      setTrip(null);
    } else {
      startTripLog();
      setTrip({ ...getTripLog().current! });
      void startTripWatch();
    }
  }

  useEffect(() => {
    loadTripLog().then((log) => {
      if (log.current) {
        setTrip(log.current);
        void startTripWatch();
      }
    });
    AsyncStorage.getItem(SAVED_PLACES_KEY)
      .then((raw) => {
        if (raw) setSavedPlaces(JSON.parse(raw) as SavedPlace[]);
      })
      .catch(() => {});
    AsyncStorage.getItem(TRUCK_PROFILE_KEY)
      .then((raw) => {
        if (raw) setTruck({ ...DEFAULT_TRUCK, ...(JSON.parse(raw) as TruckProfile) });
      })
      .catch(() => {});
    loadNavOptions().then((opts) => {
      navOptionsRef.current = opts;
      setNavOptions(opts);
    });
    loadOdometer().then((total) => {
      odoShownRef.current = total;
      setOdoMi(total);
    });
    loadHazards().then((list) => {
      hazardsRef.current = list;
      setHazards(list);
    });
    loadRouteSettings().then(setRouteSettings);
    loadPoiLayers().then(setPoiLayers);
    loadCheckIns().then((map) => {
      checkInsRef.current = map;
      setCheckIns(map);
      // If a route was already planned before the store finished
      // loading (tab handoff), resolve its saved check-in now.
      const dest = destContextRef.current;
      if (dest && routeCoordsRef.current.length > 1) {
        resolveCheckInRef.current(dest);
      }
    });
  }, []);

  // Keep the ref mirror current for the debounced viewport loader.
  useEffect(() => {
    poiLayersRef.current = poiLayers;
  }, [poiLayers]);

  // Weather radar (RainViewer, free): keep the latest radar frame
  // path fresh while the radar option is on.
  useEffect(() => {
    if (!navOptions.radar) return;
    let live = true;
    const fetchRadar = async () => {
      try {
        const r = await fetch(
          'https://api.rainviewer.com/public/weather-maps.json',
        );
        if (!r.ok) return;
        const data: any = await r.json();
        const past: any[] = Array.isArray(data?.radar?.past)
          ? data.radar.past
          : [];
        const last = past.length ? past[past.length - 1] : null;
        if (live && last && typeof last.path === 'string') {
          setRadarPath(last.path);
        }
      } catch {}
    };
    void fetchRadar();
    const t = setInterval(fetchRadar, 600000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [navOptions.radar]);

  // Build #23 (item 3): the Report button used to live in the tab
  // header (headerRight) — but build #22 hides that header for the
  // whole of navigation, so the button vanished with it (Larry:
  // "the report button has been hidden"). It now renders ON THE MAP
  // under the elevation readout at bottom left (see the JSX below);
  // the header copy is gone so there is exactly one Report button.

  // The live map style: base tiles plus the radar overlay layer
  // when the option is on and a radar frame is loaded.
  const activeMapStyle = useMemo(() => {
    const base = mapType === 'standard' ? OSM_STYLE : SAT_STYLE;
    if (!navOptions.radar || !radarPath) return base;
    return {
      ...base,
      sources: {
        ...base.sources,
        radar: {
          type: 'raster' as const,
          tiles: [
            `https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/2/1_1.png`,
          ],
          tileSize: 256,
          attribution: 'Radar © RainViewer',
        },
      },
      layers: [
        ...base.layers,
        {
          id: 'radar',
          type: 'raster' as const,
          source: 'radar',
          paint: { 'raster-opacity': 0.55 },
        },
      ],
    };
  }, [mapType, navOptions.radar, radarPath]);


  function persistTruck(profile: TruckProfile) {
    setTruck(profile);
    AsyncStorage.setItem(TRUCK_PROFILE_KEY, JSON.stringify(profile)).catch(() => {});
  }

  function persistRouteSettings(next: RouteSettings) {
    setRouteSettings(next);
    void saveRouteSettings(next);
  }

  // POI layers are centered on the driver's GPS position when we have it,
  // else the last searched place, else the middle of the country.
  function poiFocus(): Coord {
    if (myPos) return myPos;
    if (searchResult) {
      return { latitude: searchResult.latitude, longitude: searchResult.longitude };
    }
    return INITIAL_CENTER;
  }

  // Resolve a REAL focus point for POI lookups. myPos is only populated
  // while live navigation is running, so a driver who just opens the map
  // and taps POI used to get queries centered on the middle of Kansas
  // (INITIAL_CENTER) — hundreds of miles from where he actually was.
  // Grab a fix the same way routing does (last-known first, then a live
  // fix raced against a timeout) and keep it in myPos so the marker
  // math, distances, and bundled datasets all center on him too.
  async function resolvePoiFocus(): Promise<Coord> {
    if (myPos) return myPos;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let position: any = await Location.getLastKnownPositionAsync({});
        if (!position) {
          try {
            position = await Promise.race([
              Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('gps timeout')), 10000),
              ),
            ]);
          } catch {}
        }
        if (position) {
          const coord: Coord = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setMyPos(coord);
          return coord;
        }
      }
    } catch {}
    return poiFocus();
  }

  // ---- OSM POI loading: GPS radius, viewport, route corridor --------
  // Three paths, one per-category cache. GPS-radius is the first-open
  // fallback; viewport loading covers wherever the driver pans, anywhere
  // in the country; corridor loading covers the planned route end to
  // end. Every load takes a request token — if a newer load for the
  // category starts while this one is in flight, the older fetch is
  // aborted and its results dropped, so stale data never overwrites
  // fresher data.

  function nextOsmRequest(category: PoiCategory): {
    token: number;
    signal: AbortSignal;
  } {
    const token = (osmRequestRef.current[category] ?? 0) + 1;
    osmRequestRef.current[category] = token;
    osmAbortRef.current[category]?.abort();
    const controller = new AbortController();
    osmAbortRef.current[category] = controller;
    return { token, signal: controller.signal };
  }

  function osmRequestCurrent(category: PoiCategory, token: number): boolean {
    return osmRequestRef.current[category] === token;
  }

  // Merge fresh results into the category cache, de-duplicated by id
  // (viewport, GPS, and corridor loads overlap near the driver). The
  // cache is capped so a coast-to-coast session can't grow it without
  // bound — on overflow, pins farthest from the newest load go first.
  function mergeOsmPois(category: PoiCategory, incoming: Poi[], center: Coord) {
    const byId = new Map<string, Poi>();
    for (const p of osmPoisRef.current[category] ?? []) byId.set(p.id, p);
    for (const p of incoming) byId.set(p.id, p);
    let merged = [...byId.values()];
    if (merged.length > 1500) {
      merged = merged
        .map((p) => ({
          p,
          d: distMi(center.latitude, center.longitude, p.latitude, p.longitude),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 1500)
        .map((x) => x.p);
    }
    osmPoisRef.current = { ...osmPoisRef.current, [category]: merged };
    setOsmPois(osmPoisRef.current);
  }

  function noteLoadedArea(category: PoiCategory, area: PoiBbox) {
    const list = [...(osmLoadedAreasRef.current[category] ?? []), area];
    if (list.length > 24) list.splice(0, list.length - 24);
    osmLoadedAreasRef.current[category] = list;
  }

  function areaCovered(category: PoiCategory, bounds: PoiBbox): boolean {
    return (osmLoadedAreasRef.current[category] ?? []).some(
      (a) =>
        a.west <= bounds.west &&
        a.east >= bounds.east &&
        a.south <= bounds.south &&
        a.north >= bounds.north,
    );
  }

  // A region this wide spans several states — one Overpass bbox query
  // over it would be slow and capped long before it covered the ground.
  // At that zoom the chip asks for a zoom-in instead; city/region zooms
  // load live.
  function boundsTooWide(b: PoiBbox): boolean {
    const latSpan = b.north - b.south;
    let lngSpan = b.east - b.west;
    if (lngSpan < 0) lngSpan += 360;
    return latSpan > 3.2 || lngSpan > 3.2;
  }

  // Shared tail of every load path: freshness check, honest errors,
  // merge. A failure only surfaces as "couldn't load" when the category
  // has nothing cached — if pins from an earlier load are on the map, a
  // failed refresh keeps them quietly instead of crying wolf.
  function applyOsmResult(
    category: PoiCategory,
    token: number,
    result: { pois: Poi[]; error: string | null; aborted?: boolean },
    center: Coord,
    area?: PoiBbox,
  ): boolean {
    if (result.aborted || !osmRequestCurrent(category, token)) return false;
    if (result.error) {
      if ((osmPoisRef.current[category]?.length ?? 0) === 0) {
        setPoiError((prev) => ({ ...prev, [category]: result.error! }));
      }
      return false;
    }
    if (area) noteLoadedArea(category, area);
    mergeOsmPois(category, result.pois, center);
    setPoiError((prev) => {
      if (!prev[category]) return prev;
      const next = { ...prev };
      delete next[category];
      return next;
    });
    return true;
  }

  // Cached OSM results only count if the driver's area is covered and
  // the last load didn't fail — otherwise a pick must (re)fetch.
  function osmNeedsLoad(category: PoiCategory, focus: Coord): boolean {
    if (poiError[category]) return true;
    if (!osmPois[category]) return true;
    return !areaCovered(
      category,
      bboxAround(focus.latitude, focus.longitude, 40000),
    );
  }

  // GPS-radius load — the original path, kept as the fallback when the
  // map hasn't been moved and for explicit refreshes.
  async function loadOsmCategory(
    category: PoiCategory,
    opts?: { focus?: Coord; fly?: boolean },
  ) {
    const { token, signal } = nextOsmRequest(category);
    setPoiLoading(category);
    try {
      const focus = opts?.focus ?? (await resolvePoiFocus());
      const result = await fetchOsmPois(
        category,
        focus.latitude,
        focus.longitude,
        40000,
        signal,
      );
      const ok = applyOsmResult(
        category,
        token,
        result,
        focus,
        bboxAround(focus.latitude, focus.longitude, 40000),
      );
      if (ok) {
        osmCenterRef.current[category] = focus;
        // A fresh pick that found places: if the driver is staring at a
        // zoomed-out map (and not planning a route), bring him to where
        // the pins actually are.
        if (
          opts?.fly &&
          result.pois.length > 0 &&
          navIndexRef.current === null &&
          routeCoordsRef.current.length < 2
        ) {
          flyTo(focus.latitude, focus.longitude, 0.6);
        }
      }
    } finally {
      if (osmRequestCurrent(category, token)) setPoiLoading(null);
    }
  }

  // Viewport load — everything in the category inside the region the
  // map is showing right now.
  async function loadOsmForViewport(category: PoiCategory, bounds: PoiBbox) {
    const { token, signal } = nextOsmRequest(category);
    setPoiLoading(category);
    try {
      const result = await fetchOsmPoisBbox(category, bounds, signal);
      applyOsmResult(
        category,
        token,
        result,
        {
          latitude: (bounds.south + bounds.north) / 2,
          longitude: (bounds.west + bounds.east) / 2,
        },
        bounds,
      );
    } finally {
      if (osmRequestCurrent(category, token)) setPoiLoading(null);
    }
  }

  // Debounced viewport refresh: once the map settles somewhere new,
  // load every switched-on OSM category for the visible region — unless
  // that ground is already covered or the view is too wide to query.
  function scheduleViewportPoiLoad(bounds: PoiBbox) {
    if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    regionTimerRef.current = setTimeout(() => {
      regionTimerRef.current = null;
      const layers = poiLayersRef.current;
      if (!layers || boundsTooWide(bounds)) return;
      for (const meta of POI_CATEGORIES) {
        if (meta.source !== 'osm' || !layers[meta.key]) continue;
        if (!areaCovered(meta.key, bounds)) {
          void loadOsmForViewport(meta.key, bounds);
        }
      }
    }, 800);
  }

  // Build #19: continuous region changes flagged as user
  // interaction (pans, pinches, two-finger rotations) count as
  // grabbing the map during navigation — they pause follow and
  // (re)start the ~5 s auto re-center clock. Programmatic camera
  // moves (the follow cam's own flyTos) are not user interactions
  // and never trip this.
  function handleRegionIsChanging(event: any) {
    const ne = event?.nativeEvent ?? event;
    // Build #26: track the bearing CONTINUOUSLY from this event
    // too (same view-state payload as did-change), so the truck
    // marker's counter-rotation and the compass stay glued to the
    // map while it turns — including the follow camera's own
    // course-up jumpTos — instead of only updating when a gesture
    // ends. See regionBearing for the build #19–#25 wrong-key bug
    // this fixes.
    const h = regionBearing(ne);
    if (h !== null) {
      mapHeadingRef.current = h;
      setMapHeading((prev) => (Math.abs(prev - h) >= 1 ? Math.round(h) : prev));
    }
    const ui = ne?.userInteraction ?? ne?.properties?.userInteraction;
    if (ui) noteNavMapGrabbed();
  }

  function handleRegionDidChange(event: any) {
    const ne = event?.nativeEvent ?? event;
    const b = ne?.bounds;
    if (!Array.isArray(b) || b.length !== 4) return;
    const bounds: PoiBbox = { west: b[0], south: b[1], east: b[2], north: b[3] };
    viewBoundsRef.current = bounds;
    setViewBounds(bounds);
    scheduleViewportPoiLoad(bounds);
    // Keep the compass needle honest while the map is rotated.
    // Build #26: read the payload's `bearing` key (regionBearing)
    // — this line read a nonexistent `heading` key through build
    // #25, which froze the map bearing at 0 and broke the truck
    // marker's heading lock (see the build #26 note at
    // truckScreenDeg).
    const h = regionBearing(ne);
    if (h !== null) {
      mapHeadingRef.current = h;
      setMapHeading((prev) => (Math.abs(prev - h) >= 1 ? Math.round(h) : prev));
    }
  }

  function routeSignature(route: {
    miles: number;
    coords: { latitude: number; longitude: number }[];
  }): string {
    const first = route.coords[0];
    const last = route.coords[route.coords.length - 1];
    return `${route.miles.toFixed(1)}|${first.latitude.toFixed(3)},${first.longitude.toFixed(3)}|${last.latitude.toFixed(3)},${last.longitude.toFixed(3)}`;
  }

  // Route-corridor load — sampled every ~25 miles down the planned
  // route, so the far end of a 500+ mile run is covered too. Runs once
  // per route per category; a new route re-runs it.
  async function loadOsmCorridor(category: PoiCategory) {
    const route = getActiveRoute();
    if (!route || route.coords.length < 2) return;
    const key = routeSignature(route);
    if (corridorKeyRef.current[category] === key) return;
    const { token, signal } = nextOsmRequest(category);
    setPoiLoading(category);
    try {
      const samples = sampleAlongRoute(route, 25, 40);
      const result = await fetchOsmPoisAlongRoute(category, samples, 25000, signal);
      const mid = samples[Math.floor(samples.length / 2)] ?? samples[0];
      const ok = applyOsmResult(category, token, result, {
        latitude: mid.latitude,
        longitude: mid.longitude,
      });
      if (ok) corridorKeyRef.current[category] = key;
    } finally {
      if (osmRequestCurrent(category, token)) setPoiLoading(null);
    }
  }

  // Chip retry: reload the category for the region on screen first
  // (that's where he's looking), else around him — plus the corridor
  // when a route is up.
  function retryPoiLoad(category: PoiCategory) {
    void (async () => {
      const bounds = viewBoundsRef.current;
      if (bounds && !boundsTooWide(bounds)) {
        await loadOsmForViewport(category, bounds);
      } else {
        await loadOsmCategory(category, { fly: true });
      }
      if (routeCoordsRef.current.length >= 2) {
        await loadOsmCorridor(category);
      }
    })();
  }

  function togglePoiCategory(category: PoiCategory) {
    if (!poiLayers) return;
    const next = { ...poiLayers, [category]: !poiLayers[category] };
    setPoiLayers(next);
    void savePoiLayers(next);
    const meta = POI_CATEGORIES.find((c) => c.key === category);
    if (next[category] && meta?.source === 'osm') {
      void (async () => {
        const focus = await resolvePoiFocus();
        if (osmNeedsLoad(category, focus)) {
          await loadOsmCategory(category, { focus });
        }
        const bounds = viewBoundsRef.current;
        if (bounds && !boundsTooWide(bounds) && !areaCovered(category, bounds)) {
          await loadOsmForViewport(category, bounds);
        }
        if (routeCoordsRef.current.length >= 2) {
          await loadOsmCorridor(category);
        }
      })();
    }
  }

  // POI picker (build #24, item 8): MULTI-select. Tapping a tile
  // flips ONLY that category in the shared layer prefs — every
  // other category stays exactly as it was, so Larry can stack
  // Rest Areas + Gas Stations + Truck Stops (or all nine) and
  // every enabled set renders on the map together. The picker
  // stays open so he can tap several in a row; the X in its
  // header closes it. Turning a category ON runs the same load
  // paths the old single-pick used (GPS radius, viewport,
  // corridor); turning one OFF just removes its pins.
  function pickPoiCategory(category: PoiCategory) {
    if (!poiLayers) return;
    const turningOn = !poiLayers[category];
    const next = { ...poiLayers, [category]: turningOn };
    setPoiLayers(next);
    void savePoiLayers(next);
    if (!turningOn) return;
    setSelectedPoi(null);
    const meta = poiCategoryMeta(category);
    void (async () => {
      const focus = await resolvePoiFocus();
      if (meta.source === 'osm') {
        if (osmNeedsLoad(category, focus)) {
          await loadOsmCategory(category, { focus, fly: true });
        } else if (
          navIndexRef.current === null &&
          routeCoordsRef.current.length < 2 &&
          (osmPois[category]?.length ?? 0) > 0
        ) {
          // Already loaded around here — just show him where they are.
          flyTo(focus.latitude, focus.longitude, 0.6);
        }
        // Whatever region is on screen and whatever route is planned
        // get their coverage too — the pick works across the USA.
        const bounds = viewBoundsRef.current;
        if (bounds && !boundsTooWide(bounds) && !areaCovered(category, bounds)) {
          await loadOsmForViewport(category, bounds);
        }
        if (routeCoordsRef.current.length >= 2) {
          await loadOsmCorridor(category);
        }
      } else if (navIndexRef.current === null) {
        // Bundled pick: center on the driver so the nearest pins show.
        flyTo(focus.latitude, focus.longitude, 0.6);
      }
    })();
  }

  // Picker footer action (build #24): every category off at once.
  function clearAllPoiCategories() {
    if (poiLayers) {
      const next = { ...poiLayers };
      for (const meta of POI_CATEGORIES) next[meta.key] = false;
      setPoiLayers(next);
      void savePoiLayers(next);
    }
    setSelectedPoi(null);
  }

  function refreshOsmLayers() {
    if (!poiLayers) return;
    for (const meta of POI_CATEGORIES) {
      if (meta.source === 'osm' && poiLayers[meta.key]) {
        // Refresh every coverage path: around him, the region on
        // screen, and the route corridor.
        void (async () => {
          await loadOsmCategory(meta.key);
          const bounds = viewBoundsRef.current;
          if (bounds && !boundsTooWide(bounds)) {
            await loadOsmForViewport(meta.key, bounds);
          }
          if (routeCoordsRef.current.length >= 2) {
            corridorKeyRef.current[meta.key] = undefined;
            await loadOsmCorridor(meta.key);
          }
        })();
      }
    }
  }

  // Distance from a point to the planned route, sampled every few shape
  // points — close enough to decide "along my route" (within ~3 miles).
  // Uses the routeCoords state (not the ref) so it is safe during render.
  function poiVisible(lat: number, lng: number): boolean {
    if (!poiAlongRoute || routeCoords.length < 2) return true;
    let best = Infinity;
    for (let i = 0; i < routeCoords.length; i += 4) {
      const d = distMi(lat, lng, routeCoords[i].latitude, routeCoords[i].longitude);
      if (d < best) best = d;
    }
    return best <= 3;
  }

  // ---- Multiple stops (build #18) --------------------------------
  // One writer for the stops list: state (panel + markers) and the
  // ref planRoute reads always move together.
  function syncVias(list: ViaPoint[]) {
    routeViasRef.current = list;
    setVias(list);
  }

  // Replan the on-screen route after a stop edit, keeping the same
  // destination. While navigating, the replan starts from the last
  // GPS fix like an ordinary reroute; while planning, it reuses the
  // last plan's origin. With no route on screen there's nothing to
  // replan — the stops ride along on the next plan instead.
  function replanForStops() {
    const last = lastPlanRef.current;
    if (!last || routeCoordsRef.current.length < 2) return;
    const navigating = navIndexRef.current !== null;
    const fix = prevFixRef.current ?? myPos;
    const fromLat = navigating && fix ? fix.latitude : last.fromLat;
    const fromLng = navigating && fix ? fix.longitude : last.fromLng;
    void planRoute(fromLat, fromLng, last.destLat, last.destLng, navigating);
  }

  // Add a stop at the end of the list. Returns false (with the cap
  // message up) when the list already holds MAX_STOPS.
  function addStop(v: ViaPoint): boolean {
    const current = routeViasRef.current;
    if (current.length >= MAX_STOPS) {
      setStopsMsg(
        `That's the ${MAX_STOPS}-stop max — remove one to add another.`,
      );
      return false;
    }
    setStopsMsg(null);
    syncVias([...current, v]);
    replanForStops();
    return true;
  }

  function removeStop(i: number) {
    const current = routeViasRef.current;
    if (i < 0 || i >= current.length) return;
    setStopsMsg(null);
    syncVias(current.filter((_, j) => j !== i));
    replanForStops();
  }

  function moveStop(i: number, dir: -1 | 1) {
    const current = routeViasRef.current;
    const j = i + dir;
    if (i < 0 || i >= current.length || j < 0 || j >= current.length) return;
    const next = [...current];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    syncVias(next);
    replanForStops();
  }

  function clearRoute() {
    stopNav();
    // Drop any in-flight low-bridge check and its results with the
    // route — a stale check must never act on the next route.
    lowBridgeCheckRef.current++;
    lowBridgeAbortRef.current?.abort();
    setLowBridgesBoth([]);
    setLowBridgeNote(null);
    lowBridgeCandidatesRef.current = [];
    routeSigRef.current = null;
    setRouteCoords([]);
    routeCoordsRef.current = [];
    routeDestRef.current = null;
    setRouteInfo(null);
    setNavSteps([]);
    navStepsRef.current = [];
    setRouteOptions([]);
    setSelectedRouteIdx(0);
    // Clearing the route clears all stops with it (build #18).
    syncVias([]);
    setViaDest(null);
    setViaQuery('');
    setRouteLegs([]);
    setStopsMsg(null);
    setChipHidden(false);
    announcedStopRef.current = new Set();
    passedStopsRef.current = 0;
    lastPlanRef.current = null;
  }

  async function truckRouteTo(
    destLat: number,
    destLng: number,
    destName?: string,
    startImmediately = false,
  ) {
    routeDestNameRef.current = destName ?? null;
    if (routing) return;
    setRouting(true);
    setLocationError(null);
    Keyboard.dismiss();
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Truck routing needs your location for the start point.');
        return;
      }
      // Android GPS fixes can hang indefinitely — race a 12s timeout, then
      // fall back to the last known position instead of spinning forever.
      let position: any = null;
      try {
        position = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('gps timeout')), 12000),
          ),
        ]);
      } catch {}
      if (!position) {
        position = await Location.getLastKnownPositionAsync({});
      }
      if (!position) {
        setLocationError(
          'Could not get your location. Make sure Location is ON, then try again.',
        );
        return;
      }
      const pos = position;
      const ok = await planRoute(
        pos.coords.latitude,
        pos.coords.longitude,
        destLat,
        destLng,
        false,
      );
      if (!ok) {
        setLocationError(
          'No truck route found, or the routing server is busy. Try again in a moment.',
        );
      } else if (startImmediately) {
        // "Start route" on the address card: the best route is already
        // applied by planRoute — skip the summary chip and go straight
        // into live map navigation.
        void startNav();
      }
    } catch {
      setLocationError(
        'No truck route found, or the routing server is busy. Try again in a moment.',
      );
    } finally {
      setRouting(false);
    }
  }

  // Low-bridge corridor check for a freshly applied route (build
  // #17). Runs asynchronously — planning never waits on Overpass.
  // When it lands, if this route is still the applied one:
  //  - no low bridges: clear any stale points/note;
  //  - low bridges + avoidance allowed + attempts left: replan via
  //    planRoute with the bridge points as Valhalla avoid locations
  //    (cumulative per destination, max 2 avoid-replans per route
  //    request) and announce the detour;
  //  - otherwise (avoidance off, attempts exhausted, or the replan
  //    failed): keep the route, arm the 5 mi / 1 mi warnings, and
  //    show the persistent note once.
  // A failed lookup (error) leaves the route simply unchecked —
  // never a fake all-clear, never a spurious replan.
  function scheduleLowBridgeCheck(
    opt: RouteOption,
    cfg: {
      allowAvoid: boolean;
      attempt: number;
      from?: Coord;
      dest?: Coord;
    },
  ) {
    const route = buildActiveRoute(opt.coords, {
      miles: opt.miles,
      minutes: opt.minutes,
    });
    if (!route) return;
    const seq = ++lowBridgeCheckRef.current;
    lowBridgeAbortRef.current?.abort();
    const controller = new AbortController();
    lowBridgeAbortRef.current = controller;
    const heightM = truckHeightM(truck.heightFt, truck.heightIn);
    const sig = routeSignature({ miles: opt.miles, coords: opt.coords });
    void (async () => {
      const res = await checkRouteLowBridges(route, heightM, controller.signal);
      if (res.aborted || seq !== lowBridgeCheckRef.current) return;
      if (routeSigRef.current !== sig) return;
      if (res.error) return;
      lowBridgeCandidatesRef.current = res.candidates;
      if (res.bridges.length === 0) {
        setLowBridgesBoth([]);
        setLowBridgeNote(null);
        return;
      }
      if (cfg.allowAvoid && cfg.attempt < 2 && cfg.from && cfg.dest) {
        const destKey = `${cfg.dest.latitude.toFixed(4)},${cfg.dest.longitude.toFixed(4)}`;
        const prev =
          lowBridgeAvoidsRef.current.destKey === destKey
            ? lowBridgeAvoidsRef.current.points
            : [];
        const merged = [...prev];
        for (const b of res.bridges) {
          if (
            !merged.some(
              (p) => distMi(p.latitude, p.longitude, b.latitude, b.longitude) < 0.05,
            )
          ) {
            merged.push({ latitude: b.latitude, longitude: b.longitude });
          }
        }
        lowBridgeAvoidsRef.current = { destKey, points: merged };
        const ok = await planRoute(
          cfg.from.latitude,
          cfg.from.longitude,
          cfg.dest.latitude,
          cfg.dest.longitude,
          navIndexRef.current !== null,
          { avoidLocations: merged, lowBridgeAttempt: cfg.attempt + 1 },
        );
        if (ok) {
          speak('Rerouted around a low bridge.', { stopFirst: false });
          showWeighAlert('↩️ Rerouted around a low bridge');
          return;
        }
        // Replan failed — fall through and warn on the checked
        // route, if it is still the applied one.
        if (seq !== lowBridgeCheckRef.current || routeSigRef.current !== sig) {
          return;
        }
      }
      setLowBridgesBoth(res.bridges);
      setLowBridgeNote(lowBridgeNoteText(res.bridges));
    })();
  }

  async function planRoute(
    fromLat: number,
    fromLng: number,
    destLat: number,
    destLng: number,
    isReroute: boolean,
    opts?: { avoidLocations?: Coord[]; lowBridgeAttempt?: number },
  ): Promise<boolean> {
    try {
      // AUDIT (build #17): this request already used Valhalla truck
      // costing with the truck profile's height before this build —
      // costing 'truck' plus height/width/length/weight below. The
      // height now comes from the shared truckHeightM helper (same
      // math, same 13'6" default) so the corridor check and the
      // costing can never disagree about the truck's height.
      const heightM = truckHeightM(truck.heightFt, truck.heightIn);
      const lengthM =
        ((parseInt(truck.lengthFt || '72', 10) || 72) * 12 +
          (parseInt(truck.lengthIn || '0', 10) || 0)) *
        0.0254;
      const widthM =
        ((parseInt(truck.widthFt || '8', 10) || 8) * 12 +
          (parseInt(truck.widthIn || '6', 10) || 0)) *
        0.0254;
      const weightTons = (parseInt(truck.weightLbs || '80000', 10) || 80000) * 0.000453592;
      // Stops ride as Valhalla 'break' locations (build #18): a
      // break splits the trip into one leg per segment, which is
      // what gives each stop its own leg summary (per-stop ETAs)
      // and an arrival maneuver in the steps. ('via' pass-through
      // points return a single merged leg — verified against the
      // live server 2026-11-08; the break route was identical in
      // miles/minutes on the test corridor.)
      const locations: { lat: number; lon: number; type?: string }[] = [
        { lat: fromLat, lon: fromLng },
        ...routeViasRef.current.map((v) => ({
          lat: v.latitude,
          lon: v.longitude,
          type: 'break' as const,
        })),
        { lat: destLat, lon: destLng },
      ];
      const body: Record<string, unknown> = {
        locations,
        costing: 'truck',
        costing_options: {
          truck: {
            height: Math.round(heightM * 100) / 100,
            width: Math.round(widthM * 100) / 100,
            length: Math.round(lengthM * 100) / 100,
            weight: Math.round(weightTons * 100) / 100,
            hazmat: truck.hazmat,
            // Route preferences (Route panel). Valhalla scales these
            // 0..1: 0 = avoid as much as the router can.
            use_tolls: routeSettings?.avoidTolls ? 0 : 1,
            // Build #24 (item 6, layer 1): do NOT force
            // use_highways: 1. Live-verified on the I-70 IL ->
            // Lebanon IN corridor, that single forced flag DOUBLED
            // the interstate off-and-back-on hops (8 -> 14) — the
            // router's own default balances highways correctly, so
            // the key is only sent when Larry picks avoid-highways.
            ...(routeSettings?.avoidHighways ? { use_highways: 0 } : {}),
            use_ferry: routeSettings?.avoidFerries ? 0 : 1,
            // Build #24 (item 6, layer 2): every maneuver has to
            // EARN its place — an exit/re-entry must save real time
            // to survive a 300 s penalty. Live-verified: penalty
            // 300 takes the test corridor from 14 exit maneuvers
            // (5 real off-and-back-on dips) to ZERO dips at
            // 225.8 mi / 235 min, and leaves the Columbia ->
            // Hughesville corridor unchanged (51.2 mi / 57 min,
            // dips 2 -> 0). 120 still dipped once; 600 regressed
            // Hughesville, so 300 is the value.
            maneuver_penalty: 300,
            shortest: routeSettings?.routeType === 'shortest',
          },
        },
        units: 'miles',
        directions_options: { units: 'miles' },
        // Build #24 (item 1): lane guidance — maneuvers carry a
        // per-lane directions/valid/active bitmask array where
        // OpenStreetMap has turn:lanes mapped.
        turn_lanes: true,
      };
      // Low-bridge auto-avoid (build #17): when the corridor check
      // found a sub-height bridge on the previous route, its points
      // ride along as Valhalla avoid locations so the new route
      // steers around them.
      if (opts?.avoidLocations?.length) {
        body.avoid_locations = opts.avoidLocations.map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
        }));
      }
      // Alternate routes (Larry, build #16 — Google-style options)
      // only make sense for a simple A->B plan with no via points.
      // Fresh plans and reroutes both ask: a reroute that returns
      // alternates just refreshes the options list, and one that
      // returns none leaves the single route, exactly as before.
      // Verified 2026-11-08: this Valhalla instance answers with
      // up to 2 alternates on the Columbia -> Hughesville corridor.
      if (locations.length === 2) {
        body.alternates = 2;
      }
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), 25000);
      let resp: Response;
      try {
        resp = await fetch(VALHALLA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimer);
      }
      if (!resp.ok) throw new Error(`routing ${resp.status}`);
      const data = await resp.json();
      const parseTrip = (t: any): RouteOption | null => {
        if (!t?.legs?.length) return null;
        let coords: Coord[] = [];
        const steps: NavStep[] = [];
        const legs: { miles: number; minutes: number }[] = [];
        for (const leg of t.legs) {
          legs.push({
            miles: (leg.summary?.length as number) ?? 0,
            minutes: Math.round(((leg.summary?.time as number) ?? 0) / 60),
          });
          const legCoords = decodePolyline6(leg.shape as string);
          for (const m of (leg.maneuvers as any[]) ?? []) {
            const idx = Math.min(
              (m.begin_shape_index as number) ?? 0,
              legCoords.length - 1,
            );
            const c = legCoords[idx] ?? legCoords[0];
            if (c && m.instruction) {
              steps.push({
                instruction: m.instruction as string,
                miles: (m.length as number) ?? 0,
                latitude: c.latitude,
                longitude: c.longitude,
                type: typeof m.type === 'number' ? m.type : undefined,
                streetNames: (m.street_names ?? m.begin_street_names) as
                  | string[]
                  | undefined,
                lanes: Array.isArray(m.lanes)
                  ? (m.lanes as NavLane[])
                  : undefined,
              });
            }
          }
          coords = coords.concat(coords.length ? legCoords.slice(1) : legCoords);
        }
        if (!coords.length || !steps.length) return null;
        return {
          coords,
          steps,
          miles: t.summary.length as number,
          minutes: Math.round((t.summary.time as number) / 60),
          legs,
          hasToll: Boolean(t.summary?.has_toll),
        };
      };
      const options: RouteOption[] = [];
      const primary = parseTrip(data?.trip);
      if (!primary) throw new Error('no route');
      options.push(primary);
      const alternates: any[] = Array.isArray(data?.alternates)
        ? data.alternates
        : [];
      for (const alt of alternates) {
        const parsed = parseTrip(alt?.trip);
        if (parsed) options.push(parsed);
      }
      // Build #24 (item 6, layer 3): the dip guard. If the router's
      // primary still hops off an interstate and back on while one
      // of the alternates runs clean, the clean route becomes the
      // primary — even if the router scored it a couple of minutes
      // slower. Only a zero-dip alternate can displace the primary,
      // and the driver's own later tap on an alternate
      // (selectRouteOption) is never overridden.
      if (options.length > 1 && countRouteDips(options[0].steps) > 0) {
        let bestIdx = -1;
        for (let i = 1; i < options.length; i++) {
          if (countRouteDips(options[i].steps) === 0) {
            if (
              bestIdx === -1 ||
              options[i].minutes < options[bestIdx].minutes
            ) {
              bestIdx = i;
            }
          }
        }
        if (bestIdx > 0) {
          const [clean] = options.splice(bestIdx, 1);
          options.unshift(clean);
        }
      }
      setRouteOptions(options);
      setSelectedRouteIdx(0);
      applyRouteOption(options[0]);
      routeDestRef.current = { latitude: destLat, longitude: destLng };
      // Remember the plan's endpoints so a stop edit can replan to
      // the same destination without a fresh GPS fix (build #18).
      lastPlanRef.current = { fromLat, fromLng, destLat, destLng };
      // The check-in flag's working destination (see destContext):
      // every successful plan — fresh route, alternate pick, or
      // reroute — refreshes it.
      const plannedDest = {
        latitude: destLat,
        longitude: destLng,
        name: routeDestNameRef.current,
      };
      destContextRef.current = plannedDest;
      setDestContext(plannedDest);
      // Low-bridge check on the produced route (build #17): fresh
      // plans, reroutes, and avoid-replans all run it against the
      // route just applied; it may itself trigger an avoid-replan
      // (bounded by lowBridgeAttempt, max 2 per route request).
      scheduleLowBridgeCheck(options[0], {
        allowAvoid: true,
        attempt: opts?.lowBridgeAttempt ?? 0,
        from: { latitude: fromLat, longitude: fromLng },
        dest: { latitude: destLat, longitude: destLng },
      });
      if (isReroute) {
        announcedStepRef.current = null;
        zoomStageRef.current = null;
        setNavIndex(0);
      } else {
        // A fresh plan starts the stop pass-through count over —
        // reroutes keep it, since passed stops are already gone
        // from the list by then (build #18).
        announcedStopRef.current = new Set();
        passedStopsRef.current = 0;
        setSelected(null);
        setSearchResult(null);
        setSavedOpen(false);
        // Frame every route option, not just the primary — an
        // alternate the driver can't see is one he can't tap.
        const coords = options.flatMap((o) => o.coords);
        if (coords.length > 1) {
          const lngs = coords.map((c) => c.longitude);
          const lats = coords.map((c) => c.latitude);
          cameraRef.current?.fitBounds(
            [
              Math.min(...lngs),
              Math.min(...lats),
              Math.max(...lngs),
              Math.max(...lats),
            ],
            { padding: { top: 140, right: 60, bottom: 180, left: 60 }, duration: 800 },
          );
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function applyRouteOption(opt: RouteOption) {
    setNavSteps(opt.steps);
    navStepsRef.current = opt.steps;
    setRouteLegs(opt.legs);
    setRouteCoords(opt.coords);
    routeCoordsRef.current = opt.coords;
    routeSigRef.current = routeSignature({
      miles: opt.miles,
      coords: opt.coords,
    });
    navAlongRef.current = 0;
    navTrimIdxRef.current = 0;
    setRemainingCoords(null);
    announcedPoiRef.current = new Set();
    announcedHazardRef.current = new Set();
    // A newly applied route starts with no low-bridge points; the
    // corridor check for it (scheduled by the caller) fills them in.
    announcedLowBridgeRef.current = new Set();
    setLowBridgesBoth([]);
    setLowBridgeNote(null);
    setRouteInfo({ miles: opt.miles, minutes: opt.minutes });
    // Build #22 (item 2): a fresh route always shows its card.
    setChipHidden(false);
  }

  function selectRouteOption(i: number) {
    const opt = routeOptions[i];
    if (!opt || i === selectedRouteIdx) return;
    setSelectedRouteIdx(i);
    stopNav();
    applyRouteOption(opt);
    // Low bridges on the picked alternate (build #17): an instant
    // pass from the primary plan's corridor candidates — cheap,
    // same fetch — then a fresh warnings-only corridor check for
    // full coverage of this line. The driver's explicit pick is
    // never auto-replanned away from.
    const cand = lowBridgeCandidatesRef.current;
    if (cand.length) {
      const list = lowBridgesForCoords(
        opt.coords,
        { miles: opt.miles, minutes: opt.minutes },
        cand,
        truckHeightM(truck.heightFt, truck.heightIn),
      );
      if (list.length) {
        setLowBridgesBoth(list);
        setLowBridgeNote(lowBridgeNoteText(list));
      }
    }
    scheduleLowBridgeCheck(opt, { allowAvoid: false, attempt: 2 });
    if (opt.coords.length > 1) {
      const lngs = opt.coords.map((c) => c.longitude);
      const lats = opt.coords.map((c) => c.latitude);
      cameraRef.current?.fitBounds(
        [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        { padding: { top: 140, right: 60, bottom: 180, left: 60 }, duration: 800 },
      );
    }
  }

  function persistSaved(places: SavedPlace[]) {
    setSavedPlaces(places);
    AsyncStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(places)).catch(() => {});
  }

  function flyTo(latitude: number, longitude: number, delta = 0.08) {
    cameraRef.current?.flyTo({
      center: [longitude, latitude],
      zoom: deltaToZoom(delta),
      duration: 800,
    });
  }

  async function locateMe() {
    setLocating(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      noteElevation(pos.coords.altitude);
      flyTo(pos.coords.latitude, pos.coords.longitude, 3);
      setTimeout(() => {
        if (navOptionsRef.current.weather) {
          void refreshWeatherNow(
            pos.coords.latitude,
            pos.coords.longitude,
            Date.now(),
          );
        }
      }, 0);
    } catch {
      setLocationError('Could not get your location.');
    } finally {
      setLocating(false);
    }
  }

  // Mirror the planned route into a shared snapshot so other tabs (the
  // Fuel tab's "fuel along my route" list) can read it. Watching the state
  // covers planning, picking another route option, reroutes, and clearing.
  useEffect(() => {
    if (routeCoords.length >= 2 && routeInfo) {
      setActiveRoute(routeCoords, routeInfo);
    } else if (routeCoords.length === 0) {
      clearActiveRoute();
    }
  }, [routeCoords, routeInfo]);

  // When a route is planned, prefetch every switched-on OSM category
  // along its corridor, so pins exist down the whole line — not just
  // around the start. loadOsmCorridor no-ops when that route's corridor
  // is already loaded for the category.
  useEffect(() => {
    if (routeCoords.length < 2 || !poiLayers) return;
    for (const meta of POI_CATEGORIES) {
      if (meta.source === 'osm' && poiLayers[meta.key]) {
        void loadOsmCorridor(meta.key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCoords, routeInfo]);

  // Keep the check-in resolver pointed at the latest state (the
  // searchByTextRef pattern above). The second flag is the driver's
  // own saved check-in for the destination, or nothing — no
  // automatic detection (removed Nov 8 at Larry's call).
  useEffect(() => {
    resolveCheckInRef.current = (dest) => {
      const key = checkInKey(dest.latitude, dest.longitude, dest.name);
      const saved = findCheckIn(
        checkInsRef.current,
        dest.latitude,
        dest.longitude,
        dest.name,
      );
      setCheckInFlag(
        saved
          ? { key, latitude: saved.latitude, longitude: saved.longitude }
          : null,
      );
    };
  });

  // Resolve the check-in flag whenever a route to the working
  // destination is (re)planned. Clearing the route leaves the flag
  // state alone — the render gate decides visibility.
  const destContextKey = destContext
    ? checkInKey(destContext.latitude, destContext.longitude, destContext.name)
    : null;
  const hasActiveRoute = routeCoords.length > 1;
  useEffect(() => {
    if (!hasActiveRoute) return;
    const dest = destContextRef.current;
    if (dest) resolveCheckInRef.current(dest);
  }, [destContextKey, hasActiveRoute]);

  // Build #21: "Route home" — run the saved home through the normal
  // truck-routing + startNav flow (voice guidance per his usual
  // nav options). No home saved yet: stay on the Map and say so
  // plainly, with how to set it. A 5 s busy guard swallows the
  // duplicate triggers the deep link can produce (router route +
  // Linking event + focus effect can all fire for one tap).
  async function routeHome() {
    if (routeHomeBusyRef.current) return;
    routeHomeBusyRef.current = true;
    setTimeout(() => {
      routeHomeBusyRef.current = false;
    }, 5000);
    const home = homePlaceRef.current ?? (await loadHome());
    homePlaceRef.current = home;
    setHomePlace(home);
    if (!home) {
      setLocationError(
        'No home set yet. Search your home address on the Map, then tap "Set as home" on its card — it stays on your phone.',
      );
      speak('No home set yet. Set your home on the map first.', {
        stopFirst: false,
      });
      return;
    }
    setLocationError(null);
    setSearchResult(null);
    setSelected(null);
    setSelectedPoi(null);
    clearRoute();
    await truckRouteTo(home.latitude, home.longitude, home.name ?? 'Home', true);
  }

  // Shortcut deep link arriving while the app is already running
  // (the app/route-home.tsx route + focus effect cover cold start;
  // this covers a tap that lands while the Map is already focused).
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (url && /route-home/.test(url)) {
        requestRouteHome();
        if (takeRouteHomeRequest()) void routeHome();
      }
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-read settings whenever the Map tab is focused, so changes made in
  // the More tab apply without restarting navigation. Also consume the
  // Truck Stops tab handoff here (declared late so clearRoute/flyTo above
  // are in scope). Dropping the pin shows the usual Save / Truck route card.
  useFocusEffect(
    useCallback(() => {
      loadNavOptions().then((opts) => {
        navOptionsRef.current = opts;
        setNavOptions(opts);
      });
      // Keep the trip pill in sync with whatever the More tab shows.
      loadTripLog().then((log) => setTrip(log.current));
      // Build #21: keep the saved home fresh (the More tab can
      // clear it) and consume a pending "Route home" shortcut tap.
      loadHome().then((h) => {
        homePlaceRef.current = h;
        setHomePlace(h);
      });
      if (takeRouteHomeRequest()) void routeHome();
      const pending = takePendingNav();
      if (pending) {
        if (pending.latitude != null && pending.longitude != null) {
          const place: SavedPlace = {
            id: `stop-${pending.latitude},${pending.longitude}`,
            name: pending.name,
            latitude: pending.latitude,
            longitude: pending.longitude,
          };
          setSearchResult(place);
          setSelected(null);
          setSavedOpen(false);
          setTruckOpen(false);
          clearRoute();
          flyTo(place.latitude, place.longitude);
        } else if (pending.query) {
          setQuery(pending.query);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Geocoding (build #22 widened the chain — Larry, Nov 11: "904
  // Edwards Dr, Lebanon, IN" is a real address, Google finds it,
  // and the app said "Address not found"). Verified live that day:
  // Nominatim AND the Census geocoder return empty for it in every
  // spelling — the street's house numbers are missing from BOTH
  // free databases, and even the street itself is absent from their
  // road data — while Esri's World geocoder (the same source the
  // app's satellite imagery comes from) resolves it exactly
  // (PointAddress, score 100) with no key or account.
  // The chain now runs, in order:
  //   1. Nominatim with STRUCTURED, range-aware ranking — the old
  //      limit=1 free-text query let interpolation guess pins rank
  //      as "the answer" (it ranked a same-name Walmart's street
  //      over the searched address in Sedalia) and buried exacts.
  //   2. Census onelineaddress (TIGER address ranges; rural cover).
  //   3. Esri World findAddressCandidates, exact tiers only
  //      (rooftop / point / street-address matches with a strong
  //      score) — this is the tier that finds Edwards Dr.
  //   4. Photon (Komoot's OSM search), strict: only a result on the
  //      named street in the named city/state counts.
  //   5. Street-level fallback: if every exact tier missed, drop
  //      the house number and pin the STREET in that city/state
  //      (Esri street tiers, then Photon, then Nominatim) — a
  //      trucker would rather land on the right street than hit a
  //      dead-end "not found" (Larry's requirement).
  //   6. City-center last resort, with the same street rule.
  // Every tier validates its answer against the parsed address
  // (city/state/ZIP) before it counts — a same-name street two
  // states away is a MISS, never a pin. If all tiers miss, the
  // search throws 'not found' exactly as before.
  const GEOCODE_UA = { 'User-Agent': 'HammerLaneCo/1.0 (Android trucker app)' };

  async function fetchJsonTimeout(
    url: string,
    ms: number,
    headers?: Record<string, string>,
  ): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, { headers, signal: controller.signal });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  type ParsedAddress = {
    house: string | null;
    streetCore: string | null; // "EDWARDS" for "904 Edwards Dr"
    streetQuery: string | null; // "Edwards Dr"
    city: string | null;
    state: string | null; // 2-letter code
    zip: string | null;
  };

  // Light US address parser for the geocode tiers: pulls the house
  // number + street name, city, state and ZIP out of free text like
  // "904 Edwards Dr, Lebanon, IN 46052" (comma-less and state-name
  // spellings too). Anything it can't identify stays null and the
  // tiers simply validate less strictly.
  function parseUsAddress(raw: string): ParsedAddress {
    const text = raw.replace(/\s+/g, ' ').trim();
    const out: ParsedAddress = {
      house: null,
      streetCore: null,
      streetQuery: null,
      city: null,
      state: null,
      zip: null,
    };
    const zipM = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipM) out.zip = zipM[1];
    const STATE_CODES: Record<string, string> = {
      ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
      CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT',
      DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI',
      IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
      KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME',
      MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI',
      MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
      MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
      'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM',
      'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
      OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
      'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
      'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
      VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA',
      'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
      'DISTRICT OF COLUMBIA': 'DC',
    };
    const upper = text.toUpperCase();
    for (const [name, code] of Object.entries(STATE_CODES)) {
      if (new RegExp(`\\b${name}\\b`).test(upper)) {
        out.state = code;
        break;
      }
    }
    if (!out.state) {
      const codeM = upper.match(
        /\b(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
      );
      if (codeM) out.state = codeM[1];
    }
    const parts = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const first = parts[0] ?? text;
    const houseM = first.match(/^(\d+)\s+(.+)$/);
    const streetPart = houseM ? houseM[2] : first;
    if (houseM) out.house = houseM[1];
    const SUFFIX: Record<string, string> = {
      DR: 'DR', DRIVE: 'DR', ST: 'ST', STREET: 'ST', AVE: 'AVE',
      AVENUE: 'AVE', RD: 'RD', ROAD: 'RD', BLVD: 'BLVD',
      BOULEVARD: 'BLVD', LN: 'LN', LANE: 'LN', CT: 'CT',
      COURT: 'CT', HWY: 'HWY', HIGHWAY: 'HWY', PKWY: 'PKWY',
      PARKWAY: 'PKWY', CIR: 'CIR', CIRCLE: 'CIR', TRL: 'TRL',
      TRAIL: 'TRL', WAY: 'WAY', PL: 'PL', PLACE: 'PL',
    };
    const tokens = streetPart
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const dirs = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
      'NORTH', 'SOUTH', 'EAST', 'WEST']);
    const coreTokens = tokens.filter(
      (t) => !dirs.has(t) && !(t in SUFFIX) && !/^\d+$/.test(t),
    );
    if (coreTokens.length) {
      out.streetCore = coreTokens.join(' ');
      const suffixTok = tokens.find((t) => t in SUFFIX);
      out.streetQuery = suffixTok
        ? `${coreTokens.join(' ')} ${SUFFIX[suffixTok]}`
        : coreTokens.join(' ');
    }
    if (parts.length >= 2) {
      const cityPart = parts[1]
        .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
        .replace(
          /\b(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim();
      if (cityPart) out.city = cityPart;
    }
    return out;
  }

  // Does a candidate's address text agree with the parsed input?
  // 'exact' = same street + city/state/ZIP all check out;
  // 'street' = the street itself matches in the right place;
  // 'city' = right town only; null = does not agree (hard miss).
  function matchLevel(
    text: string,
    want: ParsedAddress,
    street?: string | null,
    city?: string | null,
    state?: string | null,
    zip?: string | null,
    house?: string | null,
  ): 'exact' | 'street' | 'city' | null {
    const T = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
    const has = (needle: string | null | undefined) =>
      !!needle && T.includes(` ${needle.toUpperCase()} `);
    if (want.state) {
      if (state && state.toUpperCase() !== want.state) return null;
      if (!state && !has(want.state)) return null;
    }
    const cityOk =
      !want.city ||
      (!!city && city.toUpperCase() === want.city.toUpperCase()) ||
      has(want.city);
    const streetOk =
      !!want.streetCore &&
      ((!!street &&
        street.toUpperCase().includes(want.streetCore)) ||
        has(want.streetCore));
    const houseOk =
      !want.house ||
      (!!house && house === want.house) ||
      T.trimStart().startsWith(`${want.house} `);
    if (streetOk && cityOk && houseOk) return 'exact';
    if (streetOk && cityOk) return 'street';
    if (want.zip && zip && zip === want.zip) {
      return streetOk ? 'street' : 'city';
    }
    if (cityOk && !street) return 'city';
    return null;
  }

  // Tier 1: Nominatim, structured + ranked. Structured params do
  // the house interpolation themselves and return address parts to
  // validate against; falls back to a validated free-text pass.
  async function geocodeViaNominatim(
    address: string,
    want: ParsedAddress,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const rank = (it: any): number => {
      const a = it.address ?? {};
      const lvl = matchLevel(
        typeof it.display_name === 'string' ? it.display_name : '',
        want,
        a.road,
        a.city || a.town || a.village || a.hamlet,
        null,
        a.postcode ? String(a.postcode).slice(0, 5) : null,
        a.house_number ? String(a.house_number) : null,
      );
      if (lvl === 'exact') return 3;
      if (lvl === 'street') return 2;
      if (lvl === 'city') return 1;
      return 0;
    };
    const pickBest = (results: any[]) => {
      let best: any = null;
      let bestRank = 0;
      for (const it of results) {
        const r = rank(it);
        if (r > bestRank) {
          best = it;
          bestRank = r;
        }
      }
      if (!best || bestRank < 3) return null;
      const latitude = parseFloat(best.lat as string);
      const longitude = parseFloat(best.lon as string);
      if (!isFinite(latitude) || !isFinite(longitude)) return null;
      return { latitude, longitude };
    };
    if (want.house && want.streetQuery && want.city && want.state) {
      const q =
        `street=${encodeURIComponent(`${want.house} ${want.streetQuery}`)}` +
        `&city=${encodeURIComponent(want.city)}&state=${want.state}` +
        (want.zip ? `&postalcode=${want.zip}` : '');
      const data = await fetchJsonTimeout(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&${q}`,
        15000,
        GEOCODE_UA,
      );
      if (Array.isArray(data)) {
        const hit = pickBest(data);
        if (hit) return hit;
      }
    }
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&q=${encodeURIComponent(
      address,
    )}`;
    // One automatic retry: a single dropped/slow request (VPN hops,
    // weak signal) shouldn't fail the whole search.
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await fetchJsonTimeout(url, 20000, GEOCODE_UA);
      if (Array.isArray(data)) return pickBest(data);
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 900));
      }
    }
    return null;
  }

  // Tier 2: US Census Bureau geocoder — TIGER address ranges cover
  // rural addresses OpenStreetMap doesn't know (Larry's own
  // Hughesville address included). Returns null on any miss.
  async function geocodeViaCensus(
    address: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
      address,
    )}&benchmark=Public_AR_Current&format=json`;
    const data = await fetchJsonTimeout(url, 15000);
    const m = data?.result?.addressMatches?.[0];
    const latitude = m?.coordinates?.y;
    const longitude = m?.coordinates?.x;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }
    if (!isFinite(latitude) || !isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  // Tier 3 (exact) / tier 5 (street): Esri World geocoder — free
  // keyless single-address lookups on the public endpoint (the same
  // Esri service family as the app's satellite imagery). It carries
  // commercial-grade US address data the free databases miss.
  const ESRI_ADDR_TYPES = [
    'PointAddress',
    'Subaddress',
    'StreetAddressExt',
    'StreetAddress',
  ];
  async function geocodeViaEsri(
    query: string,
    want: ParsedAddress,
    streetOnly: boolean,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const url =
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
      `?SingleLine=${encodeURIComponent(query)}&countryCode=USA` +
      '&outFields=Match_addr,Addr_type,Postal,Subregion' +
      '&maxLocations=5&f=json';
    const data = await fetchJsonTimeout(url, 15000);
    const candidates: any[] = Array.isArray(data?.candidates)
      ? data.candidates
      : [];
    let bestStreet: { latitude: number; longitude: number } | null = null;
    for (const c of candidates) {
      const score = typeof c?.score === 'number' ? c.score : 0;
      if (score < 85) continue;
      const x = c?.location?.x;
      const y = c?.location?.y;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!isFinite(x) || !isFinite(y)) continue;
      const type = String(c?.attributes?.Addr_type ?? '');
      const lvl = matchLevel(
        String(c?.attributes?.Match_addr ?? c?.address ?? ''),
        want,
        null,
        c?.attributes?.Subregion ?? null,
        null,
        c?.attributes?.Postal
          ? String(c.attributes.Postal).slice(0, 5)
          : null,
      );
      if (lvl === null) continue;
      const isExactType = ESRI_ADDR_TYPES.includes(type);
      if (!streetOnly && isExactType && lvl === 'exact') {
        return { latitude: y, longitude: x };
      }
      if (
        streetOnly &&
        lvl === 'street' &&
        (isExactType || type === 'StreetName' || type === 'StreetMid')
      ) {
        if (!bestStreet) bestStreet = { latitude: y, longitude: x };
      }
    }
    return streetOnly ? bestStreet : null;
  }

  // Build #23 (item 6a): PLACE-NAME search. A query with NO house
  // number ("Newcold Lebanon Indiana") is a place, not an address —
  // the address tiers were never going to find it. Esri's POI data
  // carries it: verified live Nov 11, findAddressCandidates with
  // category=POI returns "NewCold", Addr_type POI, Type Warehouse,
  // score 100, at 40.023678, −86.496391. The SAME agreement rule
  // applies, enforced from the candidate's City/Region fields: the
  // parsed city and state must both check out, the type must be a
  // place (never an address tier), and the match name must agree
  // with the name Larry typed — wrong-city junk never pins.
  async function geocodeViaEsriPlace(
    address: string,
    want: ParsedAddress,
  ): Promise<{ latitude: number; longitude: number } | null> {
    // The name = the raw query minus the parsed city, the state
    // name/code, and any ZIP — "Newcold Lebanon Indiana" minus
    // Lebanon/Indiana leaves "Newcold".
    const STATE_NAME_BY_CODE: Record<string, string> = {
      AL: 'ALABAMA', AK: 'ALASKA', AZ: 'ARIZONA', AR: 'ARKANSAS',
      CA: 'CALIFORNIA', CO: 'COLORADO', CT: 'CONNECTICUT',
      DE: 'DELAWARE', DC: 'DISTRICT OF COLUMBIA', FL: 'FLORIDA',
      GA: 'GEORGIA', HI: 'HAWAII', ID: 'IDAHO', IL: 'ILLINOIS',
      IN: 'INDIANA', IA: 'IOWA', KS: 'KANSAS', KY: 'KENTUCKY',
      LA: 'LOUISIANA', ME: 'MAINE', MD: 'MARYLAND', MA: 'MASSACHUSETTS',
      MI: 'MICHIGAN', MN: 'MINNESOTA', MS: 'MISSISSIPPI',
      MO: 'MISSOURI', MT: 'MONTANA', NE: 'NEBRASKA', NV: 'NEVADA',
      NH: 'NEW HAMPSHIRE', NJ: 'NEW JERSEY', NM: 'NEW MEXICO',
      NY: 'NEW YORK', NC: 'NORTH CAROLINA', ND: 'NORTH DAKOTA',
      OH: 'OHIO', OK: 'OKLAHOMA', OR: 'OREGON', PA: 'PENNSYLVANIA',
      RI: 'RHODE ISLAND', SC: 'SOUTH CAROLINA', SD: 'SOUTH DAKOTA',
      TN: 'TENNESSEE', TX: 'TEXAS', UT: 'UTAH', VT: 'VERMONT',
      VA: 'VIRGINIA', WA: 'WASHINGTON', WV: 'WEST VIRGINIA',
      WI: 'WISCONSIN', WY: 'WYOMING',
    };
    let nameQuery = ` ${address
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')} `;
    if (want.zip) nameQuery = nameQuery.replace(` ${want.zip} `, ' ');
    if (want.state) {
      const stateName = STATE_NAME_BY_CODE[want.state];
      if (stateName) nameQuery = nameQuery.replace(` ${stateName} `, ' ');
      nameQuery = nameQuery.replace(` ${want.state} `, ' ');
    }
    if (want.city) {
      nameQuery = nameQuery.replace(
        ` ${want.city.toUpperCase()} `,
        ' ',
      );
    }
    const nameCore = nameQuery.replace(/\s+/g, ' ').trim();
    if (!nameCore) return null;
    const url =
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
      `?SingleLine=${encodeURIComponent(address)}&countryCode=USA` +
      '&category=POI' +
      '&outFields=Match_addr,Addr_type,Postal,City,Region,Type' +
      '&maxLocations=5&f=json';
    const data = await fetchJsonTimeout(url, 15000);
    const candidates: any[] = Array.isArray(data?.candidates)
      ? data.candidates
      : [];
    for (const c of candidates) {
      const score = typeof c?.score === 'number' ? c.score : 0;
      if (score < 85) continue;
      const x = c?.location?.x;
      const y = c?.location?.y;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!isFinite(x) || !isFinite(y)) continue;
      const type = String(c?.attributes?.Addr_type ?? '');
      // Places only — an address-tier candidate here means the
      // query really was an address after all; the address chain
      // owns those.
      if (ESRI_ADDR_TYPES.includes(type)) continue;
      // City/state agreement, from the candidate's own fields.
      const region = String(c?.attributes?.Region ?? '').toUpperCase();
      if (want.state) {
        const regionOk =
          region === want.state ||
          region === STATE_NAME_BY_CODE[want.state];
        if (!regionOk) continue;
      }
      const city = String(c?.attributes?.City ?? '').toUpperCase();
      if (want.city && city !== want.city.toUpperCase()) continue;
      // Build #24 (item 2): the name check runs against the
      // candidate's short labels — c.address AND Match_addr —
      // never Match_addr alone: for place hits Match_addr is the
      // full street address, which is how Larry's "new Cold
      // Storage Lebanon Indiana" was rejected in #23 even though
      // Esri's top hit WAS the warehouse ("Newcold Advanced Cold
      // Storage Logistics", score 91.32, pin on the facility).
      // A label agrees when (a) either squashed string contains
      // the other, or (b) the label's tokens, walked in order,
      // consume the whole squashed query core — a token counts
      // when it is a prefix of the remaining core; other label
      // tokens are skipped. "NEW COLD STORAGE" consumes
      // NEWCOLDADVANCEDCOLDSTORAGELOGISTICS as NEW + (skip
      // ADVANCED) + COLD + STORAGE. "US COLD STORAGE" and
      // "UNITED STATES COLD STORAGE" both fail — no token is a
      // prefix of NEWCOLDSTORAGE — so wrong-name same-city
      // places stay rejected. Score >= 85, POI-type, and
      // city/state gates above are unchanged.
      const coreSquashed = nameCore.replace(/[^A-Z0-9]+/g, '');
      if (!coreSquashed) continue;
      const labelOk = (raw: unknown): boolean => {
        const label = String(raw ?? '')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, ' ')
          .trim();
        if (!label) return false;
        const squashed = label.replace(/ /g, '');
        if (
          squashed.includes(coreSquashed) ||
          coreSquashed.includes(squashed)
        ) {
          return true;
        }
        let rest = coreSquashed;
        for (const tok of label.split(' ')) {
          if (!tok) continue;
          if (rest.startsWith(tok)) {
            rest = rest.slice(tok.length);
            if (!rest) return true;
          }
        }
        return rest.length === 0;
      };
      if (!labelOk(c?.address) && !labelOk(c?.attributes?.Match_addr)) {
        continue;
      }
      return { latitude: y, longitude: x };
    }
    return null;
  }

  // Tier 4 (exact) / tier 5 (street): Photon (Komoot) — a second
  // OSM-derived index with different coverage. STRICT validation:
  // Photon's loose ranking returns same-name streets anywhere on
  // Earth, so only a US result matching street + city + state is
  // ever accepted.
  async function geocodeViaPhoton(
    query: string,
    want: ParsedAddress,
    streetOnly: boolean,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      query,
    )}&limit=5&lang=en`;
    const data = await fetchJsonTimeout(url, 12000, GEOCODE_UA);
    const features: any[] = Array.isArray(data?.features) ? data.features : [];
    for (const f of features) {
      const p = f?.properties ?? {};
      if (p.countrycode && p.countrycode !== 'US') continue;
      const coords = f?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const longitude = Number(coords[0]);
      const latitude = Number(coords[1]);
      if (!isFinite(latitude) || !isFinite(longitude)) continue;
      const lvl = matchLevel(
        [p.housenumber, p.street, p.city, p.state, p.postcode]
          .filter(Boolean)
          .join(' '),
        want,
        p.street,
        p.city,
        null,
        p.postcode ? String(p.postcode).slice(0, 5) : null,
        p.housenumber ? String(p.housenumber) : null,
      );
      if (!streetOnly && lvl === 'exact') return { latitude, longitude };
      if (streetOnly && lvl === 'street') return { latitude, longitude };
    }
    return null;
  }

  // Tier 5/6 street + city resolution: pin the street itself in the
  // named city (Nominatim free-text on "Street, City, ST"), or as a
  // last resort the city center, so a real address never dead-ends.
  async function geocodeViaNominatimStreet(
    want: ParsedAddress,
  ): Promise<{ latitude: number; longitude: number } | null> {
    if (!want.streetQuery || !want.city || !want.state) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&q=${encodeURIComponent(
      `${want.streetQuery}, ${want.city}, ${want.state}`,
    )}`;
    const data = await fetchJsonTimeout(url, 15000, GEOCODE_UA);
    if (!Array.isArray(data)) return null;
    for (const it of data) {
      const a = it.address ?? {};
      const lvl = matchLevel(
        typeof it.display_name === 'string' ? it.display_name : '',
        want,
        a.road,
        a.city || a.town || a.village || a.hamlet,
        null,
        a.postcode ? String(a.postcode).slice(0, 5) : null,
        null,
      );
      if (lvl !== 'street') continue;
      const latitude = parseFloat(it.lat as string);
      const longitude = parseFloat(it.lon as string);
      if (isFinite(latitude) && isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
    return null;
  }

  async function geocodeViaNominatimCity(
    want: ParsedAddress,
  ): Promise<{ latitude: number; longitude: number } | null> {
    if (!want.city || !want.state) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(
      `${want.city}, ${want.state}`,
    )}`;
    const data = await fetchJsonTimeout(url, 15000, GEOCODE_UA);
    if (!Array.isArray(data) || !data.length) return null;
    const latitude = parseFloat(data[0].lat as string);
    const longitude = parseFloat(data[0].lon as string);
    if (!isFinite(latitude) || !isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  // The widened chain (build #22): exact tiers first, then the
  // street-level fallback, then the city — a real US address lands
  // somewhere true instead of "not found."
  async function geocodeAddress(
    address: string,
  ): Promise<{ latitude: number; longitude: number }> {
    const want = parseUsAddress(address);
    // Build #23 (item 6a): no house number → this is a PLACE NAME
    // ("Newcold Lebanon Indiana"), not an address. Run the Esri
    // place tier FIRST: the address chain below would burn two
    // slow Nominatim/Census round trips and then land its
    // street/city fallbacks — a bare city-center pin for a named
    // place is worse than not finding it. If the place tier
    // misses, the address chain still gets its chance (some
    // numberless queries really are street names).
    if (!want.house) {
      const place = await geocodeViaEsriPlace(address, want);
      if (place) return place;
    }
    const nominatim = await geocodeViaNominatim(address, want);
    if (nominatim) return nominatim;
    const census = await geocodeViaCensus(address);
    if (census) return census;
    const esri = await geocodeViaEsri(address, want, false);
    if (esri) return esri;
    const photon = await geocodeViaPhoton(address, want, false);
    if (photon) return photon;
    // Street-level fallback: same street, house number dropped.
    if (want.streetQuery && want.city && want.state) {
      const streetText = `${want.streetQuery}, ${want.city}, ${want.state}${
        want.zip ? ` ${want.zip}` : ''
      }`;
      const esriStreet = await geocodeViaEsri(streetText, want, true);
      if (esriStreet) return esriStreet;
      const photonStreet = await geocodeViaPhoton(streetText, want, true);
      if (photonStreet) return photonStreet;
      const nominatimStreet = await geocodeViaNominatimStreet(want);
      if (nominatimStreet) return nominatimStreet;
      // Verified for Lebanon IN: Edwards Dr exists in NONE of the
      // free road databases, so even the street misses — the city
      // center is the honest last resort (Esri's exact tier above
      // catches this address long before it gets here).
      const city = await geocodeViaNominatimCity(want);
      if (city) return city;
    }
    throw new Error('not found');
  }

  async function searchViaAddress() {
    const address = viaQuery.trim();
    if (!address || viaSearching) return;
    setViaSearching(true);
    setLocationError(null);
    Keyboard.dismiss();
    try {
      const { latitude, longitude } = await geocodeAddress(address);
      setViaDest({
        id: `via-${latitude},${longitude}`,
        name: address,
        latitude,
        longitude,
      });
    } catch {
      setLocationError('Stop address not found. Check it and try again.');
    } finally {
      setViaSearching(false);
    }
  }

  // Mic button: tap, say a place ("Dallas Texas"), and the words land in
  // the search box and run the same geocode flow as typing them.
  async function startVoiceSearch() {
    if (listening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setLocationError('Voice search is not available on this phone.');
        return;
      }
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setLocationError(
          'Voice search needs microphone permission. Allow it when asked, or type the address instead.',
        );
        return;
      }
      setLocationError(null);
      Keyboard.dismiss();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
      });
    } catch {
      setLocationError('Voice search could not start. Type the address instead.');
    }
  }

  // Land a chosen place on the map: destination card, marker, the
  // works — shared by typed search and autocomplete taps.
  function applySearchPlace(place: SavedPlace) {
    setSuggestions([]);
    setSearchResult(place);
    setSelected(null);
    setSavedOpen(false);
    setTruckOpen(false);
    clearRoute();
    flyTo(place.latitude, place.longitude);
  }

  // Autocomplete lookup (debounced by handleQueryChange). Results
  // shorten Nominatim's long display names to the first three parts.
  // Build #22: the suggestions share the geocoder's gaps (a full
  // address like the Lebanon one returned NOTHING while typing),
  // so when Nominatim comes up empty for a full-looking address,
  // the Esri + Photon tiers fill the list instead.
  async function fetchSuggestions(text: string) {
    const seq = ++suggestSeqRef.current;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&addressdetails=1&q=${encodeURIComponent(
        text,
      )}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'HammerLaneCo/1.0 (Android trucker app)' },
          signal: controller.signal,
        });
        if (!r.ok) return;
        const results = (await r.json()) as any[];
        if (seq !== suggestSeqRef.current) return;
        const places: SavedPlace[] = [];
        for (const item of results) {
          const latitude = parseFloat(item.lat as string);
          const longitude = parseFloat(item.lon as string);
          if (!isFinite(latitude) || !isFinite(longitude)) continue;
          const display =
            typeof item.display_name === 'string' ? item.display_name : '';
          const name = display
            .split(',')
            .slice(0, 3)
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(', ');
          if (!name) continue;
          places.push({
            id: `sugg-${latitude},${longitude}`,
            name,
            latitude,
            longitude,
          });
        }
        if (places.length > 0) {
          setSuggestions(places);
          return;
        }
        // Widened fallback: only for full-looking addresses (house
        // number + city/state) — partial typing stays Nominatim-only
        // so the list doesn't churn while he types.
        const want = parseUsAddress(text);
        // Build #23 (item 6a): a numberless query with a city +
        // state reads as a place name — offer the Esri place hit
        // as a suggestion ("Newcold Lebanon Indiana" types to the
        // warehouse, not silence).
        if (!want.house && want.city && want.state) {
          const poi = await geocodeViaEsriPlace(text, want);
          if (seq !== suggestSeqRef.current) return;
          if (poi) {
            setSuggestions([
              {
                id: `sugg-${poi.latitude},${poi.longitude}`,
                name: text,
                latitude: poi.latitude,
                longitude: poi.longitude,
              },
            ]);
          }
          return;
        }
        if (!want.house || !want.city || !want.state) return;
        const fill: SavedPlace[] = [];
        const esri = await geocodeViaEsri(text, want, false);
        if (esri) {
          fill.push({
            id: `sugg-${esri.latitude},${esri.longitude}`,
            name: text,
            latitude: esri.latitude,
            longitude: esri.longitude,
          });
        }
        if (seq !== suggestSeqRef.current) return;
        if (fill.length === 0) {
          const photon = await geocodeViaPhoton(text, want, false);
          if (photon) {
            fill.push({
              id: `sugg-${photon.latitude},${photon.longitude}`,
              name: text,
              latitude: photon.latitude,
              longitude: photon.longitude,
            });
          }
        }
        if (seq !== suggestSeqRef.current) return;
        if (fill.length > 0) setSuggestions(fill);
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (text.trim().length < 4) {
      setSuggestions([]);
      return;
    }
    suggestTimerRef.current = setTimeout(() => {
      void fetchSuggestions(text.trim());
    }, 450);
  }

  function applySuggestion(place: SavedPlace) {
    setQuery(place.name);
    Keyboard.dismiss();
    applySearchPlace(place);
  }

  async function searchAddress(addressOverride?: string) {
    const address = (addressOverride ?? query).trim();
    if (!address || searching) return;
    setSearching(true);
    setLocationError(null);
    Keyboard.dismiss();
    try {
      const { latitude, longitude } = await geocodeAddress(address);
      applySearchPlace({
        id: `search-${latitude},${longitude}`,
        name: address,
        latitude,
        longitude,
      });
    } catch (e) {
      setLocationError(
        e instanceof Error && e.message === 'not found'
          ? 'Address not found. Check it and try again.'
          : 'Search failed. Check your connection and try again.',
      );
    } finally {
      setSearching(false);
    }
  }

  // Reverse geocode for a dropped pin, through the same Nominatim
  // service the address search uses. Best-effort and quick (8s cap):
  // any failure or empty answer returns null and the pin keeps its
  // "Dropped pin" label — the pin card never waits on this lookup.
  async function reverseGeocodePin(
    latitude: number,
    longitude: number,
  ): Promise<string | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'HammerLaneCo/1.0 (Android trucker app)' },
        signal: controller.signal,
      });
      if (!r.ok) return null;
      const data: any = await r.json();
      const a = data?.address ?? {};
      const road = [a.house_number, a.road].filter(Boolean).join(' ');
      const town = a.city || a.town || a.village || a.county || '';
      const short = [road, town, a.state].filter(Boolean).join(', ');
      if (short) return short;
      const display =
        typeof data?.display_name === 'string' ? data.display_name : '';
      const firstTwo = display
        .split(',')
        .slice(0, 2)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .join(', ');
      return firstTwo || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Press-and-hold the map. Three cases (build #24, item 11
  // rework — the old version ignored holds during navigation and
  // cleared any planned route):
  // 1. A route/destination is active: the hold MOVES the
  //    destination to the pressed point and replans to that exact
  //    spot — Larry's address pin lands near the dock, not on it,
  //    and the hold is how he puts the endpoint where he actually
  //    has to go. The address label is kept for reference
  //    (routeDestNameRef is untouched). This replaces the
  //    endpoint; the amber tap-to-set Check-in point is a
  //    separate saved marker and stays as-is.
  // 2. An address card is up but nothing is routed yet: the hold
  //    moves THAT pin (name kept), so Truck route / Start route
  //    then route to the pressed point.
  // 3. Nothing is up: the classic dropped pin + destination card
  //    (Save / Truck route / Start route ride the searchResult
  //    state, marker included).
  // A plain tap or pan never drops a pin; the map's onPress only
  // clears selections.
  function dropPin(latitude: number, longitude: number) {
    if (!isFinite(latitude) || !isFinite(longitude)) return;
    if (routeDestRef.current) {
      void moveDestinationTo(latitude, longitude);
      return;
    }
    if (searchResult) {
      setSearchResult({ ...searchResult, latitude, longitude });
      setSelected(null);
      setSelectedPoi(null);
      setLocationError(null);
      Keyboard.dismiss();
      return;
    }
    const pin: SavedPlace = {
      id: `pin-${latitude},${longitude}`,
      name: 'Dropped pin',
      latitude,
      longitude,
    };
    setSearchResult(pin);
    setSelected(null);
    setSelectedPoi(null);
    setSavedOpen(false);
    setTruckOpen(false);
    clearRoute();
    setLocationError(null);
    Keyboard.dismiss();
    // Name the pin from the map data if we can. If the lookup comes
    // back empty, or the pin was closed/replaced meanwhile, leave the
    // card exactly as it is.
    void reverseGeocodePin(latitude, longitude).then((label) => {
      if (!label) return;
      setSearchResult((cur) =>
        cur && cur.id === pin.id ? { ...cur, name: label } : cur,
      );
    });
  }

  // Build #24 (item 11): replan to a long-pressed point as the new
  // destination. Origin is the truck's current position (the
  // smoothed badge position while navigating), falling back to the
  // last plan's origin when no fix exists yet. Mid-navigation the
  // replan rides planRoute's reroute path, so nav restarts on the
  // new route hands-free; a planned-but-not-started route just
  // re-frames. Stops on the way are kept — only the endpoint
  // moves.
  async function moveDestinationTo(latitude: number, longitude: number) {
    const origin =
      badgePosRef.current ??
      myPos ??
      (lastPlanRef.current
        ? {
            latitude: lastPlanRef.current.fromLat,
            longitude: lastPlanRef.current.fromLng,
          }
        : null);
    if (!origin) {
      setLocationError('No position yet — can’t move the destination.');
      return;
    }
    const navigating = navIndexRef.current !== null;
    const ok = await planRoute(
      origin.latitude,
      origin.longitude,
      latitude,
      longitude,
      navigating,
    );
    if (ok) {
      showWeighAlert('📍 Destination moved to your pin');
      if (navigating) {
        speak('Destination moved. New route.', { stopFirst: false });
      }
    } else {
      setLocationError('Couldn’t reroute to the new pin — destination unchanged.');
    }
  }

  // Pin-card action: save this dropped pin as the check-in point
  // for the working destination. The point is the driver's own mark
  // (constants/checkin.ts), remembered on-device; it plants the
  // second flag immediately and on every later route to the same
  // destination.
  function setCheckInFromPin(pin: SavedPlace) {
    const dest = destContextRef.current;
    if (!dest) return;
    const point: CheckInPoint = {
      key: checkInKey(dest.latitude, dest.longitude, dest.name),
      destLatitude: dest.latitude,
      destLongitude: dest.longitude,
      destName: dest.name,
      latitude: pin.latitude,
      longitude: pin.longitude,
      at: Date.now(),
    };
    const next = upsertCheckIn(checkInsRef.current, point);
    checkInsRef.current = next;
    setCheckIns(next);
    void saveCheckIns(next);
    setCheckInFlag({
      key: point.key,
      latitude: point.latitude,
      longitude: point.longitude,
    });
  }

  // Pin-card action: forget the saved check-in for the working
  // destination. While a route to it is up, resolve again (which
  // now simply clears the flag — there is no other source).
  function clearCheckInForDest() {
    const dest = destContextRef.current;
    if (!dest) return;
    const next = removeCheckIn(
      checkInsRef.current,
      dest.latitude,
      dest.longitude,
      dest.name,
    );
    checkInsRef.current = next;
    setCheckIns(next);
    void saveCheckIns(next);
    if (routeCoordsRef.current.length > 1) {
      resolveCheckInRef.current(dest);
    } else {
      setCheckInFlag(null);
    }
  }

  // Keep the speech-result handler pointed at the latest searchAddress.
  useEffect(() => {
    searchByTextRef.current = (text: string) => {
      void searchAddress(text);
    };
  });

  function isSaved(place: SavedPlace) {
    return savedPlaces.some(
      (p) => p.latitude === place.latitude && p.longitude === place.longitude,
    );
  }

  function savePlace(place: SavedPlace) {
    if (isSaved(place)) return;
    const entry: SavedPlace = {
      id: `saved-${Date.now()}`,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
    };
    persistSaved([entry, ...savedPlaces]);
    setSearchResult(null);
    setSavedOpen(true);
  }

  // Build #21: Set home / clear home for the "Route home" shortcut.
  // The place comes from the open address/pin card; the record is
  // saved on-device only (constants/home.ts) and never leaves the
  // phone. Feedback rides the location-error line, the same channel
  // the card area already uses for plain-language messages.
  function setHomeFromPlace(place: SavedPlace) {
    const home: HomePlace = makeHomePlace(
      place.latitude,
      place.longitude,
      place.name,
    );
    homePlaceRef.current = home;
    setHomePlace(home);
    void saveHome(home);
    setLocationError(
      'Home saved on this phone. Long-press the app icon to place the "Route home" button on your home screen.',
    );
  }

  function clearHomePlace() {
    homePlaceRef.current = null;
    setHomePlace(null);
    void clearHome();
    setLocationError('Home cleared. The "Route home" button will ask you to set it again.');
  }

  function deletePlace(id: string) {
    persistSaved(savedPlaces.filter((p) => p.id !== id));
  }

  function openSaved(place: SavedPlace) {
    setSearchResult(place);
    setSelected(null);
    setSavedOpen(false);
    flyTo(place.latitude, place.longitude);
  }

  // Drive stats row (MPH / miles left / ETA / arrive) — shared by the
  // slim navigation strip and the full steps panel.
  function renderDriveStats() {
    return (
      <View style={styles.driveStats}>
        <View style={styles.driveStat}>
          <Text
            style={styles.driveStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}>
            {speedMph !== null ? speedMph : '–'}
          </Text>
          <Text style={styles.driveStatLabel} numberOfLines={1}>
            MPH
          </Text>
        </View>
        <View style={styles.driveStat}>
          <Text
            style={styles.driveStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}>
            {navRemain
              ? navRemain.miles < 0.1
                ? `${Math.max(0, Math.round(navRemain.miles * 5280))}`
                : `${navRemain.miles.toFixed(1)}`
              : '–'}
          </Text>
          <Text style={styles.driveStatLabel} numberOfLines={1}>
            {navRemain && navRemain.miles < 0.1 ? 'FT LEFT' : 'MI LEFT'}
          </Text>
        </View>
        <View style={styles.driveStat}>
          <Text
            style={styles.driveStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}>
            {navRemain
              ? navRemain.minutes >= 60
                ? `${Math.floor(navRemain.minutes / 60)}h ${navRemain.minutes % 60}m`
                : `${navRemain.minutes} min`
              : '–'}
          </Text>
          <Text style={styles.driveStatLabel} numberOfLines={1}>
            ETA
          </Text>
        </View>
        <View style={styles.driveStat}>
          <Text
            style={styles.driveStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}>
            {navRemain ? navRemain.arriveLabel : '–'}
          </Text>
          <Text style={styles.driveStatLabel} numberOfLines={1}>
            ARRIVE
          </Text>
        </View>
      </View>
    );
  }

  // POI markers. The OSM cache is nationwide (GPS + viewport +
  // corridor loads all merge into it), so pins render only for the
  // region actually on screen — padded a touch so they don't pop at
  // the edges mid-pan. Bundled datasets are local data: they show for
  // the visible region, along the planned route's corridor, or (before
  // the map has reported a region) within 75 miles of the focus point.
  // "Along my route" narrows everything to the route line.
  function inView(lat: number, lng: number, padFrac = 0.25): boolean {
    const b = viewBounds;
    if (!b) return true;
    const latPad = (b.north - b.south) * padFrac;
    let lngSpan = b.east - b.west;
    if (lngSpan < 0) lngSpan += 360;
    const lngPad = lngSpan * padFrac;
    if (lat < b.south - latPad || lat > b.north + latPad) return false;
    let off = lng - b.west;
    if (off < -180) off += 360;
    if (off > 180) off -= 360;
    return off >= -lngPad && off <= lngSpan + lngPad;
  }

  const bundledStopMarkers = useMemo(() => {
    if (!poiLayers?.stops) return [];
    const b = viewBounds;
    const center = b
      ? {
          latitude: (b.south + b.north) / 2,
          longitude: (b.west + b.east) / 2,
        }
      : poiFocus();
    const route = routeCoords.length >= 2 ? getActiveRoute() : null;
    return truckStops
      .filter((stop) => {
        if (!poiVisible(stop.latitude, stop.longitude)) return false;
        if (b && inView(stop.latitude, stop.longitude)) return true;
        if (
          route &&
          projectOntoRoute(route, stop.latitude, stop.longitude).offMi <=
            ALONG_ROUTE_TOLERANCE_MI
        ) {
          return true;
        }
        if (!b) {
          return (
            distMi(center.latitude, center.longitude, stop.latitude, stop.longitude) <= 75
          );
        }
        return false;
      })
      .map((stop) => ({
        stop,
        d: distMi(center.latitude, center.longitude, stop.latitude, stop.longitude),
      }))
      .sort((a, z) => a.d - z.d)
      .slice(0, 200)
      .map((x) => x.stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiLayers?.stops, viewBounds, routeCoords, poiAlongRoute, myPos, searchResult]);

  const bundledWeighMarkers = useMemo(() => {
    if (!poiLayers?.weigh) return [];
    const b = viewBounds;
    const center = b
      ? {
          latitude: (b.south + b.north) / 2,
          longitude: (b.west + b.east) / 2,
        }
      : poiFocus();
    const route = routeCoords.length >= 2 ? getActiveRoute() : null;
    return weighStations
      .filter((ws) => {
        if (!poiVisible(ws.latitude, ws.longitude)) return false;
        if (b && inView(ws.latitude, ws.longitude)) return true;
        if (
          route &&
          projectOntoRoute(route, ws.latitude, ws.longitude).offMi <=
            ALONG_ROUTE_TOLERANCE_MI
        ) {
          return true;
        }
        if (!b) {
          return (
            distMi(center.latitude, center.longitude, ws.latitude, ws.longitude) <= 75
          );
        }
        return false;
      })
      .map((ws) => ({
        ws,
        d: distMi(center.latitude, center.longitude, ws.latitude, ws.longitude),
      }))
      .sort((a, z) => a.d - z.d)
      .slice(0, 200)
      .map((x) => x.ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiLayers?.weigh, viewBounds, routeCoords, poiAlongRoute, myPos, searchResult]);

  // Build #27 (item 6): an enabled OSM category now shows its
  // pins along the WHOLE route, not just inside the current
  // viewport — Larry plans fuel and parking stops hundreds of
  // miles ahead, and the corridor load (loadOsmCorridor) already
  // fetches that ground; the old inView-only filter threw it
  // away at render time. A pin now renders when it is in view OR
  // within the along-route tolerance of the route line (checked
  // against route samples every ~4 mi, the same tolerance the
  // bundled stops/weigh markers use). The along-route set is
  // capped so a 500-mile corridor can't bury the map in pins;
  // in-view pins always make the cut first.
  const osmMarkers: Poi[] = useMemo(() => {
    if (!poiLayers) return [];
    const route = routeCoords.length >= 2 ? getActiveRoute() : null;
    const samples = route ? sampleAlongRoute(route, 4, 220) : [];
    const nearRoute = (lat: number, lng: number) =>
      samples.some(
        (s) =>
          distMi(lat, lng, s.latitude, s.longitude) <=
          ALONG_ROUTE_TOLERANCE_MI + 0.6,
      );
    const inViewPois: Poi[] = [];
    const alongPois: Poi[] = [];
    for (const meta of POI_CATEGORIES) {
      if (meta.source !== 'osm' || !poiLayers[meta.key]) continue;
      for (const p of osmPois[meta.key] ?? []) {
        if (!poiVisible(p.latitude, p.longitude)) continue;
        if (inView(p.latitude, p.longitude)) inViewPois.push(p);
        else if (route && nearRoute(p.latitude, p.longitude)) {
          alongPois.push(p);
        }
      }
    }
    return [...inViewPois, ...alongPois].slice(0, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiLayers, osmPois, viewBounds, routeCoords, poiAlongRoute, myPos]);

  // Build #24 (item 13): the branded badge faces. Each returns the
  // badge's inner view; the marker Pressable drops its generic
  // colored-circle style (poiBadgeClear) when one of these shows.
  // The white rim + dark edge keeps them readable on satellite.
  function renderBrandBadge(b: { bg: string; fg: string; text: string }) {
    return (
      <View style={[styles.brandBadge, { backgroundColor: b.bg }]}>
        <Text style={[styles.brandBadgeText, { color: b.fg }]}>{b.text}</Text>
      </View>
    );
  }
  function renderCatBadge() {
    return (
      <View style={[styles.brandBadge, styles.catBadge]}>
        <Text style={styles.catBadgeText}>CAT</Text>
        <Text style={styles.catBadgeSub}>SCALE</Text>
      </View>
    );
  }
  function renderParkingBadge() {
    return (
      <View style={[styles.brandBadge, styles.parkingBadge]}>
        <Text style={styles.parkingBadgeText}>P</Text>
      </View>
    );
  }

  // Bottom clearance for pop-up panels and cards: while navigating,
  // the nav strip (or the taller steps panel) owns the bottom of the
  // map, so panels ride above it instead of hiding their bottoms
  // behind it (Larry, Nov 7: "I can't see the bottom — move up").
  const bottomPanelLift =
    navIndex !== null ? { bottom: stepsOpen ? 244 : 104 } : null;

  // Top turn banner (build #19): while navigating, the NEXT maneuver
  // and the distance to it sit permanently at the top of the map —
  // Larry's SmartTruckRoute reference. The maneuver paired with
  // navDistMi is the one at the END of the current step (the same
  // pairing the voice announcements use): navSteps[navIndex + 1].
  // The following maneuver rides along as the small "Then" line.
  const turnBannerUp =
    navIndex !== null && !!navSteps[navIndex] && !stepsOpen;
  // Build #22 (item 3): while the turn banner is up, the tab layout
  // hides its "Hammerlaneco" header so the banner is the very top
  // thing on the screen (constants/navBanner, same store pattern
  // as PiP). Cleanup drops the flag if the screen unmounts mid-nav.
  useEffect(() => {
    setSharedNavBannerUp(turnBannerUp);
    return () => setSharedNavBannerUp(false);
  }, [turnBannerUp]);
  const turnNextStep =
    navIndex !== null && navSteps.length > 0
      ? navSteps[Math.min(navIndex + 1, navSteps.length - 1)]
      : null;
  const turnThenStep =
    navIndex !== null && navIndex + 2 < navSteps.length
      ? navSteps[navIndex + 2]
      : null;
  const turnDistText =
    navIndex === null ||
    navDistMi === null ||
    navIndex >= navSteps.length - 1
      ? null
      : navDistMi < 0.1
        ? `${Math.max(10, Math.round((navDistMi * 5280) / 10) * 10)} ft`
        : navDistMi < 10
          ? `${navDistMi.toFixed(1)} mi`
          : `${Math.round(navDistMi)} mi`;
  // Build #24 (item 3): the road the truck is ON right now, from
  // the current maneuver's street names — the persistent readout
  // Larry pointed at in SmartTruckRoute ("showing I-270 going
  // along the route").
  const currentRoad =
    navIndex !== null ? currentRoadName(navSteps[navIndex]) : null;
  // Build #24 (item 1): lane strip data for the NEXT maneuver.
  // The strip renders only when the maneuver carries lane data
  // AND at least one lane is marked as following the route —
  // no data (or no route lane named) means no strip, never a
  // guessed one.
  const turnLanes: NavLane[] = turnNextStep?.lanes ?? [];
  const laneStripOn =
    turnLanes.length > 0 &&
    turnLanes.some((l) => (l.directions & laneRouteMask(l)) !== 0);
  // Build #24 (item 9): tapping the banner speaks the current
  // instruction (with its distance) and the "Then:" maneuver
  // after it, through the same speak() path as the automatic
  // announcements.
  const speakTurnBanner = () => {
    if (!turnNextStep) return;
    const distPart = turnDistText ? `In ${turnDistText}, ` : '';
    speak(
      `${distPart}${turnNextStep.instruction}${
        turnThenStep ? ` Then, ${turnThenStep.instruction}` : ''
      }`,
    );
  };

  // Heading readout (build #19, Larry's SmartTruckRoute pictures):
  // the direction of travel as a cardinal + degrees for the bottom
  // bar. (The on-screen angle that rotated the marker wedge went
  // away with the wedge itself in build #23, item 2.)
  const headingCardinal =
    navCourseDeg === null
      ? null
      : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
          Math.round(navCourseDeg / 45) % 8
        ];
  // Build #24 (item 4): the truck cutout is heading-locked — it
  // rotates by (course − map bearing) so the cab/front of the
  // rear-view cutout always leads up-route, at any map rotation.
  // Build #19's never-rotate call is superseded: under drive-up
  // rotation the un-rotated cutout read as a truck lying sideways
  // / backing down the road on Larry's satellite screenshot. When
  // the follow camera is doing its job the map bearing ≈ course
  // and the rotation sits near zero; when Larry free-rotates the
  // map, the truck keeps pointing along its true course.
  // Build #26 ROOT FIX ("the truck did it again", I-74 W, course
  // 295°): the formula was right but its map-bearing input was
  // dead — the region handlers read a `heading` key MapLibre
  // never sends (the payload's key is `bearing`), so mapHeading
  // sat at 0, the cutout rendered rotated by the full 295° course
  // (pointing west) while the course-up camera had the road
  // running vertically, and the bearing watchdog compared course
  // against the same stuck-at-0 feed so it could never see the
  // mismatch. regionBearing() now feeds real bearings from both
  // region events; with the camera course-up this difference
  // sits at ~0 and the truck points straight UP the road.
  const truckScreenDeg = (navCourseDeg ?? 0) - mapHeading;

  // Parking size for the open truck-stop card (build #19): null
  // unless the stop carries a verified spot count.
  const selectedSize = selected ? parkingSize(selected.spots) : null;

  // Final destination for the winner's flag: the LAST coordinate of
  // the full route. routeCoords is never trimmed (only the rendered
  // line is), so this stays the destination for the route's whole
  // life and empties out when the route is cleared.
  const routeDest =
    routeCoords.length > 1 ? routeCoords[routeCoords.length - 1] : null;
  // When the route was planned to the very place the amber pin marks,
  // the flag replaces the pin instead of stacking on top of it.
  const searchResultIsRouteDest =
    !!routeDest &&
    !!searchResult &&
    Math.abs(searchResult.latitude - routeDest.latitude) < 0.0005 &&
    Math.abs(searchResult.longitude - routeDest.longitude) < 0.0005;

  // Second (check-in) flag visibility: it belongs to the working
  // destination and shows while that destination is on screen —
  // routed (next to the checkered flag) or while the dropped-pin
  // card that set it is open. After a plain route clear with no pin
  // card up, it hides with the rest of the route furniture.
  const checkInFlagUi =
    checkInFlag &&
    destContext &&
    destContextKey !== null &&
    checkInFlag.key === destContextKey &&
    (routeDest !== null || (searchResult?.id.startsWith('pin-') ?? false))
      ? checkInFlag
      : null;
  // The saved check-in for the working destination — drives the
  // pin card's "Set check-in here" / "Clear check-in point" action.
  const savedCheckInForDest = destContext
    ? findCheckIn(
        checkIns,
        destContext.latitude,
        destContext.longitude,
        destContext.name,
      )
    : null;
  // True when the open dropped pin IS (within ~25 m) the saved
  // check-in — the card action then offers to clear it instead of
  // setting it again.
  const pinIsSavedCheckIn =
    !!searchResult &&
    searchResult.id.startsWith('pin-') &&
    savedCheckInForDest !== null &&
    distMi(
      searchResult.latitude,
      searchResult.longitude,
      savedCheckInForDest.latitude,
      savedCheckInForDest.longitude,
    ) *
      1609.34 <
      25;

  // Stops panel (build #18): the ordered stops list with per-stop
  // ETAs, reorder (up/down) and remove controls, the pending
  // candidate row, and the "add a stop" search. Rendered inside the
  // destination card (while building a route) and inside the route
  // chip (once planned) — same controls both places. Per-stop ETAs
  // are cumulative leg summaries from the applied route; they only
  // line up when the leg count matches the stop list exactly.
  const legsLineUp = routeLegs.length === vias.length + 1 && vias.length > 0;
  function stopsPanel() {
    let cumMin = 0;
    let cumMi = 0;
    return (
      <View>
        {vias.length > 0 ? (
          <Text style={styles.stopsHeader}>
            Stops on the way · {vias.length} of {MAX_STOPS}
          </Text>
        ) : null}
        {vias.map((v, i) => {
          let eta: string | null = null;
          if (legsLineUp) {
            cumMin += routeLegs[i].minutes;
            cumMi += routeLegs[i].miles;
            eta = `ETA ≈ ${fmtDur(cumMin)} · ${cumMi.toFixed(0)} mi in`;
          }
          return (
            <View key={stopKey(v)} style={styles.viaRow}>
              <View style={styles.stopNum}>
                <Text style={styles.stopNumText}>{i + 1}</Text>
              </View>
              <View style={styles.stopTextWrap}>
                <Text style={styles.viaText} numberOfLines={1}>
                  {v.name}
                </Text>
                {eta ? <Text style={styles.stopEta}>{eta}</Text> : null}
              </View>
              <Pressable
                onPress={() => moveStop(i, -1)}
                disabled={i === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move stop ${i + 1} up`}
                hitSlop={8}
                style={i === 0 && styles.stopBtnOff}>
                <Ionicons
                  name="chevron-up"
                  size={22}
                  color={i === 0 ? colors.muted : colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => moveStop(i, 1)}
                disabled={i === vias.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move stop ${i + 1} down`}
                hitSlop={8}
                style={i === vias.length - 1 && styles.stopBtnOff}>
                <Ionicons
                  name="chevron-down"
                  size={22}
                  color={i === vias.length - 1 ? colors.muted : colors.text}
                />
              </Pressable>
              <Pressable
                onPress={() => removeStop(i)}
                accessibilityRole="button"
                accessibilityLabel={`Remove stop ${i + 1}: ${v.name}`}
                hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.danger} />
              </Pressable>
            </View>
          );
        })}
        {viaDest ? (
          <View style={styles.viaRow}>
            <Ionicons name="flag-outline" size={18} color={colors.primary} />
            <Text style={styles.viaText} numberOfLines={1}>
              {viaDest.name}
            </Text>
            <Pressable
              onPress={() => {
                const v: ViaPoint = {
                  name: viaDest.name,
                  latitude: viaDest.latitude,
                  longitude: viaDest.longitude,
                };
                if (addStop(v)) {
                  setViaDest(null);
                  setViaQuery('');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Use this as a stop on the way"
              style={({ pressed }) => [
                styles.viaAddButton,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.viaAddText}>Add stop</Text>
            </Pressable>
            <Pressable
              onPress={() => setViaDest(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding a stop"
              hitSlop={10}>
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          </View>
        ) : vias.length >= MAX_STOPS ? (
          <Text style={styles.stopCapText}>
            {MAX_STOPS} stops is the max — remove one to add another.
          </Text>
        ) : (
          <View style={[styles.viaSearchRow, styles.viaSearchRowClear]}>
            <TextInput
              style={styles.viaInput}
              value={viaQuery}
              onChangeText={setViaQuery}
              placeholder="Add a stop on the way (optional)"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              onSubmitEditing={searchViaAddress}
              autoCorrect={false}
              multiline
              blurOnSubmit
              textAlignVertical="center"
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
            />
            <Pressable
              onPress={searchViaAddress}
              accessibilityRole="button"
              accessibilityLabel="Search for the stop address"
              style={({ pressed }) => [
                styles.viaSearchButton,
                pressed && styles.pressed,
              ]}>
              {viaSearching ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Ionicons name="add" size={22} color={colors.text} />
              )}
            </Pressable>
          </View>
        )}
        {stopsMsg ? <Text style={styles.stopCapText}>{stopsMsg}</Text> : null}
      </View>
    );
  }

  if (Platform.OS === 'web' || !MapLibreMap) {
    return (
      <View style={styles.webFallback}>
        <Ionicons name="map-outline" size={64} color={colors.muted} />
        <Text style={styles.webTitle}>Map needs the mobile app</Text>
        <Text style={styles.webText}>
          The live truck stop map runs on iOS and Android. The Truck Stops tab has
          the same {truckStops.length} locations as a searchable list.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* androidView="texture" (build #19): the map renders into
          the activity window's texture instead of an independent
          GLSurfaceView layer, so the picture-in-picture window
          keeps showing (and redrawing) the map after the PiP
          transition — a surface view detaches and freezes there. */}
      <MapLibreMap
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={activeMapStyle}
        logoEnabled={false}
        touchRotate={true}
        androidView="texture"
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionDidChange}
        onLongPress={(event: any) => {
          // MapLibre RN v11: long-press events arrive as
          // NativeSyntheticEvent<PressEvent> — nativeEvent.lngLat is
          // a [longitude, latitude] pair. Drop a pin there (dropPin
          // itself no-ops during live navigation).
          const lngLat = event?.nativeEvent?.lngLat;
          if (!lngLat) return;
          dropPin(lngLat[1], lngLat[0]);
        }}
        onPress={(event: any) => {
          // Tap behavior (Larry): with something selected, a tap just
          // clears it — the long-standing behavior. On a clear map, a
          // tap drops a pin on that spot and opens its destination
          // card, so he can route by touching the map (zoom in, tap
          // the spot). The long-press does the same thing.
          const hadSelection = Boolean(selected || selectedPoi || searchResult);
          setSelected(null);
          setSelectedPoi(null);
          setSearchResult(null);
          // Grabbing the map pauses camera follow during navigation;
          // build #19 re-locks it automatically after ~5 s, and the
          // Follow button on screen turns it back on right away.
          noteNavMapGrabbed();
          if (!hadSelection) {
            const lngLat = event?.nativeEvent?.lngLat;
            if (lngLat) dropPin(lngLat[1], lngLat[0]);
          }
        }}>
        <MLCamera
          ref={cameraRef}
          maxZoom={22}
          initialViewState={{
            center: [INITIAL_CENTER.longitude, INITIAL_CENTER.latitude],
            zoom: 3.5,
          }}
        />
        <MLUserLocation />
        {searchResult && !searchResultIsRouteDest ? (
          <MLMarker
            lngLat={[searchResult.longitude, searchResult.latitude]}
            anchor="bottom">
            <Ionicons name="location" size={44} color={colors.primary} />
          </MLMarker>
        ) : null}
        {navIndex !== null && (displayPos ?? myPos) ? (
          <MLMarker
            key={`nav-truck-${markerEpoch}`}
            lngLat={[
              (displayPos ?? myPos)!.longitude,
              (displayPos ?? myPos)!.latitude,
            ]}
            anchor="center">
            {/* Build #24 (item 4): the cutout heading-locks —
                the spin group rotates by (course − map bearing)
                so the cab leads up-route at any map rotation
                (build #19's never-rotate decision is superseded;
                on satellite at drive-up rotation the un-rotated
                rear view read as a truck lying sideways).
                Build #27: the dark pad and the black silhouette
                halo that sat behind the cutout are GONE, per
                Larry's road test of #26 ("no shadow just truck
                perfectly"), and the marker PNGs are tight-cropped
                to the truck itself — the marker is only the
                truck now, nothing behind or under it. */}
            <View style={styles.navTruckWrap}>
              <View
                style={[
                  styles.navTruckSpin,
                  { transform: [{ rotate: `${truckScreenDeg}deg` }] },
                ]}>
                <Image
                  source={truckMakeImage(navOptions.truckMake)}
                  style={styles.navTruckMarker}
                  resizeMode="contain"
                />
              </View>
            </View>
          </MLMarker>
        ) : null}
        {/* Stops on the way (build #18): every stop keeps the blue
            flag treatment the single via point had. A stop with a
            driver-saved check-in ALSO gets the small amber flag at
            the saved point — check-ins apply per stop the same way
            they apply to a destination. Same anchor discipline as
            the destination's check-in flag: anchor "bottom", the
            stem is the wrap's last, lowest child. */}
        {vias.map((v) => (
          <MLMarker
            key={`via-${stopKey(v)}`}
            lngLat={[v.longitude, v.latitude]}
            anchor="bottom">
            <Ionicons name="flag" size={34} color={colors.info} />
          </MLMarker>
        ))}
        {vias.map((v) => {
          const saved = findCheckIn(checkIns, v.latitude, v.longitude, v.name);
          if (!saved) return null;
          return (
            <MLMarker
              key={`via-checkin-${stopKey(v)}`}
              lngLat={[saved.longitude, saved.latitude]}
              anchor="bottom">
              <View style={styles.checkInFlagWrap}>
                <Text style={styles.checkInFlagGlyph}>⚑</Text>
                <View style={styles.checkInFlagStem} />
              </View>
            </MLMarker>
          );
        })}
        {bundledStopMarkers.map((stop) => {
          // Build #24 (item 13): a branded chain gets its brand
          // badge (Flying J yellow/red FJ, Pilot red P, ...);
          // Independent stops keep the generic badge. The chain
          // comes from the dataset's verified chain field — never
          // inferred from the name or location here.
          const brandBadge =
            stop.chain !== 'Independent' ? CHAIN_BADGES[stop.chain] : undefined;
          return (
            <MLMarker
              key={`stop-${stop.id}`}
              lngLat={[stop.longitude, stop.latitude]}
              anchor="center">
              <Pressable
                onPress={() => {
                  setSelected(stop);
                  setSelectedPoi(null);
                  setSearchResult(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Truck stop: ${stop.name}`}
                style={
                  brandBadge
                    ? styles.poiBadgeClear
                    : [
                        styles.poiBadge,
                        { backgroundColor: poiCategoryMeta('stops').color },
                      ]
                }>
                {brandBadge ? (
                  renderBrandBadge(brandBadge)
                ) : (
                  <MaterialCommunityIcons name="gas-station" size={16} color="#FFFFFF" />
                )}
              </Pressable>
            </MLMarker>
          );
        })}
        {bundledWeighMarkers.map((ws) => (
          <MLMarker
            key={`weigh-${ws.id}`}
            lngLat={[ws.longitude, ws.latitude]}
            anchor="center">
            <Pressable
              onPress={() => {
                setSelected(null);
                setSelectedPoi({
                  id: `bundled-weigh-${ws.id}`,
                  category: 'weigh',
                  name: ws.name,
                  latitude: ws.latitude,
                  longitude: ws.longitude,
                  detail: `${ws.interstate} · Mile ${ws.mileMarker} · ${ws.state}`,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Weigh station: ${ws.name}`}
              style={[
                styles.poiBadge,
                { backgroundColor: poiCategoryMeta('weigh').color },
              ]}>
              <MaterialCommunityIcons name="scale-balance" size={16} color="#FFFFFF" />
            </Pressable>
          </MLMarker>
        ))}
        {osmMarkers.map((poi) => {
          // Build #24 (item 13): branded faces for the categories
          // whose data names a brand — CAT Scale locations (the
          // category itself is the brand, matched in OSM by
          // brand/operator), parking (the blue P), and fuel POIs
          // whose own name names a travel-center chain. Every
          // other category keeps the generic badge.
          const catBadge = poi.category === 'catscale';
          const parkBadge =
            poi.category === 'parking' || poi.category === 'tpc';
          const fuelBadge =
            poi.category === 'fuel' ? chainBadgeForName(poi.name) : null;
          const branded = catBadge || parkBadge || fuelBadge !== null;
          return (
            <MLMarker
              key={poi.id}
              lngLat={[poi.longitude, poi.latitude]}
              anchor="center">
              <Pressable
                onPress={() => {
                  setSelected(null);
                  setSelectedPoi(poi);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${poiCategoryMeta(poi.category).label}: ${poi.name}`}
                style={
                  branded
                    ? styles.poiBadgeClear
                    : [
                        styles.poiBadge,
                        {
                          backgroundColor: poiCategoryMeta(poi.category).color,
                        },
                      ]
                }>
                {catBadge ? (
                  renderCatBadge()
                ) : parkBadge ? (
                  renderParkingBadge()
                ) : fuelBadge ? (
                  renderBrandBadge(fuelBadge)
                ) : (
                  <MaterialCommunityIcons
                    name={poiCategoryMeta(poi.category).icon as any}
                    size={16}
                    color="#FFFFFF"
                  />
                )}
              </Pressable>
            </MLMarker>
          );
        })}
        {routeOptions.length > 1
          ? routeOptions.map((opt, i) =>
              i !== selectedRouteIdx && opt.coords.length > 1 ? (
                <MLGeoJSONSource
                  key={`alt-${i}`}
                  id={`altRoute${i}`}
                  data={{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'LineString',
                      coordinates: opt.coords.map((c) => [c.longitude, c.latitude]),
                    },
                  }}
                  onPress={(event: any) => {
                    // Tapping an alternate line picks it (planning
                    // only — the chips in the route card are the
                    // always-available path). Stop the tap reaching
                    // the map's own onPress, which would clear the
                    // selection or drop a pin on the same spot.
                    event?.stopPropagation?.();
                    if (navIndexRef.current === null) selectRouteOption(i);
                  }}>
                  <MLLayer
                    id={`altRouteLine${i}`}
                    type="line"
                    paint={{
                      'line-color': '#A9C6EA',
                      'line-width': 5,
                      'line-opacity': 0.8,
                    }}
                    layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  />
                  {navIndex === null ? (
                    <MLLayer
                      id={`altRouteHit${i}`}
                      type="line"
                      paint={{
                        'line-color': '#000000',
                        'line-width': 22,
                        'line-opacity': 0,
                      }}
                      layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                    />
                  ) : null}
                </MLGeoJSONSource>
              ) : null,
            )
          : null}
        {routeCoords.length > 1 ? (
          <MLGeoJSONSource
            id="route"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: (remainingCoords && remainingCoords.length > 1
                  ? remainingCoords
                  : routeCoords
                ).map((c) => [c.longitude, c.latitude]),
              },
            }}>
            {/* Build #27 (item 9): the route line goes NEON —
                Larry: "more neon brighter and a little bit wider,
                a little bit thicker", whichever color he picked.
                A wide translucent glow in the lightened color
                rides under a thicker, full-opacity neon core
                (widths now scale with zoom instead of the old
                flat 5). Paired with item 7's muted interstates,
                the route is now unmistakably the loudest line on
                the map. */}
            <MLLayer
              id="routeGlow"
              type="line"
              paint={{
                'line-color': neonColor(navOptions.routeColor),
                'line-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 12,
                  14, 20,
                  17, 30,
                ],
                'line-opacity': 0.32,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <MLLayer
              id="routeLine"
              type="line"
              paint={{
                'line-color': neonColor(navOptions.routeColor),
                'line-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 4.5,
                  14, 7.5,
                  17, 11,
                ],
                'line-opacity': 1,
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </MLGeoJSONSource>
        ) : null}
        {/* Winner's flag on the FINAL destination (Larry, 2026-11-08):
            the checkered flag marks where the driver checks in. It is
            planted at the last coordinate of the full routeCoords —
            the rendered line may trim behind the truck while driving,
            but routeCoords always keeps the destination — so the flag
            tracks every new route and re-aim, shows while browsing
            and while navigating, and clears with the route. Declared
            after the route line and the other markers so it draws on
            top. Via points keep their blue flag.
            ANCHOR INVARIANT (Larry, 2026-11-08 01:34): "The end of
            flag pole is where truck drivers check in" — the BOTTOM
            TIP of the pole is the precise marker point. anchor
            "bottom" pins the child view's bottom-center (x 0.5,
            y 1.0) to routeDest; destFlagWrap centers the stem
            horizontally and the stem is its LAST, lowest child with
            no padding, margin or shadow below it, so the center of
            the pole's bottom tip lands exactly on the destination
            coordinate. Keep it that way: never add anything below
            the stem, never pad the wrap, and keep the flag SMALL
            (Larry reversed the big-flag idea the same night — his
            example was about placement, not size). */}
        {/* Build #27 (item 3): the repeated interstate shields on
            the route ahead of the truck (positions computed in
            the nav loop). Drawn after the route line so they sit
            on top of it; the badge is a plain interstate shield
            face — white, black edge, red crown band. */}
        {routeShields.map((s) => (
          <MLMarker
            key={s.id}
            lngLat={[s.longitude, s.latitude]}
            anchor="center">
            <View style={styles.shieldBadge}>
              <View style={styles.shieldBand} />
              <Text style={styles.shieldText}>{s.label}</Text>
            </View>
          </MLMarker>
        ))}
        {routeDest ? (
          <MLMarker
            lngLat={[routeDest.longitude, routeDest.latitude]}
            anchor="bottom">
            <View style={styles.destFlagWrap}>
              <Text style={styles.destFlagEmoji}>🏁</Text>
              <View style={styles.destFlagStem} />
            </View>
          </MLMarker>
        ) : null}
        {/* Second flag: the driver's own saved check-in point
            (Larry, Nov 8). SMALLER than the winner's flag, same
            minimal no-chip look, distinguished by its amber flag
            glyph alone — no label. (The automatic map-detected
            "Truck entrance" version was removed Nov 8 at Larry's
            call.) Same anchor invariant as the winner's flag:
            anchor "bottom", the stem is the wrap's last and lowest
            child with nothing below it, so the pole tip lands
            exactly on the check-in point. */}
        {checkInFlagUi ? (
          <MLMarker
            lngLat={[checkInFlagUi.longitude, checkInFlagUi.latitude]}
            anchor="bottom">
            <View style={styles.checkInFlagWrap}>
              <Text style={styles.checkInFlagGlyph}>⚑</Text>
              <View style={styles.checkInFlagStem} />
            </View>
          </MLMarker>
        ) : null}
        {navOptions.hazards
          ? hazards.map((hz) => (
              <MLMarker key={hz.id} lngLat={[hz.longitude, hz.latitude]}>
                <View style={styles.hazardPin}>
                  <Text style={styles.hazardPinText}>
                    {HAZARD_ICONS[hz.kind]}
                  </Text>
                </View>
              </MLMarker>
            ))
          : null}
        {/* Low bridges on the active route (build #17): a small red
            clearance badge where the route passes under. Declared
            last so it draws on top of the route line and pins. */}
        {lowBridges.map((b) => (
          <MLMarker
            key={`lb-${b.id}-${b.alongMi.toFixed(2)}`}
            lngLat={[b.longitude, b.latitude]}
            anchor="center">
            <Pressable
              onPress={() =>
                showWeighAlert(`⚠️ Low bridge — ${b.label} clearance`)
              }
              accessibilityRole="button"
              accessibilityLabel={`Low bridge, clearance ${b.label}`}
              style={styles.lowBridgeBadge}>
              <Text style={styles.lowBridgeBadgeText}>⚠ {b.label}</Text>
            </Pressable>
          </MLMarker>
        ))}
      </MapLibreMap>
      {/* Build #21 PiP layout: while the picture-in-picture mini
          window is up, this compact turn banner is the ONLY overlay
          — the map fills the window and every other piece of chrome
          below (search bar, cards, rail, nav strip) is withheld,
          and the tab layout hides its bar/header off the same flag.
          Exiting PiP restores the full layout. */}
      {inPip && navIndex !== null ? (
        <View
          style={styles.pipBanner}
          pointerEvents="none"
          testID="pip-compact-banner">
          {turnDistText ? (
            <Text
              style={styles.pipBannerDist}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              {turnDistText}
            </Text>
          ) : null}
          <Text
            style={styles.pipBannerText}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}>
            {turnNextStep ? turnNextStep.instruction : 'Navigating'}
          </Text>
        </View>
      ) : null}
      {!inPip && (
        <>
      {/* Build #22 (item 1) diagnostic marker: rendered ONLY in the
          PiP overview state, so an exported bundle can be checked
          for the whole-route overview wiring. Invisible in the app. */}
      {pipOverview ? (
        <View testID="pip-route-overview" style={styles.pipDiag} />
      ) : null}
      <Text style={styles.attribution}>
        {mapType === 'standard' ? '© OpenStreetMap contributors' : 'Imagery © Esri'}
      </Text>

      {/* Build #22 (item 3): while navigating, the search/address
          bar steps aside entirely — the turn banner owns the top of
          the screen now. It returns the moment navigation ends or
          the steps panel opens. */}
      {!turnBannerUp ? (
      <View style={styles.searchBar}>
        {routeInfo !== null || navIndex !== null ? (
          // Build #19: with a route up, the box shows the
          // destination's FULL address as a read-only label. The
          // single-line TextInput scrolled long addresses so only
          // the tail ("…venue, Sedalia") stayed visible — the
          // street part was cut off while driving. The label wraps
          // to two lines and shrinks to fit, so nothing clips.
          // Before navigation starts, tapping the label (the ✕)
          // clears the route and brings the search box back; while
          // navigating it is display-only.
          navIndex !== null ? (
            <View style={styles.searchDestBox}>
              <Ionicons name="flag" size={18} color={colors.primary} />
              <Text
                style={styles.searchDestText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                allowFontScaling={false}>
                {destContext?.name?.trim() || query || 'Destination'}
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={clearRoute}
              accessibilityRole="button"
              accessibilityLabel={`Destination: ${
                destContext?.name ?? query
              }. Tap to clear the route and search again.`}
              style={({ pressed }) => [
                styles.searchDestBox,
                pressed && styles.pressed,
              ]}>
              <Ionicons name="flag" size={18} color={colors.primary} />
              <Text
                style={styles.searchDestText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                allowFontScaling={false}>
                {destContext?.name?.trim() || query || 'Destination'}
              </Text>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          )
        ) : (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder={listening ? 'Listening… say a place' : 'Type an address or place'}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            onSubmitEditing={() => void searchAddress()}
            autoCorrect={false}
            multiline
            blurOnSubmit
            textAlignVertical="center"
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
          />
        )}
        <Pressable
          onPress={() => void startVoiceSearch()}
          accessibilityRole="button"
          accessibilityLabel={
            listening
              ? 'Stop listening'
              : 'Search by voice — tap and say a place'
          }
          style={({ pressed }) => [
            styles.micButton,
            listening && styles.micButtonOn,
            pressed && styles.pressed,
          ]}>
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={24}
            color={listening ? '#FFFFFF' : colors.text}
          />
        </Pressable>
        <Pressable
          onPress={() => void searchAddress()}
          accessibilityRole="button"
          accessibilityLabel="Search for the address"
          style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}>
          {searching ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons name="search" size={24} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
      ) : null}

      {/* Build #22 (item 5a): while typing, the suggestion list drops
          below the (possibly two-line) search box instead of sitting
          at its old fixed offset and covering the wrapped text. */}
      {suggestions.length > 0 ? (
        <View
          style={[
            styles.suggestBox,
            query.length > 34 && styles.suggestBoxTall,
          ]}>
          {suggestions.map((place) => (
            <Pressable
              key={place.id}
              onPress={() => applySuggestion(place)}
              accessibilityRole="button"
              accessibilityLabel={`Use address ${place.name}`}
              style={({ pressed }) => [
                styles.suggestRow,
                pressed && styles.pressed,
              ]}>
              <Ionicons name="location-outline" size={20} color={colors.muted} />
              <Text style={styles.suggestText} numberOfLines={2}>
                {place.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Build #19: the always-visible turn banner across the top
          of the map while navigating — next maneuver in big text
          (Valhalla's wording carries the exit numbers), the
          distance to that turn beside it, and the following
          maneuver as a small "Then" line. It replaces nothing: the
          rail card and the steps panel still work as before.
          Build #24: the banner is now a Pressable — tapping it
          speaks the current instruction + the Then maneuver
          (item 9). The main column leads with the current-road
          readout (item 3), the Then line became a compact
          "Then:" + arrow chip (item 10), and a lane strip rides
          under the banner when the next maneuver carries lane
          data (item 1). */}
      {turnBannerUp && turnNextStep ? (
        <Pressable
          style={[styles.turnBanner, { top: bannerTop }]}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            setBannerHeight((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
          }}
          onPress={speakTurnBanner}
          accessibilityRole="button"
          accessibilityLabel="Turn instruction. Tap to hear it spoken out loud.">
          <View style={styles.turnBannerRow}>
            {turnDistText ? (
              <View style={styles.turnBannerDist}>
                <Text
                  style={styles.turnBannerDistText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}>
                  {turnDistText}
                </Text>
                <Text style={styles.turnBannerDistLabel}>TO TURN</Text>
              </View>
            ) : null}
            <View style={styles.turnBannerMain}>
              {currentRoad ? (
                <Text
                  style={styles.turnBannerRoad}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}>
                  On {currentRoad}
                </Text>
              ) : null}
              <Text
                style={styles.turnBannerText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}>
                {turnNextStep.instruction}
              </Text>
              {turnThenStep ? (
                <View style={styles.thenChip}>
                  <Text style={styles.thenChipLabel}>Then:</Text>
                  <Ionicons
                    name={thenArrowName(turnThenStep) as any}
                    size={13}
                    color="#FFFFFF"
                  />
                </View>
              ) : null}
            </View>
          </View>
          {laneStripOn ? (
            <View style={styles.laneStrip}>
              {turnLanes.map((lane, i) => {
                const routeMask = laneRouteMask(lane);
                const lit = (lane.directions & routeMask) !== 0;
                const bit = lit
                  ? laneDirBit(lane.directions & routeMask)
                  : laneDirBit(lane.directions);
                return (
                  <Ionicons
                    key={i}
                    name={laneGlyphName(bit) as any}
                    size={21}
                    color={lit ? '#2E9BFF' : 'rgba(255,255,255,0.35)'}
                  />
                );
              })}
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {!railOpen ? (
        <Pressable
          style={[
            styles.compass,
            // Build #27 (item 4): below the banner's measured
            // bottom edge and below the 60dp locate button.
            turnBannerUp && { top: bannerTop + (bannerHeight || 150) + 76 },
            // Build #27 (item 12): the latched state shows — a
            // lit ring while north-up is locked on.
            northLock && styles.compassLocked,
          ]}
          onPress={toggleNorthLock}
          accessibilityRole="button"
          accessibilityLabel={
            northLock
              ? 'North up is locked on. Tap to return the map to the direction it had before.'
              : 'Tap to lock the map north up. Tap again to go back to the previous direction.'
          }>
          <Text
            style={[
              styles.compassNeedle,
              { transform: [{ rotate: `${-mapHeading}deg` }] },
            ]}>
            ▲
          </Text>
          <Text style={styles.compassLabel}>N</Text>
        </Pressable>
      ) : null}

      {elevationFt !== null ? (
        <Text
          style={[
            styles.elevationText,
            navIndex !== null && { bottom: stepsOpen ? 292 : 168 },
          ]}>
          Elev {elevationFt.toLocaleString('en-US')} ft
        </Text>
      ) : null}

      {/* Build #23 (item 3): the hazard Report button, ON THE MAP
          just below the elevation readout at bottom left (Larry's
          placement). It lived in the tab header until build #22
          hid that header during navigation and took the button
          with it. Tapping opens the kind picker, which stacks
          upward from the button (styles.reportKindStack below).
          When the steps panel is open it hides — the panel owns
          the bottom then. */}
      {navIndex !== null && navOptions.hazards && !stepsOpen ? (
        <View style={styles.reportAnchor}>
          {reportOpen ? (
            <View style={styles.reportKindStack}>
              {HAZARD_KINDS.map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => reportHazard(kind, Date.now())}
                  accessibilityRole="button"
                  accessibilityLabel={`Report: ${HAZARD_LABELS[kind]}`}
                  style={({ pressed }) => [
                    styles.reportKind,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.reportKindIcon}>
                    {HAZARD_ICONS[kind]}
                  </Text>
                  <Text style={styles.reportKindText}>
                    {kind === 'police'
                      ? 'Police'
                      : kind === 'object'
                        ? 'Object'
                        : kind === 'accident'
                          ? 'Accident'
                          : kind === 'vehicle'
                            ? 'Vehicle'
                            : kind === 'construction'
                              ? 'Construction'
                              : 'Hazard'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            onPress={() => setReportOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="Report a road hazard"
            style={({ pressed }) => [
              styles.reportButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.reportKindIcon}>⚠️</Text>
            <Text style={styles.headerReportText}>Report</Text>
          </Pressable>
        </View>
      ) : null}

      {!railOpen ? (
        <Pressable
          onPress={locateMe}
          accessibilityRole="button"
          accessibilityLabel="Center map on my location"
          style={({ pressed }) => [
            styles.locateButton,
            // Build #27 (item 4): hang below the banner's
            // MEASURED bottom edge (150 = pre-layout estimate),
            // never under it.
            turnBannerUp && { top: bannerTop + (bannerHeight || 150) + 8 },
            pressed && styles.pressed,
          ]}>
          {locating ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name="locate-outline" size={28} color={colors.text} />
          )}
        </Pressable>
      ) : null}

      {routeInfo && navIndex === null && !chipHidden ? (
        <View style={styles.routeChip}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.routeChipText}>
              Truck route: {routeInfo.miles.toFixed(1)} mi · ~
              {Math.floor(routeInfo.minutes / 60)} h {routeInfo.minutes % 60} min
            </Text>
            <Text style={styles.routeChipSub}>
              Planned for a {truck.heightFt}&apos;{truck.heightIn}&quot; ·{' '}
              {parseInt(truck.weightLbs || '0', 10).toLocaleString()} lb truck. Always
              obey posted signs.
            </Text>
            {routeOptions[selectedRouteIdx]?.hasToll ? (
              <Text style={styles.routeChipSub}>
                ⚠ This route uses toll roads.
              </Text>
            ) : null}
            {lowBridgeNote ? (
              <Text style={styles.lowBridgeNote}>{lowBridgeNote}</Text>
            ) : null}
            {navIndex === null && navSteps.length > 0 ? (
              <Pressable
                onPress={startNav}
                accessibilityRole="button"
                accessibilityLabel="Start turn by turn navigation"
                style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}>
                <Ionicons name="navigate" size={20} color="#FFFFFF" />
                <Text style={styles.startButtonText}>Start route</Text>
              </Pressable>
            ) : null}
            {navIndex === null && routeOptions.length > 1 ? (
              <View style={styles.routeChoices}>
                {routeOptions.map((opt, i) => (
                  <Pressable
                    key={i}
                    onPress={() => selectRouteOption(i)}
                    accessibilityRole="button"
                    accessibilityLabel={`Route option ${i + 1}: ${opt.miles.toFixed(0)} miles, ${opt.minutes} minutes`}
                    style={[
                      styles.routeChoice,
                      i === selectedRouteIdx && styles.routeChoiceOn,
                    ]}>
                    <Text
                      style={[
                        styles.routeChoiceText,
                        i === selectedRouteIdx && styles.routeChoiceTextOn,
                      ]}>
                      {i === 0 ? 'Best' : 'Alt'} ·{' '}
                      {Math.floor(opt.minutes / 60)}h {opt.minutes % 60}m ·{' '}
                      {opt.miles.toFixed(0)} mi
                      {opt.hasToll ? ' · tolls' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {/* Stops on this route (build #18): list, ETAs, reorder,
                remove, add another — edits replan in place. */}
            {stopsPanel()}
          </View>
          <Pressable
            onPress={() => setChipHidden(true)}
            accessibilityRole="button"
            accessibilityLabel="Hide the route card — the route stays on the map"
            hitSlop={10}
            style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {/* Build #22 (item 2): with the route card hidden, this slim
          pill is the way back — tap it to reopen the card. Its own
          small X is the one deliberate full clear of the route. */}
      {routeInfo && navIndex === null && chipHidden ? (
        <View style={styles.routePill}>
          <Pressable
            onPress={() => setChipHidden(false)}
            accessibilityRole="button"
            accessibilityLabel="Show the route card again"
            style={({ pressed }) => [
              styles.routePillMain,
              pressed && styles.pressed,
            ]}>
            <Ionicons name="navigate" size={16} color={colors.primary} />
            <Text style={styles.routePillText} numberOfLines={1}>
              Route · {routeInfo.miles.toFixed(1)} mi
            </Text>
          </Pressable>
          <Pressable
            onPress={clearRoute}
            accessibilityRole="button"
            accessibilityLabel="Clear the truck route"
            hitSlop={8}
            style={styles.routePillClose}>
            <Ionicons name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {truckOpen ? (
        <View style={[styles.savedPanel, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName}>My Truck</Text>
            <Pressable
              onPress={() => setTruckOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close truck profile"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={styles.truckHint}>
            Truck routes avoid roads your rig can&apos;t legally or safely use — low
            bridges, weight limits, truck bans — based on your numbers here.
          </Text>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Height</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.heightFt}
              onChangeText={(v) => persistTruck({ ...truck, heightFt: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck height, feet"
            />
            <Text style={styles.truckUnit}>ft</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.heightIn}
              onChangeText={(v) => persistTruck({ ...truck, heightIn: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck height, inches"
            />
            <Text style={styles.truckUnit}>in</Text>
          </View>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Weight</Text>
            <TextInput
              style={[styles.truckInput, styles.truckInputWide]}
              value={truck.weightLbs}
              onChangeText={(v) => persistTruck({ ...truck, weightLbs: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck weight in pounds"
            />
            <Text style={styles.truckUnit}>lbs</Text>
          </View>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Length</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.lengthFt}
              onChangeText={(v) => persistTruck({ ...truck, lengthFt: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck overall length, feet"
            />
            <Text style={styles.truckUnit}>ft</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.lengthIn}
              onChangeText={(v) => persistTruck({ ...truck, lengthIn: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck overall length, inches"
            />
            <Text style={styles.truckUnit}>in</Text>
          </View>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Width</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.widthFt}
              onChangeText={(v) => persistTruck({ ...truck, widthFt: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck width, feet"
            />
            <Text style={styles.truckUnit}>ft</Text>
            <TextInput
              style={styles.truckInput}
              value={truck.widthIn}
              onChangeText={(v) => persistTruck({ ...truck, widthIn: v })}
              keyboardType="number-pad"
              accessibilityLabel="Truck width, inches"
            />
            <Text style={styles.truckUnit}>in</Text>
          </View>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Hazmat</Text>
            <Pressable
              onPress={() => persistTruck({ ...truck, hazmat: !truck.hazmat })}
              accessibilityRole="button"
              accessibilityLabel="Toggle hazmat load"
              style={[styles.hazmatToggle, truck.hazmat && styles.hazmatToggleOn]}>
              <Text style={styles.hazmatText}>{truck.hazmat ? 'YES' : 'NO'}</Text>
            </Pressable>
          </View>
          <Text style={styles.truckHint}>
            Saved on this phone. Routing data comes from OpenStreetMap — a planning
            aid, never a replacement for posted signs or your motor carrier atlas.
          </Text>
        </View>
      ) : null}

      {routeOpen && routeSettings ? (
        <View style={[styles.savedPanel, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName}>Route settings</Text>
            <Pressable
              onPress={() => setRouteOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close route settings"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={styles.truckHint}>
            These apply to the next truck route you plan.
          </Text>
          <View style={styles.truckRow}>
            <Text style={styles.truckLabel}>Route type</Text>
            <View style={styles.segRow}>
              {(['fastest', 'shortest'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => persistRouteSettings({ ...routeSettings, routeType: t })}
                  accessibilityRole="button"
                  accessibilityLabel={`Route type: ${t}`}
                  style={[
                    styles.segButton,
                    routeSettings.routeType === t && styles.segButtonOn,
                  ]}>
                  <Text
                    style={[
                      styles.segText,
                      routeSettings.routeType === t && styles.segTextOn,
                    ]}>
                    {t === 'fastest' ? 'Fastest' : 'Shortest'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {(
            [
              ['avoidTolls', 'Avoid tolls'],
              ['avoidHighways', 'Avoid highways'],
              ['avoidFerries', 'Avoid ferries'],
            ] as const
          ).map(([key, label]) => (
            <View key={key} style={styles.truckRow}>
              <Text style={styles.truckLabel}>{label}</Text>
              <Pressable
                onPress={() =>
                  persistRouteSettings({ ...routeSettings, [key]: !routeSettings[key] })
                }
                accessibilityRole="button"
                accessibilityLabel={`Toggle ${label.toLowerCase()}`}
                style={[
                  styles.hazmatToggle,
                  routeSettings[key] && styles.hazmatToggleOn,
                ]}>
                <Text style={styles.hazmatText}>{routeSettings[key] ? 'ON' : 'OFF'}</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.truckHint}>
            Avoiding highways or ferries can add a lot of miles — the router does
            its best, and posted signs still win.
          </Text>
        </View>
      ) : null}

      {poiOpen && poiLayers ? (
        <View style={[styles.savedPanel, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName}>Places on the map</Text>
            <Pressable
              onPress={() => setPoiOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close places panel"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={styles.truckHint}>
            Map data categories load for the region on screen — pan
            anywhere in the USA — and along your planned route.
            Truck Parking Club shows only their sites that appear in
            OpenStreetMap — not their full list.
          </Text>
          <ScrollView style={styles.poiList}>
            {POI_CATEGORIES.map((meta) => (
              <View key={meta.key}>
                <View style={styles.truckRow}>
                  <View style={[styles.poiDot, { backgroundColor: meta.color }]} />
                  <Text style={styles.poiLabel}>
                    {meta.label}
                    {poiLoading === meta.key
                      ? ' — loading…'
                      : poiError[meta.key]
                        ? " — couldn't load"
                        : meta.source === 'osm' && osmPois[meta.key]
                          ? ` — ${osmPois[meta.key]?.length ?? 0} found`
                          : ''}
                  </Text>
                  <Pressable
                    onPress={() => togglePoiCategory(meta.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle ${meta.label} on the map`}
                    style={[
                      styles.hazmatToggle,
                      poiLayers[meta.key] && styles.hazmatToggleOn,
                    ]}>
                    <Text style={styles.hazmatText}>
                      {poiLayers[meta.key] ? 'ON' : 'OFF'}
                    </Text>
                  </Pressable>
                </View>
                {/* Build #24 (item 8): a failed layer says so in a
                    full readable line under its row — the actual
                    reason, wrapped, never a truncated fragment. */}
                {poiError[meta.key] ? (
                  <Text style={styles.poiErrorText}>
                    {meta.label} didn’t load — {poiError[meta.key]}. Turn
                    the layer off and on to try again.
                  </Text>
                ) : null}
              </View>
            ))}
            <View style={styles.truckRow}>
              <Text style={styles.poiLabel}>Along my route only</Text>
              <Pressable
                onPress={() => setPoiAlongRoute(!poiAlongRoute)}
                accessibilityRole="button"
                accessibilityLabel="Only show places along the planned route"
                style={[
                  styles.hazmatToggle,
                  poiAlongRoute && styles.hazmatToggleOn,
                ]}>
                <Text style={styles.hazmatText}>{poiAlongRoute ? 'ON' : 'OFF'}</Text>
              </Pressable>
            </View>
          </ScrollView>
          <Pressable
            onPress={refreshOsmLayers}
            accessibilityRole="button"
            accessibilityLabel="Reload map places around my current position"
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
            <Ionicons name="refresh" size={20} color={colors.text} />
            <Text style={styles.saveButtonText}>Reload around me</Text>
          </Pressable>
        </View>
      ) : null}

      {poiPickerOpen && poiLayers ? (
        <View style={[styles.savedPanel, styles.poiPickerPanel, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName}>Points of interest</Text>
            <Pressable
              onPress={() => setPoiPickerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close points of interest"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <View style={styles.poiGrid}>
            {POI_PICKER.map((entry) => {
              const meta = poiCategoryMeta(entry.category);
              // Build #24 (item 8): a tile is "active" when its
              // layer is ON in the shared prefs — several can be
              // active at once.
              const active = !!poiLayers[entry.category];
              const status =
                poiLoading === entry.category
                  ? 'loading…'
                  : poiError[entry.category]
                    ? "couldn't load — tap tile to retry"
                    : meta.source === 'osm' && osmPois[entry.category]
                      ? `${osmPois[entry.category]?.length ?? 0} found`
                      : '';
              return (
                <Pressable
                  key={entry.category}
                  onPress={() => {
                    // An ON category whose load failed: the tile
                    // retries the load instead of toggling off —
                    // the tile text says exactly that.
                    if (active && poiError[entry.category]) {
                      retryPoiLoad(entry.category);
                    } else {
                      pickPoiCategory(entry.category);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${active ? 'Hide' : 'Show'} ${entry.label} on the map`}
                  style={({ pressed }) => [
                    styles.poiTile,
                    active && styles.poiTileActive,
                    pressed && styles.pressed,
                  ]}>
                  <View
                    style={[
                      styles.poiTileIcon,
                      { backgroundColor: meta.color },
                    ]}>
                    <MaterialCommunityIcons
                      name={meta.icon as any}
                      size={26}
                      color="#FFFFFF"
                    />
                  </View>
                  <Text style={styles.poiTileLabel} numberOfLines={2}>
                    {entry.label}
                  </Text>
                  {/* Build #24 (item 8): status gets TWO lines and
                      the failure text is a complete phrase — in
                      #23 it was clipped to a red "couldn't …"
                      fragment under the tile icon. */}
                  <Text
                    style={[
                      styles.poiTileStatus,
                      poiError[entry.category]
                        ? styles.poiTileStatusError
                        : null,
                    ]}
                    numberOfLines={2}>
                    {status}
                  </Text>
                  {active ? (
                    <View style={styles.poiTileCheck}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {POI_CATEGORIES.some((meta) => poiLayers[meta.key]) ? (
            <Pressable
              onPress={() => {
                clearAllPoiCategories();
                setPoiPickerOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear all points of interest from the map"
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.pressed,
              ]}>
              <Ionicons name="close-circle-outline" size={20} color={colors.text} />
              <Text style={styles.saveButtonText}>Clear all from map</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {locationError ? (
        <View style={styles.errorToast}>
          <Text style={styles.errorText} allowFontScaling={false}>
            {locationError}
          </Text>
        </View>
      ) : null}

      {weighAlert ? (
        <View
          style={[
            styles.weighBanner,
            // Build #27 (item 4): below the banner AND the two
            // circular buttons that now hang under it.
            turnBannerUp && { top: bannerTop + (bannerHeight || 150) + 136 },
          ]}>
          <Text style={styles.weighBannerText}>{weighAlert}</Text>
        </View>
      ) : null}

      {searchResult ? (
        <View style={[styles.card, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName}>{searchResult.name}</Text>
              <Text style={styles.cardRoute}>
                {searchResult.id.startsWith('pin-')
                  ? `Dropped pin · ${searchResult.latitude.toFixed(5)}, ${searchResult.longitude.toFixed(5)}`
                  : 'Address found'}
              </Text>
            </View>
            <Pressable
              onPress={() =>
                setDestCardExpandedId(
                  destCardExpanded ? null : searchResult.id,
                )
              }
              accessibilityRole="button"
              accessibilityLabel={
                destCardExpanded
                  ? 'Make the destination card smaller'
                  : 'Show all destination options'
              }
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons
                name={destCardExpanded ? 'chevron-down' : 'chevron-up'}
                size={24}
                color={colors.muted}
              />
            </Pressable>
            <Pressable
              onPress={() => setSearchResult(null)}
              accessibilityRole="button"
              accessibilityLabel="Close address details"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          {/* Build #24 (item 12): the primary actions are always
              visible in the compact card — Truck route and Start
              route side by side. Everything else (Ground view,
              Save, Add stop, Set as home, check-in, the stops
              panel) lives in the expanded state behind the
              header chevron, so the map stays visible by default. */}
          <View style={styles.destPrimaryRow}>
            <Pressable
              onPress={() =>
                truckRouteTo(
                  searchResult.latitude,
                  searchResult.longitude,
                  searchResult.name,
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Plan a truck-safe route to ${searchResult.name}`}
              style={({ pressed }) => [
                styles.directions,
                styles.destPrimaryBtn,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.directionsText}>
                {routing ? 'Routing…' : 'Truck route'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                truckRouteTo(
                  searchResult.latitude,
                  searchResult.longitude,
                  searchResult.name,
                  true,
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Start navigation now to ${searchResult.name}`}
              style={({ pressed }) => [
                styles.startNowButton,
                styles.destPrimaryStart,
                pressed && styles.pressed,
              ]}>
              <Ionicons name="navigate" size={20} color="#FFFFFF" />
              <Text style={styles.startButtonText}>
                {routing ? 'Starting…' : 'Start route'}
              </Text>
            </Pressable>
          </View>
          {destCardExpanded ? (
            <>
          <GroundViewLink
            latitude={searchResult.latitude}
            longitude={searchResult.longitude}
          />
          <View style={styles.cardFooter}>
            <Pressable
              onPress={() => savePlace(searchResult)}
              disabled={isSaved(searchResult)}
              accessibilityRole="button"
              accessibilityLabel={`Save ${searchResult.name}`}
              style={({ pressed }) => [
                styles.saveButton,
                isSaved(searchResult) && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name={isSaved(searchResult) ? 'bookmark' : 'bookmark-outline'}
                size={20}
                color={colors.text}
              />
              <Text style={styles.saveButtonText}>
                {isSaved(searchResult) ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                // Adding the place the route already ends at as a
                // stop on the way makes no sense — say so instead.
                if (
                  routeDestRef.current &&
                  distMi(
                    searchResult.latitude,
                    searchResult.longitude,
                    routeDestRef.current.latitude,
                    routeDestRef.current.longitude,
                  ) < 0.05
                ) {
                  setStopsMsg("That's your destination already.");
                  return;
                }
                addStop({
                  name: searchResult.name,
                  latitude: searchResult.latitude,
                  longitude: searchResult.longitude,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${searchResult.name} as a stop on the way`}
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={styles.saveButtonText}>Add stop</Text>
            </Pressable>
          </View>
          {/* Set home (build #21): saves this place as Larry's home
              for the "Route home" launcher shortcut — on-device
              only, never sent anywhere. If this place IS the saved
              home, the row offers to clear it instead. */}
          {(() => {
            const isHome = isSameHome(
              homePlace,
              searchResult.latitude,
              searchResult.longitude,
            );
            return (
              <Pressable
                onPress={() =>
                  isHome ? clearHomePlace() : setHomeFromPlace(searchResult)
                }
                accessibilityRole="button"
                accessibilityLabel={
                  isHome
                    ? 'This place is your saved home. Tap to clear it.'
                    : 'Set this place as home for the Route home button'
                }
                style={({ pressed }) => [
                  styles.checkInRow,
                  pressed && styles.pressed,
                ]}>
                <Ionicons
                  name={isHome ? 'home' : 'home-outline'}
                  size={20}
                  color={isHome ? colors.danger : colors.primary}
                />
                <View style={styles.checkInRowTextWrap}>
                  <Text style={styles.checkInRowTitle}>
                    {isHome ? 'Home — saved here' : 'Set as home'}
                  </Text>
                  <Text style={styles.checkInRowSub} numberOfLines={1}>
                    {isHome
                      ? 'This place is your saved home — tap to clear it'
                      : homePlace
                        ? 'Move your saved home to this place'
                        : 'For the Route home button — stays on your phone'}
                  </Text>
                </View>
              </Pressable>
            );
          })()}
          {/* Check-in marking (Larry, Nov 8): with a destination in
              play, a dropped pin can be saved as that destination's
              check-in point — where drivers actually check in, as
              opposed to the address point. The main way in is the
              long-press: dropping the pin cleared the route, and
              this card is where the spot gets claimed for the
              destination it belongs to. */}
          {searchResult.id.startsWith('pin-') && destContext ? (
            <Pressable
              onPress={() =>
                pinIsSavedCheckIn
                  ? clearCheckInForDest()
                  : setCheckInFromPin(searchResult)
              }
              accessibilityRole="button"
              accessibilityLabel={
                pinIsSavedCheckIn
                  ? `Clear the saved check-in point for ${destContext.name ?? 'this destination'}`
                  : `Set this spot as the check-in point for ${destContext.name ?? 'this destination'}`
              }
              style={({ pressed }) => [
                styles.checkInRow,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name={pinIsSavedCheckIn ? 'flag' : 'flag-outline'}
                size={20}
                color={pinIsSavedCheckIn ? colors.danger : colors.primary}
              />
              <View style={styles.checkInRowTextWrap}>
                <Text style={styles.checkInRowTitle}>
                  {pinIsSavedCheckIn
                    ? 'Clear check-in point'
                    : savedCheckInForDest
                      ? 'Move check-in point here'
                      : 'Set check-in here'}
                </Text>
                <Text style={styles.checkInRowSub} numberOfLines={1}>
                  {pinIsSavedCheckIn
                    ? `This spot is the check-in for ${destContext.name ?? 'this destination'}`
                    : savedCheckInForDest
                      ? `Check-in for ${destContext.name ?? 'this destination'} is saved — tap to move it`
                      : `Mark where drivers check in for ${destContext.name ?? 'this destination'}`}
                </Text>
              </View>
            </Pressable>
          ) : null}
          {/* Multi-stop panel (build #18): the stops list, ETAs,
              reorder/remove, and the add-a-stop search. Build #24
              (item 12): inside the expanded state with the rest of
              the secondary options. */}
          {stopsPanel()}
            </>
          ) : null}
        </View>
      ) : null}

      {savedOpen ? (
        <View style={[styles.savedPanel, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName}>Saved places</Text>
            <Pressable
              onPress={() => setSavedOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close saved places"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          {savedPlaces.length === 0 ? (
            <Text style={styles.savedEmpty}>
              No saved places yet. Search an address above and tap Save.
            </Text>
          ) : (
            <ScrollView style={styles.savedList}>
              {savedPlaces.map((place) => (
                <View key={place.id} style={styles.savedRow}>
                  <Pressable
                    onPress={() => openSaved(place)}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to ${place.name}`}
                    style={styles.savedRowMain}>
                    <Ionicons name="bookmark" size={18} color={colors.primary} />
                    <Text style={styles.savedRowText} numberOfLines={2}>
                      {place.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => deletePlace(place.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${place.name}`}
                    hitSlop={10}
                    style={styles.closeButton}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {/* While navigating, the bottom of the map is just a slim stats
          strip: speed + the tappable miles/ETA readout at half size.
          The turn instruction itself rides in the persistent banner
          at the TOP of the map (build #19); the Steps / End buttons
          live in the amber tools button's pop-up (see the rail
          below), whose card still mirrors the current step. */}
      {navIndex !== null && navSteps[navIndex] && !stepsOpen ? (
        <View style={styles.navStrip}>
          <View style={styles.stripStats}>
            {/* Build #19, final placement per Larry (2:10 PM, from
                his SmartTruckRoute photo): the direction-of-travel
                readout sits at the LEFT end of this bottom nav bar —
                compass icon + cardinal letter + degrees — exactly
                where the reference app's bottom bar shows its "W".
                Always visible while navigating; driven by the same
                smoothed GPS course that turns the camera. Before
                the first rolling fix it honestly shows no course. */}
            <View
              style={styles.driveStat}
              accessibilityLabel={
                headingCardinal && navCourseDeg !== null
                  ? `Traveling ${headingCardinal}, ${navCourseDeg} degrees`
                  : 'Direction of travel not available yet'
              }>
              <View style={styles.headingStatTop}>
                <Ionicons name="compass" size={20} color={colors.primary} />
                <Text style={styles.navStripValue} numberOfLines={1}>
                  {headingCardinal ?? '—'}
                </Text>
              </View>
              <Text style={styles.navStripLabel} numberOfLines={1}>
                {navCourseDeg !== null ? `${navCourseDeg}° HDG` : 'HDG'}
              </Text>
            </View>
            <View style={styles.driveStat}>
              <Text
                style={styles.navStripValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}>
                {speedMph !== null ? speedMph : '–'}
              </Text>
              <Text style={styles.navStripLabel} numberOfLines={1}>
                MPH
              </Text>
            </View>
            {/* Build #27 (item 11): the badge NEVER leaves the
                strip. When the road under the truck has no posted
                limit in the data (his I-72 stretch), it holds its
                place showing LIMIT / — instead of silently
                vanishing like a glitch. The overspeed alert still
                only fires on a real number — unknown never
                guesses. */}
            <View
              style={styles.speedLimitBadgeSlim}
              accessibilityLabel={
                speedLimitMph !== null
                  ? `Posted speed limit ${speedLimitMph} miles per hour`
                  : 'Speed limit unknown for this road'
              }>
              <Text style={styles.speedLimitLabelSlim}>LIMIT</Text>
              <Text style={styles.speedLimitValueSlim}>
                {speedLimitMph !== null ? speedLimitMph : '—'}
              </Text>
            </View>
            {navOptions.weather && weatherNow ? (
              <View style={styles.driveStat}>
                <Text
                  style={styles.navStripValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {weatherNow.tempF}°
                </Text>
                <Text style={styles.navStripLabel} numberOfLines={1}>
                  {weatherNow.label.toUpperCase()}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={cycleStripStat}
              accessibilityRole="button"
              accessibilityLabel={
                stripStat === 'miles'
                  ? 'Miles left to the destination. Tap to show the driving time left.'
                  : 'Driving time left. Tap to show miles left.'
              }
              style={({ pressed }) => [styles.stripStatTapSlim, pressed && styles.pressed]}>
              <Text
                style={styles.navStripValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}>
                {!navRemain
                  ? '–'
                  : stripStat === 'miles'
                    ? navRemain.miles < 0.1
                      ? `${Math.max(0, Math.round(navRemain.miles * 5280))}`
                      : `${navRemain.miles.toFixed(1)}`
                    : navRemain.minutes >= 60
                      ? `${Math.floor(navRemain.minutes / 60)}h ${navRemain.minutes % 60}m`
                      : `${navRemain.minutes} min`}
              </Text>
              <Text style={styles.navStripLabel} numberOfLines={1}>
                {stripStat === 'miles'
                  ? navRemain && navRemain.miles < 0.1
                    ? 'FT LEFT'
                    : 'MI LEFT'
                  : 'TIME LEFT'}
              </Text>
            </Pressable>
            {/* Build #27 (item 5): the arrival clock gets its OWN
                cell at the right end of the strip, always on, in
                the big readout size — in the old cycle cell the
                full "8:05 AM CST" string shrank and clipped
                ("ARRI…") on Larry's phone. The zone abbreviation
                rides in the label so the clock itself never has
                to shrink. */}
            <View
              style={styles.driveStat}
              accessibilityLabel={
                navRemain
                  ? `Arrival time ${navRemain.arriveLabel}`
                  : 'Arrival time not available yet'
              }>
              <Text
                style={styles.navStripArrivalValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}>
                {navRemain ? navRemain.arriveShort : '–'}
              </Text>
              <Text style={styles.navStripLabel} numberOfLines={1}>
                {navRemain && navRemain.arriveZone
                  ? `ARRIVAL ${navRemain.arriveZone}`
                  : 'ARRIVAL'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {navIndex !== null && !navFollow ? (
        <Pressable
          onPress={() => {
            setFollow(true);
            if (myPos) flyTo(myPos.latitude, myPos.longitude, 0.005);
          }}
          accessibilityRole="button"
          accessibilityLabel="Re-center the map on my truck and follow it"
          style={({ pressed }) => [
            styles.followButton,
            // Build #27 (item 4): same measured clearance as the
            // circular buttons.
            turnBannerUp && { top: bannerTop + (bannerHeight || 150) + 8 },
            pressed && styles.pressed,
          ]}>
          <Ionicons name="locate" size={20} color={colors.primary} />
          <Text style={styles.followButtonText}>Follow</Text>
        </Pressable>
      ) : null}

      {navIndex !== null && navSteps[navIndex] && stepsOpen ? (
        <View style={styles.navPanel}>
          <Text style={styles.navStepCount} numberOfLines={1} adjustsFontSizeToFit>
            Step {navIndex + 1} of {navSteps.length}
            {navDistMi !== null && navIndex < navSteps.length - 1
              ? ` · turn in ${
                  navDistMi < 0.1
                    ? `${Math.max(10, Math.round((navDistMi * 5280) / 10) * 10)} ft`
                    : `${navDistMi.toFixed(1)} mi`
                }`
              : ''}
          </Text>
          <Text style={styles.navInstruction}>{navSteps[navIndex].instruction}</Text>
          {renderDriveStats()}
          <View style={styles.navButtons}>
            <Pressable
              onPress={() => setNavIndex(Math.max(0, navIndex - 1))}
              disabled={navIndex === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous step"
              style={({ pressed }) => [
                styles.navButton,
                navIndex === 0 && styles.saveButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.saveButtonText}>← Back</Text>
            </Pressable>
            <Pressable
              onPress={() => setStepsOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Back to the map navigation view"
              style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}>
              <Text style={styles.saveButtonText}>Map</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                navIndex >= navSteps.length - 1 ? stopNav() : setNavIndex(navIndex + 1)
              }
              accessibilityRole="button"
              accessibilityLabel={
                navIndex >= navSteps.length - 1 ? 'End navigation' : 'Next step'
              }
              style={({ pressed }) => [
                styles.directions,
                styles.navNextButton,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.directionsText}>
                {navIndex >= navSteps.length - 1 ? 'End' : 'Next →'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {selectedPoi ? (
        <View style={[styles.card, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName}>{selectedPoi.name}</Text>
              <Text style={styles.cardRoute}>
                {poiCategoryMeta(selectedPoi.category).label}
                {selectedPoi.detail ? ` · ${selectedPoi.detail}` : ''}
                {myPos
                  ? ` · ${distMi(myPos.latitude, myPos.longitude, selectedPoi.latitude, selectedPoi.longitude).toFixed(1)} mi away`
                  : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelectedPoi(null)}
              accessibilityRole="button"
              accessibilityLabel="Close place details"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <GroundViewLink
            latitude={selectedPoi.latitude}
            longitude={selectedPoi.longitude}
          />
          <View style={styles.cardFooter}>
            <Pressable
              onPress={() => {
                setSelectedPoi(null);
                truckRouteTo(selectedPoi.latitude, selectedPoi.longitude, selectedPoi.name);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Plan a truck-safe route to ${selectedPoi.name}`}
              style={({ pressed }) => [styles.directions, pressed && styles.pressed]}>
              <Text style={styles.directionsText}>
                {routing ? 'Routing…' : 'Truck route'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                addStop({
                  name: selectedPoi.name,
                  latitude: selectedPoi.latitude,
                  longitude: selectedPoi.longitude,
                });
                setSelectedPoi(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${selectedPoi.name} as a stop on the way`}
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={styles.saveButtonText}>Add stop</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              const target = selectedPoi;
              setSelectedPoi(null);
              truckRouteTo(target.latitude, target.longitude, target.name, true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Start navigation now to ${selectedPoi.name}`}
            style={({ pressed }) => [styles.startNowButton, pressed && styles.pressed]}>
            <Ionicons name="navigate" size={20} color="#FFFFFF" />
            <Text style={styles.startButtonText}>
              {routing ? 'Starting…' : 'Start route'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {selected ? (
        <View style={[styles.card, bottomPanelLift]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName}>{selected.name}</Text>
              <Text style={styles.cardRoute}>
                {selected.chain} · {selected.interstate} {selected.exit} ·{' '}
                {selected.city}, {selected.state}
              </Text>
              {selectedSize ? (
                <View style={styles.cardSizeRow}>
                  <View style={styles.sizeBadge}>
                    <Text style={styles.sizeBadgeText}>
                      {selectedSize.letter} · {selected.spots} spots
                    </Text>
                  </View>
                  <Text style={styles.cardSizeLabel}>parking size (OSM)</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              accessibilityLabel="Close stop details"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <GroundViewLink
            latitude={selected.latitude}
            longitude={selected.longitude}
          />
          <AmenityChips amenities={selected.amenities} />
          <Text style={styles.phone}>{selected.phone}</Text>
          <View style={styles.cardFooter}>
            <Pressable
              onPress={() =>
                truckRouteTo(selected.latitude, selected.longitude, selected.name)
              }
              accessibilityRole="button"
              accessibilityLabel={`Plan a truck-safe route to ${selected.name}`}
              style={({ pressed }) => [styles.directions, pressed && styles.pressed]}>
              <Text style={styles.directionsText}>
                {routing ? 'Routing…' : 'Truck route'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                addStop({
                  name: selected.name,
                  latitude: selected.latitude,
                  longitude: selected.longitude,
                });
                setSelected(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${selected.name} as a stop on the way`}
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={styles.saveButtonText}>Add stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {/* Build #24 (item 8): the old single-pick POI chip is gone
          with the single-pick model itself — with several
          categories on at once, one pill naming one category
          would lie about the map state. Category status lives in
          the picker tiles and the Places panel rows. */}
      {/* Tool rail: one floating button, bottom-right. Collapsed by
          default so the old right-side pill stack never covers the map;
          tapping it stacks the same actions up as small pills, and
          tapping any action (or the button again) collapses it. While
          navigating it floats above the slim nav strip / steps panel,
          and the pop-up leads with the current turn instruction plus
          the Steps and End actions (they used to live on the map).
          The rail is bottom-anchored, so an unclamped tall rail grows
          up into the search bar and the floating compass/locate
          buttons: the scroll viewport below is clamped so the open
          rail's top always stays clear of that top chrome, the
          compass/locate buttons hide while the rail is open, and the
          scroll content carries bottom padding so the last pill can
          scroll fully clear of this toggle. */}
      <View
        style={[
          styles.railWrap,
          {
            bottom:
              navIndex !== null ? (stepsOpen ? 232 : 76) : spacing.md,
          },
        ]}>
        {railOpen ? (
          <ScrollView
            style={[
              styles.railScroll,
              {
                // Clamp: windowHeight minus the rail's bottom offset,
                // minus ~60 for this toggle + gap, minus ~320 reserved
                // at the top for the status bar, tab header, search bar
                // and the floating compass/locate zone, so the open
                // rail (turn card first) never reaches the search bar.
                maxHeight: Math.max(
                  220,
                  windowHeight -
                    (navIndex !== null ? (stepsOpen ? 232 : 76) : spacing.md) -
                    380,
                ),
              },
            ]}
            contentContainerStyle={styles.railScrollContent}
            showsVerticalScrollIndicator={false}>
            {navIndex !== null && navSteps[navIndex] && !stepsOpen ? (
              <>
                <View style={styles.railNavCard}>
                  <Text style={styles.railNavInstruction} numberOfLines={2}>
                    {navSteps[navIndex].instruction}
                  </Text>
                  <Text style={styles.navBannerSub} numberOfLines={1}>
                    Step {navIndex + 1} of {navSteps.length}
                    {navDistMi !== null && navIndex < navSteps.length - 1
                      ? ` · turn in ${
                          navDistMi < 0.1
                            ? `${Math.max(10, Math.round((navDistMi * 5280) / 10) * 10)} ft`
                            : `${navDistMi.toFixed(1)} mi`
                        }`
                      : ''}
                  </Text>
                </View>

                <Pressable
                  onPress={() => {
                    setRailOpen(false);
                    setStepsOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Show the full list of direction steps"
                  style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
                  <Ionicons name="list-outline" size={18} color={colors.text} />
                  <Text style={styles.railPillText}>Steps</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setRailOpen(false);
                    stopNav();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="End navigation"
                  style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
                  <Ionicons
                    name="close-circle-outline"
                    size={18}
                    color={colors.danger}
                  />
                  <Text style={[styles.railPillText, { color: colors.danger }]}>
                    End
                  </Text>
                </Pressable>
              </>
            ) : null}

            <Pressable
              onPress={() => {
                setRailOpen(false);
                setMapType(mapType === 'standard' ? 'hybrid' : 'standard');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                mapType === 'standard'
                  ? 'Switch to satellite view'
                  : 'Switch to map view'
              }
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons
                name={mapType === 'standard' ? 'earth-outline' : 'map-outline'}
                size={18}
                color={colors.text}
              />
              <Text style={styles.railPillText}>
                {mapType === 'standard' ? 'Satellite' : 'Map'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                setSavedOpen(!savedOpen);
                setSelected(null);
                setSearchResult(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Show my saved places"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="bookmark-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>Saved ({savedPlaces.length})</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                setTruckOpen(!truckOpen);
                setSavedOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Set up my truck profile for truck routing"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="bus-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>My Truck</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                toggleTrip();
              }}
              accessibilityRole="button"
              accessibilityLabel={
                trip
                  ? `End IFTA trip, currently ${trip.totalMiles.toFixed(1)} miles`
                  : 'Start IFTA trip logging'
              }
              style={({ pressed }) => [
                styles.railPill,
                trip && styles.tripButtonOn,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name={trip ? 'stop-circle-outline' : 'play-circle-outline'}
                size={18}
                color={trip ? '#FFFFFF' : colors.text}
              />
              <Text style={[styles.railPillText, trip && styles.tripButtonTextOn]}>
                {trip ? `Trip ${trip.totalMiles.toFixed(1)} mi` : 'Start trip'}
              </Text>
            </Pressable>

            <View style={styles.railPill}>
              <Ionicons name="speedometer-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>
                Odometer {odoMi.toFixed(1)} mi
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                resetOdometerPressed();
              }}
              accessibilityRole="button"
              accessibilityLabel="Reset the miles-driven odometer back to zero"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="refresh-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>Reset odometer</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                setRouteOpen(!routeOpen);
                setTruckOpen(false);
                setSavedOpen(false);
                setPoiOpen(false);
                setPoiPickerOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Route settings: fastest or shortest, tolls, highways, ferries"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="options-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>Route</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                const opening = !poiOpen;
                setPoiOpen(opening);
                setTruckOpen(false);
                setSavedOpen(false);
                setRouteOpen(false);
                // Layers left on from a previous session fetch fresh data the
                // first time the panel opens.
                if (opening && poiLayers) {
                  void (async () => {
                    const focus = await resolvePoiFocus();
                    for (const meta of POI_CATEGORIES) {
                      if (
                        meta.source === 'osm' &&
                        poiLayers[meta.key] &&
                        osmNeedsLoad(meta.key, focus)
                      ) {
                        await loadOsmCategory(meta.key, { focus });
                      }
                    }
                  })();
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Choose which places show on the map"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="location-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>Places</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRailOpen(false);
                setPoiPickerOpen(true);
                setPoiOpen(false);
                setTruckOpen(false);
                setSavedOpen(false);
                setRouteOpen(false);
                setSelected(null);
                setSearchResult(null);
                // Warm up a GPS fix so category picks load around the
                // driver, not around a stale fallback point.
                void resolvePoiFocus();
              }}
              accessibilityRole="button"
              accessibilityLabel="Pick a point of interest category to show on the map"
              style={({ pressed }) => [styles.railPill, pressed && styles.pressed]}>
              <Ionicons name="pin-outline" size={18} color={colors.text} />
              <Text style={styles.railPillText}>POI</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        <Pressable
          onPress={() => setRailOpen(!railOpen)}
          accessibilityRole="button"
          accessibilityLabel={
            railOpen
              ? 'Hide map tools'
              : navIndex !== null
                ? 'Show navigation and map tools: current turn, steps, end navigation, map type, saved, my truck, trip, route, places, points of interest'
                : 'Show map tools: map type, saved, my truck, trip, route, places, points of interest'
          }
          style={({ pressed }) => [styles.railFab, pressed && styles.pressed]}>
          <Ionicons
            name={railOpen ? 'close' : 'apps-outline'}
            size={26}
            color="#FFFFFF"
          />
        </Pressable>
      </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    zIndex: 30,
  },
  suggestBox: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    left: spacing.md,
    overflow: 'hidden',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 64,
    zIndex: 20,
  },
  // Build #22 (item 5a): when the search text is long enough to
  // have wrapped to a second line, the suggestion list drops by
  // one line's height so it never covers the address being typed.
  suggestBoxTall: {
    top: spacing.md + 92,
  },
  suggestRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestText: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
  },
  // Build #23 (item 3): the Report button's anchor — bottom left,
  // its top edge just below the elevation readout (which rides at
  // bottom 168 while navigating; the button is 40 tall ending at
  // bottom 124, just above the nav strip's ~104 reach). The kind
  // picker stacks upward from the button when it's open.
  // Build #26 (Larry, I-74 drive): nudged DOWN a little at his
  // word — anchor bottom 124 → 110, so the button sits closer to
  // the bottom info bar. Still clear of the nav strip's ~104
  // reach below and of the truck marker's anchor point far above
  // it; the elevation readout stays at 168, so a small gap opens
  // between the readout and the button.
  reportAnchor: {
    alignItems: 'flex-start',
    bottom: 110,
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    zIndex: 16,
  },
  reportKindStack: {
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  reportButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  headerReportText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  reportKind: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  reportKindIcon: {
    fontSize: 17,
  },
  reportKindText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  hazardPin: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,16,10,0.85)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  // Winner's flag (final destination): just a small flag — no chip,
  // no background, no border (Larry, Nov 8 road test of the chipped
  // version: "make smaller, no black around it, not outline in
  // yellow — just a small flag"). An 18px 🏁 glyph on a slim light
  // pole, ~29dp tall overall. The wrap has no padding/margin and
  // the stem is its lowest child (anchor invariant — see the JSX).
  destFlagWrap: {
    alignItems: 'center',
  },
  destFlagEmoji: {
    fontSize: 18,
    lineHeight: 21,
  },
  destFlagStem: {
    backgroundColor: '#EDEFF2',
    height: 8,
    width: 2,
  },
  // Check-in flag (second flag): same minimal no-chip look, smaller
  // than the winner's flag (~26dp overall) — an amber flag glyph on
  // an amber slim pole. Amber alone says "your saved check-in"; no
  // label chip.
  checkInFlagWrap: {
    alignItems: 'center',
  },
  checkInFlagGlyph: {
    color: colors.primary,
    fontSize: 16,
    lineHeight: 18,
  },
  checkInFlagStem: {
    backgroundColor: colors.primary,
    height: 8,
    width: 2,
  },
  hazardPinText: {
    fontSize: 17,
  },
  compass: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 140,
    width: 44,
    zIndex: 10,
  },
  compassNeedle: {
    color: '#F87171',
    fontSize: 12,
    lineHeight: 13,
  },
  compassLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 12,
  },
  // Build #27 (item 12): the latched north-up state — primary
  // ring + filled background so a glance says the lock is on.
  compassLocked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  // Build #27 (item 3): the repeated interstate shield badge.
  shieldBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#141414',
    borderRadius: 7,
    borderWidth: 2,
    minWidth: 40,
    overflow: 'hidden',
  },
  shieldBand: {
    alignSelf: 'stretch',
    backgroundColor: '#C8102E',
    height: 5,
  },
  shieldText: {
    color: '#141414',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  elevationText: {
    bottom: spacing.md,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    left: spacing.md,
    position: 'absolute',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    zIndex: 10,
  },
  // Build #23 (item 1): SMALL type, capped growth. Build #22 made
  // this input multiline so the whole address stayed visible — but
  // on Larry's phone the system font size is cranked up, and the
  // input (which obeyed it) ballooned: a long address rendered at
  // headline size, wrapped 5 lines and buried the mic/search
  // buttons under a card that ate the map. Now the input ignores
  // the system font scale (allowFontScaling={false} in the JSX),
  // sits at 15px, and its height is capped at two lines — the full
  // address stays readable in the box and the card stays compact.
  searchInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 64,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  // Build #19: the read-only destination label that replaces the
  // search input while a route is up — same box, full address.
  // Build #23 (item 1): capped at two compact lines like the input
  // — the label text no longer scales with the system font size
  // (allowFontScaling={false} in the JSX), so a long destination
  // name can't balloon the box over the buttons again.
  searchDestBox: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    maxHeight: 64,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  searchDestText: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 56,
    width: 56,
  },
  locateButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 60,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 68,
    width: 60,
  },
  pressed: {
    opacity: 0.75,
  },
  // Build #23 (item 6b): the message banner hangs BELOW the
  // search bar and paints ABOVE it. Build #22's version sat at
  // top md+68 with no zIndex while the search bar carries zIndex
  // 30 — so the (possibly two-line) search box painted over the
  // banner and trapped it unreadable behind the card, exactly as
  // Larry's screenshot showed. top md+76 clears the now-capped
  // 64dp search box; zIndex 31 keeps it on top regardless.
  errorToast: {
    alignSelf: 'center',
    backgroundColor: colors.danger,
    borderRadius: 10,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 76,
    zIndex: 31,
  },
  errorText: {
    color: '#140A0A',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    bottom: spacing.md,
    left: spacing.md,
    padding: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  cardRoute: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  // Parking size badge (build #19) — only rendered when the stop
  // carries a verified spot count.
  cardSizeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sizeBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sizeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardSizeLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  // Build #24 (item 12): the compact destination card's primary
  // action row — Truck route + Start route side by side, always
  // visible; both buttons share the row evenly.
  destPrimaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  destPrimaryBtn: {
    alignItems: 'center',
    flex: 1,
  },
  destPrimaryStart: {
    flex: 1,
    marginTop: 0,
  },
  phone: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  routeChip: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(11,14,20,0.88)',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    left: spacing.md,
    padding: spacing.sm,
    position: 'absolute',
    right: spacing.md + 84,
    top: spacing.md + 68,
  },
  routeChipText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  routeChipSub: {
    color: colors.text,
    fontSize: 12,
    marginTop: 2,
  },
  lowBridgeNote: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  lowBridgeBadge: {
    alignItems: 'center',
    backgroundColor: '#DC2626',
    borderColor: '#7F1D1D',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  lowBridgeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  truckHint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  truckRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  truckLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    width: 64,
  },
  truckInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    minHeight: 48,
    textAlign: 'center',
    width: 64,
  },
  truckInputWide: {
    width: 110,
  },
  truckUnit: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  hazmatToggle: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    width: 84,
  },
  hazmatToggleOn: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  hazmatText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  directions: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  directionsText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  savedPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    bottom: spacing.md,
    left: spacing.md,
    maxHeight: '55%',
    padding: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  savedList: {
    marginTop: spacing.sm,
  },
  savedRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  savedRowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
  },
  savedRowText: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  savedEmpty: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.sm,
  },
  webFallback: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  webTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  webText: {
    color: colors.muted,
    fontSize: 16,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  railWrap: {
    alignItems: 'flex-end',
    flexDirection: 'column',
    gap: spacing.sm,
    position: 'absolute',
    right: spacing.md,
    zIndex: 5,
  },
  railScroll: {
    flexGrow: 0,
  },
  railScrollContent: {
    alignItems: 'flex-end',
    gap: spacing.sm,
    // Extra room after the last pill so it scrolls fully clear of the
    // rail toggle below instead of sitting half-cut under it.
    paddingBottom: spacing.xl,
  },
  railPill: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  railPillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  railFab: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.primaryDim,
    borderRadius: 999,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  startButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  navPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 16,
    borderWidth: 2,
    bottom: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: spacing.md,
  },
  navStepCount: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  navInstruction: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  navButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  navNextButton: {
    minHeight: 44,
  },
  navOptionsBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  navOptionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  navOptionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  pill: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  pillOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  pillTextOn: {
    color: '#FFFFFF',
  },
  // Truck marker (build #19): a fixed-size stage so the marker's
  // center is always the truck's exact position. (Build #23,
  // item 2: the rotating amber wedge layer that used to ride this
  // stage is removed. Build #27: the stage's own drop shadow /
  // elevation is removed too — no shadow anywhere on the marker,
  // just the truck.)
  navTruckWrap: {
    alignItems: 'center',
    height: 104,
    justifyContent: 'center',
    width: 84,
  },
  // Build #24 (item 4): the rotating group inside the fixed stage —
  // same box as the wrap so rotation is about the truck's exact
  // position.
  navTruckSpin: {
    alignItems: 'center',
    height: 104,
    justifyContent: 'center',
    width: 84,
  },
  // Build #27: the marker image alone — the dark pad and black
  // silhouette halo styles that used to sit behind it are deleted
  // outright. The frame stays 58×94; the PNGs are tight-cropped
  // to the truck (assets/trucks/nav-*.png), so with contain the
  // truck itself now fills the frame edge-to-edge instead of
  // floating in transparent padding.
  navTruckMarker: {
    height: 94,
    width: 58,
  },
  attribution: {
    bottom: 4,
    color: 'rgba(242,244,248,0.75)',
    fontSize: 10,
    position: 'absolute',
    right: 8,
  },
  colorDot: {
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 3,
    height: 40,
    width: 40,
  },
  colorDotOn: {
    borderColor: '#FFFFFF',
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  routeChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  routeChoice: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  routeChoiceOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  routeChoiceText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  routeChoiceTextOn: {
    color: '#FFFFFF',
  },
  poiBadge: {
    alignItems: 'center',
    borderColor: '#0B0E14',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  // Build #24 (item 13): branded badges — the marker Pressable
  // goes bare and the badge view carries the face.
  poiBadgeClear: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadge: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 30,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.45,
    shadowRadius: 2,
    width: 30,
  },
  brandBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  // CAT Scale badge: black face, yellow CAT over SCALE — drawn
  // in the spirit of the scale's own badge, no logo file.
  catBadge: {
    backgroundColor: '#0A0A0A',
    borderColor: '#FFD200',
  },
  catBadgeText: {
    color: '#FFD200',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },
  catBadgeSub: {
    color: '#FFD200',
    fontSize: 5.5,
    fontWeight: '800',
    letterSpacing: 1.6,
    lineHeight: 7,
  },
  // Parking badge: the highway-style blue square with a white P,
  // like the reference screenshot.
  parkingBadge: {
    backgroundColor: '#1B5FC1',
  },
  parkingBadgeText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 19,
  },
  segRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segButton: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  segButtonOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  segTextOn: {
    color: '#FFFFFF',
  },
  poiList: {
    maxHeight: 320,
  },
  // POI picker sheet: all nine categories at once as a grid of big
  // tiles — no scrolling to see any of them (Larry's ask). Taller than
  // the shared savedPanel so the 3×3 grid fits with room to spare.
  poiPickerPanel: {
    maxHeight: '88%',
  },
  poiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  poiTile: {
    alignItems: 'center',
    aspectRatio: 1.05,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    width: '31.5%',
  },
  poiTileActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  poiTileIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  poiTileLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  poiTileStatus: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
    minHeight: 14,
    textAlign: 'center',
  },
  poiTileStatusError: {
    color: colors.danger,
  },
  poiTileCheck: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 18,
  },
  poiDot: {
    borderRadius: 999,
    height: 14,
    width: 14,
  },
  poiLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  // Build #24 (item 8): the full, readable load-failure line
  // under a Places panel row.
  poiErrorText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginBottom: 6,
    marginLeft: 26,
    marginTop: 2,
  },
  tripButtonOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tripButtonTextOn: {
    color: '#FFFFFF',
  },
  weighBanner: {
    alignSelf: 'center',
    backgroundColor: colors.info,
    borderRadius: 10,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md + 128,
  },
  weighBannerText: {
    color: '#0A101A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  viaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  viaText: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  // Multi-stop panel (build #18).
  stopsHeader: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  stopNum: {
    alignItems: 'center',
    backgroundColor: colors.info,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  stopNumText: {
    color: '#0A101A',
    fontSize: 13,
    fontWeight: '800',
  },
  stopTextWrap: {
    flex: 1,
  },
  stopEta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  stopCapText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  stopBtnOff: {
    opacity: 0.4,
  },
  // Dropped-pin card's check-in action row (below Start route).
  checkInRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  checkInRowTextWrap: {
    flex: 1,
  },
  checkInRowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  checkInRowSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  viaAddButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  viaAddText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  viaSearchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  // Build #22 (item 5a): same wrap treatment as the main search
  // box — a long stop address stays fully visible while typing.
  viaInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    maxHeight: 60,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  // Build #21 (item 3): the add-a-stop row keeps a right inset the
  // width of the orange tools FAB (52 + margins) that floats at the
  // bottom-right over the card, so the row's + button always sits
  // fully inside the card, clear of the FAB and tappable. (Larry's
  // Nov 9 6:26 AM screenshot: the + was clipped at the card edge
  // AND covered by the FAB.)
  // Build #22 (item 4): STRENGTHENED 64 → 76. Geometry check: the
  // FAB column spans 68dp from the screen's right edge (52 wide +
  // 16 margin) and the card's content edge sits 32dp in, so the
  // old 64 inset already cleared the FAB by ~28dp on paper — but
  // Larry's Nov 9 screenshot still showed the overlap (build
  // unconfirmed), so the inset grows to 76 (≈40dp clear) rather
  // than trusting the paper math.
  viaSearchRowClear: {
    marginRight: 76,
  },
  // Build #22 (item 2): the slim pill that stands in for the hidden
  // route card — tap to reopen the card; its X clears the route.
  routePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(11,14,20,0.88)',
    borderColor: colors.primary,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    left: spacing.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    position: 'absolute',
    top: spacing.md + 68,
    zIndex: 21,
  },
  routePillMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingRight: spacing.xs,
  },
  routePillText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  routePillClose: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  // Build #22 (item 1): zero-size invisible marker rendered only in
  // the PiP overview state (bundle-level verification hook).
  pipDiag: {
    height: 0,
    opacity: 0,
    width: 0,
  },
  // Build #21 PiP: the compact turn banner that is the mini
  // window's only overlay — distance + next instruction, filling
  // the top of the small window.
  pipBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 20, 0.88)',
    flexDirection: 'row',
    gap: spacing.sm,
    left: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
  },
  pipBannerDist: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  pipBannerText: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  viaSearchButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    width: 48,
  },
  driveStats: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
  },
  driveStat: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 2,
  },
  // Top row of the heading stat in the nav bar (build #19):
  // compass icon beside the big cardinal letter.
  headingStatTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  driveStatValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  driveStatLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    width: 56,
  },
  micButtonOn: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  railNavCard: {
    backgroundColor: 'rgba(11,14,20,0.95)',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: 300,
  },
  railNavInstruction: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  navBannerSub: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  // The persistent top turn banner. Build #19 sat it under the
  // search/address bar; Build #20 shrunk the type and tightened it.
  // Build #22 (item 3): it now owns the VERY TOP of the screen —
  // the tab header ("Hammerlaneco") hides while it is up and the
  // search bar steps aside, so the banner is flush to the top with
  // only its small top margin; the *Nav variants below shift down
  // only by the banner's own height (~76 less than build #21).
  turnBanner: {
    backgroundColor: 'rgba(11,14,20,0.94)',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'column',
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    position: 'absolute',
    right: spacing.md,
    top: spacing.sm,
    zIndex: 24,
  },
  // Build #24: the original banner row (distance box + main
  // column) inside the now-column banner, so the lane strip can
  // ride underneath.
  turnBannerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  turnBannerDist: {
    alignItems: 'center',
    minWidth: 72,
  },
  turnBannerDistText: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 29,
  },
  turnBannerDistLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 1,
  },
  turnBannerMain: {
    flex: 1,
  },
  // Build #24 (item 3): the current-road readout leading the
  // banner's main column — small, blue, single line.
  turnBannerRoad: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  // Build #23 (item 4): turn instruction a touch bigger than
  // build #22's 16 (Larry: "just a little bit tiny bigger on the
  // direction step by step").
  turnBannerText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  // Build #24 (item 10): the "Then:" chip — replaces the old
  // full-text Then line. Small, bottom-left of the banner's main
  // column: the word "Then:" plus one arrow for the maneuver
  // after next (left / right / straight). The full text is one
  // tap away — tapping the banner speaks it (item 9).
  thenChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46,155,255,0.22)',
    borderColor: 'rgba(46,155,255,0.55)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  thenChipLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  // Build #24 (item 1): the lane strip under the banner row —
  // one arrow per lane, route lanes lit #2E9BFF, the rest dimmed.
  laneStrip: {
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.14)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 6,
    paddingTop: 5,
  },
  navStrip: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    bottom: spacing.md,
    left: spacing.md,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    position: 'absolute',
    right: spacing.md,
  },
  stripStats: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  navStripValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  // Build #27 (item 5): the arrival clock's big readout — visibly
  // larger than the slim strip values, like the old full-size
  // drive stats Larry remembers, and it never drops below 85%
  // scale (minimumFontScale in the JSX) so it can't clip small.
  navStripArrivalValue: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  navStripLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  stripStatTapSlim: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 30,
  },
  speedLimitBadgeSlim: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#141414',
    borderRadius: 5,
    borderWidth: 2,
    minWidth: 36,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  speedLimitLabelSlim: {
    color: '#141414',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  speedLimitValueSlim: {
    color: '#141414',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
  speedLimitBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#141414',
    borderRadius: 6,
    borderWidth: 2,
    minWidth: 48,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  speedLimitLabel: {
    color: '#141414',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  speedLimitValue: {
    color: '#141414',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 22,
  },
  startNowButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 52,
  },
  followButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.primary,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    position: 'absolute',
    top: spacing.md + 76,
  },
  followButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
});

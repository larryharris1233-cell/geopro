import AsyncStorage from '@react-native-async-storage/async-storage';

// Points of interest shown as toggleable map layers.
//
// Sources — all open data, ours to use:
// - 'stops' / 'weigh': the app's own bundled datasets (data/truckStops.json,
//   data/weighStations.json), filtered locally. The truck-stop bundle is a
//   nationwide OpenStreetMap extract (see the file header in the data and
//   the run log for how it was built).
// - 'rest' / 'repair' / 'walmart' / 'parking' / 'tpc': OpenStreetMap,
//   queried live from the Overpass API — around the driver's position,
//   for the visible map region (anywhere in the USA), and along the
//   planned route's corridor.
// - 'catscale' / 'fuel' / 'distcenter' / 'dealers' / 'milemarkers': also
//   OpenStreetMap via Overpass, added for the map's POI category picker.
//   Coverage follows whatever OSM mappers have tagged — fuel and rest
//   areas are dense; mile markers are genuinely sparse in OSM and are
//   shown exactly as tagged, never padded with invented entries.
// - 'tpc' (Truck Parking Club) matches OSM objects tagged with
//   operator/brand "Truck Parking Club" — only their sites that appear in
//   open map data. Their proprietary location database is NOT used; sites
//   that exist only in their own system will not appear here.

export type PoiCategory =
  | 'stops'
  | 'weigh'
  | 'rest'
  | 'repair'
  | 'walmart'
  | 'parking'
  | 'tpc'
  | 'catscale'
  | 'fuel'
  | 'distcenter'
  | 'dealers'
  | 'milemarkers'
  | 'construction';

export interface Poi {
  id: string;
  category: PoiCategory;
  name: string;
  latitude: number;
  longitude: number;
  detail?: string;
}

export interface PoiCategoryMeta {
  key: PoiCategory;
  label: string;
  // MaterialCommunityIcons glyph shown on the map marker badge.
  icon: string;
  color: string;
  source: 'bundled' | 'osm';
}

export const POI_CATEGORIES: PoiCategoryMeta[] = [
  { key: 'stops', label: 'Truck stops & fuel', icon: 'gas-station', color: '#2E9BFF', source: 'bundled' },
  { key: 'weigh', label: 'Weigh stations', icon: 'scale-balance', color: '#38BDF8', source: 'bundled' },
  { key: 'rest', label: 'Rest areas', icon: 'bed', color: '#4ADE80', source: 'osm' },
  { key: 'repair', label: 'Truck repair shops', icon: 'wrench', color: '#F87171', source: 'osm' },
  { key: 'walmart', label: 'Walmarts', icon: 'cart', color: '#60A5FA', source: 'osm' },
  { key: 'parking', label: 'Truck parking', icon: 'parking', color: '#C084FC', source: 'osm' },
  { key: 'tpc', label: 'Truck Parking Club', icon: 'truck', color: '#2E9BFF', source: 'osm' },
  { key: 'catscale', label: 'CAT Scales', icon: 'weight', color: '#FDE047', source: 'osm' },
  { key: 'fuel', label: 'Gas stations', icon: 'fuel', color: '#2DD4BF', source: 'osm' },
  { key: 'distcenter', label: 'Distribution centers', icon: 'warehouse', color: '#94A3B8', source: 'osm' },
  { key: 'dealers', label: 'Truck dealerships', icon: 'storefront', color: '#818CF8', source: 'osm' },
  { key: 'milemarkers', label: 'Mile markers', icon: 'road-variant', color: '#CBD5E1', source: 'osm' },
  { key: 'construction', label: 'Road construction', icon: 'traffic-cone', color: '#F97316', source: 'osm' },
];

export function poiCategoryMeta(key: PoiCategory): PoiCategoryMeta {
  return POI_CATEGORIES.find((c) => c.key === key) ?? POI_CATEGORIES[0];
}

export type PoiLayerPrefs = Record<PoiCategory, boolean>;

export const DEFAULT_POI_LAYERS: PoiLayerPrefs = {
  stops: true,
  weigh: false,
  rest: false,
  repair: false,
  walmart: false,
  parking: false,
  tpc: false,
  catscale: false,
  fuel: false,
  distcenter: false,
  dealers: false,
  milemarkers: false,
  construction: true,
};

const POI_LAYERS_KEY = 'geopro.poiLayers.v1';

export async function loadPoiLayers(): Promise<PoiLayerPrefs> {
  try {
    const raw = await AsyncStorage.getItem(POI_LAYERS_KEY);
    if (raw) {
      return { ...DEFAULT_POI_LAYERS, ...(JSON.parse(raw) as Partial<PoiLayerPrefs>) };
    }
  } catch {}
  return DEFAULT_POI_LAYERS;
}

export async function savePoiLayers(prefs: PoiLayerPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(POI_LAYERS_KEY, JSON.stringify(prefs));
  } catch {}
}

// Public Overpass instances, tried in order — if the main server is
// overloaded or unreachable, the mirror gets a turn before we give up.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// A map region, as reported by the map's region-change events and used
// for bounding-box lookups: POIs load for wherever the driver is
// LOOKING, anywhere in the country — not just around his GPS fix.
export interface PoiBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// The bounding box a radius lookup covers, so the map can treat it as
// already-loaded territory when the driver pans around inside it.
export function bboxAround(lat: number, lng: number, radiusM: number): PoiBbox {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

// Overpass QL statements per OSM-backed category, parameterised by a
// spatial filter string `f` — `(around:radius,lat,lng)` for point and
// route-corridor lookups, `(south,west,north,east)` for viewport
// bounding-box lookups. One category definition drives all three.
function osmStatements(category: PoiCategory, f: string): string[] | null {
  switch (category) {
    case 'rest':
      return [
        `node["highway"="rest_area"]${f}`,
        `way["highway"="rest_area"]${f}`,
      ];
    case 'repair':
      return [
        `node["shop"="truck_repair"]${f}`,
        `way["shop"="truck_repair"]${f}`,
      ];
    case 'walmart':
      return [
        `node["brand:wikidata"="Q483551"]${f}`,
        `way["brand:wikidata"="Q483551"]${f}`,
        `node["name"~"^Walmart"]${f}`,
        `way["name"~"^Walmart"]${f}`,
      ];
    case 'parking':
      return [
        `node["amenity"="truck_parking"]${f}`,
        `way["amenity"="truck_parking"]${f}`,
        `node["amenity"="parking"]["hgv"="yes"]${f}`,
        `way["amenity"="parking"]["hgv"="yes"]${f}`,
      ];
    case 'tpc':
      return [
        `nwr["operator"~"Truck Parking Club",i]${f}`,
        `nwr["brand"~"Truck Parking Club",i]${f}`,
      ];
    case 'catscale':
      // CAT Scale is a brand; OSM mappers tag it as brand and/or name.
      // Exact-match node/way lookups only: the old regex scan over all
      // nwr elements was so slow on Overpass that it timed out and the
      // category came back empty every time.
      return [
        `node["brand"="CAT Scale"]${f}`,
        `way["brand"="CAT Scale"]${f}`,
        `node["name"="CAT Scale"]${f}`,
        `way["name"="CAT Scale"]${f}`,
      ];
    case 'fuel':
      return [`node["amenity"="fuel"]${f}`, `way["amenity"="fuel"]${f}`];
    case 'distcenter':
      // Named warehouses are the best open-data proxy for distribution
      // centers; unnamed sheds would just be noise on the map.
      return [
        `node["building"="warehouse"]["name"]${f}`,
        `way["building"="warehouse"]["name"]${f}`,
      ];
    case 'dealers':
      // shop=truck where mapped, plus car-dealer objects carrying a
      // heavy-truck brand (how most big-rig dealers are tagged in OSM).
      return [
        `node["shop"="truck"]${f}`,
        `way["shop"="truck"]${f}`,
        `node["shop"]["brand"~"Peterbilt|Kenworth|Freightliner|Mack|Navistar|Volvo",i]${f}`,
        `way["shop"]["brand"~"Peterbilt|Kenworth|Freightliner|Mack|Navistar|Volvo",i]${f}`,
      ];
    case 'milemarkers':
      // highway=milestone — honestly sparse in US OpenStreetMap data.
      return [`node["highway"="milestone"]${f}`];
    case 'construction':
      // Roads mapped as under construction in OSM. Ways return their
      // center point, which is where the pin + heads-up anchor.
      return [
        `node["highway"="construction"]${f}`,
        `way["highway"="construction"]${f}`,
      ];
    default:
      return null;
  }
}

function buildOsmQuery(statements: string[], limit: number): string {
  return `[out:json][timeout:30];(${statements.join(';')};);out center ${limit};`;
}

function osmQuery(category: PoiCategory, lat: number, lng: number, radiusM: number): string | null {
  const stmts = osmStatements(
    category,
    `(around:${radiusM},${lat.toFixed(5)},${lng.toFixed(5)})`,
  );
  return stmts ? buildOsmQuery(stmts, 200) : null;
}

// Viewport lookup: everything in the category inside a map region.
export function osmBboxQuery(category: PoiCategory, bbox: PoiBbox, limit = 300): string | null {
  const f = `(${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)})`;
  const stmts = osmStatements(category, f);
  return stmts ? buildOsmQuery(stmts, limit) : null;
}

// Route-corridor lookup: the category's statements repeated around each
// sampled point along the route, unioned into one query — a 500+ mile
// run gets coverage along its whole length, not just near the start.
export function osmCorridorQuery(
  category: PoiCategory,
  samples: { latitude: number; longitude: number }[],
  radiusM: number,
  limit = 600,
): string | null {
  if (samples.length === 0) return null;
  const all: string[] = [];
  for (const s of samples) {
    const stmts = osmStatements(
      category,
      `(around:${radiusM},${s.latitude.toFixed(5)},${s.longitude.toFixed(5)})`,
    );
    if (!stmts) return null;
    all.push(...stmts);
  }
  return buildOsmQuery(all, limit);
}

const FALLBACK_NAMES: Partial<Record<PoiCategory, string>> = {
  rest: 'Rest area',
  repair: 'Truck repair',
  walmart: 'Walmart',
  parking: 'Truck parking',
  tpc: 'Truck Parking Club',
  catscale: 'CAT Scale',
  fuel: 'Gas station',
  distcenter: 'Distribution center',
  dealers: 'Truck dealership',
  milemarkers: 'Mile marker',
};

export interface OsmFetchResult {
  pois: Poi[];
  // null on success — including a genuine zero-result answer. A message
  // when the lookup itself failed, so the UI can honestly say "couldn't
  // load" instead of printing a fake "0 on map".
  error: string | null;
  // True when the caller cancelled the lookup (a newer pan/pick made it
  // stale). Aborted results must be dropped, never shown as an error.
  aborted?: boolean;
}

interface OverpassResult {
  elements: any[] | null;
  error: string | null;
  aborted: boolean;
}

// One Overpass round-trip with the app's identifying headers, the
// endpoint fallback, and cancellation. Every POI lookup — point,
// viewport, corridor — goes through here.
async function postOverpass(
  query: string,
  externalSignal?: AbortSignal,
): Promise<OverpassResult> {
  let lastError = 'Map data lookup failed';
  for (const url of OVERPASS_ENDPOINTS) {
    if (externalSignal?.aborted) return { elements: null, error: null, aborted: true };
    const controller = new AbortController();
    // Overpass queues requests when busy, and its own server-side cap is
    // 30s of execution — 45s per attempt leaves room for queue wait on
    // top of a full 30s run instead of dying just short, like the old
    // 30s cap did.
    const timer = setTimeout(() => controller.abort(), 45000);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener?.('abort', onExternalAbort);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Overpass rejects generic library user agents (okhttp etc.)
          // with HTTP 406 — the app must identify itself, per the
          // Overpass usage policy. Without this header EVERY lookup
          // failed and silently looked like "0 found".
          'User-Agent': 'HammerLaneCo/2.1',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!resp.ok) {
        lastError = `Map data server error (${resp.status})`;
        continue;
      }
      const data = await resp.json();
      return {
        elements: Array.isArray(data?.elements) ? data.elements : [],
        error: null,
        aborted: false,
      };
    } catch {
      if (externalSignal?.aborted) return { elements: null, error: null, aborted: true };
      lastError = 'Map data lookup timed out or failed';
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', onExternalAbort);
    }
  }
  return { elements: null, error: lastError, aborted: false };
}

function elementsToPois(category: PoiCategory, elements: any[]): Poi[] {
  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const el of elements) {
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const id = `osm-${category}-${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags: Record<string, string> = el.tags ?? {};
    const name =
      tags.name || FALLBACK_NAMES[category] || poiCategoryMeta(category).label;
    const cityState = [tags['addr:city'], tags['addr:state']]
      .filter(Boolean)
      .join(', ');
    // Mile posts carry their number in `ref` — that's the useful detail.
    const refDetail =
      category === 'milemarkers' && tags.ref ? `Mile ${tags.ref}` : undefined;
    pois.push({
      id,
      category,
      name,
      latitude: lat,
      longitude: lon,
      detail: cityState || refDetail || undefined,
    });
  }
  return pois;
}

async function runOsmQuery(
  category: PoiCategory,
  query: string | null,
  externalSignal?: AbortSignal,
): Promise<OsmFetchResult> {
  if (!query) return { pois: [], error: null };
  const { elements, error, aborted } = await postOverpass(query, externalSignal);
  if (aborted) return { pois: [], error: null, aborted: true };
  if (error || !elements) {
    return { pois: [], error: error ?? 'Map data lookup failed' };
  }
  return { pois: elementsToPois(category, elements), error: null };
}

// Fetch one OSM-backed category around a point. A failed lookup is
// reported as an error, never disguised as an empty result; POI layers
// are informational, so a failure must never break the map itself.
export async function fetchOsmPois(
  category: PoiCategory,
  latitude: number,
  longitude: number,
  radiusM = 40000,
  externalSignal?: AbortSignal,
): Promise<OsmFetchResult> {
  return runOsmQuery(
    category,
    osmQuery(category, latitude, longitude, radiusM),
    externalSignal,
  );
}

// Fetch one OSM-backed category inside a map region — the "anywhere in
// the USA" lookup behind viewport loading.
export async function fetchOsmPoisBbox(
  category: PoiCategory,
  bbox: PoiBbox,
  externalSignal?: AbortSignal,
): Promise<OsmFetchResult> {
  return runOsmQuery(category, osmBboxQuery(category, bbox), externalSignal);
}

// Fetch one OSM-backed category along a route corridor: samples are
// points spaced along the route line, and one unioned query covers all
// of them, so stops near the far end of a long run load too.
export async function fetchOsmPoisAlongRoute(
  category: PoiCategory,
  samples: { latitude: number; longitude: number }[],
  radiusM = 25000,
  externalSignal?: AbortSignal,
): Promise<OsmFetchResult> {
  return runOsmQuery(
    category,
    osmCorridorQuery(category, samples, radiusM),
    externalSignal,
  );
}


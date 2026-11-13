// Shared snapshot of the planned truck route.
//
// The route itself lives in the Map screen's state (routeCoords/routeInfo).
// This module mirrors it — the same lightweight module pattern as
// pendingNav.ts — so other tabs can read the route without prop drilling or
// a global store. The Map screen refreshes the mirror whenever its route
// changes and clears it when the route is cleared. The Fuel tab uses it for
// its "fuel along my route" list.

export interface RouteCoord {
  latitude: number;
  longitude: number;
}

export interface ActiveRoute {
  coords: RouteCoord[];
  // cumulativeMi[i] = distance along the route from its start to coords[i].
  cumulativeMi: number[];
  miles: number;
  minutes: number;
}

let current: ActiveRoute | null = null;

// Same haversine the Map screen uses (map.tsx distMi).
export function distMi(
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

// Pure builder (build #17): same cumulative-distance math as the
// mirror below, but returns the snapshot without touching the shared
// one — the low-bridge corridor check needs to project onto route
// options that are not (yet) the active route.
export function buildActiveRoute(
  coords: RouteCoord[],
  info: { miles: number; minutes: number },
): ActiveRoute | null {
  if (coords.length < 2) return null;
  const cumulativeMi = new Array<number>(coords.length);
  cumulativeMi[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    cumulativeMi[i] =
      cumulativeMi[i - 1] +
      distMi(
        coords[i - 1].latitude,
        coords[i - 1].longitude,
        coords[i].latitude,
        coords[i].longitude,
      );
  }
  return { coords, cumulativeMi, miles: info.miles, minutes: info.minutes };
}

export function setActiveRoute(
  coords: RouteCoord[],
  info: { miles: number; minutes: number },
): void {
  current = buildActiveRoute(coords, info);
}

export function clearActiveRoute(): void {
  current = null;
}

export function getActiveRoute(): ActiveRoute | null {
  return current;
}

// How far off the route line a stop may be and still count as "along the
// route" — matches the Map screen's "Along my route only" POI filter (~3 mi).
export const ALONG_ROUTE_TOLERANCE_MI = 3;

export interface RouteProjection {
  // Distance from the route's start to the route point nearest the given point.
  alongMi: number;
  // Straight-line distance from the given point to that nearest route point.
  offMi: number;
}

// Evenly spaced sample points along the route — used to chain radius
// lookups down the whole line (POI route-corridor loading), so a long
// run gets coverage along its full length instead of only near the
// start. Spacing widens past targetSpacingMi only when the route is so
// long that maxSamples would otherwise be exceeded.
export function sampleAlongRoute(
  route: ActiveRoute,
  targetSpacingMi = 25,
  maxSamples = 40,
): RouteCoord[] {
  const { coords, cumulativeMi, miles } = route;
  if (coords.length === 0) return [];
  if (coords.length === 1 || miles <= 0) return [coords[0]];
  const spacing = Math.max(targetSpacingMi, miles / Math.max(1, maxSamples - 1));
  const samples: RouteCoord[] = [coords[0]];
  let nextAt = spacing;
  for (let i = 1; i < coords.length; i++) {
    if (cumulativeMi[i] >= nextAt) {
      samples.push(coords[i]);
      nextAt += spacing;
    }
  }
  const last = coords[coords.length - 1];
  if (samples[samples.length - 1] !== last) samples.push(last);
  return samples;
}

// Projects a point onto the route using sampled shape points — the same
// sampling approach as the Map screen's poiVisible() check. Sample density
// is capped so projecting every bundled stop stays cheap.
export function projectOntoRoute(
  route: ActiveRoute,
  latitude: number,
  longitude: number,
): RouteProjection {
  const { coords, cumulativeMi } = route;
  if (coords.length === 0) return { alongMi: 0, offMi: Infinity };
  // Coarse pass: nearest SAMPLED vertex (at most ~2000 samples) —
  // used only to bound the fine pass below. Vertex distance alone is
  // NOT the off-route distance: on a straight highway the shape
  // vertices can sit miles apart, so a truck dead-center on the road
  // can be >0.2 mi from every vertex. (This function used to return
  // exactly that vertex distance, which made the navigation
  // off-route check announce "Rerouting" on a loop — Nov 7, 2026.)
  const step = Math.max(1, Math.floor(coords.length / 2000));
  let bestIdx = 0;
  let bestVertex = Infinity;
  for (let i = 0; i < coords.length; i += step) {
    const d = distMi(latitude, longitude, coords[i].latitude, coords[i].longitude);
    if (d < bestVertex) {
      bestVertex = d;
      bestIdx = i;
    }
  }
  const last = coords.length - 1;
  const dLast = distMi(latitude, longitude, coords[last].latitude, coords[last].longitude);
  if (dLast < bestVertex) {
    bestVertex = dLast;
    bestIdx = last;
  }
  // Fine pass: true point-to-segment distance over the segments
  // around the nearest vertex. The closest segment always touches a
  // vertex within one coarse step of the sampled winner; ±2 steps of
  // margin is generous.
  const win = 2 * step + 2;
  const from = Math.max(1, bestIdx - win);
  const to = Math.min(last, bestIdx + win);
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  let bestOff = bestVertex;
  let bestAlong = cumulativeMi[bestIdx];
  for (let i = from; i <= to; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    // Local flat frame in miles, origin at the given point.
    const ax = (a.longitude - longitude) * cosLat * 69.0;
    const ay = (a.latitude - latitude) * 69.0;
    const bx = (b.longitude - longitude) * cosLat * 69.0;
    const by = (b.latitude - latitude) * 69.0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < bestOff) {
      bestOff = d;
      bestAlong =
        cumulativeMi[i - 1] + t * (cumulativeMi[i] - cumulativeMi[i - 1]);
    }
  }
  return { alongMi: bestAlong, offMi: bestOff };
}

// Mapillary street-level "ground view" data access.
//
// Larry approved this feature 2026-11-08 (build #14): tap a spot on
// the map, and IF a street-level photo exists near that point, the
// destination card shows its thumbnail; tapping the thumbnail opens a
// full-screen ground view that can step forward/back along the road —
// the Google Maps Street View flow, built on open Mapillary imagery
// (CC BY-SA; attribution is rendered in the viewer).
//
// TOKEN: Mapillary's API v4 requires a client access token from a free
// Mapillary developer app. Larry registered that app ("Hammer Lane
// Co", read-only scope) and wired the token as the MAPILLARY_TOKEN
// project environment variable on expo.dev — it is NEVER pasted in
// chat, printed in logs, or committed to this repo. app.config.js
// copies it into extra.mapillaryToken at build time, and the app reads
// it from there via expo-constants. While no token is configured the
// feature is fully inert: no network calls, no UI, app behaves exactly
// as build #13.
import Constants from 'expo-constants';

export const MAPILLARY_TOKEN = '';

/**
 * The token the app actually uses: the value baked in from the EAS
 * environment variable (extra.mapillaryToken) when present, falling
 * back to the hard-coded constant above (kept for local/dev use).
 */
export function resolveMapillaryToken(): string {
  const fromConfig = Constants.expoConfig?.extra?.mapillaryToken;
  if (typeof fromConfig === 'string' && fromConfig.trim().length > 0) {
    return fromConfig;
  }
  return MAPILLARY_TOKEN;
}

// True only once a token is configured. Every Mapillary code path
// checks this first, so an empty token means zero behavior change.
export function mapillaryEnabled(): boolean {
  return resolveMapillaryToken().trim().length > 0;
}

export interface GroundPhoto {
  id: string;
  /** Small preview (256px) for the card thumbnail. */
  thumbUrl: string;
  /** Large render (2048px when available) for the full-screen viewer. */
  fullUrl: string;
  /** Epoch milliseconds the photo was captured, when known. */
  capturedAt: number | null;
  /** Mapillary sequence this photo belongs to (stepping stays in it). */
  sequenceId: string | null;
  latitude: number;
  longitude: number;
}

const API_BASE = 'https://graph.mapillary.com/images';
const FIELDS =
  'id,thumb_256_url,thumb_1024_url,thumb_2048_url,captured_at,sequence,geometry';

// How far around a point to look for the card's thumbnail photo
// (~175 m). Mapillary coverage is dense on interstates/highways, so
// the nearest photo to a highway tap is normally well inside this.
const NEARBY_RADIUS_DEG = 0.0016;
// Wider window used to gather the stepping set for the viewer
// (~440 m): on a driven sequence that is dozens of frames each way.
const SEQUENCE_RADIUS_DEG = 0.004;

const FETCH_TIMEOUT_MS = 12000;

interface MapillaryImageJson {
  id?: string;
  thumb_256_url?: string;
  thumb_1024_url?: string;
  thumb_2048_url?: string;
  captured_at?: number | string;
  sequence?: string;
  geometry?: { type?: string; coordinates?: [number, number] };
}

function toGroundPhoto(json: MapillaryImageJson): GroundPhoto | null {
  if (!json.id) return null;
  const coords = json.geometry?.coordinates;
  if (!coords || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (!isFinite(latitude) || !isFinite(longitude)) return null;
  const fullUrl = json.thumb_2048_url ?? json.thumb_1024_url ?? json.thumb_256_url;
  const thumbUrl = json.thumb_256_url ?? json.thumb_1024_url ?? fullUrl;
  if (!fullUrl || !thumbUrl) return null;
  const capturedAt =
    typeof json.captured_at === 'number'
      ? json.captured_at
      : typeof json.captured_at === 'string'
        ? Date.parse(json.captured_at) || null
        : null;
  return {
    id: json.id,
    thumbUrl,
    fullUrl,
    capturedAt,
    sequenceId: json.sequence ?? null,
    latitude,
    longitude,
  };
}

async function fetchImagesInBbox(
  latitude: number,
  longitude: number,
  radiusDeg: number,
  limit: number,
): Promise<GroundPhoto[]> {
  if (!mapillaryEnabled()) return [];
  const bbox = [
    longitude - radiusDeg,
    latitude - radiusDeg,
    longitude + radiusDeg,
    latitude + radiusDeg,
  ].join(',');
  const url =
    `${API_BASE}?access_token=${encodeURIComponent(resolveMapillaryToken())}` +
    `&fields=${FIELDS}&bbox=${bbox}&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: MapillaryImageJson[] };
    const photos: GroundPhoto[] = [];
    for (const item of json.data ?? []) {
      const photo = toGroundPhoto(item);
      if (photo) photos.push(photo);
    }
    return photos;
  } catch {
    // No coverage, no network, bad token — the feature fails silently
    // by design; the card simply shows no thumbnail.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function distanceDeg(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * The street-level photo nearest to a tapped point, or null when
 * Mapillary has no coverage there (or no token is configured).
 */
export async function fetchNearestGroundPhoto(
  latitude: number,
  longitude: number,
): Promise<GroundPhoto | null> {
  const photos = await fetchImagesInBbox(
    latitude,
    longitude,
    NEARBY_RADIUS_DEG,
    25,
  );
  let best: GroundPhoto | null = null;
  let bestDist = Infinity;
  for (const photo of photos) {
    const d = distanceDeg(latitude, longitude, photo.latitude, photo.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = photo;
    }
  }
  return best;
}

/**
 * The stepping set for the viewer: every photo from the anchor's own
 * sequence within the wider window, ordered by capture time — which
 * on a driven sequence IS road order, so next/previous step along the
 * road the way Google's arrows do. The anchor is always included,
 * even if the wider query somehow missed it.
 */
export async function fetchSequenceGroundPhotos(
  anchor: GroundPhoto,
): Promise<GroundPhoto[]> {
  if (!anchor.sequenceId) return [anchor];
  const photos = await fetchImagesInBbox(
    anchor.latitude,
    anchor.longitude,
    SEQUENCE_RADIUS_DEG,
    250,
  );
  const seen = new Set<string>();
  const sequencePhotos: GroundPhoto[] = [];
  for (const photo of photos) {
    if (photo.sequenceId !== anchor.sequenceId) continue;
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    sequencePhotos.push(photo);
  }
  if (!seen.has(anchor.id)) sequencePhotos.push(anchor);
  sequencePhotos.sort(
    (a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0),
  );
  return sequencePhotos;
}

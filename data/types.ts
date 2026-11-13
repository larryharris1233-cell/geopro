export type Amenity = 'diesel' | 'parking' | 'showers' | 'food' | 'wifi';

// The original five travel-center chains, plus the chains the
// nationwide OpenStreetMap truck-stop extract maps OSM brands onto.
// Unbranded truck stops are 'Independent'.
export type Chain =
  | 'Pilot'
  | "Love's"
  | 'Flying J'
  | 'TA'
  | 'Petro'
  | 'Sapp Bros'
  | 'QuikTrip'
  | 'Kwik Trip'
  | "Casey's"
  | "Buc-ee's"
  | 'Maverik'
  | 'AMBEST'
  | 'Bosselman'
  | 'Town Pump'
  | 'Independent';

export interface TruckStop {
  id: string;
  name: string;
  chain: Chain;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  interstate: string;
  exit: string;
  amenities: Amenity[];
  phone: string;
  // Optional per-station diesel price ($/gal). The bundled dataset does NOT
  // carry pump prices today, so this is absent on every bundled record until
  // a priced source is wired in. The UI must never invent, estimate, or
  // backfill it — a stop without dieselPrice simply has no known price.
  dieselPrice?: number;
  // Optional REAL truck-parking spot count, backfilled from the
  // OpenStreetMap `capacity` tag on the stop's own OSM element
  // (build #19). Absent wherever OSM carries no count — the UI must
  // never estimate a count or a size from the chain or name; a stop
  // without spots simply shows no size badge.
  spots?: number;
}

// Parking size buckets (build #19): S = 10 spots or fewer,
// M = 11–50, L = more than 50. Returns null when there is no
// verified count, so callers show no badge at all.
export function parkingSize(
  spots: number | undefined,
): { letter: 'S' | 'M' | 'L'; label: string } | null {
  if (spots === undefined || !Number.isFinite(spots) || spots <= 0) {
    return null;
  }
  const letter = spots <= 10 ? 'S' : spots <= 50 ? 'M' : 'L';
  return { letter, label: `${spots} parking spots` };
}

export interface WeighStation {
  id: string;
  name: string;
  state: string;
  interstate: string;
  mileMarker: string;
  latitude: number;
  longitude: number;
}

export const AMENITY_LABELS: Record<Amenity, string> = {
  diesel: 'Diesel',
  parking: 'Truck Parking',
  showers: 'Showers',
  food: 'Food',
  wifi: 'WiFi',
};

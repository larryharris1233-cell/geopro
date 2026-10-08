export type Amenity = 'diesel' | 'parking' | 'showers' | 'food' | 'wifi';

export type Chain = 'Pilot' | "Love's" | 'Flying J' | 'TA' | 'Petro';

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

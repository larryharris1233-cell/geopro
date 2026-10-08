# GeoPro 🚛

A state-of-the-art trucker companion app for US highways — truck stops, diesel
prices, and weigh stations in a dark, glove-friendly UI.

**v1 is scaffolding**: a clean, working codebase with real screens and bundled
seed data. No backend, no accounts, no payments yet.

## Run it

```bash
cd geopro
npx expo start
```

Then scan the QR code. **Use a development build, not Expo Go** — the app uses
`react-native-maps`, which is not bundled in Expo Go:

```bash
npx expo run:android   # local dev build (needs Android SDK)
# or
eas build --profile development
```

The Map tab also needs a Google Maps API key on Android: put it in
`app.json` under `android.config.googleMaps.apiKey` (currently the placeholder
`YOUR_GOOGLE_MAPS_API_KEY`). iOS uses Apple Maps and needs no key.

## What's in v1

| Tab | What it does |
|---|---|
| **Map** | Full-screen dark map with 60 truck stop pins (Pilot/Flying J, Love's, TA/Petro) along I-70, I-40, I-80, I-35, I-95, I-10. Tap a pin for name, interstate/exit, amenities, phone, and directions. "Locate me" button centers on GPS. |
| **Truck Stops** | Searchable list of the same 60 stops — filter by name, city, interstate, or chain. |
| **Fuel** | EIA Weekly Retail On-Highway Diesel Price snapshot (US avg $6.199/gal, week of Oct 5, 2026) plus a regional PADD bar table. Static data in v1. |
| **Weigh Stations** | 25 weigh station / port-of-entry locations with user-toggleable open/closed status (local state only) and All/Open/Closed filters. |
| **More** | About screen, version, v2 roadmap, and data disclaimer. |

- Seed data: `data/truckStops.json` (60 stops), `data/weighStations.json` (25 stations). Coordinates are plausible/approximate, phone numbers are fictional `(555)` placeholders.
- Dark theme everywhere (`constants/theme.ts`), min 56px touch targets, high contrast.
- Stack: Expo SDK 57, TypeScript (strict), expo-router file-based tabs, react-native-maps, expo-location.

## v2 roadmap

- **User accounts + crowdsourced reports** — sign in, report weigh-station status, parking availability, shower waits in real time.
- **Live fuel prices** — weekly EIA series via a free `api.eia.gov` key, plus per-station pump prices where available.
- **Real-time parking** — crowdsourced + lot-sensor partner data.
- **ELD / Hours of Service** — duty-status logging, 11/14/70-hour clocks, break reminders.
- **Monetization** — free core app; **GeoPro subscription** unlocks offline maps, weigh-station alerts, and ad-free fuel tracking.

## Project layout

```
app/
  _layout.tsx          # root stack (dark)
  +not-found.tsx
  (tabs)/
    _layout.tsx        # 5-tab bar
    map.tsx            # truck stop map
    stops.tsx          # searchable stop list
    fuel.tsx           # diesel prices
    weigh.tsx          # weigh stations
    more.tsx           # about + roadmap
components/            # StopCard, AmenityChips
constants/             # theme.ts, mapStyle.ts (dark map JSON)
data/                  # truckStops.json, weighStations.json, types.ts
```

## Checks

```bash
npx tsc --noEmit   # typecheck
npx expo start     # dev server / bundler smoke test
```

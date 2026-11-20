// Expo config. Hammer Lane Co uses MapLibre + OpenStreetMap tiles —
// no Google Maps anywhere. The ONE Google service the app can use is
// the Geocoding API, and only as an address-SEARCH fallback (build
// #29, Austin-approved Nov 16, 2026): when every free geocoder misses
// a real address, the app may ask Google's geocoder for the pin. Map
// tiles and truck routing stay OSM/Valhalla. The key comes from the
// GOOGLE_GEOCODING_API_KEY environment variable at build time (same
// pattern as MAPILLARY_TOKEN below) — never committed to this repo.
// While no key is configured the Google tier is fully inert.
const base = require('./app.json');

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    plugins: [
      ...(base.expo?.plugins || []),
      './plugins/withPip.js',
      './plugins/withShortcuts.js',
    ],
    extra: {
      ...(base.expo?.extra || {}),
      mapillaryToken: process.env.MAPILLARY_TOKEN || '',
      // Dedicated GOOGLE_GEOCODING_API_KEY wins; the project also
      // carries an older GOOGLE_MAPS_API_KEY EAS variable, so fall
      // back to it — if that key's Cloud project has the Geocoding
      // API enabled the tier lights up, otherwise Google answers
      // with an error status and the tier stays inert (no bad pins).
      googleGeocodeKey:
        process.env.GOOGLE_GEOCODING_API_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        '',
    },
  },
};

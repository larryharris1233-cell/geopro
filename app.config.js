// Expo config with Google Maps API key sourced from the EAS environment.
// Set GOOGLE_MAPS_API_KEY in the Expo dashboard (Project settings >
// Environment variables). Falls back to the embedded key for local runs.
const base = require('./app.json');

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  base.expo.android.config.googleMaps.apiKey;

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    android: {
      ...base.expo.android,
      config: {
        ...base.expo.android.config,
        googleMaps: {
          ...base.expo.android.config.googleMaps,
          apiKey: googleMapsApiKey,
        },
      },
    },
  },
};

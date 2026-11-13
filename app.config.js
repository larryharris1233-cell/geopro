// Expo config. Hammer Lane Co uses MapLibre + OpenStreetMap tiles — no Google Maps.
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
    },
  },
};

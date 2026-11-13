// Build #19: picture-in-picture for the navigation map.
//
// Google Maps-style PiP on Android needs the main activity to opt in
// via android:supportsPictureInPicture="true" in the manifest. The
// android/ directory is generated (Continuous Native Generation), so
// the flag is applied here, at prebuild time, instead of by hand.
//
// The companion local module (modules/hammerlane-pip) does the
// runtime half: while a route is being navigated it arms PiP and
// enters it when the activity leaves the foreground.
const { withAndroidManifest } = require('expo/config-plugins');

function applyPipToManifest(manifest) {
  const application = manifest?.manifest?.application?.[0];
  if (!application) return manifest;
  const entries = [
    ...(application.activity ?? []),
    ...(application['activity-alias'] ?? []),
  ];
  for (const entry of entries) {
    const name = entry?.$?.['android:name'] ?? '';
    // '.MainActivity', 'com.geopro.app.MainActivity', or an alias
    // pointing at it — every spelling gets the flag.
    if (name.includes('MainActivity')) {
      entry.$['android:supportsPictureInPicture'] = 'true';
      // Build #23: also declare the window-size configuration
      // changes as handled in-place. Without these, Android
      // RECREATES the activity on resize (PiP enter/exit, Samsung
      // pop-up view) — and a recreated activity comes back showing
      // the shell (tab bar) while the map re-initializes, which is
      // the "no map in the mini window" Larry hit in builds
      // #21/#22. With them, the same activity (and its already-
      // rendered map) just relayouts into the smaller window.
      const existing = (entry.$['android:configChanges'] || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const wanted = [
        'screenSize',
        'smallestScreenSize',
        'screenLayout',
        'orientation',
        'density',
      ];
      for (const flag of wanted) {
        if (!existing.includes(flag)) existing.push(flag);
      }
      entry.$['android:configChanges'] = existing.join('|');
    }
  }
  return manifest;
}

const withPip = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults = applyPipToManifest(config.modResults);
    return config;
  });

module.exports = withPip;
module.exports.applyPipToManifest = applyPipToManifest;

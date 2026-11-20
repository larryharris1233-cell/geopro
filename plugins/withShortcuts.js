// Build #21: the "Route home" Android launcher shortcut.
//
// A static app shortcut (long-press the app icon -> "Route home",
// and it can be dragged onto the home screen). Tapping it fires a
// VIEW intent for hammerlaneco://route-home; the app handles that
// deep link (app/route-home.tsx -> Map) by planning the truck route
// to Larry's saved home and starting navigation. His home itself is
// set inside the app and stored on-device only — nothing about it
// lives in this file or anywhere in the source tree.
//
// The android/ directory is generated (Continuous Native
// Generation), so everything native is applied here at prebuild
// time: the shortcuts XML resource, its label strings, and the
// android.app.shortcuts meta-data on the main activity.
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require('expo/config-plugins');

const SHORTCUT_ID = 'route-home';
const SHORTCUT_URI = 'hammerlaneco://route-home';

function shortcutsXml(packageName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:shortcutId="${SHORTCUT_ID}"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/shortcut_route_home_short"
    android:shortcutLongLabel="@string/shortcut_route_home_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="${SHORTCUT_URI}"
      android:targetPackage="${packageName}"
      android:targetClass="${packageName}.MainActivity" />
    <categories android:name="android.shortcut.conversation" />
  </shortcut>
</shortcuts>
`;
}

function applyShortcutsMetaData(manifest) {
  const application = manifest?.manifest?.application?.[0];
  if (!application) return manifest;
  const entries = [
    ...(application.activity ?? []),
    ...(application['activity-alias'] ?? []),
  ];
  for (const entry of entries) {
    const name = entry?.$?.['android:name'] ?? '';
    if (!name.includes('MainActivity')) continue;
    const meta = (entry['meta-data'] ??= []);
    const exists = meta.some(
      (m) => m?.$?.['android:name'] === 'android.app.shortcuts',
    );
    if (!exists) {
      meta.push({
        $: {
          'android:name': 'android.app.shortcuts',
          'android:resource': '@xml/shortcuts',
        },
      });
    }
  }
  return manifest;
}

function applyShortcutStrings(strings) {
  const resources = (strings.resources ??= {});
  const list = (resources.string ??= []);
  const wanted = {
    shortcut_route_home_short: 'Route home',
    shortcut_route_home_long: 'Route home with Hammer Lane Co',
  };
  for (const [name, value] of Object.entries(wanted)) {
    const existing = list.find((s) => s?.$?.name === name);
    if (existing) {
      existing._ = value;
    } else {
      list.push({ _: value, $: { name } });
    }
  }
  return strings;
}

const withShortcuts = (config) => {
  config = withAndroidManifest(config, (config) => {
    config.modResults = applyShortcutsMetaData(config.modResults);
    return config;
  });
  config = withStringsXml(config, (config) => {
    config.modResults = applyShortcutStrings(config.modResults);
    return config;
  });
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName =
        config.android?.package ?? 'com.geopro.app';
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      await fs.promises.mkdir(resXmlDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(resXmlDir, 'shortcuts.xml'),
        shortcutsXml(packageName),
      );
      return config;
    },
  ]);
  return config;
};

module.exports = withShortcuts;
module.exports.applyShortcutsMetaData = applyShortcutsMetaData;
module.exports.applyShortcutStrings = applyShortcutStrings;
module.exports.shortcutsXml = shortcutsXml;

# Hammer Lane Co Privacy Policy (DRAFT — needs a public URL and Larry's confirmed contact email before Play submission)

Last updated: [date of publication]

Hammer Lane Co ("the app") is a truck-driver navigation and information app. It has no user accounts and no advertising.

## What the app uses, and why

**Location.** Hammer Lane Co uses your device's precise and approximate location to show you on the map, find nearby truck stops and weigh stations, and provide navigation. Location is used while you use the app.

**When location leaves your phone.** To make search and routing work, the app sends:
- Your search text and, where needed for results, coordinates to OpenStreetMap's Nominatim search service (nominatim.openstreetmap.org).
- Your start and destination coordinates to the Valhalla routing service (valhalla1.openstreetmap.de) to calculate a truck route.
- Map tile requests to OpenStreetMap tile servers, which is how the map itself loads.
These services receive the request data needed to answer; Hammer Lane Co does not send them your name, email, or any account identifier (the app has none).

**Stored on your phone only.** Your saved places, your truck profile (height/weight), and your navigation settings are stored on your device (AsyncStorage) and are not uploaded to us. Deleting the app deletes them.

**What Hammer Lane Co does NOT collect.** No name, email, phone number, contacts, photos, payment information, advertising ID, or analytics. There is no Hammer Lane Co server account database.

## Data safety answers for Play Console (prepared from the code, 2026-10-15)
- Location — Precise + Approximate: Collected? Google counts data sent off-device to the search/routing services above, so declare location as shared with service providers for App functionality. Not used for advertising or analytics. Not linked to identity (no account).
- Personal info: None collected.
- Financial info: None. App activity / diagnostics: None collected by the app in v1.
- Data encrypted in transit: Yes — all services above are HTTPS.
- Data deletion: No account exists; on-device data is removed by uninstalling or clearing app storage. (If a subscription is added later via Play Billing, update this section.)

## One mismatch to fix before submitting declarations
app.json's expo-location plugin text says Hammer Lane Co "uses your location in the background to warn you about upcoming weigh stations," but the Android permissions in app.json are only ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION — no background-location permission is requested. Either (a) drop/adjust that plugin wording so the listing and the app agree, or (b) if background weigh-station alerts are actually planned, know Google requires a separate background-location declaration, a demo video, and prominent disclosure — it is the most-scrutinized Play permission and slows review. Recommendation: launch without background location.

## Contact
Questions: [Larry to confirm the contact email to publish — do not guess. larryharris1233@gmail.com runs his stores, but he should confirm he wants it as the Play developer contact too.]
Developer name on the listing: [as on the Play Console account Larry creates]

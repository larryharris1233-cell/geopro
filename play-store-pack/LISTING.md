# Hammer Lane Co — Google Play listing pack (DRAFT, prepared 2026-10-15)

Status: draft for Larry's approval. Nothing has been submitted to Google.
App facts verified from the project on 2026-10-15:
- App name: Hammer Lane Co · Package: com.geopro.app · Version: 1.0.0
- EAS production profile already builds an Android App Bundle (app-bundle) — the format Play requires. Preview builds are APKs and must NOT be uploaded to Play.
- Expo SDK 57 / React Native 0.86.3. Play currently requires new apps to target API 36 (Android 16) — confirm the production AAB's target API in Play Console on upload; if it reports 35, that's a build-config fix before the closed test can start, and uploading a fixed build does not reset the tester clock.

## Store listing copy (paste-ready)

**App name (30 char max):** Hammer Lane Co — Trucker GPS & Stops

**Short description (80 char max):**
Truck routes, stops, weigh stations & diesel — built by a trucker, for truckers.

**Full description:**
Hammer Lane Co is a trucker companion built for life on US highways — dark, glove-friendly, and made to be read at a glance in the cab.

• Truck-aware routing: plan routes costed for your rig. Set your truck profile once (height and weight — defaults 13'6" / 80,000 lbs) and routes plan around it. Routing is a planning aid only — posted signs and restrictions always win.
• Turn-by-turn navigation with voice guidance (3 voices), auto-reroute, zoom-on-turn, and your choice of route-line color and truck icon.
• Map your way: street map or satellite view, address search, and saved places you can jump back to.
• Truck stops: 60 Pilot/Flying J, Love's, TA/Petro stops along I-70, I-40, I-80, I-35, I-95 and I-10, with amenities and exit info.
• Weigh stations: 25 stations and ports of entry, with open/closed status you can track.
• Diesel snapshot: weekly US average and regional diesel prices so you can plan fuel stops.

No account needed. Your saved places, truck profile, and settings stay on your phone.

Hammer Lane Co is built by a working truck driver. Drive safe — never use the app in a way that distracts you from the road.

**Category:** Maps & Navigation
**Tags:** truck GPS, truck stops, weigh stations, diesel prices, truck routing

## Pricing decision (Larry's call, not yet made)
- Recommended in the 2026-10-15 chat: subscription $4.99–$9.99/month (Google keeps 15%), or free + paid upgrade.
- Honest blocker to note before charging: in-app subscriptions require Google Play Billing integration, which the app does not have yet (v1 has no payments). A paid-upfront listing avoids billing code but is a harder sell with no reviews. Simplest launch path: free listing for the closed test + early reviews, add billing/subscription in an update. Larry decides.

## Assets still needed
- 512×512 icon (the app icon exists in assets/images/icon.png — export at 512).
- Feature graphic 1024×500 (not yet made — can be built from the logo/icon art).
- Phone screenshots: minimum 2, recommend 6–8 (map, route result, turn-by-turn, stops list, weigh stations, fuel, More/nav settings, My Truck profile). Take them from the current fixed build, not an old one.
- Privacy policy public URL (see PRIVACY-POLICY.md — needs hosting; the Reel Frights / Hammer Lane Shopify pages or a free GitHub Pages page can host it).

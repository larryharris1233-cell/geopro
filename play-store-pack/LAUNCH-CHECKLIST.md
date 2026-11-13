# Hammer Lane Co — Play Store launch checklist (prepared 2026-10-15)

The real order. Larry's taps are marked [LARRY]; everything else is drafted or can be prepared for him.

## 1. Before the Console ($0 prep, do while bugs finish)
- [x] Store listing copy drafted — LISTING.md
- [x] Privacy policy + Data safety answers drafted — PRIVACY-POLICY.md
- [ ] [LARRY] Confirm the public contact email for the listing + privacy policy
- [ ] Host the privacy policy at a public URL (Shopify page or GitHub Pages) and paste the URL into both the policy and Play Console
- [ ] Fix the background-location wording mismatch in app.json (see PRIVACY-POLICY.md) — or decide deliberately to seek background location
- [ ] Feature graphic (1024×500) + 6–8 screenshots from the current build
- [ ] Decide pricing model (free-first recommended; subscription needs Play Billing code that v1 doesn't have)

## 2. Play Console account [LARRY]
- [ ] Create Google Play Console developer account — $25 one-time, personal account, ID verification is his step (he types his own private details, as always)
- [ ] Package com.geopro.app is permanent once published — it's already the package in app.json, no change wanted

## 3. First upload
- [ ] Build production AAB with EAS (production profile already outputs app-bundle — do NOT upload a preview APK)
- [ ] Confirm in Console the AAB targets API 36 (Android 16) — required for new apps since Aug 31, 2026; if it shows 35, fix build config first
- [ ] Create the app in Console, paste listing copy, upload icon/feature graphic/screenshots
- [ ] Complete: Data safety form (answers in PRIVACY-POLICY.md), content rating questionnaire (expect Everyone; maps/nav, no user content in v1), target audience (18+ / not designed for children), ads declaration (no ads in v1)

## 4. Closed test — the gate that sets the launch date
- New personal accounts (created after Nov 13, 2023) must run a closed test with **at least 12 testers opted in continuously for 14 days** before applying for production. Internal testing does NOT count; it must be the closed track.
- Recruit 14–15, not exactly 12: if the count drops below 12 (a tester leaves the test), the continuous clock is at risk. Uninstalling the app does NOT remove a tester — leaving the test in the Play Store does. Tell testers: "please don't tap Leave for 2 weeks."
- Uploading a fixed build mid-test does NOT reset the clock — the clock counts testers, not builds. So bug fixes can ship to testers during the 14 days.
- Tester sources: trucker friends/family with Android phones + Gmail accounts. Emulators/bots don't count.
- After day 14: answer the production-access questionnaire (what testers did, what feedback changed, why the app is ready) — the bug-fix history from Oct 2026 is real material for those answers. Review is usually ~7 days or less.

## 5. Money (after launch, separate step)
- Subscription ($4.99–$9.99/mo suggested) requires integrating Google Play Billing + a subscriptions setup in Console; Google keeps 15%. Not a launch blocker if v1 launches free.
- Cost warning already given to Larry: the free public Valhalla routing + Nominatim search are light-use services. Fine for test/launch; real sales volume means switching to a paid routing provider (small monthly cost that grows with users).

## Earliest realistic timeline (if account created this week)
Console + upload: a few days of part-time work → 14-day closed test → ~7-day production review.
Public launch is roughly 3–4 weeks after the Console account exists, even if every bug were fixed today. The 14-day test is why recruiting testers should start now, in parallel with the routing retest.

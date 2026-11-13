// One-shot handoff for the "Route home" launcher shortcut
// (build #21): the deep link hammerlaneco://route-home lands on the
// app/route-home.tsx route, which records the request here and
// redirects to the Map tab. The Map screen consumes it on focus and
// starts truck navigation to the saved home (constants/home.ts).
let pending = false;

export function requestRouteHome() {
  pending = true;
}

export function takeRouteHomeRequest(): boolean {
  const p = pending;
  pending = false;
  return p;
}

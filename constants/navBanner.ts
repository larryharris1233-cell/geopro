// Turn-banner state shared between the Map screen and the tab
// layout (build #22, item 3). While turn-by-turn navigation is up,
// the Map pins its turn banner to the very top of the screen and
// the tab layout hides its "Hammerlaneco" header so nothing sits
// above the banner — Larry, Nov 9: "Move turn by to to very very
// top. Remove hammerlaneco." Same plain module-level store shape
// as constants/pipState.ts.
let bannerUp = false;
const listeners = new Set<(value: boolean) => void>();

export function setNavBannerUp(value: boolean) {
  if (bannerUp === value) return;
  bannerUp = value;
  for (const fn of listeners) fn(value);
}

export function getNavBannerUp(): boolean {
  return bannerUp;
}

export function subscribeNavBannerUp(
  fn: (value: boolean) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

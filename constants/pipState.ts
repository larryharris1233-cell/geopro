// Picture-in-picture state shared between the Map screen (which
// detects it, via the hammerlane-pip module poll) and the tab layout
// (which must hide the tab bar + header while the PiP window is up —
// build #21: Larry's mini window showed the whole app chrome, tab
// bar included, instead of just the navigation map). A plain
// module-level store with listeners; no state library needed.
let inPip = false;
const listeners = new Set<(value: boolean) => void>();

export function setInPip(value: boolean) {
  if (inPip === value) return;
  inPip = value;
  for (const fn of listeners) fn(value);
}

export function getInPip(): boolean {
  return inPip;
}

export function subscribeInPip(fn: (value: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

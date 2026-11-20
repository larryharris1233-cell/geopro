// One-shot handoff from the Truck Stops tab to the Map tab: the stop the
// driver tapped "Directions" on. The Map screen consumes it on focus and
// shows the usual address card (Save / Truck route) for that stop.

export interface PendingNav {
  name: string;
  latitude?: number;
  longitude?: number;
  query?: string;
}

let pending: PendingNav | null = null;

export function setPendingNav(dest: PendingNav) {
  pending = dest;
}

export function takePendingNav(): PendingNav | null {
  const p = pending;
  pending = null;
  return p;
}

import { requireNativeModule } from 'expo-modules-core';

// Local native module (modules/hammerlane-pip): Android
// picture-in-picture for the navigation map. Google Maps behavior —
// while turn-by-turn navigation is running, leaving the app shrinks
// it into a small floating window that keeps navigating instead of
// disappearing.
//
// Every call is guarded: on any platform or build where the native
// side is missing (web, an install from before this module existed),
// the functions no-op instead of crashing.
export interface PipWindowState {
  inPip: boolean;
  multiWindow: boolean;
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
}

interface HammerlanePipNative {
  isSupported?: () => boolean;
  setArmed?: (armed: boolean) => void;
  enterPip?: () => boolean;
  isInPip?: () => boolean;
  windowState?: () => PipWindowState | null;
}

let nativeModule: HammerlanePipNative | null = null;
try {
  nativeModule = requireNativeModule('HammerlanePip');
} catch {
  nativeModule = null;
}

export function isPipSupported(): boolean {
  try {
    return nativeModule?.isSupported?.() ?? false;
  } catch {
    return false;
  }
}

/** Arm/disarm PiP. Armed only while navigating — see the Kotlin side. */
export function setPipArmed(armed: boolean): void {
  try {
    nativeModule?.setArmed?.(armed);
  } catch {
    // PiP is a nicety — never let it take the app down.
  }
}

/** Ask the native side to enter PiP right now. Returns success. */
export function enterPip(): boolean {
  try {
    return nativeModule?.enterPip?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether the activity is currently in picture-in-picture.
 * Build #21: the JS side polls this while navigating so the app can
 * swap to the nav-only PiP layout (map + compact turn banner, no
 * tab bar / search bar / chrome) exactly while the mini window is
 * up, and restore the full layout on exit.
 */
export function isInPip(): boolean {
  try {
    return nativeModule?.isInPip?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Build #23: the native window state — system PiP flag, multi-
 * window flag, and the ACTUAL window bounds vs the physical
 * screen. Samsung's pop-up view never sets the PiP flag, so the
 * Map screen polls this to detect ANY shrunken window (PiP,
 * pop-up view, split-screen) and swap to the map-only layout.
 * Returns null on any build/platform without the native side.
 */
export function getWindowState(): PipWindowState | null {
  try {
    return nativeModule?.windowState?.() ?? null;
  } catch {
    return null;
  }
}

export default { isPipSupported, setPipArmed, enterPip, isInPip, getWindowState };

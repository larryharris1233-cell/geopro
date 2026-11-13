import { requireNativeModule } from 'expo-modules-core';

// Local native module (modules/hammerlane-voice): transient
// ducking audio focus for spoken navigation prompts (build #27,
// item 10). While a prompt speaks, other audio (music, podcasts)
// ducks down system-wide, then comes back when the prompt ends.
//
// Every call is guarded: on any platform or build where the native
// side is missing (web, an install from before this module
// existed), the functions no-op instead of crashing.

interface HammerlaneVoiceNative {
  requestDuckFocus?: () => boolean;
  abandonDuckFocus?: () => void;
}

let nativeModule: HammerlaneVoiceNative | null = null;
try {
  nativeModule = requireNativeModule('HammerlaneVoice');
} catch {
  nativeModule = null;
}

/** Duck other audio while a prompt speaks. Returns true if granted. */
export function duckOtherAudio(): boolean {
  try {
    return nativeModule?.requestDuckFocus?.() ?? false;
  } catch {
    return false;
  }
}

/** Hand the audio back after the prompt finishes. */
export function releaseDuckedAudio(): void {
  try {
    nativeModule?.abandonDuckFocus?.();
  } catch {
    // Focus release is best-effort — never let it take the app down.
  }
}

export default { duckOtherAudio, releaseDuckedAudio };

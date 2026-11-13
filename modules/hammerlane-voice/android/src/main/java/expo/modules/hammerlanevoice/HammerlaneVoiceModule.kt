package expo.modules.hammerlanevoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Audio focus for spoken navigation prompts (build #27, item 10).
 *
 * Larry's road-test complaint: turn prompts were too quiet over the
 * cab's Bluetooth — the app pinned utterance volume to 1.0 and it
 * still lost to whatever else was playing. The platform fix is
 * audio focus: while a prompt speaks, the app holds a TRANSIENT
 * MAY_DUCK focus grant tagged with the navigation-guidance usage,
 * so the system ducks (or pauses) other audio — music, podcasts —
 * for exactly the length of the prompt, Google Maps style, then
 * hands the audio back when JS abandons the grant on utterance end.
 *
 * What this is NOT: phone-call (SCO/HFP) routing. Android does not
 * let a TTS utterance commandeer the call path, and expo-speech
 * exposes no stream selection — focus + full utterance volume +
 * the in-app volume slider is the loudest honest combination this
 * stack supports.
 */
class HammerlaneVoiceModule : Module() {
  private var focusRequest: AudioFocusRequest? = null

  private fun audioManager(): AudioManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  private fun requestDuck(): Boolean {
    val am = audioManager() ?: return false
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(attrs)
          .setAcceptsDelayedFocusGain(false)
          .build()
        focusRequest = req
        am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(
          null,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
        ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      }
    } catch (e: Exception) {
      false
    }
  }

  private fun abandonDuck() {
    val am = audioManager() ?: return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { am.abandonAudioFocusRequest(it) }
        focusRequest = null
      } else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(null)
      }
    } catch (e: Exception) {
      // Releasing focus must never take the app down.
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HammerlaneVoice")

    /** Hold ducking focus while a prompt speaks. Returns granted. */
    Function("requestDuckFocus") {
      requestDuck()
    }

    /** Hand the audio back when the prompt finishes. */
    Function("abandonDuckFocus") {
      abandonDuck()
    }
  }
}

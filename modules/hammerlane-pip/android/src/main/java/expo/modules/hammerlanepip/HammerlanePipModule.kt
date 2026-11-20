package expo.modules.hammerlanepip

import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Point
import android.os.Build
import android.util.Rational
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Picture-in-picture for the navigation map (build #19).
 *
 * The manifest half (android:supportsPictureInPicture on the main
 * activity) lives in plugins/withPip.js — the android/ folder is
 * generated, so nothing native is edited by hand.
 *
 * JS arms PiP only while turn-by-turn navigation is running. When
 * the activity then leaves the foreground (Home, app switch), it
 * shrinks into the floating window instead of disappearing, and a
 * tap on the window brings the full app back.
 */
class HammerlanePipModule : Module() {
  @Volatile
  private var armed = false

  private fun pipParams(): PictureInPictureParams {
    // Build #32 (item 1): the aspect flips from landscape 16:10
    // to PORTRAIT 10:13. The app is a portrait app and the map
    // lives in its upper ~2/3; a landscape PiP window letterboxes
    // that portrait content and the slice Austin kept getting
    // was the BOTTOM strip (his Nov 20 report, after build #31's
    // source-rect attempt didn't fix it: "when I minimize the
    // screen it still just showing the bottom part"). A portrait
    // window frames the map stack the way the app actually lays
    // out. 10:13 sits inside Android's PiP aspect limits
    // (1:2.39 … 2.39:1).
    val builder = PictureInPictureParams.Builder()
      .setAspectRatio(Rational(10, 13))
    // Build #30 (item 13): aim the PiP transition at the MAP
    // area — the window minus its bottom strip, where the tab
    // bar lives. Austin's Nov 16 screenshot showed the floating
    // window framing the bottom tab-bar strip instead of the
    // map; the source-rect hint is the system's own mechanism
    // for naming which part of the window the mini window is
    // about, and the JS side now swaps to the map-only layout
    // for any shrunken window (see map.tsx). Best-effort: any
    // failure just leaves the hint unset.
    // Build #32: the hint is now measured from the activity's
    // CONTENT VIEW (its real global visible rect) instead of
    // raw display metrics — display pixels include the status
    // and navigation bars the app never draws in, which skewed
    // the #30/#31 hint off the map. The rect is the content's
    // top 82% (the map region above the tab-bar strip), in the
    // absolute screen coordinates setSourceRectHint expects.
    try {
      val activity = appContext.currentActivity
      if (activity != null) {
        val content = activity.window?.decorView?.findViewById<android.view.View>(
          android.R.id.content
        )
        val rect = android.graphics.Rect()
        val visible = content?.getGlobalVisibleRect(rect) ?: false
        if (visible && rect.width() > 0 && rect.height() > 0) {
          builder.setSourceRectHint(
            android.graphics.Rect(
              rect.left,
              rect.top,
              rect.right,
              rect.top + (rect.height() * 0.82).toInt()
            )
          )
        } else {
          val metrics = activity.resources.displayMetrics
          val w = metrics.widthPixels
          val h = metrics.heightPixels
          if (w > 0 && h > 0) {
            builder.setSourceRectHint(
              android.graphics.Rect(0, 0, w, (h * 0.82).toInt())
            )
          }
        }
      }
    } catch (e: Exception) {
      // Hint is a nicety — PiP itself must not fail over it.
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+: with auto-enter set while armed, the system
      // glides into PiP on the home gesture by itself.
      builder.setAutoEnterEnabled(armed)
      builder.setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  private fun tryEnterPip(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val activity = appContext.currentActivity ?: return false
    if (activity.isFinishing || activity.isDestroyed) return false
    if (activity.isInPictureInPictureMode) return true
    return try {
      activity.enterPictureInPictureMode(pipParams())
    } catch (e: Exception) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HammerlanePip")

    // Fires while the activity is pausing — the documented window
    // for entering PiP. If navigation armed PiP, the app shrinks
    // into the floating window instead of leaving the screen.
    OnActivityEntersBackground {
      if (armed) tryEnterPip()
    }

    // Build #32: every time the activity comes back to the
    // foreground while PiP is armed, re-apply the params — the
    // portrait aspect + content-measured source rect are then
    // always fresh when the next minimize gesture lands, instead
    // of depending on when JS last toggled the armed flag.
    OnActivityEntersForeground {
      if (armed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val activity = appContext.currentActivity
        if (activity != null && !activity.isFinishing) {
          try {
            activity.setPictureInPictureParams(pipParams())
          } catch (e: Exception) {
            // The pause-path entry in tryEnterPip still works
            // without pre-applied params.
          }
        }
      }
    }

    Function("isSupported") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val context = appContext.reactContext ?: return@Function false
      context.packageManager.hasSystemFeature(
        PackageManager.FEATURE_PICTURE_IN_PICTURE
      )
    }

    Function("setArmed") { next: Boolean ->
      armed = next
      // Pre-apply the params so Android 12+ auto-enter is ready
      // before the home gesture happens.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val activity = appContext.currentActivity
        if (activity != null && !activity.isFinishing) {
          try {
            activity.setPictureInPictureParams(pipParams())
          } catch (e: Exception) {
            // The pause-path entry in tryEnterPip still works
            // without pre-applied params.
          }
        }
      }
    }

    Function("enterPip") {
      tryEnterPip()
    }

    // Build #21: JS polls this while navigating to drive the
    // nav-only PiP layout (map + compact turn banner only).
    Function("isInPip") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      if (activity.isFinishing || activity.isDestroyed) return@Function false
      activity.isInPictureInPictureMode
    }

    // Build #23: Samsung (and a few other OEMs) DON'T use system
    // picture-in-picture when the driver shrinks the app — One UI
    // puts it in a freeform "pop-up view" window instead, where
    // isInPictureInPictureMode stays false forever (builds #21/#22
    // keyed their whole mini layout off it, so their swap never
    // fired on Larry's phone). Multi-window mode + a window notably
    // smaller than the physical screen is the reliable signal for
    // BOTH window kinds, so JS polls this too and treats either as
    // "minimized".
    Function("windowState") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return@Function null
      val activity = appContext.currentActivity ?: return@Function null
      if (activity.isFinishing || activity.isDestroyed) return@Function null
      val inPipMode =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          activity.isInPictureInPictureMode
      val multi = activity.isInMultiWindowMode
      val metrics = activity.resources.displayMetrics
      val screenW = metrics.widthPixels
      val screenH = metrics.heightPixels
      var winW = screenW
      var winH = screenH
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        try {
          val bounds = activity.windowManager.currentWindowMetrics.bounds
          winW = bounds.width()
          winH = bounds.height()
        } catch (e: Exception) {
          // Fall through with the full-screen size.
        }
      } else {
        try {
          // Display.getSize wants android.graphics.Point, NOT
          // android.util.Size (different overloads) — passing Size
          // failed the release Kotlin compile on the first #23
          // submission. Point it is.
          val point = Point()
          @Suppress("DEPRECATION")
          activity.windowManager.defaultDisplay.getSize(point)
          winW = point.x
          winH = point.y
        } catch (e: Exception) {
          // Fall through with the full-screen size.
        }
      }
      mapOf<String, Any>(
        "inPip" to inPipMode,
        "multiWindow" to multi,
        "windowWidth" to winW,
        "windowHeight" to winH,
        "screenWidth" to screenW,
        "screenHeight" to screenH,
      )
    }
  }
}

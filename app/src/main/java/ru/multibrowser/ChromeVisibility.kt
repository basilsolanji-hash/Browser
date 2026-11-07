package ru.multibrowser

import android.view.View

/** Automatic hiding must not resize/reposition the page under an active finger or fling. */
internal object ChromeVisibility {
    fun autoHidden(views: List<View>, hidden: Boolean) {
        // Keep the measured toolbar space. GONE changes CSS viewport/nested scroll layout,
        // which can move the reading position independently of the user's swipe.
        views.forEach { it.visibility = if (hidden) View.INVISIBLE else View.VISIBLE }
    }
}

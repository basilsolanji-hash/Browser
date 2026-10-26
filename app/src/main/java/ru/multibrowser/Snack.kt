package ru.multibrowser

import android.app.Activity
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Короткая подсказка внизу экрана с кнопкой действия — как «Открыто в новой вкладке · Перейти» в Chrome.
 * Одна за раз: новая заменяет прежнюю; сама прячется через 4 секунды.
 */
object Snack {
    private const val TAG = "os_snack"
    private const val SHOW_MS = 4000L

    fun show(a: Activity, message: String, action: String, onAction: () -> Unit) {
        val root = a.findViewById<FrameLayout>(android.R.id.content) ?: return
        root.findViewWithTag<View>(TAG)?.let { root.removeView(it) }
        val bar = LinearLayout(a).apply {
            tag = TAG
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.TEXT, a.dpf(12))
            elevation = a.dpf(8)
            setPadding(a.dp(18), a.dp(4), a.dp(6), a.dp(4))
            minimumHeight = a.dp(52)
            addView(TextView(a).apply {
                text = message
                textSize = 14f
                setTextColor(Ui.SURFACE)
                maxLines = 2
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(a).apply {
                text = action
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.ACCENT)
                gravity = Gravity.CENTER
                minWidth = a.dp(64)
                minHeight = a.dp(44)
                setPadding(a.dp(12), 0, a.dp(12), 0)
                setOnClickListener {
                    root.removeView(this@apply.parent as View)
                    onAction()
                }
            })
        }
        root.addView(bar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM).apply { setMargins(a.dp(12), 0, a.dp(12), a.dp(96)) })
        bar.announceForAccessibility(message)
        bar.postDelayed({ if (bar.parent != null) root.removeView(bar) }, SHOW_MS)
    }
}

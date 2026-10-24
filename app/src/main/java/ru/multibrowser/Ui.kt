package ru.multibrowser

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.View
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Палитра и общие элементы интерфейса в стиле knitERP: тёмный фон, бирюзовый акцент. */
object Ui {
    val BG = 0xFF1B1B1D.toInt()
    val SURFACE = 0xFF232326.toInt()
    val BORDER = 0xFF34343A.toInt()
    val TEXT = 0xFFE8E8EA.toInt()
    val MUTED = 0xFF9A9AA2.toInt()
    val ACCENT = 0xFF2BA89A.toInt()
    val ON_ACCENT = 0xFF0F1F1D.toInt()

    fun rounded(color: Int, radius: Float, strokeWidth: Int = 0, strokeColor: Int = BORDER) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius
            if (strokeWidth > 0) setStroke(strokeWidth, strokeColor)
        }

    fun oval(color: Int, strokeWidth: Int = 0, strokeColor: Int = TEXT) =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
            if (strokeWidth > 0) setStroke(strokeWidth, strokeColor)
        }
}

fun Context.dp(v: Int) = (v * resources.displayMetrics.density).toInt()
fun Context.dpf(v: Int) = v * resources.displayMetrics.density

/** «Ось» белым + «Browser» акцентом, как «knitERP». */
fun Context.logoText() = TextView(this).apply {
    val s = SpannableString("ОсьBrowser")
    s.setSpan(ForegroundColorSpan(Ui.ACCENT), 3, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text = s
    textSize = 20f
    setTextColor(Ui.TEXT)
    typeface = Typeface.DEFAULT_BOLD
}

/**
 * Android 15 рисует приложение под системными панелями; отступаем от них
 * (и от клавиатуры) сами, а значки панелей делаем светлыми под тёмный фон.
 */
fun Activity.applyEdgeToEdge(root: View) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, root).apply {
        isAppearanceLightStatusBars = false
        isAppearanceLightNavigationBars = false
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsetsCompat.CONSUMED
    }
}

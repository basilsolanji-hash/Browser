package ru.multibrowser

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Палитра и общие элементы интерфейса в стиле knitERP: бирюзовый акцент, тёмная или светлая тема. */
object Ui {
    var dark = true
        private set
    var BG = 0
        private set
    var SURFACE = 0
        private set
    var BORDER = 0
        private set
    var TEXT = 0
        private set
    var MUTED = 0
        private set
    var ACCENT = 0
        private set
    var ON_ACCENT = 0
        private set

    /** Вызывается в onCreate каждого экрана: тема уже применена AppCompat. */
    fun init(ctx: Context) {
        dark = (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        if (dark) {
            BG = 0xFF1B1B1D.toInt(); SURFACE = 0xFF232326.toInt(); BORDER = 0xFF34343A.toInt()
            TEXT = 0xFFE8E8EA.toInt(); MUTED = 0xFF9A9AA2.toInt()
            ACCENT = 0xFF2BA89A.toInt(); ON_ACCENT = 0xFF0F1F1D.toInt()
        } else {
            BG = 0xFFF5F5F7.toInt(); SURFACE = 0xFFFFFFFF.toInt(); BORDER = 0xFFDADADF.toInt()
            TEXT = 0xFF1B1B1D.toInt(); MUTED = 0xFF6B6B73.toInt()
            ACCENT = 0xFF1F8F83.toInt(); ON_ACCENT = 0xFFFFFFFF.toInt()
        }
    }

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

/**
 * Android 15 рисует приложение под системными панелями; отступаем от них
 * (и от клавиатуры) сами, а цвет значков панелей подбираем под тему.
 */
fun Activity.applyEdgeToEdge(root: View) {
    // Для языков с письмом справа налево (арабский) разворачиваем интерфейс.
    root.layoutDirection = if (Tr.isRtl()) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, root).apply {
        isAppearanceLightStatusBars = !Ui.dark
        isAppearanceLightNavigationBars = !Ui.dark
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
        v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsetsCompat.CONSUMED
    }
}

/** Заголовок раздела настроек. */
fun Context.sectionTitle(text: String) = TextView(this).apply {
    this.text = text.uppercase()
    textSize = 12f
    typeface = Typeface.DEFAULT_BOLD
    letterSpacing = 0.06f
    setTextColor(Ui.MUTED)
    setPadding(0, dp(24), 0, dp(8))
}

/** Векторная иконка, окрашенная под тему. */
fun Context.icon(res: Int, color: Int = Ui.TEXT, sizeDp: Int = 22) = ImageView(this).apply {
    setImageResource(res)
    imageTintList = ColorStateList.valueOf(color)
    scaleType = ImageView.ScaleType.CENTER_INSIDE
    layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
}

/** Квадратная кнопка с иконкой в рамке. */
fun Context.iconButton(res: Int, description: String, onClick: (View) -> Unit) = FrameLayout(this).apply {
    background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
    contentDescription = description
    addView(icon(res).apply {
        layoutParams = FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER)
    })
    setOnClickListener(onClick)
}

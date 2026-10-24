package ru.multibrowser

import android.content.Context
import android.content.res.Configuration

/** Палитра одной темы. */
class Palette(
    val dark: Boolean,
    val bg: Int, val surface: Int, val border: Int,
    val text: Int, val muted: Int, val accent: Int, val onAccent: Int,
)

/** Деловой стиль: тёплый алый акцент. Шесть готовых тем на выбор пользователя. */
object Themes {
    // id -> (ключ названия для Tr, строит палитру)
    val IDS = listOf("scarlet_dark", "scarlet_light", "graphite", "sand", "oled", "system")

    fun nameKey(id: String) = when (id) {
        "scarlet_dark" -> "theme_scarlet_dark"
        "scarlet_light" -> "theme_scarlet_light"
        "graphite" -> "theme_graphite"
        "sand" -> "theme_sand"
        "oled" -> "theme_oled"
        else -> "system"
    }

    private val SCARLET_DARK = Palette(true,
        0xFF17181B.toInt(), 0xFF212227.toInt(), 0xFF33353C.toInt(),
        0xFFECEDEF.toInt(), 0xFF9BA0A8.toInt(), 0xFFF0453A.toInt(), 0xFFFFFFFF.toInt())
    private val SCARLET_LIGHT = Palette(false,
        0xFFF6F5F4.toInt(), 0xFFFFFFFF.toInt(), 0xFFE2DEDA.toInt(),
        0xFF1B1A19.toInt(), 0xFF6B6760.toInt(), 0xFFD92D20.toInt(), 0xFFFFFFFF.toInt())
    private val GRAPHITE = Palette(true,
        0xFF101114.toInt(), 0xFF1A1C20.toInt(), 0xFF2B2E35.toInt(),
        0xFFE6E8EC.toInt(), 0xFF8E939C.toInt(), 0xFFE5533D.toInt(), 0xFFFFFFFF.toInt())
    private val SAND = Palette(false,
        0xFFF6F1E9.toInt(), 0xFFFFFDF8.toInt(), 0xFFE6DDCF.toInt(),
        0xFF2A2621.toInt(), 0xFF7A7064.toInt(), 0xFFC2410C.toInt(), 0xFFFFFFFF.toInt())
    private val OLED = Palette(true,
        0xFF000000.toInt(), 0xFF0D0E10.toInt(), 0xFF24262B.toInt(),
        0xFFEDEDED.toInt(), 0xFF8A8A90.toInt(), 0xFFFF3B30.toInt(), 0xFFFFFFFF.toInt())

    fun palette(ctx: Context, id: String): Palette = when (id) {
        "scarlet_light" -> SCARLET_LIGHT
        "graphite" -> GRAPHITE
        "sand" -> SAND
        "oled" -> OLED
        "system" -> if (systemDark(ctx)) SCARLET_DARK else SCARLET_LIGHT
        else -> SCARLET_DARK
    }

    private fun systemDark(ctx: Context) =
        (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
}

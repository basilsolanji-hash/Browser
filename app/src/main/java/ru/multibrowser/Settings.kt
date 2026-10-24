package ru.multibrowser

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

object Settings {
    const val MIN_PROFILES = 1
    const val MAX_PROFILES = 50
    private const val DEFAULT_PROFILES = 15

    private fun prefsHasTheme(ctx: Context) = prefs(ctx).contains("theme_id")

    fun themeId(ctx: Context): String {
        val p = prefs(ctx)
        // Миграция со старых значений DARK/LIGHT/SYSTEM.
        if (!p.contains("theme_id") && p.contains("theme")) {
            val old = p.getString("theme", "DARK")
            val mapped = when (old) { "LIGHT" -> "scarlet_light"; "SYSTEM" -> "system"; else -> "scarlet_dark" }
            p.edit().putString("theme_id", mapped).apply()
        }
        return p.getString("theme_id", "scarlet_dark") ?: "scarlet_dark"
    }

    fun setThemeId(ctx: Context, id: String) {
        prefs(ctx).edit().putString("theme_id", id).apply()
        applyTheme(ctx)
    }

    /** Ночной режим AppCompat (для диалогов) и цветовая схема сайтов — по выбранной теме. */
    fun applyTheme(ctx: Context) {
        val id = themeId(ctx)
        AppCompatDelegate.setDefaultNightMode(
            when (id) {
                "system" -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
                "scarlet_light", "sand" -> AppCompatDelegate.MODE_NIGHT_NO
                else -> AppCompatDelegate.MODE_NIGHT_YES
            }
        )
        Gecko.applyColorScheme(ctx)
    }
}

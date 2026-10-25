package ru.multibrowser

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

object Settings {
    const val MIN_PROFILES = 1
    const val MAX_PROFILES = 50
    private const val DEFAULT_PROFILES = 15

    enum class BarPosition(val title: String) {
        TOP("Сверху"),
        BOTTOM("Снизу"),
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun profileCount(ctx: Context) =
        prefs(ctx).getInt("count", DEFAULT_PROFILES).coerceIn(MIN_PROFILES, MAX_PROFILES)

    fun setProfileCount(ctx: Context, n: Int) {
        prefs(ctx).edit().putInt("count", n.coerceIn(MIN_PROFILES, MAX_PROFILES)).apply()
    }

    /** Сколько вкладок держать «живыми» в памяти; варианты для переключателя в настройках. */
    val KEEP_ALIVE_OPTIONS = listOf(3, 6, 10, 15)

    fun keepAlive(ctx: Context) = prefs(ctx).getInt("keep_alive", 6)

    fun setKeepAlive(ctx: Context, n: Int) {
        prefs(ctx).edit().putInt("keep_alive", n).apply()
    }

    /** Полоса быстрого переключения профилей внизу браузера (по умолчанию скрыта). */
    fun showSwitcher(ctx: Context) = prefs(ctx).getBoolean("switcher", false)

    fun setShowSwitcher(ctx: Context, show: Boolean) {
        prefs(ctx).edit().putBoolean("switcher", show).apply()
    }

    /** Вход в приложение по отпечатку/PIN телефона — по умолчанию включён. */
    fun lockEnabled(ctx: Context) = prefs(ctx).getBoolean("lock", true)

    fun setLockEnabled(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("lock", on).apply()
    }

    /** Скрывать содержимое в недавних приложениях и запрещать скриншоты. */
    fun hideContent(ctx: Context) = prefs(ctx).getBoolean("secure", false)

    fun setHideContent(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("secure", on).apply()
    }

    /** Кнопка нижней панели между «Историей» и «Обновить» (раньше всегда «Очистка»). */
    val BOTTOM_BUTTONS = listOf("downloads", "clear", "favorites", "tabs", "notes", "saved", "share", "find")

    fun bottomButton(ctx: Context): String =
        prefs(ctx).getString("bottom_button", null)?.takeIf { it in BOTTOM_BUTTONS } ?: "downloads"

    fun setBottomButton(ctx: Context, id: String) {
        prefs(ctx).edit().putString("bottom_button", id).apply()
    }

    /** Только HTTPS: незащищённые адреса повышаются до HTTPS, без него сайт не откроется. */
    fun httpsOnly(ctx: Context) = prefs(ctx).getBoolean("https_only", false)

    fun setHttpsOnly(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("https_only", on).apply()
        Gecko.applyHttpsOnly(ctx)
    }

    /** Прятать панели браузера при прокрутке. */
    fun autoHideBars(ctx: Context) = prefs(ctx).getBoolean("autohide", true)

    fun setAutoHideBars(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("autohide", on).apply()
    }

    fun zoom(ctx: Context): Int = prefs(ctx).getInt("zoom", 100)

    fun setZoom(ctx: Context, percent: Int) {
        prefs(ctx).edit().putInt("zoom", percent.coerceIn(50, 250)).apply()
        Gecko.applyZoom(ctx)
    }

    fun language(ctx: Context): String = prefs(ctx).getString("lang", "system") ?: "system"

    fun setLanguage(ctx: Context, code: String) {
        prefs(ctx).edit().putString("lang", code).apply()
        Tr.apply(ctx)
    }

    fun barPosition(ctx: Context): BarPosition =
        runCatching { BarPosition.valueOf(prefs(ctx).getString("bar", null)!!) }.getOrDefault(BarPosition.TOP)

    fun setBarPosition(ctx: Context, position: BarPosition) {
        prefs(ctx).edit().putString("bar", position.name).apply()
    }

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
        AppCompatDelegate.setDefaultNightMode(
            when (themeId(ctx)) {
                "system" -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
                "scarlet_light", "sand" -> AppCompatDelegate.MODE_NIGHT_NO
                else -> AppCompatDelegate.MODE_NIGHT_YES
            }
        )
        Gecko.applyColorScheme(ctx)
    }
}

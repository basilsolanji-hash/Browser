package ru.multibrowser

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

object Settings {
    const val MIN_PROFILES = 1
    const val MAX_PROFILES = 50
    private const val DEFAULT_PROFILES = 15

    enum class Theme(val title: String) {
        DARK("Тёмная"),
        LIGHT("Светлая"),
        SYSTEM("Как в системе"),
    }

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

    /** Прятать панели браузера при прокрутке. */
    fun autoHideBars(ctx: Context) = prefs(ctx).getBoolean("autohide", true)

    fun setAutoHideBars(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("autohide", on).apply()
    }

    fun theme(ctx: Context): Theme =
        runCatching { Theme.valueOf(prefs(ctx).getString("theme", null)!!) }.getOrDefault(Theme.DARK)

    fun setTheme(ctx: Context, theme: Theme) {
        prefs(ctx).edit().putString("theme", theme.name).apply()
        applyTheme(ctx)
    }

    fun barPosition(ctx: Context): BarPosition =
        runCatching { BarPosition.valueOf(prefs(ctx).getString("bar", null)!!) }.getOrDefault(BarPosition.TOP)

    fun setBarPosition(ctx: Context, position: BarPosition) {
        prefs(ctx).edit().putString("bar", position.name).apply()
    }

    /** Тема приложения (AppCompat пересоздаст открытые экраны) и цветовая схема сайтов. */
    fun applyTheme(ctx: Context) {
        val theme = theme(ctx)
        AppCompatDelegate.setDefaultNightMode(
            when (theme) {
                Theme.DARK -> AppCompatDelegate.MODE_NIGHT_YES
                Theme.LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
                Theme.SYSTEM -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            }
        )
        Gecko.applyColorScheme(theme)
    }
}

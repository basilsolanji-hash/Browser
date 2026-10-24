package ru.multibrowser

import android.content.Context

/**
 * Статистика для самого пользователя (экран в настройках). Считается только на устройстве
 * и никуда не отправляется: открытые страницы по профилям, заблокированные трекеры, дата начала.
 */
object Stats {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("stats", Context.MODE_PRIVATE)

    // Трекеров на странице бывают десятки — копим в памяти и пишем пачками.
    private var pendingTrackers = 0

    fun since(ctx: Context): Long {
        val p = prefs(ctx)
        return p.getLong("since", 0L).takeIf { it > 0 } ?: System.currentTimeMillis().also {
            p.edit().putLong("since", it).apply()
        }
    }

    fun pages(ctx: Context, id: Int) = prefs(ctx).getInt("pages_$id", 0)

    fun page(ctx: Context, id: Int) {
        since(ctx)
        prefs(ctx).edit().putInt("pages_$id", pages(ctx, id) + 1).apply()
    }

    @Synchronized
    fun trackerBlocked(ctx: Context) {
        if (++pendingTrackers >= 10) flush(ctx)
    }

    fun trackers(ctx: Context) = prefs(ctx).getLong("trackers", 0L) + pendingTrackers

    @Synchronized
    fun flush(ctx: Context) {
        if (pendingTrackers == 0) return
        val p = prefs(ctx)
        p.edit().putLong("trackers", p.getLong("trackers", 0L) + pendingTrackers).apply()
        pendingTrackers = 0
    }

    @Synchronized
    fun reset(ctx: Context) {
        pendingTrackers = 0
        prefs(ctx).edit().clear().putLong("since", System.currentTimeMillis()).apply()
    }
}

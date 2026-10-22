package ru.multibrowser

import android.content.Context

data class Profile(val id: Int, val name: String, val color: Int)

object Profiles {
    const val COUNT = 15
    const val HOME_URL = "https://mail.google.com/"

    private val COLORS = intArrayOf(
        0xFFE53935.toInt(), 0xFF8E24AA.toInt(), 0xFF3949AB.toInt(), 0xFF1E88E5.toInt(), 0xFF00897B.toInt(),
        0xFF43A047.toInt(), 0xFFF4511E.toInt(), 0xFF6D4C41.toInt(), 0xFF546E7A.toInt(), 0xFFD81B60.toInt(),
        0xFF5E35B1.toInt(), 0xFF039BE5.toInt(), 0xFF7CB342.toInt(), 0xFFFB8C00.toInt(), 0xFF00ACC1.toInt(),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("profiles", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Profile> = (1..COUNT).map { get(ctx, it) }

    fun get(ctx: Context, id: Int) = Profile(
        id,
        prefs(ctx).getString("name_$id", null) ?: "Профиль $id",
        COLORS[(id - 1) % COLORS.size],
    )

    fun rename(ctx: Context, id: Int, name: String) {
        prefs(ctx).edit().putString("name_$id", name.trim()).apply()
    }

    fun lastUrl(ctx: Context, id: Int): String = prefs(ctx).getString("url_$id", null) ?: HOME_URL

    fun saveLastUrl(ctx: Context, id: Int, url: String) {
        if (url.startsWith("http")) prefs(ctx).edit().putString("url_$id", url).apply()
    }
}

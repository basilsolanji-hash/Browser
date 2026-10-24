package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Visit(val url: String, val title: String, val time: Long)

/** История посещений, отдельная для каждого профиля. */
object History {
    private const val MAX = 300

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("history", Context.MODE_PRIVATE)

    fun list(ctx: Context, id: Int): List<Visit> {
        val raw = prefs(ctx).getString("h_$id", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Visit(o.getString("u"), o.optString("t"), o.getLong("d"))
            }
        }.getOrDefault(emptyList())
    }

    fun add(ctx: Context, id: Int, url: String) {
        if (!url.startsWith("http") || url.contains("accounts.google.com")) return
        val items = list(ctx, id)
        if (items.firstOrNull()?.url == url) return
        save(ctx, id, (listOf(Visit(url, "", System.currentTimeMillis())) + items).take(MAX))
        Stats.page(ctx, id)
    }

    fun setTitle(ctx: Context, id: Int, url: String, title: String) {
        val items = list(ctx, id)
        val first = items.firstOrNull() ?: return
        if (first.url != url || first.title == title) return
        save(ctx, id, listOf(first.copy(title = title)) + items.drop(1))
    }

    fun clear(ctx: Context, id: Int) {
        prefs(ctx).edit().remove("h_$id").apply()
    }

    fun clearAll(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    private fun save(ctx: Context, id: Int, items: List<Visit>) {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("u", it.url).put("t", it.title).put("d", it.time)) }
        prefs(ctx).edit().putString("h_$id", arr.toString()).apply()
    }
}

package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Bookmark(val id: String, val title: String, val url: String, val folder: String)

/** Избранное с папками — общее для всех профилей. */
object Bookmarks {
    const val ROOT = ""

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("bookmarks", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Bookmark> {
        val raw = prefs(ctx).getString("list", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Bookmark(o.getString("id"), o.getString("t"), o.getString("u"), o.optString("f"))
            }
        }.getOrDefault(emptyList())
    }

    fun folders(ctx: Context): List<String> =
        all(ctx).map { it.folder }.filter { it.isNotEmpty() }.distinct().sorted()

    fun inFolder(ctx: Context, folder: String) = all(ctx).filter { it.folder == folder }

    fun contains(ctx: Context, url: String) = all(ctx).any { it.url == url }

    fun add(ctx: Context, title: String, url: String, folder: String = ROOT) {
        if (contains(ctx, url)) return
        val b = Bookmark("b" + System.currentTimeMillis(), title.ifBlank { url }, url, folder)
        save(ctx, all(ctx) + b)
    }

    fun remove(ctx: Context, id: String) = save(ctx, all(ctx).filterNot { it.id == id })

    fun move(ctx: Context, id: String, folder: String) =
        save(ctx, all(ctx).map { if (it.id == id) it.copy(folder = folder) else it })

    fun rename(ctx: Context, id: String, title: String) =
        save(ctx, all(ctx).map { if (it.id == id) it.copy(title = title.ifBlank { it.title }) else it })

    private fun save(ctx: Context, items: List<Bookmark>) {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("id", it.id).put("t", it.title).put("u", it.url).put("f", it.folder)) }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }
}

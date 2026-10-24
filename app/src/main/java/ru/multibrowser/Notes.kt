package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Заметка: текст и, если есть, страница, откуда он взят. */
data class Note(val id: Long, val text: String, val url: String, val time: Long)

/**
 * Заметки (№37) — только на этом устройстве (JSON в prefs), без облака и синхронизации.
 * Новые — сверху.
 */
object Notes {
    private const val MAX = 1000

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("notes", Context.MODE_PRIVATE)

    fun list(ctx: Context): List<Note> {
        val raw = prefs(ctx).getString("list", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Note(o.getLong("id"), o.getString("text"), o.optString("url"), o.getLong("time"))
            }
        }.getOrDefault(emptyList())
    }

    fun add(ctx: Context, text: String, url: String = "") {
        val t = text.trim()
        if (t.isEmpty()) return
        val now = System.currentTimeMillis()
        val id = maxOf(now, (list(ctx).maxOfOrNull { it.id } ?: 0) + 1)
        save(ctx, (listOf(Note(id, t, url, now)) + list(ctx)).take(MAX))
    }

    fun update(ctx: Context, id: Long, text: String) {
        val t = text.trim()
        if (t.isEmpty()) return remove(ctx, id)
        save(ctx, list(ctx).map { if (it.id == id) it.copy(text = t, time = System.currentTimeMillis()) else it })
    }

    fun remove(ctx: Context, id: Long) {
        save(ctx, list(ctx).filterNot { it.id == id })
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    private fun save(ctx: Context, items: List<Note>) {
        val arr = JSONArray()
        items.forEach {
            arr.put(JSONObject().put("id", it.id).put("text", it.text).put("url", it.url).put("time", it.time))
        }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }
}

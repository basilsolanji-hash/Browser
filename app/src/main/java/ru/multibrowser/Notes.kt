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
    // commit(false) can still alter SharedPreferences in memory. Never write it back in this process.
    private var writeUncertain = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("notes", Context.MODE_PRIVATE)

    /** A missing key is empty; malformed or unavailable storage is not. */
    @Synchronized internal fun read(ctx: Context): List<Note>? {
        if (writeUncertain) return null
        return runCatching {
            val raw = prefs(ctx).getString("list", null) ?: return@runCatching emptyList()
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Note(o.getLong("id"), o.getString("text"), o.optString("url"), o.getLong("time"))
            }
        }.getOrNull()
    }

    fun list(ctx: Context): List<Note> = requireReadable(ctx)

    class Unavailable : IllegalStateException("Notes storage unavailable")
    class Full : IllegalStateException("Notes limit reached")
    fun requireReadable(ctx: Context): List<Note> = read(ctx) ?: throw Unavailable()

    enum class AddResult { SAVED, FULL, UNAVAILABLE, EMPTY }

    @Synchronized fun add(ctx: Context, text: String, url: String = ""): AddResult {
        val t = text.trim()
        if (t.isEmpty()) return AddResult.EMPTY
        val items = read(ctx) ?: return AddResult.UNAVAILABLE
        if (items.size >= MAX) return AddResult.FULL
        val now = System.currentTimeMillis()
        val id = maxOf(now, (items.maxOfOrNull { it.id } ?: 0) + 1)
        return if (runCatching { save(ctx, listOf(Note(id, t, url, now)) + items) }.getOrDefault(false))
            AddResult.SAVED else AddResult.UNAVAILABLE
    }

    @Synchronized fun update(ctx: Context, id: Long, text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return remove(ctx, id)
        val items = read(ctx) ?: return false
        if (items.none { it.id == id }) return false
        return runCatching { save(ctx, items.map { if (it.id == id) it.copy(text = t, time = System.currentTimeMillis()) else it }) }.getOrDefault(false)
    }

    @Synchronized fun remove(ctx: Context, id: Long): Boolean {
        val items = read(ctx) ?: return false
        if (items.none { it.id == id }) return false
        return runCatching { save(ctx, items.filterNot { it.id == id }) }.getOrDefault(false)
    }

    @Synchronized fun clear(ctx: Context): Boolean {
        if (read(ctx) == null) return false
        return commitSafely { prefs(ctx).edit().clear().commit() }
    }

    private fun commitSafely(write: () -> Boolean): Boolean {
        if (writeUncertain) return false
        val ok = runCatching { write() }.getOrDefault(false)
        if (!ok) writeUncertain = true
        return ok
    }

    private fun save(ctx: Context, items: List<Note>): Boolean {
        val arr = JSONArray()
        items.forEach {
            arr.put(JSONObject().put("id", it.id).put("text", it.text).put("url", it.url).put("time", it.time))
        }
        return commitSafely { prefs(ctx).edit().putString("list", arr.toString()).commit() }
    }
}

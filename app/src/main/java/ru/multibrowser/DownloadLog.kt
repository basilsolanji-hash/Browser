package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** [size] — байты; -1 у старых записей (до появления поля). */
data class Download(val name: String, val mime: String, val uri: String, val time: Long, val size: Long = -1)

/** Список скачанных файлов для экрана «Загрузки». */
object DownloadLog {
    private const val MAX = 200

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("downloads", Context.MODE_PRIVATE)

    fun list(ctx: Context): List<Download> {
        val raw = prefs(ctx).getString("list", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Download(o.getString("n"), o.optString("m"), o.getString("u"), o.getLong("t"), o.optLong("s", -1))
            }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun add(ctx: Context, name: String, mime: String, uri: String, size: Long = -1) {
        val items = (listOf(Download(name, mime, uri, System.currentTimeMillis(), size)) + list(ctx)).take(MAX)
        save(ctx, items)
    }

    fun removeAt(ctx: Context, index: Int) {
        val items = list(ctx).toMutableList()
        if (index in items.indices) { items.removeAt(index); save(ctx, items) }
    }

    @Synchronized
    fun remove(ctx: Context, d: Download) = save(ctx, list(ctx).filterNot { it.uri == d.uri && it.time == d.time })

    fun clear(ctx: Context) = prefs(ctx).edit().remove("list").apply()

    private fun save(ctx: Context, items: List<Download>) {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("n", it.name).put("m", it.mime).put("u", it.uri).put("t", it.time).put("s", it.size)) }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }
}

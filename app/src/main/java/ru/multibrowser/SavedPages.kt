package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream

/** Страница, сохранённая для чтения без интернета (PDF во внутренней памяти приложения). */
data class SavedPage(val id: Long, val title: String, val url: String, val file: String, val time: Long, val size: Long)

/**
 * Сохранённые страницы (№35). Файлы лежат в files/saved — недоступны другим приложениям,
 * удаляются вместе с приложением. Список — JSON в prefs, новые сверху.
 */
object SavedPages {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("saved_pages", Context.MODE_PRIVATE)

    fun dir(ctx: Context) = File(ctx.filesDir, "saved").apply { mkdirs() }

    fun file(ctx: Context, p: SavedPage) = File(dir(ctx), p.file)

    fun list(ctx: Context): List<SavedPage> {
        val raw = prefs(ctx).getString("list", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                SavedPage(o.getLong("id"), o.getString("title"), o.optString("url"),
                    o.getString("file"), o.getLong("time"), o.optLong("size"))
            }
        }.getOrDefault(emptyList()).filter { File(dir(ctx), it.file).exists() }
    }

    /** Записать PDF из потока (вызывать не в главном потоке). */
    fun store(ctx: Context, title: String, url: String, pdf: InputStream): SavedPage {
        val id = System.currentTimeMillis()
        val name = "page_$id.pdf"
        val target = File(dir(ctx), name)
        pdf.use { input -> target.outputStream().use { input.copyTo(it) } }
        val page = SavedPage(id, title.ifBlank { url }, url, name, id, target.length())
        synchronized(this) { save(ctx, listOf(page) + list(ctx)) }
        return page
    }

    fun rename(ctx: Context, id: Long, title: String) {
        if (title.isBlank()) return
        save(ctx, list(ctx).map { if (it.id == id) it.copy(title = title.trim()) else it })
    }

    fun remove(ctx: Context, id: Long) {
        list(ctx).firstOrNull { it.id == id }?.let { file(ctx, it).delete() }
        save(ctx, list(ctx).filterNot { it.id == id })
    }

    private fun save(ctx: Context, items: List<SavedPage>) {
        val arr = JSONArray()
        items.forEach {
            arr.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url)
                .put("file", it.file).put("time", it.time).put("size", it.size))
        }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }
}

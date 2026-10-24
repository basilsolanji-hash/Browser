package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Bookmark(val id: String, val title: String, val url: String, val folder: String)

/** Избранное с папками (один уровень) — общее для всех профилей. */
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

    /** Явно созданные папки (в том числе пустые). */
    private fun savedFolders(ctx: Context): List<String> {
        val raw = prefs(ctx).getString("folders", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        }.getOrDefault(emptyList())
    }

    private fun saveFolders(ctx: Context, names: List<String>) {
        val arr = JSONArray()
        names.distinct().filter { it.isNotEmpty() }.forEach { arr.put(it) }
        prefs(ctx).edit().putString("folders", arr.toString()).apply()
    }

    fun folders(ctx: Context): List<String> =
        (savedFolders(ctx) + all(ctx).map { it.folder })
            .filter { it.isNotEmpty() }.distinct().sortedBy { it.lowercase() }

    fun inFolder(ctx: Context, folder: String) = all(ctx).filter { it.folder == folder }

    fun contains(ctx: Context, url: String) = all(ctx).any { it.url == url }

    fun findByUrl(ctx: Context, url: String) = all(ctx).firstOrNull { it.url == url }

    fun add(ctx: Context, title: String, url: String, folder: String = ROOT) {
        if (contains(ctx, url)) return
        val b = Bookmark("b" + UUID.randomUUID().toString(), title.ifBlank { url }, url, folder)
        save(ctx, all(ctx) + b)
    }

    fun remove(ctx: Context, id: String) = save(ctx, all(ctx).filterNot { it.id == id })

    fun removeByUrl(ctx: Context, url: String) = save(ctx, all(ctx).filterNot { it.url == url })

    fun move(ctx: Context, id: String, folder: String) {
        if (folder.isNotEmpty() && folder !in folders(ctx)) saveFolders(ctx, savedFolders(ctx) + folder)
        save(ctx, all(ctx).map { if (it.id == id) it.copy(folder = folder) else it })
    }

    fun rename(ctx: Context, id: String, title: String) =
        save(ctx, all(ctx).map { if (it.id == id) it.copy(title = title.ifBlank { it.title }) else it })

    /** Создать папку; false — если имя пустое или такая уже есть. */
    fun addFolder(ctx: Context, name: String): Boolean {
        val n = name.trim()
        if (n.isEmpty() || folders(ctx).any { it.equals(n, ignoreCase = true) }) return false
        saveFolders(ctx, savedFolders(ctx) + n)
        return true
    }

    /** Переименовать папку вместе с её закладками; false — если имя пустое или занято. */
    fun renameFolder(ctx: Context, from: String, to: String): Boolean {
        val n = to.trim()
        if (n.isEmpty()) return false
        if (n == from) return true
        if (folders(ctx).any { it != from && it.equals(n, ignoreCase = true) }) return false
        saveFolders(ctx, savedFolders(ctx).map { if (it == from) n else it } + n)
        save(ctx, all(ctx).map { if (it.folder == from) it.copy(folder = n) else it })
        return true
    }

    /** Удалить папку: её закладки удаляются или (keepItems) переносятся в корень. */
    fun removeFolder(ctx: Context, name: String, keepItems: Boolean) {
        saveFolders(ctx, savedFolders(ctx).filterNot { it == name })
        save(ctx, if (keepItems) all(ctx).map { if (it.folder == name) it.copy(folder = ROOT) else it }
        else all(ctx).filterNot { it.folder == name })
    }

    private fun save(ctx: Context, items: List<Bookmark>) {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("id", it.id).put("t", it.title).put("u", it.url).put("f", it.folder)) }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }
}

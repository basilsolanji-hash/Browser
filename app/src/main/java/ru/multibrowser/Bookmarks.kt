package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Bookmark(val id: String, val title: String, val url: String, val folder: String)

/** Избранное с папками (один уровень) — общее для всех профилей. */
object Bookmarks {
    const val ROOT = ""
    private var writeUncertain = false
    data class Snapshot(val items: List<Bookmark>, val savedFolders: List<String>) {
        val folders: List<String> get() = (savedFolders + items.map { it.folder })
            .filter { it.isNotEmpty() }.distinct().sortedBy { it.lowercase() }
    }
    class Unavailable : IllegalStateException("Favorites storage unavailable")
    enum class AddResult { ADDED, EXISTS, UNAVAILABLE }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("bookmarks", Context.MODE_PRIVATE)

    /** Null означает ошибку чтения, не пустое избранное. */
    @Synchronized internal fun read(ctx: Context): Snapshot? {
        if (writeUncertain) return null
        return runCatching {
            val p = prefs(ctx)
            val rawItems = p.getString("list", null)
            val rawFolders = p.getString("folders", null)
            val items = if (rawItems == null) emptyList() else JSONArray(rawItems).let { arr ->
                (0 until arr.length()).map {
                    val o = arr.getJSONObject(it)
                    if (o.opt("id") !is String || o.opt("t") !is String || o.opt("u") !is String ||
                        (o.has("f") && o.opt("f") !is String)) error("Invalid favorites data")
                    Bookmark(o.getString("id"), o.getString("t"), o.getString("u"), o.optString("f"))
                }
            }
            val folders = if (rawFolders == null) emptyList() else JSONArray(rawFolders).let { arr ->
                (0 until arr.length()).map {
                    if (arr.opt(it) !is String) error("Invalid favorites folder")
                    arr.getString(it)
                }
            }
            Snapshot(items, folders)
        }.getOrNull()
    }

    fun requireReadable(ctx: Context): Snapshot = read(ctx) ?: throw Unavailable()
    fun all(ctx: Context): List<Bookmark> = requireReadable(ctx).items
    fun folders(ctx: Context): List<String> = requireReadable(ctx).folders
    fun inFolder(ctx: Context, folder: String) = all(ctx).filter { it.folder == folder }
    fun contains(ctx: Context, url: String) = all(ctx).any { it.url == url }
    fun findByUrl(ctx: Context, url: String) = all(ctx).firstOrNull { it.url == url }

    /** Обе части записываются одним commit; при неуспехе память может измениться. */
    private fun save(ctx: Context, items: List<Bookmark>, folders: List<String>): Boolean {
        if (writeUncertain) return false
        val itemJson = JSONArray().apply {
            items.forEach { put(JSONObject().put("id", it.id).put("t", it.title).put("u", it.url).put("f", it.folder)) }
        }
        val folderJson = JSONArray().apply { folders.distinct().filter { it.isNotEmpty() }.forEach { put(it) } }
        val ok = runCatching {
            prefs(ctx).edit().putString("list", itemJson.toString()).putString("folders", folderJson.toString()).commit()
        }.getOrDefault(false)
        if (!ok) writeUncertain = true
        return ok
    }

    @Synchronized fun addIfAbsent(ctx: Context, title: String, url: String, folder: String = ROOT): AddResult {
        val snapshot = read(ctx) ?: return AddResult.UNAVAILABLE
        if (snapshot.items.any { it.url == url }) return AddResult.EXISTS
        val item = Bookmark("b" + UUID.randomUUID().toString(), title.ifBlank { url }, url, folder)
        val folders = if (folder.isNotEmpty() && folder !in snapshot.folders) snapshot.savedFolders + folder else snapshot.savedFolders
        return if (save(ctx, snapshot.items + item, folders)) AddResult.ADDED else AddResult.UNAVAILABLE
    }
    fun add(ctx: Context, title: String, url: String, folder: String = ROOT): Boolean =
        addIfAbsent(ctx, title, url, folder) != AddResult.UNAVAILABLE

    @Synchronized fun remove(ctx: Context, id: String): Boolean {
        val s = read(ctx) ?: return false
        if (s.items.none { it.id == id }) return false
        return save(ctx, s.items.filterNot { it.id == id }, s.savedFolders)
    }
    @Synchronized fun removeByUrl(ctx: Context, url: String): Boolean {
        val s = read(ctx) ?: return false
        if (s.items.none { it.url == url }) return false
        return save(ctx, s.items.filterNot { it.url == url }, s.savedFolders)
    }
    @Synchronized fun move(ctx: Context, id: String, folder: String): Boolean {
        val s = read(ctx) ?: return false
        if (s.items.none { it.id == id }) return false
        val folders = if (folder.isNotEmpty() && folder !in s.folders) s.savedFolders + folder else s.savedFolders
        return save(ctx, s.items.map { if (it.id == id) it.copy(folder = folder) else it }, folders)
    }
    @Synchronized fun rename(ctx: Context, id: String, title: String): Boolean {
        val s = read(ctx) ?: return false
        if (s.items.none { it.id == id }) return false
        return save(ctx, s.items.map { if (it.id == id) it.copy(title = title.ifBlank { it.title }) else it }, s.savedFolders)
    }
    @Synchronized fun addFolder(ctx: Context, name: String): Boolean {
        val s = read(ctx) ?: return false
        val n = name.trim()
        if (n.isEmpty() || s.folders.any { it.equals(n, ignoreCase = true) }) return false
        return save(ctx, s.items, s.savedFolders + n)
    }
    @Synchronized fun renameFolder(ctx: Context, from: String, to: String): Boolean {
        val s = read(ctx) ?: return false
        val n = to.trim()
        if (n.isEmpty() || from !in s.folders) return false
        if (n == from) return true
        if (s.folders.any { it != from && it.equals(n, ignoreCase = true) }) return false
        return save(ctx, s.items.map { if (it.folder == from) it.copy(folder = n) else it },
            s.savedFolders.map { if (it == from) n else it } + n)
    }
    @Synchronized fun removeFolder(ctx: Context, name: String, keepItems: Boolean): Boolean {
        val s = read(ctx) ?: return false
        if (name == ROOT || name !in s.folders) return false
        val items = if (keepItems) s.items.map { if (it.folder == name) it.copy(folder = ROOT) else it }
            else s.items.filterNot { it.folder == name }
        return save(ctx, items, s.savedFolders.filterNot { it == name })
    }
}

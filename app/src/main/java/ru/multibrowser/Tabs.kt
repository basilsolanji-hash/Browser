package ru.multibrowser

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/** Обычная открытая вкладка профиля (не закреплённая). [group] — id группы или null. */
data class OpenTab(val id: String, val title: String, val url: String, val group: String? = null)

/** Группа вкладок профиля: название и цвет из палитры [Tabs.GROUP_COLORS]. */
data class TabGroup(val id: String, val name: String, val color: Int)

/**
 * Открытые вкладки и группы — свои у каждого профиля, хранятся локально (JSON в prefs).
 * Сессия вкладки живёт в Gecko под ключом `profileId:tabId` и в контексте профиля,
 * поэтому изоляция cookies между профилями сохраняется.
 */
object Tabs {
    private const val PREFIX = "tab"

    val GROUP_COLORS = intArrayOf(
        0xFFE53935.toInt(), 0xFFFB8C00.toInt(), 0xFFFDD835.toInt(), 0xFF43A047.toInt(),
        0xFF00ACC1.toInt(), 0xFF1E88E5.toInt(), 0xFF8E24AA.toInt(), 0xFF757575.toInt(),
    )

    fun isTab(id: String?) = id != null && id.startsWith(PREFIX)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("tabs", Context.MODE_PRIVATE)

    private var seq = 0L
    private fun newId(prefix: String): String {
        val now = System.currentTimeMillis()
        seq = if (now > seq) now else seq + 1
        return prefix + seq
    }

    // --- Вкладки ---

    fun list(ctx: Context, profile: Int): List<OpenTab> {
        val raw = prefs(ctx).getString("list_$profile", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                OpenTab(
                    o.getString("id"), o.optString("title"), o.optString("url", Pins.START),
                    o.optString("group").ifEmpty { null },
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun save(ctx: Context, profile: Int, tabs: List<OpenTab>) {
        val arr = JSONArray()
        tabs.forEach {
            arr.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url).put("group", it.group ?: ""))
        }
        prefs(ctx).edit().putString("list_$profile", arr.toString()).apply()
    }

    fun count(ctx: Context, profile: Int) = list(ctx, profile).size

    fun byId(ctx: Context, profile: Int, id: String?): OpenTab? =
        if (!isTab(id)) null else list(ctx, profile).firstOrNull { it.id == id }

    fun add(ctx: Context, profile: Int, url: String = Pins.START, group: String? = null): OpenTab {
        val tab = OpenTab(newId(PREFIX), "", url, group)
        save(ctx, profile, list(ctx, profile) + tab)
        return tab
    }

    /** Заголовок и адрес обновляются по мере навигации; служебные адреса (data:, стартовая) не запоминаем. */
    fun update(ctx: Context, profile: Int, id: String, title: String? = null, url: String? = null) {
        val tabs = list(ctx, profile)
        if (tabs.none { it.id == id }) return
        save(ctx, profile, tabs.map { t ->
            if (t.id != id) t else t.copy(
                title = title?.trim() ?: t.title,
                url = url?.takeIf { it.startsWith("http") } ?: t.url,
            )
        })
    }

    /** Закрыть вкладки: убрать из списка и выгрузить их сессии. */
    fun close(ctx: Context, profile: Int, ids: Collection<String>) {
        if (ids.isEmpty()) return
        save(ctx, profile, list(ctx, profile).filterNot { it.id in ids })
        ids.forEach {
            Gecko.close(profile, it)
            Profiles.forgetUrl(ctx, profile, it)
        }
    }

    fun closeAll(ctx: Context, profile: Int) = close(ctx, profile, list(ctx, profile).map { it.id })

    fun setGroup(ctx: Context, profile: Int, ids: Collection<String>, group: String?) {
        save(ctx, profile, list(ctx, profile).map { if (it.id in ids) it.copy(group = group) else it })
    }

    /** Вкладка в виде [Pin] — так её понимают Gecko.session и Profiles.lastUrl. */
    fun pin(ctx: Context, tab: OpenTab) = Pin(tab.id, label(ctx, tab), tab.url)

    /** Вкладка или закреплённая вкладка по id; если такой больше нет — первая закреплённая. */
    fun resolve(ctx: Context, profile: Int, id: String?): Pin =
        byId(ctx, profile, id)?.let { pin(ctx, it) } ?: Pins.resolve(ctx, id)

    fun label(ctx: Context, tab: OpenTab): String = when {
        tab.title.isNotBlank() -> tab.title
        tab.url.startsWith("http") -> host(tab.url)
        else -> Tr.t("new_tab")
    }

    fun host(url: String): String =
        if (url.startsWith("http")) (Uri.parse(url).host ?: url).removePrefix("www.") else Tr.t("start_page")

    // --- Группы ---

    fun groups(ctx: Context, profile: Int): List<TabGroup> {
        val raw = prefs(ctx).getString("groups_$profile", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                TabGroup(o.getString("id"), o.optString("name"), o.optInt("color", GROUP_COLORS[0]))
            }
        }.getOrDefault(emptyList())
    }

    private fun saveGroups(ctx: Context, profile: Int, groups: List<TabGroup>) {
        val arr = JSONArray()
        groups.forEach { arr.put(JSONObject().put("id", it.id).put("name", it.name).put("color", it.color)) }
        prefs(ctx).edit().putString("groups_$profile", arr.toString()).apply()
    }

    fun group(ctx: Context, profile: Int, id: String?): TabGroup? =
        if (id == null) null else groups(ctx, profile).firstOrNull { it.id == id }

    fun addGroup(ctx: Context, profile: Int, name: String, color: Int): TabGroup {
        val existing = groups(ctx, profile)
        val g = TabGroup(newId("g"), name.trim().ifBlank { Tr.t("group_n", existing.size + 1) }, color)
        saveGroups(ctx, profile, existing + g)
        return g
    }

    fun updateGroup(ctx: Context, profile: Int, id: String, name: String? = null, color: Int? = null) {
        saveGroups(ctx, profile, groups(ctx, profile).map {
            if (it.id != id) it else it.copy(name = name?.trim()?.ifBlank { null } ?: it.name, color = color ?: it.color)
        })
    }

    /** Удалить группу; её вкладки остаются открытыми, но без группы. */
    fun deleteGroup(ctx: Context, profile: Int, id: String) {
        saveGroups(ctx, profile, groups(ctx, profile).filterNot { it.id == id })
        save(ctx, profile, list(ctx, profile).map { if (it.group == id) it.copy(group = null) else it })
    }

    /** Стереть все вкладки и группы профиля (выход из аккаунтов профиля). */
    fun forgetProfile(ctx: Context, profile: Int) {
        list(ctx, profile).forEach { Profiles.forgetUrl(ctx, profile, it.id) }
        prefs(ctx).edit().remove("list_$profile").remove("groups_$profile").apply()
    }
}

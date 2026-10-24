package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Открытые (не закреплённые) вкладки профиля: новая вкладка, ссылки «в новом окне». Хранятся
 * отдельно для каждого профиля и переживают перезапуск; сессия вкладки — тот же ключ "профиль:id",
 * что и у закреплённых, поэтому адрес и восстановление работают одинаково.
 */
object OpenTabs {
    const val MAX = 50

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("open_tabs", Context.MODE_PRIVATE)

    private const val PREFIX = "tab_"

    fun isOpenTab(pin: Pin) = pin.id.startsWith(PREFIX)

    fun list(ctx: Context, profile: Int): List<Pin> {
        val raw = prefs(ctx).getString("p_$profile", null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Pin(o.getString("id"), o.optString("title").ifBlank { Tr.t("new_tab") }, o.optString("url"))
            }
        }.getOrDefault(emptyList())
    }

    /** Закреплённые и открытые вкладки профиля — в порядке полосы вкладок. */
    fun all(ctx: Context, profile: Int): List<Pin> = Pins.all(ctx, profile) + list(ctx, profile)

    /** Новая вкладка в конце; при переполнении закрывается самая старая открытая. */
    fun add(ctx: Context, profile: Int, url: String): Pin {
        val pin = Pin(PREFIX + System.nanoTime(), "", url)
        val items = (list(ctx, profile) + pin).let { if (it.size > MAX) it.drop(it.size - MAX) else it }
        save(ctx, profile, items)
        return pin.copy(title = Tr.t("new_tab"))
    }

    fun setTitle(ctx: Context, profile: Int, id: String, title: String) {
        val items = list(ctx, profile)
        if (items.none { it.id == id && it.title != title }) return
        save(ctx, profile, items.map { if (it.id == id) it.copy(title = title) else it })
    }

    fun close(ctx: Context, profile: Int, id: String) {
        save(ctx, profile, list(ctx, profile).filterNot { it.id == id })
    }

    fun closeAll(ctx: Context, profile: Int) {
        prefs(ctx).edit().remove("p_$profile").apply()
    }

    private fun save(ctx: Context, profile: Int, items: List<Pin>) {
        val arr = JSONArray()
        // Пустой заголовок — «Новая вкладка» на текущем языке.
        items.forEach {
            arr.put(JSONObject().put("id", it.id).put("title", it.title.takeIf { t -> t != Tr.t("new_tab") }.orEmpty()).put("url", it.url))
        }
        prefs(ctx).edit().putString("p_$profile", arr.toString()).apply()
    }
}

package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Закреплённая вкладка: стабильный id (для хранения сессии), название и адрес. Настраивается пользователем. */
data class Pin(val id: String, val title: String, val url: String)

/**
 * Список закреплённых вкладок — общий для всех профилей. В каждом профиле у вкладки свой вход и cookies.
 * По умолчанию Gmail и Claude, но пользователь может переименовать, изменить адрес, добавить и удалить.
 */
object Pins {
    private val DEFAULT = listOf(
        Pin("gmail", "Gmail", "https://mail.google.com/"),
        Pin("claude", "Claude", "https://claude.ai/"),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pins", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Pin> {
        val raw = prefs(ctx).getString("list", null) ?: return DEFAULT
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Pin(o.getString("id"), o.getString("title"), o.getString("url"))
            }
        }.getOrDefault(DEFAULT).ifEmpty { DEFAULT }
    }

    fun byId(ctx: Context, id: String?): Pin? = all(ctx).firstOrNull { it.id == id }

    /** Вкладка по id, а если такой больше нет (удалили) — первая закреплённая. */
    fun resolve(ctx: Context, id: String?): Pin = byId(ctx, id) ?: all(ctx).first()

    fun save(ctx: Context, pins: List<Pin>) {
        val arr = JSONArray()
        pins.forEach { arr.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url)) }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }

    fun add(ctx: Context, title: String, url: String) {
        val pin = Pin("p" + System.currentTimeMillis(), title.trim(), normalize(url))
        save(ctx, all(ctx) + pin)
    }

    fun update(ctx: Context, id: String, title: String, url: String) {
        save(ctx, all(ctx).map { if (it.id == id) it.copy(title = title.trim(), url = normalize(url)) else it })
    }

    fun remove(ctx: Context, id: String) {
        val left = all(ctx).filterNot { it.id == id }
        save(ctx, left.ifEmpty { DEFAULT })
    }

    fun move(ctx: Context, id: String, delta: Int) {
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        val j = i + delta
        if (i in list.indices && j in list.indices) {
            list.add(j, list.removeAt(i))
            save(ctx, list)
        }
    }

    private fun normalize(url: String): String {
        val t = url.trim()
        return when {
            t.isEmpty() -> "about:blank"
            t.startsWith("http://") || t.startsWith("https://") -> t
            else -> "https://$t"
        }
    }
}

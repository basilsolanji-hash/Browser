package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Закреплённая вкладка: стабильный id (для хранения сессии), название и адрес. Настраивается пользователем. */
data class Pin(val id: String, val title: String, val url: String)

/**
 * Закреплённые вкладки. Общий набор (настройки) действует для профилей без своего; у профиля может
 * быть свой набор (экран профиля) — первая правка копирует общий и дальше меняет только копию.
 * В каждом профиле у вкладки свой вход и cookies. Параметр profile = null — общий набор.
 */
object Pins {
    /** Нейтральная стартовая страница — база универсального браузера (без привязки к сервисам). */
    /** Маркер встроенной стартовой страницы (рендерится локализованно в StartPage). */
    const val START = "os:start"

    private val DEFAULT = listOf(Pin("start", "Старт", START))


    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pins", Context.MODE_PRIVATE)

    private fun key(profile: Int?) = if (profile == null) "list" else "list_$profile"

    /** У профиля свой набор вкладок (а не общий). */
    fun hasOwn(ctx: Context, profile: Int) = prefs(ctx).contains(key(profile))

    /** Вернуть профиль к общему набору вкладок. */
    fun useCommon(ctx: Context, profile: Int) {
        prefs(ctx).edit().remove(key(profile)).apply()
    }

    fun all(ctx: Context, profile: Int? = null): List<Pin> {
        val raw = profile?.let { prefs(ctx).getString(key(it), null) } ?: prefs(ctx).getString("list", null)
        val list = if (raw == null) DEFAULT else runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Pin(o.getString("id"), o.getString("title"), o.getString("url"))
            }
        }.getOrDefault(DEFAULT).ifEmpty { DEFAULT }
        // Название встроенной стартовой вкладки показываем на языке интерфейса.
        return list.map { if (it.url == START) it.copy(title = Tr.t("start")) else it }
    }

    fun byId(ctx: Context, id: String?, profile: Int? = null): Pin? = all(ctx, profile).firstOrNull { it.id == id }

    /** Вкладка по id, а если такой больше нет (удалили или у профиля другой набор) — первая закреплённая. */
    fun resolve(ctx: Context, id: String?, profile: Int? = null): Pin = byId(ctx, id, profile) ?: all(ctx, profile).first()

    fun save(ctx: Context, pins: List<Pin>, profile: Int? = null) {
        val arr = JSONArray()
        pins.forEach { arr.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url)) }
        prefs(ctx).edit().putString(key(profile), arr.toString()).apply()
    }

    fun add(ctx: Context, title: String, url: String, profile: Int? = null) {
        val pin = Pin("p" + System.currentTimeMillis(), title.trim(), normalize(url))
        save(ctx, all(ctx, profile) + pin, profile)
    }

    fun update(ctx: Context, id: String, title: String, url: String, profile: Int? = null) {
        save(ctx, all(ctx, profile).map { if (it.id == id) it.copy(title = title.trim(), url = normalize(url)) else it }, profile)
    }

    fun remove(ctx: Context, id: String, profile: Int? = null) {
        val left = all(ctx, profile).filterNot { it.id == id }
        save(ctx, left.ifEmpty { DEFAULT }, profile)
    }

    fun move(ctx: Context, id: String, delta: Int, profile: Int? = null) {
        val list = all(ctx, profile).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        val j = i + delta
        if (i in list.indices && j in list.indices) {
            list.add(j, list.removeAt(i))
            save(ctx, list, profile)
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

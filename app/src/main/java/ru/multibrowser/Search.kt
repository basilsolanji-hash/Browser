package ru.multibrowser

import android.content.Context
import java.net.URLDecoder
import java.net.URLEncoder

/** Поисковые системы на выбор. По умолчанию — приватная (DuckDuckGo), т.к. главный приоритет — конфиденциальность. */
object Search {
    data class Engine(val id: String, val title: String, val query: String, val home: String)

    val ENGINES = listOf(
        Engine("ddg", "DuckDuckGo", "https://duckduckgo.com/?q=", "https://duckduckgo.com/"),
        Engine("startpage", "Startpage", "https://www.startpage.com/sp/search?query=", "https://www.startpage.com/"),
        Engine("brave", "Brave", "https://search.brave.com/search?q=", "https://search.brave.com/"),
        Engine("google", "Google", "https://www.google.com/search?q=", "https://www.google.com/"),
        Engine("bing", "Bing", "https://www.bing.com/search?q=", "https://www.bing.com/"),
        Engine("yandex", "Яндекс", "https://yandex.ru/search/?text=", "https://yandex.ru/"),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("search", Context.MODE_PRIVATE)

    fun current(ctx: Context): Engine {
        val id = prefs(ctx).getString("engine", "ddg")
        return ENGINES.firstOrNull { it.id == id } ?: ENGINES.first()
    }

    fun set(ctx: Context, id: String) {
        prefs(ctx).edit().putString("engine", id).apply()
    }

    /** Цвет значка поисковика в адресной строке. */
    fun color(engine: Engine): Int = when (engine.id) {
        "ddg" -> 0xFFDE5833.toInt()
        "startpage" -> 0xFF6573FF.toInt()
        "brave" -> 0xFFFB542B.toInt()
        "google" -> 0xFF4285F4.toInt()
        "bing" -> 0xFF008373.toInt()
        "yandex" -> 0xFFFC3F1D.toInt()
        else -> 0xFF777777.toInt()
    }

    fun queryUrl(ctx: Context, text: String): String =
        current(ctx).query + URLEncoder.encode(text, "UTF-8")

    /** Ввод адресной строки или быстрого поиска: адрес — как есть, иначе — запрос поисковику. */
    fun toUrl(ctx: Context, input: String): String {
        val t = input.trim()
        return when {
            t.startsWith("http://", ignoreCase = true) || t.startsWith("https://", ignoreCase = true) -> t
            t.contains('.') && !t.contains(' ') -> "https://$t"
            else -> queryUrl(ctx, t)
        }
    }

    /** Запрос, если адрес — страница результатов одного из поисковиков (для подсказок «вы искали»). */
    fun queryOf(url: String): String? {
        val engine = ENGINES.firstOrNull { url.startsWith(it.query.substringBefore('?') + "?") } ?: return null
        val name = engine.query.substringAfterLast('?').substringBefore('=')
        val value = url.substringAfter('?').substringBefore('#').split('&')
            .firstOrNull { it.substringBefore('=') == name }?.substringAfter('=', "") ?: return null
        return runCatching { URLDecoder.decode(value, "UTF-8") }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    }
}

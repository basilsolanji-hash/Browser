package ru.multibrowser

import android.content.Context
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

    fun queryUrl(ctx: Context, text: String): String =
        current(ctx).query + URLEncoder.encode(text, "UTF-8")

    /** Ввод адресной строки или быстрого поиска: адрес — как есть, иначе — запрос поисковику. */
    fun toUrl(ctx: Context, input: String): String {
        val t = input.trim()
        return when {
            t.startsWith("http://") || t.startsWith("https://") -> t
            t.contains('.') && !t.contains(' ') -> "https://$t"
            else -> queryUrl(ctx, t)
        }
    }
}

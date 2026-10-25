package ru.multibrowser

import android.content.Context
import org.mozilla.geckoview.GeckoSession

/**
 * Главная страница (№27): что открывать по маркеру Pins.START — стартовую «Ось», пустую
 * страницу или свой адрес. Сюда приходят новая вкладка и кнопка «Главная».
 */
object Home {
    enum class Mode { OS, BLANK, CUSTOM }

    // Контекст приложения: страница грузится из мест, где контекста нет (Gecko.loadUrl).
    private var app: Context? = null

    fun init(ctx: Context) {
        app = ctx.applicationContext
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("home", Context.MODE_PRIVATE)

    fun mode(ctx: Context): Mode =
        runCatching { Mode.valueOf(prefs(ctx).getString("mode", null)!!) }.getOrDefault(Mode.OS)

    fun customUrl(ctx: Context): String = prefs(ctx).getString("url", "") ?: ""

    fun set(ctx: Context, mode: Mode, url: String? = null) {
        val e = prefs(ctx).edit().putString("mode", mode.name)
        if (url != null) e.putString("url", normalize(url))
        e.apply()
    }

    /** Загрузить главную страницу в сессию. */
    fun load(session: GeckoSession) {
        val ctx = app
        when (if (ctx == null) Mode.OS else mode(ctx)) {
            Mode.BLANK -> session.loadUri("about:blank")
            Mode.CUSTOM -> customUrl(ctx!!).takeIf { it.isNotBlank() }?.let { session.loadUri(it) } ?: loadStart(session)
            Mode.OS -> loadStart(session)
        }
    }

    private fun loadStart(session: GeckoSession) {
        Gecko.onStartPage += session
        session.load(GeckoSession.Loader().data(StartPage.html(), "text/html"))
    }

    /** Позитивная фраза (№36), каждый показ — новая; null, если контекст ещё не готов. */
    fun phrase(): String? = app?.let { Phrases.next(it) }

    fun normalize(url: String): String {
        val t = url.trim()
        return when {
            t.isEmpty() -> ""
            t.startsWith("http://") || t.startsWith("https://") -> t
            else -> "https://$t"
        }
    }
}

/**
 * Позитивные фразы (№36): 300 штук на 10 языках, локально (assets/phrases/<язык>.txt, строка N —
 * одна и та же фраза на всех языках). Показываются в случайном порядке и не повторяются, пока не
 * пройдут все; новая колода не начинается с последней показанной фразы.
 */
object Phrases {
    private val cache = mutableMapOf<String, List<String>>()

    fun all(ctx: Context, lang: String = Tr.lang): List<String> = synchronized(cache) {
        cache.getOrPut(lang) {
            runCatching {
                ctx.assets.open("phrases/$lang.txt").bufferedReader(Charsets.UTF_8).readLines().map { it.trim() }.filter { it.isNotEmpty() }
            }.getOrDefault(emptyList())
        }.ifEmpty { if (lang != "en") all(ctx, "en") else emptyList() }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("phrases", Context.MODE_PRIVATE)

    /** Следующая фраза при каждом показе. */
    fun next(ctx: Context): String? {
        val list = all(ctx)
        if (list.isEmpty()) return null
        return list[nextIndex(ctx, list.size)]
    }

    @Synchronized
    internal fun nextIndex(ctx: Context, count: Int): Int {
        val p = prefs(ctx)
        var deck = p.getString("deck", null)?.split(',')?.mapNotNull { it.toIntOrNull() }
            ?.takeIf { it.size == count && it.toSet().size == count }
        var pos = p.getInt("pos", -1) + 1
        if (deck == null || pos >= count) {
            // Новая колода не начинается с фразы, которой закончилась прошлая.
            val last = deck?.lastOrNull() ?: -1
            deck = (0 until count).shuffled().toMutableList().also { if (it[0] == last && count > 1) it.add(it.removeAt(0)) }
            pos = 0
        }
        p.edit().putString("deck", deck.joinToString(",")).putInt("pos", pos).apply()
        return deck[pos]
    }

    /** Приветствие по времени суток: утро 5–12, день 12–17, вечер 17–23, ночь. */
    fun greeting(hour: Int = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)): String = Tr.t(
        when (hour) {
            in 5..11 -> "greet_morning"
            in 12..16 -> "greet_day"
            in 17..22 -> "greet_evening"
            else -> "greet_night"
        }
    )
}

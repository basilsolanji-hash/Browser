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

    /** Позитивная фраза дня (№36) или null, если контекст ещё не готов. */
    fun phrase(): String? = app?.let { Phrases.today(it) }

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
 * Фраза дня (№36): локально, без сети и погоды. Колода фраз перемешивается, каждый день —
 * следующая; пока колода не кончится, фразы не повторяются (и на стыке колод — тоже).
 */
object Phrases {
    const val COUNT = 30

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("phrases", Context.MODE_PRIVATE)

    fun today(ctx: Context): String = Tr.t("phrase_" + (indexFor(ctx, dayNumber()) + 1))

    private fun dayNumber(): Long {
        val now = System.currentTimeMillis()
        return (now + java.util.TimeZone.getDefault().getOffset(now)) / 86_400_000L
    }

    @Synchronized
    private fun indexFor(ctx: Context, day: Long): Int {
        val p = prefs(ctx)
        val deck = p.getString("deck", null)?.split(',')?.mapNotNull { it.toIntOrNull() }
            ?.takeIf { it.size == COUNT && it.toSet().size == COUNT }
        val pos = p.getInt("pos", -1)
        val lastDay = p.getLong("day", -1)
        if (deck != null && pos in deck.indices && lastDay == day) return deck[pos]

        var d = deck ?: shuffled(-1)
        var next = pos + 1
        if (deck == null) next = 0
        if (next >= COUNT) {
            // Новая колода не начинается с фразы, которой закончилась прошлая.
            d = shuffled(d[COUNT - 1]); next = 0
        }
        p.edit().putString("deck", d.joinToString(",")).putInt("pos", next).putLong("day", day).apply()
        return d[next]
    }

    private fun shuffled(notFirst: Int): List<Int> {
        val list = (0 until COUNT).shuffled().toMutableList()
        if (list[0] == notFirst) list.add(list.removeAt(0))
        return list
    }
}

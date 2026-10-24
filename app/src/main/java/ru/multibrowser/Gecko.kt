package ru.multibrowser

import android.content.Context
import android.net.Uri
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings

/**
 * Один движок на всё приложение. Каждый профиль — отдельный contextId,
 * поэтому cookies и хранилища профилей не пересекаются и сохраняются между запусками.
 */
object Gecko {
    // Сколько вкладок держать в памяти; остальные «спят» и перезагружаются при открытии.
    private const val MAX_ACTIVE = 6

    // Gmail отдаёт незнакомым браузерам устаревшую «простую» версию, поэтому
    // представляемся мобильным Chrome. На страницах входа — родной UA движка.
    private const val CHROME_UA =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
    private val SIGN_IN_HOSTS = setOf("accounts.google.com", "accounts.youtube.com")

    private var runtime: GeckoRuntime? = null
    private val sessions = LinkedHashMap<String, GeckoSession>(16, 0.75f, true)
    val canGoBack = HashMap<String, Boolean>()
    val canGoForward = HashMap<String, Boolean>()

    fun key(id: Int, site: Site) = "$id:${site.name}"

    fun runtime(ctx: Context): GeckoRuntime =
        runtime ?: GeckoRuntime.create(ctx.applicationContext).also { runtime = it }

    fun isActive(id: Int) = Site.values().any { sessions.containsKey(key(id, it)) }

    fun session(ctx: Context, id: Int, site: Site): GeckoSession {
        val key = key(id, site)
        sessions[key]?.let { return it }
        val url = Profiles.lastUrl(ctx, id, site)
        val settings = GeckoSessionSettings.Builder()
            .contextId("profile_$id")
            .usePrivateMode(false)
            .apply { userAgentFor(url)?.let { userAgentOverride(it) } }
            .build()
        val session = GeckoSession(settings)
        session.open(runtime(ctx))
        session.loadUri(url)
        sessions[key] = session

        while (sessions.size > MAX_ACTIVE) {
            drop(sessions.entries.first().key)
        }
        return session
    }

    fun userAgentFor(url: String): String? =
        if (Uri.parse(url).host in SIGN_IN_HOSTS) null else CHROME_UA

    /** Выйти из всех аккаунтов профиля: закрыть вкладку и стереть cookies/хранилище его контекста. */
    fun clearProfile(ctx: Context, id: Int) {
        Site.values().forEach { drop(key(id, it)) }
        runtime(ctx).storageController.clearDataForSessionContext("profile_$id")
        Profiles.forget(ctx, id)
    }

    private fun drop(key: String) {
        sessions.remove(key)?.close()
        canGoBack.remove(key)
        canGoForward.remove(key)
    }
}

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
    // Сколько профилей держать в памяти; остальные «спят» и перезагружаются при открытии.
    private const val MAX_ACTIVE = 5

    // Gmail отдаёт незнакомым браузерам устаревшую «простую» версию, поэтому
    // представляемся мобильным Chrome. На страницах входа — родной UA движка.
    private const val CHROME_UA =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
    private val SIGN_IN_HOSTS = setOf("accounts.google.com", "accounts.youtube.com")

    private var runtime: GeckoRuntime? = null
    private val sessions = LinkedHashMap<Int, GeckoSession>(16, 0.75f, true)
    val canGoBack = HashMap<Int, Boolean>()

    fun runtime(ctx: Context): GeckoRuntime =
        runtime ?: GeckoRuntime.create(ctx.applicationContext).also { runtime = it }

    fun isActive(id: Int) = sessions.containsKey(id)

    fun session(ctx: Context, id: Int): GeckoSession {
        sessions[id]?.let { return it }
        val url = Profiles.lastUrl(ctx, id)
        val settings = GeckoSessionSettings.Builder()
            .contextId("profile_$id")
            .usePrivateMode(false)
            .apply { userAgentFor(url)?.let { userAgentOverride(it) } }
            .build()
        val session = GeckoSession(settings)
        session.open(runtime(ctx))
        session.loadUri(url)
        sessions[id] = session

        while (sessions.size > MAX_ACTIVE) {
            val eldest = sessions.entries.first()
            sessions.remove(eldest.key)
            canGoBack.remove(eldest.key)
            eldest.value.close()
        }
        return session
    }

    fun userAgentFor(url: String): String? =
        if (Uri.parse(url).host in SIGN_IN_HOSTS) null else CHROME_UA

    /** Выйти из всех аккаунтов профиля: закрыть вкладку и стереть cookies/хранилище его контекста. */
    fun clearProfile(ctx: Context, id: Int) {
        sessions.remove(id)?.close()
        canGoBack.remove(id)
        runtime(ctx).storageController.clearDataForSessionContext("profile_$id")
        Profiles.forget(ctx, id)
    }
}

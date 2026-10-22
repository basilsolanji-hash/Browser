package ru.multibrowser

import android.content.Context
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

    private var runtime: GeckoRuntime? = null
    private val sessions = LinkedHashMap<Int, GeckoSession>(16, 0.75f, true)
    val canGoBack = HashMap<Int, Boolean>()

    fun runtime(ctx: Context): GeckoRuntime =
        runtime ?: GeckoRuntime.create(ctx.applicationContext).also { runtime = it }

    fun isActive(id: Int) = sessions.containsKey(id)

    fun session(ctx: Context, id: Int): GeckoSession {
        sessions[id]?.let { return it }
        val settings = GeckoSessionSettings.Builder()
            .contextId("profile_$id")
            .usePrivateMode(false)
            .build()
        val session = GeckoSession(settings)
        session.open(runtime(ctx))
        session.loadUri(Profiles.lastUrl(ctx, id))
        sessions[id] = session

        while (sessions.size > MAX_ACTIVE) {
            val eldest = sessions.entries.first()
            sessions.remove(eldest.key)
            canGoBack.remove(eldest.key)
            eldest.value.close()
        }
        return session
    }
}

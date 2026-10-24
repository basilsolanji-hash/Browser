package ru.multibrowser

import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.StorageController

/**
 * Один движок на всё приложение. Каждый профиль — отдельный contextId,
 * поэтому cookies и хранилища профилей не пересекаются и сохраняются между запусками.
 */
object Gecko {
    // Сколько вкладок держать в памяти — Settings.keepAlive; остальные «спят» и перезагружаются при открытии.

    // Gmail отдаёт незнакомым браузерам устаревшую «простую» версию, поэтому только для него
    // представляемся мобильным Chrome. Остальным сайтам (вход Google, Claude с защитой Cloudflare)
    // показываем честный UA Firefox: подмена там может вызывать бесконечные проверки «Вы человек?».
    private const val CHROME_UA =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
    private val CHROME_UA_HOSTS = setOf("mail.google.com")

    private var runtime: GeckoRuntime? = null
    private val sessions = LinkedHashMap<String, GeckoSession>(16, 0.75f, true)
    val canGoBack = HashMap<String, Boolean>()
    val canGoForward = HashMap<String, Boolean>()

    fun key(id: Int, site: Site) = "$id:${site.name}"

    fun runtime(ctx: Context): GeckoRuntime = runtime ?: GeckoRuntime.create(
        ctx.applicationContext,
        GeckoRuntimeSettings.Builder()
            .preferredColorScheme(colorScheme(Settings.theme(ctx)))
            // В отладочной сборке JS-консоль сайтов пишется в logcat (тег GeckoConsole) — для приёмочных тестов.
            .consoleOutput(ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            // Масштаб пальцами разрешён на любом сайте.
            .forceUserScalableEnabled(true)
            // Защита как в стандартном режиме Firefox: блокируются соцтрекеры, майнеры и сборщики
            // отпечатков, сторонние cookies изолируются по сайтам (вход через Google работает),
            // фишинг — с предупреждением. Рекламу и аналитику не режем: на них завязаны
            // приложения вроде claude.ai, и без них страница может зависнуть на белом экране.
            .contentBlocking(
                ContentBlocking.Settings.Builder()
                    .antiTracking(
                        ContentBlocking.AntiTracking.SOCIAL or
                            ContentBlocking.AntiTracking.CRYPTOMINING or
                            ContentBlocking.AntiTracking.FINGERPRINTING
                    )
                    .safeBrowsing(ContentBlocking.SafeBrowsing.DEFAULT)
                    .cookieBehavior(ContentBlocking.CookieBehavior.ACCEPT_FIRST_PARTY_AND_ISOLATE_OTHERS)
                    .build()
            )
            .build(),
    ).also { runtime = it }

    fun applyColorScheme(theme: Settings.Theme) {
        runtime?.settings?.setPreferredColorScheme(colorScheme(theme))
    }

    private fun colorScheme(theme: Settings.Theme) = when (theme) {
        Settings.Theme.DARK -> GeckoRuntimeSettings.COLOR_SCHEME_DARK
        Settings.Theme.LIGHT -> GeckoRuntimeSettings.COLOR_SCHEME_LIGHT
        Settings.Theme.SYSTEM -> GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM
    }

    /** Кэш общий для движка, поэтому чистится сразу у всех профилей; входы в аккаунты не затрагивает. */
    fun clearCache(ctx: Context) {
        runtime(ctx).storageController.clearData(StorageController.ClearFlags.ALL_CACHES)
    }

    fun isActive(id: Int) = Site.values().any { sessions.containsKey(key(id, it)) }

    /** @param initialUrl — если задан, открываем его вместо последней/домашней страницы (один load, без гонки). */
    fun session(ctx: Context, id: Int, site: Site, initialUrl: String? = null): GeckoSession {
        val key = key(id, site)
        sessions[key]?.let { existing ->
            if (initialUrl != null) existing.loadUri(initialUrl)
            return existing
        }
        val url = initialUrl ?: Profiles.lastUrl(ctx, id, site)
        val settings = GeckoSessionSettings.Builder()
            .contextId("profile_$id")
            .usePrivateMode(false)
            .apply { userAgentFor(url)?.let { userAgentOverride(it) } }
            .build()
        val session = GeckoSession(settings)
        session.open(runtime(ctx))
        session.loadUri(url)
        sessions[key] = session

        while (sessions.size > Settings.keepAlive(ctx)) {
            drop(sessions.entries.first().key)
        }
        return session
    }

    fun userAgentFor(url: String): String? =
        if (Uri.parse(url).host in CHROME_UA_HOSTS) CHROME_UA else null

    /** Выйти из всех аккаунтов профиля: закрыть вкладку и стереть cookies/хранилище его контекста. */
    fun clearProfile(ctx: Context, id: Int) {
        Site.values().forEach { drop(key(id, it)) }
        runtime(ctx).storageController.clearDataForSessionContext("profile_$id")
        Profiles.forget(ctx, id)
        History.clear(ctx, id)
    }

    /** Вкладка упала или выгружена системой — забываем её, чтобы следующий вызов session() создал новую. */
    fun forget(key: String) = drop(key)

    private fun drop(key: String) {
        sessions.remove(key)?.close()
        canGoBack.remove(key)
        canGoForward.remove(key)
    }
}

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

    fun key(id: Int, pin: Pin) = "$id:${pin.id}"

    /** Загружает адрес; маркер стартовой страницы — по выбору «Главная страница» (Home). */
    fun loadUrl(session: GeckoSession, url: String) {
        if (url == Pins.START) Home.load(session) else session.loadUri(url)
    }

    fun runtime(ctx: Context): GeckoRuntime = runtime ?: GeckoRuntime.create(
        ctx.applicationContext,
        GeckoRuntimeSettings.Builder()
            .preferredColorScheme(colorScheme(ctx))
            .fontSizeFactor(Settings.zoom(ctx) / 100f)
            // В отладочной сборке JS-консоль сайтов пишется в logcat (тег GeckoConsole) — для приёмочных тестов.
            .consoleOutput(ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            // Масштаб пальцами разрешён на любом сайте.
            .forceUserScalableEnabled(true)
            .allowInsecureConnections(httpsMode(ctx))
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
    ).also {
        runtime = it
        installReader(it)
        it.webNotificationDelegate = Notify.delegate(ctx)
    }

    /** Встроенное расширение режима чтения (assets/reader, Mozilla Readability) — в том числе для инкогнито. */
    private fun installReader(rt: GeckoRuntime) {
        val ext = rt.webExtensionController
        ext.ensureBuiltIn("resource://android/assets/reader/", "reader@os.browser").accept({ e ->
            if (e != null && !e.metaData.allowedInPrivateBrowsing) ext.setAllowedInPrivateBrowsing(e, true)
        }, { err -> Diag.log("reader", "extension: ${err?.message}") })
    }

    /** Вкладки в режиме «Версия для ПК» (ключ вкладки). */
    val desktop = HashSet<String>()

    /** Текущий адрес каждой вкладки профиля (ключ "профиль:вкладка") — чьё уведомление пришло. */
    val tabUrls = HashMap<String, String>()

    /** Последняя использованная вкладка с этим сайтом: (профиль, id вкладки) или null. */
    fun tabForHost(host: String): Pair<Int, String>? =
        sessions.keys.toList().asReversed().firstOrNull { k -> tabUrls[k]?.let { Uri.parse(it).host } == host }
            ?.let { k -> k.substringBefore(':').toIntOrNull()?.let { it to k.substringAfter(':') } }

    /** Вкладки, где сейчас стартовая страница Оси — её перерисовываем при смене языка. */
    val onStartPage: MutableSet<GeckoSession> = java.util.Collections.newSetFromMap(java.util.WeakHashMap())

    /** Сменился язык интерфейса: стартовые страницы — на новом языке. */
    fun onLanguageChanged() {
        onStartPage.toList().forEach { Home.load(it) }
    }

    private fun httpsMode(ctx: Context) =
        if (Settings.httpsOnly(ctx)) GeckoRuntimeSettings.HTTPS_ONLY else GeckoRuntimeSettings.ALLOW_ALL

    fun applyHttpsOnly(ctx: Context) {
        runtime?.settings?.setAllowInsecureConnections(httpsMode(ctx))
    }

    fun applyZoom(ctx: Context) {
        runtime?.settings?.fontSizeFactor = Settings.zoom(ctx) / 100f
    }

    /** Эфемерная приватная вкладка (инкогнито): не хранит cookies и историю, стирается при закрытии. */
    fun privateSession(ctx: Context, url: String): GeckoSession {
        val settings = GeckoSessionSettings.Builder()
            .usePrivateMode(true)
            .apply { userAgentFor(url)?.let { userAgentOverride(it) } }
            .build()
        val s = GeckoSession(settings)
        s.open(runtime(ctx))
        loadUrl(s, url)
        return s
    }

    fun applyColorScheme(ctx: Context) {
        runtime?.settings?.setPreferredColorScheme(colorScheme(ctx))
    }

    private fun colorScheme(ctx: Context) = when (Settings.themeId(ctx)) {
        "scarlet_light", "sand" -> GeckoRuntimeSettings.COLOR_SCHEME_LIGHT
        "system" -> GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM
        else -> GeckoRuntimeSettings.COLOR_SCHEME_DARK
    }

    /** Кэш общий для движка, поэтому чистится сразу у всех профилей; входы в аккаунты не затрагивает. */
    fun clearCache(ctx: Context) {
        runtime(ctx).storageController.clearData(StorageController.ClearFlags.ALL_CACHES)
    }

    /** Есть ли у профиля вкладки в памяти (закреплённые или обычные). */
    fun isActive(ctx: Context, id: Int) = sessions.keys.any { it.startsWith("$id:") }

    /** @param initialUrl — если задан, открываем его вместо последней/домашней страницы (один load, без гонки). */
    fun session(ctx: Context, id: Int, pin: Pin, initialUrl: String? = null): GeckoSession {
        val key = key(id, pin)
        sessions[key]?.let { existing ->
            if (initialUrl != null) existing.loadUri(initialUrl)
            return existing
        }
        val url = initialUrl ?: Profiles.lastUrl(ctx, id, pin)
        val settings = GeckoSessionSettings.Builder()
            .contextId("profile_$id")
            .usePrivateMode(false)
            .apply { userAgentFor(url)?.let { userAgentOverride(it) } }
            .build()
        val session = GeckoSession(settings)
        session.open(runtime(ctx))
        loadUrl(session, url)
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
        sessions.keys.filter { it.startsWith("$id:") }.forEach { drop(it) }
        Tabs.forgetProfile(ctx, id)
        runtime(ctx).storageController.clearDataForSessionContext("profile_$id")
        Profiles.forget(ctx, id)
        History.clear(ctx, id)
    }

    /** Вкладка упала или выгружена системой — забываем её, чтобы следующий вызов session() создал новую. */
    fun forget(key: String) = drop(key)

    /** Закрыть обычную вкладку профиля: выгрузить её сессию. */
    fun close(id: Int, tabId: String) = drop("$id:$tabId")

    private fun drop(key: String) {
        sessions.remove(key)?.close()
        canGoBack.remove(key)
        canGoForward.remove(key)
    }
}

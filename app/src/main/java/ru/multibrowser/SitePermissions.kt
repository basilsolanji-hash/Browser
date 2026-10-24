package ru.multibrowser

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PermissionDelegate
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.ContentPermission
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.MediaSource
import org.mozilla.geckoview.GeckoSession.PromptDelegate

/**
 * Разрешения сайтов: решения пользователя по домену хранятся только на устройстве.
 * По умолчанию — безопасно: без явного «Разрешить» сайт ничего не получает
 * (закрытый диалог = запрет), геолокация и уведомления — только по согласию.
 * В инкогнито решения не записываются на диск.
 */
object SitePermissions {

    enum class Mode { ASK, ALLOW, BLOCK }

    /** Тип разрешения: ключ хранения, подпись, допустимые значения по умолчанию и исходное значение. */
    enum class Kind(val key: String, val titleKey: String, val askKey: String, val defaults: List<Mode>, val initial: Mode) {
        LOCATION("location", "perm_location", "perm_q_location", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
        CAMERA("camera", "perm_camera", "perm_q_camera", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
        MICROPHONE("microphone", "perm_microphone", "perm_q_microphone", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
        NOTIFICATIONS("notifications", "perm_notifications", "perm_q_notifications", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
        POPUPS("popups", "perm_popups", "perm_q_popups", listOf(Mode.ASK, Mode.BLOCK, Mode.ALLOW), Mode.ASK),
        AUTOPLAY("autoplay", "perm_autoplay", "perm_autoplay", listOf(Mode.BLOCK, Mode.ALLOW), Mode.BLOCK),
        DRM("drm", "perm_drm", "perm_q_drm", listOf(Mode.ASK, Mode.BLOCK, Mode.ALLOW), Mode.ASK),
        COOKIES_3P("cookies3p", "perm_cookies3p", "perm_q_cookies3p", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
        LOCAL_NETWORK("local_network", "perm_local_network", "perm_q_local_network", listOf(Mode.ASK, Mode.BLOCK), Mode.ASK),
    }

    /** Чувствительные разрешения — для «Проверки безопасности». */
    val SENSITIVE = setOf(Kind.LOCATION, Kind.CAMERA, Kind.MICROPHONE, Kind.NOTIFICATIONS)

    const val EXTRA_HOST = "host"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("site_perms", Context.MODE_PRIVATE)
    private fun defaults(ctx: Context) = ctx.getSharedPreferences("site_perms_default", Context.MODE_PRIVATE)

    fun hostOf(url: String?): String? =
        url?.let { runCatching { Uri.parse(it).host }.getOrNull() }?.lowercase()?.takeIf { it.isNotBlank() }

    // --- Хранилище ---

    fun get(ctx: Context, host: String, kind: Kind): Mode? =
        prefs(ctx).getString("$host|${kind.key}", null)?.let { runCatching { Mode.valueOf(it) }.getOrNull() }

    /** Запомнить решение для сайта (null — забыть). Изменение сразу применяется и к движку. */
    fun set(ctx: Context, host: String, kind: Kind, mode: Mode?) {
        prefs(ctx).edit().apply {
            if (mode == null || mode == Mode.ASK) remove("$host|${kind.key}") else putString("$host|${kind.key}", mode.name)
        }.apply()
        syncGecko(ctx, host, kind, mode)
    }

    fun defaultMode(ctx: Context, kind: Kind): Mode =
        defaults(ctx).getString(kind.key, null)?.let { runCatching { Mode.valueOf(it) }.getOrNull() }
            ?.takeIf { it in kind.defaults } ?: kind.initial

    fun setDefault(ctx: Context, kind: Kind, mode: Mode) {
        if (mode in kind.defaults) defaults(ctx).edit().putString(kind.key, mode.name).apply()
    }

    /** Все сайты с сохранёнными решениями: домен → (тип → решение). */
    fun sites(ctx: Context): Map<String, Map<Kind, Mode>> {
        val out = sortedMapOf<String, MutableMap<Kind, Mode>>()
        prefs(ctx).all.forEach { (k, v) ->
            val host = k.substringBeforeLast('|')
            val kind = Kind.values().firstOrNull { it.key == k.substringAfterLast('|') } ?: return@forEach
            val mode = runCatching { Mode.valueOf(v as String) }.getOrNull() ?: return@forEach
            out.getOrPut(host) { sortedMapOf() }[kind] = mode
        }
        return out
    }

    fun clearSite(ctx: Context, host: String) {
        Kind.values().forEach { if (get(ctx, host, it) != null) set(ctx, host, it, null) }
    }

    fun clearAll(ctx: Context) {
        sites(ctx).keys.forEach { clearSite(ctx, it) }
    }

    /** Сколько разрешений выдано (ALLOW) и скольким сайтам. */
    fun granted(ctx: Context, kinds: Set<Kind> = Kind.values().toSet()): Pair<Int, Int> {
        var count = 0
        var sites = 0
        sites(ctx).values.forEach { m ->
            val n = m.count { (k, v) -> k in kinds && v == Mode.ALLOW }
            count += n
            if (n > 0) sites++
        }
        return count to sites
    }

    /** Открыть настройки сайтов для домена текущей страницы (или весь список). */
    fun openFor(activity: AppCompatActivity, url: String?) {
        activity.startActivity(Intent(activity, SiteSettingsActivity::class.java).apply {
            hostOf(url)?.takeIf { url?.startsWith("http") == true }?.let { putExtra(EXTRA_HOST, it) }
        })
    }

    // --- Движок: Gecko сам запоминает ответы, поэтому держим его в согласии с нашим хранилищем ---

    private fun kindOf(permission: Int): Kind? = when (permission) {
        PermissionDelegate.PERMISSION_GEOLOCATION -> Kind.LOCATION
        PermissionDelegate.PERMISSION_DESKTOP_NOTIFICATION -> Kind.NOTIFICATIONS
        PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE -> Kind.AUTOPLAY
        PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS -> Kind.DRM
        PermissionDelegate.PERMISSION_STORAGE_ACCESS -> Kind.COOKIES_3P
        PermissionDelegate.PERMISSION_LOCAL_DEVICE_ACCESS, PermissionDelegate.PERMISSION_LOCAL_NETWORK_ACCESS -> Kind.LOCAL_NETWORK
        else -> null
    }

    private fun geckoValue(mode: Mode?) = when (mode) {
        Mode.ALLOW -> ContentPermission.VALUE_ALLOW
        Mode.BLOCK -> ContentPermission.VALUE_DENY
        else -> ContentPermission.VALUE_PROMPT
    }

    private fun syncGecko(ctx: Context, host: String, kind: Kind, mode: Mode?) {
        runCatching {
            val storage = Gecko.runtime(ctx).storageController
            storage.getAllPermissions().accept { list ->
                list.orEmpty()
                    .filter { hostOf(it.uri) == host && kindOf(it.permission) == kind }
                    .forEach { storage.setPermission(it, geckoValue(mode)) }
            }
        }
    }

    private val main = Handler(Looper.getMainLooper())

    /** Разовое разрешение: движок записал «разрешить» навсегда — через пару секунд возвращаем «спрашивать». */
    private fun forgetLater(ctx: Context, perm: ContentPermission) {
        val app = ctx.applicationContext
        main.postDelayed({
            runCatching { Gecko.runtime(app).storageController.setPermission(perm, ContentPermission.VALUE_PROMPT) }
        }, 2500)
    }

    // --- Диалог запроса ---

    /**
     * Спросить пользователя. [onResult] получает (разрешено, запомнить).
     * Закрытие диалога без ответа — запрет без запоминания.
     */
    private fun ask(activity: AppCompatActivity, host: String, message: String, privateMode: Boolean, onResult: (Boolean, Boolean) -> Unit) {
        if (activity.isFinishing || activity.isDestroyed) { onResult(false, false); return }
        val remember = CheckBox(activity).apply {
            text = Tr.t("perm_remember")
            isChecked = true
            setTextColor(Ui.TEXT)
        }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(activity.dp(20), activity.dp(8), activity.dp(20), 0)
            addView(TextView(activity).apply {
                text = message
                textSize = 15f
                setTextColor(Ui.TEXT)
            })
            if (privateMode) {
                addView(TextView(activity).apply {
                    text = Tr.t("perm_private_note")
                    textSize = 12f
                    setTextColor(Ui.MUTED)
                    setPadding(0, activity.dp(10), 0, 0)
                })
            } else {
                addView(remember, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = activity.dp(8) })
            }
        }
        var answered = false
        AlertDialog.Builder(activity)
            .setTitle(host)
            .setView(box)
            .setPositiveButton(Tr.t("perm_allow")) { _, _ ->
                answered = true
                onResult(true, !privateMode && remember.isChecked)
            }
            .setNegativeButton(Tr.t("perm_block")) { _, _ ->
                answered = true
                onResult(false, !privateMode && remember.isChecked)
            }
            .setOnDismissListener { if (!answered) onResult(false, false) }
            .show()
    }

    /** Решение без диалога: сохранённое для сайта, иначе значение по умолчанию (ASK — нужен диалог). */
    private fun decided(ctx: Context, host: String, kind: Kind): Pair<Mode, Boolean> {
        get(ctx, host, kind)?.let { return it to true }
        return defaultMode(ctx, kind) to false
    }

    /** Всплывающие окна (из PromptDelegate.onPopupPrompt). [pageUrl] — адрес открывшей страницы; null — запрет. */
    fun onPopup(
        activity: AppCompatActivity,
        pageUrl: String?,
        prompt: PromptDelegate.PopupPrompt,
        privateMode: Boolean = false,
    ): GeckoResult<PromptDelegate.PromptResponse> {
        val host = hostOf(pageUrl) ?: return GeckoResult.fromValue(prompt.confirm(AllowOrDeny.DENY))
        val (mode, _) = decided(activity, host, Kind.POPUPS)
        if (mode != Mode.ASK) {
            return GeckoResult.fromValue(prompt.confirm(if (mode == Mode.ALLOW) AllowOrDeny.ALLOW else AllowOrDeny.DENY))
        }
        val result = GeckoResult<PromptDelegate.PromptResponse>()
        val target = prompt.targetUri?.let { "\n$it" }.orEmpty()
        ask(activity, host, Tr.t(Kind.POPUPS.askKey, host) + target, privateMode) { allow, remember ->
            if (remember) set(activity, host, Kind.POPUPS, if (allow) Mode.ALLOW else Mode.BLOCK)
            result.complete(prompt.confirm(if (allow) AllowOrDeny.ALLOW else AllowOrDeny.DENY))
        }
        return result
    }

    /** Обработчик разрешений для вкладки. Подключается одной строкой: s.permissionDelegate = SitePermissions.delegate(this). */
    fun delegate(activity: AppCompatActivity, privateMode: Boolean = false): PermissionDelegate = Delegate(activity, privateMode)

    private var requestSeq = 0

    private class Delegate(val activity: AppCompatActivity, val privateMode: Boolean) : PermissionDelegate {

        override fun onContentPermissionRequest(session: GeckoSession, perm: ContentPermission): GeckoResult<Int>? {
            val host = hostOf(perm.uri)
            val inPrivate = privateMode || perm.privateMode
            // Звук без автозапуска не мешает — разрешаем, если сайт явно не заблокирован.
            if (perm.permission == PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE) {
                return if (host != null && get(activity, host, Kind.AUTOPLAY) == Mode.BLOCK) {
                    GeckoResult.fromValue(ContentPermission.VALUE_DENY)
                } else {
                    forgetLater(activity, perm)
                    GeckoResult.fromValue(ContentPermission.VALUE_ALLOW)
                }
            }
            val kind = kindOf(perm.permission)
            // Неизвестный тип, XR, постоянное хранилище, страница без домена — тихий отказ (без записи).
            if (kind == null || host == null) return GeckoResult.fromValue(ContentPermission.VALUE_PROMPT)

            val (mode, remembered) = decided(activity, host, kind)
            when (mode) {
                Mode.BLOCK -> return GeckoResult.fromValue(
                    if (remembered) ContentPermission.VALUE_DENY else ContentPermission.VALUE_PROMPT,
                )
                Mode.ALLOW -> {
                    if (!remembered) forgetLater(activity, perm)
                    return GeckoResult.fromValue(ContentPermission.VALUE_ALLOW)
                }
                Mode.ASK -> Unit
            }
            val result = GeckoResult<Int>()
            val askHost = if (kind == Kind.COOKIES_3P) hostOf(perm.thirdPartyOrigin) ?: host else host
            ask(activity, host, Tr.t(kind.askKey, askHost), inPrivate) { allow, remember ->
                if (remember) set(activity, host, kind, if (allow) Mode.ALLOW else Mode.BLOCK)
                when {
                    allow && remember -> result.complete(ContentPermission.VALUE_ALLOW)
                    allow -> { forgetLater(activity, perm); result.complete(ContentPermission.VALUE_ALLOW) }
                    remember -> result.complete(ContentPermission.VALUE_DENY)
                    else -> result.complete(ContentPermission.VALUE_PROMPT)
                }
            }
            return result
        }

        /** Системные разрешения Android (камера, микрофон, геолокация) — запрашиваются только после согласия на сайте. */
        override fun onAndroidPermissionsRequest(
            session: GeckoSession,
            permissions: Array<out String>?,
            callback: PermissionDelegate.Callback,
        ) {
            val needed = permissions.orEmpty().filter {
                ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isEmpty()) { callback.grant(); return }
            if (activity.isFinishing || activity.isDestroyed) { callback.reject(); return }
            val key = "os_site_perm_${requestSeq++}"
            lateinit var launcher: ActivityResultLauncher<Array<String>>
            launcher = activity.activityResultRegistry.register(key, ActivityResultContracts.RequestMultiplePermissions()) { res ->
                launcher.unregister()
                val location = setOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                // Для геолокации достаточно примерного местоположения, если точное не дали.
                val ok = needed.all { p ->
                    res[p] == true || (p in location && location.any { res[it] == true })
                }
                if (ok) callback.grant() else callback.reject()
            }
            runCatching { launcher.launch(needed.toTypedArray()) }.onFailure { launcher.unregister(); callback.reject() }
        }

        override fun onMediaPermissionRequest(
            session: GeckoSession,
            uri: String,
            video: Array<out MediaSource>?,
            audio: Array<out MediaSource>?,
            callback: PermissionDelegate.MediaCallback,
        ) {
            val host = hostOf(uri)
            if (host == null) { callback.reject(); return }
            val cam = video?.firstOrNull { it.source == MediaSource.SOURCE_CAMERA } ?: video?.firstOrNull()
            val mic = audio?.firstOrNull { it.source == MediaSource.SOURCE_MICROPHONE } ?: audio?.firstOrNull()
            val kinds = listOfNotNull(cam?.let { Kind.CAMERA }, mic?.let { Kind.MICROPHONE })
            if (kinds.isEmpty()) { callback.reject(); return }
            val modes = kinds.map { decided(activity, host, it).first }
            if (Mode.BLOCK in modes) { callback.reject(); return }
            if (modes.all { it == Mode.ALLOW }) { callback.grant(cam, mic); return }
            val message = when {
                cam != null && mic != null -> Tr.t("perm_q_camera_mic", host)
                cam != null -> Tr.t(Kind.CAMERA.askKey, host)
                else -> Tr.t(Kind.MICROPHONE.askKey, host)
            }
            ask(activity, host, message, privateMode) { allow, remember ->
                if (remember) kinds.forEach { set(activity, host, it, if (allow) Mode.ALLOW else Mode.BLOCK) }
                if (allow) callback.grant(cam, mic) else callback.reject()
            }
        }
    }
}

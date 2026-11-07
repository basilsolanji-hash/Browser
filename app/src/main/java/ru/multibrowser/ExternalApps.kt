package ru.multibrowser

import android.app.Activity
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import org.mozilla.geckoview.GeckoSession
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.WeakHashMap

/** Исходящие ссылки в приложения. Не изменяет фильтр входящих ссылок DefaultBrowser. */
object ExternalApps {
    private val browserSchemes = setOf("http", "https", "about", "data", "file", "blob", "resource", "os", "moz-extension", "javascript")
    private val blockedSchemes = browserSchemes + setOf("javascript", "content", "intent", "android-app", "android.resource", "chrome", "jar", "view-source")
    private val packagePattern = Regex("[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+")
    private val prompts = WeakHashMap<Activity, WeakReference<Dialog>>()
    data class Link(val uri: Uri, val targetPackage: String?, val fallback: String?)

    fun intercepts(raw: String): Boolean = Uri.parse(raw).scheme?.lowercase(Locale.ROOT)?.let { it !in browserSchemes } == true

    private fun clean(raw: String): Boolean = raw.length in 1..8192 && raw.none { it.code < 0x20 || it.code == 0x7f }

    /** Только абсолютный веб-адрес; без credentials и рекурсивного intent/fallback. */
    fun webUrl(raw: String?): String? {
        if (raw == null || !clean(raw)) return null
        val uri = Uri.parse(raw)
        val host = uri.host ?: return null
        return raw.takeIf {
            uri.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") && uri.userInfo == null &&
                host.isNotBlank() && host.none { c -> c.isWhitespace() || c.code < 0x20 || c.code == 0x7f } &&
                uri.isHierarchical
        }
    }

    /** Parsed intent служит только источником data/package/fallback, никогда не запускается. */
    fun parse(raw: String, ownPackage: String): Link? {
        if (!clean(raw)) return null
        val isIntent = Uri.parse(raw).scheme.equals("intent", ignoreCase = true)
        val parsed = if (isIntent) runCatching { Intent.parseUri("intent:" + raw.substringAfter(':'), Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return null else null
        val uri = if (isIntent) parsed?.data ?: return null else Uri.parse(raw)
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (!clean(uri.toString()) || !Regex("[a-z][a-z0-9+.-]*").matches(scheme)) return null
        val pkg = parsed?.`package`
        if (pkg != null && (pkg.length > 255 || !packagePattern.matches(pkg) || pkg in setOf(ownPackage, "ru.multibrowser", "ru.multibrowser.test"))) return null
        val fallback = webUrl(parsed?.getStringExtra("browser_fallback_url"))
        // HTTP(S) without an explicit app package belongs in the existing profile, not the default browser.
        if (scheme in setOf("http", "https")) {
            val web = webUrl(uri.toString()) ?: return null
            return Link(uri, pkg, if (pkg == null) web else fallback)
        }
        if (scheme in blockedSchemes) return null
        return Link(uri, pkg, fallback)
    }

    fun intent(link: Link): Intent = Intent(Intent.ACTION_VIEW, link.uri).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
        link.targetPackage?.let { setPackage(it) }
    }

    /** Только trusted engine gesture в видимом top-level документе. Redirect сам по себе не запрещён. */
    fun eligible(hasGesture: Boolean, visible: Boolean, subframe: Boolean = false) = hasGesture && visible && !subframe

    private fun resumed(activity: Activity): Boolean = !activity.isFinishing && !activity.isDestroyed &&
        if (activity is LifecycleOwner) activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) else activity.hasWindowFocus()

    /** true = Gecko должен DENY, даже если запуск/подтверждение запрещены. */
    fun dispatch(activity: Activity, session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest, visible: () -> Boolean): Boolean {
        if (!intercepts(request.uri)) return false
        if (!eligible(request.hasUserGesture, visible()) || !resumed(activity)) return true
        val link = parse(request.uri, activity.packageName) ?: return true
        if (prompts[activity]?.get()?.isShowing == true) return true
        val dialog = AlertDialog.Builder(activity)
            .setTitle(Tr.t("open_app"))
            .setMessage(Tr.t("open_app_question"))
            .setPositiveButton(Tr.t("open")) { _, _ ->
                if (visible() && resumed(activity) && session.isOpen) launch(activity, session, link)
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .create()
        prompts[activity] = WeakReference(dialog)
        dialog.setOnDismissListener { if (prompts[activity]?.get() === dialog) prompts.remove(activity) }
        dialog.show()
        return true
    }

    private fun launch(activity: Activity, session: GeckoSession, link: Link) {
        if (link.uri.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") && link.targetPackage == null) {
            link.fallback?.let { session.loadUri(it) }
            return
        }
        try { activity.startActivity(intent(link)); return }
        catch (_: ActivityNotFoundException) { /* Нет приложения: безопасный веб-fallback ниже. */ }
        catch (_: SecurityException) { /* Приложение недоступно этому вызывающему. */ }
        if (link.fallback != null) session.loadUri(link.fallback)
        else unavailable(activity)
    }

    /** Явная команда меню: системный выбор специализированного приложения для текущего HTTPS/HTTP. */
    fun openWebLink(activity: Activity, raw: String) {
        val url = webUrl(raw) ?: return
        if (!resumed(activity)) return
        val uri = Uri.parse(url)
        val pm = activity.packageManager
        fun view(target: Uri) = Intent(Intent.ACTION_VIEW, target).addCategory(Intent.CATEGORY_BROWSABLE)
        @Suppress("DEPRECATION")
        val browsers = pm.queryIntentActivities(view(Uri.parse("${uri.scheme}://example.invalid/")), PackageManager.MATCH_DEFAULT_ONLY)
            .mapNotNull { it.activityInfo?.packageName }.toSet()
        @Suppress("DEPRECATION")
        val candidates = pm.queryIntentActivities(view(uri), PackageManager.MATCH_DEFAULT_ONLY)
            .mapNotNull { it.activityInfo }
            .filter { it.enabled && it.exported && it.applicationInfo?.enabled != false && it.packageName != activity.packageName && it.packageName !in browsers }
            .distinctBy { it.packageName to it.name }
            .map { view(uri).setComponent(ComponentName(it.packageName, it.name)) }
        if (candidates.isEmpty()) { unavailable(activity); return }
        val chooser = Intent.createChooser(candidates.first(), Tr.t("open_app"))
        if (candidates.size > 1) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, candidates.drop(1).toTypedArray())
        try { activity.startActivity(chooser) }
        catch (_: ActivityNotFoundException) { unavailable(activity) }
        catch (_: SecurityException) { unavailable(activity) }
    }

    private fun unavailable(activity: Activity) = Toast.makeText(activity, Tr.t("app_not_found"), Toast.LENGTH_SHORT).show()
    fun dismiss(activity: Activity) { prompts.remove(activity)?.get()?.dismiss() }
}

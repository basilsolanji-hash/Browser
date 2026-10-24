package ru.multibrowser

import android.app.Activity
import android.app.Dialog
import android.net.Uri
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.content.res.ColorStateList
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView

/**
 * Всплывающие окна входа («Войти через Google» и т.п.). Такой вход открывает окно-попап и ждёт,
 * что оно вернёт результат своему «родителю» (window.opener) и закроется само. Если грузить попап
 * в ту же вкладку, родителя уже нет и вход зацикливается. Поэтому попап — отдельная сессия
 * с теми же настройками (тот же профиль и cookies, тот же приватный режим), показанная поверх вкладки.
 */
object Popups {
    // Адреса, которые открываем отдельным окном; остальные ссылки «в новом окне» — как раньше, в той же вкладке.
    private val AUTH_HOSTS = setOf(
        "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com", "login.live.com",
        "oauth.yandex.ru", "id.vk.com",
    )

    fun isAuthPopup(uri: String): Boolean {
        val u = Uri.parse(uri)
        val host = u.host ?: return false
        return host in AUTH_HOSTS || u.path.orEmpty().contains("oauth", ignoreCase = true) ||
            u.path.orEmpty().contains("authorize", ignoreCase = true) ||
            u.getQueryParameter("display") == "popup"
    }

    /** Ответ для NavigationDelegate.onNewSession: новая (ещё не открытая) сессия, показанная окном. */
    fun open(activity: Activity, opener: GeckoSession, uri: String): GeckoResult<GeckoSession> {
        val popup = GeckoSession(GeckoSessionSettings.Builder(opener.settings).build())
        show(activity, popup, uri)
        return GeckoResult.fromValue(popup)
    }

    private fun show(activity: Activity, popup: GeckoSession, uri: String) {
        val dialog = Dialog(activity, R.style.Theme_MultiBrowser)
        val title = TextView(activity).apply {
            textSize = 14f
            setTextColor(Ui.TEXT)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.MIDDLE
            text = Uri.parse(uri).host ?: uri
            setPadding(activity.dp(8), 0, activity.dp(8), 0)
        }
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = ColorStateList.valueOf(Ui.ACCENT)
        }
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.BG)
            setPadding(activity.dp(10), activity.dp(8), activity.dp(10), activity.dp(8))
            addView(activity.icon(R.drawable.ic_lock, Ui.MUTED, 14))
            addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(activity.iconButton(R.drawable.ic_delete, Tr.t("close")) { dialog.dismiss() },
                LinearLayout.LayoutParams(activity.dp(40), activity.dp(40)))
        }
        val view = GeckoView(activity)
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            layoutDirection = activity.window.decorView.layoutDirection
            addView(bar)
            addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, activity.dp(2)))
            addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        popup.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onProgressChange(session: GeckoSession, value: Int) { progress.progress = value }
            override fun onPageStop(session: GeckoSession, success: Boolean) { progress.progress = 0 }
        }
        popup.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                if (url != null) title.text = Uri.parse(url).host ?: url
            }

            // Вложенные окна внутри попапа открываем в нём же.
            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                session.loadUri(uri)
                return null
            }
        }
        popup.contentDelegate = object : GeckoSession.ContentDelegate {
            // Сайт сам закрыл окно (window.close) — вход завершён, возвращаемся на вкладку.
            override fun onCloseRequest(session: GeckoSession) = dialog.dismiss()
            override fun onCrash(session: GeckoSession) = dialog.dismiss()
        }

        dialog.setContentView(root)
        dialog.window?.let { w ->
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            WindowCompat.setDecorFitsSystemWindows(w, false)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        dialog.setOnDismissListener {
            view.releaseSession()
            popup.close()
        }
        // Сессию открывает и загружает сам движок после ответа onNewSession. Вид привязываем только
        // к уже открытой сессии, иначе GeckoView попробует открыть её сам на другом движке.
        Diag.log("popup", "окно входа: $uri")
        attachWhenOpen(activity, dialog, view, popup, 0)
    }

    private fun attachWhenOpen(activity: Activity, dialog: Dialog, view: GeckoView, popup: GeckoSession, tries: Int) {
        if (activity.isFinishing || activity.isDestroyed) { popup.close(); return }
        if (popup.isOpen) {
            view.setSession(popup)
            dialog.show()
        } else if (tries < 50) {
            activity.window.decorView.postDelayed({ attachWhenOpen(activity, dialog, view, popup, tries + 1) }, 40)
        } else {
            Diag.log("popup", "окно не открылось")
        }
    }
}

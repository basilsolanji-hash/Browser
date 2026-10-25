package ru.multibrowser

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.Autocomplete
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.GeckoWebExecutor
import org.mozilla.geckoview.WebRequest
import org.mozilla.geckoview.WebRequestError
import org.mozilla.geckoview.WebResponse
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BrowserActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_SITE = "site"
        const val EXTRA_URL = "url"
        const val EXTRA_GROUP = "group"

        /** Действие при открытии (из сетки вкладок и для приёмочных тестов через am start --es action ...). */
        const val EXTRA_ACTION = "action"
        const val ACTION_NEW_TAB = "new_tab"
        const val ACTION_TABS = "tabs"
        const val ACTION_SELECT_TABS = "select_tabs"
        const val ACTION_NEW_GROUP = "new_group"
        const val ACTION_INCOGNITO = "incognito"
        const val ACTION_SEARCH = "search"
        const val ACTION_CLOSE_ALL = "close_all"
    }

    private lateinit var geckoView: OsGeckoView
    private lateinit var refresher: OsRefreshLayout
    private var barsHidden = false
    private lateinit var chipDot: View
    private lateinit var chipName: TextView
    private lateinit var tabBar: LinearLayout
    private lateinit var tabsCount: TextView
    private lateinit var findBar: FindBar
    private lateinit var addressPanel: AddressPanel
    private lateinit var tabScroll: HorizontalScrollView
    private lateinit var progress: ProgressBar
    private lateinit var switcher: LinearLayout
    private lateinit var backButton: View
    private lateinit var urlBar: EditText
    private lateinit var lockIcon: View
    private val chrome = mutableListOf<View>() // всё, что прячется в полноэкранном режиме
    private var fullScreen = false // полный экран по запросу сайта (видео)
    private var userFullScreen = false // полный экран, включённый пользователем из меню
    private lateinit var exitFullButton: View
    private lateinit var forwardButton: View
    private var profileId = 0
    private var pin: Pin = Pin("gmail", "Gmail", "https://mail.google.com/")
    private var session: GeckoSession? = null
    private var currentUrl = ""

    private var incognito = false
    private var incognitoSession: GeckoSession? = null

    private val key get() = if (incognito) "incognito" else Gecko.key(profileId, pin)

    private val tools by lazy { PageTools(this, { session }, { currentUrl }, { if (incognito) null else profileId }) }

    // Адрес, загружаемый сейчас в каждой вкладке, — чтобы подписать запись истории заголовком страницы.
    private val pageUrls = HashMap<String, String>()

    // Заголовок страницы по вкладке (адрес → заголовок) — для «В избранное».
    private val pageTitles = HashMap<String, Pair<String, String>>()

    // Вкладки, которым этот экран назначил обработчики; при закрытии экрана их отвязываем,
    // чтобы фоновые вкладки не обращались к уничтоженному экрану (диалоги, тосты).
    private val attached = mutableSetOf<GeckoSession>()

    // Ожидающий выбор файла (вложения в Gmail и т.п.).
    private var pendingFile: Pair<GeckoSession.PromptDelegate.FilePrompt,
        GeckoResult<GeckoSession.PromptDelegate.PromptResponse>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val (prompt, result) = pendingFile ?: return@registerForActivityResult
        pendingFile = null
        if (uris.isEmpty()) {
            result.complete(prompt.dismiss())
            return@registerForActivityResult
        }
        // Копируем в свою папку (GeckoView читает файлы по пути) — в фоне, файлы бывают большими.
        val app = applicationContext
        Thread {
            val files = Uploads.copy(app, uris)
            runOnUiThread {
                if (files.isEmpty()) Toast.makeText(this, Tr.t("upload_failed"), Toast.LENGTH_SHORT).show()
                result.complete(answerFilePrompt(prompt, files))
            }
        }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    fullScreen -> session?.exitFullScreen()
                    ::findBar.isInitialized && findBar.isShown -> findBar.hide()
                    userFullScreen -> setUserFullScreen(false)
                    urlBar.hasFocus() -> urlBar.clearFocus()
                    Gecko.canGoBack[key] == true -> session?.goBack()
                    incognito -> { exitIncognito(); openTab(profileId, pin) }
                    else -> finish()
                }
            }
        })
        openTab(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openTab(intent)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        Passwords.activeProfile = if (incognito) 0 else profileId
        if (profileId != 0 && !incognito && Tabs.isTab(pin.id) && Tabs.byId(this, profileId, pin.id) == null) {
            // Текущую вкладку закрыли в сетке вкладок — переходим на соседнюю.
            geckoView.releaseSession()
            openTab(profileId, fallbackTab())
        } else if (profileId != 0 && !incognito && !Tabs.isTab(pin.id) && Pins.byId(this, pin.id, profileId) == null) {
            // Закреплённую вкладку убрали из набора профиля (экран профиля, настройки).
            openTab(profileId, Pins.resolve(this, pin.id, profileId))
        } else if (profileId != 0 && session?.isOpen != true) {
            // Вкладку могли закрыть, пока экран был в фоне (очистка профиля в списке).
            openTab(profileId, pin)
        }
        renderTabs()
    }

    override fun onPause() {
        super.onPause()
        Stats.flush(this)
    }

    /** Куда перейти, если текущую вкладку закрыли: последняя открытая вкладка или первая закреплённая. */
    private fun fallbackTab(): Pin =
        Tabs.list(this, profileId).lastOrNull()?.let { Tabs.pin(this, it) } ?: Pins.all(this, profileId).first()

    override fun onDestroy() {
        exitIncognito()
        geckoView.releaseSession()
        attached.forEach {
            it.progressDelegate = null
            it.navigationDelegate = null
            it.contentDelegate = null
            it.promptDelegate = null
            it.selectionActionDelegate = null
            it.permissionDelegate = null
        }
        attached.clear()
        pendingFile?.let { (prompt, result) -> result.complete(prompt.dismiss()) }
        pendingFile = null
        super.onDestroy()
    }

    private fun openTab(intent: Intent) {
        // Открыли из уведомления сайта — передаём клик сайту (после открытия его вкладки ниже).
        intent.getStringExtra(Notify.EXTRA_TAG)?.let { tag ->
            intent.removeExtra(Notify.EXTRA_TAG)
            geckoView.post { Notify.clicked(tag) }
        }
        val id = intent.getIntExtra(EXTRA_PROFILE, profileId.coerceAtLeast(1))
        // Ссылка из другого приложения (VIEW) или наш экстра — с фильтром схем (DefaultBrowser).
        val url = DefaultBrowser.incomingUrl(this, intent)
        val action = intent.getStringExtra(EXTRA_ACTION)
        // Действие выполняем один раз: при пересоздании экрана интент тот же.
        intent.removeExtra(EXTRA_ACTION)
        if (action == ACTION_NEW_TAB) {
            newTab(id, url, intent.getStringExtra(EXTRA_GROUP))
            return
        }
        val pinId = intent.getStringExtra(EXTRA_SITE) ?: Profiles.lastPinId(this)
        // Последнюю вкладку могли закрыть — тогда открываем последнюю из оставшихся.
        val target = if (Tabs.isTab(pinId) && Tabs.byId(this, id, pinId) == null && intent.getStringExtra(EXTRA_SITE) == null)
            Tabs.list(this, id).lastOrNull()?.let { Tabs.pin(this, it) } ?: Pins.all(this, id).first()
        else Tabs.resolve(this, id, pinId)
        openTab(id, target, if (action == ACTION_INCOGNITO) null else url)
        when (action) {
            ACTION_TABS -> showTabs()
            ACTION_SELECT_TABS -> showTabs(TabsActivity.MODE_SELECT)
            ACTION_NEW_GROUP -> showTabs(TabsActivity.MODE_NEW_GROUP)
            ACTION_INCOGNITO -> openIncognito(url ?: Pins.START)
            ACTION_SEARCH -> focusSearch()
            ACTION_CLOSE_ALL -> confirmCloseAll()
        }
    }

    /** Новая обычная вкладка в профиле (по умолчанию — стартовая страница). */
    private fun newTab(id: Int = profileId, url: String? = null, group: String? = null) {
        val tab = Tabs.add(this, id, url ?: Pins.START, group?.takeIf { Tabs.group(this, id, it) != null })
        openTab(id, Tabs.pin(this, tab))
    }

    /** Сетка открытых вкладок профиля. */
    private fun showTabs(mode: String? = null) {
        startActivity(Intent(this, TabsActivity::class.java)
            .putExtra(TabsActivity.EXTRA_PROFILE, profileId)
            .apply {
                if (!incognito) putExtra(TabsActivity.EXTRA_CURRENT, pin.id)
                if (mode != null) putExtra(TabsActivity.EXTRA_MODE, mode)
                if (!incognito && Tabs.isTab(pin.id)) putExtra(TabsActivity.EXTRA_ADD, pin.id)
            })
    }

    /** «Поиск»: показать панели и поставить курсор в адресную строку с клавиатурой. */
    private fun focusSearch() {
        setBarsHidden(false)
        urlBar.requestFocus()
        urlBar.post {
            getSystemService(InputMethodManager::class.java)?.showSoftInput(urlBar, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun confirmCloseAll() {
        val n = Tabs.count(this, profileId)
        if (n == 0 && !incognito) {
            Toast.makeText(this, Tr.t("no_tabs_to_close"), Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("close_all_tabs"))
            .setMessage(Tr.t("close_all_q", n + if (incognito) 1 else 0))
            .setPositiveButton(Tr.t("close")) { _, _ ->
                val onTab = incognito || Tabs.isTab(pin.id)
                if (onTab) geckoView.releaseSession()
                if (incognito) exitIncognito()
                Tabs.closeAll(this, profileId)
                if (onTab) openTab(profileId, Pins.all(this, profileId).first()) else renderTabs()
                Toast.makeText(this, Tr.t("tabs_closed"), Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun openTab(id: Int, newPin: Pin, url: String? = null) {
        if (incognito) exitIncognito()
        if (id == profileId && newPin.id == pin.id && session?.isOpen == true) {
            url?.let { u -> session?.let { Gecko.loadUrl(it, u) } }
            return
        }
        geckoView.releaseSession()
        profileId = id
        pin = newPin
        Profiles.saveLastPinId(this, newPin.id)
        Profiles.saveLastProfile(this, id)
        Passwords.activeProfile = id

        val p = Profiles.get(this, id)
        chipDot.background = Ui.oval(p.color)
        chipName.text = p.name
        renderTabs()
        showUrl(url ?: Profiles.lastUrl(this, id, newPin))
        progress.visibility = View.GONE
        setBarsHidden(false)

        // Один load: нужный адрес передаём внутрь создания сессии, без гонки с домашней страницей.
        val s = Gecko.session(this, id, newPin, url)
        attachDelegates(s, id, newPin)
        geckoView.setSession(s)
        session = s
        renderSwitcher()
        updateNavButtons()
    }

    /** Перерисовать полосу закреплённых вкладок (их список настраивается и мог измениться). */
    private fun renderTabs() {
        tabBar.removeAllViews()
        Pins.all(this, profileId).forEach { p ->
            val selected = !incognito && p.id == pin.id
            tabBar.addView(TextView(this).apply {
                text = p.title
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(dp(8), 0, dp(8), 0)
                background = if (selected) Ui.rounded(Ui.ACCENT, dpf(5)) else null
                setTextColor(if (selected) Ui.ON_ACCENT else Ui.MUTED)
                minWidth = dp(72)
                setOnClickListener { openTab(profileId, p) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT)
                .apply { marginEnd = dp(2) })
        }
        // Текущая обычная вкладка — подсвеченным ярлыком после закреплённых; нажатие — сетка вкладок.
        val open = if (incognito) null else Tabs.byId(this, profileId, pin.id)
        if (open != null) {
            val group = Tabs.group(this, profileId, open.group)
            tabBar.addView(TextView(this).apply {
                text = Tabs.label(this@BrowserActivity, open)
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 1
                maxWidth = dp(110)
                ellipsize = TextUtils.TruncateAt.END
                setPadding(dp(8), 0, dp(8), 0)
                background = Ui.rounded(Ui.ACCENT, dpf(5), if (group != null) dp(2) else 0, group?.color ?: Ui.ACCENT)
                setTextColor(Ui.ON_ACCENT)
                minWidth = dp(72)
                setOnClickListener { showTabs() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT))
            // Полоса прокручивается: показываем ярлык текущей вкладки целиком.
            val chip = tabBar.getChildAt(tabBar.childCount - 1)
            chip.post { tabScroll.smoothScrollTo(maxOf(0, chip.right - tabScroll.width + dp(4)), 0) }
        }
        val n = Tabs.count(this, profileId)
        tabsCount.text = if (n > 99) "∞" else n.toString()
    }

    /** В покое — только домен и замок для https, при редактировании — полный адрес. */
    private fun showUrl(url: String) {
        currentUrl = url
        val internal = url.startsWith("data:") || url.startsWith("os:") || url == Pins.START || url == "about:blank"
        lockIcon.visibility = if (url.startsWith("https://") && !urlBar.hasFocus()) View.VISIBLE else View.GONE
        if (!urlBar.hasFocus()) urlBar.setText(if (internal) "" else Uri.parse(Reader.original(url)).host ?: url)
    }

    private fun setBarsHidden(hidden: Boolean) {
        if (hidden == barsHidden) return
        barsHidden = hidden
        chrome.forEach { it.visibility = if (hidden) View.GONE else View.VISIBLE }
    }

    private fun setFullScreen(on: Boolean) {
        fullScreen = on
        applyFullScreen()
    }

    private fun setUserFullScreen(on: Boolean) {
        userFullScreen = on
        if (on) urlBar.clearFocus()
        applyFullScreen()
    }

    /** Панели и системные полосы прячутся, пока активен любой из двух полноэкранных режимов. */
    private fun applyFullScreen() {
        val on = fullScreen || userFullScreen
        barsHidden = false
        chrome.forEach { it.visibility = if (on) View.GONE else View.VISIBLE }
        if (!on) progress.visibility = View.GONE
        exitFullButton.visibility = if (userFullScreen && !fullScreen) View.VISIBLE else View.GONE
        WindowInsetsControllerCompat(window, geckoView).apply {
            if (on) {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            } else {
                show(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    private fun updateNavButtons() {
        backButton.alpha = if (Gecko.canGoBack[key] == true) 1f else 0.35f
        forwardButton.alpha = if (Gecko.canGoForward[key] == true) 1f else 0.35f
    }

    private fun attachDelegates(s: GeckoSession, id: Int, tab: Pin) {
        val k = Gecko.key(id, tab)
        val visible = { k == key }
        // Для «Статистики»: сколько трекеров заблокировала защита.
        s.contentBlockingDelegate = object : ContentBlocking.Delegate {
            override fun onContentBlocked(session: GeckoSession, event: ContentBlocking.BlockEvent) {
                Stats.trackerBlocked(this@BrowserActivity)
            }
        }
        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                Diag.log(k, "начало: $url")
                if (!url.startsWith("data:")) Gecko.onStartPage -= session
                if (visible()) {
                    progress.visibility = View.VISIBLE
                    setBarsHidden(false)
                }
            }

            override fun onProgressChange(session: GeckoSession, value: Int) {
                if (visible()) progress.progress = value
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
                Diag.log(k, if (success) "загружено" else "загрузка не удалась")
                if (visible()) progress.visibility = View.GONE
            }
        }
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            // Истинный текущий адрес (после всех редиректов) — отсюда ведём строку, историю и сохранение.
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                if (url == null) return
                if (!url.startsWith("data:")) Gecko.onStartPage -= session
                if (visible()) showUrl(url)
                // В историю и восстановление — без метки режима чтения.
                val clean = Reader.original(url)
                Profiles.saveLastUrl(this@BrowserActivity, id, tab, clean)
                if (Tabs.isTab(tab.id)) Tabs.update(this@BrowserActivity, id, tab.id, url = clean)
                History.add(this@BrowserActivity, id, clean)
                pageUrls[k] = url
                Gecko.tabUrls[k] = url
            }

            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                Gecko.canGoBack[k] = canGoBack
                if (visible()) updateNavButtons()
            }

            override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {
                Gecko.canGoForward[k] = canGoForward
                if (visible()) updateNavButtons()
            }

            // Вместо пустого экрана — понятная страница ошибки.
            override fun onLoadError(
                session: GeckoSession,
                uri: String?,
                error: WebRequestError,
            ): GeckoResult<String>? {
                Diag.log(k, "ошибка ${error.category}/${error.code}: $uri")
                return GeckoResult.fromValue(errorPage(uri, error))
            }

            // Окна входа (Google и др.) — настоящим попапом, иначе вход зацикливается;
            // остальные ссылки «в новом окне» открываем в той же вкладке.
            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                if (Popups.isAuthPopup(uri)) return Popups.open(this@BrowserActivity, session, uri)
                if (uri.isBlank()) return hiddenWindow(session, pageUrls[k], privateMode = false)
                session.loadUri(uri)
                return null
            }

            // Переключаем User-Agent между страницами входа и остальными сайтами (см. Gecko.userAgentFor).
            override fun onLoadRequest(
                session: GeckoSession,
                request: GeckoSession.NavigationDelegate.LoadRequest,
            ): GeckoResult<AllowOrDeny>? {
                val ua = Gecko.userAgentFor(request.uri)
                if (ua == session.settings.userAgentOverride) return null
                Diag.log(k, "смена UA (${if (ua == null) "Firefox" else "Chrome"}): ${request.uri}")
                session.settings.userAgentOverride = ua
                session.loadUri(request.uri)
                return GeckoResult.deny()
            }
        }
        s.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onTitleChange(session: GeckoSession, title: String?) {
                Profiles.updateFromTitle(this@BrowserActivity, id, title)
                if (Tabs.isTab(tab.id) && title != null) {
                    Tabs.update(this@BrowserActivity, id, tab.id, title = title)
                    if (visible()) renderTabs()
                }
                val url = pageUrls[k]
                if (url != null && !title.isNullOrBlank()) History.setTitle(this@BrowserActivity, id, url, title)
                if (url != null && !title.isNullOrBlank()) pageTitles[k] = url to title
            }

            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                Downloads.request(this@BrowserActivity, pageUrls[k] ?: response.uri, response)
            }

            // Процесс страницы упал или выгружен системой — без этого остаётся белый экран.
            override fun onCrash(session: GeckoSession) = recover(Tr.t("crash_reason"))

            override fun onKill(session: GeckoSession) = recover(Tr.t("killed_reason"))

            private fun recover(reason: String) {
                Diag.log(k, reason)
                attached.remove(s)
                Gecko.forget(k)
                if (visible()) {
                    Toast.makeText(this@BrowserActivity, Tr.t("restarted", reason), Toast.LENGTH_SHORT).show()
                    geckoView.releaseSession()
                    openTab(id, tab)
                }
            }

            // Видео и игры на весь экран: прячем панели браузера и системы.
            override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) {
                if (visible()) setFullScreen(fullScreen)
            }
        }
        s.promptDelegate = PromptHandler()
        s.selectionActionDelegate = tools.textActions()
        s.permissionDelegate = SitePermissions.delegate(this)
        attached += s
    }

    private fun renderSwitcher() {
        switcher.removeAllViews()
        Profiles.all(this).forEach { p ->
            val current = p.id == profileId
            switcher.addView(TextView(this).apply {
                text = p.id.toString()
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                background = if (current) Ui.oval(p.color, dp(2), Ui.TEXT) else Ui.oval(p.color)
                alpha = if (current || Gecko.isActive(this@BrowserActivity, p.id)) 1f else 0.55f
                contentDescription = p.name
                // Обычные вкладки свои у каждого профиля, поэтому в другом профиле — его закреплённая
                // (та же, если есть в его наборе, иначе первая).
                setOnClickListener {
                    openTab(p.id, if (Tabs.isTab(pin.id)) Pins.all(this@BrowserActivity, p.id).first()
                        else Pins.resolve(this@BrowserActivity, pin.id, p.id))
                }
            }, LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(8) })
        }
    }

    private fun styleTab(view: TextView, selected: Boolean) {
        view.background = if (selected) Ui.rounded(Ui.ACCENT, dpf(5)) else null
        view.setTextColor(if (selected) Ui.ON_ACCENT else Ui.MUTED)
    }

    private fun actionButton(iconRes: Int, label: String, onClick: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(0, dp(6), 0, dp(4))
        contentDescription = label
        addView(icon(iconRes))
        addView(TextView(context).apply {
            text = label
            textSize = 10f
            gravity = Gravity.CENTER
            setTextColor(Ui.MUTED)
            setPadding(0, dp(3), 0, 0)
        })
        setOnClickListener { onClick() }
    }

    private fun exitIncognito() {
        incognitoSession?.let { attached.remove(it); it.close() }
        incognitoSession = null
        incognito = false
        Passwords.activeProfile = profileId
        Gecko.canGoBack.remove("incognito")
        Gecko.canGoForward.remove("incognito")
    }

    /** Открыть приватную вкладку: без истории и cookies, данные стираются при выходе. */
    private fun openIncognito(url: String) {
        geckoView.releaseSession()
        incognito = true
        Passwords.activeProfile = 0
        val s = Gecko.privateSession(this, url)
        attached += s
        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, u: String) {
                if (incognito) { progress.visibility = View.VISIBLE; showUrl(u); setBarsHidden(false) }
            }
            override fun onProgressChange(session: GeckoSession, value: Int) { if (incognito) progress.progress = value }
            override fun onPageStop(session: GeckoSession, success: Boolean) { if (incognito) progress.visibility = View.GONE }
        }
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(session: GeckoSession, u: String?, perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>, hasUserGesture: Boolean) {
                if (incognito && u != null) showUrl(u)
            }
            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) { Gecko.canGoBack["incognito"] = canGoBack; if (incognito) updateNavButtons() }
            override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) { Gecko.canGoForward["incognito"] = canGoForward; if (incognito) updateNavButtons() }
            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                if (Popups.isAuthPopup(uri)) return Popups.open(this@BrowserActivity, session, uri)
                if (uri.isBlank()) return hiddenWindow(session, currentUrl, privateMode = true)
                session.loadUri(uri); return null
            }
            override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny>? {
                val ua = Gecko.userAgentFor(request.uri)
                if (ua == session.settings.userAgentOverride) return null
                session.settings.userAgentOverride = ua
                session.loadUri(request.uri)
                return GeckoResult.deny()
            }
        }
        s.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                Downloads.request(this@BrowserActivity, currentUrl.takeIf { it.startsWith("http") } ?: response.uri, response, privateMode = true)
            }
            override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) { setFullScreen(fullScreen) }
        }
        s.promptDelegate = PromptHandler()
        s.selectionActionDelegate = tools.textActions()
        s.permissionDelegate = SitePermissions.delegate(this, privateMode = true)
        geckoView.setSession(s)
        incognitoSession = s
        session = s
        // Чип профиля превращаем в индикатор инкогнито; вкладки не подсвечены.
        chipDot.background = Ui.oval(Ui.MUTED)
        chipName.text = Tr.t("incognito")
        showUrl(url)
        renderTabs()
        updateNavButtons()
    }

    private fun zoomDialog() {
        val percent = intArrayOf(Settings.zoom(this))
        val label = TextView(this).apply {
            textSize = 20f; gravity = Gravity.CENTER; setTextColor(Ui.TEXT)
            text = "${percent[0]}%"; setPadding(0, dp(12), 0, dp(12))
        }
        fun step(d: Int) {
            percent[0] = (percent[0] + d).coerceIn(50, 250)
            Settings.setZoom(this, percent[0]); label.text = "${percent[0]}%"
            session?.reload()
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(8), dp(24), 0)
            fun btn(t: String, d: Int) = TextView(context).apply {
                text = t; textSize = 22f; gravity = Gravity.CENTER; setTextColor(Ui.TEXT)
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1)); setOnClickListener { step(d) }
            }
            addView(btn("−", -10), LinearLayout.LayoutParams(dp(56), dp(48)))
            addView(label, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(btn("+", 10), LinearLayout.LayoutParams(dp(56), dp(48)))
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("zoom"))
            .setView(row)
            .setNeutralButton("100%") { _, _ -> Settings.setZoom(this, 100); session?.reload() }
            .setPositiveButton(Tr.t("close"), null)
            .show()
    }

    /** Меню ⋮ как в Chrome: ряд кнопок (назад, вперёд, избранное, сохранить, обновить) и группы пунктов. */
    @Suppress("UNUSED_PARAMETER")
    private fun showMenu(anchor: View) {
        fun item(icon: Int, title: String, enabled: Boolean = true, checked: Boolean? = null, action: () -> Unit) =
            BrowserMenu.Item(icon, title, enabled, checked, action)
        fun open(screen: Class<*>) = { startActivity(Intent(this, screen)) }
        val web = currentUrl.startsWith("http")
        val top = listOf(
            item(R.drawable.ic_back, Tr.t("back"), Gecko.canGoBack[key] == true) { session?.goBack() },
            item(R.drawable.ic_forward, Tr.t("forward"), Gecko.canGoForward[key] == true) { session?.goForward() },
            item(R.drawable.ic_star, BookmarksActivity.menuLabel(this, currentUrl), web) {
                BookmarksActivity.toggle(this, currentUrl, pageTitles[key]?.takeIf { it.first == currentUrl }?.second.orEmpty())
            },
            item(R.drawable.ic_download, Tr.t("save_page"), web) { tools.savePage() },
            item(R.drawable.ic_refresh, Tr.t("refresh")) { session?.reload() },
        )
        val groups = listOf(
            listOf(
                item(R.drawable.ic_add, Tr.t("new_tab")) { newTab() },
                item(R.drawable.ic_incognito, Tr.t("new_incognito")) { openIncognito(Pins.START) },
                item(R.drawable.ic_group, Tr.t("new_tab_group")) { showTabs(TabsActivity.MODE_NEW_GROUP) },
            ),
            listOf(
                item(R.drawable.ic_history, Tr.t("history")) { showHistory() },
                item(R.drawable.ic_delete, Tr.t("clear_title")) { showClear() },
                item(R.drawable.ic_shield, Tr.t("site_permissions"), web) { SitePermissions.openFor(this, currentUrl) },
            ),
            listOf(
                item(R.drawable.ic_lock, Tr.t("cabinet")) { openCabinet() },
                item(R.drawable.ic_download, Tr.t("dl_title"), action = open(DownloadsActivity::class.java)),
                item(R.drawable.ic_star, Tr.t("favorites")) { BookmarksActivity.open(this, profileId) },
                item(R.drawable.ic_tabs, Tr.t("tabs")) { showTabs() },
                item(R.drawable.ic_offline, Tr.t("saved_pages"), action = open(SavedPagesActivity::class.java)),
                item(R.drawable.ic_note, Tr.t("notes"), action = open(NotesActivity::class.java)),
            ),
            listOf(item(R.drawable.ic_zoom, Tr.t("zoom")) { zoomDialog() }),
            listOf(
                item(R.drawable.ic_share, Tr.t("share"), web) { sharePage() },
                item(R.drawable.ic_find, Tr.t("find_in_page"), web) { findBar.show() },
                item(R.drawable.ic_book, tools.readerTitle(), web) { tools.toggleReader() },
                item(R.drawable.ic_link, Tr.t("copy_link"), web) { copyUrl() },
                item(R.drawable.ic_open_external, Tr.t("open_external"), web) { openExternally() },
                item(R.drawable.ic_desktop, Tr.t("desktop_site"), web, Gecko.desktop.contains(key)) { toggleDesktop() },
                item(R.drawable.ic_fullscreen, Tr.t("full_screen")) { setUserFullScreen(true) },
            ),
            listOf(
                item(R.drawable.ic_settings, Tr.t("settings"), action = open(SettingsActivity::class.java)),
                item(R.drawable.ic_help, Tr.t("help_feedback"), action = open(HelpActivity::class.java)),
                item(R.drawable.ic_info, Tr.t("diagnostics")) { showDiagnostics() },
            ),
            if (DefaultBrowser.isDefault(this)) emptyList()
            else listOf(item(R.drawable.ic_os, Tr.t("default_make")) { DefaultBrowser.request(this) }),
        )
        BrowserMenu(this).show(top, groups)
    }

    private fun openCabinet() {
        startActivity(Intent(this, AccountActivity::class.java).putExtra(AccountActivity.EXTRA_PROFILE, profileId))
    }

    /** Вид настраиваемой кнопки нижней панели: иконка и подпись. */
    private fun bottomButtonLook(id: String): Pair<Int, String> = when (id) {
        "clear" -> R.drawable.ic_delete to Tr.t("clear_short")
        "favorites" -> R.drawable.ic_star to Tr.t("favorites")
        "tabs" -> R.drawable.ic_tabs to Tr.t("tabs")
        "notes" -> R.drawable.ic_note to Tr.t("notes")
        "saved" -> R.drawable.ic_offline to Tr.t("saved_pages")
        "share" -> R.drawable.ic_share to Tr.t("share")
        "find" -> R.drawable.ic_find to Tr.t("find_in_page")
        else -> R.drawable.ic_download to Tr.t("downloads")
    }

    private fun bottomButtonAction(id: String) {
        when (id) {
            "clear" -> showClear()
            "favorites" -> BookmarksActivity.open(this, profileId)
            "tabs" -> showTabs()
            "notes" -> startActivity(Intent(this, NotesActivity::class.java))
            "saved" -> startActivity(Intent(this, SavedPagesActivity::class.java))
            "share" -> sharePage()
            "find" -> if (currentUrl.startsWith("http")) findBar.show()
            else -> startActivity(Intent(this, DownloadsActivity::class.java))
        }
    }

    /** Чип профиля: список профилей, текущий отмечен; выбор сразу переключает. */
    private fun showProfilePicker() {
        val all = Profiles.all(this)
        val dialog = android.app.Dialog(this)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(12), 0, dp(8))
            addView(TextView(context).apply {
                text = Tr.t("switch_profile")
                textSize = 16f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                setPadding(dp(20), dp(4), dp(20), dp(10))
            })
        }
        all.forEach { p ->
            val current = !incognito && p.id == profileId
            content.addView(LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(20), dp(6), dp(16), dp(6))
                minimumHeight = dp(56)
                if (current) setBackgroundColor(Ui.BG)
                contentDescription = p.name
                setOnClickListener {
                    dialog.dismiss()
                    if (current) return@setOnClickListener
                    exitIncognito()
                    openTab(p.id, if (Tabs.isTab(pin.id)) Pins.all(this@BrowserActivity, p.id).first()
                        else Pins.resolve(this@BrowserActivity, pin.id, p.id))
                }
                addView(TextView(context).apply {
                    text = p.name.take(1).uppercase()
                    textSize = 14f
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setTextColor(Color.WHITE)
                    background = Ui.oval(p.color)
                }, LinearLayout.LayoutParams(dp(32), dp(32)))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), 0, dp(8), 0)
                    addView(TextView(context).apply {
                        text = p.name
                        textSize = 15f
                        setTextColor(Ui.TEXT)
                        if (current) typeface = Typeface.DEFAULT_BOLD
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                    })
                    val sub = p.email ?: p.description.takeIf { it.isNotBlank() }
                    if (sub != null) addView(TextView(context).apply {
                        text = sub
                        textSize = 12f
                        setTextColor(Ui.MUTED)
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                    })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                if (Profiles.isPinned(this@BrowserActivity, p.id)) addView(icon(R.drawable.ic_pin, Ui.MUTED, 16))
                if (current) addView(icon(R.drawable.ic_check, Ui.ACCENT, 20).apply {
                    contentDescription = Tr.t("profile_current")
                    (layoutParams as LinearLayout.LayoutParams).marginStart = dp(8)
                })
            })
        }
        content.addView(View(this).apply { setBackgroundColor(Ui.BORDER) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(6); bottomMargin = dp(6) })
        content.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), 0, dp(16), 0)
            minimumHeight = dp(52)
            setOnClickListener {
                dialog.dismiss()
                exitIncognito()
                startActivity(Intent(this@BrowserActivity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }
            addView(icon(R.drawable.ic_group, Ui.TEXT, 22))
            addView(TextView(context).apply {
                text = Tr.t("all_profiles")
                textSize = 15f
                setTextColor(Ui.TEXT)
                setPadding(dp(18), 0, 0, 0)
            })
        })
        dialog.setContentView(android.widget.ScrollView(this).apply {
            background = Ui.rounded(Ui.SURFACE, dpf(18))
            addView(content)
        })
        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            setDimAmount(0.25f)
            setGravity(Gravity.TOP or Gravity.START)
            attributes = attributes.apply { x = dp(8); y = dp(8) }
            val dm = resources.displayMetrics
            setLayout(minOf(dp(320), dm.widthPixels - dp(16)), android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
    }

    /** «Поделиться» адресом текущей страницы через системное окно. */
    private fun sharePage() {
        val url = Reader.original(currentUrl)
        if (!url.startsWith("http")) return
        val title = pageTitles[key]?.takeIf { it.first == currentUrl }?.second
        runCatching {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, url)
                title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
            }, Tr.t("share")))
        }
    }

    /** «Версия для ПК»: настольный User-Agent и область просмотра для этой вкладки; страница перезагружается. */
    private fun toggleDesktop() {
        val s = session ?: return
        val on = Gecko.desktop.add(key) || run { Gecko.desktop.remove(key); false }
        s.settings.userAgentMode = if (on) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
        s.settings.viewportMode = if (on) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
        s.reload()
    }

    private fun showHistory() {
        val visits = History.list(this, profileId)
        val name = Profiles.get(this, profileId).name
        if (visits.isEmpty()) {
            Toast.makeText(this, Tr.t("history_empty", name), Toast.LENGTH_SHORT).show()
            return
        }
        val fmt = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())
        val labels = visits.map { v ->
            val head = v.title.ifBlank { Uri.parse(v.url).host ?: v.url }
            "$head\n${Uri.parse(v.url).host ?: ""} · ${fmt.format(Date(v.time))}"
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(Tr.t("history_title", name))
            .setItems(labels) { _, i -> session?.loadUri(visits[i].url) }
            .setNeutralButton(Tr.t("clear_history")) { _, _ ->
                History.clear(this, profileId)
                Toast.makeText(this, Tr.t("history_cleared"), Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(Tr.t("close"), null)
            .show()
    }

    private fun showClear() {
        val name = Profiles.get(this, profileId).name
        val options = arrayOf(
            Tr.t("opt_history", name),
            Tr.t("opt_cache"),
            Tr.t("opt_logout", name),
        )
        val checked = booleanArrayOf(true, true, false)
        AlertDialog.Builder(this)
            .setTitle(Tr.t("clear_title"))
            .setMultiChoiceItems(options, checked) { _, i, on -> checked[i] = on }
            .setPositiveButton(Tr.t("clear")) { _, _ ->
                if (checked[0]) History.clear(this, profileId)
                if (checked[1]) Gecko.clearCache(this)
                if (checked[2]) {
                    // Закрываем вкладки профиля, стираем его данные и открываем заново — уже без входа.
                    geckoView.releaseSession()
                    Gecko.clearProfile(this, profileId)
                    openTab(profileId, Tabs.resolve(this, profileId, pin.id))
                }
                Toast.makeText(this, Tr.t("done"), Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun showDiagnostics() {
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull()
        val text = "Ось $version\n${Profiles.get(this, profileId).name} / ${pin.title}\n$currentUrl\n\n${Diag.text()}"
        AlertDialog.Builder(this)
            .setTitle(Tr.t("diagnostics"))
            .setMessage(text)
            .setPositiveButton(Tr.t("copy_link")) { _, _ ->
                getSystemService(ClipboardManager::class.java)
                    ?.setPrimaryClip(ClipData.newPlainText("diag", text))
            }
            .setNegativeButton(Tr.t("close"), null)
            .show()
    }

    private fun errorPage(uri: String?, error: WebRequestError): String {
        val reason = when (error.category) {
            WebRequestError.ERROR_CATEGORY_NETWORK -> Tr.t("err_network")
            WebRequestError.ERROR_CATEGORY_SECURITY -> Tr.t("err_security")
            WebRequestError.ERROR_CATEGORY_URI -> Tr.t("err_uri")
            WebRequestError.ERROR_CATEGORY_SAFEBROWSING -> Tr.t("err_safe")
            else -> Tr.t("err_generic")
        }
        val dark = Ui.dark
        val html = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;padding:32px 20px;font-family:sans-serif;
            background:${if (dark) "#1B1B1D" else "#F5F5F7"};color:${if (dark) "#E8E8EA" else "#1B1B1D"}">
            <h2 style="margin:0 0 12px">${Tr.t("page_not_opened")}</h2>
            <p style="color:${if (dark) "#9A9AA2" else "#6B6B73"};line-height:1.5">$reason</p>
            <p style="font-size:12px;color:#888;word-break:break-all">${(uri ?: "").replace("<", "&lt;")}<br>
            Код: ${error.category}/${error.code}</p>
            <p style="color:#2BA89A">${Tr.t("err_retry")}</p></body>"""
        return "data:text/html;charset=utf-8," + Uri.encode(html)
    }

    private fun copyUrl() {
        getSystemService(ClipboardManager::class.java)
            ?.setPrimaryClip(ClipData.newPlainText("url", currentUrl))
        Toast.makeText(this, Tr.t("link_copied"), Toast.LENGTH_SHORT).show()
    }

    private fun openExternally() {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(currentUrl))) }
    }

    private fun buildUi() {
        // Чип профиля: цвет + имя. Нажатие — к списку профилей.
        chipDot = View(this)
        chipName = TextView(this).apply {
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            maxWidth = dp(96)
            ellipsize = TextUtils.TruncateAt.END
        }
        val chip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(10), 0, dp(12), 0)
            addView(chipDot, LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(8) })
            addView(chipName)
            contentDescription = Tr.t("switch_profile")
            setOnClickListener { showProfilePicker() }
        }

        // Полоса закреплённых вкладок (настраивается в настройках); прокручивается, если их много.
        tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        tabScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(tabBar)
        }

        val more = iconButton(R.drawable.ic_more, Tr.t("menu")) { showMenu(it) }

        // Кнопка сетки вкладок со счётчиком открытых вкладок профиля.
        tabsCount = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            includeFontPadding = false
            setTextColor(Ui.TEXT)
            background = Ui.rounded(Color.TRANSPARENT, dpf(4), dp(2), Ui.TEXT)
        }
        val tabsButton = FrameLayout(this).apply {
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            contentDescription = Tr.t("tabs")
            addView(tabsCount, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
            setOnClickListener { showTabs() }
        }

        val h = dp(40)
        val tabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(chip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, h))
            addView(tabScroll, LinearLayout.LayoutParams(0, h, 1f).apply { marginStart = dp(8) })
            addView(tabsButton, LinearLayout.LayoutParams(h, h).apply { marginStart = dp(8) })
            addView(more, LinearLayout.LayoutParams(h, h).apply { marginStart = dp(8) })
        }

        // Адресная строка: домен с замком; нажатие — полный адрес для правки или поиска.
        lockIcon = icon(R.drawable.ic_lock, Ui.MUTED, 14)
        urlBar = EditText(this).apply {
            setSingleLine()
            textSize = 14f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            hint = Tr.t("address_hint")
            imeOptions = EditorInfo.IME_ACTION_GO
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = null
            setPadding(dp(8), 0, dp(8), 0)
            setOnEditorActionListener { _, action, event ->
                val enter = event != null &&
                    event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
                if (action == EditorInfo.IME_ACTION_GO || enter) {
                    val url = toUrl(text.toString())
                    session?.loadUri(url)
                    currentUrl = url
                    clearFocus()
                    true
                } else false
            }
        }
        val engineBadge = FrameLayout(this).apply { visibility = View.GONE }
        val clearButton = iconButton(R.drawable.ic_close, Tr.t("clear_text")) { urlBar.setText("") }
            .apply { visibility = View.GONE }
        val addressBox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), 0, dp(4), 0)
            addView(lockIcon)
            addView(engineBadge, LinearLayout.LayoutParams(dp(24), dp(24)))
            addView(urlBar, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            addView(clearButton, LinearLayout.LayoutParams(dp(34), dp(34)))
        }
        urlBar.setOnFocusChangeListener { v, focused ->
            addressBox.background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1), if (focused) Ui.ACCENT else Ui.BORDER)
            // При вводе слева — значок поисковика (куда уйдёт запрос), справа — «Очистить».
            engineBadge.visibility = if (focused) View.VISIBLE else View.GONE
            lockIcon.visibility = if (!focused && currentUrl.startsWith("https://")) View.VISIBLE else View.GONE
            if (focused) {
                engineBadge.removeAllViews()
                engineBadge.addView(engineLetter(), FrameLayout.LayoutParams(dp(24), dp(24)))
                urlBar.setText(if (currentUrl.startsWith("data:")) "" else Reader.original(currentUrl))
                urlBar.post { urlBar.selectAll() }
                addressPanel.show(if (incognito) 0 else profileId,
                    pageTitles[key]?.takeIf { it.first == currentUrl }?.second.orEmpty(), Reader.original(currentUrl))
            } else {
                clearButton.visibility = View.GONE
                addressPanel.hide()
                urlBar.setText(Uri.parse(Reader.original(currentUrl)).host ?: currentUrl)
                getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(v.windowToken, 0)
            }
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(10), dp(8), dp(10), dp(8))
            addView(tabRow)
            addView(addressBox, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38))
                .apply { topMargin = dp(8) })
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(Ui.ACCENT)
        }

        geckoView = OsGeckoView(this).apply { coverUntilFirstPaint(Ui.BG) }
        // Свайп вниз от верха страницы — обновить. Блок внутри страницы, который ещё
        // может прокрутиться вверх (чат Claude, письма Gmail), свайп не перехватывает.
        refresher = OsRefreshLayout(this).apply {
            setColorSchemeColors(Ui.ACCENT)
            setProgressBackgroundColorSchemeColor(Ui.SURFACE)
            canScrollContentUp = { !geckoView.canPullToRefresh }
            setOnRefreshListener {
                setBarsHidden(false)
                session?.reload()
                postDelayed({ isRefreshing = false }, 900)
            }
            addView(geckoView)
        }

        // Панель действий: как в обычном браузере, всё под большим пальцем.
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(4), dp(2), dp(4), 0)
        }
        fun action(iconRes: Int, label: String, onClick: () -> Unit) = actionButton(iconRes, label, onClick).also {
            actions.addView(it, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        backButton = action(R.drawable.ic_back, Tr.t("back")) { session?.goBack() }
        forwardButton = action(R.drawable.ic_forward, Tr.t("forward")) { session?.goForward() }
        action(R.drawable.ic_home, Tr.t("home")) {
            if (incognito) { exitIncognito(); openTab(profileId, pin) }
            else session?.let { Gecko.loadUrl(it, if (Tabs.isTab(pin.id)) Pins.START else pin.url) }
        }
        action(R.drawable.ic_history, Tr.t("history")) { showHistory() }
        // Настраиваемая кнопка (по умолчанию — скачанные файлы).
        val (bottomIcon, bottomLabel) = bottomButtonLook(Settings.bottomButton(this))
        action(bottomIcon, bottomLabel) { bottomButtonAction(Settings.bottomButton(this)) }
        action(R.drawable.ic_refresh, Tr.t("refresh")) { session?.reload() }

        // Нижняя полоса: быстрое переключение между профилями без возврата к списку.
        switcher = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(6), dp(2), dp(8))
        }
        val switcherScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setBackgroundColor(Ui.BG)
            addView(switcher)
        }

        fun divider() = View(this).apply { setBackgroundColor(Ui.BORDER) }
        val match = LinearLayout.LayoutParams.MATCH_PARENT
        // Страница, поверх неё — панель адресной строки (при вводе) и «Найти на странице».
        findBar = FindBar(this) { session }
        addressPanel = AddressPanel(this,
            onOpen = { url -> urlBar.clearFocus(); session?.let { Gecko.loadUrl(it, url) } },
            onShare = { urlBar.clearFocus(); sharePage() },
            onCopy = { copyUrl() },
            onEdit = { urlBar.setSelection(urlBar.text.length) },
            onFill = { text -> urlBar.setText(text); urlBar.setSelection(urlBar.text.length) },
        )
        urlBar.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                clearButton.visibility = if (urlBar.hasFocus() && !s.isNullOrEmpty()) View.VISIBLE else View.GONE
                if (urlBar.hasFocus()) addressPanel.render(s?.toString().orEmpty())
            }
        })
        val contentArea = FrameLayout(this).apply {
            addView(refresher, FrameLayout.LayoutParams(match, match))
            addView(addressPanel.view, FrameLayout.LayoutParams(match, match))
            addView(findBar.view, FrameLayout.LayoutParams(match, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
        }
        val top = Settings.barPosition(this) == Settings.BarPosition.TOP
        val topDivider = divider()
        val bottomDivider = divider()
        if (top) {
            root.addView(toolbar)
            root.addView(topDivider, LinearLayout.LayoutParams(match, dp(1)))
            root.addView(progress, LinearLayout.LayoutParams(match, dp(2)))
            root.addView(contentArea, LinearLayout.LayoutParams(match, 0, 1f))
            root.addView(bottomDivider, LinearLayout.LayoutParams(match, dp(1)))
        } else {
            root.addView(contentArea, LinearLayout.LayoutParams(match, 0, 1f))
            root.addView(progress, LinearLayout.LayoutParams(match, dp(2)))
            root.addView(bottomDivider, LinearLayout.LayoutParams(match, dp(1)))
            root.addView(toolbar.apply { setPadding(dp(10), dp(6), dp(10), dp(2)) })
        }
        root.addView(actions)
        chrome += listOf(toolbar, topDivider, bottomDivider, actions)
        if (Settings.showSwitcher(this)) {
            root.addView(switcherScroll)
            chrome += switcherScroll
        } else {
            // Без полосы профилей добавляем нижний отступ панели действий.
            actions.setPadding(dp(4), dp(2), dp(4), dp(6))
        }

        // Листаем вниз — панели прячутся, ведём пальцем вниз — возвращаются.
        if (Settings.autoHideBars(this)) {
            geckoView.onContentScrolledUp = { if (!fullScreen && !userFullScreen && !urlBar.hasFocus()) setBarsHidden(true) }
            geckoView.onContentScrolledDown = { if (!fullScreen && !userFullScreen) setBarsHidden(false) }
        }

        // Фокус по умолчанию — на корне, иначе адресная строка захватывает его при открытии экрана.
        root.isFocusableInTouchMode = true
        // Полупрозрачная кнопка выхода из полного экрана — поверх страницы, в углу.
        exitFullButton = iconButton(R.drawable.ic_fullscreen_exit, Tr.t("exit_full_screen")) { setUserFullScreen(false) }.apply {
            background = Ui.rounded(Ui.SURFACE, dpf(20))
            alpha = 0.7f
            visibility = View.GONE
        }
        val frame = FrameLayout(this).apply {
            setBackgroundColor(Ui.BG)
            addView(root, FrameLayout.LayoutParams(match, match))
            addView(exitFullButton, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.TOP or Gravity.END).apply {
                setMargins(dp(12), dp(12), dp(12), dp(12))
            })
        }
        setContentView(frame)
        applyEdgeToEdge(root)
        root.requestFocus()
    }

    private fun toUrl(input: String): String = Search.toUrl(this, input)

    /** Кружок с первой буквой текущего поисковика — без значков из сети. */
    private fun engineLetter() = TextView(this).apply {
        val engine = Search.current(this@BrowserActivity)
        text = engine.title.take(1)
        textSize = 13f
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(android.graphics.Color.WHITE)
        background = Ui.oval(Search.color(engine))
        contentDescription = engine.title
    }

    private var forwardedUrl: String? = null
    private var forwardedAt = 0L

    /**
     * Окно без адреса (так движок отдаёт, например, PDF «как файл»): скрытая сессия того же профиля.
     * Пришёл файл — обычное скачивание; пришла страница — открываем её во вкладке.
     */
    private fun hiddenWindow(opener: GeckoSession, pageUrl: String?, privateMode: Boolean): GeckoResult<GeckoSession> {
        val hidden = GeckoSession(GeckoSessionSettings.Builder(opener.settings).build())
        fun done() { if (hidden.isOpen) hidden.close() }
        var location: String? = null
        var downloaded = false
        hidden.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                downloaded = true
                Downloads.request(this@BrowserActivity, pageUrl ?: response.uri, response, privateMode)
                geckoView.postDelayed({ done() }, 1000)
            }
            override fun onCloseRequest(session: GeckoSession) = done()
        }
        // Адрес появляется раньше, чем станет ясно, файл это или страница: ждём конца загрузки.
        hidden.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                if (!url.isNullOrBlank() && url != "about:blank") location = url
            }
        }
        hidden.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStop(session: GeckoSession, success: Boolean) {
                val url = location ?: return
                geckoView.postDelayed({
                    if (downloaded || !hidden.isOpen) return@postDelayed
                    done()
                    if (!success) return@postDelayed
                    val now = System.currentTimeMillis()
                    val repeat = url == forwardedUrl && now - forwardedAt < 10_000
                    if (url == pageUrl || repeat || Uri.parse(url).path.orEmpty().endsWith(".pdf", true)) {
                        // Движок сам показал файл-вложение (PDF) в новом окне — скачиваем его, как любой файл.
                        fetchDownload(url, pageUrl, privateMode)
                    } else {
                        // Обычная страница — во вкладку.
                        forwardedUrl = url
                        forwardedAt = now
                        opener.loadUri(url)
                    }
                }, 500)
            }
        }
        // Ничего не пришло — не держим лишнюю сессию.
        geckoView.postDelayed({ done() }, 60_000)
        Diag.log("window", "окно без адреса — скрытая сессия")
        return GeckoResult.fromValue(hidden)
    }

    /** Скачать адрес отдельным запросом и передать в обычное скачивание (с вопросом о разрешении). */
    private fun fetchDownload(url: String, pageUrl: String?, privateMode: Boolean) {
        if (!url.startsWith("http")) return
        Diag.log("window", "файл из окна — скачиваем: $url")
        val request = WebRequest.Builder(url).referrer(pageUrl).build()
        val flags = if (privateMode) GeckoWebExecutor.FETCH_FLAGS_ANONYMOUS else GeckoWebExecutor.FETCH_FLAGS_NONE
        GeckoWebExecutor(Gecko.runtime(this)).fetch(request, flags).accept({ response ->
            if (response != null) runOnUiThread { Downloads.request(this, pageUrl ?: url, response, privateMode) }
        }, { e -> Diag.log("window", "не скачалось: ${e?.message}") })
    }

    private fun answerFilePrompt(
        prompt: GeckoSession.PromptDelegate.FilePrompt,
        uris: List<Uri>,
    ): GeckoSession.PromptDelegate.PromptResponse = when {
        uris.isEmpty() -> prompt.dismiss()
        prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.MULTIPLE ->
            prompt.confirm(this, uris.toTypedArray())
        else -> prompt.confirm(this, uris[0])
    }

    /** Окна сайтов: alert/confirm и выбор файлов. Без этого GeckoView молча их пропускает. */
    private inner class PromptHandler : GeckoSession.PromptDelegate {
        private fun dialog(title: String?, message: String?) = AlertDialog.Builder(this@BrowserActivity)
            .setTitle(title?.takeIf { it.isNotBlank() })
            .setMessage(message)

        override fun onAlertPrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.AlertPrompt,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            dialog(prompt.title, prompt.message)
                .setPositiveButton("OK", null)
                .setOnDismissListener { result.complete(prompt.dismiss()) }
                .show()
            return result
        }

        override fun onButtonPrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.ButtonPrompt,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            var answered = false
            dialog(prompt.title, prompt.message)
                .setPositiveButton("OK") { _, _ ->
                    answered = true
                    result.complete(prompt.confirm(GeckoSession.PromptDelegate.ButtonPrompt.Type.POSITIVE))
                }
                .setNegativeButton(Tr.t("cancel")) { _, _ ->
                    answered = true
                    result.complete(prompt.confirm(GeckoSession.PromptDelegate.ButtonPrompt.Type.NEGATIVE))
                }
                .setOnDismissListener { if (!answered) result.complete(prompt.dismiss()) }
                .show()
            return result
        }

        // Сохранить пароль после входа на сайт: в профиль открытой вкладки, не в инкогнито.
        override fun onLoginSave(
            session: GeckoSession,
            request: GeckoSession.PromptDelegate.AutocompleteRequest<Autocomplete.LoginSaveOption>,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
            val option = request.options.firstOrNull() ?: return null
            val host = Uri.parse(option.value.origin).host.orEmpty()
            val id = profileId
            if (incognito || id == 0 || !Passwords.offer(this@BrowserActivity) || host in Passwords.never(this@BrowserActivity, id)) {
                return GeckoResult.fromValue(request.dismiss())
            }
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            var answered = false
            dialog(Tr.t("password_save_q", host), option.value.username?.takeIf { it.isNotBlank() })
                .setPositiveButton(Tr.t("save")) { _, _ ->
                    answered = true
                    Passwords.activeProfile = id
                    result.complete(request.confirm(option))
                }
                .setNeutralButton(Tr.t("password_never")) { _, _ ->
                    answered = true
                    Passwords.setNever(this@BrowserActivity, id, host, true)
                    result.complete(request.dismiss())
                }
                .setNegativeButton(Tr.t("not_now")) { _, _ -> answered = true; result.complete(request.dismiss()) }
                .setOnDismissListener { if (!answered) result.complete(request.dismiss()) }
                .show()
            return result
        }

        // Несколько сохранённых аккаунтов на сайте — выбрать, каким войти.
        override fun onLoginSelect(
            session: GeckoSession,
            request: GeckoSession.PromptDelegate.AutocompleteRequest<Autocomplete.LoginSelectOption>,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
            val options = request.options
            if (options.isEmpty()) return null
            if (options.size == 1) return GeckoResult.fromValue(request.confirm(options[0]))
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            var answered = false
            AlertDialog.Builder(this@BrowserActivity)
                .setTitle(Tr.t("login_pick"))
                .setItems(options.map { it.value.username?.ifBlank { null } ?: "—" }.toTypedArray()) { _, i ->
                    answered = true
                    result.complete(request.confirm(options[i]))
                }
                .setOnDismissListener { if (!answered) result.complete(request.dismiss()) }
                .show()
            return result
        }

        // Всплывающие окна без жеста пользователя — по разрешению сайта (только для видимой вкладки).
        override fun onPopupPrompt(session: GeckoSession, prompt: GeckoSession.PromptDelegate.PopupPrompt) =
            SitePermissions.onPopup(this@BrowserActivity, currentUrl.takeIf { session === this@BrowserActivity.session }, prompt, incognito)

        override fun onFilePrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.FilePrompt,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            pendingFile?.let { (old, oldResult) -> oldResult.complete(old.dismiss()) }
            pendingFile = prompt to result
            val mime = prompt.mimeTypes?.singleOrNull()?.takeIf { it.contains('/') } ?: "*/*"
            // Отправка файлов сайту — по разрешению сайта (по умолчанию разрешено, см. SitePermissions.UPLOADS).
            SitePermissions.check(this@BrowserActivity, currentUrl, SitePermissions.Kind.UPLOADS,
                { host -> Tr.t("perm_q_uploads", host) }, incognito) { ok ->
                if (ok) pickFiles.launch(mime)
                else pendingFile?.let { (p, r) -> pendingFile = null; r.complete(p.dismiss()) }
            }
            return result
        }
    }
}

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
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.core.view.WindowInsetsControllerCompat
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebRequestError
import org.mozilla.geckoview.WebResponse
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BrowserActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_SITE = "site"
        const val EXTRA_URL = "url"
    }

    private lateinit var geckoView: OsGeckoView
    private lateinit var refresher: SwipeRefreshLayout
    private var barsHidden = false
    private lateinit var chipDot: View
    private lateinit var chipName: TextView
    private lateinit var tabs: Map<Site, TextView>
    private lateinit var progress: ProgressBar
    private lateinit var switcher: LinearLayout
    private lateinit var backButton: View
    private lateinit var urlBar: EditText
    private lateinit var lockIcon: View
    private val chrome = mutableListOf<View>() // всё, что прячется в полноэкранном режиме
    private var fullScreen = false
    private lateinit var forwardButton: View
    private var profileId = 0
    private var site = Site.GMAIL
    private var session: GeckoSession? = null
    private var currentUrl = ""

    private val key get() = Gecko.key(profileId, site)

    // Адрес, загружаемый сейчас в каждой вкладке, — чтобы подписать запись истории заголовком страницы.
    private val pageUrls = HashMap<String, String>()

    // Вкладки, которым этот экран назначил обработчики; при закрытии экрана их отвязываем,
    // чтобы фоновые вкладки не обращались к уничтоженному экрану (диалоги, тосты).
    private val attached = mutableSetOf<GeckoSession>()

    // Ожидающий выбор файла (вложения в Gmail и т.п.).
    private var pendingFile: Pair<GeckoSession.PromptDelegate.FilePrompt,
        GeckoResult<GeckoSession.PromptDelegate.PromptResponse>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val (prompt, result) = pendingFile ?: return@registerForActivityResult
        pendingFile = null
        result.complete(answerFilePrompt(prompt, uris))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Ui.init(this)
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    fullScreen -> session?.exitFullScreen()
                    urlBar.hasFocus() -> urlBar.clearFocus()
                    Gecko.canGoBack[key] == true -> session?.goBack()
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
        // Вкладку могли закрыть, пока экран был в фоне (очистка профиля в списке).
        if (profileId != 0 && session?.isOpen != true) openTab(profileId, site)
    }

    override fun onDestroy() {
        geckoView.releaseSession()
        attached.forEach {
            it.progressDelegate = null
            it.navigationDelegate = null
            it.contentDelegate = null
            it.promptDelegate = null
        }
        attached.clear()
        pendingFile?.let { (prompt, result) -> result.complete(prompt.dismiss()) }
        pendingFile = null
        super.onDestroy()
    }

    private fun openTab(intent: Intent) {
        val s = intent.getStringExtra(EXTRA_SITE)?.let { runCatching { Site.valueOf(it) }.getOrNull() }
        openTab(intent.getIntExtra(EXTRA_PROFILE, profileId.coerceAtLeast(1)), s ?: Profiles.lastSite(this))
        intent.getStringExtra(EXTRA_URL)?.let { session?.loadUri(it) }
    }

    private fun openTab(id: Int, newSite: Site) {
        if (id == profileId && newSite == site && session?.isOpen == true) return
        geckoView.releaseSession()
        profileId = id
        site = newSite
        Profiles.saveLastSite(this, newSite)

        val p = Profiles.get(this, id)
        chipDot.background = Ui.oval(p.color)
        chipName.text = p.name
        tabs.forEach { (s, view) -> styleTab(view, s == newSite) }
        showUrl(Profiles.lastUrl(this, id, newSite))
        progress.visibility = View.GONE

        val s = Gecko.session(this, id, newSite)
        attachDelegates(s, id, newSite)
        geckoView.setSession(s)
        session = s
        renderSwitcher()
        updateNavButtons()
    }

    /** В покое — только домен и замок для https, при редактировании — полный адрес. */
    private fun showUrl(url: String) {
        currentUrl = url
        lockIcon.visibility = if (url.startsWith("https://")) View.VISIBLE else View.GONE
        if (!urlBar.hasFocus()) urlBar.setText(Uri.parse(url).host ?: url)
    }

    private fun setBarsHidden(hidden: Boolean) {
        if (hidden == barsHidden) return
        barsHidden = hidden
        chrome.forEach { it.visibility = if (hidden) View.GONE else View.VISIBLE }
    }

    private fun setFullScreen(on: Boolean) {
        fullScreen = on
        barsHidden = false
        chrome.forEach { it.visibility = if (on) View.GONE else View.VISIBLE }
        if (!on) progress.visibility = View.GONE
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

    private fun attachDelegates(s: GeckoSession, id: Int, tab: Site) {
        val k = Gecko.key(id, tab)
        val visible = { k == key }
        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                Diag.log(k, "начало: $url")
                if (visible()) {
                    progress.visibility = View.VISIBLE
                    showUrl(url)
                }
                Profiles.saveLastUrl(this@BrowserActivity, id, tab, url)
                History.add(this@BrowserActivity, id, url)
                pageUrls[k] = url
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

            // Ссылки «в новом окне» открываем в той же вкладке.
            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
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
                if (tab == Site.GMAIL) Profiles.updateFromTitle(this@BrowserActivity, id, title)
                val url = pageUrls[k]
                if (url != null && !title.isNullOrBlank()) History.setTitle(this@BrowserActivity, id, url, title)
            }

            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                Downloads.save(this@BrowserActivity, response)
            }

            // Процесс страницы упал или выгружен системой — без этого остаётся белый экран.
            override fun onCrash(session: GeckoSession) = recover("сбой процесса страницы")

            override fun onKill(session: GeckoSession) = recover("страница выгружена системой")

            private fun recover(reason: String) {
                Diag.log(k, reason)
                attached.remove(s)
                Gecko.forget(k)
                if (visible()) {
                    Toast.makeText(this@BrowserActivity, "Страница перезапущена: $reason", Toast.LENGTH_SHORT).show()
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
                alpha = if (current || Gecko.isActive(p.id)) 1f else 0.55f
                contentDescription = p.name
                setOnClickListener { openTab(p.id, site) }
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

    private fun showMenu(anchor: View) {
        val menu = PopupMenu(this, anchor)
        val items = listOf<Pair<String, () -> Unit>>(
            "Копировать ссылку" to { copyUrl() },
            "Открыть в другом браузере" to { openExternally() },
            "Диагностика" to { showDiagnostics() },
            "Настройки" to { startActivity(Intent(this, SettingsActivity::class.java)) },
        )
        items.forEachIndexed { i, (title, _) -> menu.menu.add(0, i, i, title) }
        menu.setOnMenuItemClickListener { items[it.itemId].second(); true }
        menu.show()
    }

    private fun showHistory() {
        val visits = History.list(this, profileId)
        val name = Profiles.get(this, profileId).name
        if (visits.isEmpty()) {
            Toast.makeText(this, "История профиля «$name» пуста", Toast.LENGTH_SHORT).show()
            return
        }
        val fmt = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())
        val labels = visits.map { v ->
            val head = v.title.ifBlank { Uri.parse(v.url).host ?: v.url }
            "$head\n${Uri.parse(v.url).host ?: ""} · ${fmt.format(Date(v.time))}"
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("История: $name")
            .setItems(labels) { _, i -> session?.loadUri(visits[i].url) }
            .setNeutralButton("Очистить историю") { _, _ ->
                History.clear(this, profileId)
                Toast.makeText(this, "История очищена", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Закрыть", null)
            .show()
    }

    private fun showClear() {
        val name = Profiles.get(this, profileId).name
        val options = arrayOf(
            "История профиля «$name»",
            "Кэш (все профили, входы сохраняются)",
            "Выйти из аккаунтов профиля «$name»",
        )
        val checked = booleanArrayOf(true, true, false)
        AlertDialog.Builder(this)
            .setTitle("Очистка")
            .setMultiChoiceItems(options, checked) { _, i, on -> checked[i] = on }
            .setPositiveButton("Очистить") { _, _ ->
                if (checked[0]) History.clear(this, profileId)
                if (checked[1]) Gecko.clearCache(this)
                if (checked[2]) {
                    // Закрываем вкладки профиля, стираем его данные и открываем заново — уже без входа.
                    geckoView.releaseSession()
                    Gecko.clearProfile(this, profileId)
                    openTab(profileId, site)
                }
                Toast.makeText(this, "Готово", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun showDiagnostics() {
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull()
        val text = "Ось $version\nВкладка: ${Profiles.get(this, profileId).name} / ${site.title}\n" +
            "Адрес: $currentUrl\n\n${Diag.text()}"
        AlertDialog.Builder(this)
            .setTitle("Диагностика")
            .setMessage(text)
            .setPositiveButton("Копировать") { _, _ ->
                getSystemService(ClipboardManager::class.java)
                    ?.setPrimaryClip(ClipData.newPlainText("diag", text))
            }
            .setNegativeButton("Закрыть", null)
            .show()
    }

    private fun errorPage(uri: String?, error: WebRequestError): String {
        val reason = when (error.category) {
            WebRequestError.ERROR_CATEGORY_NETWORK -> "Нет соединения с сайтом. Проверьте интернет или VPN."
            WebRequestError.ERROR_CATEGORY_SECURITY -> "Небезопасное соединение: сертификат сайта не прошёл проверку."
            WebRequestError.ERROR_CATEGORY_URI -> "Не удалось найти сайт. Проверьте адрес."
            WebRequestError.ERROR_CATEGORY_SAFEBROWSING -> "Сайт помечен как опасный (фишинг или вредоносные программы)."
            else -> "Страница не загрузилась."
        }
        val dark = Ui.dark
        val html = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;padding:32px 20px;font-family:sans-serif;
            background:${if (dark) "#1B1B1D" else "#F5F5F7"};color:${if (dark) "#E8E8EA" else "#1B1B1D"}">
            <h2 style="margin:0 0 12px">Страница не открылась</h2>
            <p style="color:${if (dark) "#9A9AA2" else "#6B6B73"};line-height:1.5">$reason</p>
            <p style="font-size:12px;color:#888;word-break:break-all">${(uri ?: "").replace("<", "&lt;")}<br>
            Код: ${error.category}/${error.code}</p>
            <p style="color:#2BA89A">Нажмите «Обновить» внизу, чтобы попробовать снова.</p></body>"""
        return "data:text/html;charset=utf-8," + Uri.encode(html)
    }

    private fun copyUrl() {
        getSystemService(ClipboardManager::class.java)
            ?.setPrimaryClip(ClipData.newPlainText("url", currentUrl))
        Toast.makeText(this, "Ссылка скопирована", Toast.LENGTH_SHORT).show()
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
            setOnClickListener {
                startActivity(Intent(this@BrowserActivity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }
        }

        // Переключатель вкладок Gmail / Claude.
        val tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        tabs = Site.values().associateWith { s ->
            TextView(this).apply {
                text = s.title
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setOnClickListener { openTab(profileId, s) }
                tabBar.addView(this, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            }
        }

        val more = iconButton(R.drawable.ic_more, "Меню") { showMenu(it) }

        val h = dp(40)
        val tabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(chip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, h))
            addView(tabBar, LinearLayout.LayoutParams(0, h, 1f).apply { marginStart = dp(8) })
            addView(more, LinearLayout.LayoutParams(h, h).apply { marginStart = dp(8) })
        }

        // Адресная строка: домен с замком; нажатие — полный адрес для правки или поиска.
        lockIcon = icon(R.drawable.ic_lock, Ui.MUTED, 14)
        urlBar = EditText(this).apply {
            setSingleLine()
            textSize = 14f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            hint = "Адрес или поиск в Google"
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
        val addressBox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), 0, dp(4), 0)
            addView(lockIcon)
            addView(urlBar, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        }
        urlBar.setOnFocusChangeListener { v, focused ->
            addressBox.background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1), if (focused) Ui.ACCENT else Ui.BORDER)
            if (focused) {
                urlBar.setText(currentUrl)
                urlBar.post { urlBar.selectAll() }
            } else {
                urlBar.setText(Uri.parse(currentUrl).host ?: currentUrl)
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
        refresher = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(Ui.ACCENT)
            setProgressBackgroundColorSchemeColor(Ui.SURFACE)
            setOnChildScrollUpCallback { _, _ -> !geckoView.canPullToRefresh }
            setOnRefreshListener {
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
        backButton = action(R.drawable.ic_back, "Назад") { session?.goBack() }
        forwardButton = action(R.drawable.ic_forward, "Вперёд") { session?.goForward() }
        action(R.drawable.ic_home, "Домой") { session?.loadUri(site.home) }
        action(R.drawable.ic_history, "История") { showHistory() }
        action(R.drawable.ic_delete, "Очистка") { showClear() }
        action(R.drawable.ic_refresh, "Обновить") { session?.reload() }

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
            root.addView(refresher, LinearLayout.LayoutParams(match, 0, 1f))
            root.addView(bottomDivider, LinearLayout.LayoutParams(match, dp(1)))
        } else {
            root.addView(refresher, LinearLayout.LayoutParams(match, 0, 1f))
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
            geckoView.onScrollDirection = { down -> if (!fullScreen && !urlBar.hasFocus()) setBarsHidden(down) }
        }

        // Фокус по умолчанию — на корне, иначе адресная строка захватывает его при открытии экрана.
        root.isFocusableInTouchMode = true
        setContentView(root)
        applyEdgeToEdge(root)
        root.requestFocus()
    }

    private fun toUrl(input: String): String {
        val t = input.trim()
        return when {
            t.startsWith("http://") || t.startsWith("https://") -> t
            t.contains('.') && !t.contains(' ') -> "https://$t"
            else -> "https://www.google.com/search?q=" + URLEncoder.encode(t, "UTF-8")
        }
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
                .setNegativeButton("Отмена") { _, _ ->
                    answered = true
                    result.complete(prompt.confirm(GeckoSession.PromptDelegate.ButtonPrompt.Type.NEGATIVE))
                }
                .setOnDismissListener { if (!answered) result.complete(prompt.dismiss()) }
                .show()
            return result
        }

        override fun onFilePrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.FilePrompt,
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            pendingFile?.let { (old, oldResult) -> oldResult.complete(old.dismiss()) }
            pendingFile = prompt to result
            val mime = prompt.mimeTypes?.singleOrNull()?.takeIf { it.contains('/') } ?: "*/*"
            pickFiles.launch(mime)
            return result
        }
    }
}

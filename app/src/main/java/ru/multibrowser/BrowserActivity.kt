package ru.multibrowser

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
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
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebResponse
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BrowserActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_SITE = "site"
    }

    private lateinit var geckoView: GeckoView
    private lateinit var chipDot: View
    private lateinit var chipName: TextView
    private lateinit var tabs: Map<Site, TextView>
    private lateinit var progress: ProgressBar
    private lateinit var switcher: LinearLayout
    private lateinit var backButton: View
    private lateinit var forwardButton: View
    private var profileId = 0
    private var site = Site.GMAIL
    private var session: GeckoSession? = null
    private var currentUrl = ""

    private val key get() = Gecko.key(profileId, site)

    // Адрес, загружаемый сейчас в каждой вкладке, — чтобы подписать запись истории заголовком страницы.
    private val pageUrls = HashMap<String, String>()

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
                if (Gecko.canGoBack[key] == true) session?.goBack() else finish()
            }
        })
        openTab(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openTab(intent)
    }

    override fun onDestroy() {
        geckoView.releaseSession()
        super.onDestroy()
    }

    private fun openTab(intent: Intent) {
        val s = intent.getStringExtra(EXTRA_SITE)?.let { runCatching { Site.valueOf(it) }.getOrNull() }
        openTab(intent.getIntExtra(EXTRA_PROFILE, profileId.coerceAtLeast(1)), s ?: Profiles.lastSite(this))
    }

    private fun openTab(id: Int, newSite: Site) {
        if (id == profileId && newSite == site && session != null) return
        geckoView.releaseSession()
        profileId = id
        site = newSite
        Profiles.saveLastSite(this, newSite)

        val p = Profiles.get(this, id)
        chipDot.background = Ui.oval(p.color)
        chipName.text = p.name
        tabs.forEach { (s, view) -> styleTab(view, s == newSite) }
        currentUrl = Profiles.lastUrl(this, id, newSite)
        progress.visibility = View.GONE

        val s = Gecko.session(this, id, newSite)
        attachDelegates(s, id, newSite)
        geckoView.setSession(s)
        session = s
        renderSwitcher()
        updateNavButtons()
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
                if (visible()) {
                    progress.visibility = View.VISIBLE
                    currentUrl = url
                }
                Profiles.saveLastUrl(this@BrowserActivity, id, tab, url)
                History.add(this@BrowserActivity, id, url)
                pageUrls[k] = url
            }

            override fun onProgressChange(session: GeckoSession, value: Int) {
                if (visible()) progress.progress = value
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
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
        }
        s.promptDelegate = PromptHandler()
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

    private fun iconButton(symbol: String, onClick: (View) -> Unit) = TextView(this).apply {
        text = symbol
        textSize = 20f
        setTextColor(Ui.TEXT)
        gravity = Gravity.CENTER
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setOnClickListener(onClick)
    }

    private fun actionButton(symbol: String, label: String, onClick: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(0, dp(4), 0, dp(2))
        addView(TextView(context).apply {
            text = symbol
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Ui.TEXT)
        })
        addView(TextView(context).apply {
            text = label
            textSize = 10f
            gravity = Gravity.CENTER
            setTextColor(Ui.MUTED)
        })
        setOnClickListener { onClick() }
    }

    private fun showMenu(anchor: View) {
        val menu = PopupMenu(this, anchor)
        val items = listOf<Pair<String, () -> Unit>>(
            "Открыть адрес…" to { askUrl() },
            "Копировать ссылку" to { copyUrl() },
            "Открыть в другом браузере" to { openExternally() },
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
                    val id = profileId
                    val tab = site
                    geckoView.releaseSession()
                    session = null
                    Gecko.clearProfile(this, id)
                    profileId = 0
                    openTab(id, tab)
                }
                Toast.makeText(this, "Готово", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun askUrl() {
        val input = EditText(this).apply {
            setText(currentUrl)
            setSingleLine()
            setTextColor(Ui.TEXT)
            imeOptions = EditorInfo.IME_ACTION_GO
            setSelectAllOnFocus(true)
        }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Адрес или поиск")
            .setView(box)
            .setPositiveButton("Открыть") { _, _ -> session?.loadUri(toUrl(input.text.toString())) }
            .setNegativeButton("Отмена", null)
            .create()
        input.setOnEditorActionListener { _, action, event ->
            val enter = event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
            if (action == EditorInfo.IME_ACTION_GO || enter) {
                session?.loadUri(toUrl(input.text.toString()))
                dialog.dismiss()
                true
            } else false
        }
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        dialog.show()
        input.requestFocus()
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

        val more = iconButton("⋮") { showMenu(it) }

        val h = dp(40)
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(10), dp(8), dp(10), dp(8))
            addView(chip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, h))
            addView(tabBar, LinearLayout.LayoutParams(0, h, 1f).apply { marginStart = dp(8) })
            addView(more, LinearLayout.LayoutParams(h, h).apply { marginStart = dp(8) })
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(Ui.ACCENT)
        }

        geckoView = GeckoView(this).apply { coverUntilFirstPaint(Ui.BG) }

        // Нижняя панель: быстрое переключение между 15 профилями без возврата к списку.
        switcher = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(8), dp(2), dp(8))
        }
        // Панель действий: как в обычном браузере, всё под большим пальцем.
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(4), dp(4), dp(4), 0)
        }
        fun action(symbol: String, label: String, onClick: () -> Unit) = actionButton(symbol, label, onClick).also {
            actions.addView(it, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        backButton = action("‹", "Назад") { session?.goBack() }
        forwardButton = action("›", "Вперёд") { session?.goForward() }
        action("⌂", "Домой") { session?.loadUri(site.home) }
        action("☰", "История") { showHistory() }
        action("✕", "Очистка") { showClear() }
        action("⟳", "Обновить") { session?.reload() }

        val switcherScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setBackgroundColor(Ui.BG)
            addView(switcher)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            addView(toolbar)
            addView(View(context).apply { setBackgroundColor(Ui.BORDER) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
            addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(2)))
            addView(geckoView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(View(context).apply { setBackgroundColor(Ui.BORDER) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
            addView(actions)
            addView(switcherScroll)
        }
        setContentView(root)
        applyEdgeToEdge(root)
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

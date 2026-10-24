package ru.multibrowser

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
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

class BrowserActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
    }

    private lateinit var geckoView: GeckoView
    private lateinit var chipDot: View
    private lateinit var chipName: TextView
    private lateinit var urlBar: EditText
    private lateinit var progress: ProgressBar
    private lateinit var switcher: LinearLayout
    private var profileId = 0
    private var session: GeckoSession? = null
    private var currentUrl = ""

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
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    urlBar.hasFocus() -> urlBar.clearFocus()
                    Gecko.canGoBack[profileId] == true -> session?.goBack()
                    else -> finish()
                }
            }
        })
        openProfile(intent.getIntExtra(EXTRA_PROFILE, 1))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openProfile(intent.getIntExtra(EXTRA_PROFILE, profileId))
    }

    override fun onDestroy() {
        geckoView.releaseSession()
        super.onDestroy()
    }

    private fun openProfile(id: Int) {
        if (id == profileId && session != null) return
        geckoView.releaseSession()
        profileId = id
        val p = Profiles.get(this, id)
        chipDot.background = Ui.oval(p.color)
        chipName.text = p.name
        showUrl(Profiles.lastUrl(this, id))
        progress.visibility = View.GONE

        val s = Gecko.session(this, id)
        attachDelegates(s, id)
        geckoView.setSession(s)
        session = s
        renderSwitcher()
    }

    /** В покое показываем только домен, при редактировании — полный адрес. */
    private fun showUrl(url: String) {
        currentUrl = url
        if (!urlBar.hasFocus()) urlBar.setText(Uri.parse(url).host ?: url)
    }

    private fun attachDelegates(s: GeckoSession, id: Int) {
        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                if (id == profileId) {
                    progress.visibility = View.VISIBLE
                    showUrl(url)
                }
                Profiles.saveLastUrl(this@BrowserActivity, id, url)
            }

            override fun onProgressChange(session: GeckoSession, value: Int) {
                if (id == profileId) progress.progress = value
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
                if (id == profileId) progress.visibility = View.GONE
            }
        }
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                Gecko.canGoBack[id] = canGoBack
            }

            // Ссылки «в новом окне» открываем в той же вкладке профиля.
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
                Profiles.updateFromTitle(this@BrowserActivity, id, title)
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
                setTextColor(Ui.TEXT)
                background = if (current) Ui.oval(p.color, dp(2), Ui.TEXT) else Ui.oval(p.color)
                alpha = if (current || Gecko.isActive(p.id)) 1f else 0.55f
                contentDescription = p.name
                setOnClickListener { openProfile(p.id) }
            }, LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(8) })
        }
    }

    private fun buildUi() {
        // Чип профиля: цвет + имя. Нажатие — к списку профилей.
        chipDot = View(this)
        chipName = TextView(this).apply {
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            maxWidth = dp(110)
            ellipsize = TextUtils.TruncateAt.END
        }
        val chip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(10), dp(9), dp(12), dp(9))
            addView(chipDot, LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(8) })
            addView(chipName)
            setOnClickListener {
                startActivity(Intent(this@BrowserActivity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }
        }

        urlBar = EditText(this).apply {
            setSingleLine()
            textSize = 14f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            hint = "Адрес или поиск"
            imeOptions = EditorInfo.IME_ACTION_GO
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), dp(9), dp(12), dp(9))
            setOnFocusChangeListener { _, focused ->
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1), if (focused) Ui.ACCENT else Ui.BORDER)
                if (focused) {
                    setText(currentUrl)
                    post { selectAll() }
                } else {
                    setText(Uri.parse(currentUrl).host ?: currentUrl)
                }
            }
            setOnEditorActionListener { _, action, event ->
                val enter = event != null &&
                    event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
                if (action == EditorInfo.IME_ACTION_GO || enter) {
                    val url = toUrl(text.toString())
                    currentUrl = url
                    session?.loadUri(url)
                    clearFocus()
                    getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(windowToken, 0)
                    true
                } else false
            }
        }

        val reload = TextView(this).apply {
            text = "⟳"
            textSize = 20f
            setTextColor(Ui.MUTED)
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(4), 0)
            setOnClickListener { session?.reload() }
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(10), dp(8), dp(10), dp(8))
            addView(chip)
            addView(urlBar, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(8) })
            addView(reload, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)))
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

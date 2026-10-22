package ru.multibrowser

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import java.net.URLEncoder

class BrowserActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
    }

    private lateinit var geckoView: GeckoView
    private lateinit var badge: TextView
    private lateinit var urlBar: EditText
    private lateinit var progress: ProgressBar
    private var profileId = 0
    private var session: GeckoSession? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (Gecko.canGoBack[profileId] == true) session?.goBack() else finish()
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
        badge.text = p.name
        badge.setBackgroundColor(p.color)
        progress.progressTintList = android.content.res.ColorStateList.valueOf(p.color)
        urlBar.setText(Profiles.lastUrl(this, id))

        val s = Gecko.session(this, id)
        attachDelegates(s, id)
        geckoView.setSession(s)
        session = s
    }

    private fun attachDelegates(s: GeckoSession, id: Int) {
        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                if (id == profileId) {
                    progress.visibility = View.VISIBLE
                    if (!urlBar.hasFocus()) urlBar.setText(url)
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
        }
    }

    private fun buildUi() {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        badge = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 13f
            maxLines = 1
            setPadding(dp(10), dp(8), dp(10), dp(8))
            // Нажатие на имя профиля — вернуться к сетке профилей.
            setOnClickListener {
                startActivity(Intent(this@BrowserActivity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }
        }
        urlBar = EditText(this).apply {
            setSingleLine()
            textSize = 14f
            imeOptions = EditorInfo.IME_ACTION_GO
            setSelectAllOnFocus(true)
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_GO ||
                    (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
                ) {
                    session?.loadUri(toUrl(text.toString()))
                    clearFocus()
                    getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(windowToken, 0)
                    true
                } else false
            }
        }
        val reload = TextView(this).apply {
            text = "⟳"
            textSize = 22f
            setPadding(dp(12), dp(4), dp(8), dp(4))
            setOnClickListener { session?.reload() }
        }
        bar.addView(badge)
        bar.addView(urlBar, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            .apply { marginStart = dp(6) })
        bar.addView(reload)

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        geckoView = GeckoView(this)

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar)
            addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(3)))
            addView(geckoView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        })
    }

    private fun toUrl(input: String): String {
        val t = input.trim()
        return when {
            t.startsWith("http://") || t.startsWith("https://") -> t
            t.contains('.') && !t.contains(' ') -> "https://$t"
            else -> "https://www.google.com/search?q=" + URLEncoder.encode(t, "UTF-8")
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}

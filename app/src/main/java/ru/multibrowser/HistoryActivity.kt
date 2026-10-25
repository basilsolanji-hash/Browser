package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

/**
 * История профиля — как в Chrome: поиск, записи по дням («Сегодня — 25 окт. 2026 г.»),
 * крестик удаляет запись, нажатие открывает страницу; сверху — «Удалить данные о работе в браузере…».
 */
class HistoryActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
    }

    private var profile = 1
    private lateinit var list: LinearLayout
    private lateinit var rows: LinearLayout
    private var query = ""
    private var searching = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        profile = intent.getIntExtra(EXTRA_PROFILE, Profiles.lastProfile(this)).coerceIn(1, Settings.profileCount(this))
        list = ExtrasUi.screen(this)
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    private fun render() {
        list.removeAllViews()
        list.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(context).apply {
                text = Tr.t("history")
                textSize = 24f
                setTextColor(Ui.TEXT)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton(R.drawable.ic_search, Tr.t("search_history")) {
                searching = !searching
                if (!searching) query = ""
                render()
            }.apply { background = null }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(iconButton(R.drawable.ic_close, Tr.t("close")) { finish() }.apply { background = null },
                LinearLayout.LayoutParams(dp(44), dp(44)))
        })
        if (searching) list.addView(EditText(this).apply {
            hint = Tr.t("search_history")
            setText(query)
            setSingleLine()
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(14), dp(10), dp(14), dp(10))
            requestFocus()
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) { query = s?.toString().orEmpty(); renderRows() }
            })
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46)).apply { topMargin = dp(8) })
        list.addView(ExtrasUi.hint(this, Tr.t("history_profile_hint", Profiles.get(this, profile).name)).apply {
            textSize = 14f
            setPadding(0, dp(12), 0, dp(4))
        })
        list.addView(TextView(this).apply {
            text = Tr.t("clear_browsing_data") + "…"
            textSize = 16f
            setTextColor(Ui.ACCENT)
            setPadding(0, dp(12), 0, dp(16))
            setOnClickListener {
                startActivity(Intent(this@HistoryActivity, ClearDataActivity::class.java).putExtra(ClearDataActivity.EXTRA_PROFILE, profile))
            }
        })
        list.addView(View(this).apply { setBackgroundColor(Ui.BORDER) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
        (rows.parent as? LinearLayout)?.removeView(rows)
        list.addView(rows)
        renderRows()
    }

    private fun renderRows() {
        rows.removeAllViews()
        val q = query.trim()
        val visits = History.list(this, profile).filter { q.isEmpty() || it.title.contains(q, true) || it.url.contains(q, true) }
        if (visits.isEmpty()) {
            rows.addView(ExtrasUi.empty(this, if (q.isEmpty()) Tr.t("history_empty", Profiles.get(this, profile).name) else Tr.t("nothing_found")))
            return
        }
        var lastDay = ""
        visits.forEach { v ->
            val day = dayLabel(v.time)
            if (day != lastDay) {
                lastDay = day
                rows.addView(TextView(this).apply {
                    text = day
                    textSize = 14f
                    setTextColor(Ui.MUTED)
                    setPadding(0, dp(18), 0, dp(6))
                })
            }
            rows.addView(row(v))
        }
    }

    private fun dayLabel(time: Long): String {
        val date = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(time))
        val c = Calendar.getInstance()
        val today = c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)
        c.timeInMillis = time
        val d = c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR)
        return when (today - d) {
            0 -> Tr.t("dl_today") + " — " + date
            1 -> Tr.t("dl_yesterday") + " — " + date
            else -> date
        }
    }

    private fun row(v: Visit): View {
        val host = Uri.parse(v.url).host.orEmpty()
        return LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(64)
            setPadding(0, dp(4), 0, dp(4))
            setOnClickListener { open(v.url) }
            addView(FrameLayout(context).apply {
                background = Ui.oval(Ui.SURFACE)
                val h = host.removePrefix("www.").removePrefix("m.")
                addView(TextView(context).apply {
                    text = h.firstOrNull()?.uppercase() ?: "•"
                    textSize = 16f
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setTextColor(android.graphics.Color.WHITE)
                    background = Ui.oval(Profiles.color((h.hashCode() and 0x7fffffff) % 15 + 1))
                }, FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER))
            }, LinearLayout.LayoutParams(dp(44), dp(44)))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), 0, dp(8), 0)
                addView(TextView(context).apply {
                    text = v.title.ifBlank { host.ifEmpty { v.url } }
                    textSize = 16f
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(TextView(context).apply {
                    text = host
                    textSize = 13f
                    setTextColor(Ui.MUTED)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton(R.drawable.ic_close, Tr.t("delete")) {
                History.remove(this@HistoryActivity, profile, v.url, v.time)
                renderRows()
            }.apply { background = null }, LinearLayout.LayoutParams(dp(40), dp(40)))
        }
    }

    private fun open(url: String) {
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_PROFILE, profile)
            .putExtra(BrowserActivity.EXTRA_ACTION, BrowserActivity.ACTION_NEW_TAB)
            .putExtra(BrowserActivity.EXTRA_URL, url))
        finish()
    }
}

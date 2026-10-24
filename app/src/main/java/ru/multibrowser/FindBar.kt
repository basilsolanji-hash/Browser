package ru.multibrowser

import android.app.Activity
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.mozilla.geckoview.GeckoSession

/** «Найти на странице»: поле, «3 из 12», стрелки к предыдущему и следующему совпадению, закрыть. */
class FindBar(private val a: Activity, private val session: () -> GeckoSession?) {

    private val count = TextView(a).apply {
        textSize = 13f
        setTextColor(Ui.MUTED)
        setPadding(a.dp(8), 0, a.dp(4), 0)
    }
    private val field = EditText(a).apply {
        hint = Tr.t("find_hint")
        contentDescription = Tr.t("find_hint")
        setSingleLine()
        textSize = 15f
        setTextColor(Ui.TEXT)
        setHintTextColor(Ui.MUTED)
        background = null
        setPadding(a.dp(8), 0, a.dp(8), 0)
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) = find(s?.toString().orEmpty(), 0)
        })
    }

    val view: View = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Ui.SURFACE)
        setPadding(a.dp(8), a.dp(4), a.dp(4), a.dp(4))
        visibility = View.GONE
        addView(a.icon(R.drawable.ic_find, Ui.MUTED, 20))
        addView(field, LinearLayout.LayoutParams(0, a.dp(44), 1f))
        addView(count)
        addView(a.iconButton(R.drawable.ic_up, Tr.t("find_prev")) { find(null, GeckoSession.FINDER_FIND_BACKWARDS) },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)))
        addView(a.iconButton(R.drawable.ic_down, Tr.t("find_next")) { find(null, 0) },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)).apply { marginStart = a.dp(4) })
        addView(a.iconButton(R.drawable.ic_close, Tr.t("close")) { hide() },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)).apply { marginStart = a.dp(4) })
    }

    val isShown get() = view.visibility == View.VISIBLE

    fun show() {
        view.visibility = View.VISIBLE
        field.setText("")
        count.text = ""
        field.requestFocus()
        field.post { a.getSystemService(InputMethodManager::class.java)?.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT) }
    }

    fun hide() {
        view.visibility = View.GONE
        session()?.finder?.clear()
        a.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(field.windowToken, 0)
    }

    /** [text] null — следующее/предыдущее совпадение того же запроса. */
    private fun find(text: String?, flags: Int) {
        val s = session() ?: return
        if (text != null && text.isEmpty()) { s.finder.clear(); count.text = ""; return }
        s.finder.find(text, flags).accept { r ->
            count.text = if (r == null || r.total == 0) Tr.t("find_none") else Tr.t("find_count", r.current, r.total)
        }
    }
}

package ru.multibrowser

import android.app.Activity
import android.graphics.Typeface
import android.net.Uri
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Панель под адресной строкой во время ввода — как в Chrome: карточка текущей страницы
 * (поделиться, копировать, изменить), плитки частых сайтов профиля и подсказки из истории
 * и избранного по мере ввода. Ничего не уходит в сеть: только то, что уже есть на устройстве.
 */
class AddressPanel(
    private val a: Activity,
    private val onOpen: (String) -> Unit,
    private val onShare: () -> Unit,
    private val onCopy: () -> Unit,
    private val onEdit: () -> Unit,
) {
    private val content = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(a.dp(12), a.dp(10), a.dp(12), a.dp(24))
    }
    val view: View = ScrollView(a).apply {
        setBackgroundColor(Ui.BG)
        isFillViewport = true
        visibility = View.GONE
        addView(content)
    }

    private var profile = 0
    private var pageTitle = ""
    private var pageUrl = ""

    fun show(profile: Int, title: String, url: String) {
        this.profile = profile
        pageTitle = title
        pageUrl = url
        view.visibility = View.VISIBLE
        render("")
    }

    fun hide() {
        view.visibility = View.GONE
    }

    /** Перерисовать под введённый текст. */
    fun render(text: String) {
        if (view.visibility != View.VISIBLE) return
        content.removeAllViews()
        val q = text.trim()
        val web = pageUrl.startsWith("http")
        if (web && (q.isEmpty() || q == pageUrl)) content.addView(pageCard())
        if (q.isEmpty() || q == pageUrl) tiles()?.let { content.addView(it) } else suggestions(q)
    }

    private fun pageCard() = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL
        background = Ui.rounded(Ui.SURFACE, a.dpf(14))
        setPadding(a.dp(14), a.dp(10), a.dp(6), a.dp(10))
        addView(letter(Uri.parse(pageUrl).host.orEmpty()), LinearLayout.LayoutParams(a.dp(36), a.dp(36)))
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(12), 0, a.dp(6), 0)
            addView(line(pageTitle.ifBlank { Uri.parse(pageUrl).host.orEmpty() }, Ui.TEXT, 15f))
            addView(line(pageUrl, Ui.ACCENT, 13f))
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(a.iconButton(R.drawable.ic_share, Tr.t("share")) { onShare() }, LinearLayout.LayoutParams(a.dp(40), a.dp(40)))
        addView(a.iconButton(R.drawable.ic_link, Tr.t("copy_link")) { onCopy() },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)).apply { marginStart = a.dp(4) })
        addView(a.iconButton(R.drawable.ic_edit, Tr.t("edit_address")) { onEdit() },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)).apply { marginStart = a.dp(4) })
    }

    /** Частые сайты профиля по истории: до 8 плиток. */
    private fun tiles(): View? {
        val hosts = History.list(a, profile).mapNotNull { Uri.parse(it.url).host }
            .groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(8).map { it.key }
        if (hosts.isEmpty()) return null
        return LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, a.dp(16), 0, 0)
            hosts.chunked(4).forEach { rowHosts ->
                addView(LinearLayout(a).apply {
                    rowHosts.forEach { host ->
                        addView(LinearLayout(a).apply {
                            orientation = LinearLayout.VERTICAL
                            gravity = Gravity.CENTER_HORIZONTAL
                            setPadding(a.dp(4), a.dp(8), a.dp(4), a.dp(8))
                            contentDescription = host
                            setOnClickListener { onOpen("https://$host/") }
                            addView(letter(host), LinearLayout.LayoutParams(a.dp(52), a.dp(52)))
                            addView(TextView(a).apply {
                                text = host.removePrefix("www.").removePrefix("m.")
                                textSize = 12f
                                setTextColor(Ui.MUTED)
                                gravity = Gravity.CENTER
                                maxLines = 1
                                ellipsize = TextUtils.TruncateAt.END
                                setPadding(0, a.dp(6), 0, 0)
                            })
                        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                    }
                    repeat(4 - rowHosts.size) { addView(View(a), LinearLayout.LayoutParams(0, 1, 1f)) }
                })
            }
        }
    }

    /** Подсказки: избранное и история профиля, где заголовок или адрес содержат введённое. */
    private fun suggestions(q: String) {
        val marks = Bookmarks.all(a).filter { it.title.contains(q, true) || it.url.contains(q, true) }
            .map { Triple(R.drawable.ic_star, it.title, it.url) }
        val visits = History.list(a, profile).filter { it.title.contains(q, true) || it.url.contains(q, true) }
            .map { Triple(R.drawable.ic_history, it.title, it.url) }
        val items = (marks + visits).distinctBy { it.third }.take(8)
        // Первая строка — сам запрос: поиск или переход по адресу.
        val target = Search.toUrl(a, q)
        content.addView(suggestionRow(R.drawable.ic_search, q, target) { onOpen(target) })
        items.forEach { (icon, title, url) -> content.addView(suggestionRow(icon, title.ifBlank { url }, url) { onOpen(url) }) }
    }

    private fun suggestionRow(icon: Int, title: String, url: String, open: () -> Unit) = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = a.dp(56)
        setPadding(a.dp(6), 0, a.dp(6), 0)
        setOnClickListener { open() }
        addView(a.icon(icon, Ui.MUTED, 20))
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(16), 0, 0, 0)
            addView(line(title, Ui.TEXT, 15f))
            if (url != title) addView(line(url, Ui.MUTED, 12f))
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun line(text: String, color: Int, size: Float) = TextView(a).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

    /** Кружок с первой буквой сайта — без загрузки значков из сети. */
    private fun letter(host: String) = FrameLayout(a).apply {
        val h = host.removePrefix("www.").removePrefix("m.")
        background = Ui.oval(Profiles.color((h.hashCode() and 0x7fffffff) % 15 + 1))
        addView(TextView(a).apply {
            text = h.firstOrNull()?.uppercase() ?: "•"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(android.graphics.Color.WHITE)
            gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }
}
